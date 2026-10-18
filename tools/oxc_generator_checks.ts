import { parseSync } from "oxc-parser";
import { print } from "esrap";
import ts from "esrap/languages/ts";
import { id, rewrite } from "./transform_ast.ts";
import { lower_generator } from "./transform_generator.ts";
import type { TransformKind, TransformServices } from "./transform_context.ts";

function lower(source: string, kind: TransformKind = "do") {
  const program = parseSync("generator.ts", source).program;
  let counter = 0;
  let transformed = 0;
  const diagnostics: string[] = [];
  const services: TransformServices = {
    program,
    source,
    file_name: "generator.ts",
    config: {},
    bindings: {
      resolve: () => null,
      imported: () => false,
      scope: () => null,
      parent: () => null,
    },
    imports: {
      do_names: new Set(["Do"]),
      program_names: new Set(),
      effect_names: new Set(),
      namespaces: new Set(),
      terminal_functions: new Map(),
      terminal_namespaces: new Map(),
      primitive_functions: new Map(),
      primitive_namespaces: new Map(),
      effect_helper_shadowed: false,
    },
    recursive_dictionaries: new Set(["Array", "Identity", "Task"]),
    task_dictionaries: new Set(["Task"]),
    fresh: (prefix) => id("generated_" + prefix + "_" + counter++),
    diagnose: (_node, message) => diagnostics.push(message),
    report: () => {},
    kind: (value) => {
      if (value.callee.type === "Identifier" && value.callee.name === "Do") {
        return kind;
      }
    },
    effect: () => id("Effect"),
    loop: () => id("Loop"),
    flat_dictionary: () => id("Identity"),
    terminal: () => id("unused"),
    compile: () => undefined,
  };
  const output = rewrite(program, (node) => {
    if (node.type !== "CallExpression" || !services.kind(node)) return;
    const result = lower_generator(node, services);
    if (result) transformed += 1;
    return result;
  });
  return { code: print(output, ts()).code, diagnostics, transformed };
}
function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(JSON.stringify({ actual, expected }));
  }
}
const imports = `
import { Identity } from "${new URL("../src/identity.ts", import.meta.url)}";
import { ArrayT as Array } from "${new URL(
  "../src/array.ts",
  import.meta.url,
)}";
import { Task } from "${new URL("../src/task.ts", import.meta.url)}";
import { Effect, run } from "${new URL("../src/effects.ts", import.meta.url)}";
import * as Loop from "${new URL("../src/loop.ts", import.meta.url)}";
`;
async function execute(source: string, kind: TransformKind = "do") {
  const result = lower(imports + source, kind);
  if (result.diagnostics.length) throw new Error(result.diagnostics.join("\n"));
  equal(result.transformed, 1);
  const value = await import(
    "data:application/typescript;base64," + btoa(result.code)
  );
  return value.default;
}

Deno.test("Oxc generator lowers direct binds, typed patterns and right identity", async () => {
  equal(
    await execute(
      `export default Do(function* () { const { value }: { value: number } = yield* Identity({value: 4}); return value + 1; });`,
    ),
    5,
  );
  const direct = lower(
    `const value = Do(function* () { return yield* Identity(4); });`,
  );
  equal(direct.transformed, 1);
  if (!direct.code.includes("Identity(4)")) throw new Error(direct.code);
});

Deno.test("Oxc generator preserves explicit dictionary evaluation and branches", async () => {
  equal(
    await execute(
      `let calls = 0; function dictionary() { calls++; return Array; } const result = Do(dictionary(), function* () { const x = yield* Array([1, 2]); if (x === 1) return x + 10; else return yield* Array([x, x + 1]); }); export default { result, calls };`,
    ),
    { result: [11, 2, 3], calls: 1 },
  );
  equal(
    await execute(
      `export default Do(Array, function* () { const x = yield* Array([1, 2, 3]); switch (x) { case 1: { yield* Array([0]); break; } case 2: return 20; default: return 30; } return 10; });`,
    ),
    [10, 20, 30],
  );
});

Deno.test("Oxc generator lowers stack safe loops, breaks and continues", async () => {
  equal(
    await execute(
      `export default Do(Identity, function* () { for (let i = 0; i < 10000; i++) { yield* Identity(i); if (i < 9998) continue; break; } return 7; });`,
    ),
    7,
  );
  equal(
    await execute(
      `export default Do(Array, function* () { for (const x of [1, 2]) { const y = yield* Array([x, x + 10]); if (y > 10) break; } return 7; });`,
    ),
    [7, 7, 7],
  );
});

Deno.test("Oxc generator retains Program pure, map, bind and return-yield behavior", async () => {
  equal(
    await execute(
      `export default run(Do(function* () { return 4; }));`,
      "program",
    ),
    4,
  );
  equal(
    await execute(
      `export default run(Do(function* () { const x = yield* Effect.pure(2); const y = yield* Effect.pure(x + 1); return x + y; }));`,
      "program",
    ),
    5,
  );
  equal(
    await execute(
      `export default run(Do(function* () { return yield* Effect.pure(8); }));`,
      "program",
    ),
    8,
  );
});

Deno.test("Oxc generator retains cold Task loops and per-iteration callback captures", async () => {
  const result = await execute(
    `const events: number[] = []; const task = Do(Task, function* () { for (let i = 0; i < 100; i++) { yield* Task(async () => { events.push(i); return i; }); } return 42; }); const initial = [...events]; const a = await task.value()(); const b = await task.value()(); export default { initial, a, b, events };`,
  );
  equal(result, {
    initial: [],
    a: 42,
    b: 42,
    events: [
      ...globalThis.Array.from({ length: 100 }, (_, i) => i),
      ...globalThis.Array.from({ length: 100 }, (_, i) => i),
    ],
  });
});

Deno.test("Oxc generator retains while and do/while exit behavior", async () => {
  equal(
    await execute(
      `export default Do(Identity, function* () { while (true) { yield* Identity(1); break; } do { yield* Identity(2); continue; } while (false); return 3; });`,
    ),
    3,
  );
});

Deno.test("Oxc generator preserves replay barriers and unsupported control flow", () => {
  for (
    const body of [
      `let x = 0; yield* Identity(1); x++; return x;`,
      `const x = []; yield* Identity(1); return x;`,
      `console.log("prefix"); yield* Identity(1); return 0;`,
      `var x = 0; yield* Identity(1); return x;`,
      `try { yield* Identity(1); } finally { }`,
    ]
  ) {
    const result = lower(`const result = Do(function* () { ${body} });`);
    equal(result.transformed, 0);
    equal(result.diagnostics.length, 1);
  }
});

Deno.test("Oxc generator flattens 10000 independent yields", async () => {
  const body = globalThis.Array.from(
    { length: 10000 },
    (_, index) => `const item${index} = yield* Identity(${index});`,
  ).join("\n");
  equal(
    await execute(
      `export default Do(Identity, function* () { ${body} return item9999; });`,
    ),
    9999,
  );
});

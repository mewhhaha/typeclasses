import { executable_typescript } from "./transform_execute.ts";
import { SourceMap } from "node:module";
import { assert_equals, assert_true } from "../src/assert.ts";
import {
  create_transform_cache,
  transform_do_program_source,
} from "./transform_do_program.ts";
import { typeclasses_rollup_plugin } from "./transform_plugin.ts";

async function evaluate(source: string): Promise<unknown> {
  const absolute = source.replaceAll(
    /\.\.\/src\/([a-z_]+)\.ts/g,
    (_match, name: string) =>
      new URL(`../src/${name}.ts`, import.meta.url).href,
  );
  const code = executable_typescript(absolute);
  return (await import(
    "data:application/javascript," + encodeURIComponent(code)
  )).default;
}

Deno.test("independent 10000-yield Do compiles and executes without printer or runtime stack growth", async () => {
  const body = Array.from(
    { length: 10000 },
    (_, i) => `const n${i} = yield* Just(${i});`,
  ).join("\n");
  const source =
    `import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts";
const result = Do(function* () { ${body} return n9999; }); export default result.value();`;
  const result = transform_do_program_source(source);
  assert_equals(result.diagnostics, []);
  assert_equals(result.transformed, 1);
  assert_true(
    result.code.includes("switch (instruction_"),
    "expected flat control flow",
  );
  assert_equals(await evaluate(result.code), ["Just", 9999]);
});

Deno.test("lexical iterable shadows do not suppress unrelated fusion or leak into nested scopes", async () => {
  const source = `import { from_array, to_array } from "../src/iterable.ts";
function unused(from_array: unknown) { return from_array; }
const good = from_array([1,2]).map(n => n+1).map(n => n*2);
function shadow(from_array: (a: number[]) => number[]) { return from_array([1]).map(n => n+1).map(n => n*3); }
export default [to_array(good), shadow(a => a)];`;
  const result = transform_do_program_source(source);
  assert_equals(result.transformed, 1);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

Deno.test("local named Programs fuse with isolated scopes and original capture timing", async () => {
  const source =
    `import { Program, run } from "../src/effects.ts"; import { ask, run_reader } from "../src/reader.ts";
const events: number[] = [];
function f(outer: number) {
  const p = Program(function* () { const n = yield* ask<number>(); events.push(outer); return n + outer; });
  return run(run_reader(p, 2));
}
function g(outer: number) {
  const p = Program(function* () { const n = yield* ask<number>(); return n * outer; });
  return run(run_reader(p, 3));
}
export default [f(10), f(20), g(4), events];`;
  const result = transform_do_program_source(source);
  assert_true(!result.code.includes("const p ="), result.code);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

Deno.test("general MonadRec loops preserve branching, break, return and repeated Task execution", async () => {
  const variants = [
    `for (let i = 0; i < 100; i += 1) { const n = yield* Just(i); if (n === 8) break; if (n % 2 === 0) continue; yield* Just(n * 2); } return 42;`,
    `while (true) { const n = yield* Just(++count); if (n > 50) return n; if (n % 2 === 0) continue; yield* Just(n); }`,
    `do { const n = yield* Just(++count); if (n > 50) break; yield* Just(n); } while (true); return 43;`,
    `for (const i of [1,2,3,4,5]) { const n = yield* Just(i); if(n === 4) return n; yield* Just(n); } return 0;`,
  ];
  for (const body of variants) {
    const source =
      `import { Do } from "../src/typeclasses.ts"; import { Maybe, Just } from "../src/maybe.ts"; let count = 0;
export default Do(Maybe, function* () { ${body} }).value();`;
    const result = transform_do_program_source(source);
    assert_equals(result.diagnostics, []);
    if (!body.includes("return n")) {
      assert_true(result.code.includes("tail_rec_m"), result.code);
    }
    assert_equals(await evaluate(result.code), await evaluate(source));
  }
});

Deno.test("optimization switches isolate passes and cache hits retain deeply mutable public containers", () => {
  const source =
    'import { Do } from "../src/typeclasses.ts"; const result = Do(Maybe, function* () { return 42; });';
  const cache = create_transform_cache();
  const enabled = cache.transform(source, "switch.ts", { explain: true });
  const disabled = cache.transform(source, "switch.ts", {
    explain: true,
    optimizations: { generator: false },
  });
  assert_equals(enabled.transformed, 1);
  assert_equals(disabled.transformed, 0);
  assert_equals(cache.stats().hits, 0);
  (enabled.map!.sources as string[])[0] = "corrupted";
  (enabled.map!.sourcesContent as string[])[0] = "corrupted";
  (enabled.reports[0] as { message: string }).message = "corrupted";
  const replay = cache.transform(source, "switch.ts", { explain: true });
  assert_true(replay.map!.sources[0] !== "corrupted", "map isolation");
  assert_equals(replay.map!.sourcesContent![0], source);
  assert_true(replay.reports[0].message !== "corrupted", "report isolation");
});

Deno.test("no-op plugin returns null for recognized imports and preserved unrecognized calls", () => {
  const plugin = typeclasses_rollup_plugin();
  for (
    const source of [
      'import { Do } from "../src/typeclasses.ts"; export const n = 1;',
      "const Program = (n: number) => n; export const n = Program(1);",
    ]
  ) {
    assert_equals(
      plugin.transform.call({ warn() {} }, source, "unused.ts"),
      null,
    );
  }
});

Deno.test("printed source map resolves the original line and column of retained statements", () => {
  const source =
    `import { Do } from "../src/typeclasses.ts";\nimport { Just } from "../src/maybe.ts";\nconst result = Do(function* () {\n  const n = yield* Just(1);\n  return explode(n);\n});`;
  const result = transform_do_program_source(source, "mapped.ts");
  const position = result.code.indexOf("explode(n)");
  const before = result.code.slice(0, position).split("\n");
  const map = new SourceMap(
    result.map! as ConstructorParameters<typeof SourceMap>[0],
  );
  const entry = map.findEntry(before.length - 1, before.at(-1)!.length);
  if (!("originalLine" in entry)) throw new Error("missing original mapping");
  assert_equals(entry.originalLine, 4);
  assert_equals(entry.originalColumn, 9);
});

Deno.test("generated loop IR and flat switch retain checked TypeScript result types", async () => {
  const bodies = [
    `for(let i = 0; i < 3; i++) { const n = yield* Just(i); if(n === 2) break; yield* Just(n); } return 42;`,
    `while(true) { const n = yield* Just(2); if(n === 2) break; } return 42;`,
    `do { const n = yield* Just(2); if(n === 2) break; } while(false); return 42;`,
    `for(const i of [1,2,3]) { const n = yield* Just(i); if(n === 2) break; } return 42;`,
    Array.from({ length: 128 }, (_, i) => `const n${i} = yield* Just(${i});`)
      .join("\n") + "return n127;",
  ];
  const directory = await Deno.makeTempDir({
    dir: "/var/tmp",
    prefix: "typeclasses-transform-types-",
  });
  try {
    const paths: string[] = [];
    for (const [index, body] of bodies.entries()) {
      const source =
        `import { Do } from "../src/typeclasses.ts"; import { Maybe, Just } from "../src/maybe.ts"; const result = Do(Maybe, function* () { ${body} }); const typed: import("../src/maybe.ts").Maybe<number> = result;`;
      const result = transform_do_program_source(source);
      assert_equals(result.diagnostics, []);
      const absolute = result.code.replaceAll(
        /\.\.\/src\/([a-z_]+)\.ts/g,
        (_match, name: string) =>
          new URL(`../src/${name}.ts`, import.meta.url).href,
      );
      const path = `${directory}/${index}.ts`;
      paths.push(path);
      await Deno.writeTextFile(path, absolute);
    }
    const checked = await new Deno.Command(Deno.execPath(), {
      args: ["check", ...paths],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert_true(checked.success, new TextDecoder().decode(checked.stderr));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Task factory replay is preserved when first-yield construction can be observed", async () => {
  const source =
    `import { Do } from "../src/typeclasses.ts"; import { Task } from "../src/task.ts";
const events: string[] = [];
function make(i: number) { events.push("construct:" + i); return Task(async () => { events.push("run:" + i); return i; }); }
const p = Do(Task, function* () { for(let i = 0; i < 3; i++) { const n = yield* make(i); if(n === 2) break; yield* make(n + 10); } return 42; });
const initial = [...events]; const a = await p.value()(); const b = await p.value()(); export default { initial, a, b, events };`;
  const result = transform_do_program_source(source);
  assert_equals(result.transformed, 0);
  assert_true(result.diagnostics[0].message.includes("replays"), result.code);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

Deno.test("bundler source maps compose original callback line and column through esbuild and Rolldown", async () => {
  const esbuild = await import("esbuild");
  const { rolldown } = await import("rolldown");
  const { typeclasses_esbuild_plugin, typeclasses_rolldown_plugin } =
    await import("./transform_plugin.ts");
  const directory = await Deno.makeTempDir({
    dir: "/var/tmp",
    prefix: "typeclasses-map-bundler-",
  });
  const source = `import { Do } from "${
    new URL("../src/typeclasses.ts", import.meta.url).pathname
  }";\nimport { Just } from "${
    new URL("../src/maybe.ts", import.meta.url).pathname
  }";\ndeclare function explode(n: number): number;\nexport const result = Do(function* () {\n  const n = yield* Just(1);\n  return explode(n);\n});`;
  const path = directory + "/mapped.ts";
  await Deno.writeTextFile(path, source);
  try {
    const built = await esbuild.build({
      entryPoints: [path],
      bundle: true,
      write: false,
      format: "esm",
      sourcemap: "external",
      outfile: directory + "/esbuild.js",
      plugins: [typeclasses_esbuild_plugin()],
    });
    const code = built.outputFiles!.find((file) =>
      file.path.endsWith(".js")
    )!.text;
    const map = built.outputFiles!.find((file) =>
      file.path.endsWith(".map")
    )!.text;
    assert_callback_mapping(code, JSON.parse(map));
    const bundle = await rolldown({
      input: path,
      plugins: [typeclasses_rolldown_plugin()],
    });
    try {
      const generated = await bundle.generate({
        format: "es",
        sourcemap: true,
      });
      const chunk = generated.output.find((output) => output.type === "chunk");
      if (chunk === undefined || chunk.type !== "chunk") {
        throw new Error("missing Rolldown chunk");
      }
      assert_callback_mapping(chunk.code, JSON.parse(chunk.map!.toString()));
    } finally {
      await bundle.close();
    }
  } finally {
    esbuild.stop();
    await Deno.remove(directory, { recursive: true });
  }
});

function assert_callback_mapping(
  code: string,
  map: ConstructorParameters<typeof SourceMap>[0],
) {
  const marker = code.lastIndexOf("explode(n)");
  assert_true(marker >= 0, "missing original callback expression");
  const before = code.slice(0, marker).split("\n");
  const entry = new SourceMap(map).findEntry(
    before.length - 1,
    before.at(-1)!.length,
  );
  if (!("originalLine" in entry)) throw new Error("missing composed mapping");
  assert_equals(entry.originalLine, 5);
  assert_equals(entry.originalColumn, 9);
}

function generated_program(seed: number, size: number): string {
  switch (seed % 4) {
    case 0:
      return `import { Do } from "../src/typeclasses.ts"; import { Maybe, Just } from "../src/maybe.ts";
let count = 0; const events: number[] = [];
function next() { events.push(++count); return Just(count); }
const p = Do(Maybe, function* () { while(true) { const n = yield* next(); if(n >= ${size}) break; if(n % 2 === 0) continue; yield* Just(n * 2); } return 42; }); export default [p.value(), events];`;
    case 1:
      return `import { Do } from "../src/typeclasses.ts"; import { Either, Right, Left } from "../src/either.ts";
const events: number[] = []; function step(n: number) { events.push(n); if(n === ${
        seed % 7
      }) return Left("failure"); return Right(n); }
const p = Do(Either, function* () { for(let i = 0; i < ${size}; i++) { const n = yield* step(i); if(n % 2) continue; yield* Right(n + 1); } return 42; }); export default [p.value(), events];`;
    case 2:
      return `import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts";
const events: string[] = []; function* items() { events.push("open"); try { for(let i=0;i<${size};i++) yield i; } finally { events.push("close"); } }
const p = Do(function* () { for(const item of items()) { const n = yield* Just(item); if(n >= ${
        seed % 5
      }) break; } return 42; }); export default [p.value(), events];`;
    default:
      return `import { Do } from "../src/typeclasses.ts"; import { ArrayT } from "../src/array.ts";
const p = Do(function* () { const n = yield* ArrayT([1,2]); if(n === 1) return n + ${size}; const m = yield* ArrayT([n,n+1]); return n*m; }); export default p.value();`;
  }
}

async function first_failing_reproduction(
  seed: number,
  size: number,
  transform: (source: string) => string,
): Promise<{ size: number; source: string } | undefined> {
  for (let smaller = 1; smaller <= size; smaller += 1) {
    const source = generated_program(seed, smaller);
    if (
      JSON.stringify(await evaluate(source)) !==
        JSON.stringify(await evaluate(transform(source)))
    ) return { size: smaller, source };
  }
  return undefined;
}

Deno.test("generated loop, failure, cleanup and branching traces shrink to executable reproductions", async () => {
  for (let seed = 0; seed < 32; seed += 1) {
    const size = 1 + seed % 9;
    const source = generated_program(seed, size);
    const result = transform_do_program_source(source);
    if (
      JSON.stringify(await evaluate(source)) ===
        JSON.stringify(await evaluate(result.code))
    ) continue;
    const failure = await first_failing_reproduction(
      seed,
      size,
      (source) => transform_do_program_source(source).code,
    );
    throw new Error(
      `differential mismatch; seed=${seed}; size=${failure?.size}\n${failure?.source}`,
    );
  }
  // Exercise the shrink path even when the production transform is correct.
  const injected = await first_failing_reproduction(
    3,
    8,
    (source) => source.replace("return n +", "return n -"),
  );
  assert_equals(injected?.size, 1);
  assert_true(
    injected!.source.includes("return n + 1"),
    "shrunk source remains executable",
  );
});

Deno.test("long dependent continuations preserve a diagnostic instead of overflowing the compiler printer", () => {
  const body = [
    "const n0 = yield* Just(0);",
    ...Array.from(
      { length: 399 },
      (_, i) => `const n${i + 1} = yield* Just(n${i} + 1);`,
    ),
  ];
  const source =
    `import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; const p = Do(function* () { ${
      body.join("\n")
    } return n399; });`;
  const result = transform_do_program_source(source);
  assert_equals(result.code, source);
  assert_equals(result.transformed, 0);
  assert_true(
    result.diagnostics[0].message.includes("liveness"),
    "explicit compiler-depth boundary",
  );
});

Deno.test("shared yield analysis excludes expired lexical bindings", async () => {
  const source =
    `import {Do} from "../src/typeclasses.ts"; import {Just} from "../src/maybe.ts";
const p = Do(function*(){ { let local = 0; const unused = () => { local += 1; }; } const n = yield* Just(42); return n; }); export default p.value();`;
  const result = transform_do_program_source(source);
  assert_equals(result.diagnostics, []);
  assert_equals(result.transformed, 1);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

import ts from "typescript";
import { assert_equals, assert_true } from "../src/assert.ts";
import { transform_do_program_source } from "./transform_do_program.ts";

const iterable_module = new URL("../src/iterable.ts", import.meta.url).href;

async function evaluate(source: string): Promise<unknown> {
  const executable = ts.transpileModule(
    source.replaceAll('"../src/iterable.ts"', JSON.stringify(iterable_module)),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
      },
    },
  ).outputText;
  const module = await import(
    "data:application/javascript," + encodeURIComponent(executable)
  );
  return module.default;
}

Deno.test("iterable map fusion retains laziness, replay, callback order, and early cleanup", async () => {
  const source = `
import { from_factory, to_array } from "../src/iterable.ts";
const events: string[] = [];
let opened = 0;
let closed = 0;
function record(stage: string, value: number) {
  events.push(stage + ":" + value);
  return value;
}
const pipeline = from_factory(function* () {
  opened += 1;
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally { closed += 1; }
}).map(n => record("first", n + 1))
  .map(n => record("second", n * 2))
  .map(n => n.toString());
const initial = { opened, closed, events: [...events] };
const first = to_array(pipeline.take(2));
const second = to_array(pipeline.take(2));
for (const item of pipeline.value()()) break;
export default { initial, first, second, opened, closed, events };
`;
  const transformed = transform_do_program_source(source);
  assert_equals(transformed.transformed, 1);
  assert_equals(transformed.diagnostics, []);
  assert_true(transformed.map !== null, "fused maps must retain source maps");
  assert_equals(transformed.map?.sourcesContent?.[0], source);
  assert_equals(transformed.code.match(/\.map\(/g)?.length, 1);
  assert_equals(await evaluate(transformed.code), await evaluate(source));
  assert_equals(await evaluate(transformed.code), {
    initial: { opened: 0, closed: 0, events: [] },
    first: ["4", "6"],
    second: ["4", "6"],
    opened: 3,
    closed: 3,
    events: [
      "first:2",
      "second:4",
      "first:3",
      "second:6",
      "first:2",
      "second:4",
      "first:3",
      "second:6",
      "first:2",
      "second:4",
    ],
  });
  const repeated = transform_do_program_source(transformed.code);
  assert_equals(repeated.transformed, 0);
  assert_equals(repeated.code, transformed.code);
});

Deno.test("iterable map fusion preserves callback failures and captured parameter scopes", async () => {
  const source = `
import { from_factory, from_array, to_array } from "../src/iterable.ts";
const events: number[] = [];
let closed = false;
function checked(value: number) {
  events.push(value);
  if (value === 4) throw new Error("stop");
  return value;
}
let failure: string | undefined;
try {
  to_array(from_factory(function* () {
    try { yield* [1, 2, 3]; }
    finally { closed = true; }
  }).map(n => checked(n + 1)).map(n => checked(n * 2)));
} catch (error) { failure = (error as Error).message; }
let offset = 1;
const closures = from_array([1, 2]).map(n => () => n + offset).map(fn => fn());
offset = 10;
export default { events, closed, failure, values: to_array(closures) };
`;
  const transformed = transform_do_program_source(source);
  assert_equals(transformed.transformed, 2);
  assert_equals(await evaluate(transformed.code), await evaluate(source));
  assert_equals(await evaluate(transformed.code), {
    events: [2, 4],
    closed: true,
    failure: "stop",
    values: [11, 12],
  });
});

Deno.test("iterable fusion recognizes exact imports, aliases, namespaces, and root exports", () => {
  const prefixes = [
    ['import { from_array as view } from "../src/iterable.ts";', "view([1])"],
    ['import * as i from "../src/iterable.ts";', "i.from_array([1])"],
    ['import { iterable as i } from "../src/mod.ts";', "i.from_array([1])"],
    ['import * as lib from "../src/mod.ts";', "lib.iterable.from_array([1])"],
    [
      'import { IterableT } from "@mewhhaha/typeclasses/iterable";',
      "IterableT(() => [1])",
    ],
    [
      'import { from_array } from "jsr:@mewhhaha/typeclasses@0.12.0/iterable";',
      "from_array([1])",
    ],
    [
      "import { from_array } from " + JSON.stringify(iterable_module) + ";",
      "from_array([1])",
    ],
    [
      'import { from_array } from "../src/iterable.ts";',
      "from_array([1]).filter(n => n > 0).take(1)",
    ],
  ];
  for (const [imports, value] of prefixes) {
    const source = imports + "\nconst result = " + value +
      ".map(n => n + 1).map(n => n * 2);";
    const transformed = transform_do_program_source(source);
    assert_equals(transformed.transformed, 1);
    assert_equals(transformed.diagnostics, []);
    assert_equals(transformed.code.match(/\.map\(/g)?.length, 1);
  }
});

Deno.test("iterable fusion leaves unknown dictionaries, shadowed imports, and unsupported mappers unchanged", () => {
  const sources = [
    "const result = [1, 2].map(n => n + 1).map(n => n * 2);",
    'import { from_array } from "../src/list.ts";\nconst result = from_array([1]).map(n => n + 1).map(n => n * 2);',
    'import { from_array } from "./unrelated.ts";\nconst result = from_array([1]).map(n => n + 1).map(n => n * 2);',
    'import { from_array } from "../src/iterable.ts";\nfunction f(from_array) { return from_array([1]).map(n => n + 1).map(n => n * 2); }',
    'import * as i from "../src/iterable.ts";\nfunction f(i) { return i.from_array([1]).map(n => n + 1).map(n => n * 2); }',
    'import type { from_array } from "../src/iterable.ts";\nconst result = from_array([1]).map(n => n + 1).map(n => n * 2);',
    'import { from_array } from "../src/iterable.ts";\nconst result = from_array([1]).map(fn).map(n => n * 2);',
    'import { from_array } from "../src/iterable.ts";\nconst result = from_array([1]).map(n => { return n + 1; }).map(n => n * 2);',
    'import { from_array } from "../src/iterable.ts";\nconst result = from_array([1]).map<number>(n => n + 1).map(n => n * 2);',
    'import { from_array } from "../src/iterable.ts";\nconst result = from_array([1])?.map(n => n + 1).map(n => n * 2);',
    'import { from_array } from "../src/iterable.ts";\nconst value = from_array([1]);\nconst result = value.map(n => n + 1).map(n => n * 2);',
  ];
  for (const source of sources) {
    const transformed = transform_do_program_source(source);
    assert_equals(transformed.transformed, 0);
    assert_equals(transformed.code, source);
    assert_equals(transformed.diagnostics, []);
    assert_equals(transformed.map, null);
  }
});

Deno.test("fused iterable maps preserve contextual typing and changing element types", async () => {
  const source = `
import { from_array, type IterableValue } from ${
    JSON.stringify(iterable_module)
  };
const strings: IterableValue<string> = from_array([1, 2])
  .map(n => n + 1).map(n => n.toString());
const choices: IterableValue<"yes" | "no"> = from_array([1, 2])
  .map(n => n > 0 ? "yes" : "no").map(s => s);
const functions: IterableValue<number> = from_array([1, 2])
  .map(n => () => n).map(fn => fn());
const annotated: IterableValue<number> = from_array([1, 2])
  .map((n: number): string => n.toString()).map((s: string) => s.length);
export { strings, choices, functions, annotated };
`;
  const transformed = transform_do_program_source(source);
  assert_equals(transformed.transformed, 4);
  for (const code of [source, transformed.code]) {
    const path = await Deno.makeTempFile({ suffix: ".ts" });
    try {
      await Deno.writeTextFile(path, code);
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["check", path],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert_true(
        result.success,
        "pipeline must typecheck\n" + new TextDecoder().decode(result.stderr) +
          "\n" + code,
      );
    } finally {
      await Deno.remove(path);
    }
  }
});

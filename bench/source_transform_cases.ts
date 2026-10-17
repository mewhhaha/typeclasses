// Literal inputs shared by baseline/current source-transform measurements.
const yields = Array.from(
  { length: 100 },
  (_, index) => `const n${index} = yield* Just(${index});`,
).join("\n");

export const source_transform_cases: Readonly<Record<string, string>> = {
  "no target": "export const f = (value: number) => value;\n".repeat(100),
  "100 yields":
    `import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; const p = Do(function* () { ${yields} return n99; });`,
  "named terminal":
    `import { Program, run } from "../src/effects.ts"; import { ask, run_reader } from "../src/reader.ts"; const p = Program(function* () { const n = yield* ask<number>(); return n + 1; }); const a = run(run_reader(p, 1)); const b = run(run_reader(p, 2));`,
  "named iterable":
    `import { from_array } from "../src/iterable.ts"; const base = from_array([1,2,3]); const first = (n: number) => n + 1; function second(n: number) { return n * 2; } const p = base.map(first).map(second).map(n => n.toString());`,
  "counted loop":
    `import { Do } from "../src/typeclasses.ts"; import { Maybe, Just } from "../src/maybe.ts"; const p = Do(Maybe, function* () { for(let i = 0; i < 100000; i += 1) { yield* Just(i); } return 42; });`,
};

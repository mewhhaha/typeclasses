import {
  append_chunk,
  type Chunk,
  type Link,
  sum_chunks,
  sum_links,
} from "./prototypes.ts";
import {
  compile_effect_plan,
  Effect,
  type EffectPlanInstruction,
  run,
} from "../../../src/effects.ts";
import {
  handle_operations,
  prepare_operations,
} from "../../../src/handlers.ts";
let sink: unknown;
const results: Record<string, unknown> = {};
function measure(name: string, fn: () => unknown, iterations = 100) {
  for (let i = 0; i < 20; i++) sink = fn();
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const start = performance.now();
    for (let j = 0; j < iterations; j++) sink = fn();
    samples.push((performance.now() - start) / iterations);
  }
  results[name] = {
    median_ms: samples.toSorted((a, b) => a - b)[3],
    samples_ms: samples,
    iterations,
  };
}
measure("Frames/linked-build-read10000", () => {
  let link: Link | undefined;
  for (let i = 0; i < 10000; i++) link = { previous: link, value: i };
  return sum_links(link);
});
measure("Frames/chunk32-build-read10000", () => {
  let chunk: Chunk | undefined;
  for (let i = 0; i < 10000; i++) chunk = append_chunk(chunk, i);
  return sum_chunks(chunk);
});
let prefix: Chunk | undefined;
const prefixes: Chunk[] = [];
for (let i = 0; i < 100; i++) {
  prefix = append_chunk(prefix, i);
  prefixes.push(prefix);
}
if (sum_chunks(prefixes[31]) !== 496 || sum_chunks(prefixes[99]) !== 4950) {
  throw Error("persistent chunk prefix changed");
}
const A = Effect.operation<number>()(["attempt.a"]);
const B = Effect.operation<number>()(["attempt.b"]);
type Requirement = typeof A | typeof B;
const instructions: EffectPlanInstruction<Requirement, number, number>[] = [
  {
    tag: "branch",
    select: (value) => {
      if (value < 100) return 1;
      return 2;
    },
  },
  {
    tag: "operation",
    operation: (state) => {
      if (state % 2 === 0) return A;
      return B;
    },
    resume: (state) => state + 1,
    next: 0,
  },
  { tag: "done", finish: (state) => state },
];
const plan = compile_effect_plan(instructions)(0);
const first = { "attempt.a": () => Effect.pure(1) };
const second = { "attempt.b": () => Effect.pure(2) };
measure(
  "Handlers/separate-pure100",
  () => run(handle_operations(handle_operations(plan, first), second)),
  1000,
);
const fused = prepare_operations({ ...first, ...second });
measure("Handlers/fused-pure100", () => run(fused(plan)), 1000);
const translates = { "attempt.a": () => Effect.send(B) };
const separate = run(
  handle_operations(handle_operations(Effect.send(A), translates), second),
);
let fused_failed = false;
try {
  run(handle_operations(Effect.send(A), { ...translates, ...second }));
} catch {
  fused_failed = true;
}
if (separate !== 2 || !fused_failed) {
  throw Error("emitted operation counterexample lost");
}
// Forwarding an unmatched operation removes a closure, but loses selected suffixes.
const mixed = Effect.bind(Effect.send(A), () => Effect.send(B));
const safely_handled = handle_operations(mixed, second);
const bypass = mixed;
const handled_first = handle_operations(safely_handled, first);
if (run(handled_first) !== 2) {
  throw Error("safe unmatched forwarding result changed");
}
let bypass_failed = false;
try {
  run(handle_operations(bypass, first));
} catch {
  bypass_failed = true;
}
if (!bypass_failed) throw Error("unmatched forwarding counterexample lost");
const empty = {};
const empty_prepared = prepare_operations(empty);
const unhandled = Effect.send(A);
if (empty_prepared(unhandled) !== unhandled) {
  throw Error("empty prepared table should preserve identity");
}
measure("Handlers/unmatched-empty-table1000", () => {
  let current = unhandled;
  for (let index = 0; index < 1000; index++) {
    current = handle_operations(current, empty);
  }
  return current;
}, 100);
measure("Handlers/prepared-empty1000", () => {
  let current = unhandled;
  for (let index = 0; index < 1000; index++) current = empty_prepared(current);
  return current;
}, 100);
const files: Record<string, string> = {};
for (
  const path of [
    new URL(import.meta.url),
    new URL("prototypes.ts", import.meta.url),
    new URL("../../../src/effects.ts", import.meta.url),
    new URL("../../../src/handlers.ts", import.meta.url),
  ]
) {
  files[path.pathname] = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
const report = {
  version: Deno.version,
  cpu: navigator.hardwareConcurrency,
  results,
  semantics: {
    persistent_chunks: true,
    automatic_fusion_emitted_operation_counterexample: fused_failed,
    unmatched_forwarding_loses_selected_suffix: bypass_failed,
  },
  files,
};
await Deno.writeTextFile(
  Deno.args[0] ?? "bench/artifacts/round3-runtime-attempts.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report.results, null, 2));
void sink;

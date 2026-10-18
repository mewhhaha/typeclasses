// Alternating paired batches in one process; both source roots share host/JIT conditions.
const roots = [Deno.args[0], Deno.args[1] ?? Deno.cwd()];
async function load(root: string) {
  const path = (name: string) => new URL(`file://${root}/src/${name}.ts`).href;
  const [t, r, s, e, h, c, m, id, ei] = await Promise.all(
    [
      "task",
      "reader",
      "state",
      "effects",
      "handlers",
      "typeclasses",
      "maybe",
      "identity",
      "either",
    ].map((name) => import(path(name))),
  );
  const R = r.Reader.with_environment();
  const S = s.State.with_state();
  function construct() {
    let x = t.succeed(0);
    for (let i = 0; i < 1000; i++) {
      x = x.map((v: number) => v + 1).bind((v: number) => t.succeed(v + 1));
    }
    return x;
  }
  let task = t.succeed(0), reader = R.pure(0), state = S.pure(0);
  for (let i = 0; i < 2000; i++) task = task.map((x: number) => x + 1);
  for (let i = 0; i < 1000; i++) {
    reader = reader.map((x: number) => x + 1);
    state = state.map((x: number) => x + 1);
  }
  const mixed = construct();
  const array = Array.from({ length: 5000 }, (_, i) => i);
  const Tick = e.Effect.operation()(["paired.tick"]);
  const table = { "paired.tick": () => e.Effect.pure(1) };
  const generated = e.Program(function* () {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum += yield* e.Effect.send(Tick);
    return sum;
  });
  let mapped = e.Effect.send(Tick);
  for (let i = 0; i < 1000; i++) {
    mapped = e.Effect.map(mapped, (x: number) => x + 1);
  }
  const fns: Record<string, () => unknown> = {
    "Task/construct2000": construct,
    "Task/reused2000maps": () => t.run_task(task),
    "Task/reused2000mixed": () => t.run_task(mixed),
    "Task/traverse5000": () => t.run_task(t.traverse_task(array, 8, t.succeed)),
    "ParallelTask/pure-ap": () =>
      t.run_task(
        t.ParallelTask.pure((x: number) => x + 1).ap(t.ParallelTask.pure(2)),
      ),
    "Reader/reused1000": () => reader.run(0),
    "State/reused1000": () => state.run(0),
    "Reader/ap": () => R.pure((x: number) => x + 1).ap(R.pure(1)).run(0),
    "Reader/lift2": () =>
      c.Applicative.lift((a: number, b: number) => a + b, R.pure(1), R.pure(2))
        .run(0),
    "State/lift2": () =>
      c.Applicative.lift((a: number, b: number) => a + b, S.pure(1), S.pure(2))
        .run(0),
    "Do/Maybe100": () =>
      c.Do(m.Maybe, function* () {
        let sum = 0;
        for (let i = 0; i < 100; i++) sum += yield* m.Just(1);
        return sum;
      }),
    "Do/Identity100": () =>
      c.Do(id.Identity, function* () {
        let sum = 0;
        for (let i = 0; i < 100; i++) sum += yield* id.Identity(1);
        return sum;
      }),
    "Do/Either100": () =>
      c.Do(ei.Either, function* () {
        let sum = 0;
        for (let i = 0; i < 100; i++) sum += yield* ei.Right(1);
        return sum;
      }),
    "Do/Either-error100": () =>
      c.Do(ei.Either, function* () {
        let sum = 0;
        for (let i = 0; i < 100; i++) {
          try {
            sum += yield* ei.Left(i);
          } catch (error) {
            sum += error as number;
          }
        }
        return sum;
      }),
    "Effect/reused1000maps": () => e.run(h.handle_operations(mapped, table)),
    "Effect/Program-reuse100": () =>
      e.run(h.handle_operations(generated, table)),
  };
  if (e.compile_effect_plan) {
    const graph = e.compile_effect_plan([
      {
        tag: "branch",
        select: (state: { index: number; sum: number }) => {
          if (state.index < 100) return 1;
          return 2;
        },
      },
      {
        tag: "operation",
        operation: () => Tick,
        resume: (state: { index: number; sum: number }, value: unknown) => ({
          index: state.index + 1,
          sum: state.sum + (value as number),
        }),
        next: 0,
      },
      {
        tag: "done",
        finish: (state: { index: number; sum: number }) => state.sum,
      },
    ])({ index: 0, sum: 0 });
    fns["Effect/graph-reuse100"] = () =>
      e.run(h.handle_operations(graph, table));
    const prepared = h.prepare_operations(table);
    fns["Handlers/prepared100"] = () => e.run(prepared(generated));
  }
  return fns;
}
const runtimes = await Promise.all(roots.map(load));
const names = Object.keys(runtimes[0]);
const results: Record<string, unknown> = {};
let sink: unknown;
for (const name of names) {
  let iterations = 1000;
  if (
    name.includes("construct") || name.includes("mixed") ||
    name.startsWith("Effect/")
  ) iterations = 200;
  if (name.includes("traverse")) iterations = 30;
  const pairs: number[][] = [];
  for (const fn of runtimes.map((runtime) => runtime[name])) {
    for (let i = 0; i < 100; i++) {
      sink = await fn();
    }
  }
  for (let block = 0; block < 8; block++) {
    const observations = [0, 0];
    const order = [0, 1];
    if (block % 2 === 1) order.reverse();
    for (const index of order) {
      const start = performance.now();
      for (let i = 0; i < iterations; i++) sink = await runtimes[index][name]();
      observations[index] = (performance.now() - start) / iterations;
    }
    pairs.push(observations);
  }
  const med = (values: number[]) =>
    values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  results[name] = {
    baseline_ms: med(pairs.map((pair) => pair[0])),
    candidate_ms: med(pairs.map((pair) => pair[1])),
    speedup: med(pairs.map((pair) => pair[0] / pair[1])),
    pairs_ms: pairs,
    iterations,
  };
}
// Same-runtime comparisons isolate API alternatives from the historical baseline.
for (
  const [name, first, second] of [[
    "Effect/compiled-vs-Program",
    "Effect/Program-reuse100",
    "Effect/graph-reuse100",
  ], [
    "Handlers/prepared-vs-table",
    "Effect/Program-reuse100",
    "Handlers/prepared100",
  ]]
) {
  const pairs = [];
  const runtime = runtimes[1];
  for (let block = 0; block < 8; block++) {
    const observation = [0, 0];
    const order = [0, 1];
    if (block % 2 === 1) order.reverse();
    for (const index of order) {
      let fn = runtime[first];
      if (index === 1) fn = runtime[second];
      const start = performance.now();
      for (let i = 0; i < 500; i++) sink = await fn();
      observation[index] = (performance.now() - start) / 500;
    }
    pairs.push(observation);
  }
  const med = (values: number[]) => values.toSorted((a, b) => a - b)[4];
  results[name] = {
    baseline_ms: med(pairs.map((p) => p[0])),
    candidate_ms: med(pairs.map((p) => p[1])),
    speedup: med(pairs.map((p) => p[0] / p[1])),
    pairs_ms: pairs,
    iterations: 500,
  };
}
const files: Record<string, string> = {};
for (const root of roots) {
  for (
    const name of [
      "task",
      "reader",
      "state",
      "effects",
      "handlers",
      "computation",
      "typeclasses/monad",
      "maybe",
      "either",
      "identity",
      "typeclass",
      "data_value",
    ]
  ) {
    files[`${root}/src/${name}.ts`] = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          await Deno.readFile(`${root}/src/${name}.ts`),
        ),
      ),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
  }
}
files.workload = Array.from(
  new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      await Deno.readFile(new URL(import.meta.url)),
    ),
  ),
  (x) => x.toString(16).padStart(2, "0"),
).join("");
await Deno.writeTextFile(
  Deno.args[2] ?? "bench/artifacts/round3-runtime-paired.json",
  JSON.stringify(
    {
      roots,
      version: Deno.version,
      cpu: navigator.hardwareConcurrency,
      results,
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(results, null, 2));
void sink;

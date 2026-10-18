const root = Deno.args[0] ?? Deno.cwd();
const output = Deno.args[1];
const load = (name: string) =>
  import(new URL(`file://${root}/src/${name}.ts`).href);
const [t, r, s, e, h, c, a, m] = await Promise.all([
  load("task"),
  load("reader"),
  load("state"),
  load("effects"),
  load("handlers"),
  load("typeclasses"),
  load("array"),
  load("maybe"),
]);
let sink: unknown;
const results: Record<string, unknown> = {};
async function measure(name: string, fn: () => unknown, iterations = 200) {
  for (let i = 0; i < Math.min(100, iterations); i++) sink = await fn();
  const samples = [];
  for (let j = 0; j < 7; j++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink = await fn();
    samples.push((performance.now() - start) / iterations);
  }
  results[name] = {
    median_ms: samples.toSorted((a, b) => a - b)[3],
    samples_ms: samples,
    iterations,
  };
}
function task() {
  let x = t.succeed(0);
  for (let i = 0; i < 1000; i++) {
    x = x.map((v: number) => v + 1).bind((v: number) => t.succeed(v + 1));
  }
  return x;
}
const taskValue = task();
await measure("Task/construct2000", task);
await measure("Task/reused2000", () => t.run_task(taskValue));
await measure(
  "ParallelTask/pure-ap",
  () =>
    t.run_task(
      t.ParallelTask.pure((x: number) => x + 1).ap(t.ParallelTask.pure(2)),
    ),
  2000,
);
await measure(
  "Task/traverse5000",
  () =>
    t.run_task(
      t.traverse_task(Array.from({ length: 5000 }, (_, i) => i), 8, t.succeed),
    ),
  20,
);
const Reader = r.Reader.with_environment();
const State = s.State.with_state();
let reader = Reader.pure(0), state = State.pure(0);
for (let i = 0; i < 1000; i++) {
  reader = reader.map((x: number) => x + 1);
  state = state.map((x: number) => x + 1);
}
await measure("Reader/reused1000", () => reader.run(0), 1000);
await measure("State/reused1000", () => state.run(0), 1000);
const rap = Reader.pure((x: number) => x + 1).ap(Reader.pure(2));
await measure("Reader/ap", () => rap.run(0), 10000);
const lifted = c.Applicative.lift(
  (x: number, y: number) => x + y,
  Reader.pure(1),
  Reader.pure(2),
);
await measure("Reader/lift2", () => lifted.run(0), 10000);
await measure("Do/Maybe100", () =>
  c.Do(m.Maybe, function* () {
    let x = 0;
    for (let i = 0; i < 100; i++) x += yield* m.Just(1);
    return x;
  }), 200);
const Tick = e.Effect.operation()(["runtime.tick"]);
let effect = e.Effect.send(Tick);
for (let i = 0; i < 1000; i++) {
  effect = e.Effect.map(effect, (x: number) => x + 1);
}
const handlers = { "runtime.tick": () => e.Effect.pure(1) };
await measure(
  "Effect/reused1000maps",
  () => e.run(h.handle_operations(effect, handlers)),
  1000,
);
const generated = e.Program(function* () {
  let x = 0;
  for (let i = 0; i < 100; i++) x += yield* e.Effect.send(Tick);
  return x;
});
await measure(
  "Effect/Program-reuse100",
  () => e.run(h.handle_operations(generated, handlers)),
  200,
);
await measure(
  "Handlers/table100",
  () => e.run(h.handle_operations(generated, handlers)),
  200,
);
if (h.prepare_operations) {
  const prepared = h.prepare_operations(handlers);
  await measure("Handlers/prepared100", () => e.run(prepared(generated)), 200);
}
const [either, identity, writer, _core] = await Promise.all([
  load("either"),
  load("identity"),
  load("writer"),
  load("typeclass"),
]);
await measure("Do/Identity100", () =>
  c.Do(identity.Identity, function* () {
    let x = 0;
    for (let i = 0; i < 100; i++) x += yield* identity.Identity(1);
    return x;
  }), 1000);
await measure("Do/Either100", () =>
  c.Do(either.Either, function* () {
    let x = 0;
    for (let i = 0; i < 100; i++) x += yield* either.Right(1);
    return x;
  }), 1000);
await measure("Do/Either-error100", () =>
  c.Do(either.Either, function* () {
    let x = 0;
    for (let i = 0; i < 100; i++) {
      try {
        x += yield* either.Left(i);
      } catch (error) {
        x += error as number;
      }
    }
    return x;
  }), 200);
const named = s.state("runtime.state");
const cellProgram = e.Program(function* () {
  yield* named.modify((x: number) => x + 1);
  return yield* named.get();
});
const bindings = { counter: h.provide_state(named, 0) };
await measure("Cells/run", () => h.run_cells(cellProgram, bindings), 2000);
if (h.prepare_cells) {
  const prepared = h.prepare_cells(bindings);
  await measure("Cells/prepared", () => prepared(cellProgram), 2000);
}
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
  ]);
  const value = graph({ index: 0, sum: 0 });
  await measure(
    "Effect/graph-reuse100",
    () => e.run(h.handle_operations(value, handlers)),
    500,
  );
}
for (const size of [1000, 10000]) {
  await measure(`Writer/eager${size}`, () => {
    let value = writer.tell(a.ArrayT([]));
    for (let i = 0; i < size; i++) {
      value = value.bind(() => writer.tell(a.ArrayT([i])));
    }
    return value.value()[1].value();
  }, 3);
}
try {
  const logs = await load("chunk_log");
  for (const size of [1000, 10000]) {
    await measure(`Writer/chunked${size}`, () => {
      let value = writer.tell(logs.ChunkLog.empty());
      for (let i = 0; i < size; i++) {
        value = value.bind(() => writer.tell(logs.chunk_log([i])));
      }
      return logs.flatten_chunk_log(value.value()[1]);
    }, 10);
  }
} catch (error) {
  if (!(error instanceof TypeError)) throw error;
}
const files: Record<string, string> = {};
for (
  const name of [
    "task",
    "reader",
    "state",
    "writer",
    "effects",
    "handlers",
    "computation",
    "typeclasses/monad",
  ]
) {
  const bytes = await Deno.readFile(`${root}/src/${name}.ts`);
  files[name] = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
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
const report = {
  root,
  version: Deno.version,
  cpu: navigator.hardwareConcurrency,
  results,
  files,
};
if (output) {
  await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(results, null, 2));
void sink;
void a;

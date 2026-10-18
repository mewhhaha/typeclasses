import {
  adaptive_batch,
  chunk_dictionary,
  compile_effect_plan,
  flatten,
} from "./plans.ts";
import {
  cached_lookup,
  lookup,
  type Overlay,
  stale_cache_observation,
} from "./lookup.ts";
const root = Deno.args[0] ?? Deno.cwd();
const output = Deno.args[1];
const path = (name: string) => new URL(`file://${root}/src/${name}.ts`).href;
const tasks: typeof import("../../../src/task.ts") = await import(path("task"));
const readers: typeof import("../../../src/reader.ts") = await import(
  path("reader")
);
const states: typeof import("../../../src/state.ts") = await import(
  path("state")
);
const stm: typeof import("../../../src/stm.ts") = await import(path("stm"));
const writers: typeof import("../../../src/writer.ts") = await import(
  path("writer")
);
const arrays: typeof import("../../../src/array.ts") = await import(
  path("array")
);
const workers: typeof import("../../../src/parallel.ts") = await import(
  path("parallel")
);
const core: typeof import("../../../src/typeclass.ts") = await import(
  path("typeclass")
);
const classes: typeof import("../../../src/typeclasses.ts") = await import(
  path("typeclasses")
);
let sink: unknown;
const results: Record<
  string,
  { median_ms: number; samples_ms: number[]; iterations: number }
> = {};
async function measure(
  name: string,
  fn: () => unknown | Promise<unknown>,
  iterations = 100,
) {
  for (let index = 0; index < 5; index += 1) sink = await fn();
  const samples_ms: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) sink = await fn();
    samples_ms.push((performance.now() - start) / iterations);
  }
  results[name] = {
    median_ms: samples_ms.toSorted((a, b) => a - b)[2],
    samples_ms,
    iterations,
  };
}
function make_task() {
  let task = tasks.succeed<number>(0);
  for (let index = 0; index < 1000; index += 1) {
    task = task.map((value) => value + 1).bind((value) =>
      tasks.succeed(value + 1)
    );
  }
  return task;
}
const task = make_task();
await measure("Task/construct2000", make_task);
await measure("Task/reused2000", () => tasks.run_task(task));
await measure("Task/cooperative2000", () =>
  tasks.run_task(task, {
    yield_every: 256,
    schedule: () => Promise.resolve(),
  }));
const input = Array.from({ length: 5000 }, (_, index) => index);
const traversal = tasks.traverse_task(input, 8, tasks.succeed);
await measure("Task/traverse5000", () => tasks.run_task(traversal), 20);
const Reader = readers.Reader.with_environment<number>();
const State = states.State.with_state<number>();
function make_reader() {
  let reader = Reader.pure<number>(0);
  for (let index = 0; index < 1000; index += 1) {
    reader = reader.map((value) => value + 1);
  }
  return reader;
}
const reader = make_reader();
let state = State.pure<number>(0);
for (let index = 0; index < 1000; index += 1) {
  state = state.map((value) => value + 1);
}
await measure("Reader/construct1000", make_reader);
await measure("Reader/reused1000", () => reader.run(0), 1000);
await measure("State/reused1000", () => state.run(0), 1000);
const variable = stm.new_tvar({ values: input.slice(0, 1000) });
const write = stm.write_tvar(variable, { values: input.slice(0, 1000) });
const exposed = write.bind(() => stm.read_tvar(variable));
await measure("STM/private-write1000", () => stm.atomically(write));
await measure("STM/exposed-write1000", () => stm.atomically(exposed));
const pure = stm.Stm.pure(1);
await measure("STM/pure", () => stm.atomically(pure), 10000);
const Chunk = chunk_dictionary({
  data: core.data,
  Monoid: classes.Monoid,
  Semigroup: classes.Semigroup,
});
for (const size of [1000, 10000]) {
  await measure(`Writer/eager${size}`, () => {
    let value = writers.tell(arrays.ArrayT<number>([]));
    for (let index = 0; index < size; index += 1) {
      value = value.bind(() => writers.tell(arrays.ArrayT([index])));
    }
    return value.value();
  }, 5);
  await measure(`Writer/chunked${size}`, () => {
    let value = writers.tell(Chunk<number>({ tag: "empty" }));
    for (let index = 0; index < size; index += 1) {
      value = value.bind(() =>
        writers.tell(Chunk({ tag: "leaf", items: [index] }))
      );
    }
    return flatten(value.value()[1].value());
  }, 5);
}
// Both Effect candidates use this experiment's pinned Effect runtime.
const { Effect, Program, run } = await import("../../../src/effects.ts");
const Tick = Effect.operation<number>()(["round2.tick"]);
const instructions = Array.from({ length: 100 }, () => Tick);
const compiled = compile_effect_plan(instructions);
const planned = compiled(0);
function generator() {
  return Program(function* () {
    let sum = 0;
    for (let index = 0; index < 100; index += 1) {
      sum += yield* Effect.send(Tick);
    }
    return sum;
  });
}
const generated = generator();
function execute(value: typeof planned) {
  return run(
    Effect.handle_operation(
      value,
      (operation): operation is typeof Tick => operation === Tick,
      () => Effect.pure(1),
    ),
  );
}
await measure(
  "Effect/compile100",
  () => compile_effect_plan(instructions),
  1000,
);
await measure(
  "Effect/plan-construct-first100",
  () => execute(compiled(0)),
  1000,
);
await measure(
  "Effect/Program-construct-first100",
  () => execute(generator()),
  1000,
);
await measure("Effect/plan-reuse100", () => execute(planned), 1000);
await measure("Effect/Program-reuse100", () => execute(generated), 1000);
await measure("Effect/plan-multiresume100", () => {
  if (planned[0] === "impure") return execute(planned[2](2));
}, 1000);
await measure("Effect/Program-multiresume100", () => {
  if (generated[0] === "impure") return execute(generated[2](2));
}, 1000);
let overlay: Overlay = { entries: new Map([[1, 7]]) };
for (let index = 0; index < 100; index += 1) {
  overlay = { parent: overlay, entries: new Map() };
}
const find = cached_lookup();
await measure("STM/lookup-uncached100", () => lookup(overlay, 1), 10000);
await measure("STM/lookup-cached100", () => find(overlay, 1), 10000);
const serializer =
  `(error) => ({ name: error.name, message: error.message, stack: error.stack })`;
function script(handler: string, concurrency: number) {
  return URL.createObjectURL(
    new Blob([
      `const serialize_error = ${serializer}; (${workers.serve_worker.toString()})(${handler}, { concurrency: ${concurrency} });`,
    ], { type: "text/javascript" }),
  );
}
const sync_url = script(`(input) => input + 1`, 1);
try {
  using pool = workers.create_worker_pool<number, number>(sync_url, {
    workers: 1,
  });
  await pool.map([0]);
  await measure(
    "Workers/callers256",
    () => Promise.all(Array.from({ length: 256 }, () => pool.map([1]))),
    3,
  );
  for (const size of [1, 8, 32]) {
    await measure(
      `Workers/sync256-batch${size}`,
      () => pool.map(input.slice(0, 256), { batch_size: size }),
      3,
    );
  }
  await measure("Workers/adaptive256", async () => {
    const output: number[] = [];
    let size = 1;
    for (let index = 0; index < 256;) {
      const start = performance.now();
      output.push(
        ...await pool.map(input.slice(index, Math.min(256, index + size)), {
          batch_size: size,
        }),
      );
      index += size;
      size = adaptive_batch(size, performance.now() - start, 2);
    }
    return output;
  }, 3);
} finally {
  URL.revokeObjectURL(sync_url);
}
for (const concurrency of [1, 8]) {
  const url = script(
    `async (input) => { await new Promise((resolve) => setTimeout(resolve, 2)); return input; }`,
    concurrency,
  );
  try {
    using pool = workers.create_worker_pool<number, number>(url, {
      workers: 1,
    });
    await pool.map([0]);
    await measure(
      `Workers/async64-concurrency${concurrency}`,
      () => pool.map(input.slice(0, 64), { batch_size: 32 }),
      1,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
const files: Record<string, string> = {};
for await (const entry of Deno.readDir(`${root}/src`)) {
  if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
  const bytes = await Deno.readFile(`${root}/src/${entry.name}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  files[`src/${entry.name}`] = Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
for (const name of ["plans.ts", "lookup.ts", "measure.ts"]) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(new URL(name, import.meta.url)),
  );
  files[`experiments/${name}`] = Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
const report = {
  root,
  command: Deno.args,
  version: Deno.version,
  cpu: navigator.hardwareConcurrency,
  results,
  lookup_cache_failure: stale_cache_observation(),
  files,
};
if (output !== undefined) {
  await Deno.writeTextFile(output, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(results, null, 2));
void sink;

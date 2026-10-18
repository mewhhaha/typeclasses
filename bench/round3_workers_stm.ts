import {
  cached_lookup,
  lookup,
  overlay,
  packed_worker_source,
} from "./experiments/round3_workers_stm.ts";
const root = Deno.args[0] ?? Deno.cwd();
const destination = Deno.args[1] ?? "/tmp/round3-workers-stm.json";
const parallel: typeof import("../src/parallel.ts") = await import(
  new URL(`file://${root}/src/parallel.ts`).href
);
const stm: typeof import("../src/stm.ts") = await import(
  new URL(`file://${root}/src/stm.ts`).href
);
const observations: Record<string, unknown> = {};
const results: Record<
  string,
  { median_ms: number; samples_ms: number[]; iterations: number }
> = {};
let sink: unknown;
async function measure(
  name: string,
  fn: () => unknown | Promise<unknown>,
  iterations = 20,
) {
  for (let index = 0; index < 10; index += 1) sink = await fn();
  const samples_ms: number[] = [];
  for (let sample = 0; sample < 7; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) sink = await fn();
    samples_ms.push((performance.now() - start) / iterations);
  }
  results[name] = {
    median_ms: samples_ms.toSorted((a, b) => a - b)[3],
    samples_ms,
    iterations,
  };
}
function script(
  handler: string,
  concurrency = 1,
  transfer = false,
  cooperative = false,
) {
  let extra = "";
  if (transfer) extra = ",transfer:output=>[output]";
  if (cooperative) extra += ",cooperative:true";
  return URL.createObjectURL(
    new Blob([
      `const serialize_error = error => ({name:error.name,message:error.message,stack:error.stack});
    (${parallel.serve_worker.toString()})(${handler},{concurrency:${concurrency}${extra}});`,
    ], { type: "text/javascript" }),
  );
}
const input = Array.from({ length: 256 }, (_, index) => index);
const url = script("input => input + 1");
try {
  using pool = parallel.create_worker_pool<number, number>(url, {
    workers: 1,
    protocol: "legacy",
  });
  await pool.map([0]);
  for (const size of [1, 8, 32]) {
    await measure(
      `worker/legacy256-batch${size}`,
      () => pool.map(input, { batch_size: size }),
    );
  }
  await measure(
    "worker/callers256",
    () => Promise.all(input.map((value) => pool.map([value]))),
    5,
  );
  using automatic = parallel.create_worker_pool<number, number>(url, {
    workers: 1,
  });
  await automatic.ready;
  await measure(
    "worker/default256-batch8",
    () => automatic.map(input, { batch_size: 8 }),
  );
  const program = parallel.parallel_map<number, number>(url, [1]);
  await measure(
    "worker/pooled-interpretation",
    () => parallel.run_parallel_with_pool(program, pool),
    10000,
  );
  if ("stream" in pool) {
    using compact = parallel.create_worker_pool<number, number>(url, {
      workers: 1,
      protocol: "range",
    });
    await compact.ready;
    for (const size of [8, 32, 256]) {
      await measure(
        `worker/range256-batch${size}`,
        () => compact.map(input, { batch_size: size }),
      );
    }
    const big = Array.from({ length: 65536 }, (_, index) => index);
    await measure(
      "worker/full65536",
      () => compact.map(big, { batch_size: 32 }),
      2,
    );
    await measure("worker/stream65536-first-window32", async () => {
      const iterator = compact.stream(big, { batch_size: 32, window_size: 32 })
        [Symbol.asyncIterator]();
      const first = await iterator.next();
      await iterator.return?.();
      return first;
    }, 10);
    let read = 0;
    const source = function* () {
      for (let index = 0; index < 65536; index += 1) {
        read += 1;
        yield index;
      }
    };
    const iterator = compact.stream(source(), {
      batch_size: 32,
      window_size: 32,
    })[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    observations.stream = {
      inputs: 65536,
      consumed_before_first: read,
      window_size: 32,
      output_slots_full: 65536,
      output_slots_window: 32,
    };
  }
} finally {
  URL.revokeObjectURL(url);
}
const async_url = script(
  "async input => {await Promise.resolve();return input;}",
  8,
);
try {
  using pool = parallel.create_worker_pool<number, number>(async_url, {
    workers: 1,
    protocol: "legacy",
  });
  await pool.map([0]);
  await measure(
    "worker/async256-local8",
    () => pool.map(input, { batch_size: 32 }),
  );
} finally {
  URL.revokeObjectURL(async_url);
}
const transfer_url = script(
  "async input => {await Promise.resolve();return input;}",
  8,
  true,
);
try {
  using pool = parallel.create_worker_pool<ArrayBuffer, ArrayBuffer>(
    transfer_url,
    { workers: 1, protocol: "legacy" },
  );
  await pool.ready;
  await measure("worker/transfers256-local8", () =>
    pool.map(
      Array.from({ length: 256 }, () => new ArrayBuffer(8)),
      { batch_size: 32, transfer: (input) => [input] },
    ));
} finally {
  URL.revokeObjectURL(transfer_url);
}
if ("update_immutable_path" in stm) {
  const cancel_url = script(
    `async (input, signal) => {
    if(input === 'wait') await new Promise(resolve => signal.addEventListener('abort',resolve,{once:true}));
    return self.identity ??= crypto.randomUUID();
  }`,
    1,
    false,
    true,
  );
  try {
    for (const cooperative of [false, true]) {
      const options: { workers: number; abort_grace_ms?: number } = {
        workers: 1,
      };
      if (cooperative) options.abort_grace_ms = 100;
      using pool = parallel.create_worker_pool<string, string>(
        cancel_url,
        options,
      );
      const before = await pool.map(["id"]);
      const cancel = async () => {
        const controller = new AbortController();
        const pending = pool.map(["wait"], { signal: controller.signal }).catch(
          () => undefined,
        );
        controller.abort();
        await pending;
        return await pool.map(["id"]);
      };
      let name = "worker/abort-terminate-restart";
      if (cooperative) name = "worker/abort-cooperative-reuse";
      await measure(name, cancel, 5);
      const after = await pool.map(["id"]);
      observations[name] = { same_worker: before[0] === after[0] };
    }
  } finally {
    URL.revokeObjectURL(cancel_url);
  }
}
const packed_url = URL.createObjectURL(
  new Blob([packed_worker_source], { type: "text/javascript" }),
);
const packed = new Worker(packed_url, { type: "module" });
try {
  const map = (inputs: readonly number[]) =>
    new Promise<number[]>((resolve) => {
      const values = new Float64Array(inputs);
      packed.onmessage = (event) => resolve(Array.from(event.data));
      packed.postMessage(values, [values.buffer]);
    });
  await measure("worker/packed256-including-pack-unpack", () => map(input));
} finally {
  packed.terminate();
  URL.revokeObjectURL(packed_url);
}
let many_writes = stm.Stm.pure<void>(undefined);
for (let index = 0; index < 1000; index += 1) {
  const current = stm.new_tvar(0);
  many_writes = many_writes.bind(() => stm.write_tvar(current, 1));
}
await measure(
  "stm/private-scalar-writes1000",
  () => stm.atomically(many_writes),
  100,
);
const variable = stm.new_tvar({
  count: 0,
  list: Array.from({ length: 1000 }, (_, index) => index),
});
const write = stm.write_tvar(variable, { count: 1, list: input });
await measure("stm/private-write256", () => stm.atomically(write), 1000);
const exposed = write.bind(() => stm.read_tvar(variable));
await measure("stm/exposed-write256", () => stm.atomically(exposed), 1000);
await measure(
  "stm/read256",
  () => stm.atomically(stm.read_tvar(variable)),
  1000,
);
if ("update_immutable_path" in stm) {
  const shaped = stm.new_tvar({ count: 0, list: input }, {
    shape: { record: { count: "number", list: { array: "number" } } },
  });
  const plain = stm.new_tvar({ count: 0, list: input });
  const shape_read = stm.read_tvar(shaped);
  const plain_read = stm.read_tvar(plain);
  await measure("stm/shape-read256", () => stm.atomically(shape_read), 1000);
  await measure("stm/plain-read256", () => stm.atomically(plain_read), 1000);
  const flat_shape = {
    record: { a: "number", b: "number", c: "number", d: "number" },
  } as const;
  const shaped_flat = stm.read_tvar(
    stm.new_tvar({ a: 1, b: 2, c: 3, d: 4 }, { shape: flat_shape }),
  );
  const plain_flat = stm.read_tvar(stm.new_tvar({ a: 1, b: 2, c: 3, d: 4 }));
  await measure(
    "stm/shape-flat-record",
    () => stm.atomically(shaped_flat),
    10000,
  );
  await measure(
    "stm/plain-flat-record",
    () => stm.atomically(plain_flat),
    10000,
  );
  const tree = stm.new_immutable_tvar({
    left: { count: 0 },
    right: { list: Array.from({ length: 10000 }, (_, index) => index) },
  });
  const update = stm.update_immutable_path(
    tree,
    ["left", "count"],
    (value) => Number(value) + 1,
  );
  const full = stm.read_tvar(tree).bind((value) =>
    stm.write_tvar(tree, { ...value, left: { count: value.left.count + 1 } })
  );
  await measure("stm/immutable-path10000", () => stm.atomically(update), 1000);
  await measure("stm/immutable-full10000", () => stm.atomically(full), 50);
}
let node = overlay();
const parent = node;
for (let depth = 0; depth < 100; depth += 1) node = overlay(node);
await measure("stm/overlay-direct-depth100", () => lookup(node, 1), 10000);
await measure(
  "stm/overlay-versioned-hit-depth100",
  () => cached_lookup(node, 1),
  10000,
);
await measure("stm/overlay-versioned-mutation-depth100", () => {
  parent.entries.set(1, 1);
  return cached_lookup(node, 1);
}, 10000);
const fingerprints: Record<string, string> = {};
for (
  const file of [
    "src/parallel.ts",
    "src/stm.ts",
    "src/typeclass.ts",
    "src/data_value.ts",
    "src/task.ts",
    "src/effects.ts",
  ]
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(`${root}/${file}`),
  );
  fingerprints[file] = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
for (
  const file of [
    new URL(import.meta.url),
    new URL("./experiments/round3_workers_stm.ts", import.meta.url),
  ]
) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(file),
  );
  fingerprints[file.pathname.split("/").slice(-2).join("/")] = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
await Deno.writeTextFile(
  destination,
  JSON.stringify(
    {
      root,
      date: new Date().toISOString(),
      deno: Deno.version,
      build: Deno.build,
      workload:
        "256 inputs, one warmed worker; 7 samples, 10 warmups; per-row iterations; medians; pack/unpack included",
      fingerprints,
      results,
      observations,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    destination,
    results: Object.fromEntries(
      Object.entries(results).map(([key, value]) => [key, value.median_ms]),
    ),
    observations,
  }),
);
void sink;

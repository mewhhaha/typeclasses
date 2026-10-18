const baseline = Deno.args[0];
const candidate = Deno.args[1];
const destination = Deno.args[2];
const old: typeof import("../src/parallel.ts") = await import(
  `file://${baseline}/src/parallel.ts`
);
const next: typeof import("../src/parallel.ts") = await import(
  `file://${candidate}/src/parallel.ts`
);
const libraries = [old, next];
const results: Record<string, unknown> = {};
let sink: unknown;
function script(library: typeof old, transfer: boolean) {
  let options = "{}";
  let handler = "input=>input+1";
  if (transfer) {
    handler = "async input=>{await Promise.resolve();return input;}";
    options = "{concurrency:8,transfer:output=>[output]}";
  }
  return URL.createObjectURL(
    new Blob([
      `const serialize_error=error=>({name:error.name,message:error.message,stack:error.stack});
    (${library.serve_worker.toString()})(${handler},${options});`,
    ], { type: "text/javascript" }),
  );
}
for (const row of ["batch1", "legacy8", "default8", "transfers32"]) {
  const transfer = row === "transfers32";
  const urls = libraries.map((library) => script(library, transfer));
  const pools = libraries.map((library, index) => {
    const options: { workers: number; protocol?: "legacy" } = { workers: 1 };
    if (row === "legacy8" || transfer) options.protocol = "legacy";
    return library.create_worker_pool<unknown, unknown>(urls[index], options);
  });
  try {
    await Promise.all(pools.map((pool) => pool.ready));
    const input = Array.from({ length: 256 }, (_, index) => index);
    let size = 8;
    if (row === "batch1") size = 1;
    if (transfer) size = 32;
    const run = (index: number) => {
      if (transfer) {
        return pools[index].map(
          Array.from({ length: 256 }, () => new ArrayBuffer(8)),
          {
            batch_size: size,
            transfer: (input) => [input as ArrayBuffer],
          },
        );
      }
      return pools[index].map(input, { batch_size: size });
    };
    for (let index = 0; index < 100; index += 1) {
      await run(0);
      await run(1);
    }
    const samples: number[][] = [[], []];
    for (let sample = 0; sample < 9; sample += 1) {
      let order = [0, 1];
      if (sample % 2 === 1) order = [1, 0];
      for (const index of order) {
        const start = performance.now();
        for (let iteration = 0; iteration < 20; iteration += 1) {
          sink = await run(index);
        }
        samples[index].push((performance.now() - start) / 20);
      }
    }
    results[row] = {
      baseline_ms: samples[0].toSorted((a, b) => a - b)[4],
      candidate_ms: samples[1].toSorted((a, b) => a - b)[4],
      samples_ms: samples,
    };
    if (row === "default8") {
      const programs = libraries.map((library, index) =>
        library.parallel_map(urls[index], [1])
      );
      const samples: number[][] = [[], []];
      for (let warm = 0; warm < 10000; warm += 1) {
        for (let index = 0; index < 2; index += 1) {
          sink = libraries[index].run_parallel_with_pool(
            programs[index],
            pools[index],
          );
        }
      }
      for (let sample = 0; sample < 9; sample += 1) {
        let order = [0, 1];
        if (sample % 2 === 1) order = [1, 0];
        for (const index of order) {
          const start = performance.now();
          for (let iteration = 0; iteration < 10000; iteration += 1) {
            sink = libraries[index].run_parallel_with_pool(
              programs[index],
              pools[index],
            );
          }
          samples[index].push((performance.now() - start) / 10000);
        }
      }
      results.interpretation = {
        baseline_ms: samples[0].toSorted((a, b) => a - b)[4],
        candidate_ms: samples[1].toSorted((a, b) => a - b)[4],
        samples_ms: samples,
      };
    }
  } finally {
    for (const pool of pools) pool.close();
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
const fingerprints: Record<string, string> = {};
for (const root of [baseline, candidate]) {
  for (
    const file of [
      "parallel.ts",
      "stm.ts",
      "task.ts",
      "typeclass.ts",
      "data_value.ts",
      "effects.ts",
    ]
  ) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await Deno.readFile(`${root}/src/${file}`),
    );
    fingerprints[`${root}/src/${file}`] = Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  }
}
await Deno.writeTextFile(
  destination,
  JSON.stringify(
    {
      baseline,
      candidate,
      date: new Date().toISOString(),
      deno: Deno.version,
      workload:
        "One warmed worker per variant; 100 alternating warmups; 9 samples x20 maps of256 inputs; order alternates; interpreter uses synchronous10000-call samples",
      fingerprints,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(results));
void sink;

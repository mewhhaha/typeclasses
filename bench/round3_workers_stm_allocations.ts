const roots = Deno.args.slice(0, 2);
const output: Record<string, unknown> = {};
for (const root of roots) {
  const task = await Deno.readTextFile(`${root}/src/task.ts`);
  const marker = "): Task<unknown> {\n  return Task((signal) => {";
  if (!task.includes(marker)) {
    throw new Error("Task.from_fn instrumentation anchor changed");
  }
  const counted = task.replace(
    marker,
    "): Task<unknown> {\n  (globalThis as unknown as {round3_count:number}).round3_count += 1;\n  return Task((signal) => {",
  );
  await Deno.writeTextFile(`${root}/src/task.count.ts`, counted);
  const parallel = (await Deno.readTextFile(`${root}/src/parallel.ts`)).replace(
    'from "./task.ts"',
    'from "./task.count.ts"',
  );
  await Deno.writeTextFile(`${root}/src/parallel.count.ts`, parallel);
  const library: typeof import("../src/parallel.ts") = await import(
    `file://${root}/src/parallel.count.ts`
  );
  const counter = globalThis as unknown as { round3_count: number };
  const pool = { worker: "file:///unused-worker.ts" } as Parameters<
    typeof library.run_parallel_with_pool
  >[1];
  const program = library.parallel_map(pool.worker, [1]);
  counter.round3_count = 0;
  for (let index = 0; index < 1000; index += 1) {
    library.run_parallel_with_pool(program, pool);
  }
  output[root] = {
    interpretations: 1000,
    from_fn_calls: counter.round3_count,
    instrumentation:
      "One counter increment at Task.from_fn entry; no Tasks executed; only worker equality is used on the deferred pool stub",
  };
}
await Deno.writeTextFile(Deno.args[2], JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));

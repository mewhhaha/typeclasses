const root = Deno.args[0] ?? Deno.cwd();
const { Reader } = await import(new URL(`file://${root}/src/reader.ts`).href);
const { Effect } = await import(new URL(`file://${root}/src/effects.ts`).href);
const runtime = globalThis as unknown as { gc?: () => void };
if (!runtime.gc) throw Error("Run with --v8-flags=--expose-gc");
async function collect() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.gc!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  runtime.gc!();
}
await collect();
const initial = Deno.memoryUsage();
const prefixes = [];
let reader = Reader.pure(0);
for (let i = 0; i < 1500; i++) {
  reader = reader.map((x: number) => x + 1);
  prefixes.push(reader);
  reader.run(0);
}
const hot = reader;
hot.run(0);
const effectPrefixes = [];
let effect = Effect.send(Effect.operation()(["memory.read"]));
for (let i = 0; i < 1500; i++) {
  effect = Effect.map(effect, (x: number) => x + 1);
  effectPrefixes.push(effect);
  effect[2](0);
}
const peak = Deno.memoryUsage();
await collect();
const retained = Deno.memoryUsage();
const samples = [];
for (let i = 0; i < 15; i++) {
  await collect();
  const start = performance.now();
  const result = hot.run(0);
  samples.push(performance.now() - start);
  if (result !== 1500) throw Error("wrong hot result");
}
const files: Record<string, string> = {};
for (const name of ["computation", "effects"]) {
  files[name] = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        await Deno.readFile(`${root}/src/${name}.ts`),
      ),
    ),
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
  initial,
  peak,
  retained,
  retained_heap_delta: retained.heapUsed - initial.heapUsed,
  prefix_count: prefixes.length + effectPrefixes.length,
  hot_after_gc: {
    samples_ms: samples,
    median_ms: samples.toSorted((a, b) => a - b)[7],
  },
  files,
};
await Deno.writeTextFile(Deno.args[1], JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

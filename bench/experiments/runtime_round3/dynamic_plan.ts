const root = Deno.args[0] ?? Deno.cwd();
const e = await import(new URL(`file://${root}/src/effects.ts`).href);
const h = await import(new URL(`file://${root}/src/handlers.ts`).href);
const Tick = e.Effect.operation()(["dynamic.tick"]);
const handlers = { "dynamic.tick": () => e.Effect.pure(1) };
const execute = (effect: unknown) =>
  e.run(h.handle_operations(effect, handlers));
const results: Record<string, unknown> = {};
let sink: unknown;
for (const size of [100, 1000]) {
  const generated = e.Program(function* () {
    let sum = 0;
    for (let index = 0; index < size; index++) {
      sum += yield* e.Effect.send(Tick);
      if (index % 2 === 0) sum += yield* e.Effect.send(Tick);
    }
    return sum;
  });
  const planned = e.compile_effect_plan([
    {
      tag: "branch",
      select: (state: { index: number; sum: number }) => {
        if (state.index < size) return 1;
        return 2;
      },
    },
    {
      tag: "step",
      effect: (state: { index: number; sum: number }) => {
        const first = e.Effect.send(Tick);
        if (state.index % 2 === 0) {
          return e.Effect.bind(
            first,
            (value: number) =>
              e.Effect.map(
                e.Effect.send(Tick),
                (second: number) => value + second,
              ),
          );
        }
        return first;
      },
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
  for (const value of [generated, planned, generated, planned]) {
    if (execute(value) !== size * 1.5) {
      throw Error("dynamic plan and Program disagree");
    }
  }
  const iterations = Math.max(10, 10000 / size);
  const pairs = [];
  for (let block = 0; block < 8; block++) {
    const pair = [0, 0];
    const order = [0, 1];
    if (block % 2 === 1) order.reverse();
    for (const index of order) {
      const start = performance.now();
      for (let iteration = 0; iteration < iterations; iteration++) {
        let value = generated;
        if (index === 1) value = planned;
        sink = execute(value);
      }
      pair[index] = (performance.now() - start) / iterations;
    }
    pairs.push(pair);
  }
  const med = (values: number[]) => values.toSorted((a, b) => a - b)[4];
  results[`dynamic${size}`] = {
    Program_ms: med(pairs.map((p) => p[0])),
    graph_ms: med(pairs.map((p) => p[1])),
    paired_speedup: med(pairs.map((p) => p[0] / p[1])),
    pairs_ms: pairs,
    iterations,
  };
}
const files: Record<string, string> = {};
for (
  const path of [
    `${root}/src/effects.ts`,
    `${root}/src/handlers.ts`,
    new URL(import.meta.url).pathname,
  ]
) {
  files[path] = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
await Deno.writeTextFile(
  Deno.args[1] ?? "bench/artifacts/round3-runtime-dynamic-plan.json",
  JSON.stringify(
    {
      root,
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

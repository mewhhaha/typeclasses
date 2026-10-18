// deno-lint-ignore-file no-explicit-any
// Nominally distinct Gen dictionaries share identical frozen core modules.
const root = Deno.args[0];
if (root === undefined) {
  throw new Error(
    "Pass an immutable source snapshot containing quickcheck_original.ts",
  );
}
const [original, registers] = await Promise.all([
  import(`${root}/src/quickcheck_original.ts`),
  import(`${root}/src/quickcheck.ts`),
]);
function make(q: any, count: number) {
  let value = q.constant(0);
  const random = q.integer({ min: 0, max: 100 });
  for (let i = 0; i < count; i++) {
    value = value.bind((x: number) => random.map((y: number) => x + y));
  }
  return value;
}
const state = { seed: 123, size: 100 };
let sink: unknown;
const results: unknown[] = [];
const median = (values: number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
function pair(
  name: string,
  before: () => unknown,
  after: () => unknown,
  repeats: number,
  warmup = 0,
) {
  for (let i = 0; i < warmup; i++) {
    sink = before();
    sink = after();
  }
  const samples: number[][] = [[], []];
  for (let block = 0; block < 11; block++) {
    const order = [0, 1];
    if (block % 2 === 1) order.reverse();
    for (const side of order) {
      const fn = [before, after][side];
      const start = performance.now();
      for (let i = 0; i < repeats; i++) sink = fn();
      samples[side].push((performance.now() - start) * 1000 / repeats);
    }
  }
  const old_us = median(samples[0]), register_us = median(samples[1]);
  const result = {
    name,
    old_us,
    register_us,
    speedup: old_us / register_us,
    samples_us: samples,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
// Measure execution separately: constructing each fresh plan is outside its timer.
for (const count of [8, 64, 1000]) {
  const samples: number[][] = [[], []];
  for (let repeat = 0; repeat < 55; repeat++) {
    const order = [0, 1];
    if (repeat % 2 === 1) order.reverse();
    for (const side of order) {
      const q = [original, registers][side];
      const value = make(q, count);
      const start = performance.now();
      sink = q.run_gen(value, state);
      samples[side].push((performance.now() - start) * 1000);
    }
  }
  const old_us = median(samples[0]), register_us = median(samples[1]);
  results.push({
    name: `fresh-first-draw-${count}`,
    old_us,
    register_us,
    speedup: old_us / register_us,
    samples_us: samples,
  });
  console.log(
    JSON.stringify({
      name: `fresh-first-draw-${count}`,
      old_us,
      register_us,
      speedup: old_us / register_us,
    }),
  );
  let repetitions = 5;
  if (count < 1000) repetitions = 50;
  pair(
    `fresh-construct-and-draw-${count}`,
    () => original.run_gen(make(original, count), state),
    () => registers.run_gen(make(registers, count), state),
    repetitions,
  );
}
function check(q: any, type: string) {
  let arbitrary;
  let property: (value: any) => boolean;
  switch (type) {
    case "scalar-map":
      arbitrary = q.arbitrary(
        q.integer({ min: 0, max: 100 }).map((x: number) => x + 1),
      );
      property = (x: number) => x >= 1 && x <= 101;
      break;
    case "array":
      arbitrary = q.array_arbitrary(q.integer_arbitrary({ min: 0, max: 100 }), {
        min_length: 16,
        max_length: 32,
      });
      property = (xs: number[]) =>
        xs.length >= 16 && xs.length <= 32 &&
        xs.every((x) => x >= 0 && x <= 100);
      break;
    case "maybe":
      arbitrary = q.maybe_arbitrary(q.integer_arbitrary({ min: 0, max: 100 }));
      property = (value) => {
        const [tag, item] = value.value();
        if (tag === "Nothing") return true;
        return item >= 0 && item <= 100;
      };
      break;
    case "bind32":
      arbitrary = q.arbitrary(make(q, 32));
      property = (x: number) => x >= 0 && x <= 3200;
      break;
    default:
      throw new Error(type);
  }
  return () => q.check({ arbitrary, property, seed: 123, iterations: 10000 });
}

for (const type of ["scalar-map", "array", "maybe", "bind32"]) {
  pair(`check10000-${type}`, check(original, type), check(registers, type), 2);
}
for (let seed = 0; seed < 32; seed++) {
  const a = original.run_gen(make(original, 32), { seed, size: 100 });
  const b = registers.run_gen(make(registers, 32), { seed, size: 100 });
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`Seed mismatch ${seed}`);
  }
}
async function hash(path: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
const names = [
  "quickcheck",
  "quickcheck_original",
  "typeclass",
  "data_value",
  "typeclasses/monad",
  "typeclasses/functor",
  "typeclasses/applicative",
];
await Deno.writeTextFile(
  Deno.args[1] ?? "bench/artifacts/round3-collections-gen-qualification.json",
  JSON.stringify(
    {
      root,
      runtime: Deno.version,
      workload_sha256: await hash(new URL(import.meta.url).pathname),
      sources: Object.fromEntries(
        await Promise.all(
          names.map(
            async (name) => [name, await hash(`${root}/src/${name}.ts`)],
          ),
        ),
      ),
      seeds: 32,
      results,
      sink_type: typeof sink,
    },
    null,
    2,
  ) + "\n",
);

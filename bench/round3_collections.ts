// deno-lint-ignore-file no-explicit-any
// Cross-version adapters intentionally accept separate nominal dictionary module graphs.
import { traverse_items as tuple_traverse } from "./experiments/round3_tuple_tree.ts";
// Serial paired observations, not universal rankings or allocation counts.
import { traverse_items as object_traverse } from "./experiments/round3_object_tree.ts";
import {
  growing_product,
  preallocated_product,
} from "./experiments/round3_array_product.ts";
const baseline = Deno.args[0] ?? "/tmp/typeclasses-round3-baseline-2068408";
async function load(root: string) {
  const names = [
    "iterable",
    "async_iterable",
    "array",
    "list",
    "quickcheck",
    "map",
    "record",
    "typeclasses",
    "identity",
    "maybe",
    "fn",
    "traversal",
    "typeclasses/applicative",
    "loop",
    "typeclass",
  ];
  const modules = await Promise.all(
    names.map((name) => import(`${root}/src/${name}.ts`)),
  );
  return Object.fromEntries(names.map((name, index) => [name, modules[index]]));
}
const currentRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const old = await load(baseline);
const now = await load(currentRoot);
const source = Array.from({ length: 1000 }, (_, i) => i);
let sink: unknown;
type Work = {
  hill: number | number[];
  name: string;
  old: () => unknown;
  now: () => unknown;
  repetitions?: number;
  warmups?: number;
  note?: string;
};
const work: Work[] = [];
function pair(
  hill: Work["hill"],
  name: string,
  make: (m: any) => () => unknown,
  repetitions = 50,
  note?: string,
) {
  work.push({ hill, name, old: make(old), now: make(now), repetitions, note });
}
const big = Array.from({ length: 100_000 }, (_, i) => i);
work.push({
  hill: 132,
  name: "compiled-map-filter-take-fold-100k",
  old: (() => {
    const p = old.iterable.from_array(big).map((x: number) => x + 1).filter((
      x: number,
    ) => x % 2 === 0).take(25000);
    return () =>
      old.typeclasses.Foldable.fold(p, 0, (a: number, b: number) => a + b);
  })(),
  now: (() => {
    const p = now.iterable.from_array(big).map((x: number) => x + 1).filter((
      x: number,
    ) => x % 2 === 0).take(25000);
    const fold = now.iterable.compile_fold(p);
    return () => fold(0, (a: number, b: number) => a + b);
  })(),
  repetitions: 5,
});
pair(134, "map-identity-traverse-1k", (m) => {
  const v = m.map.MapT(new Map(source.map((x) => [x, x])));
  return () =>
    m.typeclasses.Traversable.traverse(
      v,
      m.identity.Identity,
      (x: number) => m.identity.Identity(x + 1),
    ).value().value();
});
pair(161, "generic-lift-fn-64", (m) => {
  const args = Array.from({ length: 64 }, () => m.fn.fn((x: number) => x));
  return () =>
    m.typeclasses.Applicative.lift(
      (...x: number[]) => x.reduce((a, b) => a + b, 0),
      ...args,
    ).value()(1);
}, 30);
pair([162, 163], "collect-record-1k", (m) => {
  const v = Object.fromEntries(source.map((x) => [x, m.identity.Identity(x)]));
  return () => m["typeclasses/applicative"].collect(v).value();
}, 20);
work.push({
  hill: 134,
  name: "map-entries-versus-dual-cursors-1k",
  old: (() => {
    const v = now.map.MapT(new Map(source.map((x) => [x, x])));
    return () => {
      const map = v.value();
      const keys: unknown[] = [];
      const cursor = map.keys();
      return now.traversal.traverse_items_into(
        map.values(),
        now.identity.Identity,
        (x: number) => {
          keys.push(cursor.next().value);
          return now.identity.Identity(x + 1);
        },
        (values: Iterable<number>) => {
          const out = new Map();
          let i = 0;
          for (const value of values) out.set(keys[i++], value);
          return now.typeclass.as_data(now.map.MapT, out);
        },
      ).value().value();
    };
  })(),
  now: (() => {
    const v = now.map.MapT(new Map(source.map((x) => [x, x])));
    return () => {
      const keys: unknown[] = [];
      return now.traversal.traverse_items_into(
        v.value(),
        now.identity.Identity,
        ([key, x]: [number, number]) => {
          keys.push(key);
          return now.identity.Identity(x + 1);
        },
        (values: Iterable<number>) => {
          const out = new Map();
          let i = 0;
          for (const value of values) out.set(keys[i++], value);
          return now.typeclass.as_data(now.map.MapT, out);
        },
      ).value().value();
    };
  })(),
  repetitions: 50,
  note:
    "Same-current dictionary counterfactual; isolates one entry iterator versus two independent key/value iterators.",
});
const maybeInput = now.maybe.Maybe;
work.push({
  hill: 164,
  name: "compact-tuple-traversal-1k",
  old: () =>
    object_traverse(
      source,
      maybeInput,
      (x: number) => now.maybe.Just(x),
    ).value(),
  now: () =>
    tuple_traverse(
      source,
      maybeInput,
      (x: number) => now.maybe.Just(x),
    )
      .value(),
  repetitions: 10,
  note:
    "Same-current-dictionary counterfactual old object versus current tuple trees, including identical iterable flattening.",
});
pair(165, "array-some-missing-1k", (m) => {
  const v = m.array.ArrayT(source);
  return () => m.typeclasses.Foldable.some(v, (x: number) => x < 0);
}, 300);
pair(166, "array-product-6x4", (m) => {
  const args = Array.from({ length: 6 }, () => m.array.ArrayT([1, 2, 3, 4]));
  return () =>
    m.typeclasses.Applicative.lift(
      (...x: number[]) => x.reduce((a, b) => a + b, 0),
      ...args,
    ).value();
}, 10);
work.push({
  hill: 166,
  name: "array-product-preallocation-isolated-6x4",
  old: (() => {
    const args = Array.from(
      { length: 6 },
      () => now.array.ArrayT([1, 2, 3, 4]),
    );
    const rest = args.slice(1);
    const fn = (...x: number[]) => x.reduce((a, b) => a + b, 0);
    return () =>
      growing_product(
        fn as (...values: unknown[]) => number,
        args[0].value(),
        rest,
      ).value();
  })(),
  now: (() => {
    const args = Array.from(
      { length: 6 },
      () => now.array.ArrayT([1, 2, 3, 4]),
    );
    const rest = args.slice(1);
    const fn = (...x: number[]) => x.reduce((a, b) => a + b, 0);
    return () =>
      preallocated_product(
        fn as (...values: unknown[]) => number,
        args[0].value(),
        rest,
      ).value();
  })(),
  repetitions: 100,
  warmups: 50,
  note:
    "Same helper/dictionary with matched cardinality/overflow checks; only result storage allocation differs.",
});
work.push({
  hill: 167,
  name: "array-streaming-flatmap-1kx4",
  old: () =>
    now.array.ArrayT(source).bind((x: number) => now.array.ArrayT([x, x, x, x]))
      .value(),
  now: () =>
    now.array.flat_map_streaming(
      now.array.ArrayT(source),
      (x: number) => [x, x, x, x],
    ).value(),
  repetitions: 30,
  note:
    "Explicit streaming callback API versus current eager chunk-retaining bind.",
});
pair(
  168,
  "list-tail-rec-1k",
  (m) => () =>
    m.typeclasses.MonadRec.tail_rec_m(m.list.List, 0, (x: number) => {
      if (x < 1000) return m.list.from_array([m.loop.rec(x + 1)]);
      return m.list.from_array([m.loop.done(x)]);
    }).value(),
  10,
);
work.push({
  hill: 169,
  name: "list-concat-1kx1",
  old: (() => {
    const values = source.map((x) => now.list.from_array([x]));
    return () =>
      values.reduce((a: any, b: any) => a.concat(b), now.list.Nil()).value();
  })(),
  now: (() => {
    const values = source.map((x) => now.list.from_array([x]));
    return () => now.list.concat_many(values).value();
  })(),
  repetitions: 4,
  note: "Explicit linear concatenation versus repeated current concat.",
});
pair(170, "iterable-materialize-map-1k", (m) => {
  const v = m.iterable.from_array(source).map((x: number) => x + 1);
  return () => m.iterable.to_array(v);
}, 100);
pair(171, "iterable-counterless-map-filter-1k", (m) => {
  const v = m.iterable.from_array(source).map((x: number) => x + 1).filter((
    x: number,
  ) => x > 500);
  return () => m.iterable.to_array(v);
}, 100);
pair(172, "iterable-map-only-4x1k", (m) => {
  let v = m.iterable.from_array(source);
  for (let i = 0; i < 4; i++) v = v.map((x: number) => x + 1);
  return () => m.iterable.to_array(v);
}, 100);
function asyncSource(m: any) {
  return m.async_iterable.from_factory(async function* () {
    yield* source;
  });
}
work.push({
  hill: 173,
  name: "async-map-sync-4x1k",
  old: (() => {
    let v = asyncSource(now);
    for (let i = 0; i < 4; i++) v = v.map((x: number) => x + 1);
    return () => now.async_iterable.to_array(v);
  })(),
  now: (() => {
    let v = asyncSource(now);
    for (let i = 0; i < 4; i++) {
      v = now.async_iterable.map_sync(v, (x: number) => x + 1);
    }
    return () => now.async_iterable.to_array(v);
  })(),
  repetitions: 5,
});
work.push({
  hill: 174,
  name: "async-trusted-sync-source-filter-1k",
  old: (() => {
    const v = asyncSource(now).filter((x: number) => x % 100 === 0);
    return () => now.async_iterable.to_array(v);
  })(),
  now: (() => {
    const v = now.async_iterable.from_sync_factory(() => source).filter((
      x: number,
    ) => x % 100 === 0);
    return () => now.async_iterable.to_array(v);
  })(),
  repetitions: 10,
});
pair(
  [175, 178],
  "async-ordered-1k-cap64",
  (m) => () =>
    m.async_iterable.to_array(
      m.async_iterable.map_concurrent(asyncSource(m), 64, (x: number) => x + 1),
    ),
  3,
);
pair(
  [176, 177, 178],
  "async-unordered-1k-cap64",
  (m) => () =>
    m.async_iterable.to_array(
      m.async_iterable.map_concurrent_unordered(
        asyncSource(m),
        64,
        (x: number) => x + 1,
      ),
    ),
  3,
);
work.push({
  hill: 179,
  name: "async-chunks-10x100",
  old: () => now.async_iterable.to_array(asyncSource(now)),
  now: () =>
    now.async_iterable.to_array(
      now.async_iterable.from_chunks(async function* () {
        for (let i = 0; i < source.length; i += 100) {
          yield source.slice(i, i + 100);
        }
      }),
    ),
  repetitions: 10,
});
work.push({
  hill: 180,
  name: "iterable-filter-map-1k",
  old: (() => {
    const v = now.iterable.from_array(source).filter((x: number) => x % 2 === 0)
      .map((x: number) => x * 2);
    return () => now.iterable.to_array(v);
  })(),
  now: (() => {
    const v = now.iterable.filter_map(
      now.iterable.from_array(source),
      (x: number) => {
        if (x % 2 === 0) return now.maybe.Just(x * 2);
        return now.maybe.Nothing();
      },
    );
    return () => now.iterable.to_array(v);
  })(),
  repetitions: 100,
  note:
    "Maybe-returning primitive costs tagged-value allocation; single callback does not imply faster scalar pipelines.",
});
pair(193, "gen-bind-1k-production", (m) => {
  let v = m.quickcheck.constant(0);
  const r = m.quickcheck.integer({ min: 0, max: 100 });
  for (let i = 0; i < 1000; i++) {
    v = v.bind((x: number) => r.map((y: number) => x + y));
  }
  return () => m.quickcheck.run_gen(v, { seed: 123, size: 100 });
}, 10);
let gen_control_sha256: string | undefined;
if (Deno.args[1] !== undefined) {
  const original = await import(Deno.args[1]);
  const make = (q: any) => {
    let value = q.constant(0);
    const random = q.integer({ min: 0, max: 100 });
    for (let i = 0; i < 1000; i++) {
      value = value.bind((x: number) => random.map((y: number) => x + y));
    }
    return () => q.run_gen(value, { seed: 123, size: 100 });
  };
  work.push({
    hill: 193,
    name: "gen-registers-samecore-1k",
    old: make(original),
    now: make(now.quickcheck),
    warmups: 50,
    repetitions: 30,
    note:
      "Register implementation and original algorithm share identical current core modules; extra warmup and stable replay seed.",
  });
  gen_control_sha256 = await hash(new URL(Deno.args[1]).pathname);
  for (let seed = 0; seed < 32; seed++) {
    const make = (q: any) =>
      q.integer({ min: -100, max: 100 }).bind((x: number) =>
        q.integer({ min: -100, max: 100 }).map((y: number) => [x, y])
      );
    if (
      JSON.stringify(original.run_gen(make(original), { seed, size: 20 })) !==
        JSON.stringify(
          now.quickcheck.run_gen(make(now.quickcheck), { seed, size: 20 }),
        )
    ) throw new Error("Register candidate seed mismatch");
  }
}
pair(194, "gen-one-of-sample-1k", (m) => {
  const v = m.quickcheck.one_of([
    m.quickcheck.constant(1),
    m.quickcheck.constant(2),
  ]);
  return () => m.quickcheck.sample(v, { seed: 123, count: 1000 });
}, 10);
work.push({
  hill: 194,
  name: "gen-one-of-prebuilt-isolated-1k",
  old: (() => {
    const q = now.quickcheck;
    const choices = [q.constant(1), q.constant(2)];
    const value = q.generator((state: unknown) => {
      const [index, selected] = q.integer({ min: 0, max: choices.length - 1 })
        .value()(state);
      return choices[index].value()(selected);
    });
    return () => q.sample(value, { seed: 123, count: 1000 });
  })(),
  now: (() => {
    const q = now.quickcheck;
    const value = q.one_of([q.constant(1), q.constant(2)]);
    return () => q.sample(value, { seed: 123, count: 1000 });
  })(),
  warmups: 50,
  repetitions: 30,
  note: "Same-current Gen/core; recreating versus prebuilt integer selector.",
});
pair(195, "array-shrink-all-256", (m) => {
  const a = m.quickcheck.array_arbitrary(
    m.quickcheck.arbitrary(m.quickcheck.constant(0)),
  );
  const v = source.slice(0, 256);
  return () => [...a.shrink(v)];
}, 5);
pair(196, "unicode-shrink-all-256", (m) => {
  const a = m.quickcheck.string_arbitrary();
  const v = "a😀b𐐀".repeat(64);
  return () => [...a.shrink(v)];
}, 5);
work.push({
  hill: [175, 176],
  name: "queue-ring-versus-shift-100k-cap4096",
  old: () => {
    const queue = Array.from({ length: 4096 }, (_, i) => i);
    let sum = 0;
    for (let i = 0; i < 100000; i++) {
      sum += queue.shift()!;
      queue.push(i);
    }
    return sum;
  },
  now: () => {
    const queue = Array.from({ length: 4096 }, (_, i) => i);
    let head = 0, sum = 0;
    for (let i = 0; i < 100000; i++) {
      sum += queue[head];
      queue[head] = i;
      head = (head + 1) % 4096;
    }
    return sum;
  },
  repetitions: 5,
  note:
    "Isolated queue mechanism; production schedulers also contain changed cancellation/notification handling.",
});
for (let seed = 0; seed < 32; seed++) {
  const make = (m: any) => {
    const random = m.quickcheck.integer({ min: -100, max: 100 });
    return random.bind((x: number) =>
      m.quickcheck.generator((
        state: any,
      ) => [x, { seed: state.seed, size: state.size + 1 }])
    ).bind((x: number) => random.map((y: number) => [x, y]));
  };
  const state = { seed, size: 20 };
  if (
    JSON.stringify(old.quickcheck.run_gen(make(old), state)) !==
      JSON.stringify(now.quickcheck.run_gen(make(now), state))
  ) throw new Error(`Gen seed differential failed: ${seed}`);
}
for (const value of ["a😀b𐐀", "", "😀", "a\ud800b"]) {
  const before = [...old.quickcheck.string_arbitrary().shrink(value)];
  const after = [...now.quickcheck.string_arbitrary().shrink(value)];
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("Unicode shrinking sequence differential failed");
  }
}
const listener_counts: Record<string, number> = {};
for (const [name, m] of [["baseline", old], ["current", now]] as const) {
  for (const scheduler of ["map_concurrent", "map_concurrent_unordered"]) {
    const original = AbortSignal.prototype.addEventListener;
    let count = 0;
    AbortSignal.prototype.addEventListener = function (
      ...args: Parameters<typeof original>
    ) {
      if (args[0] === "abort") count++;
      return original.apply(this, args);
    };
    try {
      await m.async_iterable.to_array(
        m.async_iterable[scheduler](asyncSource(m), 64, (x: number) => x),
      );
    } finally {
      AbortSignal.prototype.addEventListener = original;
    }
    listener_counts[`${name}:${scheduler}`] = count;
  }
}
const median = (xs: number[]) =>
  xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)];
const results = [];
for (const w of work) {
  if (Deno.args[2] !== undefined && !w.name.includes(Deno.args[2])) continue;
  for (let i = 0; i < (w.warmups ?? 6); i++) {
    sink = await w.old();
    sink = await w.now();
  }
  const oldTimes: number[] = [], nowTimes: number[] = [];
  for (let block = 0; block < 7; block++) {
    const order = [0, 1];
    if (block % 2 === 1) order.reverse();
    for (const side of order) {
      const fn = [w.old, w.now][side];
      const start = performance.now();
      for (let i = 0; i < (w.repetitions ?? 50); i++) sink = await fn();
      const us = (performance.now() - start) * 1000 / (w.repetitions ?? 50);
      [oldTimes, nowTimes][side].push(us);
    }
  }
  const before = median(oldTimes), after = median(nowTimes);
  const result = {
    hill: w.hill,
    name: w.name,
    before_us: before,
    after_us: after,
    speedup: before / after,
    old_us: oldTimes,
    current_us: nowTimes,
    note: w.note,
  };
  results.push(result);
  console.log(
    JSON.stringify({
      hill: w.hill,
      name: w.name,
      before_us: before,
      after_us: after,
      speedup: before / after,
    }),
  );
}
const sourceFiles = [
  "array",
  "iterable",
  "async_iterable",
  "list",
  "map",
  "record",
  "quickcheck",
  "traversal",
  "typeclasses/applicative",
  "typeclasses/foldable",
  "typeclass",
  "data_value",
  "typeclasses",
  "identity",
  "maybe",
  "fn",
  "loop",
  "typeclasses/monad",
];
async function hash(path: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await Deno.readFile(path)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
const hashes = {} as Record<string, unknown>;
for (const root of [baseline, currentRoot]) {
  hashes[root] = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (
        name,
      ) => [name, await hash(`${root}/src/${name}.ts`)]),
    ),
  );
}
let output_suffix = "";
if (Deno.args[2] !== undefined) {
  output_suffix = "-" + Deno.args[2].replace(/[^a-z0-9-]/g, "");
}
await Deno.writeTextFile(
  `${currentRoot}/bench/artifacts/round3-collections${output_suffix}.json`,
  JSON.stringify(
    {
      baseline,
      version: Deno.version,
      workload_sha256: await hash(new URL(import.meta.url).pathname),
      source_sha256: hashes,
      experiment_sha256: Object.fromEntries(
        await Promise.all(
          ["round3_object_tree", "round3_tuple_tree", "round3_array_product"]
            .map(async (
              name,
            ) => [
              name,
              await hash(`${currentRoot}/bench/experiments/${name}.ts`),
            ]),
        ),
      ),
      listener_counts,
      gen_control_sha256,
      gen_seed_differential: 32,
      unicode_sequence_differential: 4,
      results,
      sink_type: typeof sink,
    },
    null,
    2,
  ) + "\n",
);

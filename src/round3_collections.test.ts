import { type As, data, type type_data, type type_item } from "./typeclass.ts";
import { assert_equals, assert_true } from "./assert.ts";
import * as Iter from "./iterable.ts";
import * as Async from "./async_iterable.ts";
import * as Arrays from "./array.ts";
import * as Lists from "./list.ts";
import * as Q from "./quickcheck.ts";
import { Just, Nothing } from "./maybe.ts";
import { Identity } from "./identity.ts";
import { Applicative, Foldable, Monad, MonadRec } from "./typeclasses.ts";
import { collect } from "./typeclasses/applicative.ts";
import { done, rec } from "./loop.ts";

Deno.test("compiled terminal replays, bounds demand, closes and propagates cleanup", () => {
  const events: number[] = [];
  let closed = 0;
  const source = Iter.from_factory(function* () {
    try {
      for (let i = 0; i < 10; i++) {
        events.push(i);
        yield i;
      }
    } finally {
      closed++;
    }
  }).map((x) => x + 1).filter((x) => x % 2 === 0).take(2);
  const fold = Iter.compile_fold(source);
  assert_equals(fold(0, (a, b) => a + b), 6);
  assert_equals(fold(0, (a, b) => a + b), 6);
  assert_equals(events, [0, 1, 2, 3, 0, 1, 2, 3]);
  assert_equals(closed, 2);
  assert_equals(Iter.compile_fold(source.take(0))(0, (a, b) => a + b), 0);
  assert_equals(closed, 2);
});

Deno.test("sized materialization observes array growth and filter-map fuses one callback", () => {
  const items = [1, 2];
  const source = Iter.from_array(items).map((x) => {
    if (x === 2) items.push(3);
    return x * 2;
  });
  assert_equals(Iter.to_array(source), [2, 4, 6]);
  const values = Iter.filter_map(Iter.from_array([1, 2, 3]), (x) => {
    if (x % 2 === 0) return Nothing<number>();
    return Just(x * 10);
  });
  assert_equals(Iter.to_array(values), [10, 30]);
  assert_equals(Iter.to_array(values), [10, 30]);
});

Deno.test("direct predicates close iterable resources without control tuples", () => {
  let closes = 0;
  const source = Iter.from_factory(function* () {
    try {
      yield undefined;
      yield 2;
      throw new Error("overread");
    } finally {
      closes++;
    }
  });
  assert_true(
    Foldable.some(source, (x) => x === undefined),
    "undefined can match",
  );
  assert_equals(Foldable.find(source, (x) => x === 2), 2);
  assert_equals(closes, 2);
});

Deno.test("collect reflects once and preserves symbols, holes and dangerous keys", () => {
  let reflections = 0;
  const symbol = Symbol("entry");
  const source = new Proxy({ a: Identity(1), [symbol]: Identity(2) }, {
    ownKeys(target) {
      reflections++;
      return Reflect.ownKeys(target);
    },
  });
  const result = collect(source).value();
  assert_equals(result.a, 1);
  assert_equals(result[symbol], 2);
  assert_equals(reflections, 1);
  const sparse: Identity<number>[] = [];
  sparse.length = 4;
  sparse[2] = Identity(7);
  const tuple = collect(Identity, sparse).value();
  assert_equals(tuple.length, 4);
  assert_true(!(0 in tuple), "holes survive");
  assert_equals(tuple[2], 7);
  const dangerous = Object.create(null);
  dangerous.__proto__ = Identity(9);
  assert_equals(
    Object.getOwnPropertyDescriptor(
      collect(Identity, dangerous).value(),
      "__proto__",
    )?.value,
    9,
  );
});

Deno.test("raw List recursion retains depth-first branching order and linear concatenation", () => {
  const result = MonadRec.tail_rec_m(Lists.List, 0, (x) => {
    if (x < 3) return Lists.from_array([rec(x + 1), done(x)]);
    return Lists.from_array([done(x)]);
  });
  assert_equals(Lists.to_array(result), [3, 2, 1, 0]);
  assert_equals(
    Lists.to_array(
      Lists.concat_many([
        Lists.from_array([1, 2]),
        Lists.Nil<number>(),
        Lists.from_array([3]),
      ]),
    ),
    [1, 2, 3],
  );
});

Deno.test("higher-arity array products handle empty dimensions and branch ordering", () => {
  const dims = [
    Arrays.ArrayT([1, 2]),
    Arrays.ArrayT([10]),
    Arrays.ArrayT([100]),
    Arrays.ArrayT([1000, 2000]),
  ] as const;
  assert_equals(
    Applicative.lift((a, b, c, d) => a + b + c + d, ...dims).value(),
    [1111, 2111, 1112, 2112],
  );
  assert_equals(
    Applicative.lift(
      (a: number, b: number, c: number, d: number) => a + b + c + d,
      Arrays.ArrayT([]),
      Arrays.ArrayT([1]),
      Arrays.ArrayT([1]),
      Arrays.ArrayT([1]),
    ).value(),
    [],
  );
  assert_equals(
    Arrays.flat_map_streaming(Arrays.ArrayT([1, 2]), function* (x) {
      yield x;
      yield x + 10;
    }).value(),
    [1, 11, 2, 12],
  );
});

Deno.test("trusted async stages skip then inspection while sync sources close exactly once", async () => {
  let closed = 0;
  const source = Async.from_sync_factory(function* () {
    try {
      yield 1;
      yield 2;
      yield 3;
    } finally {
      closed++;
    }
  });
  const mapped = Async.map_sync(
    source,
    (x) => ({
      value: x,
      get then(): undefined {
        throw new Error("then inspected");
      },
    }),
  );
  const scalar = Async.map_sync(mapped, (x) => x.value * 2).take(2);
  assert_equals(await Async.to_array(scalar), [2, 4]);
  assert_equals(closed, 1);
  assert_equals(
    await Async.to_array(Async.filter_map(source, (x) => {
      if (x === 2) return Nothing<number>();
      return Just(x * 3);
    })),
    [3, 9],
  );
  assert_equals(closed, 2);
});

Deno.test("async chunk materialization replays chunks and awaits promised items", async () => {
  let traversals = 0;
  const source = Async.from_chunks(async function* () {
    traversals++;
    yield [1, 2];
    yield [];
    yield [3];
  });
  assert_equals(await Async.to_array(source), [1, 2, 3]);
  assert_equals(await Async.to_array(source), [1, 2, 3]);
  assert_equals(traversals, 2);
  const promised = Async.from_chunks(async function* () {
    yield [Promise.resolve(1), Promise.resolve(2)];
  });
  assert_equals(await Async.to_array(promised), [1, 2]);
});

Deno.test("concurrent rings wrap with undefined values and observe completion order", async () => {
  const source = Async.from_sync_factory(() =>
    Array.from({ length: 100 }, (_, i) => i)
  );
  const ordered = await Async.to_array(Async.map_concurrent(source, 3, (x) => {
    if (x % 2 === 0) return undefined;
    return x;
  }));
  assert_equals(ordered.length, 100);
  assert_equals(ordered[0], undefined);
  assert_equals(ordered[99], 99);
  const unordered = await Async.to_array(
    Async.map_concurrent_unordered(source, 3, (x) => x),
  );
  assert_equals(
    unordered.slice().sort((a, b) => a - b),
    Array.from({ length: 100 }, (_, i) => i),
  );
});

Deno.test("Gen preserves random steps through custom boundaries and replay", () => {
  const random = Q.integer({ min: -10, max: 10 });
  const mixed = random.bind((x) =>
    Q.generator((state) =>
      [x, { seed: state.seed, size: state.size + 2 }] as const
    )
  ).bind((x) => random.map((y) => [x, y]));
  const state = { seed: 123, size: 10 };
  const [x, first] = Q.run_gen(random, state);
  const [y, last] = Q.run_gen(random, { ...first, size: first.size + 2 });
  assert_equals(Q.run_gen(mixed, state), [[x, y], last]);
  assert_equals(Q.run_gen(mixed, state), [[x, y], last]);
  assert_equals(state, { seed: 123, size: 10 });
});

Deno.test("Unicode shrinking retains code points and minimum length with aligned removals", () => {
  const arbitrary = Q.string_arbitrary({ min_length: 1 });
  const values = [...arbitrary.shrink("a😀b𐐀")];
  assert_equals(values[0], "a");
  assert_true(values.includes("ab𐐀"), "interior astral point can be removed");
  for (const value of values) {
    assert_true(Array.from(value).length >= 1, "minimum length");
    assert_true(value.isWellFormed(), "well-formed code points");
  }
});

Deno.test("array product overflow checks precede allocation and empty dimensions dominate", () => {
  const large = Arrays.ArrayT(new Array<number>(65536));
  const one = Arrays.ArrayT([1]);
  const empty = Arrays.ArrayT<number>([]);
  const fn = (a: number, b: number, c: number, d: number) => a + b + c + d;
  let error: unknown;
  try {
    Applicative.lift(fn, large, large, one, one);
  } catch (caught) {
    error = caught;
  }
  assert_true(
    error instanceof RangeError,
    "oversized products reject without traversing holes",
  );
  assert_equals(Applicative.lift(fn, large, large, one, empty).value(), []);
  const items = [1, 2];
  const live = Arrays.from_array_view(items);
  const result = Applicative.lift(
    (a, b, c, d) => {
      items.length = 1;
      return a + b + c + d;
    },
    live,
    one,
    one,
    one,
  ).value();
  assert_equals(result, [4]);
});

Deno.test("generic high-arity lift owns branch prefixes independently", () => {
  const branch_identity: unique symbol = Symbol("round3-branches");
  interface Lambda {
    readonly [type_item]: unknown;
    readonly [type_data]: readonly this[typeof type_item][];
  }
  interface Branches
    extends As<Lambda, typeof branch_identity>, Monad<Branches> {}
  const Branches = data<Branches>(branch_identity);
  Monad.derive(Branches)({
    pure(value) {
      return Branches([value]);
    },
    bind(fn) {
      const out = [];
      for (const item of this.value()) {
        for (const next of fn(item).value()) out.push(next);
      }
      return Branches(out);
    },
  });
  const run = () =>
    Applicative.lift(
      (a, b, c, d) => [a, b, c, d],
      Branches([1, 2]),
      Branches([10, 20]),
      Branches([100]),
      Branches([1000]),
    ).value();
  const expected = [
    [1, 10, 100, 1000],
    [1, 20, 100, 1000],
    [2, 10, 100, 1000],
    [2, 20, 100, 1000],
  ];
  assert_equals(run(), expected);
  assert_equals(run(), expected);
});

Deno.test("collect defines own properties even over inherited setters", () => {
  const key = Symbol("inherited setter");
  Object.defineProperty(Object.prototype, key, {
    set() {
      throw new Error("inherited setter called");
    },
    configurable: true,
  });
  try {
    const record = collect({ [key]: Identity(1) }).value();
    assert_equals(Object.getOwnPropertyDescriptor(record, key)?.value, 1);
    assert_equals(Object.getPrototypeOf(record), Object.prototype);
    const array: Identity<number>[] = [];
    Object.defineProperty(array, key, { value: Identity(2), enumerable: true });
    const result = collect(Identity, array).value();
    assert_equals(Object.getOwnPropertyDescriptor(result, key)?.value, 2);
    assert_equals(Object.getPrototypeOf(result), Array.prototype);
  } finally {
    Reflect.deleteProperty(Object.prototype, key);
  }
});

Deno.test("compiled terminal propagates normal iterator cleanup errors", () => {
  const cleanup = new Error("cleanup");
  const value = Iter.from_factory(function* () {
    try {
      yield 1;
      yield 2;
    } finally {
      // deno-lint-ignore no-unsafe-finally -- exercise failed iterator cleanup.
      throw cleanup;
    }
  }).map((x) => x + 1).filter(() => true).take(1);
  let caught: unknown;
  try {
    Iter.compile_fold(value)(0, (sum, x) => sum + x);
  } catch (error) {
    caught = error;
  }
  assert_true(
    caught === cleanup,
    "normal early exit must preserve failed cleanup",
  );
});

Deno.test("array generation draws length directly with the same integer validation and seeds", () => {
  const item = Q.integer({ min: -10, max: 10 });
  const value = Q.array_of(item, { min_length: 0, max_length: 4 });
  for (let seed = 0; seed < 32; seed++) {
    const state = { seed, size: 20 };
    const [length, length_state] = Q.run_gen(
      Q.integer({ min: 0, max: 4 }),
      state,
    );
    let next = length_state;
    const expected: number[] = [];
    for (let index = 0; index < length; index++) {
      const [value, state] = Q.run_gen(item, next);
      expected.push(value);
      next = state;
    }
    assert_equals(Q.run_gen(value, state), [expected, next]);
  }
  let failure: unknown;
  try {
    Q.run_gen(Q.array_of(item, { max_length: 4294967296 }), {
      seed: 1,
      size: 20,
    });
  } catch (error) {
    failure = error;
  }
  assert_true(
    failure instanceof RangeError,
    "array length still uses the integer range limit",
  );
});

Deno.test("size metadata stays flat through 10000 take stages and live array growth", () => {
  const items = [1, 2, 3];
  let value = Iter.from_array(items);
  for (let index = 0; index < 10000; index++) value = value.take(2);
  items.push(4);
  assert_equals(Iter.to_array(value), [1, 2]);
  assert_equals(Iter.to_array(value), [1, 2]);
});

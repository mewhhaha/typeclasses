import { assert_equals, assert_true as check_true } from "./assert.ts";
import { Applicative, Foldable, Traversable } from "./typeclasses.ts";
import { ArrayT, indexed } from "./array.ts";
import { from_array as list, to_array as list_array } from "./list.ts";
import { from_array, from_factory, take, to_array } from "./iterable.ts";
import * as Async from "./async_iterable.ts";
import * as Quick from "./quickcheck.ts";
import * as Maps from "./map.ts";
import * as Records from "./record.ts";
import * as Buffers from "./array_buffer.ts";
import * as Views from "./data_view.ts";
import * as Sets from "./set.ts";
import { Identity } from "./identity.ts";

Deno.test("round2 Gen executes 100000 mixed map/bind steps with threaded state", () => {
  let value = Quick.integer({ min: 1, max: 1 });
  for (let index = 0; index < 100_000; index += 1) {
    if (index % 2 === 0) value = value.map((item) => item + 1);
    else value = value.bind((item) => Quick.constant(item + 1));
  }
  const [result, state] = Quick.run_gen(value, { seed: 0, size: 1 });
  assert_equals(result, 100_001);
  assert_equals(
    state,
    Quick.run_gen(Quick.integer({ min: 1, max: 1 }), { seed: 0, size: 1 })[1],
  );
  assert_equals(Quick.run_gen(value, { seed: 0, size: 1 })[0], result);
});

Deno.test("round2 Cartesian products are stack safe at 10000 dimensions", async () => {
  // Exercise the runtime variadic hook beyond the public tuple inference budget.
  const count = 10_000;
  const arrays = Array.from({ length: count }, () => ArrayT([1]));
  const lists = Array.from({ length: count }, () => list([1]));
  const iterables = Array.from({ length: count }, () => from_array([1]));
  const asyncs = Array.from(
    { length: count },
    () =>
      Async.from_factory(async function* () {
        yield 1;
      }),
  );
  const run = Applicative.lift as (...args: unknown[]) => { value(): unknown };
  const sum = (...items: number[]) =>
    items.reduce((sum, item) => sum + item, 0);
  assert_equals(run(sum, ...arrays).value(), [count]);
  assert_equals(
    list_array(run(sum, ...lists) as ReturnType<typeof list<number>>),
    [count],
  );
  assert_equals(
    to_array(run(sum, ...iterables) as ReturnType<typeof from_array<number>>),
    [count],
  );
  assert_equals(
    await Async.to_array(
      run(sum, ...asyncs) as Async.AsyncIterableT<number>,
    ),
    [count],
  );
});

Deno.test("round2 shrinking finds interior and suffix witnesses", () => {
  const arbitrary = Quick.array_arbitrary(
    Quick.integer_arbitrary({ min: 0, max: 1 }),
  );
  const shrink = {
    ...arbitrary,
    generate: Quick.constant<readonly number[]>([0, 0, 0, 1]),
  };
  try {
    Quick.check({ arbitrary: shrink, property: (items) => !items.includes(1) });
    throw new Error("expected failure");
  } catch (error) {
    assert_true(error instanceof Quick.PropertyFailure);
    assert_equals(error.counterexample, [1]);
  }
  assert_true(
    [...arbitrary.shrink([0, 1, 0])].some((items) =>
      items.length === 2 && items[0] === 0 && items[1] === 0
    ),
  );
});

Deno.test("round2 map keys infer and survive map/traverse/fold", () => {
  const object = {};
  const symbol = Symbol();
  const map = Maps.MapT(
    new Map<object | symbol, number>([[object, 1], [symbol, 2]]),
  );
  const typed: ReadonlyMap<object | symbol, number> = map.map((item) =>
    item + 1
  ).value();
  assert_equals(typed.get(object), 2);
  const result = Traversable.traverse(
    map,
    Identity,
    (item) => Identity(item + 1),
  ).value();
  assert_equals(result.value().get(symbol), 3);
  assert_equals(
    Maps.fold_with_key(map, 0, (sum, item, key) => {
      assert_true(key === object || key === symbol);
      return sum + item;
    }),
    3,
  );
  const entries = Maps.from_entries([[1, "a"], [2, "b"]] as const);
  const inferred: ReadonlyMap<1 | 2, "a" | "b"> = entries.value();
  assert_equals(inferred.get(2), "b");
});

Deno.test("round2 record mapping and traversal retain dangerous own keys", () => {
  const value = Records.from_entries([["__proto__", 1], ["b", 2]]);
  const mapped = value.map((item) => item + 1);
  assert_true(Object.hasOwn(mapped.value(), "__proto__"));
  assert_equals(mapped.value()["__proto__"], 2);
  assert_equals(
    Records.fold_with_key(value, "", (sum, item, key) => sum + key + item),
    "__proto__1b2",
  );
  const traversed = Traversable.traverse(
    value,
    Identity,
    (item) => Identity(item + 2),
  ).value();
  assert_equals(Object.keys(traversed.value()), ["__proto__", "b"]);
  assert_equals(traversed.value()["__proto__"], 3);
  assert_equals(
    Records.RecordT({ b: 2, a: 1 }).compare(Records.RecordT({ a: 1, b: 2 })),
    "eq",
  );
});

Deno.test("round2 indexed arrays include sparse positions", () => {
  const items = new Array<number | undefined>(3);
  items[1] = 2;
  assert_equals(indexed(ArrayT(items)).value(), [[0, undefined], [1, 2], [
    2,
    undefined,
  ]]);
});

Deno.test("round2 binary copies isolate sources and DataView equality respects offsets", () => {
  const source = new Uint8Array([9, 1, 2, 9]);
  const view = Views.DataViewT(new DataView(source.buffer, 1, 2));
  source[1] = 7;
  assert_equals([...Views.to_bytes(view)], [1, 2]);
  assert_true(view.eq(Views.from_bytes([1, 2])));
  assert_true(!view.eq(Views.from_bytes([1, 3])));
  assert_equals([...Views.to_bytes(view.concat(Views.from_bytes([3])))], [
    1,
    2,
    3,
  ]);
  const bytes = Buffers.from_bytes(source);
  source[0] = 0;
  assert_equals([...Buffers.to_bytes(bytes)], [9, 7, 2, 9]);
  let visits = 0;
  const set = Sets.from_iterable({
    *[Symbol.iterator]() {
      visits += 1;
      yield 1;
      yield 1;
      yield 2;
    },
  });
  assert_equals(visits, 1);
  assert_equals([...set.value()], [1, 2]);
});

Deno.test("round2 cached iterable plans replay independently and direct folds close sources", () => {
  let closed = 0;
  const value = from_factory(function* () {
    try {
      yield* [1, 2, 3, 4];
    } finally {
      closed += 1;
    }
  })
    .map((item) => item * 2).filter((item) => item > 2).take(2);
  assert_equals(Foldable.fold(value, 0, (sum, item) => sum + item), 10);
  assert_equals(closed, 1);
  assert_equals(to_array(value), [4, 6]);
  assert_equals(Foldable.fold(value, 0, (sum, item) => sum + item), 10);
  assert_equals(closed, 3);
  assert_equals(Foldable.fold(value.take(0), 0, (sum, item) => sum + item), 0);
  assert_equals(closed, 3);
});

Deno.test("round2 iterative iterable Cartesian cleanup closes all active sources", () => {
  const events: number[] = [];
  const sources = Array.from(
    { length: 5 },
    (_, index) =>
      from_factory(function* () {
        try {
          yield 1;
          yield 2;
        } finally {
          events.push(index);
        }
      }),
  );
  const run = Applicative.lift as unknown as (
    ...args: unknown[]
  ) => ReturnType<typeof from_array<number>>;
  assert_equals(
    to_array(take(run((...items: number[]) => items.length, ...sources), 1)),
    [5],
  );
  assert_equals(events, [4, 3, 2, 1, 0]);
});

Deno.test("round2 async fused stages and short-circuit terminals close without read ahead", async () => {
  let pulled = 0;
  let closed = 0;
  const source = Async.from_factory(async function* () {
    try {
      for (const item of [1, 2, 3, 4]) {
        pulled += 1;
        yield item;
      }
    } finally {
      closed += 1;
    }
  });
  const fused = source.map((item) => item + 1).filter((item) =>
    Promise.resolve(item % 2 === 0)
  ).take(1);
  assert_equals(await Async.to_array(fused), [2]);
  assert_equals([pulled, closed], [1, 1]);
  assert_equals(await Async.to_array(fused), [2]);
  assert_equals(await Async.some(source, (item) => item === 2), true);
  assert_equals([pulled, closed], [4, 3]);
  assert_equals((await Async.find(source, (item) => item === 1)).value(), [
    "Just",
    1,
  ]);
  assert_equals(
    await Async.fold_while(source, 0, (sum, item) => ["Done", sum + item]),
    1,
  );
  assert_equals([pulled, closed], [6, 5]);
});

Deno.test("round2 unordered async map emits completion order with bounded demand and cleanup", async () => {
  let pulled = 0;
  let closed = false;
  let signal: AbortSignal | undefined;
  const resolve: ((value: number) => void)[] = [];
  const source = Async.from_factory(async function* () {
    try {
      for (let index = 0; index < 10; index += 1) {
        pulled += 1;
        yield index;
      }
    } finally {
      closed = true;
    }
  });
  const mapped = Async.map_concurrent_unordered(
    source,
    3,
    (_, index, shared) => {
      signal = shared;
      return new Promise<number>((done) => {
        resolve[index] = done;
      });
    },
  );
  const iterator = mapped.value()()[Symbol.asyncIterator]();
  const first = iterator.next();
  while (resolve.length < 3) await Promise.resolve();
  assert_equals(pulled, 3);
  resolve[2](2);
  assert_equals(await first, { done: false, value: 2 });
  assert_equals(pulled, 3);
  await iterator.return?.();
  assert_equals(closed, true);
  assert_equals(signal?.aborted, true);
  resolve[0](0);
  resolve[1](1);
});

function assert_true(value: unknown): asserts value {
  check_true(Boolean(value), "expected truthy value");
}

Deno.test("round2 unordered mapping does not block completed results behind a slow source read", async () => {
  let reads = 0;
  let closed = false;
  let finish_read: ((value: IteratorResult<number>) => void) | undefined;
  const source = Async.from_factory<number>(() => ({
    [Symbol.asyncIterator]() {
      return {
        next() {
          reads += 1;
          if (reads === 1) return Promise.resolve({ done: false, value: 1 });
          return new Promise<IteratorResult<number>>((resolve) => {
            finish_read = resolve;
          });
        },
        return() {
          closed = true;
          finish_read?.({ done: true, value: undefined });
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  }));
  const iterator = Async.map_concurrent_unordered(source, 2, (item) => item * 2)
    .value()()[Symbol.asyncIterator]();
  assert_equals(await iterator.next(), { done: false, value: 2 });
  await iterator.return?.();
  assert_equals(closed, true);
});

Deno.test("round2 unordered mapping observes later failures and pre-aborted signals", async () => {
  let closed = false;
  let sibling: AbortSignal | undefined;
  const error = new Error("later failure");
  const source = Async.from_factory(async function* () {
    try {
      yield 0;
      yield 1;
    } finally {
      closed = true;
    }
  });
  const mapped = Async.map_concurrent_unordered(
    source,
    2,
    (item, _, signal) => {
      sibling = signal;
      if (item === 0) return new Promise<number>(() => {});
      throw error;
    },
  );
  try {
    await Async.to_array(mapped);
    throw new Error("expected failure");
  } catch (failure) {
    assert_equals(failure, error);
  }
  assert_equals(closed, true);
  assert_equals(sibling?.aborted, true);
  let opened = false;
  const controller = new AbortController();
  controller.abort(error);
  const aborted = Async.map_concurrent_unordered(
    Async.from_factory(() => {
      opened = true;
      throw new Error("opened");
    }),
    1,
    (item) => item,
    { signal: controller.signal },
  );
  try {
    await Async.to_array(aborted);
    throw new Error("expected abort");
  } catch (failure) {
    assert_equals(failure, error);
  }
  assert_equals(opened, false);
});

Deno.test("round2 iterative products preserve callback failures while attempting every cleanup", async () => {
  const callback_error = new Error("callback");
  const cleanup_error = new Error("cleanup");
  const closed: number[] = [];
  const sync = Array.from({ length: 4 }, (_, index) =>
    from_factory(() => ({
      [Symbol.iterator]() {
        return {
          next() {
            return { done: false, value: 1 };
          },
          return() {
            closed.push(index);
            throw cleanup_error;
          },
        };
      },
    })));
  const run = Applicative.lift as unknown as (
    ...args: unknown[]
  ) => ReturnType<typeof from_array<number>>;
  try {
    to_array(run(() => {
      throw callback_error;
    }, ...sync));
    throw new Error("expected failure");
  } catch (error) {
    assert_equals(error, callback_error);
  }
  assert_equals(closed, [3, 2, 1, 0]);
  closed.length = 0;
  const asyncs = Array.from(
    { length: 4 },
    (_, index) =>
      Async.from_factory(() => ({
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.resolve({ done: false, value: 1 });
            },
            return() {
              closed.push(index);
              return Promise.reject(cleanup_error);
            },
          };
        },
      })),
  );
  const run_async = Applicative.lift as unknown as (
    ...args: unknown[]
  ) => Async.AsyncIterableT<number>;
  try {
    await Async.to_array(run_async(() => {
      throw callback_error;
    }, ...asyncs));
    throw new Error("expected failure");
  } catch (error) {
    assert_equals(error, callback_error);
  }
  assert_equals(closed, [3, 2, 1, 0]);
});

const concurrent_mappers = [
  ["ordered", Async.map_concurrent],
  ["unordered", Async.map_concurrent_unordered],
] as const;

for (const [mode, map] of concurrent_mappers) {
  Deno.test(`round2 ${mode} mapping preserves work and awaited cleanup failures`, async () => {
    const work = new Error("work");
    const cleanup = new Error("cleanup");
    const upstream = controlled_cleanup_source();
    let settled = false;
    const outcome = Async.to_array(
      map(upstream.source, 1, () => Promise.reject(work)),
    ).then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await upstream.cleanup_started;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert_equals(settled, false);
    assert_equals(upstream.close_count(), 1);
    upstream.fail_cleanup(cleanup);
    const error = await outcome;
    assert_true(error instanceof AggregateError);
    assert_equals(error.errors.length, 2);
    assert_true(error.errors[0] === work);
    assert_true(error.errors[1] === cleanup);
    assert_equals(upstream.close_count(), 1);
  });
}

Deno.test("round2 concurrent mapping preserves cancellation when awaited source cleanup fails", async () => {
  for (const [, map] of concurrent_mappers) {
    const cancellation = new Error("cancelled");
    const cleanup = new Error("cleanup");
    const upstream = controlled_cleanup_source();
    const controller = new AbortController();
    let mark_started = () => {};
    const started = new Promise<void>((resolve) => {
      mark_started = resolve;
    });
    let settled = false;
    const mapped = map(upstream.source, 1, () => {
      mark_started();
      return new Promise<number>(() => {});
    }, { signal: controller.signal });
    const outcome = Async.to_array(mapped).then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await started;
    controller.abort(cancellation);
    await upstream.cleanup_started;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert_equals(settled, false);
    assert_equals(upstream.close_count(), 1);
    upstream.fail_cleanup(cleanup);
    const error = await outcome;
    assert_true(error instanceof AggregateError);
    assert_equals(error.errors.length, 2);
    assert_true(error.errors[0] === cancellation);
    assert_true(error.errors[1] === cleanup);
    assert_equals(upstream.close_count(), 1);
  }
});

function controlled_cleanup_source() {
  let closes = 0;
  let mark_cleanup_started = () => {};
  const cleanup_started = new Promise<void>((resolve) => {
    mark_cleanup_started = resolve;
  });
  let reject_cleanup: ((error: unknown) => void) | undefined;
  const source = Async.from_factory<number>(() => ({
    [Symbol.asyncIterator]() {
      return {
        next() {
          return Promise.resolve({ done: false, value: 1 });
        },
        return() {
          closes += 1;
          mark_cleanup_started();
          return new Promise<IteratorResult<number>>((_resolve, reject) => {
            reject_cleanup = reject;
          });
        },
      };
    },
  }));
  return {
    source,
    cleanup_started,
    close_count: () => closes,
    fail_cleanup(error: unknown) {
      if (reject_cleanup === undefined) {
        throw new Error("cleanup has not started");
      }
      reject_cleanup(error);
    },
  };
}

import { assert_equals, assert_true } from "./assert.ts";
import { ArrayT, from_array_view, from_snapshot } from "./array.ts";
import {
  from_array as list_from_array,
  List,
  to_array as list_to_array,
} from "./list.ts";
import {
  from_array as iterable_from_array,
  from_factory,
  preview,
  to_array,
} from "./iterable.ts";
import {
  from_factory as async_from_factory,
  map_concurrent,
  preview as async_preview,
  to_array as async_to_array,
} from "./async_iterable.ts";
import { from_readable_stream, to_async_iterable } from "./readable_stream.ts";
import { Applicative, Foldable } from "./typeclasses.ts";
import { elem } from "./prelude.ts";
import { Identity } from "./identity.ts";
import { Just, Maybe, Nothing } from "./maybe.ts";
import { traverse_items, traverse_sequential } from "./traversal.ts";
import { from_map_view, from_snapshot as map_snapshot } from "./map.ts";
import {
  from_record_view,
  from_snapshot as record_snapshot,
} from "./record.ts";

Deno.test("fused stages retain callback order, stage-local limits and independent cursors", () => {
  const events: string[] = [];
  let closed = 0;
  const source = from_factory(function* () {
    try {
      yield* [1, 2, 3];
    } finally {
      closed += 1;
    }
  });
  const values = source.map((item) => {
    events.push("map:" + item);
    return item * 2;
  }).take(2).filter((item) => {
    events.push("filter:" + item);
    return item > 2;
  });
  assert_equals(to_array(values), [4]);
  assert_equals(events, ["map:1", "filter:2", "map:2", "filter:4"]);
  assert_equals(closed, 1);
  events.length = 0;
  const left = values.value()()[Symbol.iterator]();
  const right = values.value()()[Symbol.iterator]();
  assert_equals(left.next().value, 4);
  assert_equals(right.next().value, 4);
  left.return?.();
  right.return?.();
  assert_equals(closed, 3);
  let opened = false;
  const unopened = from_factory(function* () {
    opened = true;
    yield 1;
  });
  assert_equals(
    to_array(
      unopened.map(() => {
        throw new Error();
      }).take(0),
    ),
    [],
  );
  assert_equals(opened, false);
});

Deno.test("short-circuit folds close infinite sources and preserve callback failures", () => {
  let reads = 0;
  let closed = 0;
  const infinite = from_factory(function* () {
    try {
      while (true) yield reads++;
    } finally {
      closed += 1;
    }
  });
  assert_equals(Foldable.some(infinite, (item) => item === 2), true);
  assert_equals([reads, closed], [3, 1]);
  assert_equals(Foldable.find(infinite, (item) => item === 4), 4);
  assert_equals([reads, closed], [5, 2]);
  assert_equals(elem(6, infinite), true);
  assert_equals([reads, closed], [7, 3]);
  const failure = new Error("callback");
  let caught: unknown;
  try {
    Foldable.some(infinite, () => {
      throw failure;
    });
  } catch (error) {
    caught = error;
  }
  assert_true(caught === failure, "must preserve callback failure identity");
  assert_equals(closed, 4);
  const nested = Foldable.fold_while(ArrayT([1, 2]), 0, (state, item) => {
    const inner = Foldable.fold_while(ArrayT([3, 4]), 0, () => ["Done", 3]);
    return ["Done", state + item + inner];
  });
  assert_equals(nested, 4);
});

Deno.test("constructors expose explicit snapshot and live views", () => {
  const source = [1];
  const snapshot = from_snapshot(source);
  const view = from_array_view(source);
  source.push(2);
  assert_equals(snapshot.value(), [1]);
  assert_equals(view.value(), [1, 2]);
  const source_map = new Map([["one", 1]]);
  const map_copy = map_snapshot(source_map);
  const map_live = from_map_view(source_map);
  source_map.set("two", 2);
  assert_equals([...map_copy.value()], [["one", 1]]);
  assert_equals([...map_live.value()], [["one", 1], ["two", 2]]);
  const record = { count: 1 };
  const record_copy = record_snapshot(record);
  const record_live = from_record_view(record);
  record.count = 2;
  assert_equals(record_copy.value().count, 1);
  assert_equals(record_live.value().count, 2);
});

Deno.test("List builds map/bind once and append shares only the right tail", () => {
  const source = list_from_array([1, 2, 3]);
  const events: number[] = [];
  assert_equals(
    list_to_array(source.map((item) => {
      events.push(item);
      return item * 2;
    })),
    [2, 4, 6],
  );
  assert_equals(events, [1, 2, 3]);
  assert_equals(
    list_to_array(source.bind((item) => list_from_array([item, -item]))),
    [1, -1, 2, -2, 3, -3],
  );
  const right = list_from_array([4, 5]);
  let result = source.concat(right).value();
  for (let index = 0; index < 3; index += 1) {
    assert_true(result[0] === "Cons", "expected a copied left cell");
    if (result[0] === "Cons") result = result[2];
  }
  const right_raw = right.value();
  assert_true(
    result[0] === "Cons" && right_raw[0] === "Cons" &&
      result[2] === right_raw[2],
    "append must share the unchanged right suffix",
  );
  assert_equals(list_to_array(source), [1, 2, 3]);
  const large = list_from_array(
    Array.from({ length: 25_000 }, (_, index) => index),
  );
  assert_equals(
    large.map((item) => item + 1).fold(0, (count) => count + 1),
    25_000,
  );
});

Deno.test("high arity products preserve lexicographic order and empty inputs", async () => {
  const fn = (a: number, b: number, c: number, d: number) => [a, b, c, d];
  const expected = [[1, 3, 4, 5], [1, 3, 4, 6], [2, 3, 4, 5], [2, 3, 4, 6]];
  assert_equals(
    Applicative.lift(
      fn,
      ArrayT([1, 2]),
      ArrayT([3]),
      ArrayT([4]),
      ArrayT([5, 6]),
    ).value(),
    expected,
  );
  assert_equals(
    list_to_array(
      Applicative.lift(
        fn,
        list_from_array([1, 2]),
        list_from_array([3]),
        list_from_array([4]),
        list_from_array([5, 6]),
      ),
    ),
    expected,
  );
  assert_equals(
    to_array(
      Applicative.lift(
        fn,
        iterable_from_array([1, 2]),
        iterable_from_array([3]),
        iterable_from_array([4]),
        iterable_from_array([5, 6]),
      ),
    ),
    expected,
  );
  const ai = (items: number[]) =>
    async_from_factory(async function* () {
      yield* items;
    });
  assert_equals(
    await async_to_array(
      Applicative.lift(fn, ai([1, 2]), ai([3]), ai([4]), ai([5, 6])),
    ),
    expected,
  );
  assert_equals(
    Applicative.lift(fn, ArrayT([1]), ArrayT([]), ArrayT([4]), ArrayT([5]))
      .value(),
    [],
  );
});

Deno.test("Array dictionary treats sparse positions as explicit undefined values", () => {
  const sparse = Array<number | undefined>(3);
  sparse[1] = 2;
  const source = ArrayT(sparse);
  const seen: (number | undefined)[] = [];
  const mapped = source.map((item) => {
    seen.push(item);
    return item;
  }).value();
  assert_equals(seen, [undefined, 2, undefined]);
  assert_equals(Object.keys(mapped), ["0", "1", "2"]);
  assert_equals(source.bind((item) => ArrayT([item])).value(), mapped);
  assert_equals(
    source.fold([] as (number | undefined)[], (items, item) => {
      items.push(item);
      return items;
    }),
    mapped,
  );
  assert_equals(source.traverse(Identity, Identity).value().value(), mapped);
});

Deno.test("incremental traversal preserves order and branches independently", () => {
  const seen: number[] = [];
  const source = {
    *[Symbol.iterator]() {
      for (const item of [1, 2, 3, 4, 5]) {
        seen.push(item);
        yield item;
      }
    },
  };
  assert_equals(
    traverse_items(source, Identity, (item) => Identity(item * 2)).value(),
    [2, 4, 6, 8, 10],
  );
  assert_equals(seen, [1, 2, 3, 4, 5]);
  assert_equals(
    traverse_items([1, 2], ArrayT, (item) => ArrayT([item, -item])).value(),
    [[1, 2], [1, -2], [-1, 2], [-1, -2]],
  );
  assert_equals(List.pure(1).traverse(Identity, Identity).value().value(), [
    "Cons",
    1,
    ["Nil"],
  ]);
});

Deno.test("explicit sequential traversal avoids callbacks after Maybe failure", () => {
  const seen: number[] = [];
  const result = traverse_sequential([1, 2, 3], Maybe, (item) => {
    seen.push(item);
    if (item === 2) return Nothing<number>();
    return Just(item);
  });
  assert_equals(result.value(), ["Nothing"]);
  assert_equals(seen, [1, 2]);
  assert_equals(traverse_sequential([1, 2], Maybe, Just).value(), ["Just", [
    1,
    2,
  ]]);
});

Deno.test("bounded inspection terminates and closes infinite iterables", () => {
  let reads = 0;
  let closed = 0;
  const source = from_factory(function* () {
    try {
      while (true) yield reads++;
    } finally {
      closed += 1;
    }
  });
  assert_equals(preview(source, 3), [0, 1, 2]);
  assert_equals([reads, closed], [3, 1]);
  source.show();
  assert_equals([reads, closed], [103, 2]);
});

Deno.test("async filter/take await predicates, replay, validate and close upstream", async () => {
  let opened = 0;
  let closed = 0;
  const source = async_from_factory(async function* () {
    opened += 1;
    try {
      for (let item = 0;; item += 1) yield item;
    } finally {
      closed += 1;
    }
  });
  const mixed = async_from_factory<number | string>(async function* () {
    yield 1;
    yield "ok";
  });
  const narrowed = mixed.filter((item): item is string =>
    typeof item === "string"
  );
  assert_equals(
    await async_to_array(narrowed.map((item) => item.toUpperCase())),
    ["OK"],
  );
  const values = source.filter((item) => Promise.resolve(item % 2 === 1)).take(
    2,
  );
  assert_equals(await async_to_array(values), [1, 3]);
  assert_equals(await async_preview(values, 1), [1]);
  assert_equals([opened, closed], [2, 2]);
  assert_equals(await async_to_array(source.take(0)), []);
  assert_equals(opened, 2);
  let caught: unknown;
  try {
    source.take(-1);
  } catch (error) {
    caught = error;
  }
  assert_true(
    caught instanceof RangeError,
    "reject invalid async bounds eagerly",
  );
  let failed: unknown;
  const failure = new Error("async predicate");
  try {
    await async_to_array(source.filter(() => {
      throw failure;
    }));
  } catch (error) {
    failed = error;
  }
  assert_true(failed === failure, "async callback errors retain identity");
  assert_equals(closed, 3);
});

Deno.test("stream adapter cancels by default and supports preserving unread chunks", async () => {
  let canceled = 0;
  const stream = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
    },
    cancel() {
      canceled += 1;
    },
  });
  assert_equals(
    await async_to_array(
      to_async_iterable(from_readable_stream(stream)).take(1),
    ),
    [1],
  );
  assert_equals(canceled, 1);
  assert_equals(stream.locked, false);
  const preserved = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
      controller.close();
    },
    cancel() {
      canceled += 1;
    },
  });
  const adapter = to_async_iterable(from_readable_stream(preserved), {
    preventCancel: true,
  });
  assert_equals(await async_to_array(adapter.take(1)), [1]);
  assert_equals(preserved.locked, false);
  assert_equals(await async_to_array(adapter), [2]);
  assert_equals(canceled, 1);
  const failure = new Error("cancel failed");
  const broken = new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
    },
    cancel() {
      throw failure;
    },
  });
  let caught: unknown;
  try {
    await async_to_array(
      to_async_iterable(from_readable_stream(broken)).take(1),
    );
  } catch (error) {
    caught = error;
  }
  assert_true(caught === failure, "cancel failures propagate");
  assert_equals(broken.locked, false);
});

Deno.test("bounded async mapping caps admission, preserves order and aborts on exit", async () => {
  let pulled = 0;
  let closed = 0;
  let active = 0;
  let max_active = 0;
  const signals: AbortSignal[] = [];
  const source = async_from_factory(async function* () {
    try {
      while (true) yield pulled++;
    } finally {
      closed += 1;
    }
  });
  const releases: (() => void)[] = [];
  const values = map_concurrent(source, 3, (item, _index, signal) => {
    signals.push(signal);
    active += 1;
    max_active = Math.max(max_active, active);
    return new Promise<number>((resolve) => {
      releases[item] = () => {
        active -= 1;
        resolve(item * 2);
      };
    });
  });
  const iterator = values.value()()[Symbol.asyncIterator]();
  const first = iterator.next();
  while (releases.length < 3) await Promise.resolve();
  assert_equals(pulled, 3);
  releases[2]();
  releases[1]();
  releases[0]();
  assert_equals((await first).value, 0);
  assert_equals((await iterator.next()).value, 2);
  assert_equals(max_active, 3);
  releases[3]();
  await iterator.return?.();
  assert_equals(closed, 1);
  assert_true(
    signals.every((signal) => signal.aborted),
    "early exit aborts callbacks",
  );
});

Deno.test("bounded async mapping rejects sibling failures without waiting for earlier results", async () => {
  let closed = false;
  const source = async_from_factory(async function* () {
    try {
      yield 0;
      yield 1;
      yield 2;
    } finally {
      closed = true;
    }
  });
  const failure = new Error("sibling failed");
  let signal: AbortSignal | undefined;
  const values = map_concurrent(source, 2, (item, _index, current) => {
    signal = current;
    if (item === 1) throw failure;
    return new Promise<number>(() => {});
  });
  let caught: unknown;
  try {
    await async_to_array(values);
  } catch (error) {
    caught = error;
  }
  assert_true(
    caught === failure,
    "a failed sibling must fail the ordered traversal",
  );
  assert_equals(closed, true);
  assert_equals(signal?.aborted, true);
  const controller = new AbortController();
  controller.abort(failure);
  let opened = false;
  const unopened = async_from_factory(async function* () {
    opened = true;
    yield 1;
  });
  let rejected: unknown;
  try {
    await async_to_array(
      map_concurrent(unopened, 1, (item) => item, {
        signal: controller.signal,
      }),
    );
  } catch (error) {
    rejected = error;
  }
  assert_true(
    rejected === failure,
    "pre-aborted traversal must retain the abort reason",
  );
  assert_equals(opened, false);
});

Deno.test("short-circuit iterator cleanup failures propagate on normal exits", () => {
  const failure = new Error("cleanup failed");
  const source = from_factory(() => ({
    [Symbol.iterator]() {
      return {
        next() {
          return { done: false, value: 1 };
        },
        return(): IteratorResult<number> {
          throw failure;
        },
      };
    },
  }));
  let caught: unknown;
  try {
    Foldable.some(source, () => true);
  } catch (error) {
    caught = error;
  }
  assert_true(
    caught === failure,
    "a normal short-circuit exit must propagate iterator cleanup failure",
  );
});

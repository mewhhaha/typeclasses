import { assert_equals, assert_true } from "./assert.ts";
import {
  filter,
  from_array,
  from_factory,
  from_iterable,
  type IterableValue,
  take,
  to_array,
} from "./iterable.ts";

Deno.test("array iterable views replay current values while snapshots retain their input", () => {
  const items = [1, 2, 3];
  const view = from_array(items);
  const snapshot = from_iterable(items);
  assert_true(view.value()() === items, "the array view must reuse its source");
  const pipeline = view.filter((item) => item % 2 !== 0).map((item) =>
    item * 2
  );
  assert_equals(to_array(pipeline), [2, 6]);
  items[0] = 5;
  items.push(7);
  assert_equals(to_array(pipeline), [10, 6, 14]);
  assert_equals(to_array(snapshot), [1, 2, 3]);
});

Deno.test("lazy filtering and take do no work until consumed and never read past the limit", () => {
  let opened = 0;
  let closed = 0;
  const reads: number[] = [];
  const source = from_factory(function* () {
    opened += 1;
    try {
      for (let item = 1;; item += 1) {
        reads.push(item);
        yield item;
      }
    } finally {
      closed += 1;
    }
  });
  const pipeline = source.filter((item) => item % 2 === 0).take(2);
  assert_equals([opened, closed], [0, 0]);
  assert_equals(to_array(pipeline), [2, 4]);
  assert_equals(reads, [1, 2, 3, 4]);
  assert_equals([opened, closed], [1, 1]);
  assert_equals(pipeline.fold(0, (total, item) => total + item), 6);
  assert_equals([opened, closed], [2, 2]);
  assert_equals(to_array(take(source, 0)), []);
  assert_equals([opened, closed], [2, 2]);
  for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    let error: unknown;
    try {
      take(source, count);
    } catch (failure) {
      error = failure;
    }
    assert_true(
      error instanceof RangeError,
      "invalid bounds must fail eagerly",
    );
  }
  assert_equals([opened, closed], [2, 2]);
});

Deno.test("filter and take close upstream on consumer exits and callback failures", () => {
  let closed = 0;
  const source = from_factory(function* () {
    try {
      yield 1;
      yield 2;
      yield 3;
    } finally {
      closed += 1;
    }
  });
  for (const _item of source.filter(() => true).take(3).value()()) break;
  assert_equals(closed, 1);
  const failure = new Error("predicate failed");
  let caught: unknown;
  try {
    to_array(
      source.filter((item) => {
        if (item === 2) throw failure;
        return true;
      }).take(3),
    );
  } catch (error) {
    caught = error;
  }
  assert_true(caught === failure, "the original callback error must propagate");
  assert_equals(closed, 2);
});

Deno.test("iterable filters preserve type-guard narrowing through maps and bounds", () => {
  const values = from_array<number | string>([1, "two", 3, "four"]);
  const standalone: IterableValue<string> = filter(
    values,
    (item): item is string => typeof item === "string",
  );
  const fluent: IterableValue<string> = values.filter(
    (item): item is string => typeof item === "string",
  ).take(1);
  assert_equals(to_array(standalone.map((item) => item.length)), [3, 4]);
  assert_equals(to_array(fluent.map((item) => item.toUpperCase())), ["TWO"]);
});

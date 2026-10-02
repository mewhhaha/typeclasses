import { ArrayT } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";
import {
  AsyncIterableT,
  from_async_iterable,
  to_array as async_to_array,
} from "./async_iterable.ts";
import { Identity } from "./identity.ts";
import {
  from_iterable,
  IterableT,
  to_array as iterable_to_array,
} from "./iterable.ts";
import {
  from_array as list_from_array,
  to_array as list_to_array,
} from "./list.ts";
import { MapT } from "./map.ts";
import { Just, Maybe } from "./maybe.ts";
import { from_entries as record_from_entries, RecordT } from "./record.ts";
import { from_fn, Task } from "./task.ts";
import { Applicative, Traversable } from "./typeclasses.ts";
import { state } from "./state.ts";
import { reader } from "./reader.ts";
import { Writer } from "./writer.ts";

Deno.test("ArrayT maps unary callbacks consistently with List", () => {
  const input = ["1", "2", "3"];
  assert_equals(ArrayT(input).map(parseInt).value(), [1, 2, 3]);
  assert_equals(
    ArrayT(input).map(parseInt).value(),
    list_to_array(list_from_array(input).map(parseInt)),
  );
});

Deno.test("Record mapping preserves special own keys", () => {
  const value = record_from_entries([["__proto__", { count: 1 }], [
    "constructor",
    { count: 2 },
  ]]);
  const mapped = value.map((value) => value);
  assert_equals(Object.keys(mapped.value()), ["__proto__", "constructor"]);
  assert_equals(value.eq(mapped), true);
  assert_equals(Object.getPrototypeOf(mapped.value()), Object.prototype);
});

Deno.test("iterable equality closes both cursors on mismatch and thrown reads", () => {
  const closed: string[] = [];
  const source = (name: string, values: number[]) =>
    IterableT(function* () {
      try {
        yield* values;
      } finally {
        closed.push(name);
      }
    });
  assert_equals(source("left", [1, 2]).eq(source("right", [1, 3])), false);
  assert_equals(closed, ["left", "right"]);
  closed.length = 0;
  assert_equals(source("short", [1]).eq(source("long", [1, 2])), false);
  assert_equals(closed, ["short", "long"]);
  closed.length = 0;
  const broken = IterableT(function* () {
    try {
      yield 1;
      throw new Error("read failed");
    } finally {
      closed.push("broken");
    }
  });
  try {
    source("other", [1, 2]).eq(broken);
    throw new Error("expected read failure");
  } catch (error) {
    assert_equals((error as Error).message, "read failed");
  }
  assert_equals(closed, ["broken", "other"]);
});

Deno.test("async snapshots replay one-shot sources in Cartesian application", async () => {
  let reads = 0;
  const source = await from_async_iterable((async function* () {
    reads += 1;
    yield 1;
    yield 2;
  })());
  const functions = AsyncIterableT(async function* () {
    yield (value: number) => value + 10;
    yield (value: number) => value * 10;
  });
  const result = Applicative.ap(functions, source);
  assert_equals(await async_to_array(result), [11, 12, 10, 20]);
  assert_equals(await async_to_array(result), [11, 12, 10, 20]);
  assert_equals(reads, 1);
});

Deno.test("collection traversal preserves order and independent applicative branches", () => {
  const calls: number[] = [];
  const result = Traversable.traverse(ArrayT([1, 2, 3]), ArrayT, (value) => {
    calls.push(value);
    return ArrayT([value, -value]);
  });
  assert_equals(calls, [1, 2, 3]);
  assert_equals(result.value().map((value) => value.value()), [
    [1, 2, 3],
    [1, 2, -3],
    [1, -2, 3],
    [1, -2, -3],
    [-1, 2, 3],
    [-1, 2, -3],
    [-1, -2, 3],
    [-1, -2, -3],
  ]);
  assert_true(
    result.value()[0].value() !== result.value()[1].value(),
    "branches must own their materialized arrays",
  );
  const entries = [["a", 1], ["b", 2], ["__proto__", 3]] as const;
  const map = Traversable.traverse(
    MapT(new Map(entries)),
    Maybe,
    (value) => Just(value + 1),
  ).value();
  assert_equals(map[0], "Just");
  if (map[0] === "Just") {
    assert_equals([...map[1].value()], [["a", 2], ["b", 3], ["__proto__", 4]]);
  }
  const record = Traversable.traverse(
    record_from_entries(entries),
    Maybe,
    (value) => Just(value + 1),
  ).value();
  assert_equals(record[0], "Just");
  if (record[0] === "Just") {
    assert_equals(Object.entries(record[1].value()), [["a", 2], ["b", 3], [
      "__proto__",
      4,
    ]]);
  }
  assert_equals(
    Traversable.traverse(RecordT<number>({}), Identity, Identity).value()
      .value(),
    {},
  );
});

Deno.test("large traversals materialize strict and iterable collections without growing the stack", () => {
  const items = Array.from({ length: 20_000 }, (_, index) => index);
  const array = Traversable.traverse(ArrayT(items), Identity, Identity).value();
  const iterable = Traversable.traverse(
    from_iterable(items),
    Identity,
    Identity,
  ).value();
  const list = Traversable.traverse(list_from_array(items), Identity, Identity)
    .value();
  assert_equals(array.value(), items);
  assert_equals(iterable_to_array(iterable), items);
  assert_equals(iterable_to_array(iterable), items);
  assert_equals(list_to_array(list), items);
});

Deno.test("balanced traversal executes Tasks in input order on every run", async () => {
  const calls: number[] = [];
  const items = Array.from({ length: 10_000 }, (_, index) => index);
  const effect = Traversable.traverse(
    ArrayT(items),
    Task,
    (value) =>
      from_fn(() => {
        calls.push(value);
        return Promise.resolve(value + 1);
      }),
  );
  assert_equals((await effect.run()).value(), items.map((value) => value + 1));
  assert_equals(calls, items);
  calls.length = 0;
  assert_equals((await effect.run()).value(), items.map((value) => value + 1));
  assert_equals(calls, items);
});

Deno.test("iterable equality attempts both cleanups when one return throws", () => {
  const closed: string[] = [];
  const source = (name: string, value: number, fail: boolean) =>
    IterableT(() => ({
      [Symbol.iterator]() {
        return {
          next: () => ({ done: false as const, value }),
          return() {
            closed.push(name);
            if (fail) throw new Error("cleanup failed");
            return { done: true as const, value: undefined };
          },
        };
      },
    }));
  let failure: unknown;
  try {
    source("left", 1, true).eq(source("right", 2, false));
  } catch (error) {
    failure = error;
  }
  assert_equals((failure as Error).message, "cleanup failed");
  assert_equals(closed, ["left", "right"]);
});

Deno.test("iterable equality closes an acquired cursor when the other factory throws", () => {
  let closed = false;
  const left = IterableT(() => ({
    [Symbol.iterator]() {
      return {
        next: () => ({ done: false as const, value: 1 }),
        return() {
          closed = true;
          return { done: true as const, value: undefined };
        },
      };
    },
  }));
  const right = IterableT<number>(() => {
    throw new Error("factory failed");
  });
  let failure: unknown;
  try {
    left.eq(right);
  } catch (error) {
    failure = error;
  }
  assert_equals((failure as Error).message, "factory failed");
  assert_equals(closed, true);
});

Deno.test("balanced traversal preserves Reader, State, and Writer execution order", () => {
  const input = ArrayT([1, 2, 3]);
  const reads = reader<"collection-runtime-reader", number[]>();
  const read = Traversable.traverse(
    input,
    reads,
    (item) =>
      reads((environment) => {
        environment.push(item);
        return item + 1;
      }),
  );
  const calls: number[] = [];
  assert_equals(read.run(calls).value(), [2, 3, 4]);
  assert_equals(calls, [1, 2, 3]);

  const counter = state<"collection-runtime-state", number>();
  const counted = Traversable.traverse(
    input,
    counter,
    (item) => counter((current) => [item + current, current + 1]),
  );
  const [items, final] = counted.run(0);
  assert_equals(items.value(), [1, 3, 5]);
  assert_equals(final, 3);

  const log = Writer.with(ArrayT<number>([]));
  const written = Traversable.traverse(
    input,
    log,
    (item) => log([item + 1, ArrayT([item])]),
  );
  const [values, output] = written.value();
  assert_equals(values.value(), [2, 3, 4]);
  assert_equals(output.value(), [1, 2, 3]);
});

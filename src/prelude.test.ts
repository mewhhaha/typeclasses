import { ArrayT } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";
import {
  Either,
  either,
  from_left,
  from_right,
  hush,
  Left,
  note,
  Right,
} from "./either.ts";
import {
  from_maybe,
  Just,
  Maybe,
  maybe as maybe_eliminate,
  type MaybeValue,
  Nothing,
  to_either,
  to_nullable,
} from "./maybe.ts";
import {
  alt,
  ap,
  ap_first,
  ap_second,
  append,
  bind,
  compare,
  concat,
  elem,
  empty,
  eq,
  fmap,
  fold_map,
  foldl,
  gt,
  gte,
  guard,
  join,
  length,
  lift,
  lift_A,
  lift_A2,
  lift_A3,
  lift_A4,
  lift_A5,
  lt,
  lte,
  max,
  mconcat,
  mempty,
  min,
  product,
  pure,
  sequence,
  sequence_right,
  show,
  sum,
  throw_error,
  to_array,
  traverse,
  traverse_,
  unless,
  voided,
  when,
} from "./prelude.ts";
import { reader } from "./reader.ts";
import { state } from "./state.ts";
import { from_fn, Task } from "./task.ts";
import { Writer } from "./writer.ts";

Deno.test("prelude maps, applies, and binds with contextual inference", () => {
  const lifted: MaybeValue<number> = pure(Maybe, 42);
  const mapped: MaybeValue<string> = fmap(
    (value) => value.toFixed(1),
    Just(42),
  );
  const applied: MaybeValue<number> = ap(
    Just((value: number) => value + 1),
    Just(41),
  );
  const bound: MaybeValue<string> = bind(
    Just(42),
    (value) => Just(value.toString()),
  );

  assert_equals(lifted.value(), ["Just", 42] as const);
  assert_equals(mapped.value(), ["Just", "42.0"] as const);
  assert_equals(applied.value(), ["Just", 42] as const);
  assert_equals(bound.value(), ["Just", "42"] as const);
});

Deno.test("prelude lifts functions and folds values", () => {
  const one: MaybeValue<number> = lift_A((a) => a + 1, Just(1));
  const two: MaybeValue<number> = lift_A2((a, b) => a + b, Just(1), Just(2));
  const three: MaybeValue<number> = lift_A3(
    (a, b, c) => a + b + c,
    Just(1),
    Just(2),
    Just(3),
  );
  const four: MaybeValue<number> = lift_A4(
    (a, b, c, d) => a + b + c + d,
    Just(1),
    Just(2),
    Just(3),
    Just(4),
  );
  const five: MaybeValue<number> = lift_A5(
    (a, b, c, d, e) => a + b + c + d + e,
    Just(1),
    Just(2),
    Just(3),
    Just(4),
    Just(5),
  );
  const six: MaybeValue<
    readonly [number, string, boolean, bigint, null, undefined]
  > = lift(
    (a, b, c, d, e, f) => [a, b, c, d, e, f] as const,
    Just(1),
    Just("two"),
    Just(true),
    Just(4n),
    Just(null),
    Just(undefined),
  );

  assert_equals(one.value(), ["Just", 2] as const);
  assert_equals(two.value(), ["Just", 3] as const);
  assert_equals(three.value(), ["Just", 6] as const);
  assert_equals(four.value(), ["Just", 10] as const);
  assert_equals(five.value(), ["Just", 15] as const);
  assert_equals(
    six.value(),
    [
      "Just",
      [1, "two", true, 4n, null, undefined],
    ] as const,
  );
  assert_equals(
    foldl((sum, value) => sum + value, 0, ArrayT([1, 2, 3, 4])),
    10,
  );
});

Deno.test("prelude traverses with an explicit applicative dictionary", () => {
  const traversed = traverse(
    (value) => value > 0 ? Just(value * 2) : Nothing<number>(),
    Maybe,
    ArrayT([1, 2, 3]),
  );
  const sequenced = sequence(Maybe, ArrayT([Just(1), Just(2), Just(3)]));

  const [traversed_tag, traversed_array] = traversed.value();
  const [sequenced_tag, sequenced_array] = sequenced.value();

  assert_equals(traversed_tag, "Just" as const);
  assert_equals(traversed_array?.value(), [2, 4, 6]);
  assert_equals(sequenced_tag, "Just" as const);
  assert_equals(sequenced_array?.value(), [1, 2, 3]);
});

Deno.test("prelude exposes utility, ordering, and choice functions", () => {
  assert_equals(show(Just(42)), "Just(42)");
  assert_true(eq(Just(1), Just(1)), "equal values");
  assert_equals(compare(Just(1), Just(2)), "lt" as const);
  assert_true(lt(Just(1), Just(2)), "less than");
  assert_true(lte(Just(1), Just(1)), "less than or equal");
  assert_true(gt(Just(2), Just(1)), "greater than");
  assert_true(gte(Just(2), Just(2)), "greater than or equal");
  assert_equals(min(Just(1), Just(2)).value(), ["Just", 1] as const);
  assert_equals(max(Just(1), Just(2)).value(), ["Just", 2] as const);

  assert_equals(append(ArrayT([1]), ArrayT([2])).value(), [1, 2]);
  assert_equals(concat(ArrayT([1]), ArrayT([2])).value(), [1, 2]);
  assert_equals(mempty(ArrayT).value(), []);
  assert_equals(empty(Maybe).value(), ["Nothing"] as const);
  assert_equals(
    throw_error(Either, "missing").value(),
    [
      "Left",
      "missing",
    ] as const,
  );
  assert_equals(
    alt(Nothing<number>(), Just(42)).value(),
    ["Just", 42] as const,
  );
});

Deno.test("prelude sequences linear and multi-shot contexts", () => {
  assert_equals(join(Just(Just(42))).value(), ["Just", 42] as const);
  assert_equals(join(ArrayT([ArrayT([1, 2]), ArrayT([3])])).value(), [1, 2, 3]);
  assert_equals(voided(Just(42)).value(), ["Just", undefined] as const);
  assert_equals(voided(ArrayT([1, 2])).value(), [undefined, undefined]);
  assert_equals(
    when(Maybe, false, Just(undefined)).value(),
    ["Just", undefined] as const,
  );
  assert_equals(
    when(ArrayT, true, ArrayT([undefined, undefined])).value(),
    [undefined, undefined],
  );
  assert_equals(
    when(ArrayT, false, ArrayT([undefined, undefined])).value(),
    [undefined],
  );
  assert_equals(
    unless(Maybe, true, Just(undefined)).value(),
    ["Just", undefined] as const,
  );
  assert_equals(
    unless(ArrayT, false, ArrayT([undefined, undefined])).value(),
    [undefined, undefined],
  );
  assert_equals(guard(Maybe, false).value(), ["Nothing"] as const);
  assert_equals(guard(Maybe, true).value(), ["Just", undefined] as const);
  assert_equals(guard(ArrayT, false).value(), []);
  assert_equals(guard(ArrayT, true).value(), [undefined]);
  assert_equals(ap_first(Just(1), Just(2)).value(), ["Just", 1] as const);
  assert_equals(ap_first(ArrayT([1, 2]), ArrayT([3, 4])).value(), [1, 1, 2, 2]);
  assert_equals(ap_second(Just(1), Just(2)).value(), ["Just", 2] as const);
  assert_equals(ap_second(ArrayT([1, 2]), ArrayT([3, 4])).value(), [
    3,
    4,
    3,
    4,
  ]);
  assert_equals(sequence_right(Just(1), Just(2)).value(), ["Just", 2] as const);
  assert_equals(sequence_right(ArrayT([1, 2]), ArrayT([3, 4])).value(), [
    3,
    4,
    3,
    4,
  ]);
});

Deno.test("prelude folds and traverses linear and multi-shot contexts", () => {
  assert_equals(to_array(Just(2)), [2]);
  assert_equals(to_array(ArrayT([1, 2, 3])), [1, 2, 3]);
  assert_equals(length(Just(2)), 1);
  assert_equals(length(ArrayT([1, 2, 3])), 3);
  assert_equals(sum(ArrayT([1, 2, 3])), 6);
  assert_equals(sum(Just(3)), 3);
  assert_equals(product(ArrayT([2, 3, 4])), 24);
  assert_equals(product(Just(4)), 4);
  assert_true(elem(2, ArrayT([1, 2, 3])), "finds an array item");
  assert_true(elem(2, Just(2)), "finds a Maybe item");
  assert_true(
    elem(Maybe, Just(2), ArrayT([Just(1), Just(2)])),
    "uses an explicit Eq dictionary",
  );
  assert_equals(
    fold_map(ArrayT, (value: number) => ArrayT([value, value]), Just(2))
      .value(),
    [2, 2],
  );
  assert_equals(
    fold_map(ArrayT, (value: number) => ArrayT([value, value]), ArrayT([1, 2]))
      .value(),
    [1, 1, 2, 2],
  );
  assert_equals(
    mconcat(ArrayT, ArrayT([ArrayT([1]), ArrayT([2, 3])])).value(),
    [1, 2, 3],
  );
  assert_equals(mconcat(ArrayT, Just(ArrayT([1, 2]))).value(), [1, 2]);
  assert_equals(
    mconcat(Maybe, ArrayT([Nothing<number>(), Just(2), Just(3)])).value(),
    ["Just", 2] as const,
  );
  assert_equals(
    traverse_(
      Maybe,
      (value: number) => value > 0 ? Just(value) : Nothing<number>(),
      ArrayT([1, 2]),
    ).value(),
    ["Just", undefined] as const,
  );
  assert_equals(
    traverse_(
      Maybe,
      (value: number) => value > 0 ? Just(value) : Nothing<number>(),
      ArrayT([1, 0]),
    ).value(),
    ["Nothing"] as const,
  );
  assert_equals(
    traverse_(ArrayT, (value: number) => ArrayT([value, value + 10]), Just(1))
      .value(),
    [undefined, undefined],
  );
});

Deno.test("traverse_ runs large Task sequences in order on every execution", async () => {
  const items = Array.from({ length: 20_001 }, (_, index) => index);
  const constructed: number[] = [];
  const executed: number[] = [];
  const action = traverse_(Task, (item: number) => {
    constructed.push(item);
    return from_fn(() => {
      executed.push(item);
      return Promise.resolve(item);
    });
  }, ArrayT(items));

  assert_equals(constructed, items);
  assert_equals(executed, []);
  assert_equals(await action.run(), undefined);
  assert_equals(executed, items);
  executed.length = 0;
  assert_equals(await action.run(), undefined);
  assert_equals(executed, items);

  const failure = new Error("stop traversal");
  let completed = 0;
  const failing = traverse_(
    Task,
    (item: number) =>
      from_fn(() => {
        if (item === 10_000) return Promise.reject(failure);
        completed += 1;
        return Promise.resolve(item);
      }),
    ArrayT(items),
  );

  assert_equals(await failing.run().catch((error) => error), failure);
  assert_equals(completed, 10_000);
});

Deno.test("traverse_ preserves Reader, State, and Writer order across uneven groups", () => {
  const items = Array.from({ length: 20_001 }, (_, index) => index);
  const observations = reader<"prelude-traverse-reader", number[]>();
  const read = traverse_(
    observations,
    (item: number) => observations.asks((seen) => seen.push(item)),
    ArrayT(items),
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seen: number[] = [];
    assert_equals(read.run(seen), undefined);
    assert_equals(seen, items);
  }

  const position = state<"prelude-traverse-state", number>();
  const advance = traverse_(
    position,
    (item: number) =>
      position((current) => {
        assert_equals(current, item);
        return [item, current + 1];
      }),
    ArrayT(items),
  );

  assert_equals(advance.run(0), [undefined, items.length]);
  assert_equals(advance.run(0), [undefined, items.length]);

  const entries = ArrayT(items.slice(0, 11));
  const Audit = Writer.with(ArrayT<number>([]));
  const written = traverse_(
    Audit,
    (item: number) => Audit([item, ArrayT([item])]),
    entries,
  );
  assert_equals(written.value()[0], undefined);
  assert_equals(written.value()[1].value(), entries.value());
  assert_equals(written.value()[1].value(), entries.value());
});

Deno.test("traverse_ preserves branching cardinality and empty identities", () => {
  const counts = [2, 3, 2, 3, 2];
  const constructed: number[] = [];
  const branches = traverse_(ArrayT, (count: number) => {
    constructed.push(count);
    return ArrayT(Array.from({ length: count }, (_, index) => index));
  }, ArrayT(counts));

  assert_equals(constructed, counts);
  assert_equals(branches.value(), Array(72).fill(undefined));
  assert_equals(
    traverse_(ArrayT, (_item: number) => ArrayT([1, 2]), ArrayT<number>([]))
      .value(),
    [undefined],
  );
  assert_equals(
    traverse_(
      ArrayT,
      (count: number) => ArrayT(Array(count).fill(0)),
      ArrayT([
        2,
        0,
        3,
      ]),
    ).value(),
    [],
  );
});

Deno.test("when and unless accept void Tasks and skip inactive actions", async () => {
  let executions = 0;
  const action = from_fn(async (): Promise<void> => {
    await Promise.resolve();
    executions += 1;
  });

  assert_equals(await when(Task, false, action).run(), undefined);
  assert_equals(await unless(Task, true, action).run(), undefined);
  assert_equals(executions, 0);
  assert_equals(await when(Task, true, action).run(), undefined);
  assert_equals(await unless(Task, false, action).run(), undefined);
  assert_equals(executions, 2);

  const branches = ArrayT<void>([undefined, undefined]);
  assert_equals(when(ArrayT, true, branches).value(), [undefined, undefined]);
  assert_equals(unless(ArrayT, false, branches).value(), [
    undefined,
    undefined,
  ]);
  assert_equals(when(ArrayT, false, branches).value(), [undefined]);
  assert_equals(unless(ArrayT, true, branches).value(), [undefined]);
});

Deno.test("Maybe and Either eliminators preserve their success values", () => {
  assert_equals(from_maybe(0, Just(2)), 2);
  assert_equals(from_maybe(0, Nothing<number>()), 0);
  assert_equals(maybe_eliminate(0, (value: number) => value + 1, Just(2)), 3);
  assert_equals(
    maybe_eliminate(0, (value: number) => value + 1, Nothing<number>()),
    0,
  );
  assert_equals(to_nullable(Just(2)), 2);
  assert_equals(to_nullable(Nothing<number>()), null);
  assert_equals(to_either("missing", Just(2)).value(), ["Right", 2] as const);
  assert_equals(
    to_either("missing", Nothing<number>()).value(),
    ["Left", "missing"] as const,
  );
  assert_equals(
    either(
      (error: string) => error.length,
      (value: number) => value,
      Right<string, number>(2),
    ),
    2,
  );
  assert_equals(
    either(
      (error: string) => error.length,
      (value: number) => value,
      Left<string, number>("bad"),
    ),
    3,
  );
  assert_equals(from_left<number, string>(0, Left<number, string>(2)), 2);
  assert_equals(
    from_left("fallback", Right<string, number>(2)),
    "fallback",
  );
  assert_equals(from_right(0, Left<string, number>("bad")), 0);
  assert_equals(from_right(0, Right<string, number>(2)), 2);
  assert_equals(
    hush(Left<string, number>("bad")).value(),
    ["Nothing"] as const,
  );
  assert_equals(hush(Right<string, number>(2)).value(), ["Just", 2] as const);
  assert_equals(note("missing", Just(2)).value(), ["Right", 2] as const);
  assert_equals(
    note("missing", Nothing<number>()).value(),
    ["Left", "missing"] as const,
  );
});

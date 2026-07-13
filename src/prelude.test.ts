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

  assert_equals(one.value(), ["Just", 2] as const);
  assert_equals(two.value(), ["Just", 3] as const);
  assert_equals(three.value(), ["Just", 6] as const);
  assert_equals(four.value(), ["Just", 10] as const);
  assert_equals(five.value(), ["Just", 15] as const);
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

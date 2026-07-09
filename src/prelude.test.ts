import { ArrayT } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";
import { Either } from "./either.ts";
import { Just, Maybe, type MaybeValue, Nothing } from "./maybe.ts";
import {
  alt,
  ap,
  append,
  bind,
  compare,
  concat,
  empty,
  eq,
  fmap,
  foldl,
  gt,
  gte,
  liftA,
  liftA2,
  liftA3,
  liftA4,
  liftA5,
  lt,
  lte,
  max,
  mempty,
  min,
  pure,
  sequence,
  show,
  throwError,
  traverse,
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
  const one: MaybeValue<number> = liftA((a) => a + 1, Just(1));
  const two: MaybeValue<number> = liftA2((a, b) => a + b, Just(1), Just(2));
  const three: MaybeValue<number> = liftA3(
    (a, b, c) => a + b + c,
    Just(1),
    Just(2),
    Just(3),
  );
  const four: MaybeValue<number> = liftA4(
    (a, b, c, d) => a + b + c + d,
    Just(1),
    Just(2),
    Just(3),
    Just(4),
  );
  const five: MaybeValue<number> = liftA5(
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
    throwError(Either, "missing").value(),
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

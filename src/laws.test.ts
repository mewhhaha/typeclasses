import { ArrayT } from "./array.ts";
import { assert_equals, assert_true } from "./assert.ts";
import { Either } from "./either.ts";
import { from_array as List } from "./list.ts";
import { MapT } from "./map.ts";
import { Just, Nothing } from "./maybe.ts";
import { RecordT } from "./record.ts";
import { tuple } from "./tuple.ts";
import type { Ordering } from "./typeclasses.ts";
import { Validation } from "./validation.ts";

type OrderedValue<value> = {
  compare(right: value): Ordering;
  eq(right: value): boolean;
};

Deno.test("Ord equality agrees with Eq for references and special numbers", () => {
  const first_object = Just({ count: 1 });
  const second_object = Just({ count: 1 });
  const object_values = [first_object, second_object];
  const number_values = [
    Nothing<number>(),
    Just(Number.NEGATIVE_INFINITY),
    Just(-0),
    Just(0),
    Just(1),
    Just(Number.POSITIVE_INFINITY),
    Just(Number.NaN),
  ];

  assert_ord_laws(object_values);
  assert_ord_laws(number_values);
  assert_equals(first_object.eq(second_object), false);
  assert_true(
    first_object.compare(second_object) !== "eq",
    "distinct object references must not compare equal",
  );
  assert_equals(Just(Number.NaN).compare(Just(1)), "gt");
  assert_equals(Just(-0).compare(Just(0)), "lt");
});

Deno.test("container Ord instances preserve Eq coherence", () => {
  assert_ord_laws([
    ArrayT([Number.NaN]),
    ArrayT([1]),
    ArrayT([-0]),
    ArrayT([0]),
  ]);

  const first_object = { count: 1 };
  const second_object = { count: 1 };
  assert_ord_laws([
    ArrayT([first_object]),
    ArrayT([second_object]),
  ]);
});

Deno.test("representative Ord instances satisfy ordering laws", () => {
  const Strings = Either.with_left<string>();
  const Errors = Validation.with_semigroup<readonly string[]>({
    concat: (left, right) => [...left, ...right],
  });

  assert_ord_laws([
    Strings.Left<number>("missing"),
    Strings.Right(0),
    Strings.Right(1),
  ]);
  assert_ord_laws([List([]), List([0]), List([0, 1]), List([1])]);
  assert_ord_laws([tuple(0, 0), tuple(0, 1), tuple(1, 0)]);
  assert_ord_laws([
    RecordT({}),
    RecordT({ a: 0 }),
    RecordT({ a: 1 }),
    RecordT({ b: 0 }),
  ]);
  assert_ord_laws([
    Errors.Invalid<number>(["missing"]),
    Errors.Valid(0),
    Errors.Valid(1),
  ]);
});

Deno.test("Map Eq distinguishes a missing key from an undefined value", () => {
  const left = MapT(new Map([["left", undefined]]));
  const right = MapT(new Map([["right", undefined]]));

  assert_equals(left.eq(right), false);
});

function assert_ord_laws<value extends OrderedValue<value>>(
  values: readonly value[],
): void {
  for (const left of values) {
    assert_equals(left.compare(left), "eq");
    assert_equals(left.eq(left), true);

    for (const right of values) {
      const order = left.compare(right);
      const reverse = right.compare(left);

      assert_equals(order === "eq", left.eq(right));
      assert_equals(reverse, reverse_order(order));
    }
  }

  for (const left of values) {
    for (const middle of values) {
      for (const right of values) {
        if (left.compare(middle) === "gt") {
          continue;
        }

        if (middle.compare(right) === "gt") {
          continue;
        }

        assert_true(
          left.compare(right) !== "gt",
          "Ord must be transitive",
        );
      }
    }
  }
}

function reverse_order(order: Ordering): Ordering {
  switch (order) {
    case "lt":
      return "gt";
    case "eq":
      return "eq";
    case "gt":
      return "lt";
  }
}

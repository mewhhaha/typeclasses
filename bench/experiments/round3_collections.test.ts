import { assert_equals, assert_true } from "../../src/assert.ts";
import { ArrayT } from "../../src/array.ts";
import { type AsMaybe, Just, Maybe } from "../../src/maybe.ts";
import { traverse_items } from "./round3_tuple_tree.ts";
import { traverse_items as object_traverse } from "./round3_object_tree.ts";
import { preallocated_product } from "./round3_array_product.ts";

Deno.test("tuple and object traversal trees agree on uneven, empty and branching inputs", () => {
  const dictionary: AsMaybe = Maybe;
  for (const input of [[], [1], [1, 2, 3], [1, 2, 3, 4, 5]]) {
    assert_equals(
      traverse_items(input, dictionary, (x) => Just(x * 2)).value(),
      object_traverse(input, dictionary, (x) => Just(x * 2)).value(),
    );
    assert_equals(
      traverse_items(input, ArrayT, (x) => ArrayT([x, -x])).value(),
      object_traverse(input, ArrayT, (x) => ArrayT([x, -x])).value(),
    );
  }
});

Deno.test("preallocated product counterfactual retains branch order and rejects overflow", () => {
  const fn = (...values: unknown[]) =>
    values.reduce<number>((a, b) => a + Number(b), 0);
  assert_equals(
    preallocated_product(fn, [1, 2], [
      ArrayT([10]),
      ArrayT([100]),
      ArrayT([1000, 2000]),
    ]).value(),
    [1111, 2111, 1112, 2112],
  );
  assert_equals(
    preallocated_product(fn, [1], [ArrayT([]), ArrayT([100]), ArrayT([1000])])
      .value(),
    [],
  );
  assert_equals(
    preallocated_product(
      (...values) => values.length,
      [1],
      Array.from({ length: 9999 }, () => ArrayT([1])),
    ).value(),
    [10000],
  );
  let failure: unknown;
  try {
    preallocated_product(fn, new Array(65536), [
      ArrayT(new Array(65536)),
      ArrayT([1]),
      ArrayT([1]),
    ]);
  } catch (error) {
    failure = error;
  }
  assert_true(
    failure instanceof RangeError,
    "overflow is checked before iteration",
  );
});

import { ArrayT, to_array } from "../src/array.ts";
import { assert_equals } from "../src/assert.ts";
import {
  from_array as list_from_array,
  to_array as list_to_array,
} from "../src/list.ts";
import { Foldable, Monoid, Semigroup } from "../src/typeclasses.ts";

export function lesson_05_folds_and_monoids() {
  const numbers = list_from_array([1, 2, 3, 4]);
  const left = ArrayT(["learn"]);
  const right = ArrayT(["traits"]);
  const empty = Monoid.empty(ArrayT<string>([]));

  const total = Foldable.fold(numbers, 0, (state, item) => state + item);
  const combined = Semigroup.concat(left, right);
  const with_empty = Monoid.concat(empty, combined);

  assert_equals(total, 10);
  assert_equals(to_array(with_empty), ["learn", "traits"]);
  assert_equals(list_to_array(numbers), [1, 2, 3, 4]);
}

import { ArrayT, to_array } from "../src/array.ts";
import { assert_equals } from "../src/assert.ts";
import {
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "../src/iterable.ts";
import {
  from_array as list_from_array,
  to_array as list_to_array,
} from "../src/list.ts";

export function lesson_04_lists_and_laziness() {
  const array = ArrayT([1, 2, 3])
    .bind((value) => ArrayT([value, value * 10]));
  const list = list_from_array([1, 2, 3])
    .map((value) => value + 1);
  const lazy = iterable_from_factory(function* () {
    yield 1;
    yield 2;
    yield 3;
  })
    .map((value) => value + 1)
    .map((value) => value * 10);

  assert_equals(to_array(array), [1, 10, 2, 20, 3, 30]);
  assert_equals(list_to_array(list), [2, 3, 4]);
  assert_equals(iterable_to_array(lazy), [20, 30, 40]);
}

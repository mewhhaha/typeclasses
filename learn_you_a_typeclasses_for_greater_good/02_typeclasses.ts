import { assert_equals, assert_true } from "../src/assert.ts";
import { right } from "../src/either.ts";
import { label_values } from "../src/examples.ts";
import { Just } from "../src/maybe.ts";
import { Eq, Functor, Show } from "../src/typeclasses.ts";

export function lesson_02_typeclasses() {
  const maybe = Just(5);
  const either = right(5);

  const labeled_maybe = label_values(maybe);
  const labeled_either = label_values(either);
  const incremented = Functor.map(maybe, (value) => value + 1);

  assert_equals(Show.show(labeled_maybe), 'Just("value:5")');
  assert_equals(Show.show(labeled_either), 'Right("value:5")');
  assert_true(Eq.eq(incremented, Just(6)), "mapped Maybe should compare");
}

import { assert_equals } from "../src/assert.ts";
import { from_number, left, right } from "../src/either.ts";
import { just, nothing } from "../src/maybe.ts";
import { Show } from "../src/typeclasses.ts";

export function lesson_01_values_and_contexts() {
  const answer = just(41)
    .map((value) => value + 1);
  const missing = nothing<number>()
    .map((value) => value + 1);
  const parsed = from_number(Number.parseInt("42", 10));
  const failed = left("not a number");

  assert_equals(answer.value(), just(42).value());
  assert_equals(missing.value(), nothing().value());
  assert_equals(parsed.value(), right(42).value());
  assert_equals(failed.show(), 'Left("not a number")');
  assert_equals(Show.show(answer), "Just(42)");
}

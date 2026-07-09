import { assert_equals } from "../src/assert.ts";
import { from_number, Right } from "../src/either.ts";
import {
  from_array as list_from_array,
  to_array as list_to_array,
} from "../src/list.ts";
import { Just, Nothing } from "../src/maybe.ts";
import { Do } from "../src/typeclasses.ts";

export function lesson_08_monads_and_do() {
  const maybe = Do(function* () {
    const text = yield* Just("42");
    const value = yield* parse_int_maybe(text);

    return value + 1;
  });
  const either = Do(function* () {
    const text = yield* Right("41");
    const value = yield* from_number(Number.parseInt(text, 10));

    return value + 1;
  });
  const rejected = Do(function* () {
    const text = yield* Just("nope");
    const value = yield* parse_int_maybe(text);

    return value + 1;
  });
  const pairs = Do(function* () {
    const left = yield* list_from_array([1, 2]);
    const right = yield* list_from_array([10, 20]);

    return left + right;
  });

  assert_equals(maybe.value(), Just(43).value());
  assert_equals(either.value(), Right(42).value());
  assert_equals(rejected.value(), Nothing().value());
  assert_equals(list_to_array(pairs), [11, 21, 12, 22]);
}

function parse_int_maybe(text: string) {
  const value = Number.parseInt(text, 10);

  if (Number.isFinite(value)) {
    return Just(value);
  }

  return Nothing<number>();
}

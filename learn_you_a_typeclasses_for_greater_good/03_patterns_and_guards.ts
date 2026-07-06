import { assert_equals } from "../src/assert.ts";
import { type Either, is_left, is_right, left, right } from "../src/either.ts";
import {
  is_just,
  is_nothing,
  just,
  type Maybe,
  nothing,
} from "../src/maybe.ts";
import { match } from "../src/tagged.ts";

export function lesson_03_patterns_and_guards() {
  const reciprocal = safe_reciprocal(4);
  const rejected = safe_reciprocal(0);
  const parsed = parse_user_id("42");
  const parsed_value = parsed.value();

  if (is_right(parsed_value)) {
    assert_equals(parsed_value[1], 42);
  }

  if (is_left(parsed_value)) {
    throw new Error("expected a parsed user id");
  }

  assert_equals(describe_maybe(reciprocal.value()), "value 0.25");
  assert_equals(describe_maybe(rejected.value()), "missing");
  assert_equals(describe_either(parsed_value), "user 42");
}

function safe_reciprocal(value: number) {
  if (value === 0) {
    return nothing<number>();
  }

  return just(1 / value);
}

function parse_user_id(text: string) {
  const id = Number.parseInt(text, 10);

  if (Number.isInteger(id)) {
    return right(id);
  }

  return left<string, number>("invalid user id");
}

function describe_maybe(value: Maybe<number>): string {
  if (is_just(value)) {
    return "value " + value[1].toString();
  }

  if (is_nothing(value)) {
    return "missing";
  }

  throw new Error("unreachable Maybe variant");
}

function describe_either(value: Either<string, number>): string {
  return match(value, {
    left: (message) => "error " + message,
    right: (id) => "user " + id.toString(),
  });
}

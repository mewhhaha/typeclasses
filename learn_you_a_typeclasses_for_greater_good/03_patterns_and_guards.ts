import { assert_equals } from "../src/assert.ts";
import { type Either, Left, Right } from "../src/either.ts";
import { Just, type Maybe, Nothing } from "../src/maybe.ts";
import { match } from "../src/tagged.ts";

export function lesson_03_patterns_and_guards() {
  const reciprocal = safe_reciprocal(4);
  const rejected = safe_reciprocal(0);
  const parsed = parse_user_id("42");
  const parsed_value = parsed.value();

  if (Left.is(parsed_value)) {
    throw new Error("expected a parsed user id");
  }

  assert_equals(parsed_value[1], 42);
  assert_equals(describe_maybe(reciprocal.value()), "value 0.25");
  assert_equals(describe_maybe(rejected.value()), "missing");
  assert_equals(describe_either(parsed_value), "user 42");
}

function safe_reciprocal(value: number) {
  if (value === 0) {
    return Nothing<number>();
  }

  return Just(1 / value);
}

function parse_user_id(text: string) {
  const id = Number.parseInt(text, 10);

  if (Number.isInteger(id)) {
    return Right(id);
  }

  return Left<string, number>("invalid user id");
}

function describe_maybe(value: Maybe<number>): string {
  if (Nothing.is(value)) {
    return "missing";
  }

  return "value " + value[1].toString();
}

function describe_either(value: Either<string, number>): string {
  return match(value, {
    Left: (message) => "error " + message,
    Right: (id) => "user " + id.toString(),
  });
}

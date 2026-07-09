import { assert_equals } from "../src/assert.ts";
import { Just, Nothing } from "../src/maybe.ts";
import { Applicative } from "../src/typeclasses.ts";
import { InvalidMessages, Valid } from "../src/validation.ts";

type User = {
  readonly name: string;
  readonly age: number;
};

export function lesson_07_applicatives() {
  const sum = Applicative.lift(
    (left: number, right: number) => left + right,
    Just(20),
    Just(22),
  );
  const missing = Applicative.lift(
    (left: number, right: number) => left + right,
    Just(20),
    Nothing<number>(),
  );
  const user = Applicative.lift(
    make_user,
    Valid("Ada"),
    Valid(42),
  );
  const errors = Applicative.lift(
    make_user,
    InvalidMessages<string>("name is required"),
    InvalidMessages<number>("age is required"),
  );
  const [error_tag, messages] = errors.value();

  assert_equals(sum.value(), Just(42).value());
  assert_equals(missing.value(), Nothing().value());
  assert_equals(user.value()[0], "valid");
  assert_equals(error_tag, "invalid");
  assert_equals(messages, ["name is required", "age is required"]);
}

function make_user(name: string, age: number): User {
  return { name, age };
}

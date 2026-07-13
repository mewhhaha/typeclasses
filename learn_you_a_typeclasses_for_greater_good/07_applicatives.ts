import { assert_equals } from "../src/assert.ts";
import { Just, Nothing } from "../src/maybe.ts";
import { Applicative } from "../src/typeclasses.ts";
import { Invalid, InvalidMessages, Valid } from "../src/validation.ts";

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
  const user_result = user.value();
  const error_result = errors.value();

  if (Invalid.is(user_result)) {
    throw new Error("expected valid user");
  }

  if (Valid.is(error_result)) {
    throw new Error("expected accumulated validation errors");
  }

  assert_equals(sum.value(), Just(42).value());
  assert_equals(missing.value(), Nothing().value());
  assert_equals(user_result[1], { name: "Ada", age: 42 });
  assert_equals(error_result[1], ["name is required", "age is required"]);
}

function make_user(name: string, age: number): User {
  return { name, age };
}

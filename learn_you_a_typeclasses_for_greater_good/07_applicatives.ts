import { assert_equals } from "../src/assert.ts";
import { just, nothing } from "../src/maybe.ts";
import { Applicative } from "../src/typeclasses.ts";
import { invalid, valid } from "../src/validation.ts";

type User = {
  readonly name: string;
  readonly age: number;
};

export function lesson_07_applicatives() {
  const sum = Applicative.lift(
    (left: number, right: number) => left + right,
    just(20),
    just(22),
  );
  const missing = Applicative.lift(
    (left: number, right: number) => left + right,
    just(20),
    nothing<number>(),
  );
  const user = Applicative.lift(
    make_user,
    valid("Ada"),
    valid(42),
  );
  const errors = Applicative.lift(
    make_user,
    invalid<string>("name is required"),
    invalid<number>("age is required"),
  );
  const [error_tag, messages] = errors.value();

  assert_equals(sum.value(), just(42).value());
  assert_equals(missing.value(), nothing().value());
  assert_equals(user.value()[0], "valid");
  assert_equals(error_tag, "invalid");
  assert_equals(messages, ["name is required", "age is required"]);
}

function make_user(name: string, age: number): User {
  return { name, age };
}

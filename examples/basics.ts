import { from_array } from "../src/list.ts";
import { Just, type Maybe, Nothing } from "../src/maybe.ts";
import { type Either, from_number, Left, Right } from "../src/either.ts";
import {
  InvalidMessages as ValidationInvalidMessages,
  Valid as ValidationValid,
} from "../src/validation.ts";
import { from_fn } from "../src/task.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import { Applicative, Show } from "../src/typeclasses.ts";

export async function run_basic_examples() {
  const maybe = Just(21);
  const doubled_maybe = maybe.map((value) => {
    return value * 2;
  });
  const switched_maybe = describe_maybe(maybe.value());
  const switched_nothing = describe_maybe(Nothing<number>().value());

  const list = from_array([1, 2, 3]);
  const labeled_list = label_values(list);
  const either = Right("42")
    .bind((text) => from_number(Number.parseInt(text, 10)));
  const switched_left = describe_either(
    keep_positive(
      Right(-1),
      (value) => Left("negative: " + value.toString()),
    ).value(),
  );
  const switched_right = describe_either(either.value());

  const applicative_list = from_array([
    (value: number) => value + 1,
    (value: number) => value * 10,
  ])
    .ap(from_array([1, 2]));
  const generic_maybe_sum = add_values(Just(20), Just(22));
  const generic_list_sum = add_values(
    from_array([1, 10]),
    from_array([2, 20]),
  );
  const positive_either = keep_positive(
    Right(-1),
    (value) => Left("negative: " + value.toString()),
  );
  const fluent_maybe = Just((left: number) => {
    return (right: number) => left + right;
  })
    .ap(Just(20))
    .ap(Just(22));
  const fluent_either = Right("42")
    .bind((text) => from_number(Number.parseInt(text, 10)))
    .map((value) => value + 1);
  const fluent_list = from_array([1, 2, 3])
    .map((value) => value * 2);
  const optional_profile = Applicative.lift(
    (display_name, email) => ({ display_name, email }),
    Just("Ada"),
    Just("ada@example.test"),
  );
  const parsed_config = Applicative.lift(
    (host, port) => ({ host, port }),
    non_empty_string("localhost", "host"),
    from_number(Number.parseInt("8080", 10)),
  );
  const dice_scores = Applicative.lift(
    (die, bonus) => die + bonus,
    from_array([1, 2, 3]),
    from_array([0, 10]),
  );
  const parallel_task = Applicative.lift(
    (user, score) => user + ":" + score.toString(),
    from_fn(() => Promise.resolve("ada")),
    from_fn(() => Promise.resolve(42)),
  );
  const signup_validation = Applicative.lift(
    (username, email, password) => ({ username, email, password }),
    validate_username(""),
    validate_email("ada.example.test"),
    validate_password("short"),
  );

  console.log("maybe", doubled_maybe.show());
  console.log("maybe switch", switched_maybe);
  console.log("nothing switch", switched_nothing);
  console.log("list labels", Show.show(labeled_list));
  console.log("list sum", sum_values(list));
  console.log("either", either.show());
  console.log("applicative list", applicative_list.show());
  console.log("generic maybe sum", Show.show(generic_maybe_sum));
  console.log("generic list sum", Show.show(generic_list_sum));
  console.log("generic positive either", Show.show(positive_either));
  console.log("either switch left", switched_left);
  console.log("either switch right", switched_right);
  console.log("fluent maybe", fluent_maybe.show());
  console.log("fluent either", fluent_either.show());
  console.log("fluent list", fluent_list.show());
  console.log("lift optional profile", optional_profile.show());
  console.log("lift parsed config", parsed_config.show());
  console.log("lift dice scores", dice_scores.show());
  console.log("lift parallel task", await parallel_task.run());
  console.log("lift validation", signup_validation.show());
}

function describe_maybe(value: Maybe<number>) {
  const [tag, payload] = value;

  switch (tag) {
    case "Just":
      return "just:" + payload.toString();
    case "Nothing":
      return "Nothing";
  }
}

function describe_either(value: Either<unknown, number>) {
  const [tag, payload] = value;

  switch (tag) {
    case "Right":
      return "right:" + payload.toString();
    case "Left":
      return "left:" + String(payload);
  }
}

function non_empty_string(value: string, name: string) {
  if (value.length > 0) {
    return Right(value);
  }

  return Left<string, string>(name + " must not be empty");
}

function validate_username(value: string) {
  if (value.length > 0) {
    return ValidationValid(value);
  }

  return ValidationInvalidMessages<string>("username is required");
}

function validate_email(value: string) {
  if (value.includes("@")) {
    return ValidationValid(value);
  }

  return ValidationInvalidMessages<string>("email must contain @");
}

function validate_password(value: string) {
  const errors: string[] = [];

  if (value.length < 12) {
    errors.push("password must be at least 12 characters");
  }

  if (!/[0-9]/.test(value)) {
    errors.push("password must contain a number");
  }

  if (errors.length === 0) {
    return ValidationValid(value);
  }

  return ValidationInvalidMessages<string>(errors[0], ...errors.slice(1));
}

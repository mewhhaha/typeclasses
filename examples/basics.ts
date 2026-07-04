import { from_array } from "../src/list.ts";
import { is_none, is_some, none, type Option, some } from "../src/option.ts";
import {
  err,
  from_number,
  is_err,
  is_ok,
  ok,
  type Result,
} from "../src/result.ts";
import {
  invalid as validation_invalid,
  valid as validation_valid,
} from "../src/validation.ts";
import { from_fn } from "../src/task.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import { match } from "../src/tagged.ts";
import { Applicative, Format } from "../src/traits.ts";

export async function run_basic_examples() {
  const option = some(21);
  const doubled_option = option.map((value) => {
    return value * 2;
  });
  const guarded_option = describe_option(option.value());
  const matched_option = match(option.value(), {
    some(value) {
      return "some:" + value.toString();
    },
    none() {
      return "none";
    },
  });
  const matched_none = match(none<number>().value(), {
    some(value) {
      return "some:" + value.toString();
    },
    none() {
      return "none";
    },
  });

  const list = from_array([1, 2, 3]);
  const labeled_list = label_values(list);
  const result = ok("42")
    .bind((text) => from_number(Number.parseInt(text, 10)));
  const guarded_result = describe_result(
    keep_positive(
      ok(-1),
      (value) => err("negative: " + value.toString()),
    ).value(),
  );
  const matched_result = match(result.value(), {
    ok(value) {
      return "ok:" + value.toString();
    },
    err(message) {
      return "err:" + message;
    },
  });

  const applicative_list = from_array([
    (value: number) => value + 1,
    (value: number) => value * 10,
  ])
    .ap(from_array([1, 2]));
  const generic_option_sum = add_values(some(20), some(22));
  const generic_list_sum = add_values(
    from_array([1, 10]),
    from_array([2, 20]),
  );
  const positive_result = keep_positive(
    ok(-1),
    (value) => err("negative: " + value.toString()),
  );
  const fluent_option = some((left: number) => {
    return (right: number) => left + right;
  })
    .ap(some(20))
    .ap(some(22));
  const fluent_result = ok("42")
    .bind((text) => from_number(Number.parseInt(text, 10)))
    .map((value) => value + 1);
  const fluent_list = from_array([1, 2, 3])
    .map((value) => value * 2);
  const optional_profile = Applicative.lift(
    (display_name, email) => ({ display_name, email }),
    some("Ada"),
    some("ada@example.test"),
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

  console.log("option", doubled_option.fmt());
  console.log("option switch guards", guarded_option);
  console.log("option match", matched_option);
  console.log("none match", matched_none);
  console.log("list labels", Format.fmt(labeled_list));
  console.log("list sum", sum_values(list));
  console.log("result", result.fmt());
  console.log("applicative list", applicative_list.fmt());
  console.log("generic option sum", Format.fmt(generic_option_sum));
  console.log("generic list sum", Format.fmt(generic_list_sum));
  console.log("generic positive result", Format.fmt(positive_result));
  console.log("result switch guards", guarded_result);
  console.log("result match", matched_result);
  console.log("fluent option", fluent_option.fmt());
  console.log("fluent result", fluent_result.fmt());
  console.log("fluent list", fluent_list.fmt());
  console.log("lift optional profile", optional_profile.fmt());
  console.log("lift parsed config", parsed_config.fmt());
  console.log("lift dice scores", dice_scores.fmt());
  console.log("lift parallel task", await parallel_task.value()());
  console.log("lift validation", signup_validation.fmt());
}

function describe_option(value: Option<number>) {
  switch (true) {
    case is_some(value):
      return "some:" + value[1].toString();
    case is_none(value):
      return "none";
  }

  throw new Error("unreachable option variant");
}

function describe_result(value: Result<number, unknown>) {
  switch (true) {
    case is_ok(value):
      return "ok:" + value[1].toString();
    case is_err(value):
      return "err:" + String(value[1]);
  }

  throw new Error("unreachable result variant");
}

function non_empty_string(value: string, name: string) {
  if (value.length > 0) {
    return ok(value);
  }

  return err<string>(name + " must not be empty");
}

function validate_username(value: string) {
  if (value.length > 0) {
    return validation_valid(value);
  }

  return validation_invalid<string>("username is required");
}

function validate_email(value: string) {
  if (value.includes("@")) {
    return validation_valid(value);
  }

  return validation_invalid<string>("email must contain @");
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
    return validation_valid(value);
  }

  return validation_invalid<string>(errors[0], ...errors.slice(1));
}

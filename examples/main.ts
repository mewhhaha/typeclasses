import { from_array as array_from_array } from "../src/array.ts";
import { from_array, List, to_array } from "../src/list.ts";
import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "../src/map.ts";
import { some } from "../src/option.ts";
import {
  from_entries as record_from_entries,
  to_record as record_to_record,
} from "../src/record.ts";
import { err, from_number, ok } from "../src/result.ts";
import { from_fn, run } from "../src/task.ts";
import {
  invalid as validation_invalid,
  valid as validation_valid,
} from "../src/validation.ts";
import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../src/trait.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import {
  Alternative,
  Applicative,
  Do,
  Format,
  Traversable,
} from "../src/traits.ts";

const size_trait = Symbol("Size");

interface Size<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof size_trait,
    {
      size: <item>(this: Value<dictionary, item>) => number;
    }
  > {}

const Size = define_trait(size_trait, {
  size<
    dictionary extends Size<dictionary>,
    item,
  >(value: Value<dictionary, item>) {
    return call_trait_method(this.implementation(value).size<item>, value);
  },
});

declare module "../src/list.ts" {
  interface AsList extends Size<AsList> {}
}

Size.implement(List)({
  size() {
    return to_array(this).length;
  },
});

const option = some(21);
const doubled_option = option.map((value) => {
  return value * 2;
});

const list = from_array([1, 2, 3]);
const sized_list = List(list.value());
const labeled_list = label_values(list);

const result = ok("42")
  .bind((text) => from_number(Number.parseInt(text, 10)));

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
const array_monad = array_from_array([1, 2, 3])
  .bind((value) => array_from_array([value, value * 10]));
const array_alternative = Alternative.alt(
  array_from_array([1]),
  array_from_array([2, 3]),
);
const mapped_map = map_from_entries<number>([["left", 1], ["right", 2]])
  .map((value) => "value:" + value.toString());
const mapped_record = record_from_entries<number>([["x", 4], ["y", 5]])
  .map((value) => value * 2);
const traversed_record = Traversable.traverse(
  record_from_entries<number>([["id", 42], ["limit", 10]]),
  ok(undefined),
  (value) => {
    if (value > 0) {
      return ok(value.toString());
    }

    return err<string>("expected positive value");
  },
).map((record) => record_to_record(record));
const decoded_account = decode_account_payload({
  account: { id: "42", active: true },
});
const task_result = Do(function* () {
  const text = yield* from_fn(() => Promise.resolve("42"));
  const value = yield* from_fn(() => {
    return Promise.resolve(Number.parseInt(text, 10));
  });

  return value + 1;
});

console.log("option", doubled_option.fmt());
console.log("list labels", Format.fmt(labeled_list));
console.log("list sum", sum_values(list));
console.log("custom trait list size", Size.size(sized_list));
console.log("custom fluent list size", sized_list.size());
console.log("result", result.fmt());
console.log("applicative list", applicative_list.fmt());
console.log("generic option sum", Format.fmt(generic_option_sum));
console.log("generic list sum", Format.fmt(generic_list_sum));
console.log("generic positive result", Format.fmt(positive_result));
console.log("fluent option", fluent_option.fmt());
console.log("fluent result", fluent_result.fmt());
console.log("fluent list", fluent_list.fmt());
console.log("lift optional profile", optional_profile.fmt());
console.log("lift parsed config", parsed_config.fmt());
console.log("lift dice scores", dice_scores.fmt());
console.log("lift parallel task", await run(parallel_task));
console.log("lift validation", signup_validation.fmt());
console.log("array monad", array_monad.fmt());
console.log("array alternative", Format.fmt(array_alternative));
console.log("map functor", Deno.inspect(map_to_record(mapped_map)));
console.log("record functor", Deno.inspect(record_to_record(mapped_record)));
console.log("record traverse result", traversed_record.fmt());
console.log("decoded account", decoded_account.fmt());
console.log("task Do result", await run(task_result));

function decode_account_payload(input: unknown) {
  return Do(function* () {
    const root = yield* object_value(input, "payload");
    const account_value = yield* field(root, "account");
    const account = yield* object_value(account_value, "account");
    const id_value = yield* field(account, "id");
    const active_value = yield* field(account, "active");
    const id_text = yield* string_value(id_value, "account.id");
    const active = yield* boolean_value(active_value, "account.active");
    const id = yield* from_number(Number.parseInt(id_text, 10));

    yield* require_true(active, "account must be active");

    return { id, label: "account:" + id.toString() };
  });
}

function object_value(value: unknown, name: string) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return ok(value as Record<string, unknown>);
  }

  return err<Record<string, unknown>>(name + " must be an object");
}

function field(record: Record<string, unknown>, name: string) {
  if (Object.hasOwn(record, name)) {
    return ok(record[name]);
  }

  return err<unknown>(name + " is missing");
}

function string_value(value: unknown, name: string) {
  if (typeof value === "string") {
    return ok(value);
  }

  return err<string>(name + " must be a string");
}

function boolean_value(value: unknown, name: string) {
  if (typeof value === "boolean") {
    return ok(value);
  }

  return err<boolean>(name + " must be a boolean");
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

function require_true(value: boolean, message: string) {
  if (value) {
    return ok(undefined);
  }

  return err<void>(message);
}

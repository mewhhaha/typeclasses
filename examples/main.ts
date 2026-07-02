import { from_array } from "../src/list.ts";
import { some } from "../src/option.ts";
import { err, from_number, ok } from "../src/result.ts";
import { from_fn, run } from "../src/task.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "../src/examples.ts";
import { Format, perform } from "../src/traits.ts";

const option = some(21);
const doubled_option = option.map((value: number) => {
  return value * 2;
});

const list = from_array([1, 2, 3]);
const labeled_list = label_values(list);

const result = ok("42")
  .bind((text: string) => from_number(Number.parseInt(text, 10)));

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
const decoded_account = decode_account_payload({
  account: { id: "42", active: true },
});
const task_result = perform(function* () {
  const text = yield* from_fn(async () => "42");
  const value = yield* from_fn(async () => Number.parseInt(text, 10));

  return value + 1;
});

console.log("option", doubled_option.fmt());
console.log("list labels", Format.fmt(labeled_list));
console.log("list sum", sum_values(list));
console.log("result", result.fmt());
console.log("applicative list", applicative_list.fmt());
console.log("generic option sum", Format.fmt(generic_option_sum));
console.log("generic list sum", Format.fmt(generic_list_sum));
console.log("generic positive result", Format.fmt(positive_result));
console.log("fluent option", fluent_option.fmt());
console.log("fluent result", fluent_result.fmt());
console.log("fluent list", fluent_list.fmt());
console.log("decoded account", decoded_account.fmt());
console.log("task perform result", await run(task_result));

function decode_account_payload(input: unknown) {
  return perform(function* () {
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

function require_true(value: boolean, message: string) {
  if (value) {
    return ok(undefined);
  }

  return err<void>(message);
}

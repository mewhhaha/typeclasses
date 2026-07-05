import { from_array as array_from_array } from "../src/array.ts";
import { ask, asks, local } from "../src/reader.ts";
import { err, from_number, ok } from "../src/result.ts";
import { exec_state, get, gets, modify } from "../src/state.ts";
import {
  atomically,
  modify_tvar,
  new_tvar,
  read_tvar,
  write_tvar,
} from "../src/stm.ts";
import { from_fn } from "../src/task.ts";
import { Do } from "../src/traits.ts";

export async function run_monad_examples() {
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
  const reader_endpoint = Do(function* () {
    const config = yield* ask<AppConfig>();
    const base = yield* asks<AppConfig, string>((environment) => {
      return environment.host + ":" + environment.port.toString();
    });
    const path = yield* local(
      asks<{ readonly path: string }, string>((environment) => {
        return environment.path;
      }),
      (environment: AppConfig) => ({ path: environment.path }),
    );

    return base + path + "?host=" + config.host;
  });
  const state_counter = Do(function* () {
    const before = yield* get<number>();

    yield* modify((value: number) => value + 1);
    yield* modify((value: number) => value * 2);

    const after = yield* gets((value: number) => value);

    return { before, after };
  });
  const [state_counter_result] = state_counter.run(20);
  const checking_balance = new_tvar(40);
  const savings_balance = new_tvar(2);
  const transfer_result = atomically(Do(function* () {
    const checking = yield* read_tvar(checking_balance);

    yield* write_tvar(checking_balance, checking - 5);
    yield* modify_tvar(savings_balance, (value) => value + 5);

    const checking_after = yield* read_tvar(checking_balance);
    const savings_after = yield* read_tvar(savings_balance);

    return checking_after + savings_after;
  }));

  console.log("decoded account", decoded_account.fmt());
  console.log("task Do result", await task_result.run());
  console.log(
    "reader endpoint",
    reader_endpoint.run({
      host: "localhost",
      port: 8080,
      path: "/users",
    }),
  );
  console.log(
    "state counter",
    state_counter_result,
    exec_state(state_counter, 20),
  );
  console.log("stm transfer total", transfer_result);
  console.log(
    "array Do",
    array_from_array([1, 2]).bind((value) => array_from_array([value * 10]))
      .fmt(),
  );
}

type AppConfig = {
  readonly host: string;
  readonly port: number;
  readonly path: string;
};

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

function require_true(value: boolean, message: string) {
  if (value) {
    return ok(undefined);
  }

  return err<void>(message);
}

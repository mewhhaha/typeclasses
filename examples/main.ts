import {
  type AsArray,
  from_array as array_from_array,
  to_array as array_to_array,
} from "../src/array.ts";
import { from_bytes as array_buffer_from_bytes } from "../src/array_buffer.ts";
import {
  from_factory as async_iterable_from_factory,
  to_array as async_iterable_to_array,
} from "../src/async_iterable.ts";
import { from_bytes as data_view_from_bytes } from "../src/data_view.ts";
import { from_date } from "../src/date.ts";
import { from_error } from "../src/error.ts";
import {
  from_entries as form_data_from_entries,
  to_entries as form_data_to_entries,
} from "../src/form_data.ts";
import {
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "../src/iterable.ts";
import { from_array, List, to_array } from "../src/list.ts";
import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "../src/map.ts";
import { is_none, is_some, none, type Option, some } from "../src/option.ts";
import { ask, asks, type AsReader, local, run_reader } from "../src/reader.ts";
import {
  from_entries as record_from_entries,
  to_record as record_to_record,
} from "../src/record.ts";
import {
  from_readable_stream,
  to_async_iterable as readable_stream_to_async_iterable,
} from "../src/readable_stream.ts";
import { from_regexp } from "../src/regexp.ts";
import {
  err,
  from_number,
  is_err,
  is_ok,
  ok,
  type Result,
} from "../src/result.ts";
import {
  from_iterable as set_from_iterable,
  to_set as set_to_set,
} from "../src/set.ts";
import {
  type AsState,
  exec_state,
  get,
  gets,
  modify,
  run_state,
} from "../src/state.ts";
import {
  atomically,
  modify_tvar,
  new_tvar,
  read_tvar,
  write_tvar,
} from "../src/stm.ts";
import { type AsTask, from_fn, run } from "../src/task.ts";
import { from_typed_array } from "../src/typed_array.ts";
import {
  from_entries as url_params_from_entries,
  to_entries as url_params_to_entries,
} from "../src/url_search_params.ts";
import {
  invalid as validation_invalid,
  valid as validation_valid,
} from "../src/validation.ts";
import { from_entries as weak_map_from_entries } from "../src/weak_map.ts";
import { from_iterable as weak_set_from_iterable } from "../src/weak_set.ts";
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
import { Program, type Uses } from "../src/effects.ts";
import { match } from "../src/tagged.ts";
import { type AsWriter, run_writer, tell } from "../src/writer.ts";
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
const guarded_result = describe_result(positive_result.value());
const matched_result = match(result.value(), {
  ok(value) {
    return "ok:" + value.toString();
  },
  err(message) {
    return "err:" + message;
  },
});
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
const mapped_set = set_from_iterable([1, 2, 2, 3])
  .map((value) => value * 10);
const replayable_iterable = iterable_from_factory(function* () {
  yield 1;
  yield 2;
  yield 3;
}).bind((value) => {
  return iterable_from_factory(function* () {
    yield value;
    yield value * 10;
  });
});
const replayable_async_iterable = async_iterable_from_factory(
  async function* () {
    yield "a";
    yield "b";
  },
).map((value) => value.toUpperCase());
const readable_numbers = from_readable_stream(
  new ReadableStream<number>({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
      controller.close();
    },
  }),
);
const readable_as_iterable = readable_stream_to_async_iterable(readable_numbers)
  .map((value) => value * 10);
const byte_buffer = array_buffer_from_bytes([1, 2])
  .concat(array_buffer_from_bytes([3]));
const byte_view = data_view_from_bytes([4, 5, 6]);
const typed_numbers = from_typed_array(new Uint8Array([7, 8, 9]));
const query_params = url_params_from_entries([
  ["tag", "traits"],
  ["tag", "typescript"],
]);
const form_fields = form_data_from_entries([
  ["name", "Ada"],
  ["email", "ada@example.test"],
]);
const weak_key = {};
const weak_map = weak_map_from_entries([[weak_key, "cached"]]);
const weak_set = weak_set_from_iterable([weak_key]);
const date_value = from_date(new Date("2024-01-02T03:04:05.000Z"));
const regexp_value = from_regexp(/^traits$/iu);
const error_value = from_error(new TypeError("expected value"));
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
type AppConfig = {
  readonly host: string;
  readonly port: number;
  readonly path: string;
};
const reader_endpoint = Do(function* () {
  const config = yield* ask<AppConfig>();
  const base = yield* asks<AppConfig, string>((environment) => {
    return environment.host + ":" + environment.port.toString();
  });
  const path = yield* local(
    asks<{ readonly path: string }, string>((environment) => environment.path),
    (environment: AppConfig) => ({ path: environment.path }),
  );

  return base + path + "?host=" + config.host;
});

type EffectConfig = {
  readonly label: string;
  readonly increment: number;
};
type LabelConfig = {
  readonly label: string;
};
type Label =
  | Uses<AsReader<LabelConfig>>
  | Uses<AsTask>;
type App =
  | Uses<AsReader<EffectConfig>>
  | Uses<AsState<number>>
  | Uses<AsWriter<AsArray, string>>
  | Uses<AsTask>;
const Label = Program.scope<Label>();
const App = Program.scope<App>();
const effect_label = Label(function* () {
  const config = yield* ask<LabelConfig>();

  return config.label;
});
const effect_async_label = Label(function* () {
  const label = yield* effect_label;
  const suffix = yield* from_fn(() => Promise.resolve(":async"));

  return label + suffix;
});
const effect_program = App(function* () {
  const config = yield* ask<EffectConfig>();
  const before = yield* get<number>();
  const label = yield* run_reader(effect_async_label, {
    label: config.label,
  });

  yield* modify((value: number) => value + config.increment);
  yield* tell(array_from_array([label + ":" + before.toString()]));

  const after = yield* get<number>();

  return { before, after };
});
const effect_without_reader = run_reader(effect_program, {
  label: "step",
  increment: 2,
});
const state_counter = Do(function* () {
  const before = yield* get<number>();

  yield* modify((value: number) => value + 1);
  yield* modify((value: number) => value * 2);

  const after = yield* gets((value: number) => value);

  return { before, after };
});

const [state_counter_result] = state_counter.value()(20);
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
const effect_result = await run(
  run_writer(
    run_state(
      effect_without_reader,
      40,
    ),
    array_from_array<string>([]),
  ),
);
const [effect_result_value, effect_result_logs] = effect_result;

console.log("option", doubled_option.fmt());
console.log("option switch guards", guarded_option);
console.log("option match", matched_option);
console.log("none match", matched_none);
console.log("list labels", Format.fmt(labeled_list));
console.log("list sum", sum_values(list));
console.log("custom trait list size", Size.size(sized_list));
console.log("custom fluent list size", sized_list.size());
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
console.log("array monad", array_monad.fmt());
console.log("array alternative", Format.fmt(array_alternative));
console.log("map functor", Deno.inspect(map_to_record(mapped_map)));
console.log("record functor", Deno.inspect(record_to_record(mapped_record)));
console.log("set functor", Deno.inspect([...set_to_set(mapped_set)]));
console.log(
  "iterable monad",
  Deno.inspect(iterable_to_array(replayable_iterable)),
);
console.log(
  "async iterable functor",
  Deno.inspect(await async_iterable_to_array(replayable_async_iterable)),
);
console.log(
  "readable stream adapter",
  Deno.inspect(await async_iterable_to_array(readable_as_iterable)),
);
console.log("array buffer concat", byte_buffer.fmt());
console.log("data view bytes", byte_view.fmt());
console.log(
  "typed array fold",
  typed_numbers.fold(0, (sum, byte) => sum + Number(byte)),
);
console.log("url params", Deno.inspect(url_params_to_entries(query_params)));
console.log("form data", Deno.inspect(form_data_to_entries(form_fields)));
console.log("weak map", weak_map.fmt());
console.log("weak set", weak_set.fmt());
console.log("date", date_value.fmt());
console.log("regexp", regexp_value.fmt());
console.log("error", error_value.fmt());
console.log("record traverse result", traversed_record.fmt());
console.log("decoded account", decoded_account.fmt());
console.log("task Do result", await task_result.value()());
console.log(
  "reader endpoint",
  reader_endpoint.value()({
    host: "localhost",
    port: 8080,
    path: "/users",
  }),
);
console.log(
  "effect reader state writer task",
  Deno.inspect(
    [effect_result_value, array_to_array(effect_result_logs)],
  ),
);
console.log(
  "state counter",
  state_counter_result,
  exec_state(state_counter, 20),
);
console.log("stm transfer total", transfer_result);

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

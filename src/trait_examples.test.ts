import { assert_equals, assert_true } from "./assert.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "./examples.ts";
import {
  Effect,
  type Effect as AlgebraicEffect,
  type Operation as EffectOperation,
  Program,
  type TaggedOperation,
  type Uses,
} from "./effects.ts";
import {
  type AsArray,
  from_array as array_from_array,
  to_array as array_to_array,
} from "./array.ts";
import {
  from_bytes as array_buffer_from_bytes,
  to_bytes as array_buffer_to_bytes,
} from "./array_buffer.ts";
import {
  from_factory as async_iterable_from_factory,
  to_array as async_iterable_to_array,
} from "./async_iterable.ts";
import { from_bytes as data_view_from_bytes } from "./data_view.ts";
import { from_date } from "./date.ts";
import { from_error } from "./error.ts";
import {
  from_entries as form_data_from_entries,
  to_entries as form_data_to_entries,
} from "./form_data.ts";
import {
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "./iterable.ts";
import {
  from_array as list_from_array,
  nil as list_nil,
  to_array as list_to_array,
} from "./list.ts";
import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "./map.ts";
import {
  is_none as option_is_none,
  is_some as option_is_some,
  none as option_none,
  Option,
  some as option_some,
} from "./option.ts";
import { ask, asks, type AsReader, local, run_reader } from "./reader.ts";
import {
  from_entries as record_from_entries,
  to_record as record_to_record,
} from "./record.ts";
import {
  from_readable_stream,
  to_async_iterable as readable_stream_to_async_iterable,
} from "./readable_stream.ts";
import { from_regexp } from "./regexp.ts";
import {
  err as result_err,
  from_number as result_from_number,
  is_err as result_is_err,
  is_ok as result_is_ok,
  ok as result_ok,
  Result,
} from "./result.ts";
import {
  from_iterable as set_from_iterable,
  to_set as set_to_set,
} from "./set.ts";
import { match } from "./tagged.ts";
import {
  type AsTask,
  from_fn as task_from_fn,
  run_task,
  succeed as task_succeed,
} from "./task.ts";
import { from_typed_array } from "./typed_array.ts";
import {
  from_entries as url_params_from_entries,
  to_entries as url_params_to_entries,
} from "./url_search_params.ts";
import {
  type AsState,
  eval_state,
  exec_state,
  get,
  gets,
  modify,
  put,
  run_state,
} from "./state.ts";
import {
  type AsWriter,
  run_writer,
  tell as writer_tell,
  writer as writer_value,
} from "./writer.ts";
import {
  abort as stm_abort,
  atomically,
  modify_tvar,
  new_tvar,
  or_else,
  read_tvar,
  retry,
  StmError,
  write_tvar,
} from "./stm.ts";
import {
  invalid as validation_invalid,
  valid as validation_valid,
  type Validation,
} from "./validation.ts";
import { from_entries as weak_map_from_entries } from "./weak_map.ts";
import { from_iterable as weak_set_from_iterable } from "./weak_set.ts";
import {
  Alternative,
  Applicative,
  Do,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Traversable,
} from "./traits.ts";
import { as_trait, type Trait, TraitDefinition } from "./trait.ts";

Deno.test("Trait definitions inherit shared prototype helpers", () => {
  assert_equals(Object.getPrototypeOf(Format), TraitDefinition);
  assert_equals(Object.getPrototypeOf(Functor), TraitDefinition);
  assert_true(!Object.hasOwn(Format, "implement"), "Format inherits installer");
  assert_true(
    !Object.hasOwn(Functor, "implementation"),
    "Functor inherits implementation accessor",
  );
});

Deno.test("Format and Equal traits dispatch through trait helpers", () => {
  assert_equals(Format.fmt(option_some(42)), "Some(42)");
  assert_equals(Format.fmt(option_none()), "None");
  assert_true(Equal.eq(option_some("x"), option_some("x")), "boxed same");
  assert_true(!Equal.eq(option_some("x"), option_some("y")), "boxed diff");

  const list = list_from_array([1, 2, 3]);
  assert_equals(Format.fmt(list), "[1, 2, 3]");
  assert_true(
    Equal.eq(list, list_from_array([1, 2, 3])),
    "boxed list",
  );

  assert_equals(Format.fmt(result_ok("done")), 'Ok("done")');
  assert_equals(Format.fmt(result_err("bad")), 'Err("bad")');
  assert_true(
    Equal.eq(result_ok("done"), result_ok("done")),
    "boxed result",
  );
});

Deno.test("Tuple tagged values can be matched by tag", () => {
  const option = match(option_some(42).value(), {
    some(value) {
      return value + 1;
    },
    none() {
      return 0;
    },
  });
  const result = match(result_err<number>("missing").value(), {
    ok(value) {
      return value.toString();
    },
    err(message) {
      return message;
    },
  });

  assert_equals(option, 43);
  assert_equals(result, "missing");
});

Deno.test("Tuple tagged guards narrow Option and Result payloads", () => {
  const option = option_some(42).value();
  const result = result_err<number>("missing").value();

  assert_true(option_is_some(option), "option is some");
  assert_true(!option_is_none(option), "option is not none");
  assert_true(result_is_err(result), "result is err");
  assert_true(!result_is_ok(result), "result is not ok");

  const [option_tag, option_payload] = option;

  switch (option_tag) {
    case "some":
      assert_equals(option_payload + 1, 43);
      break;
    case "none":
      assert_equals(option_tag, "none");
      break;
  }

  const [result_tag, result_payload] = result;

  switch (result_tag) {
    case "ok":
      assert_equals(result_payload + 1, 10);
      break;
    case "err":
      assert_equals(result_payload, "missing");
      break;
  }
});

Deno.test("Functor maps values without leaving the context", () => {
  const some = Functor.map(option_some(2), (value) => value + 1);
  const none = Functor.map(
    option_none<number>(),
    (value) => value + 1,
  );
  const list = Functor.map(
    list_from_array([1, 2, 3]),
    (value) => value * 2,
  );
  const ok = Functor.map(
    result_ok(20),
    (value) => value + 1,
  );
  const err = Functor.map(
    result_err<number>("missing"),
    (value) => value + 1,
  );

  assert_equals(some.value(), option_some(3).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(list_to_array(list), [2, 4, 6]);
  assert_equals(ok.value(), result_ok(21).value());
  assert_equals(err.value(), result_err("missing").value());
});

Deno.test("Applicative applies contextual functions", () => {
  const option = Applicative.ap(
    option_some((value: number) => value * 2),
    option_some(21),
  );
  const none = Applicative.ap(
    option_none<(value: number) => number>(),
    option_some(21),
  );
  const list = Applicative.ap(
    list_from_array([
      (value: number) => value + 1,
      (value: number) => value * 10,
    ]),
    list_from_array([1, 2]),
  );

  assert_equals(option.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(list_to_array(list), [2, 3, 10, 20]);
});

Deno.test("Applicative lifts independent contextual values", () => {
  const option = Applicative.lift(
    (left, right) => left + right,
    option_some(20),
    option_some(22),
  );
  const none = Applicative.lift(
    (left, right) => left + right,
    option_some(20),
    option_none<number>(),
  );
  const result = Applicative.lift(
    (left, right) => left + right,
    result_ok(40),
    result_ok(2),
  );
  const error = Applicative.lift(
    (left, right) => left + right,
    result_err<number>("missing"),
    result_ok(2),
  );
  const list = Applicative.lift(
    (left, right) => left + right,
    list_from_array([1, 2]),
    list_from_array([10, 20]),
  );

  assert_equals(option.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(result.value(), result_ok(42).value());
  assert_equals(error.value(), result_err("missing").value());
  assert_equals(list_to_array(list), [11, 21, 12, 22]);
});

Deno.test("Applicative lift can build named structures", () => {
  const profile = Applicative.lift(
    (name, age) => ({ name, age }),
    option_some("Ada"),
    option_some(37),
  );
  const missing = Applicative.lift(
    (name, age) => ({ name, age }),
    option_some("Ada"),
    option_none<number>(),
  );
  const invalid_profile = Applicative.lift(
    (name, email, age) => ({ name, email, age }),
    validation_invalid<string>("name is required"),
    validation_invalid<string>("email is invalid"),
    validation_valid(37),
  );

  assert_equals(
    profile.value(),
    option_some({ name: "Ada", age: 37 }).value(),
  );
  assert_equals(missing.value(), option_none().value());
  const invalid_profile_error = expect_validation_invalid(
    invalid_profile.value(),
    "expected invalid profile",
  );

  assert_equals(invalid_profile_error, [
    "name is required",
    "email is invalid",
  ]);
});

Deno.test("Option callable wrapper traits option values for fluent methods", () => {
  const value = option_some(41)
    .map((item) => item + 1);
  const none = option_none<number>()
    .map((item) => item + 1);

  assert_equals(value.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(value.fmt(), "Some(42)");
  assert_true(value.eq(option_some(42)), "option compares");
  assert_true(
    Option(["some", 42]).eq(option_some(42)),
    "constructor boxes raw option",
  );
  assert_true(option_none().eq(option_none()), "None compares");
});

Deno.test("Option callable wrapper chains applicative ap through this", () => {
  const direct = option_some((value: number) => value + 22)
    .ap(option_some(20));
  const sum = option_some((left: number) => {
    return (right: number) => left + right;
  })
    .ap(option_some(20))
    .ap(option_some(22));

  const missing = option_some((left: number) => {
    return (right: number) => left + right;
  })
    .ap(option_none<number>())
    .ap(option_some(22));

  assert_equals(direct.value(), option_some(42).value());
  assert_equals(sum.value(), option_some(42).value());
  assert_equals(missing.value(), option_none().value());
});

Deno.test("Trait dictionary methods assert a missing receiver at runtime", () => {
  assert_trait_receiver_error(
    () =>
      Reflect.apply(Option.map, undefined, [
        (value: number) => value + 1,
      ]),
  );
});

Deno.test("Trait helpers use symbol-scoped implementations", () => {
  const original = Option.fmt;

  try {
    Option.fmt = function fmt() {
      return "alias";
    };

    const value = option_some(42);

    assert_equals(value.fmt(), "alias");
    assert_equals(Format.fmt(value), "Some(42)");
  } finally {
    Option.fmt = original;
  }
});

Deno.test("Trait values inherit methods added after construction", () => {
  type DynamicDictionary = {
    inc?: (this: Trait<DynamicDictionary, number, number>) => number;
  };

  const dictionary: DynamicDictionary = {};
  const extended = dictionary as DynamicDictionary & {
    inc: (this: Trait<DynamicDictionary, number, number>) => number;
  };
  const value = as_trait<DynamicDictionary, number, number>(extended, 41);

  extended.inc = function inc(
    this: Trait<DynamicDictionary, number, number>,
  ) {
    return this.value() + 1;
  };

  if (value.inc === undefined) {
    throw new Error("expected dynamic dictionary method");
  }

  assert_equals(value.inc(), 42);
});

Deno.test("Result callable wrapper derives fluent methods from its dictionary", () => {
  const value = result_ok(40)
    .map((item) => item + 2);
  const parsed = result_ok("42")
    .bind((text) => result_from_number(Number.parseInt(text, 10)));
  const sum = result_ok((left: number) => {
    return (right: number) => left + right;
  })
    .ap(result_ok(40))
    .ap(result_ok(2));
  const missing = result_err<number>("missing")
    .map((item) => item + 1);

  assert_equals(value.value(), result_ok(42).value());
  assert_equals(value.fmt(), "Ok(42)");
  assert_true(value.eq(result_ok(42)), "result compares");
  assert_true(
    value.eq(Result(["ok", 42])),
    "constructor boxes raw result",
  );
  assert_equals(parsed.value(), result_ok(42).value());
  assert_equals(parsed.fmt(), "Ok(42)");
  assert_equals(sum.value(), result_ok(42).value());
  assert_equals(missing.value(), result_err("missing").value());
});

Deno.test("List callable wrapper derives fluent methods from its dictionary", () => {
  const values = list_from_array([1, 2, 3])
    .map((item) => item * 2);
  const applied = list_from_array([
    (value: number) => value + 1,
    (value: number) => value * 10,
  ])
    .ap(list_from_array([1, 2]));
  const total = values.fold(0, (state, item) => state + item);

  assert_equals(values.value(), list_from_array([2, 4, 6]).value());
  assert_equals(values.fmt(), "[2, 4, 6]");
  assert_true(
    values.eq(list_from_array([2, 4, 6])),
    "wrapped list compares",
  );
  assert_equals(list_to_array(applied), [2, 3, 10, 20]);
  assert_equals(total, 12);
});

Deno.test("Monad chains computations that choose the next context", () => {
  function positive(value: number) {
    if (value > 0) {
      return option_some(value);
    }

    return option_none<number>();
  }

  const kept = Monad.bind(option_some(4), positive);
  const dropped = Monad.bind(option_some(-1), positive);
  const parsed = Monad.bind(
    result_ok("42"),
    (text) => result_from_number(Number.parseInt(text, 10)),
  );

  assert_equals(kept.value(), option_some(4).value());
  assert_equals(dropped.value(), option_none().value());
  assert_equals(parsed.value(), result_ok(42).value());
});

Deno.test("Do chains monadic generator yields with bind", () => {
  const decoded = decode_account_payload({
    account: { id: "42", active: true },
  });
  const inactive = decode_account_payload({
    account: { id: "42", active: false },
  });
  const malformed = decode_account_payload({
    account: { id: 42, active: true },
  });
  const missing = Do(function* () {
    const value = yield* option_none<number>();

    return value + 1;
  });
  const list = Do(function* () {
    const left = yield* list_from_array([1, 2]);
    const right = yield* list_from_array([10, 20]);

    return left + right;
  });

  assert_equals(
    decoded.value(),
    result_ok({ id: 42, label: "account:42" }).value(),
  );
  assert_equals(inactive.value(), result_err("account must be active").value());
  assert_equals(
    malformed.value(),
    result_err("account.id must be a string").value(),
  );
  assert_equals(missing.value(), option_none().value());
  assert_equals(list_to_array(list), [11, 21, 12, 22]);
});

Deno.test("Applicative lift combines Task applicatives without sequencing effects", async () => {
  const events: string[] = [];
  let resolve_left: () => void = () => {};
  let resolve_right: () => void = () => {};
  const computed = Applicative.lift(
    (left, right) => left + right,
    task_from_fn(() => {
      return new Promise<number>((resolve) => {
        events.push("left start");
        resolve_left = () => {
          events.push("left end");
          resolve(20);
        };
      });
    }),
    task_from_fn(() => {
      return new Promise<number>((resolve) => {
        events.push("right start");
        resolve_right = () => {
          events.push("right end");
          resolve(22);
        };
      });
    }),
  );

  const promise = computed.run();
  await Promise.resolve();

  assert_equals(events, ["left start", "right start"]);

  resolve_left();
  resolve_right();

  assert_equals(await promise, 42);
  assert_equals(events, [
    "left start",
    "right start",
    "left end",
    "right end",
  ]);
});

Deno.test("Applicative lift supports promise-returning Task combiners", async () => {
  const computed = Applicative.lift(
    (left, right) => Promise.resolve(left + right),
    task_succeed(20),
    task_succeed(22),
  );

  const result: number = await computed.run();
  assert_equals(result, 42);
});

Deno.test("Applicative lift lets Validation accumulate independent errors", () => {
  const valid_profile = Applicative.lift(
    (name, age) => ({ name, age }),
    validation_valid("Ada"),
    validation_valid(37),
  );
  const invalid_profile = Applicative.lift(
    (name, email, age) => ({ name, email, age }),
    validation_invalid<string>("name is required"),
    validation_invalid<string>("email is invalid"),
    validation_valid(37),
  );

  assert_equals(
    valid_profile.value(),
    validation_valid({ name: "Ada", age: 37 }).value(),
  );
  const invalid_profile_error = expect_validation_invalid(
    invalid_profile.value(),
    "expected invalid profile",
  );

  assert_equals(invalid_profile_error, [
    "name is required",
    "email is invalid",
  ]);
});

Deno.test("Task monad defers and chains async work", async () => {
  const events: string[] = [];
  const task = task_from_fn(() => {
    events.push("read");
    return Promise.resolve("21");
  }).bind((text) =>
    task_from_fn(() => {
      events.push("parse");
      return Promise.resolve(Number.parseInt(text, 10) * 2);
    })
  );
  const applied = task_succeed((value: number) => value + 1)
    .ap(task_succeed(41));
  const computed = Do(function* () {
    const text = yield* task_from_fn(() => Promise.resolve("40"));
    const right = yield* task_succeed(2);

    return Number.parseInt(text, 10) + right;
  });

  assert_equals(events, []);
  assert_equals(await task.run(), 42);
  assert_equals(events, ["read", "parse"]);
  assert_equals(await applied.run(), 42);
  assert_equals(await computed.run(), 42);
  assert_equals(await computed.run(), 42);
  assert_equals(computed.fmt(), "Task(?)");
});

Deno.test("Reader monad threads a shared environment", () => {
  type Config = {
    readonly host: string;
    readonly port: number;
    readonly path: string;
  };

  const endpoint = Do(function* () {
    const config = yield* ask<Config>();
    const base = yield* asks<Config, string>((environment) => {
      return environment.host + ":" + environment.port.toString();
    });
    const path = yield* local(
      asks<{ readonly path: string }, string>((environment) => {
        return environment.path;
      }),
      (environment: Config) => ({ path: environment.path }),
    );

    return base + path + "?host=" + config.host;
  });
  const port = asks<Config, number>((environment) => environment.port)
    .map((value) => value + 1);

  assert_equals(
    endpoint.run({
      host: "localhost",
      port: 8080,
      path: "/users",
    }),
    "localhost:8080/users?host=localhost",
  );
  assert_equals(
    port.run({ host: "localhost", port: 8080, path: "/users" }),
    8081,
  );
  assert_equals(endpoint.fmt(), "Reader(?)");
});

Deno.test("State monad threads state through Do", () => {
  const counter = Do(function* () {
    const before = yield* get<number>();

    yield* put(before + 1);
    yield* modify((value: number) => value * 2);

    const after = yield* gets((value: number) => value + 1);

    return { before, after };
  });

  assert_equals(counter.run(20), [
    { before: 20, after: 43 },
    42,
  ]);
  assert_equals(eval_state(counter, 20), { before: 20, after: 43 });
  assert_equals(exec_state(counter, 20), 42);
  assert_equals(counter.fmt(), "State(?)");
});

Deno.test("Writer monad accumulates logs through Do", () => {
  const program = Do(function* () {
    yield* writer_tell(array_from_array(["start"]));
    const value = yield* writer_value(40, array_from_array(["value"]));
    yield* writer_tell(array_from_array(["end"]));

    return value + 2;
  });
  const [value, logs] = program.value() as readonly [
    number,
    ReturnType<typeof array_from_array<string>>,
  ];
  const [mapped_value, mapped_logs] = program.map((value) => value + 1)
    .value() as readonly [number, ReturnType<typeof array_from_array<string>>];

  assert_equals(value, 42);
  assert_equals(array_to_array(logs), ["start", "value", "end"]);
  assert_equals(mapped_value, 43);
  assert_equals(array_to_array(mapped_logs), ["start", "value", "end"]);
});

Deno.test("Effects compose reader state writer and task with handlers", async () => {
  type Config = {
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
    | Uses<AsReader<Config>>
    | Uses<AsState<number>>
    | Uses<AsWriter<AsArray, string>>
    | Uses<AsTask>;
  const Label = Program.scope<Label>();
  const App = Program.scope<App>();

  const read_label = Label(function* () {
    const config = yield* ask<LabelConfig>();

    return config.label;
  });
  const load_label = Label(function* () {
    const label = yield* read_label;
    const suffix = yield* task_succeed(":async");

    return label + suffix;
  });
  const program = App(function* () {
    const config = yield* ask<Config>();
    const before = yield* get<number>();
    const label = yield* run_reader(load_label, {
      label: config.label,
    });

    yield* modify((value: number) => value + config.increment);
    yield* writer_tell(array_from_array([label + ":" + before.toString()]));

    const after = yield* get<number>();

    return { before, after };
  });
  const result = await Effect.handle_with(program, [
    (effect) =>
      run_reader(effect, {
        label: "step",
        increment: 2,
      }),
    (effect) => run_state(effect, 40),
    (effect) => run_writer(effect, array_from_array<string>([])),
    run_task,
  ]);
  const [result_value, result_logs] = result;

  assert_equals(result_value, [{ before: 40, after: 42 }, 42]);
  assert_equals(array_to_array(result_logs), ["step:async:40"]);

  assert_equals(Effect.run(Effect.pure("done")), "done");
});

Deno.test("Effects allow new capabilities without changing the core", () => {
  type ClockNow =
    & EffectOperation<number>
    & {
      readonly tag: "clock.now";
    };
  type WithoutClock<requirements> = requirements extends {
    readonly tag: "clock.now";
  } ? never
    : requirements;

  function now(): AlgebraicEffect<ClockNow, number> {
    return Effect.send({ tag: "clock.now" } as ClockNow);
  }

  function run_clock<requirements, item>(
    effect: AlgebraicEffect<requirements, item>,
    current: number,
  ): AlgebraicEffect<WithoutClock<requirements>, item> {
    if (effect.tag === "pure") {
      return Effect.pure(effect.value);
    }

    const operation = effect.operation as TaggedOperation;

    if (operation.tag === "clock.now") {
      return run_clock(effect.resume(current), current);
    }

    return Effect.suspend(
      effect.operation as WithoutClock<requirements>,
      (value) => run_clock(effect.resume(value), current),
    );
  }

  const program = Program(function* () {
    const current = yield* now();

    return current + 1;
  });

  assert_equals(Effect.run(run_clock(program, 41)), 42);
});

Deno.test("Stm monad composes transactional reads and writes", () => {
  const checking = new_tvar(40);
  const savings = new_tvar(2);
  const transfer = Do(function* () {
    const checking_before = yield* read_tvar(checking);
    const savings_before = yield* read_tvar(savings);

    yield* write_tvar(checking, checking_before - 5);
    yield* modify_tvar(savings, (value) => value + 5);

    const checking_after = yield* read_tvar(checking);
    const savings_after = yield* read_tvar(savings);

    return {
      before: checking_before + savings_before,
      after: checking_after + savings_after,
    };
  });

  assert_equals(atomically(transfer), { before: 42, after: 42 });
  assert_equals(atomically(read_tvar(checking)), 35);
  assert_equals(atomically(read_tvar(savings)), 7);
  assert_equals(transfer.fmt(), "Stm(?)");
});

Deno.test("Stm rolls back pending writes when a transaction aborts", () => {
  const counter = new_tvar(1);
  const transaction = Do(function* () {
    const value = yield* read_tvar(counter);

    yield* write_tvar(counter, value + 1);
    yield* stm_abort("rollback");

    return value;
  });

  let error: unknown;

  try {
    atomically(transaction);
  } catch (caught) {
    error = caught;
  }

  assert_true(error instanceof StmError, "transaction aborts with StmError");
  assert_equals((error as StmError).message, "rollback");
  assert_equals(atomically(read_tvar(counter)), 1);
});

Deno.test("Stm or_else retries with the original transaction journal", () => {
  const counter = new_tvar(0);
  const retried = Do(function* () {
    const value = yield* read_tvar(counter);

    yield* write_tvar(counter, value + 1);
    yield* retry();

    return value;
  });
  const fallback = Do(function* () {
    const value = yield* read_tvar(counter);

    yield* write_tvar(counter, value + 2);

    return value;
  });

  assert_equals(atomically(or_else(retried, fallback)), 0);
  assert_equals(atomically(read_tvar(counter)), 2);
});

Deno.test("Foldable reduces values inside different contexts", () => {
  const list = list_from_array([1, 2, 3, 4]);
  const some = option_some(7);
  const none = option_none<number>();
  const ok = result_ok(9);
  const err = result_err<number>("no value");

  assert_equals(
    Foldable.fold(
      list,
      0,
      (state, item) => state + item,
    ),
    10,
  );
  assert_equals(
    Foldable.fold(some, 1, (state, item) => state * item),
    7,
  );
  assert_equals(
    Foldable.fold(none, 1, (state, item) => state * item),
    1,
  );
  assert_equals(
    Foldable.fold(ok, 1, (state, item) => state + item),
    10,
  );
  assert_equals(
    Foldable.fold(
      err,
      1,
      (state, item) => state + item,
    ),
    1,
  );
});

Deno.test("Semigroup and Monoid combine collection contexts", () => {
  const list = Semigroup.concat(list_from_array([1, 2]), list_from_array([3]));
  const array = Semigroup.concat(
    array_from_array([1, 2]),
    array_from_array([3]),
  );
  const record = Semigroup.concat(
    record_from_entries<number>([["left", 1], ["shared", 1]]),
    record_from_entries<number>([["shared", 2], ["right", 3]]),
  );
  const empty_array = Monoid.empty(array_from_array<number>([]));

  assert_equals(list_to_array(list), [1, 2, 3]);
  assert_equals(array_to_array(array), [1, 2, 3]);
  assert_equals(record_to_record(record), {
    left: 1,
    shared: 2,
    right: 3,
  });
  assert_equals(array_to_array(empty_array), []);
});

Deno.test("Alternative chooses fallback or combines list-like contexts", () => {
  const option = Alternative.alt(option_none<number>(), option_some(42));
  const kept = Alternative.alt(option_some(1), option_some(2));
  const list = Alternative.alt(list_from_array([1, 2]), list_from_array([3]));
  const array = Alternative.alt(array_from_array([1]), array_from_array([2]));
  const empty_option = Alternative.empty(option_some(0));

  assert_equals(option.value(), option_some(42).value());
  assert_equals(kept.value(), option_some(1).value());
  assert_equals(list_to_array(list), [1, 2, 3]);
  assert_equals(array_to_array(array), [1, 2]);
  assert_equals(empty_option.value(), option_none().value());
});

Deno.test("Built-in wrappers map and fold over values", () => {
  const array = array_from_array([1, 2, 3])
    .bind((value) => array_from_array([value, value * 10]));
  const map = map_from_entries<number>([["a", 1], ["b", 2]])
    .map((value) => "value:" + value.toString());
  const record = record_from_entries<number>([["a", 1], ["b", 2]])
    .map((value) => value * 2);
  const map_sum = Foldable.fold(
    map_from_entries<number>([["a", 1], ["b", 2]]),
    0,
    (state, value) => state + value,
  );

  assert_equals(array_to_array(array), [1, 10, 2, 20, 3, 30]);
  assert_equals(map_to_record(map), { a: "value:1", b: "value:2" });
  assert_equals(record_to_record(record), { a: 2, b: 4 });
  assert_equals(map_sum, 3);
});

Deno.test("JavaScript shape wrappers expose conservative traits", async () => {
  const set = set_from_iterable([1, 2, 2, 3])
    .map((value) => value * 10);
  const iterable = iterable_from_factory(function* () {
    yield 1;
    yield 2;
  }).bind((value) => {
    return iterable_from_factory(function* () {
      yield value;
      yield value * 10;
    });
  });
  const async_iterable = async_iterable_from_factory(async function* () {
    yield "a";
    yield "b";
  }).map((value) => value.toUpperCase());
  const stream = from_readable_stream(
    new ReadableStream<number>({
      start(controller) {
        controller.enqueue(1);
        controller.enqueue(2);
        controller.close();
      },
    }),
  );
  const buffer = Semigroup.concat(
    array_buffer_from_bytes([1]),
    array_buffer_from_bytes([2, 3]),
  );
  const data_view = data_view_from_bytes([4, 5]);
  const typed_array = from_typed_array(new Uint8Array([6, 7]));
  const url_params = url_params_from_entries([
    ["tag", "traits"],
    ["tag", "typescript"],
  ]);
  const form_data = form_data_from_entries([
    ["name", "Ada"],
    ["email", "ada@example.test"],
  ]);
  const weak_key = {};
  const weak_map = weak_map_from_entries([[weak_key, "cached"]]);
  const weak_set = weak_set_from_iterable([weak_key]);
  const date = from_date(new Date("2024-01-02T03:04:05.000Z"));
  const same_date = from_date(new Date("2024-01-02T03:04:05.000Z"));
  const regexp = from_regexp(/^traits$/iu);
  const error = from_error(new TypeError("expected value"));

  assert_equals([...set_to_set(set)], [10, 20, 30]);
  assert_equals(iterable_to_array(iterable), [1, 10, 2, 20]);
  assert_equals(await async_iterable_to_array(async_iterable), ["A", "B"]);
  assert_equals(
    await async_iterable_to_array(readable_stream_to_async_iterable(stream)),
    [1, 2],
  );
  assert_equals([...array_buffer_to_bytes(buffer)], [1, 2, 3]);
  assert_equals(
    Foldable.fold(data_view, 0, (state, byte) => state + byte),
    9,
  );
  assert_equals(
    Foldable.fold(typed_array, 0, (state, item) => state + Number(item)),
    13,
  );
  assert_equals(url_params_to_entries(url_params), [
    ["tag", "traits"],
    ["tag", "typescript"],
  ]);
  assert_equals(form_data_to_entries(form_data), [
    ["name", "Ada"],
    ["email", "ada@example.test"],
  ]);
  assert_equals(weak_map.fmt(), "WeakMap(?)");
  assert_equals(weak_set.fmt(), "WeakSet(?)");
  assert_true(Equal.eq(date, same_date), "dates compare by time value");
  assert_equals(date.fmt(), "2024-01-02T03:04:05.000Z");
  assert_equals(regexp.fmt(), "/^traits$/iu");
  assert_equals(error.fmt(), "TypeError: expected value");
});

Deno.test("Traversable flips structures through an applicative", () => {
  const array = Traversable.traverse(
    array_from_array([1, 2, 3]),
    result_ok(undefined),
    (value) => result_ok("value:" + value.toString()),
  );
  const record = Traversable.traverse(
    record_from_entries<number>([["a", 1], ["b", -1]]),
    result_ok(undefined),
    (value) => {
      if (value > 0) {
        return result_ok(value * 2);
      }

      return result_err<number>("negative: " + value.toString());
    },
  );
  const option = Traversable.traverse(
    option_some(21),
    array_from_array<unknown>([]),
    (value) => array_from_array([value, value * 2]),
  );
  const map = Traversable.traverse(
    map_from_entries<number>([["x", 1], ["y", 2]]),
    result_ok(undefined),
    (value) => result_ok(value + 1),
  );
  const empty_array = Traversable.traverse(
    array_from_array<number>([]),
    result_ok(undefined),
    (value) => result_ok(value.toString()),
  );
  const empty_list = Traversable.traverse(
    list_from_array<number>([]),
    result_ok(undefined),
    (value) => result_ok(value.toString()),
  );
  const empty_map = Traversable.traverse(
    map_from_entries<number>([]),
    result_ok(undefined),
    (value) => result_ok(value.toString()),
  );
  const empty_record = Traversable.traverse(
    record_from_entries<number>([]),
    result_ok(undefined),
    (value) => result_ok(value.toString()),
  );

  const array_result = expect_result_ok(
    array.value(),
    "expected traversed array to succeed",
  );
  const map_result = expect_result_ok(
    map.value(),
    "expected traversed map to succeed",
  );
  const empty_array_result = expect_result_ok(
    empty_array.value(),
    "expected empty traversed array to succeed",
  );
  const empty_list_result = expect_result_ok(
    empty_list.value(),
    "expected empty traversed list to succeed",
  );
  const empty_map_result = expect_result_ok(
    empty_map.value(),
    "expected empty traversed map to succeed",
  );
  const empty_record_result = expect_result_ok(
    empty_record.value(),
    "expected empty traversed record to succeed",
  );

  assert_equals(array_to_array(array_result), [
    "value:1",
    "value:2",
    "value:3",
  ]);
  assert_equals(record.value(), result_err("negative: -1").value());
  assert_equals(
    array_to_array(option).map((value) => value.value()),
    [option_some(21).value(), option_some(42).value()],
  );
  assert_equals(map_to_record(map_result), { x: 2, y: 3 });
  assert_equals(array_to_array(empty_array_result), []);
  assert_equals(list_to_array(empty_list_result), []);
  assert_equals(map_to_record(empty_map_result), {});
  assert_equals(record_to_record(empty_record_result), {});
});

Deno.test("Generic helpers work against trait interfaces", () => {
  const option = label_values(option_some(5));
  const list = label_values(list_from_array([1, 2]));
  const result = label_values(result_ok(3));

  assert_equals(option.value(), option_some("value:5").value());
  assert_equals(list_to_array(list), ["value:1", "value:2"]);
  assert_equals(result.value(), result_ok("value:3").value());
  assert_equals(sum_values(list_from_array([1, 2, 3])), 6);
});

Deno.test("Generic applicative helper combines contextual values", () => {
  const option = add_values(option_some(20), option_some(22));
  const none = add_values(option_some(20), option_none<number>());
  const result = add_values(result_ok(40), result_ok(2));
  const err = add_values(result_err<number>("missing"), result_ok(2));
  const list = add_values(
    list_from_array([1, 10]),
    list_from_array([2, 20]),
  );

  assert_equals(option.value(), option_some(42).value());
  assert_equals(none.value(), option_none().value());
  assert_equals(result.value(), result_ok(42).value());
  assert_equals(err.value(), result_err("missing").value());
  assert_equals(list_to_array(list), [3, 21, 12, 30]);
});

Deno.test("Generic monad helper lets each context define failure", () => {
  const option = keep_positive(
    option_some(-1),
    () => option_none(),
  );
  const result = keep_positive(
    result_ok(-1),
    (value) => result_err("negative: " + value.toString()),
  );
  const list = keep_positive(
    list_from_array([2, -1, 3]),
    () => list_nil(),
  );

  assert_equals(option.value(), option_none().value());
  assert_equals(result.value(), result_err("negative: -1").value());
  assert_equals(list_to_array(list), [2, 3]);
});

function decode_account_payload(input: unknown) {
  return Do(function* () {
    const root = yield* object_value(input, "payload");
    const account_value = yield* field(root, "account");
    const account = yield* object_value(account_value, "account");
    const id_value = yield* field(account, "id");
    const active_value = yield* field(account, "active");
    const id_text = yield* string_value(id_value, "account.id");
    const active = yield* boolean_value(active_value, "account.active");
    const id = yield* result_from_number(Number.parseInt(id_text, 10));

    yield* require_true(active, "account must be active");

    return { id, label: "account:" + id.toString() };
  });
}

function object_value(value: unknown, name: string) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return result_ok(value as Record<string, unknown>);
  }

  return result_err<Record<string, unknown>>(name + " must be an object");
}

function field(record: Record<string, unknown>, name: string) {
  if (Object.hasOwn(record, name)) {
    return result_ok(record[name]);
  }

  return result_err<unknown>(name + " is missing");
}

function string_value(value: unknown, name: string) {
  if (typeof value === "string") {
    return result_ok(value);
  }

  return result_err<string>(name + " must be a string");
}

function boolean_value(value: unknown, name: string) {
  if (typeof value === "boolean") {
    return result_ok(value);
  }

  return result_err<boolean>(name + " must be a boolean");
}

function require_true(value: boolean, message: string) {
  if (value) {
    return result_ok(undefined);
  }

  return result_err<void>(message);
}

function expect_result_ok<item, error>(
  result: Result<item, error>,
  message: string,
): item {
  const [tag, payload] = result;

  switch (tag) {
    case "ok":
      return payload;
    case "err":
      throw new Error(message);
  }
}

function expect_validation_invalid<error, item>(
  validation: Validation<error, item>,
  message: string,
): error {
  const [tag, payload] = validation;

  switch (tag) {
    case "invalid":
      return payload;
    case "valid":
      throw new Error(message);
  }
}

function assert_trait_receiver_error(
  fn: () => unknown,
): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw new Error("Expected TypeError");
    }

    return;
  }

  throw new Error("Expected a missing trait receiver error");
}

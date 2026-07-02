import { assert_equals, assert_true } from "./assert.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "./examples.ts";
import {
  from_array as array_from_array,
  to_array as array_to_array,
} from "./array.ts";
import {
  from_array as list_from_array,
  nil as list_nil,
  to_array as list_to_array,
} from "./list.ts";
import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "./map.ts";
import { none as option_none, Option, some as option_some } from "./option.ts";
import {
  from_entries as record_from_entries,
  to_record as record_to_record,
} from "./record.ts";
import {
  err as result_err,
  from_number as result_from_number,
  ok as result_ok,
  Result,
} from "./result.ts";
import {
  from_fn as task_from_fn,
  run as task_run,
  succeed as task_succeed,
} from "./task.ts";
import {
  Alternative,
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Monoid,
  perform,
  Semigroup,
  Traversable,
} from "./traits.ts";
import { type Trait, trait } from "./trait.ts";

Deno.test("Format and Equal traits dispatch through pseudo-trait helpers", () => {
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

Deno.test("Functor maps values without leaving the context", () => {
  const some = Functor.map(option_some(2), (value: number) => value + 1);
  const none = Functor.map(
    option_none<number>(),
    (value: number) => value + 1,
  );
  const list = Functor.map(
    list_from_array([1, 2, 3]),
    (value: number) => value * 2,
  );
  const ok = Functor.map(
    result_ok(20),
    (value: number) => value + 1,
  );
  const err = Functor.map(
    result_err<number>("missing"),
    (value: number) => value + 1,
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
    Option({ tag: "some", value: 42 }).eq(option_some(42)),
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
  const map = Option.map;

  assert_trait_receiver_error(
    () => map((value: number) => value + 1),
    "Option.Functor.map requires a trait receiver",
  );
});

Deno.test("Trait helpers use symbol-scoped implementations", () => {
  const original = Option.fmt;

  try {
    Option.fmt = function fmt(): string {
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
  const value = trait<DynamicDictionary, number, number>(extended, 41);

  extended.inc = function inc(
    this: Trait<DynamicDictionary, number, number>,
  ): number {
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
    value.eq(Result({ tag: "ok", value: 42 })),
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
    (text: string) => result_from_number(Number.parseInt(text, 10)),
  );

  assert_equals(kept.value(), option_some(4).value());
  assert_equals(dropped.value(), option_none().value());
  assert_equals(parsed.value(), result_ok(42).value());
});

Deno.test("perform chains monadic generator yields with bind", () => {
  const decoded = decode_account_payload({
    account: { id: "42", active: true },
  });
  const inactive = decode_account_payload({
    account: { id: "42", active: false },
  });
  const malformed = decode_account_payload({
    account: { id: 42, active: true },
  });
  const missing = perform(function* () {
    const value = yield* option_none<number>();

    return value + 1;
  });
  const list = perform(function* () {
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

Deno.test("Task monad defers and chains async work", async () => {
  const events: string[] = [];
  const task = task_from_fn(async () => {
    events.push("read");
    return "21";
  }).bind((text) =>
    task_from_fn(async () => {
      events.push("parse");
      return Number.parseInt(text, 10) * 2;
    })
  );
  const applied = task_succeed((value: number) => value + 1)
    .ap(task_succeed(41));
  const computed = perform(function* () {
    const text = yield* task_from_fn(async () => "40");
    const right = yield* task_succeed(2);

    return Number.parseInt(text, 10) + right;
  });

  assert_equals(events, []);
  assert_equals(await task_run(task), 42);
  assert_equals(events, ["read", "parse"]);
  assert_equals(await task_run(applied), 42);
  assert_equals(await task_run(computed), 42);
  assert_equals(computed.fmt(), "Task(?)");
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
      (state: number, item: number) => state + item,
    ),
    10,
  );
  assert_equals(
    Foldable.fold(some, 1, (state: number, item: number) => state * item),
    7,
  );
  assert_equals(
    Foldable.fold(none, 1, (state: number, item: number) => state * item),
    1,
  );
  assert_equals(
    Foldable.fold(ok, 1, (state: number, item: number) => state + item),
    10,
  );
  assert_equals(
    Foldable.fold(
      err,
      1,
      (state: number, item: number) => state + item,
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

Deno.test("Traversable flips structures through an applicative", () => {
  const array = Traversable.traverse(
    array_from_array([1, 2, 3]),
    result_ok(undefined),
    (value: number) => result_ok("value:" + value.toString()),
  );
  const record = Traversable.traverse(
    record_from_entries<number>([["a", 1], ["b", -1]]),
    result_ok(undefined),
    (value: number) => {
      if (value > 0) {
        return result_ok(value * 2);
      }

      return result_err<number>("negative: " + value.toString());
    },
  );
  const option = Traversable.traverse(
    option_some(21),
    array_from_array<unknown>([]),
    (value: number) => array_from_array([value, value * 2]),
  );
  const map = Traversable.traverse(
    map_from_entries<number>([["x", 1], ["y", 2]]),
    result_ok(undefined),
    (value: number) => result_ok(value + 1),
  );

  const array_result = array.value();
  const map_result = map.value();

  if (array_result.tag !== "ok") {
    throw new Error("expected traversed array to succeed");
  }

  if (map_result.tag !== "ok") {
    throw new Error("expected traversed map to succeed");
  }

  assert_equals(array_to_array(array_result.value), [
    "value:1",
    "value:2",
    "value:3",
  ]);
  assert_equals(record.value(), result_err("negative: -1").value());
  assert_equals(
    array_to_array(option).map((value) => value.value()),
    [option_some(21).value(), option_some(42).value()],
  );
  assert_equals(map_to_record(map_result.value), { x: 2, y: 3 });
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
  return perform(function* () {
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

function assert_trait_receiver_error(
  fn: () => unknown,
  message: string,
): void {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof TypeError)) {
      throw new Error("Expected TypeError");
    }

    assert_equals(error.message, message);
    return;
  }

  throw new Error("Expected a missing trait receiver error");
}

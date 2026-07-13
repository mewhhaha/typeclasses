import { assert_equals, assert_true } from "./assert.ts";
import {
  add_values,
  keep_positive,
  label_values,
  sum_values,
} from "./examples.ts";
import {
  Effect,
  is_effect,
  type Operation as EffectOperation,
  Program,
  run,
  type TaggedOperation,
  type Uses,
} from "./effects.ts";
import { ArrayT, type AsArray, to_array } from "./array.ts";
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
import { arr as fn_arr, Fn, fn } from "./fn.ts";
import { identity } from "./identity.ts";
import {
  from_factory as iterable_from_factory,
  to_array as iterable_to_array,
} from "./iterable.ts";
import {
  from_array as list_from_array,
  Nil,
  to_array as list_to_array,
} from "./list.ts";
import {
  from_entries as map_from_entries,
  to_record as map_to_record,
} from "./map.ts";
import {
  Just,
  type Just as MaybeJustRaw,
  Maybe,
  type Maybe as MaybeRaw,
  Nothing,
  type Nothing as MaybeNothingRaw,
} from "./maybe.ts";
import { predicate } from "./predicate.ts";
import {
  ask,
  asks,
  type AsReader,
  local,
  run_reader,
  run_reader_terminal,
} from "./reader.ts";
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
  Either,
  type Either as EitherRaw,
  from_number as either_from_number,
  Left as EitherLeft,
  type Left as EitherLeftRaw,
  Right as EitherRight,
  type Right as EitherRightRaw,
} from "./either.ts";
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
import { fst, snd, swap, tuple } from "./tuple.ts";
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
  run_state_terminal,
  State,
} from "./state.ts";
import {
  type AsWriter,
  run_writer,
  run_writer_terminal,
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
  Invalid as ValidationInvalid,
  type Invalid as ValidationInvalidRaw,
  InvalidMessages as ValidationInvalidMessages,
  Valid as ValidationValid,
  type Valid as ValidationValidRaw,
  type Validation,
} from "./validation.ts";
import { from_entries as weak_map_from_entries } from "./weak_map.ts";
import { from_iterable as weak_set_from_iterable } from "./weak_set.ts";
import {
  Alternative,
  Applicative,
  Arrow,
  Bifunctor,
  Category,
  Comonad,
  Contravariant,
  Do,
  Eq,
  Foldable,
  Functor,
  Monad,
  MonadError,
  Monoid,
  Ord,
  Parse,
  Profunctor,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";
import {
  as_data,
  as_data_cached,
  TypeclassDefinition,
  type WrappedData,
} from "./typeclass.ts";

Deno.test("Typeclass definitions inherit shared prototype helpers", () => {
  assert_equals(Object.getPrototypeOf(Show), TypeclassDefinition);
  assert_equals(Object.getPrototypeOf(Functor), TypeclassDefinition);
  assert_true(!Object.hasOwn(Show, "instance"), "Show inherits installer");
  assert_true(
    !Object.hasOwn(Functor, "instance_for"),
    "Functor inherits implementation accessor",
  );
});

Deno.test("Show and Eq typeclasses dispatch through typeclass helpers", () => {
  assert_equals(Show.show(Just(42)), "Just(42)");
  assert_equals(Show.show(Nothing()), "Nothing");
  assert_true(Eq.eq(Just("x"), Just("x")), "boxed same");
  assert_true(!Eq.eq(Just("x"), Just("y")), "boxed diff");

  const list = list_from_array([1, 2, 3]);
  assert_equals(Show.show(list), "[1, 2, 3]");
  assert_true(
    Eq.eq(list, list_from_array([1, 2, 3])),
    "boxed list",
  );

  assert_equals(Show.show(EitherRight("done")), 'Right("done")');
  assert_equals(Show.show(EitherLeft("bad")), 'Left("bad")');
  assert_true(
    Eq.eq(EitherRight("done"), EitherRight("done")),
    "boxed result",
  );
});

Deno.test("Ord compares standard contexts", () => {
  assert_equals(Ord.compare(Nothing<number>(), Just(1)), "lt");
  assert_equals(Ord.compare(Just(2), Just(1)), "gt");
  assert_equals(
    Ord.compare(EitherLeft<string, number>("missing"), EitherRight(1)),
    "lt",
  );
  assert_equals(
    Ord.compare(ArrayT([1, 2]), ArrayT([1, 3])),
    "lt",
  );
  assert_equals(
    Ord.compare(list_from_array([1, 3]), list_from_array([1, 2])),
    "gt",
  );
  assert_equals(Ord.max(identity(20), identity(42)).value(), 42);
});

Deno.test("Bifunctor and MonadError work for Either", () => {
  const mapped_left = Bifunctor.bimap(
    EitherLeft<string, number>("missing"),
    (message: string) => message.length,
    (value) => value + 1,
  );
  const mapped_right = Bifunctor.bimap(
    EitherRight<number>(41),
    (message: string) => message.length,
    (value) => value + 1,
  );
  const recovered = MonadError.catch_error(
    EitherLeft<string, number>("missing"),
    (error) => EitherRight(String(error).length),
  );
  const thrown = MonadError.throw_error(
    EitherRight<unknown>(undefined),
    "missing",
  );

  assert_equals(mapped_left.value(), EitherLeft(7).value());
  assert_equals(mapped_right.value(), EitherRight(42).value());
  assert_equals(recovered.value(), EitherRight(7).value());
  assert_equals(thrown.value(), EitherLeft("missing").value());
});

Deno.test("Contravariant maps input into Predicate", () => {
  const positive = predicate((value: number) => value > 0);
  const positive_score = Contravariant.contramap(
    positive,
    (user: { readonly score: number }) => user.score,
  );

  assert_true(positive_score.run({ score: 1 }), "positive score passes");
  assert_true(!positive_score.run({ score: -1 }), "negative score fails");
});

Deno.test("Comonad extracts and extends Identity", () => {
  const value = identity(41);
  const extended = Comonad.extend(value, (wrapped) => {
    return wrapped.value() + 1;
  });

  assert_equals(Comonad.extract(value), 41);
  assert_equals(extended.value(), 42);
});

Deno.test("Function typeclasses cover Profunctor, Category, Arrow, and Parse", () => {
  const direct = fn_arr((value: number) => value + 1);
  const named_length = Profunctor.dimap(
    fn((text: string) => text.length),
    (user: { readonly name: string }) => user.name,
    (length) => "len:" + length.toString(),
  );
  const identity_fn = Category.id(Fn);
  const composed = Category.compose(
    fn((value: number) => value * 2),
    fn((value: number) => value + 1),
  );
  const first = Arrow.first(fn((value: number) => value + 1));
  const second = Arrow.second(fn((value: number) => value + 1));
  const parsed = Parse.parse(
    fn((text: string) => Number.parseInt(text, 10)),
    "42",
  );

  assert_equals(direct.run(41), 42);
  assert_equals(named_length.run({ name: "Ada" }), "len:3");
  assert_equals(identity_fn.run("same"), "same");
  assert_equals(composed.run(20), 42);
  assert_equals(first.run([41, "ok"]), [42, "ok"]);
  assert_equals(second.run(["ok", 41]), ["ok", 42]);
  assert_equals(parsed, 42);
});

Deno.test("Tuple exposes pair helpers and maps over the second slot", () => {
  const value = tuple("count", 41);
  const mapped = Functor.map(value, (item) => item + 1);
  const both = Bifunctor.bimap(
    value,
    (label: string) => label.toUpperCase(),
    (item) => item + 1,
  );
  const traversed = Traversable.traverse(
    value,
    Just(undefined),
    (item) => Just(item + 1),
  );
  const extended = Comonad.extend(value, (wrapped) => {
    const [label, item] = wrapped.value();

    return String(label) + ":" + item.toString();
  });
  const traversed_value = traversed.value();

  assert_equals(value.value(), ["count", 41] as const);
  assert_equals(fst(value), "count");
  assert_equals(snd(value), 41);
  assert_equals(swap(value).value(), [41, "count"] as const);
  assert_equals(Show.show(value), 'Tuple("count", 41)');
  assert_true(Eq.eq(value, tuple("count", 41)), "tuple compares");
  assert_equals(Ord.compare(tuple("count", 41), tuple("count", 42)), "lt");
  assert_equals(mapped.value(), tuple("count", 42).value());
  assert_equals(both.value(), tuple("COUNT", 42).value());
  assert_equals(Comonad.extract(value), 41);
  assert_equals(extended.value(), tuple("count", "count:41").value());
  assert_equals(
    Foldable.fold(value, 1, (state, item) => state + item),
    42,
  );

  if (!Just.is(traversed_value)) {
    throw new Error("expected traversed tuple");
  }

  assert_equals(traversed_value[1].value(), tuple("count", 42).value());
});

Deno.test("Tuple tagged values can be matched by tag", () => {
  const option = match(Just(42).value(), {
    Just(value) {
      return value + 1;
    },
    Nothing() {
      return 0;
    },
  });
  const result = match(EitherLeft<string, number>("missing").value(), {
    Right(value) {
      return value.toString();
    },
    Left(message) {
      return message;
    },
  });
  const wrapped_option = match(Just(42), {
    Just(value) {
      return value + 1;
    },
    Nothing() {
      return 0;
    },
  });
  const wrapped_nothing = match(Nothing<number>(), {
    Just(value) {
      return value + 1;
    },
    Nothing() {
      return 0;
    },
  });
  const wrapped_result = match(EitherLeft<string, number>("missing"), {
    Right(value) {
      return value.toString();
    },
    Left(message) {
      return message;
    },
  });

  assert_equals(option, 43);
  assert_equals(result, "missing");
  assert_equals(wrapped_option, 43);
  assert_equals(wrapped_nothing, 0);
  assert_equals(wrapped_result, "missing");
});

Deno.test("Tuple tagged guards narrow Maybe and Either payloads", () => {
  const option = Just(42).value();
  const result = EitherLeft<string, number>("missing").value();

  assert_true(!Nothing.is(option), "option is not nothing");
  assert_true(!EitherRight.is(result), "result is not right");

  if (!Just.is(option)) {
    throw new Error("expected Just");
  }

  assert_equals(option[1] + 1, 43);

  if (!EitherLeft.is(result)) {
    throw new Error("expected Left");
  }

  assert_equals(result[1], "missing");
});

Deno.test("Constructor guards disambiguate tagged union branches", () => {
  assert_equals(describe_maybe_branch(Just(42).value()), "just:42");
  assert_equals(describe_maybe_branch(Nothing<number>().value()), "nothing");
  assert_equals(
    describe_either_branch(EitherLeft<string, number>("missing").value()),
    "left:missing",
  );
  assert_equals(
    describe_either_branch(EitherRight<string, number>(9).value()),
    "right:9",
  );
  assert_equals(
    describe_validation_branch(
      ValidationInvalidMessages<number>("missing name").value(),
    ),
    "invalid:missing name",
  );
  assert_equals(
    describe_validation_branch(ValidationValid(7).value()),
    "valid:7",
  );
});

Deno.test("Functor maps values without leaving the context", () => {
  const just = Functor.map(Just(2), (value) => value + 1);
  const nothing = Functor.map(
    Nothing<number>(),
    (value) => value + 1,
  );
  const list = Functor.map(
    list_from_array([1, 2, 3]),
    (value) => value * 2,
  );
  const right = Functor.map(
    EitherRight(20),
    (value) => value + 1,
  );
  const left = Functor.map(
    EitherLeft<string, number>("missing"),
    (value) => value + 1,
  );

  assert_equals(just.value(), Just(3).value());
  assert_equals(nothing.value(), Nothing().value());
  assert_equals(list_to_array(list), [2, 4, 6]);
  assert_equals(right.value(), EitherRight(21).value());
  assert_equals(left.value(), EitherLeft("missing").value());
});

Deno.test("Applicative applies contextual functions", () => {
  const option = Applicative.ap(
    Just((value: number) => value * 2),
    Just(21),
  );
  const nothing = Applicative.ap(
    Nothing<(value: number) => number>(),
    Just(21),
  );
  const list = Applicative.ap(
    list_from_array([
      (value: number) => value + 1,
      (value: number) => value * 10,
    ]),
    list_from_array([1, 2]),
  );

  assert_equals(option.value(), Just(42).value());
  assert_equals(nothing.value(), Nothing().value());
  assert_equals(list_to_array(list), [2, 3, 10, 20]);
});

Deno.test("Applicative lifts independent contextual values", () => {
  const option = Applicative.lift(
    (left, right) => left + right,
    Just(20),
    Just(22),
  );
  const nothing = Applicative.lift(
    (left, right) => left + right,
    Just(20),
    Nothing<number>(),
  );
  const result = Applicative.lift(
    (left, right) => left + right,
    EitherRight(40),
    EitherRight(2),
  );
  const error = Applicative.lift(
    (left, right) => left + right,
    EitherLeft<string, number>("missing"),
    EitherRight(2),
  );
  const list = Applicative.lift(
    (left, right) => left + right,
    list_from_array([1, 2]),
    list_from_array([10, 20]),
  );

  assert_equals(option.value(), Just(42).value());
  assert_equals(nothing.value(), Nothing().value());
  assert_equals(result.value(), EitherRight(42).value());
  assert_equals(error.value(), EitherLeft("missing").value());
  assert_equals(list_to_array(list), [11, 21, 12, 22]);
});

Deno.test("Applicative lift can build named structures", () => {
  const profile = Applicative.lift(
    (name, age) => ({ name, age }),
    Just("Ada"),
    Just(37),
  );
  const missing = Applicative.lift(
    (name, age) => ({ name, age }),
    Just("Ada"),
    Nothing<number>(),
  );
  const invalid_profile = Applicative.lift(
    (name, email, age) => ({ name, email, age }),
    ValidationInvalidMessages<string>("name is required"),
    ValidationInvalidMessages<string>("email is invalid"),
    ValidationValid(37),
  );

  assert_equals(
    profile.value(),
    Just({ name: "Ada", age: 37 }).value(),
  );
  assert_equals(missing.value(), Nothing().value());
  const invalid_profile_error = expect_validation_invalid(
    invalid_profile.value(),
    "expected invalid profile",
  );

  assert_equals(invalid_profile_error, [
    "name is required",
    "email is invalid",
  ]);
});

Deno.test("Maybe callable wrapper typeclasses maybe values for fluent methods", () => {
  const value = Just(41)
    .map((item) => item + 1);
  const nothing = Nothing<number>()
    .map((item) => item + 1);

  assert_equals(value.value(), Just(42).value());
  assert_equals(nothing.value(), Nothing().value());
  assert_equals(value.show(), "Just(42)");
  assert_true(value.eq(Just(42)), "option compares");
  assert_true(
    Maybe(["Just", 42]).eq(Just(42)),
    "constructor boxes raw maybe",
  );
  assert_equals(Just(42).value(), Just(42).value());
  assert_equals(Nothing().value(), Nothing().value());
  assert_true(Nothing().eq(Nothing()), "Nothing compares");
});

Deno.test("Maybe callable wrapper chains applicative ap through this", () => {
  const direct = Just((value: number) => value + 22)
    .ap(Just(20));
  const sum = Just((left: number) => {
    return (right: number) => left + right;
  })
    .ap(Just(20))
    .ap(Just(22));

  const missing = Just((left: number) => {
    return (right: number) => left + right;
  })
    .ap(Nothing<number>())
    .ap(Just(22));

  assert_equals(direct.value(), Just(42).value());
  assert_equals(sum.value(), Just(42).value());
  assert_equals(missing.value(), Nothing().value());
});

Deno.test("Typeclass dictionary methods assert a missing receiver at runtime", () => {
  assert_typeclass_receiver_error(
    () =>
      Reflect.apply(Maybe.map, undefined, [
        (value: number) => value + 1,
      ]),
  );
});

Deno.test("Typeclass helpers use symbol-scoped implementations", () => {
  const original = Maybe.show;

  try {
    Maybe.show = function show() {
      return "alias";
    };

    const value = Just(42);

    assert_equals(value.show(), "alias");
    assert_equals(Show.show(value), "Just(42)");
  } finally {
    Maybe.show = original;
  }
});

Deno.test("Data values inherit methods added after construction", () => {
  type DynamicDictionary = {
    inc?: (this: WrappedData<DynamicDictionary, number, number>) => number;
  };

  const dictionary: DynamicDictionary = {};
  const extended = dictionary as DynamicDictionary & {
    inc: (this: WrappedData<DynamicDictionary, number, number>) => number;
  };
  const value = as_data<DynamicDictionary, number, number>(extended, 41);

  extended.inc = function inc(
    this: WrappedData<DynamicDictionary, number, number>,
  ) {
    return this.value() + 1;
  };

  if (value.inc === undefined) {
    throw new Error("expected dynamic dictionary method");
  }

  assert_equals(value.inc(), 42);
});

Deno.test("Default data dictionaries are cached constructors", () => {
  assert_true(
    Object.is(as_data_cached(Maybe), Maybe),
    "default dictionary should be its cached constructor",
  );

  assert_equals(Maybe(["Just", 42]).value(), Just(42).value());
});

Deno.test("Either callable wrapper derives fluent methods from its dictionary", () => {
  const value = EitherRight(40)
    .map((item) => item + 2);
  const parsed = EitherRight("42")
    .bind((text) => either_from_number(Number.parseInt(text, 10)));
  const sum = EitherRight((left: number) => {
    return (right: number) => left + right;
  })
    .ap(EitherRight(40))
    .ap(EitherRight(2));
  const missing = EitherLeft<string, number>("missing")
    .map((item) => item + 1);

  assert_equals(value.value(), EitherRight(42).value());
  assert_equals(value.show(), "Right(42)");
  assert_true(value.eq(EitherRight(42)), "either compares");
  assert_true(
    value.eq(Either(["Right", 42])),
    "constructor boxes raw either",
  );
  assert_equals(parsed.value(), EitherRight(42).value());
  assert_equals(parsed.show(), "Right(42)");
  assert_equals(sum.value(), EitherRight(42).value());
  assert_equals(missing.value(), EitherLeft("missing").value());
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
  assert_equals(values.show(), "[2, 4, 6]");
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
      return Just(value);
    }

    return Nothing<number>();
  }

  const kept = Monad.bind(Just(4), positive);
  const dropped = Monad.bind(Just(-1), positive);
  const parsed = Monad.bind(
    EitherRight("42"),
    (text) => either_from_number(Number.parseInt(text, 10)),
  );

  assert_equals(kept.value(), Just(4).value());
  assert_equals(dropped.value(), Nothing().value());
  assert_equals(parsed.value(), EitherRight(42).value());
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
    const value = yield* Nothing<number>();

    return value + 1;
  });
  const list = Do(function* () {
    const left = yield* list_from_array([1, 2]);
    const right = yield* list_from_array([10, 20]);

    return left + right;
  });

  assert_equals(
    decoded.value(),
    EitherRight({ id: 42, label: "account:42" }).value(),
  );
  assert_equals(
    inactive.value(),
    EitherLeft("account must be active").value(),
  );
  assert_equals(
    malformed.value(),
    EitherLeft("account.id must be a string").value(),
  );
  assert_equals(missing.value(), Nothing().value());
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

Deno.test("Applicative lift rejects promise-returning Task combiners", async () => {
  const computed = Applicative.lift(
    (left, right) => Promise.resolve(left + right),
    task_succeed(20),
    task_succeed(22),
  );

  let error: unknown;

  try {
    await computed.run();
  } catch (caught) {
    error = caught;
  }

  assert_true(error instanceof TypeError, "thenable Task items are rejected");
  assert_true(
    (error as Error).message.includes("cannot produce a PromiseLike item"),
    "the rejection explains Task's item contract",
  );
});

Deno.test("Applicative lift lets Validation accumulate independent errors", () => {
  const valid_profile = Applicative.lift(
    (name, age) => ({ name, age }),
    ValidationValid("Ada"),
    ValidationValid(37),
  );
  const invalid_profile = Applicative.lift(
    (name, email, age) => ({ name, email, age }),
    ValidationInvalidMessages<string>("name is required"),
    ValidationInvalidMessages<string>("email is invalid"),
    ValidationValid(37),
  );

  assert_equals(
    valid_profile.value(),
    ValidationValid({ name: "Ada", age: 37 }).value(),
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
  assert_equals(computed.show(), "Task(?)");
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
  assert_equals(endpoint.show(), "Reader(?)");
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
  assert_equals(counter.show(), "State(?)");
});

Deno.test("Writer monad accumulates logs through Do", () => {
  const program = Do(function* () {
    yield* writer_tell(ArrayT(["start"]));
    const value = yield* writer_value(40, ArrayT(["value"]));
    yield* writer_tell(ArrayT(["end"]));

    return value + 2;
  });
  const [value, logs] = program.value() as readonly [
    number,
    ReturnType<typeof ArrayT<string>>,
  ];
  const [mapped_value, mapped_logs] = program.map((value) => value + 1)
    .value() as readonly [number, ReturnType<typeof ArrayT<string>>];

  assert_equals(value, 42);
  assert_equals(to_array(logs), ["start", "value", "end"]);
  assert_equals(mapped_value, 43);
  assert_equals(to_array(mapped_logs), ["start", "value", "end"]);
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
    yield* writer_tell(ArrayT([label + ":" + before.toString()]));

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
    (effect) => run_writer(effect, ArrayT<string>([])),
    run_task,
  ]);
  const [result_value, result_logs] = result;

  assert_equals(result_value, [{ before: 40, after: 42 }, 42]);
  assert_equals(to_array(result_logs), ["step:async:40"]);

  assert_equals(Effect.interpret(Effect.pure("done")).run(run), "done");
  assert_true(is_effect(Effect.pure("done")), "pure values are effects");
  assert_true(
    is_effect(Effect.suspend(["test"], () => Effect.pure("done"))),
    "suspended values are effects",
  );
});

Deno.test("Terminal lift runners match composable lift handlers", () => {
  assert_equals(
    run_reader_terminal(asks((value: number) => value * 3), 10),
    30,
  );
  assert_equals(run_reader_terminal(asks((value: number) => value * 3), 4), 12);

  assert_equals(run_state_terminal(gets((value: number) => value * 2), 5), [
    10,
    5,
  ]);
  assert_equals(run_state_terminal(modify((value: number) => value + 2), 40), [
    undefined,
    42,
  ]);
  const iterable_state = State(() => {
    const result = [1, 2];
    Object.defineProperty(result, Symbol.iterator, {
      value: function* () {
        yield 10;
        yield 20;
      },
    });
    return result as unknown as readonly [number, number];
  });
  assert_equals(run_state_terminal(iterable_state, 0), [10, 20]);

  const direct_writer = run_writer_terminal(
    writer_value("direct", ArrayT(["entry"])),
    ArrayT<string>([]),
  );
  assert_equals(direct_writer[0], "direct");
  assert_equals(to_array(direct_writer[1]), ["entry"]);

  const direct_writer_events: string[] = [];
  const direct_writer_empty = ArrayT<string>([]);
  Object.defineProperty(direct_writer_empty, "concat", {
    value(right: unknown) {
      direct_writer_events.push("concat");
      return right;
    },
  });
  run_writer_terminal(
    writer_value(42, ArrayT(["entry"])),
    direct_writer_empty,
  );
  assert_equals(direct_writer_events, ["concat"]);

  const reader_program = Program(function* () {
    const environment = yield* ask<number>();
    const doubled = yield* asks((value: number) => value * 2);

    return environment + doubled;
  });
  assert_equals(run_reader_terminal(reader_program, 10), 30);
  assert_equals(run_reader_terminal(reader_program, 4), 12);
  assert_equals(
    Effect.interpret(run_reader(reader_program, 10)).run(run),
    run_reader_terminal(reader_program, 10),
  );

  const state_program = Program(function* () {
    const before = yield* get<number>();
    yield* modify((value: number) => value + 2);
    const after = yield* get<number>();

    return before + after;
  });
  assert_equals(run_state_terminal(state_program, 40), [82, 42]);
  assert_equals(run_state_terminal(state_program, 1), [4, 3]);
  assert_equals(
    Effect.interpret(run_state(state_program, 40)).run(run),
    run_state_terminal(state_program, 40),
  );

  const writer_program = Program(function* () {
    yield* writer_tell(ArrayT(["start"]));
    const value = yield* writer_value(40, ArrayT(["value"]));
    yield* writer_tell(ArrayT(["end"]));

    return value + 2;
  });
  const terminal_writer = run_writer_terminal(
    writer_program,
    ArrayT<string>([]),
  );
  const composable_writer = Effect.interpret(
    run_writer(writer_program, ArrayT<string>([])),
  ).run(run);
  assert_equals(terminal_writer[0], 42);
  assert_equals(to_array(terminal_writer[1]), ["start", "value", "end"]);
  assert_equals(composable_writer[0], terminal_writer[0]);
  assert_equals(to_array(composable_writer[1]), to_array(terminal_writer[1]));

  function observe_writer_order(terminal: boolean): readonly string[] {
    const events: string[] = [];
    const empty = ArrayT<string>([]);
    Object.defineProperty(empty, "concat", {
      value(right: unknown) {
        events.push("concat");
        return right;
      },
    });
    const program = Effect.bind_from(
      writer_tell(ArrayT(["entry"])),
      () => {
        events.push("resume");
        return Effect.pure(42);
      },
    );

    if (terminal) {
      run_writer_terminal(program, empty);
    } else {
      run(run_writer(program, empty));
    }

    return events;
  }

  assert_equals(observe_writer_order(false), ["concat", "resume"]);
  assert_equals(observe_writer_order(true), ["concat", "resume"]);

  type Custom = EffectOperation<number> & readonly ["terminal.custom"];
  const custom = Effect.send(["terminal.custom"] as Custom);
  const terminal_runners = [
    () => run_reader_terminal(custom as never, 0),
    () => run_state_terminal(custom as never, 0),
    () => run_writer_terminal(custom as never, ArrayT<string>([])),
  ];

  for (const run_terminal of terminal_runners) {
    let error: unknown;

    try {
      run_terminal();
    } catch (caught) {
      error = caught;
    }

    assert_true(
      error instanceof TypeError,
      "terminal runner rejects other operations",
    );
    assert_equals(
      (error as TypeError).message,
      "Unhandled effect operation: terminal.custom",
    );
  }

  const wrong_data_runners = [
    () => run_reader_terminal(get<number>() as never, 0),
    () => run_state_terminal(ask<number>() as never, 0),
    () => run_writer_terminal(ask<number>() as never, ArrayT<string>([])),
  ];

  for (const run_terminal of wrong_data_runners) {
    let error: unknown;

    try {
      run_terminal();
    } catch (caught) {
      error = caught;
    }

    assert_true(
      error instanceof TypeError,
      "terminal runner rejects other data",
    );
    assert_equals(
      (error as TypeError).message,
      "Unhandled effect operation: lift",
    );
  }

  const malformed_runners = [
    () => run_reader_terminal(undefined as never, 0),
    () => run_state_terminal(undefined as never, 0),
    () => run_writer_terminal(undefined as never, ArrayT<string>([])),
  ];

  for (const run_terminal of malformed_runners) {
    let error: unknown;

    try {
      run_terminal();
    } catch (caught) {
      error = caught;
    }

    assert_true(
      error instanceof TypeError,
      "terminal runner rejects malformed",
    );
    assert_equals((error as TypeError).message, "Invalid effect value");
  }
});

Deno.test("Effects allow new capabilities without changing the core", () => {
  type ClockNow =
    & EffectOperation<number>
    & readonly ["clock.now"];
  type WithoutClock<requirements> = requirements extends readonly [
    "clock.now",
    ...readonly unknown[],
  ] ? never
    : requirements;

  function now(): Effect<ClockNow, number> {
    return Effect.send(["clock.now"] as ClockNow);
  }

  function run_clock<requirements, item>(
    effect: Effect<requirements, item>,
    current: number,
  ): Effect<WithoutClock<requirements>, item> {
    if (effect[0] === "pure") {
      return Effect.pure(effect[1]);
    }

    const operation = effect[1] as TaggedOperation;

    if (operation[0] === "clock.now") {
      return run_clock(effect[2](current), current);
    }

    return Effect.suspend(
      effect[1] as WithoutClock<requirements>,
      (value) => run_clock(effect[2](value), current),
    );
  }

  const program = Program(function* () {
    const current = yield* now();

    return current + 1;
  });

  assert_equals(Effect.interpret(run_clock(program, 41)).run(run), 42);
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
  assert_equals(transfer.show(), "Stm(?)");
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
  const just = Just(7);
  const nothing = Nothing<number>();
  const right = EitherRight(9);
  const left = EitherLeft<string, number>("no value");

  assert_equals(
    Foldable.fold(
      list,
      0,
      (state, item) => state + item,
    ),
    10,
  );
  assert_equals(
    Foldable.fold(just, 1, (state, item) => state * item),
    7,
  );
  assert_equals(
    Foldable.fold(nothing, 1, (state, item) => state * item),
    1,
  );
  assert_equals(
    Foldable.fold(right, 1, (state, item) => state + item),
    10,
  );
  assert_equals(
    Foldable.fold(
      left,
      1,
      (state, item) => state + item,
    ),
    1,
  );
});

Deno.test("Semigroup and Monoid combine collection contexts", () => {
  const list = Semigroup.concat(list_from_array([1, 2]), list_from_array([3]));
  const array = Semigroup.concat(
    ArrayT([1, 2]),
    ArrayT([3]),
  );
  const record = Semigroup.concat(
    record_from_entries<number>([["left", 1], ["shared", 1]]),
    record_from_entries<number>([["shared", 2], ["right", 3]]),
  );
  const empty_array = Monoid.empty(ArrayT<number>([]));

  assert_equals(list_to_array(list), [1, 2, 3]);
  assert_equals(to_array(array), [1, 2, 3]);
  assert_equals(record_to_record(record), {
    left: 1,
    shared: 2,
    right: 3,
  });
  assert_equals(to_array(empty_array), []);
});

Deno.test("Alternative chooses fallback or combines list-like contexts", () => {
  const option = Alternative.alt(Nothing<number>(), Just(42));
  const kept = Alternative.alt(Just(1), Just(2));
  const list = Alternative.alt(list_from_array([1, 2]), list_from_array([3]));
  const array = Alternative.alt(ArrayT([1]), ArrayT([2]));
  const empty_option = Alternative.empty(Just(0));

  assert_equals(option.value(), Just(42).value());
  assert_equals(kept.value(), Just(1).value());
  assert_equals(list_to_array(list), [1, 2, 3]);
  assert_equals(to_array(array), [1, 2]);
  assert_equals(empty_option.value(), Nothing().value());
});

Deno.test("Built-in wrappers map and fold over values", () => {
  const array = ArrayT([1, 2, 3])
    .bind((value) => ArrayT([value, value * 10]));
  const map = map_from_entries<number>([["a", 1], ["b", 2]])
    .map((value) => "value:" + value.toString());
  const record = record_from_entries<number>([["a", 1], ["b", 2]])
    .map((value) => value * 2);
  const map_sum = Foldable.fold(
    map_from_entries<number>([["a", 1], ["b", 2]]),
    0,
    (state, value) => state + value,
  );

  assert_equals(to_array(array), [1, 10, 2, 20, 3, 30]);
  assert_equals(map_to_record(map), { a: "value:1", b: "value:2" });
  assert_equals(record_to_record(record), { a: 2, b: 4 });
  assert_equals(map_sum, 3);
});

Deno.test("JavaScript shape wrappers expose conservative typeclasses", async () => {
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
    ["tag", "typeclasses"],
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
  const regexp = from_regexp(/^typeclasses$/iu);
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
    ["tag", "typeclasses"],
    ["tag", "typescript"],
  ]);
  assert_equals(form_data_to_entries(form_data), [
    ["name", "Ada"],
    ["email", "ada@example.test"],
  ]);
  assert_equals(weak_map.show(), "WeakMap(?)");
  assert_equals(weak_set.show(), "WeakSet(?)");
  assert_true(Eq.eq(date, same_date), "dates compare by time value");
  assert_equals(date.show(), "2024-01-02T03:04:05.000Z");
  assert_equals(regexp.show(), "/^typeclasses$/iu");
  assert_equals(error.show(), "TypeError: expected value");
});

Deno.test("Traversable flips structures through an applicative", () => {
  const array = Traversable.traverse(
    ArrayT([1, 2, 3]),
    EitherRight(undefined),
    (value) => EitherRight("value:" + value.toString()),
  );
  const record = Traversable.traverse(
    record_from_entries<number>([["a", 1], ["b", -1]]),
    EitherRight(undefined),
    (value) => {
      if (value > 0) {
        return EitherRight(value * 2);
      }

      return EitherLeft<string, number>("negative: " + value.toString());
    },
  );
  const option = Traversable.traverse(
    Just(21),
    ArrayT<unknown>([]),
    (value) => ArrayT([value, value * 2]),
  );
  const map = Traversable.traverse(
    map_from_entries<number>([["x", 1], ["y", 2]]),
    EitherRight(undefined),
    (value) => EitherRight(value + 1),
  );
  const empty_array = Traversable.traverse(
    ArrayT<number>([]),
    EitherRight(undefined),
    (value) => EitherRight(value.toString()),
  );
  const empty_list = Traversable.traverse(
    list_from_array<number>([]),
    EitherRight(undefined),
    (value) => EitherRight(value.toString()),
  );
  const empty_map = Traversable.traverse(
    map_from_entries<number>([]),
    EitherRight(undefined),
    (value) => EitherRight(value.toString()),
  );
  const empty_record = Traversable.traverse(
    record_from_entries<number>([]),
    EitherRight(undefined),
    (value) => EitherRight(value.toString()),
  );

  const array_result = expect_either_right(
    array.value(),
    "expected traversed array to succeed",
  );
  const map_result = expect_either_right(
    map.value(),
    "expected traversed map to succeed",
  );
  const empty_array_result = expect_either_right(
    empty_array.value(),
    "expected empty traversed array to succeed",
  );
  const empty_list_result = expect_either_right(
    empty_list.value(),
    "expected empty traversed list to succeed",
  );
  const empty_map_result = expect_either_right(
    empty_map.value(),
    "expected empty traversed map to succeed",
  );
  const empty_record_result = expect_either_right(
    empty_record.value(),
    "expected empty traversed record to succeed",
  );

  assert_equals(to_array(array_result), [
    "value:1",
    "value:2",
    "value:3",
  ]);
  assert_equals(record.value(), EitherLeft("negative: -1").value());
  assert_equals(
    to_array(option).map((value) => value.value()),
    [Just(21).value(), Just(42).value()],
  );
  assert_equals(map_to_record(map_result), { x: 2, y: 3 });
  assert_equals(to_array(empty_array_result), []);
  assert_equals(list_to_array(empty_list_result), []);
  assert_equals(map_to_record(empty_map_result), {});
  assert_equals(record_to_record(empty_record_result), {});
});

Deno.test("Generic helpers work against typeclass interfaces", () => {
  const option = label_values(Just(5));
  const list = label_values(list_from_array([1, 2]));
  const result = label_values(EitherRight(3));

  assert_equals(option.value(), Just("value:5").value());
  assert_equals(list_to_array(list), ["value:1", "value:2"]);
  assert_equals(result.value(), EitherRight("value:3").value());
  assert_equals(sum_values(list_from_array([1, 2, 3])), 6);
});

Deno.test("Generic applicative helper combines contextual values", () => {
  const option = add_values(Just(20), Just(22));
  const nothing = add_values(Just(20), Nothing<number>());
  const result = add_values(EitherRight(40), EitherRight(2));
  const left = add_values(
    EitherLeft<string, number>("missing"),
    EitherRight(2),
  );
  const list = add_values(
    list_from_array([1, 10]),
    list_from_array([2, 20]),
  );

  assert_equals(option.value(), Just(42).value());
  assert_equals(nothing.value(), Nothing().value());
  assert_equals(result.value(), EitherRight(42).value());
  assert_equals(left.value(), EitherLeft("missing").value());
  assert_equals(list_to_array(list), [3, 21, 12, 30]);
});

Deno.test("Generic monad helper lets each context define failure", () => {
  const option = keep_positive(
    Just(-1),
    () => Nothing(),
  );
  const result = keep_positive(
    EitherRight(-1),
    (value) => EitherLeft("negative: " + value.toString()),
  );
  const list = keep_positive(
    list_from_array([2, -1, 3]),
    () => Nil(),
  );

  assert_equals(option.value(), Nothing().value());
  assert_equals(result.value(), EitherLeft("negative: -1").value());
  assert_equals(list_to_array(list), [2, 3]);
});

function describe_maybe_branch(value: MaybeRaw<number>): string {
  if (Just.is(value)) {
    const just: MaybeJustRaw<number> = value;
    return "just:" + just[1].toString();
  }

  const nothing: MaybeNothingRaw = value;
  return nothing[0].toLowerCase();
}

function describe_either_branch(value: EitherRaw<string, number>): string {
  if (EitherLeft.is(value)) {
    const left: EitherLeftRaw<string> = value;
    return "left:" + left[1];
  }

  const right: EitherRightRaw<number> = value;
  return "right:" + right[1].toString();
}

function describe_validation_branch(
  value: Validation<readonly string[], number>,
): string {
  if (ValidationInvalid.is(value)) {
    const invalid: ValidationInvalidRaw<readonly string[]> = value;
    return "invalid:" + invalid[1].join(", ");
  }

  const valid: ValidationValidRaw<number> = value;
  return "valid:" + valid[1].toString();
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
    const id = yield* either_from_number(Number.parseInt(id_text, 10));

    yield* require_true(active, "account must be active");

    return { id, label: "account:" + id.toString() };
  });
}

function object_value(value: unknown, name: string) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return EitherRight(value as Record<string, unknown>);
  }

  return EitherLeft<string, Record<string, unknown>>(
    name + " must be an object",
  );
}

function field(record: Record<string, unknown>, name: string) {
  if (Object.hasOwn(record, name)) {
    return EitherRight(record[name]);
  }

  return EitherLeft<string, unknown>(name + " is missing");
}

function string_value(value: unknown, name: string) {
  if (typeof value === "string") {
    return EitherRight(value);
  }

  return EitherLeft<string>(name + " must be a string");
}

function boolean_value(value: unknown, name: string) {
  if (typeof value === "boolean") {
    return EitherRight(value);
  }

  return EitherLeft<string, boolean>(name + " must be a boolean");
}

function require_true(value: boolean, message: string) {
  if (value) {
    return EitherRight(undefined);
  }

  return EitherLeft<string, void>(message);
}

function expect_either_right<item, error>(
  result: Either<error, item>,
  message: string,
): item {
  if (!EitherRight.is(result)) {
    throw new Error(message);
  }

  return result[1];
}

function expect_validation_invalid<error, item>(
  validation: Validation<error, item>,
  message: string,
): error {
  if (!ValidationInvalid.is(validation)) {
    throw new Error(message);
  }

  return validation[1];
}

function assert_typeclass_receiver_error(
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

  throw new Error("Expected a missing typeclass receiver error");
}

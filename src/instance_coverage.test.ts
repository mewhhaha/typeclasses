import { assert_equals } from "./assert.ts";
import { ArrayT } from "./array.ts";
import { Fn, fn } from "./fn.ts";
import { Just, Maybe, Nothing } from "./maybe.ts";
import { RecordT } from "./record.ts";
import { Task } from "./task.ts";
import { Tuple } from "./tuple.ts";
import {
  Invalid,
  InvalidMessages,
  map_error,
  Valid,
  Validation,
} from "./validation.ts";
import { MonadError, Ord } from "./typeclasses.ts";

Deno.test("Validation maps errors with an explicit target semigroup", () => {
  const strings = {
    concat: (left: string, right: string) => left + ": " + right,
  };
  const invalid = map_error(
    InvalidMessages<number>("missing", "invalid"),
    (errors) => errors.join(": "),
    strings,
  );
  const Errors = Validation.with_semigroup(strings);
  const combined = Errors.Invalid<(value: number) => number>("first")
    .ap(Errors.Invalid<number>("second"));

  assert_equals(invalid.value()[1], "missing: invalid");
  assert_equals(combined.value()[1], "first: second");
});

Deno.test("Validation rejects errors created with different semigroups", () => {
  const SumErrors = Validation.with_semigroup({
    concat: (left: number, right: number) => left + right,
  });
  const MaxErrors = Validation.with_semigroup({
    concat: (left: number, right: number) => Math.max(left, right),
  });
  let thrown: unknown;

  try {
    SumErrors.Invalid<(value: number) => number>(1)
      .ap(MaxErrors.Invalid<number>(2));
  } catch (error) {
    thrown = error;
  }

  assert_equals(thrown instanceof TypeError, true);
  assert_equals(
    thrown instanceof TypeError &&
      /left #\d+, right #\d+/.test(thrown.message),
    true,
  );
});

Deno.test("Validation guards reject malformed tagged tuples", () => {
  const semigroup = { concat: (left: string) => left };

  assert_equals(Valid.is(["valid", 42]), true);
  assert_equals(Valid.is(["valid"]), false);
  assert_equals(Valid.is(["valid", 42, "extra"]), false);
  assert_equals(Invalid.is(["invalid", "missing", semigroup]), true);
  assert_equals(Invalid.is(["invalid", "missing"]), false);
  assert_equals(Invalid.is(["invalid", "missing", {}]), false);
});

Deno.test("Validation Ord orders Invalid before Valid and compares payloads", () => {
  const strings = Validation.with_semigroup<string>({
    concat: (left, right) => left + right,
  });

  assert_equals(
    Ord.compare(
      strings.Invalid<number>("a"),
      strings.Invalid<number>("b"),
    ),
    "lt",
  );
  assert_equals(
    Ord.compare(
      strings.Invalid<number>("error"),
      strings.Valid(0),
    ),
    "lt",
  );
  assert_equals(Ord.compare(strings.Valid(2), strings.Valid(1)), "gt");
  assert_equals(Ord.compare(strings.Valid(1), strings.Valid(3)), "lt");
});

Deno.test("Task MonadError rejects, recovers, and preserves successes", async () => {
  const failure = MonadError.throw_error<typeof Task, number>(
    Task,
    new Error("boom"),
  );
  const recovered = MonadError.catch_error(failure, (error) => {
    return Task.pure((error as Error).message.length);
  });
  const untouched = MonadError.catch_error(Task.pure(42), () => Task.pure(0));

  assert_equals(await recovered.run(), 4);
  assert_equals(await untouched.run(), 42);
});

Deno.test("Fn provides the Reader Applicative and Monad", () => {
  const StringFn = Fn.with_input<string>();
  const length = fn((input: string) => input.length);
  const applied = StringFn.pure((value: number) => value * 2).ap(length);
  const bound = length.bind((value) => {
    return fn((input: string) => value + input.length);
  });

  assert_equals(StringFn.pure(42).run("ignored"), 42);
  assert_equals(applied.run("four"), 8);
  assert_equals(bound.run("four"), 8);

  const left_identity = StringFn.pure(3).bind((value) => {
    return fn((input: string) => value + input.length);
  });
  const direct = fn((input: string) => 3 + input.length);
  assert_equals(left_identity.run("abc"), direct.run("abc"));

  const right_identity = length.bind((value) => StringFn.pure(value));
  assert_equals(right_identity.run("abc"), length.run("abc"));

  const double = (value: number) => StringFn.pure(value * 2);
  const increment = (value: number) => StringFn.pure(value + 1);
  assert_equals(
    length.bind(double).bind(increment).run("abc"),
    length.bind((value) => double(value).bind(increment)).run("abc"),
  );
});

Deno.test("Tuple.with_monoid provides the writer tuple Monad", () => {
  const Pair = Tuple.with_monoid(ArrayT<string>([]));
  const first = Pair([ArrayT(["first"]), 20] as const);
  const chained = first.bind((value) => {
    return Pair([ArrayT(["second"]), value + 22] as const);
  });
  const [log, value] = chained.value();
  const [pure_log, pure_value] = Pair.pure(42).value();

  assert_equals(log.value(), ["first", "second"]);
  assert_equals(value, 42);
  assert_equals(pure_log.value(), []);
  assert_equals(pure_value, 42);

  const append = (item: number) => {
    return Pair([ArrayT(["append"]), item + 1] as const);
  };
  const double = (item: number) => {
    return Pair([ArrayT(["double"]), item * 2] as const);
  };
  const left_identity = Pair.pure(1).bind(append).value();
  const direct = append(1).value();
  assert_equals(
    [left_identity[0].value(), left_identity[1]],
    [direct[0].value(), direct[1]],
  );
  const right_identity = first.bind((item) => Pair.pure(item)).value();
  assert_equals(
    [right_identity[0].value(), right_identity[1]],
    [first.value()[0].value(), first.value()[1]],
  );
  const associated_left = first.bind(append).bind(double).value();
  const associated_right = first.bind((item) => append(item).bind(double))
    .value();
  assert_equals(
    [associated_left[0].value(), associated_left[1]],
    [associated_right[0].value(), associated_right[1]],
  );
});

Deno.test("Maybe Monoid is first-biased and lawful", () => {
  assert_equals(Nothing<number>().concat(Just(1)).value(), ["Just", 1]);
  assert_equals(Just(1).concat(Nothing<number>()).value(), ["Just", 1]);
  assert_equals(Just(1).concat(Just(2)).value(), ["Just", 1]);
  assert_equals(Maybe.empty<number>().value(), ["Nothing"]);

  const left = Just(1).concat(Just(2)).concat(Just(3));
  const right = Just(1).concat(Just(2).concat(Just(3)));
  assert_equals(left.value(), right.value());
});

Deno.test("RecordT Ord compares sorted entries lexicographically", () => {
  assert_equals(Ord.compare(RecordT({ b: 0 }), RecordT({ a: 99 })), "gt");
  assert_equals(Ord.compare(RecordT({ a: 1 }), RecordT({ a: 2 })), "lt");
  assert_equals(Ord.compare(RecordT({ a: 1 }), RecordT({ a: 1 })), "eq");
});

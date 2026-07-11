import { assert_equals } from "./assert.ts";
import { ArrayT } from "./array.ts";
import { Fn, fn } from "./fn.ts";
import { Just, Maybe, Nothing } from "./maybe.ts";
import { RecordT } from "./record.ts";
import { Task } from "./task.ts";
import { Tuple } from "./tuple.ts";
import { InvalidMessages, Valid, Validation } from "./validation.ts";
import { Bifunctor, MonadError, Ord } from "./typeclasses.ts";

Deno.test("Validation Bifunctor maps both branches", () => {
  const invalid = Bifunctor.bimap(
    InvalidMessages<number>("missing", "invalid"),
    (errors) => errors.join(": "),
    (value: number) => value + 1,
  );
  const valid = Bifunctor.bimap(
    Valid(41),
    (error: unknown) => String(error),
    (value) => value + 1,
  );

  assert_equals(invalid.value()[1], "missing: invalid");
  assert_equals(valid.value()[1], 42);

  const twice = Bifunctor.map_left(
    Bifunctor.map_left(
      InvalidMessages<number>("bad"),
      (errors) => errors.join(""),
    ),
    (error) => error.length,
  );
  const composed = Bifunctor.map_left(
    InvalidMessages<number>("bad"),
    (errors) => errors.join("").length,
  );

  assert_equals(twice.value()[1], composed.value()[1]);

  const twice_full = Bifunctor.bimap(
    Bifunctor.bimap(
      InvalidMessages<number>("bad"),
      (errors) => errors.join(""),
      (value: number) => value + 1,
    ),
    (error) => error.length,
    (value) => value * 2,
  );
  const composed_full = Bifunctor.bimap(
    InvalidMessages<number>("bad"),
    (errors) => errors.join("").length,
    (value: number) => (value + 1) * 2,
  );
  assert_equals(twice_full.eq(composed_full), true);

  const valid_twice = Bifunctor.bimap(
    Bifunctor.bimap(
      Valid(20),
      (error: unknown) => String(error),
      (value) => value + 1,
    ),
    (error) => error.length,
    (value) => value * 2,
  );
  const valid_composed = Bifunctor.bimap(
    Valid(20),
    (error: unknown) => String(error).length,
    (value) => (value + 1) * 2,
  );
  assert_equals(valid_twice.eq(valid_composed), true);

  const identity = Bifunctor.bimap(
    Valid(42),
    (error: unknown) => error,
    (value) => value,
  );
  assert_equals(identity.value(), Valid(42).value());
});

Deno.test("Validation Ord orders Invalid before Valid and compares payloads", () => {
  const strings = Validation.with_error<string>();

  assert_equals(
    Ord.compare(
      strings.Invalid<number>("a", { concat: (left) => left }),
      strings.Invalid<number>("b", { concat: (left) => left }),
    ),
    "lt",
  );
  assert_equals(
    Ord.compare(
      strings.Invalid<number>("error", { concat: (left) => left }),
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

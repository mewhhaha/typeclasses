import { assert_equals } from "./assert.ts";
import { Either, type EitherValue, Left, Right } from "./either.ts";
import { from_nullable, type MaybeValue } from "./maybe.ts";
import { kind } from "./typeclass.ts";
import { Do, Functor, Monad } from "./typeclasses.ts";
import {
  Invalid,
  InvalidMessages,
  Valid,
  Validation,
  type ValidationSemigroup,
  type ValidationValue,
} from "./validation.ts";

Deno.test("Either branch aliases share inferred and explicit constructor types", () => {
  assert_equals(Either.Left, Left);
  assert_equals(Either.Right, Right);

  const inferred = Either.Right(1).bind((value) =>
    value > 0 ? Right(value + 1) : Left("missing")
  );
  const mapped = Either.Left("missing").map((value: number) => value + 1);
  const explicit = Either.Right<string, number>(1).bind((value) =>
    Either.Right<string, number>(value + 1)
  );
  const raw = Either(["Right", 1]).map((value) => value + 1);

  expect_type<EitherValue<string, number>>(inferred);
  expect_type<EitherValue<string, number>>(mapped);
  expect_type<EitherValue<string, number>>(explicit);
  assert_equals(inferred.value(), ["Right", 2]);
  assert_equals(mapped.value(), ["Left", "missing"]);
  assert_equals(explicit.value(), ["Right", 2]);
  assert_equals(raw.value(), ["Right", 2]);

  // @ts-expect-error explicit left types still reject a different error payload
  Either.Left<number, string>("missing");
  // @ts-expect-error explicit right types still reject a different value
  Either.Right<string, number>("one");
});

Deno.test("Either branch guards validate tuple shape and preserve payload types", () => {
  for (const malformed of [null, [], ["Left"], ["Left", 1, 2]]) {
    assert_equals(Either.Left.is(malformed), false);
  }
  for (const malformed of [null, [], ["Right"], ["Right", 1, 2]]) {
    assert_equals(Either.Right.is(malformed), false);
  }

  const left = Either.Left("missing").value();
  const right = Either.Right(1).value();

  assert_equals(Either.Left.is(left), true);
  assert_equals(Either.Right.is(right), true);
  expect_type<string>(left[1]);
  expect_type<number>(right[1]);
});

Deno.test("Validation branch aliases infer errors and compose successful functions", () => {
  assert_equals(Validation.Valid, Valid);
  assert_equals(Validation.Invalid, Invalid);

  const semigroup: ValidationSemigroup<readonly string[]> = {
    concat: (left, right) => [...left, ...right],
  };
  const invalid = Validation.Invalid<readonly string[], number>(
    ["missing"],
    semigroup,
  );
  const applied = Validation.Valid((value: number) => value + 1).ap(
    InvalidMessages<number>("missing"),
  );
  const raw = Validation(["valid", 1]).map((value) => value + 1);

  expect_type<ValidationValue<readonly string[], number>>(invalid);
  expect_type<ValidationValue<readonly string[], number>>(applied);
  assert_equals(invalid.value(), ["invalid", ["missing"], semigroup]);
  assert_equals(applied.value().slice(0, 2), ["invalid", ["missing"]]);
  assert_equals(raw.value(), ["valid", 2]);

  // @ts-expect-error explicit error types still reject a different error payload
  Validation.Invalid<number, string>(["missing"], semigroup);
});

Deno.test("Validation guards reject errors without usable accumulation rules", () => {
  const semigroup = { concat: (left: string, right: string) => left + right };
  for (
    const malformed of [
      null,
      ["invalid", "missing"],
      ["invalid", "missing", null],
      ["invalid", "missing", {}],
      ["invalid", "missing", { concat: 1 }],
      ["invalid", "missing", semigroup, "extra"],
    ]
  ) {
    assert_equals(Validation.Invalid.is(malformed), false);
    assert_equals(Invalid.is(malformed), false);
  }
  assert_equals(Validation.Invalid.is(["invalid", "missing", semigroup]), true);
  assert_equals(Validation.Valid.is(["valid", 1]), true);
  assert_equals(Validation.Valid.is(["valid", 1, "extra"]), false);
});

Deno.test("configured dictionary views retain branch types and guards", () => {
  const Result = Either.with_left<string>();
  const good = Result.Right(1);
  const bad = Result.Left<number>("missing");
  expect_type<EitherValue<string, number>>(good);
  expect_type<EitherValue<string, number>>(bad);
  assert_equals(Result.Right, Right);
  assert_equals(Object.is(Result.Left, Left), true);

  const semigroup: ValidationSemigroup<readonly string[]> = {
    concat: (left, right) => [...left, ...right],
  };
  const Errors = Validation.with_semigroup(semigroup);
  const ErrorView = Validation.with_error<readonly string[]>();
  const valid = Errors.Valid(1).map((value) => value + 1);
  const invalid = Errors.Invalid<number>(["missing"]);
  const viewed = ErrorView.Invalid<number>(["missing"], semigroup);
  const applied = Errors.Valid((value: number) => value + 1).ap(invalid);

  expect_type<ValidationValue<readonly string[], number>>(valid);
  expect_type<ValidationValue<readonly string[], number>>(invalid);
  expect_type<ValidationValue<readonly string[], number>>(viewed);
  expect_type<ValidationValue<readonly string[], number>>(applied);
  assert_equals(valid.value(), ["valid", 2]);
  assert_equals(invalid.value(), viewed.value());
  assert_equals(Errors[kind], Validation[kind]);
  assert_equals(invalid[kind], Validation[kind]);
  assert_equals(Errors.Invalid.is, Invalid.is);
  assert_equals(Errors.Valid.is, Valid.is);
  assert_equals(ErrorView.Invalid.is, Invalid.is);
  assert_equals(Errors.Invalid.is(["invalid", ["missing"], {}]), false);
  assert_equals(Errors.Invalid.is(invalid.value()), true);
});

Deno.test("pure Either fluent chains infer their eventual error payload", () => {
  const chained = Right(1).map((value) => value + 1).bind((value) =>
    value > 2 ? Right(value) : Left({ code: "missing" })
  );
  const recovered = chained.catch_error((error) => {
    expect_type<{ code: string }>(error);
    // @ts-expect-error recovery errors are concrete objects rather than any
    expect_type<number>(error);
    // @ts-expect-error a recovery error has no invented methods
    expect_type<() => void>(error.nonexistent);
    return Right(error.code.length);
  });
  const still_pure = Right(1).map((value) => value + 1).bind((value) =>
    Right(value + 1)
  );

  expect_type<EitherValue<{ code: string }, number>>(chained);
  expect_type<EitherValue<{ code: string }, number>>(recovered);
  expect_type<EitherValue<never, number>>(still_pure);
  assert_equals(chained.value(), ["Left", { code: "missing" }]);
  assert_equals(recovered.value(), ["Right", 7]);
  assert_equals(still_pure.value(), ["Right", 3]);
});

Deno.test("pure Either values interoperate with generic and applicative methods", () => {
  const mapped = Functor.map(
    Right(1).map((value) => value + 1),
    (value) => value + 1,
  );
  const bound = Monad.bind(Right(1), (value) => Right(value + 1));
  const sequenced = Do(function* () {
    const first = yield* Right(1).map((value) => value + 1);
    const second = yield* Right(first + 1);
    return first + second;
  });
  const applied = Right((value: number) => value + 1).ap(Right(1));

  expect_type<EitherValue<string, number>>(mapped);
  expect_type<EitherValue<string, number>>(bound);
  expect_type<EitherValue<string, number>>(sequenced);
  expect_type<EitherValue<string, number>>(applied);
  assert_equals(mapped.value(), ["Right", 3]);
  assert_equals(bound.value(), ["Right", 2]);
  assert_equals(sequenced.value(), ["Right", 5]);
  assert_equals(applied.value(), ["Right", 2]);
});

Deno.test("from_nullable exposes only non-null payloads", () => {
  const explicit = from_nullable<string | null | undefined>("Ada").map(
    (value) => {
      expect_type<string>(value);
      return value.toUpperCase();
    },
  );
  const null_value = from_nullable(null);
  const undefined_value = from_nullable(undefined);
  const explicit_null = from_nullable<string>(null);
  const explicit_undefined = from_nullable<string>(undefined);

  expect_type<MaybeValue<string>>(explicit);
  expect_type<MaybeValue<never>>(null_value);
  expect_type<MaybeValue<never>>(undefined_value);
  expect_type<MaybeValue<string>>(explicit_null);
  expect_type<MaybeValue<string>>(explicit_undefined);
  assert_equals(explicit.value(), ["Just", "ADA"]);
  assert_equals(null_value.value(), ["Nothing"]);
  assert_equals(undefined_value.value(), ["Nothing"]);
  assert_equals(explicit_null.value(), ["Nothing"]);
  assert_equals(explicit_undefined.value(), ["Nothing"]);
});

function expect_type<expected>(_value: expected): void {}

import {
  type AsEither,
  type Either,
  Either as EitherT,
  Left,
  Right,
} from "./either.ts";
import { type AsFn, Fn, fn } from "./fn.ts";
import type { Data } from "./typeclass.ts";
import { Category, Do } from "./typeclasses.ts";
import { type AsTuple, Tuple, tuple } from "./tuple.ts";
import {
  type AsValidation,
  Invalid,
  Valid,
  type Validation,
  Validation as ValidationT,
} from "./validation.ts";

Deno.test("fixed context parameters survive typeclass operations", () => {
  const left = Left<string, number>("missing").map((value) => value > 0);
  const right = Right<string, number>(41).map((value) => value + 1);
  const bound = Right<string, number>(41).bind((value) => {
    return Right<string, number>(value + 1);
  });
  const pair = tuple("count", 41).map((value) => value + 1);
  const invalid = Invalid<readonly string[], number>(["missing"], {
    concat: (first, second) => [...first, ...second],
  }).map((value) => value + 1);
  const applied = Invalid<readonly string[], (value: number) => number>(
    ["missing"],
    { concat: (first, second) => [...first, ...second] },
  ).ap(Valid(41));
  const valid_raw: Validation<readonly string[], number> = ["valid", 41];
  const valid = ValidationT(valid_raw).map((value) => value + 1);
  const StringEither = EitherT.withLeft<string>();
  // deno-lint-ignore require-yield -- verifies fixed-parameter pure through Do
  const fixed_do = Do(StringEither, function* () {
    return 42;
  });
  const fixed_right = StringEither.Right(41).map((value) => value + 1);
  const StringTuple = Tuple.withLeft<string>();
  const fixed_pair = StringTuple(["count", 42]);
  const Errors = ValidationT.withError<readonly string[]>();
  const fixed_valid = Errors.pure(42);
  const fixed_constructor_valid = Errors.Valid(42);
  const bimapped_either = Left<string, number>("missing").bimap(
    (message) => message.length,
    (value) => value > 0,
  );
  const bimapped_pair = tuple("count", 41)
    .bimap(
      (label) => label.length,
      (value) => value.toString(),
    )
    .map((value) => value.length);
  const named_length = fn((text: string) => text.length).dimap(
    (user: { readonly name: string }) => user.name,
    (length) => "length:" + length.toString(),
  );
  const composed = Category.compose(
    fn((value: number) => value * 2),
    fn((text: string) => text.length),
  );
  const fluent_composed = fn((value: number) => value * 2).compose(
    fn((text: string) => text.length),
  );
  const StringFn = Fn.withInput<string>();
  const fixed_fn = StringFn((text) => text.length);
  const identity_fn = Fn.id<string>();
  const arrow_fn = Fn.arr((value: number) => value + 1);

  expect_type<Data<AsEither<string>, boolean>>(left);
  expect_type<Data<AsEither<string>, number>>(right);
  expect_type<Data<AsEither<string>, number>>(bound);
  expect_type<Data<AsTuple<string>, number>>(pair);
  expect_type<Data<AsValidation<readonly string[]>, number>>(invalid);
  expect_type<Data<AsValidation<readonly string[]>, number>>(applied);
  expect_type<Data<AsValidation<readonly string[]>, number>>(valid);
  expect_type<Data<AsEither<string>, number>>(fixed_do);
  expect_type<Data<AsEither<string>, number>>(fixed_right);
  expect_type<Data<AsTuple<string>, number>>(fixed_pair);
  expect_type<Data<AsValidation<readonly string[]>, number>>(fixed_valid);
  expect_type<Data<AsValidation<readonly string[]>, number>>(
    fixed_constructor_valid,
  );
  expect_type<Data<AsEither<number>, boolean>>(bimapped_either);
  expect_type<Data<AsTuple<number>, number>>(bimapped_pair);
  expect_type<Data<AsFn<{ readonly name: string }>, string>>(named_length);
  expect_type<Data<AsFn<string>, number>>(composed);
  expect_type<Data<AsFn<string>, number>>(fluent_composed);
  expect_type<Data<AsFn<string>, number>>(fixed_fn);
  expect_type<Data<AsFn<string>, string>>(identity_fn);
  expect_type<Data<AsFn<number>, number>>(arrow_fn);

  expect_type<Either<string, boolean>>(left.value());
  expect_type<Either<string, number>>(right.value());
  expect_type<readonly [string, number]>(pair.value());
  expect_type<Validation<readonly string[], number>>(invalid.value());
  expect_type<Validation<readonly string[], number>>(valid.value());
  expect_type<Either<number, boolean>>(bimapped_either.value());
  expect_type<readonly [number, number]>(bimapped_pair.value());
  expect_type<string>(named_length.run({ name: "Ada" }));
  expect_type<number>(composed.run("Ada"));
  expect_type<string>(identity_fn.run("same"));
  expect_type<number>(arrow_fn.run(41));

  // @ts-expect-error the fixed Either parameter is part of the dictionary
  expect_type<Data<AsEither<number>, boolean>>(left);
  // @ts-expect-error the fixed Tuple parameter is part of the dictionary
  expect_type<Data<AsTuple<number>, number>>(pair);
  // @ts-expect-error the Validation error type is part of the dictionary
  expect_type<Data<AsValidation<number>, number>>(invalid);
});

function expect_type<expected>(_value: expected): void {}

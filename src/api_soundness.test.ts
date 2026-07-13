import { assert_equals } from "./assert.ts";
import { Either } from "./either.ts";
import type { Uses, WithoutLift } from "./effects.ts";
import { fn } from "./fn.ts";
import { Just, Maybe } from "./maybe.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Applicative, MonadError, Parse } from "./typeclasses.ts";

type Box<item> = readonly ["Box", item];

declare const first_identity: unique symbol;
declare const second_identity: unique symbol;

interface AsFirst extends As<AsFirst, typeof first_identity> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

interface AsSecond extends As<AsSecond, typeof second_identity> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

// @ts-expect-error every dictionary family requires an explicit identity token
interface AsUnidentified extends As<AsUnidentified> {
  readonly [type_item]: unknown;
  readonly [type_data]: Box<this[typeof type_item]>;
}

const First = data<AsFirst>();
const Second = data<AsSecond>();

Deno.test("wrapped values retain fluent methods without becoming callable", () => {
  const incremented = Just(41).map((value) => value + 1);

  assert_equals(typeof incremented, "object");
  assert_equals(incremented.value(), ["Just", 42] as const);
});

Deno.test("MonadError preserves a configured Either error type", () => {
  const Strings = Either.with_left<string>();
  const recovered = Strings.Left<number>("missing").catch_error((error) => {
    expect_type<string>(error);
    return Strings.Right(error.length);
  });

  assert_equals(recovered.value(), ["Right", 7] as const);
});

Deno.test("Parse runs only string-input functions", () => {
  const integer = fn((value: string) => Number.parseInt(value, 10));

  assert_equals(integer.parse("42"), 42);
  assert_equals(Parse.parse(integer, "41"), 41);
});

Deno.test("Applicative.lift infers functions beyond five arguments", () => {
  const total = Applicative.lift(
    (first, second, third, fourth, fifth, sixth) => {
      expect_type<number>(first);
      expect_type<number>(second);
      expect_type<number>(third);
      expect_type<number>(fourth);
      expect_type<number>(fifth);
      expect_type<number>(sixth);
      return first + second + third + fourth + fifth + sixth;
    },
    Just(1),
    Just(2),
    Just(3),
    Just(4),
    Just(5),
    Just(6),
  );

  assert_equals(total.value(), ["Just", 21] as const);
});

Deno.test("tagged guards reject malformed tuple arities", () => {
  assert_equals(Either.Left.is(["Left", "missing"]), true);
  assert_equals(Either.Left.is(["Left"]), false);
  assert_equals(Either.Left.is(["Left", "missing", "extra"]), false);
  assert_equals(Maybe.Just.is(["Just"]), false);
  assert_equals(Maybe.Nothing.is(["Nothing", undefined]), false);
});

Deno.test("the prelude module is safe to import dynamically", async () => {
  const prelude = await import("./prelude.ts");

  assert_equals(typeof prelude.sequence_right, "function");
  assert_equals("then" in prelude, false);
});

function check_api_types(): void {
  const wrapped = Just(1);
  const number_fn = fn((value: number) => value + 1);
  const Strings = Either.with_left<string>();
  const string_error_witness = Strings.Right(1);
  const first = First(["Box", 1]);
  const second = Second(["Box", 1]);

  expect_type<Data<AsFirst, number>>(first);
  expect_type<Data<AsSecond, number>>(second);

  // @ts-expect-error wrapped values expose methods, not constructor calls
  wrapped(["Just", 2]);

  // @ts-expect-error numeric functions cannot parse string input
  number_fn.parse("41");
  // @ts-expect-error the top-level Parse operation has the same constraint
  Parse.parse(number_fn, "41");

  Strings.throw_error<number>("missing");
  MonadError.throw_error(Strings, "missing");
  MonadError.throw_error(string_error_witness, "missing");
  // @ts-expect-error the configured Either accepts only string errors
  Strings.throw_error<number>(new Error("missing"));
  // @ts-expect-error top-level MonadError preserves the associated error type
  MonadError.throw_error(Strings, new Error("missing"));
  // @ts-expect-error wrapped witnesses preserve the associated error type
  MonadError.throw_error(string_error_witness, new Error("missing"));

  // @ts-expect-error nominal identities separate identical raw shapes
  expect_type<Data<AsFirst, number>>(second);

  type Remaining = WithoutLift<Uses<AsFirst> | Uses<AsSecond>, AsFirst>;
  expect_type<Uses<AsSecond>>(null as unknown as Remaining);
  // @ts-expect-error handling First must not remove the Second requirement
  expect_type<Uses<AsFirst>>(null as unknown as Remaining);
}

void check_api_types;

function expect_type<expected>(_value: expected): void {}

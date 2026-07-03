import { Either as EffectEither, Option as EffectOption } from "effect";
import * as FpEither from "fp-ts/Either";
import * as FpOption from "fp-ts/Option";
import { pipe as fp_pipe } from "fp-ts/function";
import { Left, Right } from "purify-ts/Either";
import { Just, Nothing } from "purify-ts/Maybe";
import * as TrueMaybe from "true-myth/maybe";
import * as TrueResult from "true-myth/result";

import { none, some } from "../src/option.ts";
import { err, ok } from "../src/result.ts";
import { Applicative } from "../src/traits.ts";
import { invalid, valid } from "../src/validation.ts";

// Each benchmark iteration performs this many constructions or compositions.
const iterations = 10_000;
let _sink: unknown;

const error = "bad";
const add_one = (value: number) => value + 1;
const double = (value: number) => value * 2;

const traits_option_double = (value: number) => some(double(value));
const fp_option_double = (value: number) => FpOption.some(double(value));
const effect_option_double = (value: number) =>
  EffectOption.some(double(value));
const purify_maybe_double = (value: number) => Just(double(value));
const true_maybe_double = (value: number) => TrueMaybe.just(double(value));

const fp_option_map_add_one = FpOption.map(add_one);
const fp_option_chain_double = FpOption.chain(fp_option_double);
const true_maybe_map_add_one = TrueMaybe.map(add_one);
const true_maybe_and_then_double = TrueMaybe.andThen(true_maybe_double);

const traits_result_double = (value: number) => ok(double(value));
const fp_either_double = <error>(value: number) => {
  return FpEither.right<error, number>(double(value));
};
const effect_either_double = (value: number) =>
  EffectEither.right(double(value));
const purify_either_double = (value: number) => Right(double(value));
const true_result_double = (value: number) => TrueResult.ok(double(value));

const fp_either_map_add_one = FpEither.map(add_one);
const fp_either_chain_double = FpEither.chain(fp_either_double);
const true_result_map_add_one = TrueResult.map(add_one);
const true_result_and_then_double = TrueResult.andThen(true_result_double);

Deno.bench("traits Option some construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = some(index);
  }

  _sink = current;
});

Deno.bench("fp-ts Option some construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = FpOption.some(index);
  }

  _sink = current;
});

Deno.bench("effect Option some construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = EffectOption.some(index);
  }

  _sink = current;
});

Deno.bench("purify Maybe Just construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Just(index);
  }

  _sink = current;
});

Deno.bench("true-myth Maybe just construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = TrueMaybe.just(index);
  }

  _sink = current;
});

Deno.bench("traits Option some map+bind", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = some(index).map(add_one).bind(traits_option_double);
  }

  _sink = current;
});

Deno.bench("traits Option some fluent ap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = some((left: number) => {
      return (right: number) => left + right;
    })
      .ap(some(index))
      .ap(some(index + 1));
  }

  _sink = current;
});

Deno.bench("traits Option some lift", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Applicative.lift(
      (left, right) => left + right,
      some(index),
      some(index + 1),
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Option some map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_pipe(
      FpOption.some(index),
      fp_option_map_add_one,
      fp_option_chain_double,
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Option some map+chain direct", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_option_chain_double(
      fp_option_map_add_one(FpOption.some(index)),
    );
  }

  _sink = current;
});

Deno.bench("effect Option some map+flatMap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = EffectOption.flatMap(
      EffectOption.map(EffectOption.some(index), add_one),
      effect_option_double,
    );
  }

  _sink = current;
});

Deno.bench("purify Maybe Just map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Just(index).map(add_one).chain(purify_maybe_double);
  }

  _sink = current;
});

Deno.bench("true-myth Maybe just map+andThen", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = true_maybe_and_then_double(
      true_maybe_map_add_one(TrueMaybe.just(index)),
    );
  }

  _sink = current;
});

Deno.bench("traits Option none map+bind", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = none<number>().map(add_one).bind(traits_option_double);
  }

  _sink = current;
});

Deno.bench("traits Option none fluent ap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = some((left: number) => {
      return (right: number) => left + right;
    })
      .ap(some(index))
      .ap(none<number>());
  }

  _sink = current;
});

Deno.bench("traits Option none lift", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Applicative.lift(
      (left, right) => left + right,
      some(index),
      none<number>(),
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Option none map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_pipe(
      FpOption.none,
      fp_option_map_add_one,
      fp_option_chain_double,
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Option none map+chain direct", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_option_chain_double(fp_option_map_add_one(FpOption.none));
  }

  _sink = current;
});

Deno.bench("effect Option none map+flatMap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = EffectOption.flatMap(
      EffectOption.map(EffectOption.none(), add_one),
      effect_option_double,
    );
  }

  _sink = current;
});

Deno.bench("purify Maybe Nothing map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Nothing.map(add_one).chain(purify_maybe_double);
  }

  _sink = current;
});

Deno.bench("true-myth Maybe nothing map+andThen", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = true_maybe_and_then_double(
      true_maybe_map_add_one(TrueMaybe.nothing<number>()),
    );
  }

  _sink = current;
});

Deno.bench("traits Result ok construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = ok(index);
  }

  _sink = current;
});

Deno.bench("fp-ts Either right construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = FpEither.right(index);
  }

  _sink = current;
});

Deno.bench("effect Either right construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = EffectEither.right(index);
  }

  _sink = current;
});

Deno.bench("purify Either Right construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Right(index);
  }

  _sink = current;
});

Deno.bench("true-myth Result ok construction", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = TrueResult.ok<number, string>(index);
  }

  _sink = current;
});

Deno.bench("traits Result ok map+bind", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = ok(index).map(add_one).bind(traits_result_double);
  }

  _sink = current;
});

Deno.bench("traits Result ok fluent ap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = ok((left: number) => {
      return (right: number) => left + right;
    })
      .ap(ok(index))
      .ap(ok(index + 1));
  }

  _sink = current;
});

Deno.bench("traits Result ok lift", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Applicative.lift(
      (left, right) => left + right,
      ok(index),
      ok(index + 1),
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Either right map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_pipe(
      FpEither.right(index),
      fp_either_map_add_one,
      fp_either_chain_double,
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Either right map+chain direct", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_either_chain_double(
      fp_either_map_add_one(FpEither.right(index)),
    );
  }

  _sink = current;
});

Deno.bench("effect Either right map+flatMap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = EffectEither.flatMap(
      EffectEither.map(EffectEither.right(index), add_one),
      effect_either_double,
    );
  }

  _sink = current;
});

Deno.bench("purify Either Right map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Right(index).map(add_one).chain(purify_either_double);
  }

  _sink = current;
});

Deno.bench("true-myth Result ok map+andThen", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = true_result_and_then_double(
      true_result_map_add_one(TrueResult.ok<number, string>(index)),
    );
  }

  _sink = current;
});

Deno.bench("traits Result err map+bind", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = err<number>(error).map(add_one).bind(traits_result_double);
  }

  _sink = current;
});

Deno.bench("traits Result err fluent ap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = ok((left: number) => {
      return (right: number) => left + right;
    })
      .ap(ok(index))
      .ap(err<number>(error));
  }

  _sink = current;
});

Deno.bench("traits Result err lift", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Applicative.lift(
      (left, right) => left + right,
      ok(index),
      err<number>(error),
    );
  }

  _sink = current;
});

Deno.bench("true-myth Result err map+andThen", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = true_result_and_then_double(
      true_result_map_add_one(TrueResult.err<number, string>(error)),
    );
  }

  _sink = current;
});

Deno.bench("fp-ts Either left map+chain direct", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = fp_either_chain_double(
      fp_either_map_add_one(FpEither.left<string, number>(error)),
    );
  }

  _sink = current;
});

Deno.bench("effect Either left map+flatMap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = EffectEither.flatMap(
      EffectEither.map(EffectEither.left(error), add_one),
      effect_either_double,
    );
  }

  _sink = current;
});

Deno.bench("purify Either Left map+chain", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Left(error).map(add_one).chain(purify_either_double);
  }

  _sink = current;
});

Deno.bench("traits Validation valid fluent ap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = valid((left: number) => {
      return (right: number) => left + right;
    })
      .ap(valid(index))
      .ap(valid(index + 1));
  }

  _sink = current;
});

Deno.bench("traits Validation valid lift", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Applicative.lift(
      (left, right) => left + right,
      valid(index),
      valid(index + 1),
    );
  }

  _sink = current;
});

Deno.bench("traits Validation invalid fluent ap", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = valid((left: number) => {
      return (right: number) => left + right;
    })
      .ap(invalid<number>("left"))
      .ap(invalid<number>("right"));
  }

  _sink = current;
});

Deno.bench("traits Validation invalid lift", () => {
  let current: unknown;

  for (let index = 0; index < iterations; index += 1) {
    current = Applicative.lift(
      (left, right) => left + right,
      invalid<number>("left"),
      invalid<number>("right"),
    );
  }

  _sink = current;
});

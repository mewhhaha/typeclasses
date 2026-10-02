import { Either as EffectEither, Option as EffectOption } from "effect";
import * as FpEither from "fp-ts/Either";
import * as FpOption from "fp-ts/Option";
import { type Either as PurifyEither, Left, Right } from "purify-ts/Either";
import {
  Just as PurifyJust,
  type Maybe as PurifyMaybe,
  Nothing as PurifyNothing,
} from "purify-ts/Maybe";
import * as TrueMaybe from "true-myth/maybe";
import * as TrueResult from "true-myth/result";

import {
  type AsEither,
  Left as TypeclassesLeft,
  Right as TypeclassesRight,
} from "../src/either.ts";
import type { AsMaybe } from "../src/maybe.ts";
import { Just, Nothing } from "../src/maybe.ts";
import type { Data } from "../src/typeclass.ts";
import { Applicative } from "../src/typeclasses.ts";
import { assert_equals } from "../src/assert.ts";
import { load_benchmark_variants } from "./generated_modules.ts";

const variants = await load_benchmark_variants<
  typeof import("./fixtures/large_chains.ts")
>(
  new URL("./fixtures/large_chains.ts", import.meta.url),
);
const { maybe_do, either_do, do_length } = variants.original;
const { maybe_do: maybe_do_transformed, either_do: either_do_transformed } =
  variants.transformed;

for (const input of [-10, 0, 2_000]) {
  const observed = variants.original.observe(input);
  assert_equals(observed, {
    maybe: ["Just", (input + do_length) * 2],
    either: ["Right", (input + do_length) * 2],
    absent: ["Nothing"],
    failed: ["Left", "bad"],
    events: ["maybe:" + (input + do_length), "either:" + (input + do_length)],
  });
  assert_equals(
    variants.transformed.observe(input),
    observed,
    "large-chain transformer output differs in values, failures, or events",
  );
}

const iterations = 2_000;
const chain_length = 20;
let _sink: unknown;

const add_one = (value: number) => value + 1;
const double = (value: number) => value * 2;
const sum_numbers = (values: readonly number[]) => {
  let sum = 0;

  for (const value of values) {
    sum += value;
  }

  return sum;
};

const typeclasses_maybe_next = (value: number) => Just(add_one(value));
const fp_option_next = (value: number) => FpOption.some(add_one(value));
const effect_option_next = (value: number) => EffectOption.some(add_one(value));
const purify_maybe_next = (value: number) => PurifyJust(add_one(value));
const true_maybe_next = (value: number) => TrueMaybe.just(add_one(value));

const fp_option_map_add_one = FpOption.map(add_one);
const fp_option_chain_next = FpOption.chain(fp_option_next);
const true_maybe_map_add_one = TrueMaybe.map(add_one);
const true_maybe_and_then_next = TrueMaybe.andThen(true_maybe_next);

const typeclasses_either_next = (value: number) =>
  TypeclassesRight(add_one(value));
const fp_either_next = <error>(value: number) => {
  return FpEither.right<error, number>(add_one(value));
};
const effect_either_next = (value: number) =>
  EffectEither.right(add_one(value));
const purify_either_next = (value: number) => Right(add_one(value));
const true_result_next = (value: number): TrueResult.Result<number, string> => {
  return TrueResult.ok<number, string>(add_one(value));
};

const fp_either_map_add_one = FpEither.map(add_one);
const fp_either_chain_next = FpEither.chain(fp_either_next);

function consume_typeclasses_maybe(value: Data<AsMaybe, number>): number {
  const maybe = value.value();

  if (Just.is(maybe)) {
    return maybe[1];
  }

  return 0;
}

function consume_fp_option(value: FpOption.Option<number>): number {
  if (FpOption.isSome(value)) {
    return value.value;
  }

  return 0;
}

function consume_effect_option(
  value: EffectOption.Option<number>,
): number {
  if (EffectOption.isSome(value)) {
    return value.value;
  }

  return 0;
}

function consume_purify_maybe(value: PurifyMaybe<number>): number {
  return value.orDefault(0);
}

function consume_true_maybe(value: TrueMaybe.Maybe<number>): number {
  return value.unwrapOr(0);
}

function consume_typeclasses_either(value: Data<AsEither, number>): number {
  const either = value.value();

  if (TypeclassesRight.is(either)) {
    return either[1];
  }

  return 0;
}

function consume_fp_either(value: FpEither.Either<string, number>): number {
  if (FpEither.isRight(value)) {
    return value.right;
  }

  return 0;
}

function consume_effect_either(
  value: EffectEither.Either<number, string>,
): number {
  if (EffectEither.isRight(value)) {
    return value.right;
  }

  return 0;
}

function consume_purify_either(value: PurifyEither<string, number>): number {
  return value.orDefault(0);
}

function consume_true_result(value: TrueResult.Result<number, string>): number {
  return value.unwrapOr(0);
}

Deno.bench("large Maybe map chain typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = Just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.map(add_one);
    }

    checksum += consume_typeclasses_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe map chain fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = FpOption.some(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = fp_option_map_add_one(value);
    }

    checksum += consume_fp_option(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe map chain effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = EffectOption.some(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = EffectOption.map(value, add_one);
    }

    checksum += consume_effect_option(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe map chain purify", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = PurifyJust(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.map(add_one);
    }

    checksum += consume_purify_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe map chain true-myth", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = TrueMaybe.just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = true_maybe_map_add_one(value);
    }

    checksum += consume_true_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe bind chain typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = Just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.bind(typeclasses_maybe_next);
    }

    checksum += consume_typeclasses_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe bind chain fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = FpOption.some(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = fp_option_chain_next(value);
    }

    checksum += consume_fp_option(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe bind chain effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = EffectOption.some(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = EffectOption.flatMap(value, effect_option_next);
    }

    checksum += consume_effect_option(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe bind chain purify", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = PurifyJust(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.chain(purify_maybe_next);
    }

    checksum += consume_purify_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe bind chain true-myth", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = TrueMaybe.just(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = true_maybe_and_then_next(value);
    }

    checksum += consume_true_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe Do typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = maybe_do(index);

    checksum += consume_typeclasses_maybe(current);
  }

  _sink = checksum;
});

Deno.bench("large Maybe transformed Do typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = maybe_do_transformed(index);

    checksum += consume_typeclasses_maybe(current);
  }

  _sink = checksum;
});

Deno.bench("large Maybe gen effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = EffectOption.gen(function* () {
      let value = yield* EffectOption.some(index);

      for (let step = 0; step < do_length; step += 1) {
        value = yield* EffectOption.some(add_one(value));
      }

      return double(value);
    });

    checksum += consume_effect_option(current);
  }

  _sink = checksum;
});

Deno.bench("large Maybe lift6 typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = Applicative.lift(
      (...values) => sum_numbers(values as readonly number[]),
      Just(index),
      Just(index + 1),
      Just(index + 2),
      Just(index + 3),
      Just(index + 4),
      Just(index + 5),
    );

    checksum += consume_typeclasses_maybe(current);
  }

  _sink = checksum;
});

Deno.bench("large Maybe all6 fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = FpOption.map(sum_numbers)(
      FpOption.sequenceArray([
        FpOption.some(index),
        FpOption.some(index + 1),
        FpOption.some(index + 2),
        FpOption.some(index + 3),
        FpOption.some(index + 4),
        FpOption.some(index + 5),
      ]),
    );

    checksum += consume_fp_option(current);
  }

  _sink = checksum;
});

Deno.bench("large Maybe all6 effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = EffectOption.map(
      EffectOption.all([
        EffectOption.some(index),
        EffectOption.some(index + 1),
        EffectOption.some(index + 2),
        EffectOption.some(index + 3),
        EffectOption.some(index + 4),
        EffectOption.some(index + 5),
      ]),
      sum_numbers,
    );

    checksum += consume_effect_option(current);
  }

  _sink = checksum;
});

Deno.bench("large Maybe nothing bind chain typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = Nothing<number>();

    for (let step = 0; step < chain_length; step += 1) {
      value = value.bind(typeclasses_maybe_next);
    }

    checksum += consume_typeclasses_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe nothing bind chain fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: FpOption.Option<number> = FpOption.none;

    for (let step = 0; step < chain_length; step += 1) {
      value = fp_option_chain_next(value);
    }

    checksum += consume_fp_option(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe nothing bind chain effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = EffectOption.none<number>();

    for (let step = 0; step < chain_length; step += 1) {
      value = EffectOption.flatMap(value, effect_option_next);
    }

    checksum += consume_effect_option(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe nothing bind chain purify", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: PurifyMaybe<number> = PurifyNothing;

    for (let step = 0; step < chain_length; step += 1) {
      value = value.chain(purify_maybe_next);
    }

    checksum += consume_purify_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Maybe nothing bind chain true-myth", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: TrueMaybe.Maybe<number> = TrueMaybe.nothing<number>();

    for (let step = 0; step < chain_length; step += 1) {
      value = true_maybe_and_then_next(value);
    }

    checksum += consume_true_maybe(value);
  }

  _sink = checksum;
});

Deno.bench("large Either bind chain typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: Data<AsEither, number> = TypeclassesRight(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.bind(typeclasses_either_next);
    }

    checksum += consume_typeclasses_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either bind chain fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = FpEither.right<string, number>(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = fp_either_chain_next(value);
    }

    checksum += consume_fp_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either bind chain effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = EffectEither.right(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = EffectEither.flatMap(value, effect_either_next);
    }

    checksum += consume_effect_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either bind chain purify", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = Right(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.chain(purify_either_next);
    }

    checksum += consume_purify_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either bind chain true-myth", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: TrueResult.Result<number, string> = TrueResult.ok<
      number,
      string
    >(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.andThen(true_result_next);
    }

    checksum += consume_true_result(value);
  }

  _sink = checksum;
});

Deno.bench("large Either Do typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = either_do(index);

    checksum += consume_typeclasses_either(current);
  }

  _sink = checksum;
});

Deno.bench("large Either transformed Do typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = either_do_transformed(index);

    checksum += consume_typeclasses_either(current);
  }

  _sink = checksum;
});

Deno.bench("large Either gen effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    const current = EffectEither.gen(function* () {
      let value = yield* EffectEither.right(index);

      for (let step = 0; step < do_length; step += 1) {
        value = yield* EffectEither.right(add_one(value));
      }

      return double(value);
    });

    checksum += consume_effect_either(current);
  }

  _sink = checksum;
});

Deno.bench("large Either left bind chain typeclasses", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: Data<AsEither, number> = TypeclassesLeft<string, number>("bad");

    for (let step = 0; step < chain_length; step += 1) {
      value = value.bind(typeclasses_either_next);
    }

    checksum += consume_typeclasses_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either left bind chain fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = FpEither.left<string, number>("bad");

    for (let step = 0; step < chain_length; step += 1) {
      value = fp_either_chain_next(value);
    }

    checksum += consume_fp_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either left bind chain effect", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: EffectEither.Either<number, string> = EffectEither.left("bad");

    for (let step = 0; step < chain_length; step += 1) {
      value = EffectEither.flatMap(value, effect_either_next);
    }

    checksum += consume_effect_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either left bind chain purify", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: PurifyEither<string, number> = Left("bad");

    for (let step = 0; step < chain_length; step += 1) {
      value = value.chain(purify_either_next);
    }

    checksum += consume_purify_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either left bind chain true-myth", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: TrueResult.Result<number, string> = TrueResult.err<
      number,
      string
    >("bad");

    for (let step = 0; step < chain_length; step += 1) {
      value = value.andThen(true_result_next);
    }

    checksum += consume_true_result(value);
  }

  _sink = checksum;
});

Deno.bench("large Either map chain fp-ts", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value = FpEither.right<string, number>(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = fp_either_map_add_one(value);
    }

    checksum += consume_fp_either(value);
  }

  _sink = checksum;
});

Deno.bench("large Either map chain true-myth", () => {
  let checksum = 0;

  for (let index = 0; index < iterations; index += 1) {
    let value: TrueResult.Result<number, string> = TrueResult.ok<
      number,
      string
    >(index);

    for (let step = 0; step < chain_length; step += 1) {
      value = value.map(add_one);
    }

    checksum += consume_true_result(value);
  }

  _sink = checksum;
});

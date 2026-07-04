import { define, type Dictionary, type Trait, type Value } from "./trait.ts";
import {
  Eff,
  type Effect,
  is_effect,
  is_lift_of,
  type Lift,
  type WithoutLift,
} from "./effects.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Reader<environment, item> = (environment: environment) => item;

export const reader_kind = Symbol("Reader");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [reader_kind]: dictionary extends AsReader<infer environment>
      ? Reader<environment, item>
      : never;
  }
}

export interface AsReader<environment> extends Dictionary<typeof reader_kind> {
  <item>(value: Reader<environment, item>): ReaderValue<environment, item>;
}

export type ReaderValue<environment, item> = Trait<
  AsReader<environment>,
  Reader<environment, item>,
  item
>;

type ReaderConstructor =
  & AsReader<unknown>
  & {
    <environment, item>(
      value: Reader<environment, item>,
    ): ReaderValue<environment, item>;
  };

export const Reader = define<AsReader<unknown>>(
  reader_kind,
) as ReaderConstructor;

export function ask<environment>(): ReaderValue<environment, environment> {
  return Reader((environment: environment) => environment);
}

export function asks<environment, item>(
  fn: (environment: environment) => item,
): ReaderValue<environment, item> {
  return Reader(fn);
}

export function local<outer, inner, item>(
  reader: ReaderValue<inner, item>,
  fn: (environment: outer) => inner,
): ReaderValue<outer, item> {
  return Reader((environment: outer) => run_reader(reader, fn(environment)));
}

export function run_reader<environment, item>(
  reader: Value<AsReader<environment>, item>,
  environment: environment,
): item;
export function run_reader<requirements, environment, item>(
  effect: Effect<requirements, item>,
  environment: environment,
): Effect<WithoutLift<requirements, AsReader<environment>>, item>;
export function run_reader<requirements, environment, item>(
  reader_or_effect:
    | Value<AsReader<environment>, item>
    | Effect<requirements, item>,
  environment: environment,
): item | Effect<WithoutLift<requirements, AsReader<environment>>, item> {
  if (is_effect(reader_or_effect)) {
    return run_reader_effect(reader_or_effect, environment);
  }

  return reader_or_effect.value()(environment);
}

function run_reader_effect<requirements, environment, item>(
  effect: Effect<requirements, item>,
  environment: environment,
): Effect<WithoutLift<requirements, AsReader<environment>>, item> {
  if (effect.tag === "pure") {
    return Eff.pure(effect.value);
  }

  if (is_lift_of(effect.operation, reader_kind)) {
    const operation = effect.operation as unknown as Lift<
      AsReader<environment>,
      unknown
    >;
    return run_reader_effect(
      effect.resume(run_reader(operation.value, environment)),
      environment,
    );
  }

  return Eff.suspend(
    effect.operation as WithoutLift<requirements, AsReader<environment>>,
    (value) => run_reader_effect(effect.resume(value), environment),
  );
}

Format.implement(Reader)({
  fmt() {
    return "Reader(?)";
  },
});

export interface AsReader<environment> extends Format<AsReader<environment>> {}

Functor.implement(Reader)({
  map(fn) {
    return Reader((environment: unknown) => {
      return fn(run_reader(this, environment));
    });
  },
});

export interface AsReader<environment> extends Functor<AsReader<environment>> {}

Applicative.implement(Reader)({
  pure(value) {
    return Reader((_environment: unknown) => value);
  },

  ap(value) {
    return Reader((environment: unknown) => {
      const fn = run_reader(this, environment);
      return fn(run_reader(value, environment));
    });
  },
});

export interface AsReader<environment>
  extends Applicative<AsReader<environment>> {}

Monad.implement(Reader)({
  bind(fn) {
    return Reader((environment: unknown) => {
      const value = run_reader(this, environment);
      return run_reader(fn(value), environment);
    });
  },
});

export interface AsReader<environment> extends Monad<AsReader<environment>> {}

import {
  type As,
  data,
  type Dictionary,
  kind,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  type Effect,
  type Lift,
  pure,
  suspend,
  type WithoutLift,
} from "./effects.ts";
import { Applicative, Functor, Monad, Show } from "./typeclasses.ts";

export type Reader<environment, item> = (environment: environment) => item;

export interface AsReader<environment>
  extends
    As<AsReader<environment>>,
    Show<AsReader<environment>>,
    Functor<AsReader<environment>>,
    Applicative<AsReader<environment>>,
    Monad<AsReader<environment>> {
  readonly [type_item]: unknown;
  readonly [type_data]: Reader<environment, this[typeof type_item]>;
  <item>(value: Reader<environment, item>): ReaderValue<environment, item>;
}

export type ReaderValue<environment, item> = WrappedData<
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

export const Reader = data<AsReader<unknown>>() as ReaderConstructor;

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
  return Reader((environment: outer) => reader.value()(fn(environment)));
}

export function run_reader<requirements, environment, item>(
  effect: Effect<requirements, item>,
  environment: environment,
): Effect<WithoutLift<requirements, AsReader<environment>>, item> {
  if (effect.tag === "pure") {
    return pure(effect.value);
  }

  const operation = effect.operation as {
    readonly tag?: string;
    readonly value?: unknown;
  };

  if (operation.tag === "lift" && is_reader_value(operation.value)) {
    const lifted = effect.operation as unknown as Lift<
      AsReader<environment>,
      unknown
    >;
    return run_reader(
      effect.resume(lifted.value.value()(environment)),
      environment,
    );
  }

  return suspend(
    effect.operation as WithoutLift<requirements, AsReader<environment>>,
    (value) => run_reader(effect.resume(value), environment),
  ) as Effect<WithoutLift<requirements, AsReader<environment>>, item>;
}

function is_reader_value(value: unknown): value is Dictionary {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === Reader[kind];
}

Show.instance(Reader)({
  show() {
    return "Reader(?)";
  },
});

Functor.instance(Reader)({
  map(fn) {
    return Reader((environment: unknown) => {
      return fn(this.value()(environment));
    });
  },
});

Applicative.instance(Reader)({
  pure(value) {
    return Reader((_environment: unknown) => value);
  },

  ap(value) {
    return Reader((environment: unknown) => {
      const fn = this.value()(environment);
      return fn(value.value()(environment));
    });
  },
});

Monad.instance(Reader)({
  bind(fn) {
    return Reader((environment: unknown) => {
      const value = this.value()(environment);
      return fn(value).value()(environment);
    });
  },
});

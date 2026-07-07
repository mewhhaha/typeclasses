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
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";

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
const reader_kind = Reader[kind];

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
  let current = effect as Effect<requirements, unknown>;

  while (true) {
    switch (current[0]) {
      case "pure":
        return pure(current[1]) as Effect<
          WithoutLift<requirements, AsReader<environment>>,
          item
        >;
      case "impure": {
        const operation = current[1] as readonly [string, unknown];

        if (operation[0] === "lift" && is_reader_value(operation[1])) {
          const lifted = current[1] as unknown as Lift<
            AsReader<environment>,
            unknown
          >;
          current = current[2](lifted[1].value()(environment)) as Effect<
            requirements,
            unknown
          >;
          continue;
        }

        const suspended = current;
        return suspend(
          suspended[1] as WithoutLift<requirements, AsReader<environment>>,
          (value) => run_reader(suspended[2](value), environment),
        ) as Effect<WithoutLift<requirements, AsReader<environment>>, item>;
      }
    }
  }
}

function is_reader_value(value: unknown): value is Dictionary {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === reader_kind;
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

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const readers = rest.map((current) => current.value());

    return Reader((environment: unknown) => {
      const values = [first(environment)];

      for (const reader of readers) {
        values.push(reader(environment));
      }

      return fn(...values);
    });
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

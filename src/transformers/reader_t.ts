import { define, type Dictionary, type Trait, type Value } from "../trait.ts";
import { Applicative, Format, Functor, Monad } from "../traits.ts";

export type ReaderT<
  base extends Dictionary,
  environment,
  item,
> = (environment: environment) => Value<base, item>;

export const reader_t_kind = Symbol("ReaderT");

declare module "../trait.ts" {
  interface TraitTypes<dictionary, item> {
    [reader_t_kind]: dictionary extends AsReaderT<infer base, infer environment>
      ? ReaderT<base, environment, item>
      : never;
  }
}

export interface AsReaderT<
  base extends Dictionary,
  environment,
> extends Dictionary<typeof reader_t_kind> {
  readonly base: Value<base, unknown>;
  <item>(
    value: ReaderT<base, environment, item>,
  ): ReaderTValue<base, environment, item>;
}

export type ReaderTValue<
  base extends Dictionary,
  environment,
  item,
> = Trait<
  AsReaderT<base, environment>,
  ReaderT<base, environment, item>,
  item
>;

export type ReaderTConstructor<base extends Monad<base>> =
  & AsReaderT<base, unknown>
  & {
    <environment, item>(
      value: ReaderT<base, environment, item>,
    ): ReaderTValue<base, environment, item>;
    ask<environment>(): ReaderTValue<base, environment, environment>;
    asks<environment, item>(
      fn: (environment: environment) => item,
    ): ReaderTValue<base, environment, item>;
    lift<environment, item>(
      value: Value<base, item>,
    ): ReaderTValue<base, environment, item>;
    run<environment, item>(
      reader: Value<AsReaderT<base, environment>, item>,
      environment: environment,
    ): Value<base, item>;
  };

export function ReaderT<base extends Monad<base>>(
  base: Value<base, unknown>,
): ReaderTConstructor<base> {
  const target = define<AsReaderT<base, unknown>>(
    reader_t_kind,
  ) as ReaderTConstructor<base>;

  Object.defineProperty(target, "base", {
    enumerable: true,
    value: base,
  });

  target.ask = function ask<environment>() {
    return target((environment: environment) => {
      return Applicative.pure(base, environment);
    });
  };
  target.asks = function asks<environment, item>(
    fn: (environment: environment) => item,
  ) {
    return target((environment: environment) => {
      return Applicative.pure(base, fn(environment));
    });
  };
  target.lift = function lift<environment, item>(value: Value<base, item>) {
    return target((_environment: environment) => value);
  };
  target.run = run_reader_t;

  Format.implement(target)({
    fmt() {
      return "ReaderT(?)";
    },
  });

  Functor.implement(target)({
    map(fn) {
      return target((environment: unknown) => {
        return Functor.map(run_reader_t(this, environment), fn);
      });
    },
  });

  Applicative.implement(target)({
    pure(value) {
      return target((_environment: unknown) => {
        return Applicative.pure(base, value);
      });
    },

    ap(value) {
      return target((environment: unknown) => {
        return Applicative.ap(
          run_reader_t(this, environment),
          run_reader_t(value, environment),
        );
      });
    },
  });

  Monad.implement(target)({
    bind(fn) {
      return target((environment: unknown) => {
        return Monad.bind(run_reader_t(this, environment), (value) => {
          return run_reader_t(fn(value), environment);
        });
      });
    },
  });

  return target;
}

export interface AsReaderT<base extends Dictionary, environment>
  extends
    Format<AsReaderT<base, environment>>,
    Functor<AsReaderT<base, environment>>,
    Applicative<AsReaderT<base, environment>>,
    Monad<AsReaderT<base, environment>> {}

export function run_reader_t<
  base extends Dictionary,
  environment,
  item,
>(
  reader: Value<AsReaderT<base, environment>, item>,
  environment: environment,
): Value<base, item> {
  return reader.value()(environment);
}

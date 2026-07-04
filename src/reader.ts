import { type As, define, type Trait, type Value } from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Reader<environment, item> = (environment: environment) => item;

export const reader_kind = Symbol("Reader");

declare module "./trait.ts" {
  interface TraitTypes<item> {
    [reader_kind]: Reader<never, item>;
  }
}

export interface AsReader extends As<typeof reader_kind> {
  <environment, item>(
    value: Reader<environment, item>,
  ): ReaderValue<environment, item>;
}

export type ReaderValue<environment, item> = Trait<
  AsReader,
  Reader<environment, item>,
  item
>;

export const Reader = define<AsReader>(
  reader_kind,
);

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
  reader: Value<AsReader, item>,
  environment: environment,
): item {
  return (reader.value() as Reader<environment, item>)(environment);
}

Format.implement(Reader)({
  fmt() {
    return "Reader(?)";
  },
});

export interface AsReader extends Format<AsReader> {}

Functor.implement(Reader)({
  map(fn) {
    return Reader((environment: never) => {
      return fn(run_reader(this, environment));
    });
  },
});

export interface AsReader extends Functor<AsReader> {}

Applicative.implement(Reader)({
  pure(value) {
    return Reader((_environment: never) => value);
  },

  ap(value) {
    return Reader((environment: never) => {
      const fn = run_reader(this, environment);
      return fn(run_reader(value, environment));
    });
  },
});

export interface AsReader extends Applicative<AsReader> {}

Monad.implement(Reader)({
  bind(fn) {
    return Reader((environment: never) => {
      const value = run_reader(this, environment);
      return run_reader(fn(value), environment);
    });
  },
});

export interface AsReader extends Monad<AsReader> {}

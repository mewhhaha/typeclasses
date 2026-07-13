import {
  type As,
  type Data,
  data,
  type DictionaryDataType,
  is_data,
  kind,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  type Effect,
  handle_lift,
  handle_lift_terminal,
  type Lift,
  type LiftHandler,
} from "./effects.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const reader_identity: unique symbol;

/** A computation that reads a shared environment. */
export type Reader<environment, item> = (environment: environment) => item;

/** The callable Reader dictionary for one environment type. */
export interface AsReader<environment>
  extends
    As<AsReader<environment>, typeof reader_identity>,
    Show<AsReader<environment>>,
    Monad<AsReader<environment>> {
  /** The item produced by a Reader value. */
  readonly [type_item]: unknown;
  /** The environment-dependent computation represented by a Reader value. */
  readonly [type_data]: Reader<environment, this[typeof type_item]>;
  /** Wraps an environment-dependent computation. */
  <item>(value: Reader<environment, item>): ReaderValue<environment, item>;
}

/** A Reader computation wrapped with its typeclass dictionary. */
export type ReaderValue<environment, item> = WrappedData<
  AsReader<environment>,
  Reader<environment, item>,
  item
>;

/** @ignore */
export type ReaderConstructor =
  & AsReader<unknown>
  & {
    <environment, item>(
      value: Reader<environment, item>,
    ): ReaderValue<environment, item>;
  };

/** The Reader dictionary and constructor. */
export const Reader = data<AsReader<unknown>>() as ReaderConstructor;
const reader_kind = Reader[kind];

/** Reads the current environment. */
export function ask<environment>(): ReaderValue<environment, environment> {
  return Reader((environment: environment) => environment);
}

/** Selects a value from the current environment. */
export function asks<environment, item>(
  fn: (environment: environment) => item,
): ReaderValue<environment, item> {
  return Reader(fn);
}

/** Runs a Reader after adapting an outer environment to its expected one. */
export function local<outer, inner, item>(
  reader: ReaderValue<inner, item>,
  fn: (environment: outer) => inner,
): ReaderValue<outer, item> {
  return Reader((environment: outer) => reader.value()(fn(environment)));
}

/** @ignore */
export type WithoutReader<requirements, environment> = requirements extends
  Lift<infer dictionary, infer _item>
  ? DictionaryDataType<dictionary> extends
    DictionaryDataType<AsReader<environment>> ? never
  : requirements
  : requirements;

/** Handles Reader lifts with the supplied environment. */
export function run_reader<requirements, environment, item>(
  effect: Effect<requirements, item>,
  environment: environment,
): Effect<WithoutReader<requirements, environment>, item> {
  return handle_lift(
    effect,
    reader_kind,
    environment,
    reader_lift_handler as LiftHandler<
      AsReader<environment>,
      environment,
      item,
      item
    >,
  ) as Effect<WithoutReader<requirements, environment>, item>;
}

/** Runs one Reader value or an effect containing only Reader lifts. */
export function run_reader_terminal<environment, item>(
  reader: ReaderValue<environment, item>,
  environment: environment,
): item;
/** Runs an effect containing only Reader lifts. */
export function run_reader_terminal<environment, item>(
  effect: Effect<Lift<AsReader<environment>, unknown>, item>,
  environment: environment,
): item;
/** Runs a Reader value or an effect containing only Reader lifts. */
export function run_reader_terminal<environment, item>(
  value:
    | ReaderValue<environment, item>
    | Effect<Lift<AsReader<environment>, unknown>, item>,
  environment: environment,
): item;
export function run_reader_terminal<environment, item>(
  effect:
    | ReaderValue<environment, item>
    | Effect<Lift<AsReader<environment>, unknown>, item>,
  environment: environment,
): item {
  if (is_data(effect)) {
    if ((effect as Data<AsReader<unknown>, unknown>)[kind] !== reader_kind) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    return (effect as ReaderValue<environment, item>).value()(environment);
  }

  return handle_lift_terminal(
    effect as Effect<Lift<AsReader<environment>, unknown>, item>,
    reader_kind,
    environment,
    reader_lift_handler as LiftHandler<
      AsReader<environment>,
      environment,
      item,
      item
    >,
  ) as item;
}

const reader_lift_handler: LiftHandler<
  AsReader<unknown>,
  unknown,
  unknown,
  unknown
> = {
  done(value) {
    return value;
  },
  handle(value, state) {
    return [value.value()(state), state] as const;
  },
};

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

import {
  type As,
  type Data,
  data,
  is_data,
  kind,
  type type_data,
  type type_identity,
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
  cell_dictionary,
  type CellIdentity,
  type NominalKey,
  type WidenedCellKey,
  type WithoutCell,
} from "./cell.ts";
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

/**
 * A keyed Reader cell: its callable dictionary and the operations reading it.
 *
 * The operations live on the dictionary rather than in a wrapper type so that
 * `typeof cell` is exactly the dictionary its values carry, which is what lets
 * `Uses<typeof cell>` cancel against those values in `Program.scope`.
 */
export interface AsReaderCell<key extends PropertyKey, environment> extends
  As<
    AsReaderCell<key, environment>,
    CellIdentity<typeof reader_identity, key>
  >,
  Show<AsReaderCell<key, environment>>,
  Monad<AsReaderCell<key, environment>> {
  /** The item produced by a cell value. */
  readonly [type_item]: unknown;
  /** The environment-dependent computation represented by a cell value. */
  readonly [type_data]: Reader<environment, this[typeof type_item]>;
  /** Wraps a computation reading this cell. */
  <item>(
    value: Reader<environment, item>,
  ): ReaderCellValue<key, environment, item>;
  /** Reads this cell's environment. */
  ask(): ReaderCellValue<key, environment, environment>;
  /** Selects a value from this cell's environment. */
  asks<item>(
    fn: (environment: environment) => item,
  ): ReaderCellValue<key, environment, item>;
}

/** A Reader computation wrapped with its cell's dictionary. */
export type ReaderCellValue<key extends PropertyKey, environment, item> =
  WrappedData<
    AsReaderCell<key, environment>,
    Reader<environment, item>,
    item
  >;

/**
 * Declares a keyed Reader cell.
 *
 * A cell has its own runtime kind and its own type identity, so it is answered
 * by its own `run_reader` and is invisible to every other cell and to the
 * anonymous `ask`/`asks` operations. Name the cell, then give its environment:
 *
 * ```ts
 * const config = reader<"config", Config>();
 * const database = reader<"database", Database>();
 * ```
 *
 * The key distinguishes cells that read the same environment type. It exists
 * only in the type, so **declare each key exactly once**: two declarations
 * sharing a key are one cell to the compiler and two at runtime, and the second
 * one's lifts survive a handler the types said would discharge them. A key that
 * is not a literal carries no identity at all and is rejected outright.
 */
export function reader<key extends PropertyKey, environment>(): [
  NominalKey<key>,
] extends [never] ? WidenedCellKey : AsReaderCell<key, environment> {
  return make_reader_cell() as [NominalKey<key>] extends [never]
    ? WidenedCellKey
    : AsReaderCell<key, environment>;
}

function make_reader_cell<key extends PropertyKey, environment>(): AsReaderCell<
  key,
  environment
> {
  const dictionary = cell_dictionary<AsReaderCell<key, environment>>();

  Object.defineProperties(dictionary, {
    ask: {
      value: () => wrap((environment: environment) => environment),
    },
    asks: {
      value: <item>(fn: (environment: environment) => item) => wrap(fn),
    },
  });

  Show.instance(dictionary)({
    show() {
      return "Reader(?)";
    },
  });

  Functor.instance(dictionary)({
    map(fn) {
      const read = this.value();

      return wrap((environment: environment) => fn(read(environment)));
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(() => value);
    },

    [applicative_lift_method](fn, rest) {
      const first = this.value();
      const reads = rest.map((current) => current.value());

      return wrap((environment: environment) =>
        fn(first(environment), ...reads.map((read) => read(environment)))
      );
    },

    ap(value) {
      const read = this.value();
      const applied = value.value();

      return wrap((environment: environment) =>
        read(environment)(applied(environment))
      );
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      const read = this.value();

      return wrap((environment: environment) =>
        fn(read(environment)).value()(environment)
      );
    },
  });

  return dictionary;

  function wrap<item>(
    value: Reader<environment, item>,
  ): ReaderCellValue<key, environment, item> {
    return dictionary(value);
  }
}

/** @ignore */
export type WithoutReaderCell<requirements, key extends PropertyKey> =
  WithoutCell<requirements, typeof reader_identity, key>;

/**
 * The environment every lift of `key` in `requirements` reads.
 *
 * One `run_reader` answers every operation addressed to its cell, so the
 * environment has to satisfy all of them at once: each lift contributes a
 * parameter position, so several asks against one cell yield their
 * intersection. Lifts of other cells contribute nothing and stay pending.
 */
export type ReaderCellEnvironment<requirements, key extends PropertyKey> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends
      CellIdentity<typeof reader_identity, key>
      ? dictionary extends
        { readonly [type_data]: (environment: infer environment) => unknown }
        ? (environment: environment) => void
      : never
    : never
    : never
) extends (environment: infer environment) => void ? environment : unknown;

/**
 * The environment a terminal cell run needs, or `never` when the effect still
 * carries requirements that the terminal runner cannot discharge.
 */
export type TerminalReaderCellEnvironment<
  requirements,
  key extends PropertyKey,
> = [WithoutReaderCell<requirements, key>] extends [never]
  ? ReaderCellEnvironment<requirements, key>
  : never;

/** @ignore */
export type WithoutReader<requirements> = requirements extends
  Lift<infer dictionary, infer _item>
  ? dictionary[typeof type_identity] extends typeof reader_identity ? never
  : requirements
  : requirements;

/**
 * The environment every Reader lift in `requirements` reads.
 *
 * All Reader lifts share one runtime dictionary, so a single `run_reader`
 * answers every `ask` in the program from one environment. That environment
 * has to satisfy all of them at once: each lift contributes a parameter
 * position, so a program asking for several environments yields their
 * intersection rather than a union.
 */
export type ReaderEnvironment<requirements> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends typeof reader_identity
      ? dictionary extends
        { readonly [type_data]: (environment: infer environment) => unknown }
        ? (environment: environment) => void
      : never
    : never
    : never
) extends (environment: infer environment) => void ? environment : unknown;

/** Handles Reader lifts with the supplied environment. */
export function run_reader<requirements, item>(
  effect: Effect<requirements, item>,
  environment: ReaderEnvironment<requirements>,
): Effect<WithoutReader<requirements>, item>;
/** Handles one cell's lifts with the supplied environment. */
export function run_reader<
  key extends PropertyKey,
  environment,
  requirements,
  item,
>(
  cell: AsReaderCell<key, environment>,
  effect: Effect<requirements, item>,
  value: NoInfer<environment> & ReaderCellEnvironment<requirements, key>,
): Effect<WithoutReaderCell<requirements, key>, item>;
export function run_reader(
  ...args:
    | readonly [Effect<unknown, unknown>, unknown]
    | readonly [
      AsReaderCell<PropertyKey, unknown>,
      Effect<unknown, unknown>,
      unknown,
    ]
): Effect<unknown, unknown> {
  if (args.length === 2) {
    const [effect, environment] = args;

    return handle_lift(
      effect,
      reader_kind,
      environment,
      reader_lift_handler,
    );
  }

  const [cell, effect, environment] = args;

  return handle_lift(
    effect,
    cell[kind] as AsReader<unknown>[typeof kind],
    environment,
    reader_lift_handler,
  );
}

/**
 * The environment a terminal run needs, or `never` when the effect still
 * carries requirements that `run_reader_terminal` cannot discharge.
 */
export type TerminalReaderEnvironment<requirements> =
  [WithoutReader<requirements>] extends [never]
    ? ReaderEnvironment<requirements>
    : never;

/** Runs one Reader value or an effect containing only Reader lifts. */
export function run_reader_terminal<environment, item>(
  reader: ReaderValue<environment, item>,
  environment: environment,
): item;
/** Runs an effect containing only Reader lifts. */
export function run_reader_terminal<requirements, item>(
  effect: Effect<requirements, item>,
  environment: TerminalReaderEnvironment<requirements>,
): item;
/** Runs a Reader value or an effect containing only Reader lifts. */
export function run_reader_terminal<requirements, environment, item>(
  value:
    | ReaderValue<environment, item>
    | Effect<requirements, item>,
  environment: environment & TerminalReaderEnvironment<requirements>,
): item;
/** Runs one cell value. */
export function run_reader_terminal<key extends PropertyKey, environment, item>(
  cell: AsReaderCell<key, environment>,
  reader: ReaderCellValue<key, environment, item>,
  value: environment,
): item;
/** Runs an effect whose only remaining lifts address `cell`. */
export function run_reader_terminal<
  key extends PropertyKey,
  environment,
  requirements,
  item,
>(
  cell: AsReaderCell<key, environment>,
  effect: Effect<requirements, item>,
  value:
    & NoInfer<environment>
    & TerminalReaderCellEnvironment<requirements, key>,
): item;
export function run_reader_terminal(
  ...args:
    | readonly [
      ReaderValue<unknown, unknown> | Effect<unknown, unknown>,
      unknown,
    ]
    | readonly [
      AsReaderCell<PropertyKey, unknown>,
      | ReaderCellValue<PropertyKey, unknown, unknown>
      | Effect<unknown, unknown>,
      unknown,
    ]
): unknown {
  if (args.length === 2) {
    const [effect, environment] = args;

    return run_reader_kind(effect, reader_kind, environment);
  }

  const [cell, effect, environment] = args;

  return run_reader_kind(
    effect,
    cell[kind] as AsReader<unknown>[typeof kind],
    environment,
  );
}

function run_reader_kind(
  effect:
    | ReaderValue<unknown, unknown>
    | ReaderCellValue<PropertyKey, unknown, unknown>
    | Effect<unknown, unknown>,
  runtime_kind: AsReader<unknown>[typeof kind],
  environment: unknown,
): unknown {
  if (is_data(effect)) {
    if ((effect as Data<AsReader<unknown>, unknown>)[kind] !== runtime_kind) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    return (effect as ReaderValue<unknown, unknown>).value()(environment);
  }

  return handle_lift_terminal(
    effect as Effect<Lift<AsReader<unknown>, unknown>, unknown>,
    runtime_kind,
    environment,
    reader_lift_handler,
  );
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

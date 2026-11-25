import type { Runnable } from "./data_value.ts";
import { bind_reader_computation, map_computation } from "./computation.ts";
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
  is_effect,
  is_lift_of,
  type Lift,
  suspend,
  type TaggedOperation,
} from "./effects.ts";
import {
  cell_dictionary,
  type CellIdentity,
  type NominalKey,
  type WithoutCell,
} from "./cell.ts";
import { register_traversal } from "./traversal.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  Show,
} from "./typeclasses.ts";
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";

/** @ignore */
export const reader_identity: unique symbol = /* @__PURE__ */ Symbol(
  "reader_identity",
);

/** A computation that reads a shared environment. */
export type RawReader<environment, item> = (environment: environment) => item;

/** @ignore */
export interface AsReaderLambda<environment> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawReader<environment, this[typeof type_item]>;
}

/** The callable Reader dictionary for one environment type. */
export interface AsReader<environment>
  extends
    As<AsReaderLambda<environment>, typeof reader_identity>,
    Show<AsReader<environment>>,
    Monad<AsReader<environment>>,
    Runnable {
  /** Wraps an environment-dependent computation. */
  <item>(value: RawReader<environment, item>): Reader<environment, item>;
}

/** A Reader computation wrapped with its typeclass dictionary. */
export type Reader<environment, item> = WrappedData<
  AsReader<environment>,
  RawReader<environment, item>,
  item
>;

/** @ignore */
export type ReaderConstructor =
  & AsReader<unknown>
  & {
    <environment, item>(
      value: RawReader<environment, item>,
    ): Reader<environment, item>;
    /** Selects the environment type for pure values and generic operations. */
    with_environment<environment>(): AsReader<environment>;
  };

/** The Reader dictionary and constructor. */
export const Reader = data<AsReader<unknown>>(
  reader_identity,
) as ReaderConstructor;
const reader_kind = Reader[kind];

Object.defineProperty(Reader, "with_environment", {
  value: <environment>(): AsReader<environment> =>
    Reader as unknown as AsReader<environment>,
});

function identity_environment<environment>(
  environment: environment,
): environment {
  return environment;
}

/** Reads the current environment. */
export function ask<environment>(): Reader<environment, environment> {
  return Reader(identity_environment) as Reader<environment, environment>;
}

/** Selects a value from the current environment. */
export function asks<environment, item>(
  fn: (environment: environment) => item,
): Reader<environment, item> {
  return Reader(fn);
}

/** Runs a Reader after adapting an outer environment to its expected one. */
export function local<outer, inner, item>(
  reader: Reader<inner, item>,
  fn: (environment: outer) => inner,
): Reader<outer, item> {
  return Reader((environment: outer) => reader.value()(fn(environment)));
}

/** @ignore */
export interface AsReaderCellLambda<environment> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawReader<environment, this[typeof type_item]>;
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
    AsReaderCellLambda<environment>,
    CellIdentity<typeof reader_identity, key>
  >,
  Show<AsReaderCell<key, environment>>,
  Monad<AsReaderCell<key, environment>>,
  Runnable {
  /** Wraps a computation reading this cell. */
  <item>(
    value: RawReader<environment, item>,
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
    RawReader<environment, item>,
    item
  >;

/**
 * Declare a Reader cell without repeating its key in type arguments:
 * `const config = reader<Config>()("config")`.
 */
export function reader<environment>(): <const key extends PropertyKey>(
  key: key & NominalKey<key>,
) => AsReaderCell<key, environment>;
/**
 * Declare a Reader cell using a runtime key. Reusing the key within this family
 * addresses the same cell. Use a const Symbol for a private identity.
 */
export function reader<key extends PropertyKey, environment>(
  key: key & NominalKey<key>,
): AsReaderCell<key, environment>;
export function reader(key?: PropertyKey): unknown {
  if (arguments.length === 0) {
    return (cell_key: PropertyKey) => make_reader_cell(cell_key);
  }

  return make_reader_cell(key as PropertyKey);
}

function make_reader_cell<key extends PropertyKey, environment>(
  key: key,
): AsReaderCell<
  key,
  environment
> {
  const dictionary = cell_dictionary<AsReaderCell<key, environment>>(
    Reader,
    key,
  );

  Object.defineProperties(dictionary, {
    ask: {
      value: () => wrap(identity_environment<environment>),
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

      return wrap(map_computation(read, fn));
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(() => value);
    },

    [applicative_lift_method](fn, rest) {
      const first = this.value();
      const len = rest.length;

      if (len === 0) {
        return wrap((environment: environment) => fn(first(environment)));
      }
      if (len === 1) {
        const second = rest[0].value();
        return wrap((environment: environment) =>
          fn(first(environment), second(environment))
        );
      }
      if (len === 2) {
        const second = rest[0].value();
        const third = rest[1].value();
        return wrap((environment: environment) =>
          fn(first(environment), second(environment), third(environment))
        );
      }
      const reads = rest.map((current) => current.value());
      return wrap((environment: environment) => {
        const values = new Array<unknown>(len + 1);
        values[0] = first(environment);
        for (let i = 0; i < len; i += 1) values[i + 1] = reads[i](environment);
        return fn(...values);
      });
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

      return wrap(
        bind_reader_computation(
          read,
          (value) => fn(value).value(),
        ),
      );
    },
  });

  register_reader_traversal(dictionary);

  return dictionary;

  function wrap<item>(
    value: RawReader<environment, item>,
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
  first: Effect<unknown, unknown> | AsReaderCell<PropertyKey, unknown>,
  second: unknown,
  third?: unknown,
): Effect<unknown, unknown> {
  if (arguments.length === 2) {
    return run_reader_effect(
      first as Effect<unknown, unknown>,
      reader_kind,
      second,
    );
  }

  return run_reader_effect(
    second as Effect<unknown, unknown>,
    (first as AsReaderCell<PropertyKey, unknown>)[
      kind
    ] as AsReader<unknown>[typeof kind],
    third,
  );
}

function run_reader_effect(
  effect: Effect<unknown, unknown>,
  runtime_kind: AsReader<unknown>[typeof kind],
  environment: unknown,
): Effect<unknown, unknown> {
  let current = effect;

  while (true) {
    if (current[0] === "pure") {
      return current;
    }

    if (is_lift_of(current[1], runtime_kind)) {
      const lifted = (current[1] as Lift<AsReader<unknown>, unknown>)[1];
      current = current[2](lifted.value()(environment));
      continue;
    }

    const suspended = current;
    return suspend(
      suspended[1],
      (value) =>
        run_reader_effect(suspended[2](value), runtime_kind, environment),
    );
  }
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
  reader: Reader<environment, item>,
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
    | Reader<environment, item>
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
  first:
    | Reader<unknown, unknown>
    | Effect<unknown, unknown>
    | AsReaderCell<PropertyKey, unknown>,
  second: unknown,
  third?: unknown,
): unknown {
  if (arguments.length === 2) {
    return run_reader_kind(
      first as Reader<unknown, unknown> | Effect<unknown, unknown>,
      reader_kind,
      second,
    );
  }

  return run_reader_kind(
    second as
      | ReaderCellValue<PropertyKey, unknown, unknown>
      | Effect<unknown, unknown>,
    (first as AsReaderCell<PropertyKey, unknown>)[
      kind
    ] as AsReader<unknown>[typeof kind],
    third,
  );
}

function run_reader_kind(
  effect:
    | Reader<unknown, unknown>
    | ReaderCellValue<PropertyKey, unknown, unknown>
    | Effect<unknown, unknown>,
  runtime_kind: AsReader<unknown>[typeof kind],
  environment: unknown,
): unknown {
  if (is_data(effect)) {
    if ((effect as Data<AsReader<unknown>, unknown>)[kind] !== runtime_kind) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    return (effect as Reader<unknown, unknown>).value()(environment);
  }

  let current = effect as Effect<Lift<AsReader<unknown>, unknown>, unknown>;

  while (true) {
    if (!is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }

    if (current[0] === "pure") {
      return current[1];
    }

    if (current[0] !== "impure") {
      throw new TypeError("Invalid effect value");
    }

    const operation = current[1];
    if (!is_lift_of(operation, runtime_kind)) {
      throw new TypeError(
        "Unhandled effect operation: " + (operation as TaggedOperation)[0],
      );
    }

    const value = operation[1].value()(environment);
    current = current[2](value) as Effect<
      Lift<AsReader<unknown>, unknown>,
      unknown
    >;
  }
}

Show.instance(Reader)({
  show() {
    return "Reader(?)";
  },
});

Functor.instance(Reader)({
  map(fn) {
    return Reader(map_computation(this.value(), fn));
  },
});

Applicative.instance(Reader)({
  pure(value) {
    return Reader((_environment: unknown) => value);
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const len = rest.length;

    if (len === 0) {
      return Reader((environment: unknown) => fn(first(environment)));
    }
    if (len === 1) {
      const second = rest[0].value();
      return Reader((environment: unknown) =>
        fn(first(environment), second(environment))
      );
    }
    if (len === 2) {
      const second = rest[0].value();
      const third = rest[1].value();
      return Reader((environment: unknown) =>
        fn(first(environment), second(environment), third(environment))
      );
    }
    const readers = rest.map((current) => current.value());
    return Reader((environment: unknown) => {
      const values = new Array<unknown>(len + 1);
      values[0] = first(environment);
      for (let i = 0; i < len; i += 1) values[i + 1] = readers[i](environment);
      return fn(...values);
    });
  },

  ap(value) {
    const read = this.value();
    const applied = value.value();
    return Reader((environment: unknown) =>
      read(environment)(applied(environment))
    );
  },
});

Monad.instance(Reader)({
  bind(fn) {
    return Reader(
      bind_reader_computation(
        this.value(),
        (value) => fn(value).value(),
      ),
    );
  },
});

function register_reader_traversal(dictionary: unknown): void {
  const dict = dictionary as AsReader<unknown> & {
    (v: RawReader<unknown, unknown>): Data<AsReader<unknown>, unknown>;
  };
  const d_kind = dict[kind];
  const c_bind = dict.bind;
  const c_pure = dict.pure;
  const reader_do: CustomDoRunner = (first_value, first_iterator, run) => {
    const first = first_value as Data<AsReader<unknown>, unknown>;
    if (
      first[kind] !== d_kind || first.bind !== c_bind || first.pure !== c_pure
    ) return undefined;
    let first_claimed = false;
    return dict((environment: unknown) => {
      let iter: Generator<unknown, unknown, unknown>;
      let current: unknown;
      if (!first_claimed) {
        first_claimed = true;
        iter = first_iterator;
        current = first_value;
      } else {
        iter = run();
        const n0 = iter.next();
        if (n0.done) return n0.value;
        current = n0.value;
      }
      while (true) {
        const val = (current as Data<AsReader<unknown>, unknown>).value()(
          environment,
        );
        const next = iter.next(val);
        if (next.done) return next.value;
        current = next.value;
      }
    });
  };
  Object.defineProperty(dictionary as object, do_runner_method, {
    value: reader_do,
  });
  register_traversal(
    dict,
    <from, to, result>(
      items: Iterable<from>,
      fn: (item: from) => Data<AsReader<unknown>, to>,
      build: (items: Iterable<to>) => result,
    ): Data<AsReader<unknown>, result> => {
      let fns: RawReader<unknown, to>[];
      if (Array.isArray(items)) {
        fns = new Array<RawReader<unknown, to>>(items.length);
        for (let i = 0; i < items.length; i += 1) {
          fns[i] = fn(items[i]).value() as RawReader<unknown, to>;
        }
      } else {
        fns = [];
        for (const item of items) {
          fns.push(fn(item).value() as RawReader<unknown, to>);
        }
      }
      return dict((environment: unknown) => {
        const out = new Array<to>(fns.length);
        for (let i = 0; i < fns.length; i += 1) out[i] = fns[i](environment);
        return build(out);
      }) as Data<AsReader<unknown>, result>;
    },
    <from, to>(
      items: readonly from[],
      fn: (item: from) => Data<AsReader<unknown>, to>,
    ): Data<AsReader<unknown>, to[]> =>
      dict((environment: unknown) => {
        const out = new Array<to>(items.length);
        for (let i = 0; i < items.length; i += 1) {
          out[i] = fn(items[i]).value()(environment) as to;
        }
        return out;
      }) as Data<AsReader<unknown>, to[]>,
  );
}

register_reader_traversal(Reader);

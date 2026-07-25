import {
  type As,
  type Data,
  data,
  type Dictionary,
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
  is_effect,
  is_lift_of,
  type Lift,
  type TaggedOperation,
} from "./effects.ts";
import { configured_dictionary } from "./internal.ts";
import {
  cell_dictionary,
  type CellIdentity,
  type NominalKey,
  type WidenedCellKey,
  type WithoutCell,
} from "./cell.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  type Monoid as MonoidDictionary,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const writer_identity: unique symbol;

/** A value paired with output accumulated through a Monoid dictionary. */
export type Writer<
  output extends Dictionary,
  log,
  item,
> = readonly [item, Data<output, log>];

/** The callable Writer dictionary for one output and log type. */
export interface AsWriter<
  output extends Dictionary,
  log,
> extends
  As<AsWriter<output, log>, typeof writer_identity>,
  Show<AsWriter<output, log>>,
  Monad<AsWriter<output, log>> {
  /** The item produced by a Writer value. */
  readonly [type_item]: unknown;
  /** The item and accumulated output represented by a Writer value. */
  readonly [type_data]: Writer<output, log, this[typeof type_item]>;
  /** Wraps an item and its accumulated output. */
  <item>(value: Writer<output, log, item>): WriterValue<output, log, item>;
}

/** A Writer pair wrapped with its typeclass dictionary. */
export type WriterValue<
  output extends Dictionary,
  log,
  item,
> = WrappedData<
  AsWriter<output, log>,
  Writer<output, log, item>,
  item
>;

/** @ignore */
export type WriterConstructor =
  & Omit<AsWriter<Dictionary, unknown>, "pure">
  & {
    <item>(
      value: Writer<Dictionary, unknown, item>,
    ): Data<AsWriter<Dictionary, unknown>, item>;
    <output extends MonoidDictionary<output>, log, item>(
      value: Writer<output, log, item>,
    ): WriterValue<output, log, item>;
    /** Configures Writer with the empty value for an output Monoid. */
    with<output extends MonoidDictionary<output>, log>(
      empty: Data<output, log>,
    ): AsWriter<output, log>;
  };

/** The Writer dictionary and configurable constructor. */
export const Writer = data<
  AsWriter<Dictionary, unknown>
>() as unknown as WriterConstructor;
const writer_kind = Writer[kind];

Object.defineProperty(Writer, "with", {
  value: configured_writer,
});

/** Creates a Writer value from an item and accumulated output. */
export function writer<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  value: item,
  output: Data<output, log>,
): WriterValue<output, log, item> {
  return Writer([value, output] as const) as unknown as WriterValue<
    output,
    log,
    item
  >;
}

/** Appends output without producing a meaningful item. */
export function tell<output extends MonoidDictionary<output>, log>(
  output: Data<output, log>,
): WriterValue<output, log, void> {
  return writer(undefined, output);
}

/**
 * A keyed Writer cell: its callable dictionary and the operations writing it.
 *
 * The operations live on the dictionary rather than in a wrapper type so that
 * `typeof cell` is exactly the dictionary its values carry, which is what lets
 * `Uses<typeof cell>` cancel against those values in `Program.scope`.
 */
export interface AsWriterCell<
  key extends PropertyKey,
  output extends Dictionary,
  log,
> extends
  As<AsWriterCell<key, output, log>, CellIdentity<typeof writer_identity, key>>,
  Show<AsWriterCell<key, output, log>>,
  Monad<AsWriterCell<key, output, log>> {
  /** The item produced by a cell value. */
  readonly [type_item]: unknown;
  /** The item and accumulated output represented by a cell value. */
  readonly [type_data]: Writer<output, log, this[typeof type_item]>;
  /** Wraps an item and its accumulated output. */
  <item>(
    value: Writer<output, log, item>,
  ): WriterCellValue<key, output, log, item>;
  /** Appends output to this cell without producing a meaningful item. */
  tell(output: Data<output, log>): WriterCellValue<key, output, log, void>;
  /** Pairs an item with output appended to this cell. */
  write<item>(
    value: item,
    output: Data<output, log>,
  ): WriterCellValue<key, output, log, item>;
}

/** A Writer pair wrapped with its cell's dictionary. */
export type WriterCellValue<
  key extends PropertyKey,
  output extends Dictionary,
  log,
  item,
> = WrappedData<
  AsWriterCell<key, output, log>,
  Writer<output, log, item>,
  item
>;

/**
 * Declares a keyed Writer cell.
 *
 * A cell has its own runtime kind and its own type identity, so it is drained
 * by its own `run_writer` and is invisible to every other cell and to the
 * anonymous `tell`. Name the cell, then give its output Monoid and log type:
 *
 * ```ts
 * const audit = writer_cell<"audit", AsArray, string>();
 * const metrics = writer_cell<"metrics", AsArray, number>();
 * ```
 *
 * The key distinguishes cells accumulating into the same Monoid. It exists only
 * in the type, so **declare each key exactly once**: two declarations sharing a
 * key are one cell to the compiler and two at runtime, and the second one's
 * lifts survive a handler the types said would discharge them. A key that is
 * not a literal carries no identity at all and is rejected outright.
 */
export function writer_cell<
  key extends PropertyKey,
  output extends MonoidDictionary<output>,
  log,
>(): [NominalKey<key>] extends [never] ? WidenedCellKey
  : AsWriterCell<key, output, log> {
  return make_writer_cell() as [NominalKey<key>] extends [never]
    ? WidenedCellKey
    : AsWriterCell<key, output, log>;
}

function make_writer_cell<
  key extends PropertyKey,
  output extends Dictionary,
  log,
>(): AsWriterCell<key, output, log> {
  const dictionary = cell_dictionary<AsWriterCell<key, output, log>>();

  Object.defineProperties(dictionary, {
    tell: {
      value: (output: Data<output, log>) =>
        wrap(undefined, output) as WriterCellValue<key, output, log, void>,
    },
    write: {
      value: <item>(value: item, output: Data<output, log>) =>
        wrap(value, output),
    },
  });

  Show.instance(dictionary)({
    show() {
      const [value, output] = this.value();
      return "Writer(" + inspect(value) + ", " +
        inspect((output as Data<Dictionary, unknown>).value()) + ")";
    },
  });

  Functor.instance(dictionary)({
    map(fn) {
      const [value, output] = this.value();
      return wrap(fn(value), output);
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      const [_ignored, output] = (this as unknown as Data<
        AsWriterCell<key, output, log>,
        unknown
      >).value();
      return wrap(value, empty_output(output) as Data<output, log>);
    },

    [applicative_lift_method](fn, rest) {
      const [first, output] = this.value();
      const values = [first];
      let combined_output = output;

      for (const current of rest) {
        const [value, next_output] = current.value();
        values.push(value);
        combined_output = concat_output(combined_output, next_output);
      }

      return wrap(fn(...values), combined_output);
    },

    ap(value) {
      const [fn, left_output] = this.value();
      const [item, right_output] = value.value();
      return wrap(fn(item), concat_output(left_output, right_output));
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      const [value, left_output] = this.value();
      const [item, right_output] = fn(value).value();
      return wrap(item, concat_output(left_output, right_output));
    },
  });

  return dictionary;

  function wrap<item>(
    value: item,
    output: Data<output, log>,
  ): WriterCellValue<key, output, log, item> {
    return dictionary([value, output] as Writer<output, log, item>);
  }
}

/** @ignore */
export type WithoutWriterCell<requirements, key extends PropertyKey> =
  WithoutCell<requirements, typeof writer_identity, key>;

/**
 * The empty output every lift of `key` in `requirements` accumulates into.
 *
 * One `run_writer` drains every operation addressed to its cell, so the
 * accumulator has to satisfy all of them at once: each lift contributes a
 * parameter position, so lifts writing into different Monoids under one key
 * yield an intersection no value supplies. Lifts of other cells contribute
 * nothing and stay pending.
 */
export type WriterCellEmpty<requirements, key extends PropertyKey> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends
      CellIdentity<typeof writer_identity, key>
      ? dictionary extends
        { readonly [type_data]: readonly [unknown, infer empty] }
        ? (empty: empty) => void
      : never
    : never
    : never
) extends (empty: infer empty) => void ? empty : unknown;

/**
 * The empty output a terminal cell run needs, or `never` when the effect still
 * carries requirements that the terminal runner cannot discharge.
 */
export type TerminalWriterCellEmpty<requirements, key extends PropertyKey> =
  [WithoutWriterCell<requirements, key>] extends [never]
    ? WriterCellEmpty<requirements, key>
    : never;

/** @ignore */
export type WithoutWriter<requirements> = requirements extends
  Lift<infer dictionary, infer _item>
  ? dictionary[typeof type_identity] extends typeof writer_identity ? never
  : requirements
  : requirements;

/**
 * The empty output every Writer lift in `requirements` accumulates into.
 *
 * All Writer lifts share one runtime dictionary, so a single `run_writer`
 * concatenates every `tell` in the program into one accumulator. That
 * accumulator has to satisfy all of them at once: each lift contributes a
 * parameter position, so lifts writing into different Monoids yield an
 * intersection no value supplies, and the program is rejected instead of
 * concatenating mismatched outputs.
 */
export type WriterEmpty<requirements> = (
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends typeof writer_identity
      ? dictionary extends
        { readonly [type_data]: readonly [unknown, infer empty] }
        ? (empty: empty) => void
      : never
    : never
    : never
) extends (empty: infer empty) => void ? empty : unknown;

/** Handles Writer lifts from the supplied empty output value. */
export function run_writer<requirements, item>(
  effect: Effect<requirements, item>,
  empty: WriterEmpty<requirements>,
): Effect<
  WithoutWriter<requirements>,
  readonly [item, WriterEmpty<requirements>]
>;
/** Handles one cell's lifts from the supplied empty output value. */
export function run_writer<
  key extends PropertyKey,
  output extends Dictionary,
  log,
  requirements,
  item,
>(
  cell: AsWriterCell<key, output, log>,
  effect: Effect<requirements, item>,
  empty: NoInfer<Data<output, log>> & WriterCellEmpty<requirements, key>,
): Effect<
  WithoutWriterCell<requirements, key>,
  readonly [item, Data<output, log> & WriterCellEmpty<requirements, key>]
>;
export function run_writer(
  ...args:
    | readonly [Effect<unknown, unknown>, unknown]
    | readonly [
      AsWriterCell<PropertyKey, Dictionary, unknown>,
      Effect<unknown, unknown>,
      unknown,
    ]
): Effect<unknown, unknown> {
  if (args.length === 2) {
    const [effect, empty] = args;

    return run_writer_kind(effect, writer_kind, empty);
  }

  const [cell, effect, empty] = args;

  return run_writer_kind(
    effect,
    cell[kind] as AsWriter<Dictionary, unknown>[typeof kind],
    empty,
  );
}

function run_writer_kind<requirements, item>(
  effect: Effect<requirements, item>,
  runtime_kind: AsWriter<Dictionary, unknown>[typeof kind],
  empty: WriterEmpty<requirements>,
): Effect<
  WithoutWriter<requirements>,
  readonly [item, WriterEmpty<requirements>]
> {
  return handle_lift(effect, runtime_kind, empty, {
    done(value, output) {
      return [value as item, output] as const;
    },
    handle(
      value: Data<AsWriter<Dictionary, unknown>, unknown>,
      output,
    ) {
      const [item, next_output] = value.value();
      return [
        item,
        concat_output(output, next_output) as WriterEmpty<requirements>,
      ] as const;
    },
  }) as Effect<
    WithoutWriter<requirements>,
    readonly [item, WriterEmpty<requirements>]
  >;
}

/**
 * The empty output a terminal run needs, or `never` when the effect still
 * carries requirements that `run_writer_terminal` cannot discharge.
 */
export type TerminalWriterEmpty<requirements> =
  [WithoutWriter<requirements>] extends [never] ? WriterEmpty<requirements>
    : never;

/** Runs one Writer value or an effect containing only Writer lifts. */
export function run_writer_terminal<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  writer: WriterValue<output, log, item>,
  empty: Data<output, log>,
): readonly [item, Data<output, log>];
/** Runs an effect containing only Writer lifts. */
export function run_writer_terminal<requirements, item>(
  effect: Effect<requirements, item>,
  empty: TerminalWriterEmpty<requirements>,
): readonly [item, WriterEmpty<requirements>];
/** Runs a Writer value or an effect containing only Writer lifts. */
export function run_writer_terminal<
  requirements,
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  value:
    | WriterValue<output, log, item>
    | Effect<requirements, item>,
  empty: Data<output, log> & TerminalWriterEmpty<requirements>,
): readonly [item, Data<output, log>];
export function run_writer_terminal<
  requirements,
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  effect:
    | WriterValue<output, log, item>
    | Effect<requirements, item>,
  empty: Data<output, log>,
): readonly [item, Data<output, log>] {
  if (is_data(effect)) {
    if (
      (effect as unknown as Data<AsWriter<Dictionary, unknown>, unknown>)[
        kind
      ] !==
        writer_kind
    ) {
      throw new TypeError("Unhandled effect operation: lift");
    }

    const [value, next_output] = (effect as WriterValue<output, log, item>)
      .value();
    return [value, empty.concat(next_output)];
  }

  let current = effect as Effect<
    Lift<AsWriter<output, log>, unknown>,
    unknown
  >;
  let current_output = empty;

  while (true) {
    if (!is_effect(current)) {
      throw new TypeError("Invalid effect value");
    }

    if (current[0] === "pure") {
      return [current[1] as item, current_output];
    }

    if (current[0] !== "impure") {
      throw new TypeError("Invalid effect value");
    }

    const operation = current[1];

    if (!is_lift_of(operation, writer_kind)) {
      throw new TypeError(
        "Unhandled effect operation: " + (operation as TaggedOperation)[0],
      );
    }

    const [value, next_output] = operation[1].value();
    current_output = current_output.concat(next_output);
    current = current[2](value) as Effect<
      Lift<AsWriter<output, log>, unknown>,
      unknown
    >;
  }
}

/** @ignore */
export type WriterOutput<requirements> = requirements extends Lift<
  AsWriter<infer output, infer _log>,
  infer _item
> ? output
  : never;

/** @ignore */
export type WriterLog<requirements> = requirements extends Lift<
  AsWriter<infer _output, infer log>,
  infer _item
> ? log
  : never;

Show.instance(Writer)({
  show() {
    const [value, output] = this.value();
    return "Writer(" + inspect(value) + ", " +
      inspect((output as Data<Dictionary, unknown>).value()) + ")";
  },
});

Functor.instance(Writer)({
  map(fn) {
    const [value, output] = this.value();
    return writer_any(fn(value), output);
  },
});

Applicative.instance(Writer)({
  pure(value) {
    const [_ignored, output] = (this as unknown as Data<
      AsWriter<Dictionary, unknown>,
      unknown
    >).value();
    return writer_any(value, empty_output(output));
  },

  [applicative_lift_method](fn, rest) {
    const [first, output] = this.value();
    const values = [first];
    let combined_output = output;

    for (const current of rest) {
      const [value, next_output] = current.value();
      values.push(value);
      combined_output = concat_output(combined_output, next_output);
    }

    return writer_any(fn(...values), combined_output);
  },

  ap(value) {
    const [fn, left_output] = this.value();
    const [item, right_output] = value.value();
    return writer_any(fn(item), concat_output(left_output, right_output));
  },
});

Monad.instance(Writer)({
  bind(fn) {
    const [value, left_output] = this.value();
    const [item, right_output] = fn(value).value();
    return writer_any(item, concat_output(left_output, right_output));
  },
});

/** Extracts the output dictionary required by Writer lifts. */
export type WriterEffectOutput<requirements> = WriterOutput<requirements>;
/** Extracts the log item required by Writer lifts. */
export type WriterEffectLog<requirements> = WriterLog<requirements>;

function writer_any<item>(
  value: item,
  output: unknown,
): Data<AsWriter<Dictionary, unknown>, item> {
  return Writer([
    value,
    output as Data<Dictionary, unknown>,
  ] as Writer<Dictionary, unknown, item>);
}

function empty_output(output: unknown): unknown {
  const monoid = output as Data<MonoidDictionary<Dictionary>, unknown>;

  return monoid.empty();
}

function concat_output<output extends Dictionary, log>(
  left: Data<output, log>,
  right: unknown,
): Data<output, log>;
function concat_output(left: unknown, right: unknown): unknown;
function concat_output(left: unknown, right: unknown): unknown {
  const monoid = left as Data<MonoidDictionary<Dictionary>, unknown>;

  return monoid.concat(
    right as Data<MonoidDictionary<Dictionary>, unknown>,
  );
}

function configured_writer<
  output extends MonoidDictionary<output>,
  log,
>(empty: Data<output, log>): AsWriter<output, log> {
  const dictionary = configured_dictionary(
    Writer,
    data<AsWriter<output, log>>(),
  );

  Show.instance(dictionary)({
    show() {
      const [value, output] = this.value();
      return "Writer(" + inspect(value) + ", " +
        inspect(output.value()) + ")";
    },
  });

  Functor.instance(dictionary)({
    map(fn) {
      const [value, output] = this.value();
      return wrap(fn(value), output);
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(value, empty.empty());
    },

    [applicative_lift_method](fn, rest) {
      const [first, output] = this.value();
      const values = [first];
      let combined_output = output;

      for (const current of rest) {
        const [value, next_output] = current.value();
        values.push(value);
        combined_output = combined_output.concat(next_output);
      }

      return wrap(fn(...values), combined_output);
    },

    ap(value) {
      const [fn, left_output] = this.value();
      const [item, right_output] = value.value();
      return wrap(fn(item), left_output.concat(right_output));
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      const [value, left_output] = this.value();
      const [item, right_output] = fn(value).value();
      return wrap(item, left_output.concat(right_output));
    },
  });

  return dictionary;

  function wrap<item>(
    value: item,
    output: Data<output, log>,
  ): WriterValue<output, log, item> {
    return dictionary([value, output] as const);
  }
}

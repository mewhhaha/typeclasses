import {
  type As,
  type Data,
  data,
  type Dictionary,
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
  is_effect,
  is_lift_of,
  type Lift,
  type TaggedOperation,
} from "./effects.ts";
import { configured_dictionary } from "./internal.ts";
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

/** @ignore */
export type WithoutWriter<
  requirements,
  output extends Dictionary,
  log,
> = requirements extends Lift<infer dictionary, infer _item>
  ? DictionaryDataType<dictionary> extends
    DictionaryDataType<AsWriter<output, log>> ? never
  : requirements
  : requirements;

/** Handles Writer lifts from the supplied empty output value. */
export function run_writer<
  output extends MonoidDictionary<output>,
  log,
  requirements,
  item,
>(
  effect: Effect<requirements, item>,
  empty: Data<output, log>,
): Effect<
  WithoutWriter<requirements, output, log>,
  readonly [item, Data<output, log>]
> {
  return handle_lift(effect, writer_kind, empty, {
    done(value, output) {
      return [value as item, output] as const;
    },
    handle(value, output) {
      const [item, next_output] = value.value();
      return [item, concat_output(output, next_output)] as const;
    },
  });
}

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
export function run_writer_terminal<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  effect: Effect<Lift<AsWriter<output, log>, unknown>, item>,
  empty: Data<output, log>,
): readonly [item, Data<output, log>];
/** Runs a Writer value or an effect containing only Writer lifts. */
export function run_writer_terminal<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  value:
    | WriterValue<output, log, item>
    | Effect<Lift<AsWriter<output, log>, unknown>, item>,
  empty: Data<output, log>,
): readonly [item, Data<output, log>];
export function run_writer_terminal<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  effect:
    | WriterValue<output, log, item>
    | Effect<Lift<AsWriter<output, log>, unknown>, item>,
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

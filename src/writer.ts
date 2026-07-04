import { define, type Dictionary, type Trait, type Value } from "./trait.ts";
import { Effect, handle_lift, type Lift, type WithoutLift } from "./effects.ts";
import {
  Applicative,
  Format,
  Functor,
  Monad,
  Monoid,
  type Monoid as MonoidDictionary,
} from "./traits.ts";

export type Writer<
  output extends Dictionary,
  log,
  item,
> = readonly [item, Value<output, log>];

type AnyWriter<item> = readonly [item, unknown];

export const writer_kind = Symbol("Writer");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [writer_kind]: AnyWriter<item>;
  }
}

export interface AsWriter<
  output extends Dictionary,
  log,
> extends Dictionary<typeof writer_kind> {
  <item>(value: Writer<output, log, item>): WriterValue<output, log, item>;
}

export type WriterValue<
  output extends Dictionary,
  log,
  item,
> = Trait<
  AsWriter<output, log>,
  Writer<output, log, item>,
  item
>;

type WriterConstructor =
  & AsWriter<Dictionary, unknown>
  & {
    <output extends MonoidDictionary<output>, log, item>(
      value: Writer<output, log, item>,
    ): WriterValue<output, log, item>;
  };

export const Writer = define<AsWriter<Dictionary, unknown>>(
  writer_kind,
) as WriterConstructor;

export function writer<
  output extends MonoidDictionary<output>,
  log,
  item,
>(
  value: item,
  output: Value<output, log>,
): WriterValue<output, log, item> {
  return Writer([value, output] as const);
}

export function tell<output extends MonoidDictionary<output>, log>(
  output: Value<output, log>,
): WriterValue<output, log, void> {
  return writer(undefined, output);
}

export function run_writer<
  output extends MonoidDictionary<output>,
  log,
  requirements,
  item,
>(
  effect: Effect<requirements, item>,
  empty: Value<output, log>,
): Effect<
  WithoutLift<requirements, AsWriter<output, log>>,
  readonly [item, Value<output, log>]
> {
  return handle_lift(effect, writer_kind, empty, {
    done(value: item, output) {
      return [value, output] as const;
    },

    handle(
      writer: Value<AsWriter<output, log>, unknown>,
      output,
    ) {
      const [value, next_output] = writer.value();
      return [value, concat_output(output, next_output)] as const;
    },
  });
}

type WriterOutput<requirements> = requirements extends Lift<
  AsWriter<infer output, infer _log>,
  infer _item
> ? output
  : never;

type WriterLog<requirements> = requirements extends Lift<
  AsWriter<infer _output, infer log>,
  infer _item
> ? log
  : never;

Format.implement(Writer)({
  fmt() {
    const [value, output] = this.value();
    return "Writer(" + Deno.inspect(value) + ", " +
      Deno.inspect((output as Value<Dictionary, unknown>).value()) + ")";
  },
});

export interface AsWriter<
  output extends Dictionary,
  log,
> extends Format<AsWriter<output, log>> {}

Functor.implement(Writer)({
  map(fn) {
    const [value, output] = this.value();
    return writer_any(fn(value), output);
  },
});

export interface AsWriter<
  output extends Dictionary,
  log,
> extends Functor<AsWriter<output, log>> {}

Applicative.implement(Writer)({
  pure(value) {
    const [_ignored, output] = this.value();
    return writer_any(value, empty_output(output));
  },

  ap(value) {
    const [fn, left_output] = this.value();
    const [item, right_output] = value.value();
    return writer_any(fn(item), concat_output(left_output, right_output));
  },
});

export interface AsWriter<
  output extends Dictionary,
  log,
> extends Applicative<AsWriter<output, log>> {}

Monad.implement(Writer)({
  bind(fn) {
    const [value, left_output] = this.value();
    const [item, right_output] = fn(value).value();
    return writer_any(item, concat_output(left_output, right_output));
  },
});

export interface AsWriter<
  output extends Dictionary,
  log,
> extends Monad<AsWriter<output, log>> {}

export type WriterEffectOutput<requirements> = WriterOutput<requirements>;
export type WriterEffectLog<requirements> = WriterLog<requirements>;

function writer_any<item>(
  value: item,
  output: unknown,
): Value<AsWriter<Dictionary, unknown>, item> {
  return Writer([
    value,
    output as Value<Dictionary, unknown>,
  ] as Writer<Dictionary, unknown, item>);
}

function empty_output(output: unknown): unknown {
  return Monoid.empty(output as Value<MonoidDictionary<Dictionary>, unknown>);
}

function concat_output<output extends Dictionary, log>(
  left: Value<output, log>,
  right: unknown,
): Value<output, log>;
function concat_output(left: unknown, right: unknown): unknown;
function concat_output(left: unknown, right: unknown): unknown {
  return Monoid.concat(
    left as Value<MonoidDictionary<Dictionary>, unknown>,
    right as Value<MonoidDictionary<Dictionary>, unknown>,
  );
}

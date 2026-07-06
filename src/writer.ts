import {
  type As,
  type Data,
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
  Functor,
  Monad,
  Monoid,
  type Monoid as MonoidDictionary,
  Show,
} from "./typeclasses.ts";

export type Writer<
  output extends Dictionary,
  log,
  item,
> = readonly [item, Data<output, log>];

export interface AsWriter<
  output extends Dictionary,
  log,
> extends
  As<AsWriter<output, log>>,
  Show<AsWriter<output, log>>,
  Functor<AsWriter<output, log>>,
  Applicative<AsWriter<output, log>>,
  Monad<AsWriter<output, log>> {
  readonly [type_item]: unknown;
  readonly [type_data]: Writer<output, log, this[typeof type_item]>;
  <item>(value: Writer<output, log, item>): WriterValue<output, log, item>;
}

export type WriterValue<
  output extends Dictionary,
  log,
  item,
> = WrappedData<
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

export const Writer = data<
  AsWriter<Dictionary, unknown>
>() as WriterConstructor;

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

export function tell<output extends MonoidDictionary<output>, log>(
  output: Data<output, log>,
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
  empty: Data<output, log>,
): Effect<
  WithoutLift<requirements, AsWriter<output, log>>,
  readonly [item, Data<output, log>]
> {
  if (effect.tag === "pure") {
    return pure([effect.value, empty] as const);
  }

  const operation = effect.operation as {
    readonly tag?: string;
    readonly value?: unknown;
  };

  if (operation.tag === "lift" && is_writer_value(operation.value)) {
    const lifted = effect.operation as unknown as Lift<
      AsWriter<output, log>,
      unknown
    >;
    const [value, next_output] = lifted.value.value();
    return run_writer(
      effect.resume(value),
      concat_output(empty, next_output),
    );
  }

  return suspend(
    effect.operation as WithoutLift<requirements, AsWriter<output, log>>,
    (value) => run_writer(effect.resume(value), empty),
  ) as Effect<
    WithoutLift<requirements, AsWriter<output, log>>,
    readonly [item, Data<output, log>]
  >;
}

function is_writer_value(value: unknown): value is Dictionary {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === Writer[kind];
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

Show.instance(Writer)({
  show() {
    const [value, output] = this.value();
    return "Writer(" + Deno.inspect(value) + ", " +
      Deno.inspect((output as Data<Dictionary, unknown>).value()) + ")";
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
    const [_ignored, output] = this.value();
    return writer_any(value, empty_output(output));
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

export type WriterEffectOutput<requirements> = WriterOutput<requirements>;
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
  return Monoid.empty(output as Data<MonoidDictionary<Dictionary>, unknown>);
}

function concat_output<output extends Dictionary, log>(
  left: Data<output, log>,
  right: unknown,
): Data<output, log>;
function concat_output(left: unknown, right: unknown): unknown;
function concat_output(left: unknown, right: unknown): unknown {
  return Monoid.concat(
    left as Data<MonoidDictionary<Dictionary>, unknown>,
    right as Data<MonoidDictionary<Dictionary>, unknown>,
  );
}

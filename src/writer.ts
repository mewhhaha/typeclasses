import { define, type Dictionary, type Trait, type Value } from "./trait.ts";
import {
  Effect,
  handle_lift,
  is_effect,
  type Lift,
  type WithoutLift,
} from "./effects.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Writer<log, item> = readonly [item, readonly log[]];

export const writer_kind = Symbol("Writer");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [writer_kind]: dictionary extends AsWriter<infer log> ? Writer<log, item>
      : never;
  }
}

export interface AsWriter<log> extends Dictionary<typeof writer_kind> {
  <item>(value: Writer<log, item>): WriterValue<log, item>;
}

export type WriterValue<log, item> = Trait<
  AsWriter<log>,
  Writer<log, item>,
  item
>;

type WriterConstructor =
  & AsWriter<never>
  & {
    <log, item>(value: Writer<log, item>): WriterValue<log, item>;
  };

export const Writer = define<AsWriter<never>>(
  writer_kind,
) as WriterConstructor;

export function writer<log, item>(
  value: item,
  logs: readonly log[],
): WriterValue<log, item> {
  return Writer([value, logs] as const);
}

export function tell<log>(log: log): WriterValue<log, void> {
  return writer(undefined, [log]);
}

export function run_writer<log, item>(
  value: Value<AsWriter<log>, item>,
): Writer<log, item>;
export function run_writer<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<
  WithoutLift<requirements, AsWriter<WriterLog<requirements>>>,
  readonly [item, readonly WriterLog<requirements>[]]
>;
export function run_writer<requirements, log, item>(
  value_or_effect:
    | Value<AsWriter<log>, item>
    | Effect<requirements, item>,
):
  | Writer<log, item>
  | Effect<
    WithoutLift<requirements, AsWriter<WriterLog<requirements>>>,
    readonly [item, readonly WriterLog<requirements>[]]
  > {
  if (is_effect(value_or_effect)) {
    return run_writer_effect(value_or_effect);
  }

  return value_or_effect.value();
}

type WriterLog<requirements> = requirements extends Lift<
  AsWriter<infer log>,
  infer _item
> ? log
  : never;

function run_writer_effect<requirements, item>(
  effect: Effect<requirements, item>,
  logs: readonly WriterLog<requirements>[] = [],
): Effect<
  WithoutLift<requirements, AsWriter<WriterLog<requirements>>>,
  readonly [item, readonly WriterLog<requirements>[]]
> {
  return handle_lift(effect, writer_kind, logs, {
    done(value: item, logs) {
      return [value, logs] as const;
    },

    handle(
      writer: Value<AsWriter<WriterLog<requirements>>, unknown>,
      logs,
    ) {
      const [value, next_logs] = run_writer(writer);
      return [value, append_logs(logs, next_logs)] as const;
    },
  });
}

Format.implement(Writer)({
  fmt() {
    const [value, logs] = this.value();
    return "Writer(" + Deno.inspect(value) + ", " + Deno.inspect(logs) + ")";
  },
});

export interface AsWriter<log> extends Format<AsWriter<log>> {}

Functor.implement(Writer)({
  map(fn) {
    const [value, logs] = run_writer(this);
    return writer(fn(value), logs);
  },
});

export interface AsWriter<log> extends Functor<AsWriter<log>> {}

Applicative.implement(Writer)({
  pure(value) {
    return writer(value, []);
  },

  ap(value) {
    const [fn, left_logs] = run_writer(this);
    const [item, right_logs] = run_writer(value);
    return writer(fn(item), append_logs(left_logs, right_logs));
  },
});

export interface AsWriter<log> extends Applicative<AsWriter<log>> {}

Monad.implement(Writer)({
  bind(fn) {
    const [value, left_logs] = run_writer(this);
    const [item, right_logs] = run_writer(fn(value));
    return writer(item, append_logs(left_logs, right_logs));
  },
});

export interface AsWriter<log> extends Monad<AsWriter<log>> {}

function append_logs<log>(
  left: readonly log[],
  right: readonly log[],
): readonly log[] {
  if (left.length === 0) {
    return right;
  }

  if (right.length === 0) {
    return left;
  }

  return [...left, ...right];
}

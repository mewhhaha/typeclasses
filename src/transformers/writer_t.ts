import { define, type Dictionary, type Trait, type Value } from "../trait.ts";
import { Applicative, Format, Functor, Monad } from "../traits.ts";

export type WriterMonoid<log> = {
  readonly empty: log;
  concat(left: log, right: log): log;
};

export type WriterT<
  base extends Dictionary,
  log,
  item,
> = Value<base, readonly [item, log]>;

export const writer_t_kind = Symbol("WriterT");

declare module "../trait.ts" {
  interface TraitTypes<dictionary, item> {
    [writer_t_kind]: dictionary extends AsWriterT<infer base, infer log>
      ? WriterT<base, log, item>
      : never;
  }
}

export interface AsWriterT<base extends Dictionary, log>
  extends Dictionary<typeof writer_t_kind> {
  readonly base: Value<base, unknown>;
  readonly monoid: WriterMonoid<log>;
  <item>(value: WriterT<base, log, item>): WriterTValue<base, log, item>;
}

export type WriterTValue<
  base extends Dictionary,
  log,
  item,
> = Trait<
  AsWriterT<base, log>,
  WriterT<base, log, item>,
  item
>;

export type WriterTConstructor<base extends Monad<base>, log> =
  & AsWriterT<base, log>
  & {
    <item>(value: WriterT<base, log, item>): WriterTValue<base, log, item>;
    tell(log: log): WriterTValue<base, log, void>;
    listen<item>(
      value: Value<AsWriterT<base, log>, item>,
    ): WriterTValue<base, log, readonly [item, log]>;
    lift<item>(value: Value<base, item>): WriterTValue<base, log, item>;
    run<item>(
      value: Value<AsWriterT<base, log>, item>,
    ): Value<base, readonly [item, log]>;
  };

export function WriterT<base extends Monad<base>, log>(
  base: Value<base, unknown>,
  monoid: WriterMonoid<log>,
): WriterTConstructor<base, log> {
  const target = define<AsWriterT<base, log>>(
    writer_t_kind,
  ) as WriterTConstructor<base, log>;

  Object.defineProperty(target, "base", {
    enumerable: true,
    value: base,
  });
  Object.defineProperty(target, "monoid", {
    enumerable: true,
    value: monoid,
  });

  target.tell = function tell(log: log) {
    return target(Applicative.pure(base, [undefined, log] as const));
  };
  target.listen = function listen<item>(
    value: Value<AsWriterT<base, log>, item>,
  ) {
    return target(
      Functor.map(run_writer_t(value), ([item, log]) => {
        return [[item, log] as const, log] as const;
      }),
    );
  };
  target.lift = function lift<item>(value: Value<base, item>) {
    return target(
      Functor.map(value, (item) => [item, monoid.empty] as const),
    );
  };
  target.run = run_writer_t;

  Format.implement(target)({
    fmt() {
      return "WriterT(?)";
    },
  });

  Functor.implement(target)({
    map(fn) {
      return target(
        Functor.map(run_writer_t(this), ([value, log]) => {
          return [fn(value), log] as const;
        }),
      );
    },
  });

  Applicative.implement(target)({
    pure(value) {
      return target(Applicative.pure(base, [value, monoid.empty] as const));
    },

    ap(value) {
      return target(
        Monad.bind(run_writer_t(this), ([fn, left_log]) => {
          return Functor.map(run_writer_t(value), ([item, right_log]) => {
            return [fn(item), monoid.concat(left_log, right_log)] as const;
          });
        }),
      );
    },
  });

  Monad.implement(target)({
    bind(fn) {
      return target(
        Monad.bind(run_writer_t(this), ([value, left_log]) => {
          return Functor.map(run_writer_t(fn(value)), ([item, right_log]) => {
            return [item, monoid.concat(left_log, right_log)] as const;
          });
        }),
      );
    },
  });

  return target;
}

export interface AsWriterT<base extends Dictionary, log>
  extends
    Format<AsWriterT<base, log>>,
    Functor<AsWriterT<base, log>>,
    Applicative<AsWriterT<base, log>>,
    Monad<AsWriterT<base, log>> {}

export function run_writer_t<base extends Dictionary, log, item>(
  value: Value<AsWriterT<base, log>, item>,
): Value<base, readonly [item, log]> {
  return value.value();
}

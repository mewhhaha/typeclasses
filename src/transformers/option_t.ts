import { none, type Option, some } from "../option.ts";
import { define, type Dictionary, type Trait, type Value } from "../trait.ts";
import { Applicative, Format, Functor, Monad } from "../traits.ts";

export type OptionT<base extends Dictionary, item> = Value<
  base,
  Option<item>
>;

export const option_t_kind = Symbol("OptionT");

declare module "../trait.ts" {
  interface TraitTypes<dictionary, item> {
    [option_t_kind]: dictionary extends AsOptionT<infer base>
      ? OptionT<base, item>
      : never;
  }
}

export interface AsOptionT<base extends Dictionary>
  extends Dictionary<typeof option_t_kind> {
  readonly base: Value<base, unknown>;
  <item>(value: OptionT<base, item>): OptionTValue<base, item>;
}

export type OptionTValue<
  base extends Dictionary,
  item,
> = Trait<
  AsOptionT<base>,
  OptionT<base, item>,
  item
>;

export type OptionTConstructor<base extends Monad<base>> =
  & AsOptionT<base>
  & {
    <item>(value: OptionT<base, item>): OptionTValue<base, item>;
    some<item>(value: item): OptionTValue<base, item>;
    none<item>(): OptionTValue<base, item>;
    lift<item>(value: Value<base, item>): OptionTValue<base, item>;
    run<item>(value: Value<AsOptionT<base>, item>): Value<base, Option<item>>;
  };

export function OptionT<base extends Monad<base>>(
  base: Value<base, unknown>,
): OptionTConstructor<base> {
  const target = define<AsOptionT<base>>(
    option_t_kind,
  ) as OptionTConstructor<base>;

  Object.defineProperty(target, "base", {
    enumerable: true,
    value: base,
  });

  target.some = function some_t<item>(value: item) {
    return target(Applicative.pure(base, some(value).value()));
  };
  target.none = function none_t<item>() {
    return target(Applicative.pure(base, none<item>().value()));
  };
  target.lift = function lift<item>(value: Value<base, item>) {
    return target(Functor.map(value, (item) => some(item).value()));
  };
  target.run = run_option_t;

  Format.implement(target)({
    fmt() {
      return "OptionT(?)";
    },
  });

  Functor.implement(target)({
    map(fn) {
      return target(
        Functor.map(run_option_t(this), (option) => map_option(option, fn)),
      );
    },
  });

  Applicative.implement(target)({
    pure(value) {
      return target(Applicative.pure(base, some(value).value()));
    },

    ap(value) {
      return target(
        Monad.bind(run_option_t(this), (fn_option) => {
          if (fn_option.tag === "none") {
            return Applicative.pure(base, none().value());
          }

          return Functor.map(run_option_t(value), (option) => {
            return map_option(option, fn_option.value);
          });
        }),
      );
    },
  });

  Monad.implement(target)({
    bind(fn) {
      return target(
        Monad.bind(run_option_t(this), (option) => {
          if (option.tag === "none") {
            return Applicative.pure(base, none().value());
          }

          return run_option_t(fn(option.value));
        }),
      );
    },
  });

  return target;
}

export interface AsOptionT<base extends Dictionary>
  extends
    Format<AsOptionT<base>>,
    Functor<AsOptionT<base>>,
    Applicative<AsOptionT<base>>,
    Monad<AsOptionT<base>> {}

export function run_option_t<base extends Dictionary, item>(
  value: Value<AsOptionT<base>, item>,
): Value<base, Option<item>> {
  return value.value();
}

function map_option<from, to>(
  option: Option<from>,
  fn: (value: from) => to,
): Option<to> {
  if (option.tag === "none") {
    return none<to>().value();
  }

  return some(fn(option.value)).value();
}

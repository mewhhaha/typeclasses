import { err, ok, type Result } from "../result.ts";
import { define, type Dictionary, type Trait, type Value } from "../trait.ts";
import { Applicative, Format, Functor, Monad } from "../traits.ts";

export type ResultT<base extends Dictionary, item> = Value<
  base,
  Result<item, string>
>;

export const result_t_kind = Symbol("ResultT");

declare module "../trait.ts" {
  interface TraitTypes<dictionary, item> {
    [result_t_kind]: dictionary extends AsResultT<infer base>
      ? ResultT<base, item>
      : never;
  }
}

export interface AsResultT<base extends Dictionary>
  extends Dictionary<typeof result_t_kind> {
  readonly base: Value<base, unknown>;
  <item>(value: ResultT<base, item>): ResultTValue<base, item>;
}

export type ResultTValue<
  base extends Dictionary,
  item,
> = Trait<
  AsResultT<base>,
  ResultT<base, item>,
  item
>;

export type ResultTConstructor<base extends Monad<base>> =
  & AsResultT<base>
  & {
    <item>(value: ResultT<base, item>): ResultTValue<base, item>;
    ok<item>(value: item): ResultTValue<base, item>;
    err<item>(error: string): ResultTValue<base, item>;
    lift<item>(value: Value<base, item>): ResultTValue<base, item>;
    run<item>(
      value: Value<AsResultT<base>, item>,
    ): Value<base, Result<item, string>>;
  };

export function ResultT<base extends Monad<base>>(
  base: Value<base, unknown>,
): ResultTConstructor<base> {
  const target = define<AsResultT<base>>(
    result_t_kind,
  ) as ResultTConstructor<base>;

  Object.defineProperty(target, "base", {
    enumerable: true,
    value: base,
  });

  target.ok = function ok_t<item>(value: item) {
    return target(Applicative.pure(base, ok(value).value()));
  };
  target.err = function err_t<item>(error: string) {
    return target(Applicative.pure(base, err<item>(error).value()));
  };
  target.lift = function lift<item>(value: Value<base, item>) {
    return target(Functor.map(value, (item) => ok(item).value()));
  };
  target.run = run_result_t;

  Format.implement(target)({
    fmt() {
      return "ResultT(?)";
    },
  });

  Functor.implement(target)({
    map(fn) {
      return target(
        Functor.map(run_result_t(this), (result) => map_result(result, fn)),
      );
    },
  });

  Applicative.implement(target)({
    pure(value) {
      return target(Applicative.pure(base, ok(value).value()));
    },

    ap(value) {
      return target(
        Monad.bind(run_result_t(this), (fn_result) => {
          if (fn_result.tag === "err") {
            return Applicative.pure(base, err(fn_result.error).value());
          }

          return Functor.map(run_result_t(value), (result) => {
            return map_result(result, fn_result.value);
          });
        }),
      );
    },
  });

  Monad.implement(target)({
    bind(fn) {
      return target(
        Monad.bind(run_result_t(this), (result) => {
          if (result.tag === "err") {
            return Applicative.pure(base, err(result.error).value());
          }

          return run_result_t(fn(result.value));
        }),
      );
    },
  });

  return target;
}

export interface AsResultT<base extends Dictionary>
  extends
    Format<AsResultT<base>>,
    Functor<AsResultT<base>>,
    Applicative<AsResultT<base>>,
    Monad<AsResultT<base>> {}

export function run_result_t<base extends Dictionary, item>(
  value: Value<AsResultT<base>, item>,
): Value<base, Result<item, string>> {
  return value.value();
}

function map_result<from, to>(
  result: Result<from, string>,
  fn: (value: from) => to,
): Result<to, string> {
  if (result.tag === "err") {
    return err<to>(result.error).value();
  }

  return ok(fn(result.value)).value();
}

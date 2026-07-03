import {
  type ContextDictionary,
  define_dictionary,
  type Value,
} from "./trait.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Traversable,
} from "./traits.ts";

export type Result<item, error = string> =
  | { tag: "ok"; value: item }
  | { tag: "err"; error: error };

type Ok<item> = { tag: "ok"; value: item };

export const result_kind: unique symbol = Symbol("Result");

declare module "./trait.ts" {
  interface ContextValues<item> {
    [result_kind]: Result<item, string>;
  }
}

export interface ResultDictionary
  extends ContextDictionary<typeof result_kind> {
  <item>(value: Result<item, string>): ResultValue<item>;
}

type ResultValue<item> = Value<ResultDictionary, item>;

export const Result = define_dictionary<ResultDictionary>(
  result_kind,
);

export function ok<item>(value: item): ResultValue<item> {
  return Result(result_ok(value));
}

export function err<item = never>(error: string): ResultValue<item> {
  return Result(result_err<item>(error));
}

export function from_number(value: number): ResultValue<number> {
  if (Number.isFinite(value)) {
    return ok(value);
  }

  return err("Expected a finite number");
}

Format.implement(Result)({
  fmt(value) {
    const result = value.value();

    if (result.tag === "err") {
      return "Err(" + Deno.inspect(result.error) + ")";
    }

    return "Ok(" + Deno.inspect(result.value) + ")";
  },
});

export interface ResultDictionary extends Format<ResultDictionary> {}

Equal.implement(Result)({
  eq(left_value, right) {
    const left = left_value.value();
    const right_value = right.value();

    if (left.tag === "err" && right_value.tag === "err") {
      return Object.is(left.error, right_value.error);
    }

    if (left.tag === "ok" && right_value.tag === "ok") {
      return Object.is(left.value, right_value.value);
    }

    return false;
  },
});

export interface ResultDictionary extends Equal<ResultDictionary> {}

Functor.implement(Result)({
  map(value, fn) {
    const result = value.value();

    if (result.tag === "err") {
      return err(result.error);
    }

    return ok(fn(result.value));
  },
});

export interface ResultDictionary extends Functor<ResultDictionary> {}

Applicative.implement(Result)({
  pure(_value, value) {
    return ok(value);
  },

  ap(fn_value, value) {
    const fn = fn_value.value();
    const result = value.value();

    if (fn.tag === "err") {
      return err(fn.error);
    }

    if (result.tag === "err") {
      return err(result.error);
    }

    return ok(fn.value(result.value));
  },
});

export interface ResultDictionary extends Applicative<ResultDictionary> {}

Monad.implement(Result)({
  bind(value, fn) {
    const result = value.value();

    if (result.tag === "err") {
      return err(result.error);
    }

    return fn(result.value);
  },
});

export interface ResultDictionary extends Monad<ResultDictionary> {}

Foldable.implement(Result)({
  fold(value, initial, fn) {
    const result = value.value();

    if (result.tag === "err") {
      return initial;
    }

    return fn(initial, result.value);
  },
});

export interface ResultDictionary extends Foldable<ResultDictionary> {}

Traversable.implement(Result)({
  traverse(value, applicative, fn) {
    const result = value.value();

    if (result.tag === "err") {
      return Applicative.pure(applicative, err(result.error));
    }

    return Functor.map(fn(result.value), (value) => ok(value));
  },
});

export interface ResultDictionary extends Traversable<ResultDictionary> {}

function result_ok<item>(value: item): Ok<item> {
  return { tag: "ok", value };
}

function result_err<item = never>(error: string): Result<item> {
  return { tag: "err", error };
}

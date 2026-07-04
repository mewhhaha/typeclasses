import { type As, define, type Trait } from "./trait.ts";
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
  | Ok<item>
  | Err<error>;

export type Ok<item> = readonly ["ok", item];
export type Err<error = string> = readonly ["err", error];

export const result_kind = Symbol("Result");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [result_kind]: Result<item, unknown>;
  }
}

export interface AsResult extends As<typeof result_kind> {}

export type ResultValue<error, item> = Trait<
  AsResult,
  Result<item, error>,
  item
>;

type ResultConstructor =
  & AsResult
  & {
    <item, error>(value: Result<item, error>): ResultValue<error, item>;
  };

export const Result = define<AsResult>(
  result_kind,
) as ResultConstructor;

export function ok<item>(value: item): ResultValue<never, item> {
  return Result(result_ok(value)) as ResultValue<never, item>;
}

export function err<item = never, error = string>(
  error: error,
): ResultValue<error, item> {
  return Result(result_err<item, error>(error)) as ResultValue<error, item>;
}

export function is_ok<item, error>(
  value: Result<item, error>,
): value is Ok<item> {
  return value[0] === "ok";
}

export function is_err<item, error>(
  value: Result<item, error>,
): value is Err<error> {
  return value[0] === "err";
}

export function from_number(value: number) {
  if (Number.isFinite(value)) {
    return ok(value);
  }

  return err("Expected a finite number");
}

Format.implement(Result)({
  fmt() {
    const result = this.value();

    if (result[0] === "err") {
      return "Err(" + Deno.inspect(result[1]) + ")";
    }

    return "Ok(" + Deno.inspect(result[1]) + ")";
  },
});

export interface AsResult extends Format<AsResult> {}

Equal.implement(Result)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left[0] === "err" && right_value[0] === "err") {
      return Object.is(left[1], right_value[1]);
    }

    if (left[0] === "ok" && right_value[0] === "ok") {
      return Object.is(left[1], right_value[1]);
    }

    return false;
  },
});

export interface AsResult extends Equal<AsResult> {}

Functor.implement(Result)({
  map(fn) {
    const result = this.value();

    if (result[0] === "err") {
      return same_context(this);
    }

    return ok(fn(result[1]));
  },
});

export interface AsResult extends Functor<AsResult> {}

Applicative.implement(Result)({
  pure(value) {
    return ok(value);
  },

  ap(value) {
    const fn = this.value();
    const result = value.value();

    if (fn[0] === "err") {
      return same_context(this);
    }

    if (result[0] === "err") {
      return same_context(value);
    }

    return ok(fn[1](result[1]));
  },
});

export interface AsResult extends Applicative<AsResult> {}

Monad.implement(Result)({
  bind(fn) {
    const result = this.value();

    if (result[0] === "err") {
      return same_context(this);
    }

    return fn(result[1]);
  },
});

export interface AsResult extends Monad<AsResult> {}

Foldable.implement(Result)({
  fold(initial, fn) {
    const result = this.value();

    if (result[0] === "err") {
      return initial;
    }

    return fn(initial, result[1]);
  },
});

export interface AsResult extends Foldable<AsResult> {}

Traversable.implement(Result)({
  traverse(applicative, fn) {
    const result = this.value();

    if (result[0] === "err") {
      return Applicative.pure(applicative, err(result[1]));
    }

    return Functor.map(fn(result[1]), (value) => ok(value));
  },
});

export interface AsResult extends Traversable<AsResult> {}

function result_ok<item>(value: item): Ok<item> {
  return ["ok", value];
}

function result_err<item = never, error = string>(
  error: error,
): Result<item, error> {
  return ["err", error];
}

function same_context<out>(value: unknown): out {
  return value as out;
}

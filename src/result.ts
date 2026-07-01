import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  kind,
  Monad,
  require_this,
} from "./trait.ts";
import { type Trait, trait } from "./trait_value.ts";

export type Result<item, error = string> =
  | { tag: "ok"; value: item }
  | { tag: "err"; error: error };

type Ok<item> = { tag: "ok"; value: item };

export const result_kind: unique symbol = Symbol("Result");

declare module "./registry.ts" {
  interface Registry<item> {
    [result_kind]: Result<item, string>;
  }
}

export function Result<item>(
  value: Result<item, string>,
): Trait<typeof Result, Result<item, string>, item> {
  return trait<typeof Result, Result<item, string>, item>(
    Result,
    value,
    is_result,
  );
}

Result[kind] = result_kind;

Result.ok = function ok<item>(value: item): Ok<item> {
  return { tag: "ok", value };
};

Result.err = function err<item = never>(error: string): Result<item> {
  return { tag: "err", error };
};

Result.from_number = function from_number(value: number): Result<number> {
  if (Number.isFinite(value)) {
    return Result.ok(value);
  }

  return Result.err("Expected a finite number");
};

Result.fmt = Format.method(function fmt(
  this: Result<unknown> | void,
): string {
  const result = require_this(this, "Result.fmt");

  if (result.tag === "err") {
    return "Err(" + Deno.inspect(result.error) + ")";
  }

  return "Ok(" + Deno.inspect(result.value) + ")";
});

Result.eq = Equal.method(function eq(
  this: Result<unknown> | void,
  right: Result<unknown>,
): boolean {
  const left = require_this(this, "Result.eq");

  if (left.tag === "err" && right.tag === "err") {
    return Object.is(left.error, right.error);
  }

  if (left.tag === "ok" && right.tag === "ok") {
    return Object.is(left.value, right.value);
  }

  return false;
});

Result.map = Functor.method(function map<from, to>(
  this: Result<from> | void,
  fn: (value: from) => to,
): Result<to> {
  const result = require_this(this, "Result.map");

  if (result.tag === "err") {
    return result;
  }

  return Result.ok(fn(result.value));
});

Result.pure = function pure<item>(value: item): Result<item> {
  return Result.ok(value);
};

Result.ap = Applicative.method(function ap<from, to>(
  this: Result<(value: from) => to> | void,
  value: Result<from>,
): Result<to> {
  const fn = require_this(this, "Result.ap");

  if (fn.tag === "err") {
    return fn;
  }

  if (value.tag === "err") {
    return value;
  }

  return Result.ok(fn.value(value.value));
});

Result.flat_map = Monad.method(function flat_map<from, to>(
  this: Result<from> | void,
  fn: (value: from) => Result<to>,
): Result<to> {
  const result = require_this(this, "Result.flat_map");

  if (result.tag === "err") {
    return result;
  }

  return fn(result.value);
});

Result.fold = Foldable.method(function fold<item, out>(
  this: Result<item> | void,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const result = require_this(this, "Result.fold");

  if (result.tag === "err") {
    return initial;
  }

  return fn(initial, result.value);
});

function is_result<item>(value: unknown): value is Result<item, string> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  const candidate = value as {
    tag?: unknown;
    value?: unknown;
    error?: unknown;
  };

  if (candidate.tag === "ok") {
    return Object.hasOwn(candidate, "value");
  }

  if (candidate.tag === "err") {
    return Object.hasOwn(candidate, "error");
  }

  return false;
}

Result satisfies
  & Format<Result<unknown>>
  & Equal<Result<unknown>>
  & Functor<typeof result_kind>
  & Applicative<typeof result_kind>
  & Monad<typeof result_kind>
  & Foldable<typeof result_kind>;

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
import { type Trait, trait, type TraitInput, untrait } from "./trait_value.ts";

export type Result<item, error = string> =
  | { tag: "ok"; value: item }
  | { tag: "err"; error: error };

type Ok<item> = { tag: "ok"; value: item };
type BoxedResult<item> = Trait<typeof Result, Result<item, string>, item>;
type ResultInput<item> = TraitInput<typeof Result, Result<item, string>, item>;

export const result_kind: unique symbol = Symbol("Result");

declare module "./registry.ts" {
  interface Registry<item> {
    [result_kind]: Result<item, string>;
  }
}

export function Result<item>(
  value: ResultInput<item>,
): BoxedResult<item> {
  return trait<typeof Result, Result<item, string>, item>(
    Result,
    untrait(value) as Result<item, string>,
    is_result,
  );
}

Result[kind] = result_kind;

export function ok<item>(value: item): BoxedResult<item> {
  return Result(result_ok(value));
}

export function err<item = never>(error: string): BoxedResult<item> {
  return Result(result_err<item>(error));
}

export function from_number(value: number): BoxedResult<number> {
  if (Number.isFinite(value)) {
    return ok(value);
  }

  return err("Expected a finite number");
}

Result.fmt = function fmt(
  this: BoxedResult<unknown> | void,
): string {
  const result = require_this(this, "Result.fmt").value();

  if (result.tag === "err") {
    return "Err(" + Deno.inspect(result.error) + ")";
  }

  return "Ok(" + Deno.inspect(result.value) + ")";
};

Result.eq = function eq<item>(
  this: BoxedResult<item> | void,
  right: ResultInput<item>,
): boolean {
  const left = require_this(this, "Result.eq").value();
  const right_value = untrait(right) as Result<item, string>;

  if (left.tag === "err" && right_value.tag === "err") {
    return Object.is(left.error, right_value.error);
  }

  if (left.tag === "ok" && right_value.tag === "ok") {
    return Object.is(left.value, right_value.value);
  }

  return false;
};

Result.map = function map<from, to>(
  this: BoxedResult<from> | void,
  fn: (value: from) => to,
): BoxedResult<to> {
  const result = require_this(this, "Result.map").value();

  if (result.tag === "err") {
    return err<to>(result.error);
  }

  return ok(fn(result.value));
};

Result.pure = function pure<item>(
  value: item,
): BoxedResult<item> {
  return ok(value);
};

Result.ap = function ap<from, to>(
  this: BoxedResult<(value: from) => to> | void,
  value: ResultInput<from>,
): BoxedResult<to> {
  const fn = require_this(this, "Result.ap").value();
  const result = untrait(value) as Result<from, string>;

  if (fn.tag === "err") {
    return err<to>(fn.error);
  }

  if (result.tag === "err") {
    return err<to>(result.error);
  }

  return ok(fn.value(result.value));
};

Result.flat_map = function flat_map<from, to>(
  this: BoxedResult<from> | void,
  fn: (value: from) => TraitInput<typeof Result, Result<to, string>, to>,
): BoxedResult<to> {
  const result = require_this(this, "Result.flat_map").value();

  if (result.tag === "err") {
    return err<to>(result.error);
  }

  return Result(fn(result.value));
};

Result.fold = function fold<item, out>(
  this: BoxedResult<item> | void,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const result = require_this(this, "Result.fold").value();

  if (result.tag === "err") {
    return initial;
  }

  return fn(initial, result.value);
};

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

function result_ok<item>(value: item): Ok<item> {
  return { tag: "ok", value };
}

function result_err<item = never>(error: string): Result<item> {
  return { tag: "err", error };
}

interface ResultTraits
  extends
    Format<typeof Result>,
    Equal<typeof Result>,
    Functor<typeof Result>,
    Applicative<typeof Result>,
    Monad<typeof Result>,
    Foldable<typeof Result> {}

Result satisfies ResultTraits;

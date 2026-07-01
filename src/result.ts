import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
} from "./trait.ts";

export type Result<item, error = string> =
  | { tag: "ok"; value: item }
  | { tag: "err"; error: error };

declare module "./trait.ts" {
  interface TypeApp<item> {
    Result: Result<item, string>;
  }
}

export function Result() {}

Result.uri = "Result" as const;

Result.ok = function ok<item>(value: item): Result<item> {
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

Result.fmt = function fmt(result: Result<unknown>): string {
  if (result.tag === "err") {
    return "Err(" + Deno.inspect(result.error) + ")";
  }

  return "Ok(" + Deno.inspect(result.value) + ")";
};

Result.eq = function eq(
  left: Result<unknown>,
  right: Result<unknown>,
): boolean {
  if (left.tag === "err" && right.tag === "err") {
    return Object.is(left.error, right.error);
  }

  if (left.tag === "ok" && right.tag === "ok") {
    return Object.is(left.value, right.value);
  }

  return false;
};

Result.map = function map<from, to>(
  result: Result<from>,
  fn: (value: from) => to,
): Result<to> {
  if (result.tag === "err") {
    return result;
  }

  return Result.ok(fn(result.value));
};

Result.pure = function pure<item>(value: item): Result<item> {
  return Result.ok(value);
};

Result.ap = function ap<from, to>(
  fn: Result<(value: from) => to>,
  value: Result<from>,
): Result<to> {
  if (fn.tag === "err") {
    return fn;
  }

  return Result.map(value, fn.value);
};

Result.flat_map = function flat_map<from, to>(
  result: Result<from>,
  fn: (value: from) => Result<to>,
): Result<to> {
  if (result.tag === "err") {
    return result;
  }

  return fn(result.value);
};

Result.fold = function fold<item, out>(
  result: Result<item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  if (result.tag === "err") {
    return initial;
  }

  return fn(initial, result.value);
};

Result satisfies
  & Format<Result<unknown>>
  & Equal<Result<unknown>>
  & Functor<"Result">
  & Applicative<"Result">
  & Monad<"Result">
  & Foldable<"Result">;

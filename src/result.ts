import { kind, require_this, trait_constructor, type Value } from "./trait.ts";
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

declare module "./registry.ts" {
  interface Registry<item> {
    [result_kind]: Result<item, string>;
  }
}

export interface ResultDictionary {
  <item>(value: Result<item, string>): ResultValue<item>;
  [kind]: typeof result_kind;
}

type ResultValue<item> = Value<ResultDictionary, item>;

export const Result = function Result<item>(
  value: Result<item, string>,
): ResultValue<item> {
  return result_trait(value);
} as ResultDictionary;

Result[kind] = result_kind;

const result_trait = trait_constructor(Result);

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

Format.implement(Result, {
  fmt(this: ResultValue<unknown> | void): string {
    const result = require_this(this, "Result.Format.fmt").value();

    if (result.tag === "err") {
      return "Err(" + Deno.inspect(result.error) + ")";
    }

    return "Ok(" + Deno.inspect(result.value) + ")";
  },
});

export interface ResultDictionary extends Format<typeof Result> {}

Equal.implement(Result, {
  eq<item>(
    this: ResultValue<item> | void,
    right: ResultValue<item>,
  ): boolean {
    const left = require_this(this, "Result.Equal.eq").value();
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

export interface ResultDictionary extends Equal<typeof Result> {}

Functor.implement(Result, {
  map<from, to>(
    this: ResultValue<from> | void,
    fn: (value: from) => to,
  ): ResultValue<to> {
    const result = require_this(this, "Result.Functor.map").value();

    if (result.tag === "err") {
      return err<to>(result.error);
    }

    return ok(fn(result.value));
  },
});

export interface ResultDictionary extends Functor<typeof Result> {}

Applicative.implement(Result, {
  pure<item>(value: item): ResultValue<item> {
    return ok(value);
  },

  ap<from, to>(
    this: ResultValue<(value: from) => to> | void,
    value: ResultValue<from>,
  ): ResultValue<to> {
    const fn = require_this(this, "Result.Applicative.ap").value();
    const result = value.value();

    if (fn.tag === "err") {
      return err<to>(fn.error);
    }

    if (result.tag === "err") {
      return err<to>(result.error);
    }

    return ok(fn.value(result.value));
  },
});

export interface ResultDictionary extends Applicative<typeof Result> {}

Monad.implement(Result, {
  bind<from, to>(
    this: ResultValue<from> | void,
    fn: (value: from) => ResultValue<to>,
  ): ResultValue<to> {
    const result = require_this(this, "Result.Monad.bind").value();

    if (result.tag === "err") {
      return err<to>(result.error);
    }

    return fn(result.value);
  },
});

export interface ResultDictionary extends Monad<typeof Result> {}

Foldable.implement(Result, {
  fold<item, out>(
    this: ResultValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    const result = require_this(this, "Result.Foldable.fold").value();

    if (result.tag === "err") {
      return initial;
    }

    return fn(initial, result.value);
  },
});

export interface ResultDictionary extends Foldable<typeof Result> {}

Traversable.implement(Result, {
  traverse<applicative extends Applicative<applicative>, from, to>(
    this: ResultValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, ResultValue<to>> {
    const result = require_this(this, "Result.Traversable.traverse").value();

    if (result.tag === "err") {
      return Applicative.pure(applicative, err<to>(result.error));
    }

    return Functor.map(fn(result.value), (value) => ok(value));
  },
});

export interface ResultDictionary extends Traversable<typeof Result> {}

function result_ok<item>(value: item): Ok<item> {
  return { tag: "ok", value };
}

function result_err<item = never>(error: string): Result<item> {
  return { tag: "err", error };
}

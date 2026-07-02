import {
  as_trait,
  type Dictionary,
  item_type,
  kind,
  require_this,
  type Value,
  value_type,
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

export interface ResultDictionary extends Dictionary<typeof result_kind> {
  <item>(value: Result<item, string>): ResultValue<item>;
  readonly [value_type]: Result<this[typeof item_type], string>;
}

type ResultValue<item> = Value<ResultDictionary, item>;

export const Result: ResultDictionary = function <item>(
  value: Result<item, string>,
) {
  return as_trait(Result, value);
} as ResultDictionary;

Result[kind] = result_kind;

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
  fmt() {
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
  ) {
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
  ) {
    const result = require_this(this, "Result.Functor.map").value();

    if (result.tag === "err") {
      return err<to>(result.error);
    }

    return ok(fn(result.value));
  },
});

export interface ResultDictionary extends Functor<typeof Result> {}

Applicative.implement(Result, {
  pure<item>(value: item) {
    return ok(value);
  },

  ap<from, to>(
    this: ResultValue<(value: from) => to> | void,
    value: ResultValue<from>,
  ) {
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
  ) {
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
  ) {
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
  ) {
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

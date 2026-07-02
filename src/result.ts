import {
  type Dictionary,
  kind,
  require_this,
  trait_constructor,
  type Value,
} from "./trait.ts";
import {
  Applicative,
  applicative_trait,
  type ApplicativeImplementation,
  Equal,
  equal_trait,
  type EqualImplementation,
  Foldable,
  foldable_trait,
  type FoldableImplementation,
  Format,
  format_trait,
  type FormatImplementation,
  Functor,
  functor_trait,
  type FunctorImplementation,
  Monad,
  monad_trait,
  type MonadImplementation,
  Traversable,
  traversable_trait,
  type TraversableImplementation,
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

const result_format = {
  fmt(this: ResultValue<unknown> | void): string {
    const result = require_this(this, "Result.Format.fmt").value();

    if (result.tag === "err") {
      return "Err(" + Deno.inspect(result.error) + ")";
    }

    return "Ok(" + Deno.inspect(result.value) + ")";
  },
} satisfies FormatImplementation<typeof Result>;

Result[format_trait] = result_format;
Result.fmt = result_format.fmt;

export interface ResultDictionary
  extends Format<typeof Result>, FormatImplementation<typeof Result> {}

const result_equal = {
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
} satisfies EqualImplementation<typeof Result>;

Result[equal_trait] = result_equal;
Result.eq = result_equal.eq;

export interface ResultDictionary
  extends Equal<typeof Result>, EqualImplementation<typeof Result> {}

const result_functor = {
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
} satisfies FunctorImplementation<typeof Result>;

Result[functor_trait] = result_functor;
Result.map = result_functor.map;

export interface ResultDictionary
  extends Functor<typeof Result>, FunctorImplementation<typeof Result> {}

const result_applicative = {
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
} satisfies ApplicativeImplementation<typeof Result>;

Result[applicative_trait] = result_applicative;
Result.pure = result_applicative.pure;
Result.ap = result_applicative.ap;

export interface ResultDictionary
  extends
    Applicative<typeof Result>,
    ApplicativeImplementation<typeof Result> {}

const result_monad = {
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
} satisfies MonadImplementation<typeof Result>;

Result[monad_trait] = result_monad;
Result.bind = result_monad.bind;

export interface ResultDictionary
  extends Monad<typeof Result>, MonadImplementation<typeof Result> {}

const result_foldable = {
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
} satisfies FoldableImplementation<typeof Result>;

Result[foldable_trait] = result_foldable;
Result.fold = result_foldable.fold;

export interface ResultDictionary
  extends Foldable<typeof Result>, FoldableImplementation<typeof Result> {}

const result_traversable = {
  traverse<applicative extends Dictionary & Applicative<applicative>, from, to>(
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
} satisfies TraversableImplementation<typeof Result>;

Result[traversable_trait] = result_traversable;
Result.traverse = result_traversable.traverse;

export interface ResultDictionary
  extends
    Traversable<typeof Result>,
    TraversableImplementation<typeof Result> {}

function result_ok<item>(value: item): Ok<item> {
  return { tag: "ok", value };
}

function result_err<item = never>(error: string): Result<item> {
  return { tag: "err", error };
}

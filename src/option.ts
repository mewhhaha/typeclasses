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

export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

type Some<item> = { tag: "some"; value: item };

export const option_kind: unique symbol = Symbol("Option");

declare module "./registry.ts" {
  interface Registry<item> {
    [option_kind]: Option<item>;
  }
}

export function Option<item>(
  value: Option<item>,
): Trait<typeof Option, Option<item>, item> {
  return trait<typeof Option, Option<item>, item>(Option, value, is_option);
}

Option[kind] = option_kind;

Option.some = function some<item>(value: item): Some<item> {
  return { tag: "some", value };
};

Option.none = function none<item = never>(): Option<item> {
  return { tag: "none" };
};

Option.from_nullable = function from_nullable<item>(
  value: item | null | undefined,
): Option<item> {
  if (value === null) {
    return Option.none();
  }

  if (value === undefined) {
    return Option.none();
  }

  return Option.some(value);
};

Option.fmt = Format.method(function fmt(
  this: Option<unknown> | void,
): string {
  const option = require_this(this, "Option.fmt");

  if (option.tag === "none") {
    return "None";
  }

  return "Some(" + Deno.inspect(option.value) + ")";
});

Option.eq = Equal.method(function eq(
  this: Option<unknown> | void,
  right: Option<unknown>,
): boolean {
  const left = require_this(this, "Option.eq");

  if (left.tag === "none" && right.tag === "none") {
    return true;
  }

  if (left.tag === "some" && right.tag === "some") {
    return Object.is(left.value, right.value);
  }

  return false;
});

Option.map = Functor.method(function map<from, to>(
  this: Option<from> | void,
  fn: (value: from) => to,
): Option<to> {
  const option = require_this(this, "Option.map");

  if (option.tag === "none") {
    return option;
  }

  return Option.some(fn(option.value));
});

Option.pure = function pure<item>(value: item): Option<item> {
  return Option.some(value);
};

Option.ap = Applicative.method(function ap<from, to>(
  this: Option<(value: from) => to> | void,
  value: Option<from>,
): Option<to> {
  const fn = require_this(this, "Option.ap");

  if (fn.tag === "none") {
    return fn;
  }

  if (value.tag === "none") {
    return value;
  }

  return Option.some(fn.value(value.value));
});

Option.flat_map = Monad.method(function flat_map<from, to>(
  this: Option<from> | void,
  fn: (value: from) => Option<to>,
): Option<to> {
  const option = require_this(this, "Option.flat_map");

  if (option.tag === "none") {
    return option;
  }

  return fn(option.value);
});

Option.fold = Foldable.method(function fold<item, out>(
  this: Option<item> | void,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const option = require_this(this, "Option.fold");

  if (option.tag === "none") {
    return initial;
  }

  return fn(initial, option.value);
});

function is_option<item>(value: unknown): value is Option<item> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  const candidate = value as { tag?: unknown; value?: unknown };

  if (candidate.tag === "none") {
    return true;
  }

  if (candidate.tag === "some") {
    return Object.hasOwn(candidate, "value");
  }

  return false;
}

Option satisfies
  & Format<Option<unknown>>
  & Equal<Option<unknown>>
  & Functor<typeof option_kind>
  & Applicative<typeof option_kind>
  & Monad<typeof option_kind>
  & Foldable<typeof option_kind>;

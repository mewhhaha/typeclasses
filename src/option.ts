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
type OptionValue<item> = Trait<typeof Option, Option<item>, item>;

export const option_kind: unique symbol = Symbol("Option");

declare module "./registry.ts" {
  interface Registry<item> {
    [option_kind]: Option<item>;
  }
}

export function Option<item>(
  value: Option<item>,
): OptionValue<item> {
  return trait<typeof Option, Option<item>, item>(
    Option,
    value,
    is_option,
  );
}

Option[kind] = option_kind;

export function some<item>(value: item): OptionValue<item> {
  return Option(option_some(value));
}

export function none<item = never>(): OptionValue<item> {
  return Option(option_none<item>());
}

export function from_nullable<item>(
  value: item | null | undefined,
): OptionValue<item> {
  if (value === null) {
    return none<item>();
  }

  if (value === undefined) {
    return none<item>();
  }

  return Option(option_some<item>(value));
}

Option.fmt = function fmt(
  this: OptionValue<unknown> | void,
): string {
  const option = require_this(this, "Option.fmt").value();

  if (option.tag === "none") {
    return "None";
  }

  return "Some(" + Deno.inspect(option.value) + ")";
};

declare module "./trait.ts" {
  interface FormatImpl {
    [option_kind]: Format<typeof Option>;
  }
}

Option.eq = function eq<item>(
  this: OptionValue<item> | void,
  right: OptionValue<item>,
): boolean {
  const left = require_this(this, "Option.eq").value();
  const right_value = right.value();

  if (left.tag === "none" && right_value.tag === "none") {
    return true;
  }

  if (left.tag === "some" && right_value.tag === "some") {
    return Object.is(left.value, right_value.value);
  }

  return false;
};

declare module "./trait.ts" {
  interface EqualImpl {
    [option_kind]: Equal<typeof Option>;
  }
}

Option.map = function map<from, to>(
  this: OptionValue<from> | void,
  fn: (value: from) => to,
): OptionValue<to> {
  const option = require_this(this, "Option.map").value();

  if (option.tag === "none") {
    return none<to>();
  }

  return some(fn(option.value));
};

declare module "./trait.ts" {
  interface FunctorImpl {
    [option_kind]: Functor<typeof Option>;
  }
}

Option.pure = function pure<item>(
  value: item,
): OptionValue<item> {
  return some(value);
};

Option.ap = function ap<from, to>(
  this: OptionValue<(value: from) => to> | void,
  value: OptionValue<from>,
): OptionValue<to> {
  const fn = require_this(this, "Option.ap").value();
  const option = value.value();

  if (fn.tag === "none") {
    return none<to>();
  }

  if (option.tag === "none") {
    return none<to>();
  }

  return some(fn.value(option.value));
};

declare module "./trait.ts" {
  interface ApplicativeImpl {
    [option_kind]: Applicative<typeof Option>;
  }
}

Option.flat_map = function flat_map<from, to>(
  this: OptionValue<from> | void,
  fn: (value: from) => OptionValue<to>,
): OptionValue<to> {
  const option = require_this(this, "Option.flat_map").value();

  if (option.tag === "none") {
    return none<to>();
  }

  return fn(option.value);
};

declare module "./trait.ts" {
  interface MonadImpl {
    [option_kind]: Monad<typeof Option>;
  }
}

Option.fold = function fold<item, out>(
  this: OptionValue<item> | void,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const option = require_this(this, "Option.fold").value();

  if (option.tag === "none") {
    return initial;
  }

  return fn(initial, option.value);
};

declare module "./trait.ts" {
  interface FoldableImpl {
    [option_kind]: Foldable<typeof Option>;
  }
}

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

function option_some<item>(value: item): Some<item> {
  return { tag: "some", value };
}

function option_none<item = never>(): Option<item> {
  return { tag: "none" };
}

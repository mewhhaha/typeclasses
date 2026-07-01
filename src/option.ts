import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
} from "./trait.ts";

export type Option<item> =
  | { tag: "some"; value: item }
  | { tag: "none" };

declare module "./trait.ts" {
  interface TypeApp<item> {
    Option: Option<item>;
  }
}

export function Option() {}

Option.uri = "Option" as const;

Option.some = function some<item>(value: item): Option<item> {
  return { tag: "some", value };
};

Option.none = function none<item>(): Option<item> {
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

Option.fmt = function fmt(option: Option<unknown>): string {
  if (option.tag === "none") {
    return "None";
  }

  return "Some(" + Deno.inspect(option.value) + ")";
};

Option.eq = function eq(
  left: Option<unknown>,
  right: Option<unknown>,
): boolean {
  if (left.tag === "none" && right.tag === "none") {
    return true;
  }

  if (left.tag === "some" && right.tag === "some") {
    return Object.is(left.value, right.value);
  }

  return false;
};

Option.map = function map<from, to>(
  option: Option<from>,
  fn: (value: from) => to,
): Option<to> {
  if (option.tag === "none") {
    return option;
  }

  return Option.some(fn(option.value));
};

Option.pure = function pure<item>(value: item): Option<item> {
  return Option.some(value);
};

Option.ap = function ap<from, to>(
  fn: Option<(value: from) => to>,
  value: Option<from>,
): Option<to> {
  if (fn.tag === "none") {
    return fn;
  }

  return Option.map(value, fn.value);
};

Option.flat_map = function flat_map<from, to>(
  option: Option<from>,
  fn: (value: from) => Option<to>,
): Option<to> {
  if (option.tag === "none") {
    return option;
  }

  return fn(option.value);
};

Option.fold = function fold<item, out>(
  option: Option<item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  if (option.tag === "none") {
    return initial;
  }

  return fn(initial, option.value);
};

Option satisfies
  & Format<Option<unknown>>
  & Equal<Option<unknown>>
  & Functor<"Option">
  & Applicative<"Option">
  & Monad<"Option">
  & Foldable<"Option">;

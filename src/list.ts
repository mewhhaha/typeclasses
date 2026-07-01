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

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

export const list_kind: unique symbol = Symbol("List");

declare module "./registry.ts" {
  interface Registry<item> {
    [list_kind]: List<item>;
  }
}

export function List<item>(
  value: List<item>,
): Trait<typeof List, List<item>, item> {
  return trait<typeof List, List<item>, item>(List, value, is_list);
}

List[kind] = list_kind;

List.nil = function nil<item>(): List<item> {
  return { tag: "nil" };
};

List.cons = function cons<item>(head: item, tail: List<item>): List<item> {
  return { tag: "cons", head, tail };
};

List.from_array = function from_array<item>(items: item[]): List<item> {
  let list = List.nil<item>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    list = List.cons(item, list);
  }

  return list;
};

List.to_array = function to_array<item>(list: List<item>): item[] {
  const items: item[] = [];
  let rest = list;

  while (rest.tag === "cons") {
    items.push(rest.head);
    rest = rest.tail;
  }

  return items;
};

List.fmt = Format.method(function fmt(
  this: List<unknown> | void,
): string {
  const list = require_this(this, "List.fmt");
  const items = List.to_array(list).map((item) => Deno.inspect(item));
  return "[" + items.join(", ") + "]";
});

List.eq = Equal.method(function eq(
  this: List<unknown> | void,
  right: List<unknown>,
): boolean {
  const left = require_this(this, "List.eq");
  let left_rest = left;
  let right_rest = right;

  while (left_rest.tag === "cons" && right_rest.tag === "cons") {
    if (!Object.is(left_rest.head, right_rest.head)) {
      return false;
    }

    left_rest = left_rest.tail;
    right_rest = right_rest.tail;
  }

  return left_rest.tag === "nil" && right_rest.tag === "nil";
});

List.map = Functor.method(function map<from, to>(
  this: List<from> | void,
  fn: (value: from) => to,
): List<to> {
  const list = require_this(this, "List.map");
  const items = List.to_array(list);
  const mapped: to[] = [];

  for (const item of items) {
    mapped.push(fn(item));
  }

  return List.from_array(mapped);
});

List.pure = function pure<item>(value: item): List<item> {
  return List.cons(value, List.nil());
};

List.ap = Applicative.method(function ap<from, to>(
  this: List<(value: from) => to> | void,
  values: List<from>,
): List<to> {
  const fns = require_this(this, "List.ap");
  const out: to[] = [];

  for (const fn of List.to_array(fns)) {
    for (const value of List.to_array(values)) {
      out.push(fn(value));
    }
  }

  return List.from_array(out);
});

List.flat_map = Monad.method(function flat_map<from, to>(
  this: List<from> | void,
  fn: (value: from) => List<to>,
): List<to> {
  const list = require_this(this, "List.flat_map");
  const out: to[] = [];

  for (const item of List.to_array(list)) {
    for (const value of List.to_array(fn(item))) {
      out.push(value);
    }
  }

  return List.from_array(out);
});

List.fold = Foldable.method(function fold<item, out>(
  this: List<item> | void,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const list = require_this(this, "List.fold");
  let state = initial;

  for (const item of List.to_array(list)) {
    state = fn(state, item);
  }

  return state;
});

function is_list<item>(value: unknown): value is List<item> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  const candidate = value as { tag?: unknown; head?: unknown; tail?: unknown };

  if (candidate.tag === "nil") {
    return true;
  }

  if (candidate.tag === "cons") {
    return Object.hasOwn(candidate, "head") &&
      Object.hasOwn(candidate, "tail") &&
      is_list(candidate.tail);
  }

  return false;
}

List satisfies
  & Format<List<unknown>>
  & Equal<List<unknown>>
  & Functor<typeof list_kind>
  & Applicative<typeof list_kind>
  & Monad<typeof list_kind>
  & Foldable<typeof list_kind>;

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

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

type BoxedList<item> = Trait<typeof List, List<item>, item>;
type ListInput<item> = TraitInput<typeof List, List<item>, item>;

export const list_kind: unique symbol = Symbol("List");

declare module "./registry.ts" {
  interface Registry<item> {
    [list_kind]: List<item>;
  }
}

export function List<item>(
  value: ListInput<item>,
): BoxedList<item> {
  return trait<typeof List, List<item>, item>(
    List,
    untrait(value) as List<item>,
    is_list,
  );
}

List[kind] = list_kind;

List.nil = function nil<item>(): BoxedList<item> {
  return List(list_nil<item>());
};

List.cons = function cons<item>(
  head: item,
  tail: ListInput<item>,
): BoxedList<item> {
  return List(list_cons(head, untrait(tail) as List<item>));
};

List.from_array = function from_array<item>(items: item[]): BoxedList<item> {
  return List(list_from_array(items));
};

List.to_array = function to_array<item>(list: ListInput<item>): item[] {
  const items: item[] = [];
  let rest = untrait(list) as List<item>;

  while (rest.tag === "cons") {
    items.push(rest.head);
    rest = rest.tail;
  }

  return items;
};

function list_from_array<item>(items: item[]): List<item> {
  let list = list_nil<item>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    list = list_cons(item, list);
  }

  return list;
}

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

  return list_from_array(mapped);
});

List.pure = Applicative.pure_method(function pure<item>(
  value: item,
): List<item> {
  return list_cons(value, list_nil());
});

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

  return list_from_array(out);
});

List.flat_map = Monad.method(function flat_map<from, to>(
  this: List<from> | void,
  fn: (value: from) => TraitInput<typeof List, List<to>, to>,
): List<to> {
  const list = require_this(this, "List.flat_map");
  const out: to[] = [];

  for (const item of List.to_array(list)) {
    const values = untrait(fn(item)) as List<to>;

    for (const value of List.to_array(values)) {
      out.push(value);
    }
  }

  return list_from_array(out);
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

function list_nil<item>(): List<item> {
  return { tag: "nil" };
}

function list_cons<item>(head: item, tail: List<item>): List<item> {
  return { tag: "cons", head, tail };
}

List satisfies
  & Format<List<unknown>>
  & Equal<List<unknown>>
  & Functor<typeof list_kind>
  & Applicative<typeof list_kind>
  & Monad<typeof list_kind>
  & Foldable<typeof list_kind>;

import { kind, require_this, type Trait, trait } from "./trait.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
} from "./traits.ts";

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

type ListValue<item> = Trait<typeof List, List<item>, item>;

export const list_kind: unique symbol = Symbol("List");

declare module "./registry.ts" {
  interface Registry<item> {
    [list_kind]: List<item>;
  }
}

export function List<item>(
  value: List<item>,
): ListValue<item> {
  return trait<typeof List, List<item>, item>(
    List,
    value,
    is_list,
  );
}

List[kind] = list_kind;

export function nil<item>(): ListValue<item> {
  return List(list_nil<item>());
}

export function cons<item>(
  head: item,
  tail: ListValue<item>,
): ListValue<item> {
  return List(list_cons(head, tail.value()));
}

export function from_array<item>(items: item[]): ListValue<item> {
  return List(list_from_array(items));
}

export function to_array<item>(list: ListValue<item>): item[] {
  const items: item[] = [];
  let rest = list.value();

  while (rest.tag === "cons") {
    items.push(rest.head);
    rest = rest.tail;
  }

  return items;
}

function list_from_array<item>(items: item[]): List<item> {
  let list = list_nil<item>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    list = list_cons(item, list);
  }

  return list;
}

List.fmt = function fmt(
  this: ListValue<unknown> | void,
): string {
  const list = require_this(this, "List.fmt");
  const items = to_array(list).map((item) => Deno.inspect(item));
  return "[" + items.join(", ") + "]";
};

declare module "./traits.ts" {
  interface FormatImpl {
    [list_kind]: Format<typeof List>;
  }
}

List.eq = function eq<item>(
  this: ListValue<item> | void,
  right: ListValue<item>,
): boolean {
  const left = require_this(this, "List.eq");
  let left_rest = left.value();
  let right_rest = right.value();

  while (left_rest.tag === "cons" && right_rest.tag === "cons") {
    if (!Object.is(left_rest.head, right_rest.head)) {
      return false;
    }

    left_rest = left_rest.tail;
    right_rest = right_rest.tail;
  }

  return left_rest.tag === "nil" && right_rest.tag === "nil";
};

declare module "./traits.ts" {
  interface EqualImpl {
    [list_kind]: Equal<typeof List>;
  }
}

List.map = function map<from, to>(
  this: ListValue<from> | void,
  fn: (value: from) => to,
): ListValue<to> {
  const list = require_this(this, "List.map");
  const items = to_array(list);
  const mapped: to[] = [];

  for (const item of items) {
    mapped.push(fn(item));
  }

  return List(list_from_array(mapped));
};

declare module "./traits.ts" {
  interface FunctorImpl {
    [list_kind]: Functor<typeof List>;
  }
}

List.pure = function pure<item>(
  value: item,
): ListValue<item> {
  return List(list_cons(value, list_nil()));
};

List.ap = function ap<from, to>(
  this: ListValue<(value: from) => to> | void,
  values: ListValue<from>,
): ListValue<to> {
  const fns = require_this(this, "List.ap");
  const out: to[] = [];

  for (const fn of to_array(fns)) {
    for (const value of to_array(values)) {
      out.push(fn(value));
    }
  }

  return List(list_from_array(out));
};

declare module "./traits.ts" {
  interface ApplicativeImpl {
    [list_kind]: Applicative<typeof List>;
  }
}

List.flat_map = function flat_map<from, to>(
  this: ListValue<from> | void,
  fn: (value: from) => ListValue<to>,
): ListValue<to> {
  const list = require_this(this, "List.flat_map");
  const out: to[] = [];

  for (const item of to_array(list)) {
    const values = fn(item);

    for (const value of to_array(values)) {
      out.push(value);
    }
  }

  return List(list_from_array(out));
};

declare module "./traits.ts" {
  interface MonadImpl {
    [list_kind]: Monad<typeof List>;
  }
}

List.fold = function fold<item, out>(
  this: ListValue<item> | void,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  const list = require_this(this, "List.fold");
  let state = initial;

  for (const item of to_array(list)) {
    state = fn(state, item);
  }

  return state;
};

declare module "./traits.ts" {
  interface FoldableImpl {
    [list_kind]: Foldable<typeof List>;
  }
}

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

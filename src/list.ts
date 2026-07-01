import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
} from "./trait.ts";

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

declare module "./trait.ts" {
  interface TypeApp<item> {
    List: List<item>;
  }
}

export function List() {}

List.uri = "List" as const;

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

List.fmt = function fmt(list: List<unknown>): string {
  const items = List.to_array(list).map((item) => Deno.inspect(item));
  return "[" + items.join(", ") + "]";
};

List.eq = function eq(left: List<unknown>, right: List<unknown>): boolean {
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
};

List.map = function map<from, to>(
  list: List<from>,
  fn: (value: from) => to,
): List<to> {
  const items = List.to_array(list);
  const mapped: to[] = [];

  for (const item of items) {
    mapped.push(fn(item));
  }

  return List.from_array(mapped);
};

List.pure = function pure<item>(value: item): List<item> {
  return List.cons(value, List.nil());
};

List.ap = function ap<from, to>(
  fns: List<(value: from) => to>,
  values: List<from>,
): List<to> {
  const out: to[] = [];

  for (const fn of List.to_array(fns)) {
    for (const value of List.to_array(values)) {
      out.push(fn(value));
    }
  }

  return List.from_array(out);
};

List.flat_map = function flat_map<from, to>(
  list: List<from>,
  fn: (value: from) => List<to>,
): List<to> {
  const out: to[] = [];

  for (const item of List.to_array(list)) {
    for (const value of List.to_array(fn(item))) {
      out.push(value);
    }
  }

  return List.from_array(out);
};

List.fold = function fold<item, out>(
  list: List<item>,
  initial: out,
  fn: (state: out, item: item) => out,
): out {
  let state = initial;

  for (const item of List.to_array(list)) {
    state = fn(state, item);
  }

  return state;
};

List satisfies
  & Format<List<unknown>>
  & Equal<List<unknown>>
  & Functor<"List">
  & Applicative<"List">
  & Monad<"List">
  & Foldable<"List">;

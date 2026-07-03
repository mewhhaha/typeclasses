import {
  type ContextDictionary,
  define_dictionary,
  type Value,
} from "./trait.ts";
import {
  Alternative,
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Traversable,
} from "./traits.ts";

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

export const list_kind: unique symbol = Symbol("List");

declare module "./trait.ts" {
  interface ContextValues<item> {
    [list_kind]: List<item>;
  }
}

export interface ListDictionary extends ContextDictionary<typeof list_kind> {
  <item>(value: List<item>): ListValue<item>;
}

type ListValue<item> = Value<ListDictionary, item>;

export const List = define_dictionary<ListDictionary>(
  list_kind,
);

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

Format.implement(List)({
  fmt(list) {
    const items = to_array(list).map((item) => Deno.inspect(item));
    return "[" + items.join(", ") + "]";
  },
});

export interface ListDictionary extends Format<ListDictionary> {}

Equal.implement(List)({
  eq(left, right) {
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
  },
});

export interface ListDictionary extends Equal<ListDictionary> {}

Functor.implement(List)({
  map(list, fn) {
    const items = to_array(list);
    return List(list_from_array(items.map(fn)));
  },
});

export interface ListDictionary extends Functor<ListDictionary> {}

Applicative.implement(List)({
  pure(_list, value) {
    return List(list_cons(value, list_nil()));
  },

  ap(fns, values) {
    const items = to_array(values);

    return List(
      list_from_array(to_array(fns).flatMap((fn) => items.map(fn))),
    );
  },
});

export interface ListDictionary extends Applicative<ListDictionary> {}

Semigroup.implement(List)({
  concat(left, right) {
    return from_array([...to_array(left), ...to_array(right)]);
  },
});

export interface ListDictionary extends Semigroup<ListDictionary> {}

Monoid.implement(List)({
  empty(_list) {
    return nil();
  },
});

export interface ListDictionary extends Monoid<ListDictionary> {}

Alternative.implement(List)({
  empty(_list) {
    return nil();
  },

  alt(left, right) {
    return from_array([...to_array(left), ...to_array(right)]);
  },
});

export interface ListDictionary extends Alternative<ListDictionary> {}

Monad.implement(List)({
  bind(list, fn) {
    const out = to_array(list).flatMap((item) => to_array(fn(item)));
    return List(list_from_array(out));
  },
});

export interface ListDictionary extends Monad<ListDictionary> {}

Foldable.implement(List)({
  fold(list, initial, fn) {
    let state = initial;

    for (const item of to_array(list)) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface ListDictionary extends Foldable<ListDictionary> {}

Traversable.implement(List)({
  traverse(list, applicative, fn) {
    const items = to_array(list);

    if (items.length === 0) {
      return Applicative.pure(applicative, nil());
    }

    let index = items.length - 1;
    let out = Functor.map(fn(items[index]), list_single);

    for (index -= 1; index >= 0; index -= 1) {
      out = Applicative.ap(Functor.map(fn(items[index]), list_prepend), out);
    }

    return out;
  },
});

export interface ListDictionary extends Traversable<ListDictionary> {}

function list_nil<item>(): List<item> {
  return { tag: "nil" };
}

function list_cons<item>(head: item, tail: List<item>): List<item> {
  return { tag: "cons", head, tail };
}

function list_single<item>(item: item): ListValue<item> {
  return cons(item, nil());
}

function list_prepend<item>(head: item) {
  return (tail: ListValue<item>) => cons(head, tail);
}

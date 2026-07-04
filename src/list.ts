import { type As, define, type Value } from "./trait.ts";
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

export const list_kind = Symbol("List");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [list_kind]: List<item>;
  }
}

export interface AsList extends As<typeof list_kind> {}

type ListValue<item> = Value<AsList, item>;

export const List = define<AsList>(
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
  fmt() {
    const items = to_array(this).map((item) => Deno.inspect(item));
    return "[" + items.join(", ") + "]";
  },
});

export interface AsList extends Format<AsList> {}

Equal.implement(List)({
  eq(right) {
    let left_rest = this.value();
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

export interface AsList extends Equal<AsList> {}

Functor.implement(List)({
  map(fn) {
    const items = to_array(this);
    return List(list_from_array(items.map(fn)));
  },
});

export interface AsList extends Functor<AsList> {}

Applicative.implement(List)({
  pure(value) {
    return List(list_cons(value, list_nil()));
  },

  ap(values) {
    const items = to_array(values);

    return List(
      list_from_array(to_array(this).flatMap((fn) => items.map(fn))),
    );
  },
});

export interface AsList extends Applicative<AsList> {}

Semigroup.implement(List)({
  concat(right) {
    return from_array([...to_array(this), ...to_array(right)]);
  },
});

export interface AsList extends Semigroup<AsList> {}

Monoid.implement(List)({
  empty() {
    return nil();
  },
});

export interface AsList extends Monoid<AsList> {}

Alternative.implement(List)({
  empty() {
    return nil();
  },

  alt(right) {
    return from_array([...to_array(this), ...to_array(right)]);
  },
});

export interface AsList extends Alternative<AsList> {}

Monad.implement(List)({
  bind(fn) {
    const out = to_array(this).flatMap((item) => to_array(fn(item)));
    return List(list_from_array(out));
  },
});

export interface AsList extends Monad<AsList> {}

Foldable.implement(List)({
  fold(initial, fn) {
    let state = initial;

    for (const item of to_array(this)) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface AsList extends Foldable<AsList> {}

Traversable.implement(List)({
  traverse(applicative, fn) {
    const items = to_array(this);

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

export interface AsList extends Traversable<AsList> {}

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

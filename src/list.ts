import {
  as_trait,
  type Dictionary,
  item_type,
  kind,
  require_this,
  type Value,
  value_type,
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

export interface ListDictionary extends Dictionary<typeof list_kind> {
  <item>(value: List<item>): ListValue<item>;
  readonly [value_type]: List<this[typeof item_type]>;
}

type ListValue<item> = Value<ListDictionary, item>;

export const List: ListDictionary = function <item>(
  value: List<item>,
) {
  return as_trait(List, value);
} as ListDictionary;

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

Format.implement(List, {
  fmt() {
    const list = require_this(this, "List.Format.fmt");
    const items = to_array(list).map((item) => Deno.inspect(item));
    return "[" + items.join(", ") + "]";
  },
});

export interface ListDictionary extends Format<typeof List> {}

Equal.implement(List, {
  eq<item>(
    this: ListValue<item> | void,
    right: ListValue<item>,
  ) {
    const left = require_this(this, "List.Equal.eq");
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

export interface ListDictionary extends Equal<typeof List> {}

Functor.implement(List, {
  map<from, to>(
    this: ListValue<from> | void,
    fn: (value: from) => to,
  ) {
    const list = require_this(this, "List.Functor.map");
    const items = to_array(list);
    const mapped: to[] = [];

    for (const item of items) {
      mapped.push(fn(item));
    }

    return List(list_from_array(mapped));
  },
});

export interface ListDictionary extends Functor<typeof List> {}

Applicative.implement(List, {
  pure<item>(
    value: item,
  ) {
    return List(list_cons(value, list_nil()));
  },

  ap<from, to>(
    this: ListValue<(value: from) => to> | void,
    values: ListValue<from>,
  ) {
    const fns = require_this(this, "List.Applicative.ap");
    const out: to[] = [];

    for (const fn of to_array(fns)) {
      for (const value of to_array(values)) {
        out.push(fn(value));
      }
    }

    return List(list_from_array(out));
  },
});

export interface ListDictionary extends Applicative<typeof List> {}

Semigroup.implement(List, {
  concat<item>(
    this: ListValue<item> | void,
    right: ListValue<item>,
  ) {
    const left = require_this(this, "List.Semigroup.concat");
    return from_array([...to_array(left), ...to_array(right)]);
  },
});

export interface ListDictionary extends Semigroup<typeof List> {}

Monoid.implement(List, {
  empty<item>() {
    return nil<item>();
  },
});

export interface ListDictionary extends Monoid<typeof List> {}

Alternative.implement(List, {
  empty<item>() {
    return nil<item>();
  },

  alt<item>(
    this: ListValue<item> | void,
    right: ListValue<item>,
  ) {
    const left = require_this(this, "List.Alternative.alt");
    return from_array([...to_array(left), ...to_array(right)]);
  },
});

export interface ListDictionary extends Alternative<typeof List> {}

Monad.implement(List, {
  bind<from, to>(
    this: ListValue<from> | void,
    fn: (value: from) => ListValue<to>,
  ) {
    const list = require_this(this, "List.Monad.bind");
    const out: to[] = [];

    for (const item of to_array(list)) {
      const values = fn(item);

      for (const value of to_array(values)) {
        out.push(value);
      }
    }

    return List(list_from_array(out));
  },
});

export interface ListDictionary extends Monad<typeof List> {}

Foldable.implement(List, {
  fold<item, out>(
    this: ListValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ) {
    const list = require_this(this, "List.Foldable.fold");
    let state = initial;

    for (const item of to_array(list)) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface ListDictionary extends Foldable<typeof List> {}

Traversable.implement(List, {
  traverse<applicative extends Applicative<applicative>, from, to>(
    this: ListValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ) {
    const list = require_this(this, "List.Traversable.traverse");
    const items = to_array(list);
    let out = Applicative.pure(applicative, nil<to>());

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      const cons_head = Functor.map(fn(item), (head) => {
        return (tail: ListValue<to>) => cons(head, tail);
      });
      out = Applicative.ap(cons_head, out);
    }

    return out;
  },
});

export interface ListDictionary extends Traversable<typeof List> {}

function list_nil<item>(): List<item> {
  return { tag: "nil" };
}

function list_cons<item>(head: item, tail: List<item>): List<item> {
  return { tag: "cons", head, tail };
}

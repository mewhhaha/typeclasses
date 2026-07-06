import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Alternative,
  Applicative,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  Monoid,
  Ord,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

export type List<item> =
  | { tag: "nil" }
  | { tag: "cons"; head: item; tail: List<item> };

export interface AsList
  extends
    As<AsList>,
    Show<AsList>,
    Eq<AsList>,
    Functor<AsList>,
    Applicative<AsList>,
    Semigroup<AsList>,
    Monoid<AsList>,
    Alternative<AsList>,
    Monad<AsList>,
    Foldable<AsList>,
    Traversable<AsList>,
    Ord<AsList> {
  readonly [type_item]: unknown;
  readonly [type_data]: List<this[typeof type_item]>;
}

type ListValue<item> = Data<AsList, item>;

export const List: AsList = data<AsList>();

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

Show.instance(List)({
  show() {
    const items = to_array(this).map((item) => Deno.inspect(item));
    return "[" + items.join(", ") + "]";
  },
});

Eq.instance(List)({
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

Ord.instance(List)({
  compare(right) {
    let left_rest = this.value();
    let right_rest = right.value();

    while (left_rest.tag === "cons" && right_rest.tag === "cons") {
      const order = compare_unknown(left_rest.head, right_rest.head);

      switch (order) {
        case "eq":
          break;
        case "lt":
        case "gt":
          return order;
      }

      left_rest = left_rest.tail;
      right_rest = right_rest.tail;
    }

    if (left_rest.tag === right_rest.tag) {
      return "eq";
    }

    switch (left_rest.tag) {
      case "nil":
        return "lt";
      case "cons":
        return "gt";
    }
  },
});

Functor.instance(List)({
  map(fn) {
    const items = to_array(this);
    return List(list_from_array(items.map(fn)));
  },
});

Applicative.instance(List)({
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

Semigroup.instance(List)({
  concat(right) {
    return from_array([...to_array(this), ...to_array(right)]);
  },
});

Monoid.instance(List)({
  empty() {
    return nil();
  },
});

Alternative.instance(List)({
  empty() {
    return nil();
  },

  alt(right) {
    return from_array([...to_array(this), ...to_array(right)]);
  },
});

Monad.instance(List)({
  bind(fn) {
    const out = to_array(this).flatMap((item) => to_array(fn(item)));
    return List(list_from_array(out));
  },
});

Foldable.instance(List)({
  fold(initial, fn) {
    let state = initial;

    for (const item of to_array(this)) {
      state = fn(state, item);
    }

    return state;
  },
});

Traversable.instance(List)({
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

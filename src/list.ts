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
  applicative_lift_method,
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
  return list_to_array(list.value());
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
  map<from, to>(
    this: Data<AsList, from>,
    fn: (value: from) => to,
  ): Data<AsList, to> {
    let source = this.value();
    let reversed = list_nil<to>();

    while (source.tag === "cons") {
      reversed = list_cons(fn(source.head), reversed);
      source = source.tail;
    }

    return List(list_reverse(reversed));
  },
});

Applicative.instance(List)({
  pure(value) {
    return List(list_cons(value, list_nil()));
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();

    switch (rest.length) {
      case 0:
        return lift_list_one(fn, first);
      case 1:
        return lift_list_two(fn, first, rest[0].value());
      case 2:
        return lift_list_three(fn, first, rest[0].value(), rest[1].value());
      default:
        return lift_list_many(fn, first, rest);
    }
  },

  ap<from, to>(
    this: Data<AsList, (value: NoInfer<from>) => to>,
    values: Data<AsList, from>,
  ): Data<AsList, to> {
    const items = values.value();
    let fns = this.value();
    let reversed = list_nil<to>();

    while (fns.tag === "cons") {
      let rest = items;

      while (rest.tag === "cons") {
        reversed = list_cons(fns.head(rest.head), reversed);
        rest = rest.tail;
      }

      fns = fns.tail;
    }

    return List(list_reverse(reversed));
  },
});

Semigroup.instance(List)({
  concat(right) {
    return List(list_append(this.value(), right.value()));
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
    return List(list_append(this.value(), right.value()));
  },
});

Monad.instance(List)({
  bind<from, to>(
    this: Data<AsList, from>,
    fn: (value: from) => Data<AsList, to>,
  ): Data<AsList, to> {
    let source = this.value();
    let reversed = list_nil<to>();

    while (source.tag === "cons") {
      let bound = fn(source.head).value();

      while (bound.tag === "cons") {
        reversed = list_cons(bound.head, reversed);
        bound = bound.tail;
      }

      source = source.tail;
    }

    return List(list_reverse(reversed));
  },
});

Foldable.instance(List)({
  fold(initial, fn) {
    let state = initial;
    let rest = this.value();

    while (rest.tag === "cons") {
      state = fn(state, rest.head);
      rest = rest.tail;
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

function list_reverse<item>(items: List<item>): List<item> {
  let source = items;
  let reversed = list_nil<item>();

  while (source.tag === "cons") {
    reversed = list_cons(source.head, reversed);
    source = source.tail;
  }

  return reversed;
}

function list_append<item>(left: List<item>, right: List<item>): List<item> {
  let source = list_reverse(left);
  let out = right;

  while (source.tag === "cons") {
    out = list_cons(source.head, out);
    source = source.tail;
  }

  return out;
}

function list_single<item>(item: item): ListValue<item> {
  return cons(item, nil());
}

function list_prepend<item>(head: item) {
  return (tail: ListValue<item>) => cons(head, tail);
}

function lift_list_one<out>(
  fn: (...values: unknown[]) => out,
  first: List<unknown>,
): ListValue<out> {
  let source = first;
  let reversed = list_nil<out>();

  while (source.tag === "cons") {
    reversed = list_cons(fn(source.head), reversed);
    source = source.tail;
  }

  return List(list_reverse(reversed));
}

function lift_list_two<out>(
  fn: (...values: unknown[]) => out,
  first: List<unknown>,
  second: List<unknown>,
): ListValue<out> {
  let left = first;
  let reversed = list_nil<out>();

  while (left.tag === "cons") {
    let right = second;

    while (right.tag === "cons") {
      reversed = list_cons(fn(left.head, right.head), reversed);
      right = right.tail;
    }

    left = left.tail;
  }

  return List(list_reverse(reversed));
}

function lift_list_three<out>(
  fn: (...values: unknown[]) => out,
  first: List<unknown>,
  second: List<unknown>,
  third: List<unknown>,
): ListValue<out> {
  let left = first;
  let reversed = list_nil<out>();

  while (left.tag === "cons") {
    let middle = second;

    while (middle.tag === "cons") {
      let right = third;

      while (right.tag === "cons") {
        reversed = list_cons(fn(left.head, middle.head, right.head), reversed);
        right = right.tail;
      }

      middle = middle.tail;
    }

    left = left.tail;
  }

  return List(list_reverse(reversed));
}

function lift_list_many<out>(
  fn: (...values: unknown[]) => out,
  first: List<unknown>,
  rest: readonly ListValue<unknown>[],
): ListValue<out> {
  let rows = list_to_array(first).map((value) => [value] as unknown[]);

  for (const current of rest) {
    const source = list_to_array(current.value());
    const next: unknown[][] = [];

    for (const row of rows) {
      for (const item of source) {
        next.push(append_item(row, item));
      }
    }

    rows = next;
  }

  return from_array(rows.map((row) => fn(...row)));
}

function list_to_array<item>(list: List<item>): item[] {
  const items: item[] = [];
  let rest = list;

  while (rest.tag === "cons") {
    items.push(rest.head);
    rest = rest.tail;
  }

  return items;
}

function append_item(values: readonly unknown[], item: unknown): unknown[] {
  const next = new Array<unknown>(values.length + 1);

  for (let index = 0; index < values.length; index += 1) {
    next[index] = values[index];
  }

  next[values.length] = item;

  return next;
}

import {
  $slot,
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
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
  | Nil
  | Cons<item>;

export type Nil = readonly ["Nil"];
export type Cons<item> = readonly ["Cons", item, List<item>];

export interface AsList
  extends
    As<AsList>,
    Show<AsList>,
    Monoid<AsList>,
    Alternative<AsList>,
    Monad<AsList>,
    Traversable<AsList>,
    Ord<AsList> {
  readonly [type_item]: unknown;
  readonly [type_data]: List<this[typeof type_item]>;
}

type ListValue<item> = Data<AsList, item>;
export type ListConstructor = UnionDictionary<AsList>;

export const List: ListConstructor = data<AsList>(
  union(["Cons", $slot, $slot], ["Nil"]),
);
export const Cons: ListConstructor["Cons"] = List.Cons;
export const Nil: ListConstructor["Nil"] = List.Nil;

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

    while (Cons.is(left_rest) && Cons.is(right_rest)) {
      const [, left_head, left_tail] = left_rest;
      const [, right_head, right_tail] = right_rest;

      if (!Object.is(left_head, right_head)) {
        return false;
      }

      left_rest = left_tail;
      right_rest = right_tail;
    }

    return Nil.is(left_rest) && Nil.is(right_rest);
  },
});

Ord.instance(List)({
  compare(right) {
    let left_rest = this.value();
    let right_rest = right.value();

    while (Cons.is(left_rest) && Cons.is(right_rest)) {
      const [, left_head, left_tail] = left_rest;
      const [, right_head, right_tail] = right_rest;
      const order = compare_unknown(left_head, right_head);

      switch (order) {
        case "eq":
          break;
        case "lt":
        case "gt":
          return order;
      }

      left_rest = left_tail;
      right_rest = right_tail;
    }

    const [left_tag] = left_rest;
    const [right_tag] = right_rest;

    if (left_tag === right_tag) {
      return "eq";
    }

    switch (left_tag) {
      case "Nil":
        return "lt";
      case "Cons":
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

    while (Cons.is(source)) {
      const [, head, tail] = source;
      reversed = list_cons(fn(head), reversed);
      source = tail;
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

    while (Cons.is(fns)) {
      const [, fn, fn_tail] = fns;
      let rest = items;

      while (Cons.is(rest)) {
        const [, item, item_tail] = rest;
        reversed = list_cons(fn(item), reversed);
        rest = item_tail;
      }

      fns = fn_tail;
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
    return Nil();
  },
});

Alternative.instance(List)({
  empty() {
    return Nil();
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

    while (Cons.is(source)) {
      const [, head, tail] = source;
      let bound = fn(head).value();

      while (Cons.is(bound)) {
        const [, bound_head, bound_tail] = bound;
        reversed = list_cons(bound_head, reversed);
        bound = bound_tail;
      }

      source = tail;
    }

    return List(list_reverse(reversed));
  },
});

Foldable.instance(List)({
  fold(initial, fn) {
    let state = initial;
    let rest = this.value();

    while (Cons.is(rest)) {
      const [, head, tail] = rest;
      state = fn(state, head);
      rest = tail;
    }

    return state;
  },
});

Traversable.instance(List)({
  traverse(applicative, fn) {
    const items = to_array(this);

    if (items.length === 0) {
      return Applicative.pure(applicative, Nil());
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
  return ["Nil"];
}

function list_cons<item>(head: item, tail: List<item>): List<item> {
  return ["Cons", head, tail];
}

function list_reverse<item>(items: List<item>): List<item> {
  let source = items;
  let reversed = list_nil<item>();

  while (Cons.is(source)) {
    const [, head, tail] = source;
    reversed = list_cons(head, reversed);
    source = tail;
  }

  return reversed;
}

function list_append<item>(left: List<item>, right: List<item>): List<item> {
  let source = list_reverse(left);
  let out = right;

  while (Cons.is(source)) {
    const [, head, tail] = source;
    out = list_cons(head, out);
    source = tail;
  }

  return out;
}

function list_single<item>(item: item): ListValue<item> {
  return Cons(item, list_nil());
}

function list_prepend<item>(head: item) {
  return (tail: ListValue<item>) => Cons(head, tail.value());
}

function lift_list_one<out>(
  fn: (...values: unknown[]) => out,
  first: List<unknown>,
): ListValue<out> {
  let source = first;
  let reversed = list_nil<out>();

  while (Cons.is(source)) {
    const [, head, tail] = source;
    reversed = list_cons(fn(head), reversed);
    source = tail;
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

  while (Cons.is(left)) {
    const [, left_head, left_tail] = left;
    let right = second;

    while (Cons.is(right)) {
      const [, right_head, right_tail] = right;
      reversed = list_cons(fn(left_head, right_head), reversed);
      right = right_tail;
    }

    left = left_tail;
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

  while (Cons.is(left)) {
    const [, left_head, left_tail] = left;
    let middle = second;

    while (Cons.is(middle)) {
      const [, middle_head, middle_tail] = middle;
      let right = third;

      while (Cons.is(right)) {
        const [, right_head, right_tail] = right;
        reversed = list_cons(fn(left_head, middle_head, right_head), reversed);
        right = right_tail;
      }

      middle = middle_tail;
    }

    left = left_tail;
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

  while (Cons.is(rest)) {
    const [, head, tail] = rest;
    items.push(head);
    rest = tail;
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

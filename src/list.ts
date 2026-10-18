import type { Matchable } from "./data_value.ts";
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
import { traverse_items_into } from "./traversal.ts";
import { inspect } from "./inspect.ts";
import { loop_done, loop_rec, type LoopStep, rec } from "./loop.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  MonadRec,
  Monoid,
  Ord,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export const list_identity: unique symbol = /* @__PURE__ */ Symbol(
  "list_identity",
);

/** An immutable recursive list represented by `Cons` and `Nil` tuples. */
export type RawList<item> =
  | Nil
  | Cons<item>;

/** The empty-list branch of {@link List}. */
export type Nil = readonly ["Nil"];
/** A non-empty list branch containing its head and remaining tail. */
export type Cons<item> = readonly ["Cons", item, RawList<item>];

/** @ignore */
export interface AsListLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawList<this[typeof type_item]>;
}

/** Dictionary type for immutable recursive lists. */
export interface AsList
  extends
    As<AsListLambda, typeof list_identity>,
    Show<AsList>,
    Monoid<AsList>,
    Alternative<AsList>,
    Monad<AsList>,
    MonadRec<AsList>,
    Traversable<AsList>,
    Ord<AsList>,
    Matchable {
}

/** A wrapped List value with its dictionary operations. */
export type List<item> = Data<AsList, item>;
/** Callable tagged-union dictionary for `List` values. */
export type ListConstructor = UnionDictionary<AsList>;

/** Callable list dictionary with `Cons` and `Nil` branch constructors. */
export const List: ListConstructor = data<AsList>(
  list_identity,
  union(["Cons", $slot, $slot], ["Nil"]),
);
/** Construct or recognize the non-empty `Cons` branch. */
export const Cons: ListConstructor["Cons"] = List.Cons;
/** Construct or recognize the empty `Nil` branch. */
export const Nil: ListConstructor["Nil"] = List.Nil;

/** Convert an array into an immutable recursive list. */
export function from_array<item>(items: readonly item[]): List<item> {
  return List(list_from_array(items));
}

/** Materialize a wrapped list into a mutable array. */
export function to_array<item>(list: List<item>): item[] {
  return list_to_array(list.value());
}

function list_from_array<item>(items: readonly item[]): RawList<item> {
  let list = list_nil<item>();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    list = list_cons(item, list);
  }

  return list;
}

Show.instance(List)({
  show() {
    const items: string[] = [];
    for (const item of list_items(this.value())) items.push(inspect(item));
    return "[" + items.join(", ") + "]";
  },
});

Eq.instance(List)({
  eq(right) {
    let left_rest = this.value();
    let right_rest = right.value();

    while (left_rest[0] === "Cons" && right_rest[0] === "Cons") {
      const [, left_head, left_tail] = left_rest;
      const [, right_head, right_tail] = right_rest;

      if (!Object.is(left_head, right_head)) {
        return false;
      }

      left_rest = left_tail;
      right_rest = right_tail;
    }

    return left_rest[0] === "Nil" && right_rest[0] === "Nil";
  },
});

Ord.instance(List)({
  compare(right) {
    let left_rest = this.value();
    let right_rest = right.value();

    while (left_rest[0] === "Cons" && right_rest[0] === "Cons") {
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
    const out = list_builder<to>();

    while (source[0] === "Cons") {
      const [, head, tail] = source;
      out.push(fn(head));
      source = tail;
    }

    return List(out.finish());
  },
});

Applicative.instance(List)({
  pure(value) {
    return List(list_cons(value, list_nil()));
  },

  // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
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
    const out = list_builder<to>();

    while (fns[0] === "Cons") {
      const [, fn, fn_tail] = fns;
      let rest = items;

      while (rest[0] === "Cons") {
        const [, item, item_tail] = rest;
        out.push(fn(item));
        rest = item_tail;
      }

      fns = fn_tail;
    }

    return List(out.finish());
  },
});

Semigroup.instance(List)({
  concat(right) {
    return List(list_append(this.value(), right.value()));
  },
});

Monoid.instance(List)({
  empty: empty_list,
});

Alternative.instance(List)({
  empty: empty_list,

  alt(right) {
    return List(list_append(this.value(), right.value()));
  },
});

function empty_list<item>(this: AsList): Data<AsList, item> {
  return Nil();
}

Monad.instance(List)({
  bind<from, to>(
    this: Data<AsList, from>,
    fn: (value: from) => Data<AsList, to>,
  ): Data<AsList, to> {
    let source = this.value();
    const out = list_builder<to>();

    while (source[0] === "Cons") {
      const [, head, tail] = source;
      let bound = fn(head).value();

      while (bound[0] === "Cons") {
        const [, bound_head, bound_tail] = bound;
        out.push(bound_head);
        bound = bound_tail;
      }

      source = tail;
    }

    return List(out.finish());
  },
});

MonadRec.instance(List)({
  tail_rec_m<state, output>(
    initial: state,
    step: (state: state) => Data<AsList, LoopStep<state, output>>,
  ): Data<AsList, output> {
    const pending: LoopStep<state, output>[] = [rec(initial)];
    const output: output[] = [];

    while (pending.length > 0) {
      const [tag, value] = pending.pop()!;

      switch (tag) {
        case loop_done:
          output.push(value);
          break;
        case loop_rec: {
          const next = to_array(step(value));

          for (let index = next.length - 1; index >= 0; index -= 1) {
            pending.push(next[index]);
          }
          break;
        }
      }
    }

    return from_array(output);
  },
});

Foldable.instance(List)({
  fold(initial, fn) {
    let state = initial;
    let rest = this.value();

    while (rest[0] === "Cons") {
      const [, head, tail] = rest;
      state = fn(state, head);
      rest = tail;
    }

    return state;
  },
});

Traversable.instance(List)({
  traverse(applicative, fn) {
    return traverse_items_into(
      list_items(this.value()),
      applicative,
      fn,
      list_from_items,
    );
  },
});

const empty: Nil = Object.freeze(["Nil"]);
function list_nil<item>(): RawList<item> {
  return empty;
}

function list_cons<item>(head: item, tail: RawList<item>): RawList<item> {
  return ["Cons", head, tail];
}

// Cells are private until finish; published list tails never change.
function list_builder<item>() {
  let first: RawList<item> = list_nil();
  let last: ["Cons", item, RawList<item>] | undefined;
  return {
    push(item: item): void {
      const cell: ["Cons", item, RawList<item>] = ["Cons", item, list_nil()];
      if (last === undefined) first = cell;
      else last[2] = cell;
      last = cell;
    },
    finish(tail: RawList<item> = list_nil()): RawList<item> {
      if (last === undefined) return tail;
      last[2] = tail;
      return first;
    },
  };
}

function list_append<item>(
  left: RawList<item>,
  right: RawList<item>,
): RawList<item> {
  const out = list_builder<item>();
  let source = left;
  while (source[0] === "Cons") {
    const [, head, tail] = source;
    out.push(head);
    source = tail;
  }
  return out.finish(right);
}

function lift_list_one<output>(
  fn: (...values: unknown[]) => output,
  first: RawList<unknown>,
): List<output> {
  let source = first;
  const out = list_builder<output>();

  while (source[0] === "Cons") {
    const [, head, tail] = source;
    out.push(fn(head));
    source = tail;
  }

  return List(out.finish());
}

function lift_list_two<output>(
  fn: (...values: unknown[]) => output,
  first: RawList<unknown>,
  second: RawList<unknown>,
): List<output> {
  let left = first;
  const out = list_builder<output>();

  while (left[0] === "Cons") {
    const [, left_head, left_tail] = left;
    let right = second;

    while (right[0] === "Cons") {
      const [, right_head, right_tail] = right;
      out.push(fn(left_head, right_head));
      right = right_tail;
    }

    left = left_tail;
  }

  return List(out.finish());
}

function lift_list_three<output>(
  fn: (...values: unknown[]) => output,
  first: RawList<unknown>,
  second: RawList<unknown>,
  third: RawList<unknown>,
): List<output> {
  let left = first;
  const out = list_builder<output>();

  while (left[0] === "Cons") {
    const [, left_head, left_tail] = left;
    let middle = second;

    while (middle[0] === "Cons") {
      const [, middle_head, middle_tail] = middle;
      let right = third;

      while (right[0] === "Cons") {
        const [, right_head, right_tail] = right;
        out.push(fn(left_head, middle_head, right_head));
        right = right_tail;
      }

      middle = middle_tail;
    }

    left = left_tail;
  }

  return List(out.finish());
}

function lift_list_many<output>(
  fn: (...values: unknown[]) => output,
  first: RawList<unknown>,
  rest: readonly List<unknown>[],
): List<output> {
  const sources = [first, ...rest.map((value) => value.value())];
  const values: unknown[] = [];
  const out = list_builder<output>();
  const positions = [...sources];
  let depth = 0;
  while (depth >= 0) {
    if (depth === sources.length) {
      out.push(fn(...values));
      depth -= 1;
      continue;
    }
    const current = positions[depth];
    if (current[0] === "Nil") {
      positions[depth] = sources[depth];
      depth -= 1;
      continue;
    }
    values[depth] = current[1];
    positions[depth] = current[2];
    depth += 1;
  }
  return List(out.finish());
}

function list_to_array<item>(list: RawList<item>): item[] {
  const items: item[] = [];
  let rest = list;

  while (rest[0] === "Cons") {
    const [, head, tail] = rest;
    items.push(head);
    rest = tail;
  }

  return items;
}

function* list_items<item>(list: RawList<item>): Generator<item> {
  let source = list;
  while (source[0] === "Cons") {
    const [, head, tail] = source;
    yield head;
    source = tail;
  }
}

function list_from_items<item>(items: Iterable<item>): List<item> {
  const out = list_builder<item>();
  for (const item of items) out.push(item);
  return List(out.finish());
}

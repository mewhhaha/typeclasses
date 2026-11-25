import { find_method, some_method } from "./typeclasses/foldable.ts";
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
export const List: ListConstructor = /* @__PURE__ */ create_list();
/** Construct or recognize the non-empty `Cons` branch. */
export const Cons: ListConstructor["Cons"] =
  /* @__PURE__ */ (() => List.Cons)();
/** Construct or recognize the empty `Nil` branch. */
export const Nil: ListConstructor["Nil"] = /* @__PURE__ */ (() => List.Nil)();

/** Convert an array into an immutable recursive list. */
export function from_array<item>(items: readonly item[]): List<item> {
  return List(list_from_array(items));
}

/** Materialize a wrapped list into a mutable array. */
export function to_array<item>(list: List<item>): item[] {
  return list_to_array(list.value());
}

function list_from_array<item>(items: readonly item[]): RawList<item> {
  let list: RawList<item> = empty;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    list = ["Cons", items[index], list];
  }

  return list;
}

function empty_list<item>(this: AsList): Data<AsList, item> {
  return Nil();
}

const empty: Nil = Object.freeze(["Nil"]);

// Cells are private until finish; published list tails never change.
class ListBuilder<item> {
  first: RawList<item> = empty;
  last: ["Cons", item, RawList<item>] | undefined;
  push(item: item): void {
    const cell: ["Cons", item, RawList<item>] = ["Cons", item, empty];
    if (this.last === undefined) this.first = cell;
    else this.last[2] = cell;
    this.last = cell;
  }
  finish(tail: RawList<item> = empty): RawList<item> {
    if (this.last === undefined) return tail;
    this.last[2] = tail;
    return this.first;
  }
}

function list_append<item>(
  left: RawList<item>,
  right: RawList<item>,
): RawList<item> {
  if (left[0] === "Nil") return right;
  if (right[0] === "Nil") return left;
  const out = new ListBuilder<item>();
  let source: RawList<item> = left;
  while (source[0] === "Cons") {
    out.push(source[1]);
    source = source[2];
  }
  return out.finish(right);
}

function lift_list_two<output>(
  fn: (...values: unknown[]) => output,
  first: RawList<unknown>,
  second: RawList<unknown>,
): List<output> {
  let left = first;
  const out = new ListBuilder<output>();
  while (left[0] === "Cons") {
    const left_head = left[1];
    let right = second;
    while (right[0] === "Cons") {
      out.push(fn(left_head, right[1]));
      right = right[2];
    }
    left = left[2];
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
  const out = new ListBuilder<output>();
  while (left[0] === "Cons") {
    const left_head = left[1];
    let middle = second;
    while (middle[0] === "Cons") {
      const middle_head = middle[1];
      let right = third;
      while (right[0] === "Cons") {
        out.push(fn(left_head, middle_head, right[1]));
        right = right[2];
      }
      middle = middle[2];
    }
    left = left[2];
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
  const out = new ListBuilder<output>();
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
    items.push(rest[1]);
    rest = rest[2];
  }
  return items;
}

function list_from_items<item>(items: Iterable<item>): List<item> {
  if (Array.isArray(items)) return List(list_from_array(items));
  const out = new ListBuilder<item>();
  for (const item of items) out.push(item);
  return List(out.finish());
}

/** Concatenate finite lists in one pass, copying each element once. */
export function concat_many<item>(lists: Iterable<List<item>>): List<item> {
  const out = new ListBuilder<item>();
  for (const list of lists) {
    let current = list.value();
    while (current[0] === "Cons") {
      out.push(current[1]);
      current = current[2];
    }
  }
  return List(out.finish());
}

function create_list(): ListConstructor {
  const List: ListConstructor = data<AsList>(
    list_identity,
    union(["Cons", $slot, $slot], ["Nil"]),
  );
  Show.instance(List)({
    show() {
      const items: string[] = [];
      let rest = this.value();
      while (rest[0] === "Cons") {
        items.push(inspect(rest[1]));
        rest = rest[2];
      }
      return "[" + items.join(", ") + "]";
    },
  });

  Eq.instance(List)({
    eq(right) {
      let left_rest = this.value();
      let right_rest = right.value();

      while (left_rest[0] === "Cons" && right_rest[0] === "Cons") {
        if (!Object.is(left_rest[1], right_rest[1])) return false;
        left_rest = left_rest[2];
        right_rest = right_rest[2];
      }

      return left_rest[0] === "Nil" && right_rest[0] === "Nil";
    },
  });

  Ord.instance(List)({
    compare(right) {
      let left_rest = this.value();
      let right_rest = right.value();

      while (left_rest[0] === "Cons" && right_rest[0] === "Cons") {
        const order = compare_unknown(left_rest[1], right_rest[1]);
        if (order !== "eq") return order;
        left_rest = left_rest[2];
        right_rest = right_rest[2];
      }

      if (left_rest[0] === right_rest[0]) return "eq";
      return left_rest[0] === "Nil" ? "lt" : "gt";
    },
  });

  Functor.instance(List)({
    map<from, to>(
      this: Data<AsList, from>,
      fn: (value: from) => to,
    ): Data<AsList, to> {
      let source = this.value();
      const out = new ListBuilder<to>();
      while (source[0] === "Cons") {
        out.push(fn(source[1]));
        source = source[2];
      }
      return List(out.finish());
    },
  });

  Applicative.instance(List)({
    pure(value) {
      return List(["Cons", value, empty]);
    },

    // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
    [applicative_lift_method](fn, rest) {
      const first = this.value();

      switch (rest.length) {
        case 0:
          return Functor.map(this, fn);
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
      const out = new ListBuilder<to>();
      while (fns[0] === "Cons") {
        const fn = fns[1];
        let rest = items;
        while (rest[0] === "Cons") {
          out.push(fn(rest[1]));
          rest = rest[2];
        }
        fns = fns[2];
      }
      return List(out.finish());
    },
  });

  function append_list<item>(
    this: Data<AsList, item>,
    right: Data<AsList, item>,
  ): Data<AsList, item> {
    return List(list_append(this.value(), right.value()));
  }

  Semigroup.instance(List)({
    concat: append_list,
  });

  Monoid.instance(List)({
    empty: empty_list,
  });

  Alternative.instance(List)({
    empty: empty_list,
    alt: append_list,
  });

  Monad.instance(List)({
    bind<from, to>(
      this: Data<AsList, from>,
      fn: (value: from) => Data<AsList, to>,
    ): Data<AsList, to> {
      let source = this.value();
      const out = new ListBuilder<to>();
      while (source[0] === "Cons") {
        let bound = fn(source[1]).value();
        while (bound[0] === "Cons") {
          out.push(bound[1]);
          bound = bound[2];
        }
        source = source[2];
      }
      return List(out.finish());
    },
  });

  MonadRec.instance(List)({
    tail_rec_m<state, output>(
      initial: state,
      step: (state: state) => Data<AsList, LoopStep<state, output>>,
    ): Data<AsList, output> {
      const pending: RawList<LoopStep<state, output>>[] = [];
      const out = new ListBuilder<output>();
      let current: RawList<LoopStep<state, output>> = [
        "Cons",
        rec(initial),
        empty,
      ];
      while (true) {
        if (current[0] === "Nil") {
          const next = pending.pop();
          if (next === undefined) break;
          current = next;
          continue;
        }
        const [, [tag, value], tail] = current;
        switch (tag) {
          case loop_done:
            out.push(value);
            current = tail;
            break;
          case loop_rec:
            if (tail[0] === "Cons") pending.push(tail);
            current = step(value).value();
            break;
        }
      }
      return List(out.finish());
    },
  });

  Foldable.instance(List)({
    [some_method](predicate) {
      let rest = this.value();
      while (rest[0] === "Cons") {
        if (predicate(rest[1])) return true;
        rest = rest[2];
      }
      return false;
    },
    [find_method](predicate) {
      let rest = this.value();
      while (rest[0] === "Cons") {
        const head = rest[1];
        if (predicate(head)) return head;
        rest = rest[2];
      }
      return undefined;
    },

    fold(initial, fn) {
      let state = initial;
      let rest = this.value();

      while (rest[0] === "Cons") {
        state = fn(state, rest[1]);
        rest = rest[2];
      }

      return state;
    },
  });

  Traversable.instance(List)({
    traverse(applicative, fn) {
      return traverse_items_into(
        list_to_array(this.value()),
        applicative,
        fn,
        list_from_items,
      );
    },
  });
  return List;
}

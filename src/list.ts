import {
  find_method,
  fold_while_method,
  some_method,
} from "./typeclasses/foldable.ts";
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
import { loop_done, type LoopStep, rec } from "./loop.ts";
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

function lift_list_two<output>(
  fn: (...values: unknown[]) => output,
  first: RawList<unknown>,
  second: RawList<unknown>,
): List<output> {
  if (first[0] === "Nil" || second[0] === "Nil") return Nil();
  let left: RawList<unknown> = first;
  const out = new ListBuilder<output>();
  while (left[0] === "Cons") {
    const left_head = left[1];
    let right: RawList<unknown> = second;
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
  if (first[0] === "Nil" || second[0] === "Nil" || third[0] === "Nil") {
    return Nil();
  }
  let left: RawList<unknown> = first;
  const out = new ListBuilder<output>();
  while (left[0] === "Cons") {
    const left_head = left[1];
    let middle: RawList<unknown> = second;
    while (middle[0] === "Cons") {
      const middle_head = middle[1];
      let right: RawList<unknown> = third;
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
  if (first[0] === "Nil") return Nil();
  const sources: RawList<unknown>[] = [first];
  for (let i = 0; i < rest.length; i += 1) {
    const raw = rest[i].value();
    if (raw[0] === "Nil") return Nil();
    sources.push(raw);
  }
  const values: unknown[] = [];
  const out = new ListBuilder<output>();
  const positions = sources.slice();
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
      return "[" +
        list_to_array(this.value()).map((x) => inspect(x)).join(", ") + "]";
    },
  });

  Eq.instance(List)({
    eq(right) {
      let l = this.value();
      let r = right.value();

      while (l !== r && l[0] === "Cons" && r[0] === "Cons") {
        if (!Object.is(l[1], r[1])) return false;
        l = l[2];
        r = r[2];
      }

      return l === r || l[0] === r[0];
    },
  });

  Ord.instance(List)({
    compare(right) {
      let l = this.value();
      let r = right.value();

      while (l !== r && l[0] === "Cons" && r[0] === "Cons") {
        const order = compare_unknown(l[1], r[1]);
        if (order !== "eq") return order;
        l = l[2];
        r = r[2];
      }

      return l === r || l[0] === r[0] ? "eq" : l[0] === "Nil" ? "lt" : "gt";
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
      return Cons(value, empty);
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
      let fns: RawList<(value: NoInfer<from>) => to> = this.value();
      if (fns[0] === "Nil" || items[0] === "Nil") return Nil();
      const out = new ListBuilder<to>();
      while (fns[0] === "Cons") {
        const fn = fns[1];
        let rest: RawList<from> = items;
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
    const left = this.value();
    const right_value = right.value();
    if (left[0] === "Nil") return right;
    if (right_value[0] === "Nil") return this;
    const out = new ListBuilder<item>();
    let source: RawList<item> = left;
    while (source[0] === "Cons") {
      out.push(source[1]);
      source = source[2];
    }
    return List(out.finish(right_value));
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
        if (tag === loop_done) {
          out.push(value);
          current = tail;
        } else {
          if (tail[0] === "Cons") pending.push(tail);
          current = step(value).value();
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
    [fold_while_method](initial, fn) {
      let state = initial;
      let rest = this.value();
      while (rest[0] === "Cons") {
        const step = fn(state, rest[1]);
        state = step[1];
        if (step[0] === "Done") return state;
        rest = rest[2];
      }
      return state;
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

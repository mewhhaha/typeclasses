import {
  find_method,
  fold_while_method,
  some_method,
} from "./typeclasses/foldable.ts";
import {
  type As,
  as_data,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import {
  Eq,
  Foldable,
  Functor,
  Monoid,
  Semigroup,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export const set_identity: unique symbol = /* @__PURE__ */ Symbol(
  "set_identity",
);

/** The read-only set representation wrapped by the `SetT` dictionary. */
export type RawSetT<item> = ReadonlySet<item>;

/** @ignore */
export interface AsSetLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawSetT<this[typeof type_item]>;
}

/** Dictionary type for sets and their value-wise typeclass instances. */
export interface AsSet
  extends
    As<AsSetLambda, typeof set_identity>,
    Show<AsSet>,
    Eq<AsSet>,
    Functor<AsSet>,
    Monoid<AsSet>,
    Foldable<AsSet> {
}

/** A wrapped SetT value with its dictionary operations. */
export type SetT<item> = Data<AsSet, item>;

/** Callable set dictionary that defensively copies sets when wrapping them. */
export const SetT: AsSet = /* @__PURE__ */ create_set();

/** Wrap a defensive copy of a read-only set. */
export const from_set: <item>(set: ReadonlySet<item>) => SetT<item> = SetT;

/** Collect an iterable into a wrapped set. */
export const from_iterable = <item>(
  items: Iterable<item>,
): SetT<item> => as_data(SetT, new Set(items));

/** Copy a wrapped set into a mutable JavaScript `Set`. */
export const to_set = <item>(set: SetT<item>): Set<item> =>
  new Set(set.value());

function create_set(): AsSet {
  const SetT: AsSet = data<AsSet>(set_identity, function (set) {
    return this.data(new Set(set));
  });
  const raw = <item>(set: Data<AsSet, item>) => set.value();
  Show.instance(SetT)({
    show() {
      return inspect(raw(this));
    },
  });

  Eq.instance(SetT)({
    eq(right) {
      const left = raw(this);
      const right_value = raw(right);
      if (left === right_value) return true;
      if (left.size !== right_value.size) return false;
      for (const value of left) {
        if (!right_value.has(value)) return false;
      }
      return true;
    },
  });

  Functor.instance(SetT)({
    map(fn) {
      const out = new Set<ReturnType<typeof fn>>();
      for (const item of raw(this)) out.add(fn(item));
      return as_data(SetT, out);
    },
  });

  Semigroup.instance(SetT)({
    concat(right) {
      const out = new Set(raw(this));
      for (const item of raw(right)) out.add(item);
      return as_data(SetT, out);
    },
  });

  Monoid.instance(SetT)({
    empty() {
      return as_data(SetT, new Set());
    },
  });

  Foldable.instance(SetT)({
    [some_method](predicate) {
      for (const item of raw(this)) if (predicate(item)) return true;
      return false;
    },
    [find_method](predicate) {
      for (const item of raw(this)) if (predicate(item)) return item;
      return undefined;
    },
    [fold_while_method](state, fn) {
      for (const item of raw(this)) {
        const step = fn(state, item);
        state = step[1];
        if (step[0] === "Done") return state;
      }
      return state;
    },
    fold(state, fn) {
      for (const item of raw(this)) state = fn(state, item);
      return state;
    },
  });
  return SetT;
}

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
export function from_set<item>(set: ReadonlySet<item>): SetT<item> {
  return SetT(set);
}

/** Collect an iterable into a wrapped set. */
export function from_iterable<item>(
  items: Iterable<item>,
): SetT<item> {
  return as_data(SetT, new Set(items));
}

/** Copy a wrapped set into a mutable JavaScript `Set`. */
export function to_set<item>(set: SetT<item>): Set<item> {
  return new Set(set.value());
}

function create_set(): AsSet {
  const SetT: AsSet = data<AsSet>(set_identity, function (set) {
    return this.data(new Set(set));
  });
  Show.instance(SetT)({
    show() {
      return inspect(this.value());
    },
  });

  Eq.instance(SetT)({
    eq(right) {
      const left = this.value();
      const right_value = right.value();

      if (left.size !== right_value.size) {
        return false;
      }

      for (const value of left) {
        if (!right_value.has(value)) {
          return false;
        }
      }

      return true;
    },
  });

  Functor.instance(SetT)({
    map(fn) {
      const out = new Set<ReturnType<typeof fn>>();

      for (const item of this.value()) {
        out.add(fn(item));
      }

      return as_data(SetT, out);
    },
  });

  Semigroup.instance(SetT)({
    concat(right) {
      const out = new Set(this.value());

      for (const item of right.value()) {
        out.add(item);
      }

      return as_data(SetT, out);
    },
  });

  Monoid.instance(SetT)({
    empty() {
      return as_data(SetT, new Set());
    },
  });

  Foldable.instance(SetT)({
    fold(initial, fn) {
      let state = initial;

      for (const item of this.value()) {
        state = fn(state, item);
      }

      return state;
    },
  });
  return SetT;
}

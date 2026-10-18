import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export const weak_set_identity: unique symbol = /* @__PURE__ */ Symbol(
  "weak_set_identity",
);

/** The object-only weak set wrapped by the `WeakSetT` dictionary. */
export type RawWeakSetT<item = object> = WeakSet<object>;

/** @ignore */
export interface AsWeakSetLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawWeakSetT<this[typeof type_item]>;
}

/** Dictionary type for object-only weak sets. */
export interface AsWeakSet
  extends
    As<AsWeakSetLambda, typeof weak_set_identity>,
    Show<AsWeakSet>,
    Eq<AsWeakSet> {
}

/** A wrapped WeakSetT value with its dictionary operations. */
export type WeakSetT<item extends object> = Data<AsWeakSet, item>;

/** Callable dictionary for wrapping weak sets by reference. */
export const WeakSetT: AsWeakSet = data<AsWeakSet>(weak_set_identity);

/** Build a wrapped weak set from an iterable of objects. */
export function from_iterable<item extends object>(
  items: Iterable<item>,
): WeakSetT<item> {
  return WeakSetT(new WeakSet<object>(items));
}

Show.instance(WeakSetT)({
  show() {
    return "WeakSet(?)";
  },
});

Eq.instance(WeakSetT)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});

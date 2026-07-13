import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export declare const weak_set_identity: unique symbol;

/** The object-only weak set wrapped by the `WeakSetT` dictionary. */
export type WeakSetT<item = object> = WeakSet<object>;

/** Dictionary type for object-only weak sets. */
export interface AsWeakSet
  extends
    As<AsWeakSet, typeof weak_set_identity>,
    Show<AsWeakSet>,
    Eq<AsWeakSet> {
  /** Higher-kinded slot for the object type. */
  readonly [type_item]: unknown;
  /** Weak-set representation at the selected object type. */
  readonly [type_data]: WeakSetT<this[typeof type_item]>;
}

/** @ignore */
export type WeakSetValue<item extends object> = Data<AsWeakSet, item>;

/** Callable dictionary for wrapping weak sets by reference. */
export const WeakSetT: AsWeakSet = data<AsWeakSet>();

/** Build a wrapped weak set from an iterable of objects. */
export function from_iterable<item extends object>(
  items: Iterable<item>,
): WeakSetValue<item> {
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

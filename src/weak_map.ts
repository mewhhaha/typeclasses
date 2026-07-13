import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export declare const weak_map_identity: unique symbol;

/** The object-keyed weak map wrapped by the `WeakMapT` dictionary. */
export type WeakMapT<item> = WeakMap<object, item>;

/** Dictionary type for object-keyed weak maps. */
export interface AsWeakMap
  extends
    As<AsWeakMap, typeof weak_map_identity>,
    Show<AsWeakMap>,
    Eq<AsWeakMap> {
  /** Higher-kinded slot for the mapped value type. */
  readonly [type_item]: unknown;
  /** Weak-map representation at the selected value type. */
  readonly [type_data]: WeakMapT<this[typeof type_item]>;
}

/** @ignore */
export type WeakMapValue<item> = Data<AsWeakMap, item>;

/** Callable dictionary for wrapping weak maps by reference. */
export const WeakMapT: AsWeakMap = data<AsWeakMap>();

/** Build a wrapped weak map from object-keyed entries. */
export function from_entries<item>(
  entries: Iterable<readonly [object, item]>,
): WeakMapValue<item> {
  return WeakMapT(new WeakMap(entries));
}

Show.instance(WeakMapT)({
  show() {
    return "WeakMap(?)";
  },
});

Eq.instance(WeakMapT)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});

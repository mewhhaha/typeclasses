import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

/** @ignore */
export const weak_map_identity: unique symbol = /* @__PURE__ */ Symbol(
  "weak_map_identity",
);

/** The object-keyed weak map wrapped by the `WeakMapT` dictionary. */
export type RawWeakMapT<item> = WeakMap<object, item>;

/** @ignore */
export interface AsWeakMapLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawWeakMapT<this[typeof type_item]>;
}

/** Dictionary type for object-keyed weak maps. */
export interface AsWeakMap
  extends
    As<AsWeakMapLambda, typeof weak_map_identity>,
    Show<AsWeakMap>,
    Eq<AsWeakMap> {
}

/** A wrapped WeakMapT value with its dictionary operations. */
export type WeakMapT<item> = Data<AsWeakMap, item>;

/** Callable dictionary for wrapping weak maps by reference. */
export const WeakMapT: AsWeakMap = data<AsWeakMap>(weak_map_identity);

/** Build a wrapped weak map from object-keyed entries. */
export function from_entries<item>(
  entries: Iterable<readonly [object, item]>,
): WeakMapT<item> {
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

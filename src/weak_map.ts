import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

export type WeakMapT<item> = WeakMap<object, item>;

export interface AsWeakMap
  extends As<AsWeakMap>, Show<AsWeakMap>, Eq<AsWeakMap> {
  readonly [type_item]: unknown;
  readonly [type_data]: WeakMapT<this[typeof type_item]>;
}

type WeakMapValue<item> = Data<AsWeakMap, item>;

export const WeakMapT = data<AsWeakMap>();

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

import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Eq, Show } from "./typeclasses.ts";

export type WeakSetT<item = object> = WeakSet<object>;

export interface AsWeakSet
  extends As<AsWeakSet>, Show<AsWeakSet>, Eq<AsWeakSet> {
  readonly [type_item]: unknown;
  readonly [type_data]: WeakSetT<this[typeof type_item]>;
}

type WeakSetValue<item extends object> = Data<AsWeakSet, item>;

export const WeakSetT = data<AsWeakSet>();

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

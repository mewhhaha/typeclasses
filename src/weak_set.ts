import { type As, define, type Value } from "./trait.ts";
import { Equal, Format } from "./traits.ts";

export type WeakSetT<item = object> = WeakSet<object>;

export const weak_set_kind = Symbol("WeakSetT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [weak_set_kind]: WeakSetT<item>;
  }
}

export interface AsWeakSet extends As<typeof weak_set_kind> {}

type WeakSetValue<item extends object> = Value<AsWeakSet, item>;

export const WeakSetT = define<AsWeakSet>(
  weak_set_kind,
);

export function from_iterable<item extends object>(
  items: Iterable<item>,
): WeakSetValue<item> {
  return WeakSetT(new WeakSet<object>(items));
}

Format.implement(WeakSetT)({
  fmt() {
    return "WeakSet(?)";
  },
});

export interface AsWeakSet extends Format<AsWeakSet> {}

Equal.implement(WeakSetT)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});

export interface AsWeakSet extends Equal<AsWeakSet> {}

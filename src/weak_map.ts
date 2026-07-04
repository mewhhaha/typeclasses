import { type As, define, type Value } from "./trait.ts";
import { Equal, Format } from "./traits.ts";

export type WeakMapT<item> = WeakMap<object, item>;

export const weak_map_kind = Symbol("WeakMapT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [weak_map_kind]: WeakMapT<item>;
  }
}

export interface AsWeakMap extends As<typeof weak_map_kind> {}

type WeakMapValue<item> = Value<AsWeakMap, item>;

export const WeakMapT = define<AsWeakMap>(
  weak_map_kind,
);

export function from_entries<item>(
  entries: Iterable<readonly [object, item]>,
): WeakMapValue<item> {
  return WeakMapT(new WeakMap(entries));
}

Format.implement(WeakMapT)({
  fmt() {
    return "WeakMap(?)";
  },
});

export interface AsWeakMap extends Format<AsWeakMap> {}

Equal.implement(WeakMapT)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});

export interface AsWeakMap extends Equal<AsWeakMap> {}

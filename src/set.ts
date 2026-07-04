import { type As, define, type Value } from "./trait.ts";
import {
  Equal,
  Foldable,
  Format,
  Functor,
  Monoid,
  Semigroup,
} from "./traits.ts";

export type SetT<item> = ReadonlySet<item>;

export const set_kind = Symbol("SetT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [set_kind]: SetT<item>;
  }
}

export interface AsSet extends As<typeof set_kind> {}

type SetValue<item> = Value<AsSet, item>;

export const SetT = define<AsSet>(
  set_kind,
  function (set) {
    return this.as_trait(new Set(set));
  },
);

export function from_set<item>(set: ReadonlySet<item>): SetValue<item> {
  return SetT(set);
}

export function from_iterable<item>(
  items: Iterable<item>,
): SetValue<item> {
  return SetT(new Set(items));
}

export function to_set<item>(set: SetValue<item>): Set<item> {
  return new Set(set.value());
}

Format.implement(SetT)({
  fmt() {
    return Deno.inspect(this.value());
  },
});

export interface AsSet extends Format<AsSet> {}

Equal.implement(SetT)({
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

export interface AsSet extends Equal<AsSet> {}

Functor.implement(SetT)({
  map(fn) {
    return SetT(new Set([...this.value()].map(fn)));
  },
});

export interface AsSet extends Functor<AsSet> {}

Semigroup.implement(SetT)({
  concat(right) {
    return SetT(new Set([...this.value(), ...right.value()]));
  },
});

export interface AsSet extends Semigroup<AsSet> {}

Monoid.implement(SetT)({
  empty() {
    return SetT(new Set());
  },
});

export interface AsSet extends Monoid<AsSet> {}

Foldable.implement(SetT)({
  fold(initial, fn) {
    let state = initial;

    for (const item of this.value()) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface AsSet extends Foldable<AsSet> {}

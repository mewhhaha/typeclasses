import {
  type As,
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

export type SetT<item> = ReadonlySet<item>;

export interface AsSet
  extends
    As<AsSet>,
    Show<AsSet>,
    Eq<AsSet>,
    Functor<AsSet>,
    Monoid<AsSet>,
    Foldable<AsSet> {
  readonly [type_item]: unknown;
  readonly [type_data]: SetT<this[typeof type_item]>;
}

type SetValue<item> = Data<AsSet, item>;

export const SetT: AsSet = data<AsSet>(
  function (set) {
    return this.data(new Set(set));
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

    return SetT(out);
  },
});

Semigroup.instance(SetT)({
  concat(right) {
    const out = new Set(this.value());

    for (const item of right.value()) {
      out.add(item);
    }

    return SetT(out);
  },
});

Monoid.instance(SetT)({
  empty() {
    return SetT(new Set());
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

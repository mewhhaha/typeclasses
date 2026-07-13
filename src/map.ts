import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  Eq,
  Foldable,
  Functor,
  Monoid,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export declare const map_identity: unique symbol;

/** A read-only string-keyed map wrapped by the MapT dictionary. */
export type MapT<item> = ReadonlyMap<string, item>;

/** Dictionary type for string-keyed maps and their value-wise instances. */
export interface AsMap
  extends
    As<AsMap, typeof map_identity>,
    Show<AsMap>,
    Eq<AsMap>,
    Monoid<AsMap>,
    Traversable<AsMap> {
  /** Higher-kinded slot for the mapped value type. */
  readonly [type_item]: unknown;
  /** Read-only map representation at the selected value type. */
  readonly [type_data]: MapT<this[typeof type_item]>;
}

type MapValue<item> = Data<AsMap, item>;

/** Callable map dictionary that defensively copies maps when wrapping them. */
export const MapT: AsMap = data<AsMap>(
  function (map) {
    return this.data(new Map(map));
  },
);

/** Build a wrapped map from string-keyed entries. */
export function from_entries<item>(
  entries: Iterable<readonly [string, item]>,
): MapValue<item> {
  return MapT(new Map(entries));
}

/** Build a wrapped map from an object's own enumerable entries. */
export function from_record<item>(
  record: Readonly<Record<string, item>>,
): MapValue<item> {
  return from_entries(Object.entries(record));
}

/** Copy a wrapped map into a mutable JavaScript Map. */
export function to_map<item>(map: MapValue<item>): Map<string, item> {
  return new Map(map.value());
}

/** Copy a wrapped map into a plain string-keyed record. */
export function to_record<item>(
  map: MapValue<item>,
): Record<string, item> {
  return Object.fromEntries(map.value());
}

Show.instance(MapT)({
  show() {
    const map = this.value();
    return inspect(map);
  },
});

Eq.instance(MapT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left.size !== right_value.size) {
      return false;
    }

    for (const [key, value] of left) {
      if (!right_value.has(key)) {
        return false;
      }

      if (!Object.is(value, right_value.get(key))) {
        return false;
      }
    }

    return true;
  },
});

Functor.instance(MapT)({
  map(fn) {
    const map = this.value();
    const out = new Map<string, ReturnType<typeof fn>>();

    for (const [key, value] of map) {
      out.set(key, fn(value));
    }

    return MapT(out);
  },
});

Semigroup.instance(MapT)({
  concat(right) {
    const left = this.value();
    const out = new Map(left);

    for (const [key, value] of right.value()) {
      out.set(key, value);
    }

    return MapT(out);
  },
});

Monoid.instance(MapT)({
  empty() {
    return MapT(new Map());
  },
});

Foldable.instance(MapT)({
  fold(initial, fn) {
    const map = this.value();
    let state = initial;

    for (const value of map.values()) {
      state = fn(state, value);
    }

    return state;
  },
});

Traversable.instance(MapT)({
  traverse(applicative, fn) {
    const map = this.value();
    const entries = [...map.entries()];

    if (entries.length === 0) {
      return Applicative.pure(applicative, MapT(new Map()));
    }

    let index = entries.length - 1;
    const [key, item] = entries[index];
    let out = Functor.map(fn(item), map_single(key));

    for (index -= 1; index >= 0; index -= 1) {
      const [key, value] = entries[index];
      out = Applicative.ap(Functor.map(fn(value), map_prepend(key)), out);
    }

    return out;
  },
});

function map_single<item>(key: string) {
  return (value: item): MapValue<item> => MapT(new Map([[key, value]]));
}

function map_prepend<item>(key: string) {
  return (value: item) => {
    return (tail: MapValue<item>) => {
      return MapT(new Map([[key, value], ...tail.value()]));
    };
  };
}

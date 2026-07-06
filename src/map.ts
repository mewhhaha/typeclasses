import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
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

export type MapT<item> = ReadonlyMap<string, item>;

export interface AsMap
  extends
    As<AsMap>,
    Show<AsMap>,
    Eq<AsMap>,
    Functor<AsMap>,
    Semigroup<AsMap>,
    Monoid<AsMap>,
    Foldable<AsMap>,
    Traversable<AsMap> {
  readonly [type_item]: unknown;
  readonly [type_data]: MapT<this[typeof type_item]>;
}

type MapValue<item> = Data<AsMap, item>;

export const MapT = data<AsMap>(
  function (map) {
    return this.data(new Map(map));
  },
);

export function from_entries<item>(
  entries: Iterable<readonly [string, item]>,
): MapValue<item> {
  return MapT(new Map(entries));
}

export function from_record<item>(
  record: Readonly<Record<string, item>>,
): MapValue<item> {
  return from_entries(Object.entries(record));
}

export function to_map<item>(map: MapValue<item>): Map<string, item> {
  return new Map(map.value());
}

export function to_record<item>(
  map: MapValue<item>,
): Record<string, item> {
  return Object.fromEntries(map.value());
}

Show.instance(MapT)({
  show() {
    const map = this.value();
    return Deno.inspect(map);
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

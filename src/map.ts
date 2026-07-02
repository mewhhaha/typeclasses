import {
  as_trait,
  type Dictionary,
  item_type,
  kind,
  require_this,
  type Value,
  value_type,
} from "./trait.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monoid,
  Semigroup,
  Traversable,
} from "./traits.ts";

export type MapT<item> = ReadonlyMap<string, item>;

export const map_kind: unique symbol = Symbol("MapT");

export interface MapDictionary extends Dictionary<typeof map_kind> {
  <item>(map: MapT<item>): MapValue<item>;
  readonly [value_type]: MapT<this[typeof item_type]>;
}

type MapValue<item> = Value<MapDictionary, item>;

export const MapT: MapDictionary = function <item>(
  map: MapT<item>,
): MapValue<item> {
  return as_trait(MapT, new Map(map));
} as MapDictionary;

MapT[kind] = map_kind;

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

Format.implement(MapT, {
  fmt() {
    const map = require_this(this, "MapT.Format.fmt").value();
    return Deno.inspect(map);
  },
});

export interface MapDictionary extends Format<typeof MapT> {}

Equal.implement(MapT, {
  eq<item>(
    this: MapValue<item> | void,
    right: MapValue<item>,
  ) {
    const left = require_this(this, "MapT.Equal.eq").value();
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

export interface MapDictionary extends Equal<typeof MapT> {}

Functor.implement(MapT, {
  map<from, to>(
    this: MapValue<from> | void,
    fn: (value: from) => to,
  ) {
    const map = require_this(this, "MapT.Functor.map").value();
    const out = new Map<string, to>();

    for (const [key, value] of map) {
      out.set(key, fn(value));
    }

    return MapT(out);
  },
});

export interface MapDictionary extends Functor<typeof MapT> {}

Semigroup.implement(MapT, {
  concat<item>(
    this: MapValue<item> | void,
    right: MapValue<item>,
  ) {
    const left = require_this(this, "MapT.Semigroup.concat").value();
    const out = new Map(left);

    for (const [key, value] of right.value()) {
      out.set(key, value);
    }

    return MapT(out);
  },
});

export interface MapDictionary extends Semigroup<typeof MapT> {}

Monoid.implement(MapT, {
  empty<item>() {
    return MapT<item>(new Map());
  },
});

export interface MapDictionary extends Monoid<typeof MapT> {}

Foldable.implement(MapT, {
  fold<item, out>(
    this: MapValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ) {
    const map = require_this(this, "MapT.Foldable.fold").value();
    let state = initial;

    for (const value of map.values()) {
      state = fn(state, value);
    }

    return state;
  },
});

export interface MapDictionary extends Foldable<typeof MapT> {}

Traversable.implement(MapT, {
  traverse<applicative extends Applicative<applicative>, from, to>(
    this: MapValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ) {
    const map = require_this(this, "MapT.Traversable.traverse").value();
    const entries = [...map.entries()];
    let out = Applicative.pure(applicative, MapT<to>(new Map()));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index];
      const insert = Functor.map(fn(value), (mapped) => {
        return (tail: MapValue<to>) => {
          return MapT(new Map([[key, mapped], ...tail.value()]));
        };
      });
      out = Applicative.ap(insert, out);
    }

    return out;
  },
});

export interface MapDictionary extends Traversable<typeof MapT> {}

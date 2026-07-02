import {
  type Dictionary,
  kind,
  require_this,
  trait_constructor,
  type Value,
} from "./trait.ts";
import {
  Applicative,
  Equal,
  equal_trait,
  type EqualImplementation,
  Foldable,
  foldable_trait,
  type FoldableImplementation,
  Format,
  format_trait,
  type FormatImplementation,
  Functor,
  functor_trait,
  type FunctorImplementation,
  Monoid,
  monoid_trait,
  type MonoidImplementation,
  Semigroup,
  semigroup_trait,
  type SemigroupImplementation,
  Traversable,
  traversable_trait,
  type TraversableImplementation,
} from "./traits.ts";

export type MapT<item> = ReadonlyMap<string, item>;

export const map_kind: unique symbol = Symbol("MapT");

declare module "./registry.ts" {
  interface Registry<item> {
    [map_kind]: MapT<item>;
  }
}

export interface MapDictionary {
  <item>(map: MapT<item>): MapValue<item>;
  [kind]: typeof map_kind;
}

type MapValue<item> = Value<MapDictionary, item>;

export const MapT = function MapT<item>(
  map: MapT<item>,
): MapValue<item> {
  return map_trait(new Map(map));
} as MapDictionary;

MapT[kind] = map_kind;

const map_trait = trait_constructor(MapT);

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

const map_format = {
  fmt(this: MapValue<unknown> | void): string {
    const map = require_this(this, "MapT.Format.fmt").value();
    return Deno.inspect(map);
  },
} satisfies FormatImplementation<typeof MapT>;

MapT[format_trait] = map_format;
MapT.fmt = map_format.fmt;

export interface MapDictionary
  extends Format<typeof MapT>, FormatImplementation<typeof MapT> {}

const map_equal = {
  eq<item>(
    this: MapValue<item> | void,
    right: MapValue<item>,
  ): boolean {
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
} satisfies EqualImplementation<typeof MapT>;

MapT[equal_trait] = map_equal;
MapT.eq = map_equal.eq;

export interface MapDictionary
  extends Equal<typeof MapT>, EqualImplementation<typeof MapT> {}

const map_functor = {
  map<from, to>(
    this: MapValue<from> | void,
    fn: (value: from) => to,
  ): MapValue<to> {
    const map = require_this(this, "MapT.Functor.map").value();
    const out = new Map<string, to>();

    for (const [key, value] of map) {
      out.set(key, fn(value));
    }

    return MapT(out);
  },
} satisfies FunctorImplementation<typeof MapT>;

MapT[functor_trait] = map_functor;
MapT.map = map_functor.map;

export interface MapDictionary
  extends Functor<typeof MapT>, FunctorImplementation<typeof MapT> {}

const map_semigroup = {
  concat<item>(
    this: MapValue<item> | void,
    right: MapValue<item>,
  ): MapValue<item> {
    const left = require_this(this, "MapT.Semigroup.concat").value();
    const out = new Map(left);

    for (const [key, value] of right.value()) {
      out.set(key, value);
    }

    return MapT(out);
  },
} satisfies SemigroupImplementation<typeof MapT>;

MapT[semigroup_trait] = map_semigroup;
MapT.concat = map_semigroup.concat;

export interface MapDictionary
  extends Semigroup<typeof MapT>, SemigroupImplementation<typeof MapT> {}

const map_monoid = {
  empty<item>(): MapValue<item> {
    return MapT<item>(new Map());
  },
} satisfies MonoidImplementation<typeof MapT>;

MapT[monoid_trait] = map_monoid;
MapT.empty = map_monoid.empty;

export interface MapDictionary
  extends Monoid<typeof MapT>, MonoidImplementation<typeof MapT> {}

const map_foldable = {
  fold<item, out>(
    this: MapValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    const map = require_this(this, "MapT.Foldable.fold").value();
    let state = initial;

    for (const value of map.values()) {
      state = fn(state, value);
    }

    return state;
  },
} satisfies FoldableImplementation<typeof MapT>;

MapT[foldable_trait] = map_foldable;
MapT.fold = map_foldable.fold;

export interface MapDictionary
  extends Foldable<typeof MapT>, FoldableImplementation<typeof MapT> {}

const map_traversable = {
  traverse<applicative extends Dictionary & Applicative<applicative>, from, to>(
    this: MapValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, MapValue<to>> {
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
} satisfies TraversableImplementation<typeof MapT>;

MapT[traversable_trait] = map_traversable;
MapT.traverse = map_traversable.traverse;

export interface MapDictionary
  extends Traversable<typeof MapT>, TraversableImplementation<typeof MapT> {}

import { find_method, some_method } from "./typeclasses/foldable.ts";
import {
  type As,
  as_data,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { traverse_items_into } from "./traversal.ts";
import {
  Eq,
  Foldable,
  Functor,
  Monoid,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export const map_identity: unique symbol = /* @__PURE__ */ Symbol(
  "map_identity",
);

/** A read-only map; the key parameter defaults to string. */
export type RawMapT<item, key = string> = ReadonlyMap<key, item>;

/** @ignore */
export interface AsMapLambda<key = string> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawMapT<this[typeof type_item], key>;
}

/** Dictionary type for maps with a fixed key type and value-wise instances. */
export interface AsMap<key = string>
  extends
    As<AsMapLambda<key>, typeof map_identity>,
    Show<AsMap<key>>,
    Eq<AsMap<key>>,
    Monoid<AsMap<key>>,
    Traversable<AsMap<key>> {
}

/** A map wrapped with key-preserving dictionary methods. */
export type MapT<item, key = string> = Data<AsMap<key>, item>;

/** Callable map dictionary that defensively copies maps when wrapping them. */
// The callable boundary infers keys; methods retain that fixed key type.
type MapConstructor = {
  <key, item>(map: ReadonlyMap<key, item>): MapT<item, key>;
} & AsMap<unknown>;
/** Callable map dictionary with map, fold and traversal instances. */
export const MapT: MapConstructor = /* @__PURE__ */ create_map();

/** Build a wrapped map, inferring both key and value types. */
export function from_entries<item, key = string>(
  entries: Iterable<readonly [key, item]>,
): MapT<item, key> {
  return as_data(MapT as AsMap<key>, new Map(entries));
}

/** Build a wrapped map from an object's own enumerable entries. */
export function from_record<item>(
  record: Readonly<Record<string, item>>,
): MapT<item> {
  const out = new Map<string, item>();
  for (const key of Object.keys(record)) out.set(key, record[key]);
  return as_data(MapT as AsMap<string>, out);
}

/** Copy a wrapped map into a mutable JavaScript Map. */
export function to_map<item, key>(map: MapT<item, key>): Map<key, item> {
  return new Map(map.value());
}

/** Copy a wrapped map into a plain string-keyed record. */
export function to_record<item>(
  map: MapT<item>,
): Record<string, item> {
  return Object.fromEntries(map.value());
}

/** Snapshot a map; later source mutations are invisible. */
export function from_snapshot<item, key>(
  source: ReadonlyMap<key, item>,
): MapT<item, key> {
  return MapT(source);
}
/** Wrap a live map by reference; later source mutations remain visible. */
export function from_map_view<item, key>(
  source: ReadonlyMap<key, item>,
): MapT<item, key> {
  return as_data(MapT as AsMap<key>, source);
}

/** Fold values with their original keys, without materializing entries. */
export function fold_with_key<key, item, state>(
  map: MapT<item, key>,
  initial: state,
  fn: (state: state, item: item, key: key) => state,
): state {
  let result = initial;
  map.value().forEach((item, key) => {
    result = fn(result, item, key);
  });
  return result;
}

function map_from_values<key, item>(
  keys: readonly key[],
  items: Iterable<item>,
): Map<key, item> {
  const out = new Map<key, item>();
  let index = 0;
  for (const item of items) out.set(keys[index++], item);
  return out;
}

function create_map(): MapConstructor {
  const MapT: MapConstructor = data<AsMap<unknown>>(
    map_identity,
    function (map) {
      return this.data(new Map(map));
    },
  ) as MapConstructor;
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
      const out = new Map<unknown, ReturnType<typeof fn>>();

      for (const [key, value] of map) {
        out.set(key, fn(value));
      }

      return as_data(MapT, out);
    },
  });

  Semigroup.instance(MapT)({
    concat(right) {
      const left = this.value();
      const out = new Map(left);

      for (const [key, value] of right.value()) {
        out.set(key, value);
      }

      return as_data(MapT, out);
    },
  });

  Monoid.instance(MapT)({
    empty() {
      return as_data(MapT, new Map());
    },
  });

  Foldable.instance(MapT)({
    [some_method](predicate) {
      for (const item of this.value().values()) {
        if (predicate(item)) return true;
      }
      return false;
    },
    [find_method](predicate) {
      for (const item of this.value().values()) {
        if (predicate(item)) return item;
      }
      return undefined;
    },

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
      const source = this.value();
      const keys: unknown[] = [];
      const key_iterator = source.keys();
      return traverse_items_into(
        source.values(),
        applicative,
        (item) => {
          keys.push(key_iterator.next().value);
          return fn(item);
        },
        (items) => as_data(MapT, map_from_values(keys, items)),
      );
    },
  });
  return MapT;
}

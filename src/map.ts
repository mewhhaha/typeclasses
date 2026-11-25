import {
  find_method,
  fold_while_method,
  some_method,
} from "./typeclasses/foldable.ts";
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
export const from_entries = <item, key = string>(
  entries: Iterable<readonly [key, item]>,
): MapT<item, key> => as_data(MapT as AsMap<key>, new Map(entries));

/** Build a wrapped map from an object's own enumerable entries. */
export const from_record = <item>(
  record: Readonly<Record<string, item>>,
): MapT<item> => {
  const out = new Map<string, item>();
  for (const key in record) {
    if (Object.hasOwn(record, key)) out.set(key, record[key]);
  }
  return as_data(MapT as AsMap<string>, out);
};

/** Copy a wrapped map into a mutable JavaScript Map. */
export const to_map = <item, key>(map: MapT<item, key>): Map<key, item> =>
  new Map(map.value());

/** Copy a wrapped map into a plain string-keyed record. */
export const to_record = <item>(map: MapT<item>): Record<string, item> =>
  Object.fromEntries(map.value());

/** Snapshot a map; later source mutations are invisible. */
export const from_snapshot: <item, key>(
  source: ReadonlyMap<key, item>,
) => MapT<item, key> = MapT as <item, key>(
  source: ReadonlyMap<key, item>,
) => MapT<item, key>;
/** Wrap a live map by reference; later source mutations remain visible. */
export const from_map_view = <item, key>(
  source: ReadonlyMap<key, item>,
): MapT<item, key> => as_data(MapT as AsMap<key>, source);

/** Fold values with their original keys, without materializing entries. */
export const fold_with_key = <key, item, state>(
  map: MapT<item, key>,
  state: state,
  fn: (state: state, item: item, key: key) => state,
): state => {
  map.value().forEach((item, key) => {
    state = fn(state, item, key);
  });
  return state;
};

function create_map(): MapConstructor {
  const MapT: MapConstructor = data<AsMap<unknown>>(
    map_identity,
    function (map) {
      return this.data(new Map(map));
    },
  ) as MapConstructor;
  const raw = <item>(map: Data<AsMap<unknown>, item>) => map.value();
  const values = <item>(map: Data<AsMap<unknown>, item>) =>
    map.value().values();
  Show.instance(MapT)({
    show() {
      return inspect(raw(this));
    },
  });

  Eq.instance(MapT)({
    eq(right) {
      const left = raw(this);
      const right_value = raw(right);
      if (left === right_value) return true;
      if (left.size !== right_value.size) return false;
      for (const [key, value] of left) {
        const other = right_value.get(key);
        if (
          !Object.is(value, other) ||
          (other === undefined && !right_value.has(key))
        ) {
          return false;
        }
      }
      return true;
    },
  });

  Functor.instance(MapT)({
    map(fn) {
      const out = new Map<unknown, ReturnType<typeof fn>>();
      for (const [key, value] of raw(this)) out.set(key, fn(value));
      return as_data(MapT, out);
    },
  });

  Semigroup.instance(MapT)({
    concat(right) {
      const left = raw(this);
      const right_value = raw(right);
      const out = new Map(left.size ? left : right_value);
      if (left.size) {
        for (const [key, value] of right_value) out.set(key, value);
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
      for (const item of values(this)) if (predicate(item)) return true;
      return false;
    },
    [find_method](predicate) {
      for (const item of values(this)) if (predicate(item)) return item;
      return undefined;
    },
    [fold_while_method](state, fn) {
      for (const item of values(this)) {
        const step = fn(state, item);
        state = step[1];
        if (step[0] === "Done") return state;
      }
      return state;
    },
    fold(state, fn) {
      for (const value of values(this)) state = fn(state, value);
      return state;
    },
  });

  Traversable.instance(MapT)({
    traverse(applicative, fn) {
      const source = raw(this);
      const keys: unknown[] = [];
      const key_iterator = source.keys();
      return traverse_items_into(
        source.values(),
        applicative,
        (item) => {
          keys.push(key_iterator.next().value);
          return fn(item);
        },
        (items) => {
          const out = new Map<
            unknown,
            typeof items extends Iterable<infer to> ? to : never
          >();
          let index = 0;
          for (const item of items) out.set(keys[index++], item);
          return as_data(MapT, out);
        },
      );
    },
  });
  return MapT;
}

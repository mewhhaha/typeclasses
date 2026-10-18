import {
  data,
  type Dictionary,
  type IsUnion,
  type type_identity,
} from "./typeclass.ts";
import type { Lift } from "./effects.ts";

/**
 * The phantom identity distinguishing one keyed cell from its siblings.
 *
 * A dictionary family such as Reader or State carries a single `identity`
 * symbol, so every instantiation shares one runtime kind and one handler. A
 * cell pairs that symbol with a key, giving each cell its own identity at the
 * type level and its own kind at runtime.
 */
export type CellIdentity<identity, key extends PropertyKey> = readonly [
  identity,
  key,
];

/**
 * Removes one cell's lifts from an effect requirement union.
 *
 * A base dictionary's identity is the bare `identity` symbol, which never
 * extends a two-element tuple, so an anonymous handler leaves cell lifts
 * pending and a cell handler leaves anonymous lifts pending.
 */
export type WithoutCell<requirements, identity, key extends PropertyKey> =
  requirements extends Lift<infer dictionary, infer _item>
    ? dictionary[typeof type_identity] extends CellIdentity<identity, key>
      ? never
    : requirements
    : requirements;

/** Rejects widened keys and unions that could address different runtime cells. */
export type NominalKey<key extends PropertyKey> = string extends key ? never
  : number extends key ? never
  : symbol extends key ? never
  : true extends IsUnion<key> ? never
  : key;

/** @ignore */
export type WidenedCellKey = {
  readonly ERROR:
    "a cell key must be a literal, or a symbol declared as a const";
};

const cell_kinds = new WeakMap<object, Map<PropertyKey, symbol>>();

/** @ignore Create a dictionary addressed by a real key within a family. */
export function cell_dictionary<dictionary extends Dictionary>(
  family: object,
  key: PropertyKey,
): dictionary {
  if (
    typeof key !== "string" && typeof key !== "number" &&
    typeof key !== "symbol"
  ) {
    throw new TypeError(
      "A cell requires a runtime string, number, or symbol key",
    );
  }
  let keys = cell_kinds.get(family);
  if (keys === undefined) {
    keys = new Map();
    cell_kinds.set(family, keys);
  }
  let identity = keys.get(key);
  if (identity === undefined) {
    identity = Symbol(String(key));
    keys.set(key, identity);
  }
  return data<dictionary>(
    identity as dictionary[typeof type_identity] & symbol,
  );
}

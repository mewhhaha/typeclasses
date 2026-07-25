import { data, type Dictionary, type type_identity } from "./typeclass.ts";
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

/** Rejects a key that widened to `string`, `number`, or `symbol`. */
export type NominalKey<key extends PropertyKey> = string extends key ? never
  : number extends key ? never
  : symbol extends key ? never
  : key;

/** @ignore */
export type WidenedCellKey = {
  readonly ERROR:
    "a cell key must be a literal, or a symbol declared as a const";
};

/**
 * Create a dictionary with a runtime kind of its own.
 *
 * The key lives only in the type, so there is nothing to derive a kind from and
 * each call mints a fresh one. Runtime identity is therefore finer than type
 * identity: declaring the same key twice yields one cell to the compiler and
 * two at runtime, and the second cell's lifts survive a handler the types said
 * would discharge them, throwing at the terminal `run`. One declaration per key
 * is a convention this cannot check.
 *
 * @ignore
 */
export function cell_dictionary<dictionary extends Dictionary>(): dictionary {
  return data<dictionary>();
}

export { kind } from "./registry.ts";
export type { Kind, Registry, TypeId } from "./registry.ts";
export { is_trait, trait } from "./trait_value.ts";
export type { Trait } from "./trait_value.ts";
import { type Kind, kind, type TypeId } from "./registry.ts";
import { trait_constructor as raw_trait_constructor } from "./trait_value.ts";
import type { Trait } from "./trait_value.ts";

export type This<self> = self | void;

export function require_this<self>(value: This<self>, name: string): self {
  if (value === undefined) {
    throw new TypeError(name + " requires a trait receiver");
  }

  return value;
}

type KindOf<dictionary> = dictionary extends {
  readonly [kind]: infer type_id extends TypeId;
} ? type_id
  : never;

export type Value<dictionary, item> = Trait<
  dictionary,
  Kind<KindOf<dictionary>, item>,
  item
>;

export type Receiver<dictionary extends Dictionary, item> = This<
  Value<dictionary, item>
>;

export type Dictionary = {
  readonly [kind]: TypeId;
};

export function trait_constructor<dictionary extends Dictionary>(
  dictionary: dictionary,
): <item>(value: Kind<KindOf<dictionary>, item>) => Value<dictionary, item>;
export function trait_constructor<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(value: value) => Trait<dictionary, value, item>;
export function trait_constructor<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(value: value) => Trait<dictionary, value, item> {
  return raw_trait_constructor(dictionary);
}

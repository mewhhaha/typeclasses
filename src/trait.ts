export { kind } from "./registry.ts";
export type { Kind, Registry, TypeId } from "./registry.ts";
export { is_trait, trait } from "./trait_value.ts";
export type { Trait } from "./trait_value.ts";
import { type Kind, kind, type TypeId } from "./registry.ts";
import type { Trait } from "./trait_value.ts";

export type TraitThis<self> = self | void;

export function require_this<self>(value: TraitThis<self>, name: string): self {
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

export type Dictionary = {
  readonly [kind]: TypeId;
};

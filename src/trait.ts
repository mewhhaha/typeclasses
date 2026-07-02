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

export type TraitDictionary<
  token extends PropertyKey,
  implementation extends object,
> =
  & Dictionary
  & { [key in token]: implementation }
  & implementation;

export function implement_trait<implementation extends object>(
  dictionary: object,
  token: PropertyKey,
  implementation: implementation,
): implementation {
  Object.assign(dictionary, implementation);
  (dictionary as { [key: PropertyKey]: unknown })[token] = implementation;

  return implementation;
}

function call_trait_method<out>(
  method: Function,
  receiver: unknown,
  args: readonly unknown[],
): out {
  return Reflect.apply(method, receiver, args) as out;
}

type TraitImplementation<
  token extends PropertyKey,
  dictionary extends { [key in token]: object },
> = dictionary[token];

type TraitDefinitionConstructor<token extends PropertyKey = PropertyKey> = {
  readonly token: token;
};

export abstract class TraitDefinition {
  declare static token: PropertyKey;

  static implement<
    token extends PropertyKey,
    dictionary extends Dictionary & { [key in token]: object },
  >(
    this: TraitDefinitionConstructor<token>,
    dictionary: dictionary,
    implementation: NoInfer<TraitImplementation<token, dictionary>>,
  ): TraitImplementation<token, dictionary> {
    return implement_trait(
      dictionary,
      this.token,
      implementation,
    ) as TraitImplementation<token, dictionary>;
  }

  protected static invoke<out>(
    this: TraitDefinitionConstructor,
    receiver: object,
    method: PropertyKey,
    args: readonly unknown[] = [],
  ): out {
    const implementation = (receiver as {
      [key: PropertyKey]: { [key: PropertyKey]: Function };
    })[this.token];

    return call_trait_method(implementation[method], receiver, args);
  }
}

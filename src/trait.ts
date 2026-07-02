export { is_trait } from "./trait_value.ts";
export type { Trait } from "./trait_value.ts";
import {
  trait as raw_as_trait,
  trait_constructor as raw_as_trait_cached,
} from "./trait_value.ts";
import type { Trait } from "./trait_value.ts";

export const kind: unique symbol = Symbol("Trait.kind");
export const item_type: unique symbol = Symbol("Trait.item");
export const value_type: unique symbol = Symbol("Trait.value");

export type This<self> = self | void;

export function require_this<self>(value: This<self>, name: string): self {
  if (value === undefined) {
    throw new TypeError(name + " requires a trait receiver");
  }

  return value;
}

export type ContextValue<dictionary extends Dictionary, item> =
  dictionary extends { readonly [value_type]: unknown }
    ? (dictionary & { readonly [item_type]: item })[typeof value_type]
    : never;

export type Value<dictionary extends Dictionary, item> = Trait<
  dictionary,
  ContextValue<dictionary, item>,
  item
>;

export type Receiver<dictionary extends Dictionary, item> = This<
  Value<dictionary, item>
>;

export type Dictionary<type_id = unknown> = {
  [kind]: type_id;
  readonly [item_type]?: unknown;
};

export function as_trait<dictionary extends Dictionary, item>(
  dictionary: dictionary,
  value: ContextValue<dictionary, item>,
): Value<dictionary, item>;
export function as_trait<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): Trait<dictionary, value, item>;
export function as_trait<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): Trait<dictionary, value, item> {
  return raw_as_trait(dictionary, value);
}

export function as_trait_cached<dictionary extends Dictionary>(
  dictionary: dictionary,
): <item>(value: ContextValue<dictionary, item>) => Value<dictionary, item>;
export function as_trait_cached<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(value: value) => Trait<dictionary, value, item>;
export function as_trait_cached<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(value: value) => Trait<dictionary, value, item> {
  return raw_as_trait_cached(dictionary);
}

export type TraitDictionary<
  dictionary extends Dictionary,
  token extends PropertyKey,
  implementation extends object,
> =
  & Dictionary<dictionary[typeof kind]>
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

type Callable = (this: unknown, ...args: unknown[]) => unknown;

function call_trait_method<out>(
  method: Callable,
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
      [key: PropertyKey]: { [key: PropertyKey]: Callable };
    })[this.token];

    return call_trait_method(implementation[method], receiver, args);
  }
}

export { is_trait } from "./trait_value.ts";
export type { Trait } from "./trait_value.ts";
import {
  trait as raw_as_trait,
  trait_constructor as raw_as_trait_cached,
} from "./trait_value.ts";
import type { Trait } from "./trait_value.ts";

export const kind = Symbol("Trait.kind");

// deno-lint-ignore no-empty-interface
export interface TraitTypes<dictionary, item> {}

export type ContextValue<dictionary extends Dictionary, item> =
  dictionary[typeof kind] extends keyof TraitTypes<dictionary, item>
    ? TraitTypes<dictionary, item>[dictionary[typeof kind]]
    : never;

export type Value<dictionary extends Dictionary, item> = Trait<
  dictionary,
  ContextValue<dictionary, item>,
  item
>;

export type Dictionary<type_id = unknown> = {
  [kind]: type_id;
};

export interface As<type_id extends PropertyKey> extends Dictionary<type_id> {
  <item>(value: ContextValue<this, item>): Value<this, item>;
}

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

export type DictionaryWrapper<dictionary extends Dictionary> = <item>(
  value: ContextValue<dictionary, item>,
) => Value<dictionary, item>;

export type DictionaryConstructorContext<dictionary extends Dictionary> = {
  readonly as_trait: DictionaryWrapper<dictionary>;
};

export type DictionaryConstructor<dictionary extends Dictionary> = <item>(
  this: DictionaryConstructorContext<dictionary>,
  value: ContextValue<dictionary, item>,
) => Value<dictionary, item>;

export function define<dictionary extends Dictionary>(
  type_id: dictionary[typeof kind],
  construct?: DictionaryConstructor<dictionary>,
): dictionary {
  if (construct === undefined) {
    const target = function <item>(
      value: ContextValue<dictionary, item>,
    ): Value<dictionary, item> {
      return as_trait(value);
    } as unknown as dictionary;

    target[kind] = type_id;
    const as_trait = as_trait_cached(target);

    return target;
  }

  const context: DictionaryConstructorContext<dictionary> = {
    as_trait<item>(value: ContextValue<dictionary, item>) {
      return as_trait(value);
    },
  };
  const target = function <item>(
    value: ContextValue<dictionary, item>,
  ): Value<dictionary, item> {
    return construct.call(context, value) as Value<dictionary, item>;
  } as unknown as dictionary;

  target[kind] = type_id;
  const as_trait = as_trait_cached(target);

  return target;
}

export type TraitDictionary<
  dictionary extends Dictionary,
  token extends PropertyKey,
  methods extends object,
> =
  & Dictionary<dictionary[typeof kind]>
  & { [key in token]: methods }
  & methods;

export function call_trait_method<self, args extends unknown[], out>(
  method: (this: self, ...args: args) => out,
  self: self,
  ...args: args
): out {
  return Reflect.apply(method, self, args) as out;
}

export function implement_trait<implementation extends object>(
  dictionary: object,
  token: PropertyKey,
  implementation: implementation,
): implementation {
  Object.assign(dictionary, implementation);
  (dictionary as { [key: PropertyKey]: unknown })[token] = implementation;

  return implementation;
}

type TraitImplementation<
  token extends PropertyKey,
  dictionary extends { [key in token]: object },
> = dictionary[token];

export type TraitDefinition<token extends PropertyKey = PropertyKey> =
  & TraitDefinitionPrototype<token>
  & {
    readonly token: token;
  };

type TraitDefinitionPrototype<token extends PropertyKey = PropertyKey> = {
  implement<
    dictionary extends Dictionary & { [key in token]: object },
  >(
    this: TraitDefinition<token>,
    dictionary: dictionary,
  ): (
    implementation: TraitImplementation<token, dictionary>,
  ) => TraitImplementation<token, dictionary>;

  implementation<
    receiver extends { [key in token]: object },
  >(
    this: TraitDefinition<token>,
    receiver: receiver,
  ): TraitImplementation<token, receiver>;
};

type TraitMethods<token extends PropertyKey, methods extends object> =
  & methods
  & ThisType<TraitDefinition<token> & methods>;

export function define_trait<token extends PropertyKey, methods extends object>(
  token: token,
  methods: TraitMethods<token, methods>,
): TraitDefinition<token> & methods {
  const definition = Object.assign(
    Object.create(TraitDefinition) as TraitDefinition<token> & methods,
    methods,
  );

  Object.defineProperty(definition, "token", {
    enumerable: true,
    value: token,
  });

  return definition;
}

type TraitDefinitionReceiver<token extends PropertyKey = PropertyKey> = {
  readonly token: token;
};

export const TraitDefinition: TraitDefinitionPrototype = {
  implement<
    token extends PropertyKey,
    dictionary extends Dictionary & { [key in token]: object },
  >(
    this: TraitDefinitionReceiver<token>,
    dictionary: dictionary,
  ): (
    implementation: TraitImplementation<token, dictionary>,
  ) => TraitImplementation<token, dictionary> {
    const token = this.token;

    return (implementation) => {
      return implement_trait(
        dictionary,
        token,
        implementation,
      ) as TraitImplementation<token, dictionary>;
    };
  },

  implementation<
    token extends PropertyKey,
    receiver extends { [key in token]: object },
  >(
    this: TraitDefinitionReceiver<token>,
    receiver: receiver,
  ): TraitImplementation<token, receiver> {
    return receiver[this.token];
  },
};

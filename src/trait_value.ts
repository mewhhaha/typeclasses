const trait_constructor_key = Symbol("Trait.constructor");
const trait_prototype_key = Symbol("Trait.prototype");
const trait_value = Symbol("Trait.value");

declare const do_ap_value: unique symbol;

export type DoApValue = {
  readonly [do_ap_value]: never;
};

export type DoApBinding<item> = item & ((value: DoApValue) => item);

type TraitBase<dictionary, value, item> = {
  readonly [trait_value]: value;
  [Symbol.iterator]: () => Generator<
    Trait<dictionary, value, item>,
    DoApBinding<item>,
    DoApBinding<item>
  >;
  value: () => value;
};

export type Trait<dictionary, value, item = unknown> =
  & TraitBase<dictionary, value, item>
  & dictionary;

type TraitTarget<dictionary, value, item> = {
  [trait_value]: value;
};

type TraitConstructor<dictionary extends object = object> = <
  value,
  item = unknown,
>(
  value: value,
) => Trait<dictionary, value, item>;

type TraitDictionary<dictionary extends object = object> = object & {
  [trait_constructor_key]?: TraitConstructor<dictionary>;
  [trait_prototype_key]?: object;
};

export function trait<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): Trait<dictionary, value, item> {
  const trait_dictionary = dictionary as TraitDictionary<dictionary>;
  let construct_trait = trait_dictionary[trait_constructor_key];

  if (construct_trait === undefined) {
    construct_trait = create_trait_constructor(dictionary, trait_dictionary);
  }

  return construct_trait<value, item>(value);
}

export function trait_constructor<dictionary extends object>(
  dictionary: dictionary,
): <value, item = unknown>(value: value) => Trait<dictionary, value, item> {
  const trait_dictionary = dictionary as TraitDictionary<dictionary>;
  const existing = trait_dictionary[trait_constructor_key];

  if (existing !== undefined) {
    return existing;
  }

  return create_trait_constructor(dictionary, trait_dictionary);
}

function create_trait_constructor<dictionary extends object>(
  dictionary: dictionary,
  trait_dictionary: TraitDictionary<dictionary>,
): TraitConstructor<dictionary> {
  const prototype = trait_prototype(dictionary);

  const construct_trait = function construct_trait<value, item = unknown>(
    value: value,
  ): Trait<dictionary, value, item> {
    const target = Object.create(
      prototype,
    ) as TraitTarget<dictionary, value, item>;

    target[trait_value] = value;

    return target as unknown as Trait<dictionary, value, item>;
  };

  Object.defineProperty(trait_dictionary, trait_constructor_key, {
    value: construct_trait,
  });

  return construct_trait;
}

export function is_trait(
  value: unknown,
): value is Trait<object, unknown, unknown> {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return trait_value in value;
}

function trait_prototype(dictionary: object): object {
  const trait_dictionary = dictionary as TraitDictionary;
  const existing = trait_dictionary[trait_prototype_key];

  if (existing !== undefined) {
    return existing;
  }

  const prototype = Object.create(dictionary);

  Object.defineProperties(prototype, {
    value: {
      value: trait_value_of,
    },
    [Symbol.iterator]: {
      value: trait_iterator,
    },
  });

  Object.defineProperty(trait_dictionary, trait_prototype_key, {
    value: prototype,
  });

  return prototype;
}

function trait_value_of<dictionary, value, item>(
  this: TraitTarget<dictionary, value, item>,
): value {
  return this[trait_value];
}

function* trait_iterator<dictionary, value, item>(
  this: Trait<dictionary, value, item>,
): Generator<
  Trait<dictionary, value, item>,
  DoApBinding<item>,
  DoApBinding<item>
> {
  const item = yield this;
  return item;
}

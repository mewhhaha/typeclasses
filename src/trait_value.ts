const trait_brand: unique symbol = Symbol("Trait.brand");
const trait_dictionary: unique symbol = Symbol("Trait.dictionary");
const trait_value: unique symbol = Symbol("Trait.value");

type TraitBase<dictionary, value, item> = {
  readonly [trait_brand]: true;
  readonly [trait_dictionary]: dictionary;
  readonly [trait_value]: value;
  [Symbol.iterator]: () => Generator<
    Trait<dictionary, value, item>,
    item,
    item
  >;
  value: () => value;
};

export type Trait<dictionary, value, item = unknown> =
  & TraitBase<dictionary, value, item>
  & dictionary;

type TraitTarget<dictionary, value, item> = {
  readonly [trait_brand]: true;
  readonly [trait_dictionary]: dictionary;
  readonly [trait_value]: value;
};

export function trait<dictionary extends object, value, item = unknown>(
  dictionary: dictionary,
  value: value,
): Trait<dictionary, value, item> {
  const target: TraitTarget<dictionary, value, item> = {
    [trait_brand]: true,
    [trait_dictionary]: dictionary,
    [trait_value]: value,
  };

  return new Proxy(target, {
    get(current, property, receiver) {
      if (property === trait_brand) {
        return true;
      }

      if (property === trait_dictionary) {
        return current[trait_dictionary];
      }

      if (property === trait_value) {
        return current[trait_value];
      }

      if (property === "value") {
        return function value() {
          return current[trait_value];
        };
      }

      if (property === Symbol.iterator) {
        return function* iterator(): Generator<
          Trait<dictionary, value, item>,
          item,
          item
        > {
          const item = yield receiver as Trait<dictionary, value, item>;
          return item;
        };
      }

      const dictionary_value = current[trait_dictionary][
        property as keyof dictionary
      ];

      if (typeof dictionary_value !== "function") {
        return dictionary_value;
      }

      return function trait_function(...args: unknown[]) {
        return dictionary_value.call(
          receiver,
          ...args,
        );
      };
    },
  }) as unknown as Trait<dictionary, value, item>;
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

  const candidate = value as { [trait_brand]?: unknown };
  return candidate[trait_brand] === true;
}

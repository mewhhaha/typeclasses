import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";

export const equal_trait = Symbol("Equal");

export interface Equal<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof equal_trait,
    {
      eq: <item>(
        this: Value<dictionary, item>,
        right: Value<dictionary, item>,
      ) => boolean;
    }
  > {}

export const Equal = define_trait(equal_trait, {
  eq<
    dictionary extends Equal<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): boolean {
    return call_trait_method(this.implementation(left).eq<item>, left, right);
  },
});

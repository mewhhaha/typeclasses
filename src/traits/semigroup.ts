import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";

export const semigroup_trait = Symbol("Semigroup");

export interface Semigroup<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof semigroup_trait,
      {
        concat: <item>(
          this: Value<dictionary, item>,
          right: Value<dictionary, item>,
        ) => Value<dictionary, item>;
      }
    > {}

export const Semigroup = define_trait(semigroup_trait, {
  concat<
    dictionary extends Semigroup<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return call_trait_method(
      this.implementation(left).concat<item>,
      left,
      right,
    );
  },
});

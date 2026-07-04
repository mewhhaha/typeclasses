import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";
import {
  Semigroup,
  type Semigroup as SemigroupDictionary,
} from "./semigroup.ts";

export const monoid_trait = Symbol("Monoid");

export interface Monoid<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof monoid_trait,
    {
      empty: <item>(this: Value<dictionary, unknown>) => Value<
        dictionary,
        item
      >;
    }
  >,
  SemigroupDictionary<dictionary> {}

export const Monoid = define_trait(monoid_trait, {
  empty<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
  ): Value<dictionary, item> {
    return call_trait_method(this.implementation(value).empty<item>, value);
  },

  concat<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return Semigroup.concat(left, right);
  },
});

import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";
import { type Applicative as ApplicativeDictionary } from "./applicative.ts";

export const alternative_trait = Symbol("Alternative");

export interface Alternative<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof alternative_trait,
      {
        empty: <item>(this: Value<dictionary, unknown>) => Value<
          dictionary,
          item
        >;
        alt: <item>(
          this: Value<dictionary, item>,
          right: Value<dictionary, item>,
        ) => Value<dictionary, item>;
      }
    >,
    ApplicativeDictionary<dictionary> {}

export const Alternative = define_trait(alternative_trait, {
  empty<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
  ): Value<dictionary, item> {
    return call_trait_method(this.implementation(value).empty<item>, value);
  },

  alt<
    dictionary extends Alternative<dictionary>,
    item,
  >(
    left: Value<dictionary, item>,
    right: Value<dictionary, item>,
  ): Value<dictionary, item> {
    return call_trait_method(this.implementation(left).alt<item>, left, right);
  },
});

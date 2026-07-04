import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";

export const foldable_trait = Symbol("Foldable");

export interface Foldable<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof foldable_trait,
      {
        fold: <item, out>(
          this: Value<dictionary, item>,
          initial: out,
          fn: (state: out, item: item) => out,
        ) => out;
      }
    > {}

export const Foldable = define_trait(foldable_trait, {
  fold<
    dictionary extends Foldable<dictionary>,
    item,
    out,
  >(
    value: Value<dictionary, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    return call_trait_method(
      this.implementation(value).fold<item, out>,
      value,
      initial,
      fn,
    );
  },
});

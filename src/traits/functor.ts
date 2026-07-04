import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";

export const functor_trait = Symbol("Functor");

export interface Functor<dictionary extends Dictionary> extends
  TraitDictionary<
    dictionary,
    typeof functor_trait,
    {
      map: <from, to>(
        this: Value<dictionary, from>,
        fn: (value: from) => to,
      ) => Value<dictionary, to>;
    }
  > {}

export const Functor = define_trait(functor_trait, {
  map<
    dictionary extends Functor<dictionary>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    fn: (value: from) => to,
  ): Value<dictionary, to> {
    return call_trait_method(
      this.implementation(value).map<from, to>,
      value,
      fn,
    );
  },
});

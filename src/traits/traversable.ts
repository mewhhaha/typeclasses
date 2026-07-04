import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";
import { type Applicative as ApplicativeDictionary } from "./applicative.ts";
import { type Foldable as FoldableDictionary } from "./foldable.ts";
import { type Functor as FunctorDictionary } from "./functor.ts";

export const traversable_trait = Symbol("Traversable");

export interface Traversable<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof traversable_trait,
      {
        traverse: <
          applicative extends ApplicativeDictionary<applicative>,
          from,
          to,
        >(
          this: Value<dictionary, from>,
          applicative: Value<applicative, unknown>,
          fn: (value: from) => Value<applicative, to>,
        ) => Value<applicative, Value<dictionary, to>>;
      }
    >,
    FunctorDictionary<dictionary>,
    FoldableDictionary<dictionary> {}

export const Traversable = define_trait(traversable_trait, {
  traverse<
    dictionary extends Traversable<dictionary>,
    applicative extends ApplicativeDictionary<applicative>,
    from,
    to,
  >(
    value: Value<dictionary, from>,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, Value<dictionary, to>> {
    return call_trait_method(
      this.implementation(value).traverse<applicative, from, to>,
      value,
      applicative,
      fn,
    );
  },

  sequence<
    dictionary extends Traversable<dictionary>,
    applicative extends ApplicativeDictionary<applicative>,
    item,
  >(
    value: Value<dictionary, Value<applicative, item>>,
    applicative: Value<applicative, unknown>,
  ): Value<applicative, Value<dictionary, item>> {
    return call_trait_method(
      this.implementation(value)
        .traverse<applicative, Value<applicative, item>, item>,
      value,
      applicative,
      (value: Value<applicative, item>) => {
        return value;
      },
    );
  },
});

import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Applicative as ApplicativeDictionary } from "./applicative.ts";
import type { Foldable as FoldableDictionary } from "./foldable.ts";
import type { Functor as FunctorDictionary } from "./functor.ts";

export const traversable_typeclass = Symbol("Traversable");

export interface Traversable<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof traversable_typeclass,
      {
        traverse: <
          applicative extends ApplicativeDictionary<applicative>,
          from,
          to,
        >(
          this: Data<dictionary, from>,
          applicative: Data<applicative, unknown>,
          fn: (value: from) => Data<applicative, to>,
        ) => Data<applicative, Data<dictionary, to>>;
      }
    >,
    FunctorDictionary<dictionary>,
    FoldableDictionary<dictionary> {}

export const Traversable = typeclass(traversable_typeclass, {
  traverse<
    dictionary extends Traversable<dictionary>,
    applicative extends ApplicativeDictionary<applicative>,
    from,
    to,
  >(
    value: Data<dictionary, from>,
    applicative: Data<applicative, unknown>,
    fn: (value: from) => Data<applicative, to>,
  ): Data<applicative, Data<dictionary, to>> {
    return call_typeclass_method(
      this.instance_for(value).traverse<applicative, from, to>,
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
    value: Data<dictionary, Data<applicative, item>>,
    applicative: Data<applicative, unknown>,
  ): Data<applicative, Data<dictionary, item>> {
    return call_typeclass_method(
      this.instance_for(value)
        .traverse<applicative, Data<applicative, item>, item>,
      value,
      applicative,
      (value: Data<applicative, item>) => {
        return value;
      },
    );
  },
});

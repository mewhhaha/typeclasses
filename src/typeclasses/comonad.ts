import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Functor as FunctorDictionary } from "./functor.ts";

/** Runtime token for the Comonad typeclass. */
export const comonad_typeclass = Symbol("Comonad");

/** Functor dictionary capability for extracting and extending contexts. */
export interface Comonad<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof comonad_typeclass,
      {
        extract: <item>(this: Data<dictionary, item>) => item;
        extend: <from, to>(
          this: Data<dictionary, from>,
          fn: (value: Data<dictionary, from>) => to,
        ) => Data<dictionary, to>;
      }
    >,
    FunctorDictionary<dictionary> {}

/** @ignore */
export type ComonadTypeclass = Typeclass<typeof comonad_typeclass, {
  extract<dictionary extends Comonad<dictionary>, item>(
    value: Data<dictionary, item>,
  ): item;
  extend<dictionary extends Comonad<dictionary>, from, to>(
    value: Data<dictionary, from>,
    fn: (value: Data<dictionary, from>) => to,
  ): Data<dictionary, to>;
}>;

/** Operations for extracting and extending Comonad values. */
export const Comonad: ComonadTypeclass = typeclass(comonad_typeclass, {
  extract<
    dictionary extends Comonad<dictionary>,
    item,
  >(
    value: Data<dictionary, item>,
  ): item {
    return call_typeclass_method(
      this.instance_for(value).extract<item>,
      value,
    );
  },

  extend<
    dictionary extends Comonad<dictionary>,
    from,
    to,
  >(
    value: Data<dictionary, from>,
    fn: (value: Data<dictionary, from>) => to,
  ): Data<dictionary, to> {
    return call_typeclass_method(
      this.instance_for(value).extend<from, to>,
      value,
      fn,
    );
  },
});

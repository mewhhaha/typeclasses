import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Applicative as ApplicativeDictionary } from "./applicative.ts";

export const alternative_typeclass = Symbol("Alternative");

export interface Alternative<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof alternative_typeclass,
      {
        empty: <item>(this: dictionary) => Data<
          dictionary,
          item
        >;
        alt: <item>(
          this: Data<dictionary, item>,
          right: Data<dictionary, item>,
        ) => Data<dictionary, item>;
      }
    >,
    ApplicativeDictionary<dictionary> {}

type AlternativeTypeclass = Typeclass<typeof alternative_typeclass, {
  empty<dictionary extends Alternative<dictionary>, item>(
    witness: Data<dictionary, unknown>,
  ): Data<dictionary, item>;
  empty<dictionary extends Alternative<dictionary>, item>(
    dictionary: Alternative<dictionary>,
  ): Data<dictionary, item>;
  alt<dictionary extends Alternative<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item>;
}>;

export const Alternative: AlternativeTypeclass = typeclass(
  alternative_typeclass,
  {
    empty<
      dictionary extends Alternative<dictionary>,
      item,
    >(
      witness: dictionary | Data<dictionary, unknown>,
    ): Data<dictionary, item> {
      return call_typeclass_method(
        this.instance_for(witness).empty<item>,
        witness as dictionary,
      );
    },

    alt<
      dictionary extends Alternative<dictionary>,
      item,
    >(
      left: Data<dictionary, item>,
      right: Data<dictionary, item>,
    ): Data<dictionary, item> {
      return call_typeclass_method(
        this.instance_for(left).alt<item>,
        left,
        right,
      );
    },
  },
);

import {
  type Data,
  type Dictionary,
  instance_for_token,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type { Applicative as ApplicativeDictionary } from "./applicative.ts";

/** Runtime token for the Alternative typeclass. */
export const alternative_typeclass = /* @__PURE__ */ Symbol("Alternative");

/** Applicative dictionary capability with empty and choice operations. */
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

/** @ignore */
export type AlternativeTypeclass = Typeclass<typeof alternative_typeclass, {
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

/** Operations for empty values and left-biased contextual choice. */
export const Alternative: AlternativeTypeclass = /* @__PURE__ */ typeclass(
  alternative_typeclass,
  {
    empty<
      dictionary extends Alternative<dictionary>,
      item,
    >(
      witness: dictionary | Data<dictionary, unknown>,
    ): Data<dictionary, item> {
      return (instance_for_token(alternative_typeclass, witness)
        .empty<item>).call(witness as dictionary);
    },

    alt<
      dictionary extends Alternative<dictionary>,
      item,
    >(
      left: Data<dictionary, item>,
      right: Data<dictionary, item>,
    ): Data<dictionary, item> {
      return (instance_for_token(alternative_typeclass, left)
        .alt<item>).call(left, right);
    },
  },
);

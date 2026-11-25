import {
  type Data,
  type Dictionary,
  instance_for_token,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import {
  type Semigroup as SemigroupDictionary,
  semigroup_typeclass,
} from "./semigroup.ts";

/** Runtime token for the Monoid typeclass. */
export const monoid_typeclass = /* @__PURE__ */ Symbol("Monoid");

/** Semigroup dictionary capability with an identity value. */
export interface Monoid<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof monoid_typeclass,
      {
        empty: <item>(this: dictionary) => Data<
          dictionary,
          item
        >;
      }
    >,
    SemigroupDictionary<dictionary> {}

/** @ignore */
export type MonoidTypeclass = Typeclass<typeof monoid_typeclass, {
  empty<dictionary extends Monoid<dictionary>, item>(
    witness: Data<dictionary, unknown>,
  ): Data<dictionary, item>;
  empty<dictionary extends Monoid<dictionary>, item>(
    dictionary: Monoid<dictionary>,
  ): Data<dictionary, item>;
  concat<dictionary extends Monoid<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item>;
}>;

/** Operations for identity values and monoidal concatenation. */
export const Monoid: MonoidTypeclass = /* @__PURE__ */ typeclass(
  monoid_typeclass,
  {
    empty<
      dictionary extends Monoid<dictionary>,
      item,
    >(
      witness: dictionary | Data<dictionary, unknown>,
    ): Data<dictionary, item> {
      return (instance_for_token(monoid_typeclass, witness).empty<item>).call(
        witness as dictionary,
      );
    },

    concat<
      dictionary extends Monoid<dictionary>,
      item,
    >(
      left: Data<dictionary, item>,
      right: Data<dictionary, item>,
    ): Data<dictionary, item> {
      return (instance_for_token(semigroup_typeclass, left)
        .concat<item>).call(left, right);
    },
  },
);

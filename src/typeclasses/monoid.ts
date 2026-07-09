import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import {
  Semigroup,
  type Semigroup as SemigroupDictionary,
} from "./semigroup.ts";

export const monoid_typeclass = Symbol("Monoid");

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

type MonoidTypeclass = Typeclass<typeof monoid_typeclass, {
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

export const Monoid: MonoidTypeclass = typeclass(monoid_typeclass, {
  empty<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    witness: dictionary | Data<dictionary, unknown>,
  ): Data<dictionary, item> {
    return call_typeclass_method(
      this.instance_for(witness).empty<item>,
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
    return Semigroup.concat(left, right);
  },
});

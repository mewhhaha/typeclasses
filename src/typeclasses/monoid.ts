import {
  call_typeclass_method,
  type Data,
  type Dictionary,
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
        empty: <item>(this: Data<dictionary, unknown>) => Data<
          dictionary,
          item
        >;
      }
    >,
    SemigroupDictionary<dictionary> {}

export const Monoid = typeclass(monoid_typeclass, {
  empty<
    dictionary extends Monoid<dictionary>,
    item,
  >(
    value: Data<dictionary, unknown>,
  ): Data<dictionary, item> {
    return call_typeclass_method(this.instance_for(value).empty<item>, value);
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

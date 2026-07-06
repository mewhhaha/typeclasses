import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const semigroup_typeclass = Symbol("Semigroup");

export interface Semigroup<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof semigroup_typeclass,
      {
        concat: <item>(
          this: Data<dictionary, item>,
          right: Data<dictionary, item>,
        ) => Data<dictionary, item>;
      }
    > {}

type SemigroupTypeclass = Typeclass<typeof semigroup_typeclass, {
  concat<dictionary extends Semigroup<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item>;
}>;

export const Semigroup: SemigroupTypeclass = typeclass(semigroup_typeclass, {
  concat<
    dictionary extends Semigroup<dictionary>,
    item,
  >(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): Data<dictionary, item> {
    return call_typeclass_method(
      this.instance_for(left).concat<item>,
      left,
      right,
    );
  },
});

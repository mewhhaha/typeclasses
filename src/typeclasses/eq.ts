import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Eq typeclass. */
export const eq_typeclass = Symbol("Eq");

/** Dictionary capability for equality comparisons. */
export interface Eq<dictionary extends Dictionary> extends
  TypeclassDictionary<
    dictionary,
    typeof eq_typeclass,
    {
      eq: <item>(
        this: Data<dictionary, item>,
        right: Data<dictionary, item>,
      ) => boolean;
    }
  > {}

/** @ignore */
export type EqTypeclass = Typeclass<typeof eq_typeclass, {
  eq<dictionary extends Eq<dictionary>, item>(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean;
}>;

/** Operations for comparing values through their Eq dictionaries. */
export const Eq: EqTypeclass = typeclass(eq_typeclass, {
  eq<
    dictionary extends Eq<dictionary>,
    item,
  >(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return call_typeclass_method(this.instance_for(left).eq<item>, left, right);
  },
});

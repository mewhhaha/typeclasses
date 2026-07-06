import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const eq_typeclass = Symbol("Eq");

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

export const Eq = typeclass(eq_typeclass, {
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

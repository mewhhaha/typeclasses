import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const show_typeclass = Symbol("Show");

export interface Show<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof show_typeclass,
      {
        show: (this: Data<dictionary, unknown>) => string;
      }
    > {}

export const Show = typeclass(show_typeclass, {
  show<dictionary extends Show<dictionary>>(
    value: Data<dictionary, unknown>,
  ): string {
    return call_typeclass_method(this.instance_for(value).show, value);
  },
});

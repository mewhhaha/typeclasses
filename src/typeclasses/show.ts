import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Show typeclass. */
export const show_typeclass = Symbol("Show");

/** Dictionary capability for rendering contextual values. */
export interface Show<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof show_typeclass,
      {
        show: (this: Data<dictionary, unknown>) => string;
      }
    > {}

/** @ignore */
export type ShowTypeclass = Typeclass<typeof show_typeclass, {
  show<dictionary extends Show<dictionary>>(
    value: Data<dictionary, unknown>,
  ): string;
}>;

/** Operations for rendering values through their Show dictionaries. */
export const Show: ShowTypeclass = typeclass(show_typeclass, {
  show<dictionary extends Show<dictionary>>(
    value: Data<dictionary, unknown>,
  ): string {
    return call_typeclass_method(this.instance_for(value).show, value);
  },
});

import {
  type Data,
  type Dictionary,
  instance_for_token,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Show typeclass. */
export const show_typeclass = /* @__PURE__ */ Symbol("Show");

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
export const Show: ShowTypeclass = /* @__PURE__ */ typeclass(show_typeclass, {
  show<dictionary extends Show<dictionary>>(
    value: Data<dictionary, unknown>,
  ): string {
    return instance_for_token(show_typeclass, value).show.call(value);
  },
});

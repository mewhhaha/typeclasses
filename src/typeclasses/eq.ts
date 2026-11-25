import {
  type Data,
  type Dictionary,
  instance_for_token,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Eq typeclass. */
export const eq_typeclass = /* @__PURE__ */ Symbol("Eq");

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
export const Eq: EqTypeclass = /* @__PURE__ */ typeclass(eq_typeclass, {
  eq<
    dictionary extends Eq<dictionary>,
    item,
  >(
    left: Data<dictionary, item>,
    right: Data<dictionary, item>,
  ): boolean {
    return (instance_for_token(eq_typeclass, left).eq<item>).call(left, right);
  },
});

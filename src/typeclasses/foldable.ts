import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Foldable typeclass. */
export const foldable_typeclass = Symbol("Foldable");

/** Dictionary capability for reducing contextual values. */
export interface Foldable<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof foldable_typeclass,
      {
        fold: <item, result>(
          this: Data<dictionary, item>,
          initial: result,
          fn: (state: result, item: item) => result,
        ) => result;
      }
    > {}

/** @ignore */
export type FoldableTypeclass = Typeclass<typeof foldable_typeclass, {
  fold<dictionary extends Foldable<dictionary>, item, result>(
    value: Data<dictionary, item>,
    initial: result,
    fn: (state: result, item: item) => result,
  ): result;
}>;

/** Operations for reducing values through Foldable dictionaries. */
export const Foldable: FoldableTypeclass = typeclass(foldable_typeclass, {
  fold<
    dictionary extends Foldable<dictionary>,
    item,
    result,
  >(
    value: Data<dictionary, item>,
    initial: result,
    fn: (state: result, item: item) => result,
  ): result {
    return call_typeclass_method(
      this.instance_for(value).fold<item, result>,
      value,
      initial,
      fn,
    );
  },
});

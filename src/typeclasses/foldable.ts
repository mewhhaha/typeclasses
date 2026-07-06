import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const foldable_typeclass = Symbol("Foldable");

export interface Foldable<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof foldable_typeclass,
      {
        fold: <item, out>(
          this: Data<dictionary, item>,
          initial: out,
          fn: (state: out, item: item) => out,
        ) => out;
      }
    > {}

type FoldableTypeclass = Typeclass<typeof foldable_typeclass, {
  fold<dictionary extends Foldable<dictionary>, item, out>(
    value: Data<dictionary, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out;
}>;

export const Foldable: FoldableTypeclass = typeclass(foldable_typeclass, {
  fold<
    dictionary extends Foldable<dictionary>,
    item,
    out,
  >(
    value: Data<dictionary, item>,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    return call_typeclass_method(
      this.instance_for(value).fold<item, out>,
      value,
      initial,
      fn,
    );
  },
});

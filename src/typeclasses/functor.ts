import {
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Functor typeclass. */
export const functor_typeclass = /* @__PURE__ */ Symbol("Functor");

/** Dictionary capability for mapping contextual values. */
export interface Functor<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof functor_typeclass,
      {
        map: <from, to>(
          this: Data<dictionary, from>,
          fn: (value: from) => to,
        ) => Data<dictionary, to>;
      }
    > {}

/** @ignore */
export type FunctorTypeclass = Typeclass<typeof functor_typeclass, {
  map<dictionary extends Functor<dictionary>, from, to>(
    value: Data<dictionary, from>,
    fn: (value: from) => to,
  ): Data<dictionary, to>;
}>;

/** Operations for mapping values through Functor dictionaries. */
export const Functor: FunctorTypeclass = /* @__PURE__ */ typeclass(
  functor_typeclass,
  {
    map<
      dictionary extends Functor<dictionary>,
      from,
      to,
    >(
      value: Data<dictionary, from>,
      fn: (value: from) => to,
    ): Data<dictionary, to> {
      // The normal path needs one dictionary lookup and one call. Keep the
      // descriptive missing-instance error on the cold path.
      let implementation = value[functor_typeclass];
      if (implementation === undefined) {
        implementation = this.instance_for(value);
      }
      return (implementation.map<from, to>).call(value, fn);
    },
  },
);

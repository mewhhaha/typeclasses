import {
  type Data,
  type Dictionary,
  instance_for_token,
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
      return functor_map(value, fn);
    },
  },
);

/** @ignore Mapping primitive for implementations that do not need the whole definition. */
export function functor_map<dictionary extends Functor<dictionary>, from, to>(
  value: Data<dictionary, from>,
  fn: (value: from) => to,
): Data<dictionary, to> {
  return (instance_for_token(functor_typeclass, value).map<from, to>).call(
    value,
    fn,
  );
}

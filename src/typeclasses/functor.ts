import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const functor_typeclass = Symbol("Functor");

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

type FunctorTypeclass = Typeclass<typeof functor_typeclass, {
  map<dictionary extends Functor<dictionary>, from, to>(
    value: Data<dictionary, from>,
    fn: (value: from) => to,
  ): Data<dictionary, to>;
}>;

export const Functor: FunctorTypeclass = typeclass(functor_typeclass, {
  map<
    dictionary extends Functor<dictionary>,
    from,
    to,
  >(
    value: Data<dictionary, from>,
    fn: (value: from) => to,
  ): Data<dictionary, to> {
    return call_typeclass_method(
      this.instance_for(value).map<from, to>,
      value,
      fn,
    );
  },
});

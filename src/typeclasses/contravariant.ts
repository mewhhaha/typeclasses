import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const contravariant_typeclass = Symbol("Contravariant");

export interface Contravariant<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof contravariant_typeclass,
      {
        contramap: <from, to>(
          this: Data<dictionary, from>,
          fn: (value: to) => from,
        ) => Data<dictionary, to>;
      }
    > {}

type ContravariantTypeclass = Typeclass<typeof contravariant_typeclass, {
  contramap<dictionary extends Contravariant<dictionary>, from, to>(
    value: Data<dictionary, from>,
    fn: (value: to) => from,
  ): Data<dictionary, to>;
}>;

export const Contravariant: ContravariantTypeclass = typeclass(
  contravariant_typeclass,
  {
    contramap<
      dictionary extends Contravariant<dictionary>,
      from,
      to,
    >(
      value: Data<dictionary, from>,
      fn: (value: to) => from,
    ): Data<dictionary, to> {
      return call_typeclass_method(
        this.instance_for(value).contramap<from, to>,
        value,
        fn,
      );
    },
  },
);

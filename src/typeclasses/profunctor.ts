import {
  call_typeclass_method,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
  type WrappedData,
} from "../typeclass.ts";

export const profunctor_typeclass = Symbol("Profunctor");

export interface Profunctor<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof profunctor_typeclass,
      {
        dimap: <raw, from, to, next_from, next_to>(
          this: WrappedData<dictionary, raw, to>,
          input: (value: next_from) => from,
          output: (value: to) => next_to,
        ) => WrappedData<dictionary, unknown, next_to>;
      }
    > {}

export const Profunctor = typeclass(profunctor_typeclass, {
  dimap<
    dictionary extends Profunctor<dictionary>,
    raw,
    from,
    to,
    next_from,
    next_to,
  >(
    value: WrappedData<dictionary, raw, to>,
    input: (value: next_from) => from,
    output: (value: to) => next_to,
  ): WrappedData<dictionary, unknown, next_to> {
    return call_typeclass_method(
      this.instance_for(value).dimap<raw, from, to, next_from, next_to>,
      value,
      input,
      output,
    );
  },

  lmap<
    dictionary extends Profunctor<dictionary>,
    raw,
    from,
    to,
    next_from,
  >(
    value: WrappedData<dictionary, raw, to>,
    input: (value: next_from) => from,
  ): WrappedData<dictionary, unknown, to> {
    return this.dimap(value, input, identity);
  },

  rmap<
    dictionary extends Profunctor<dictionary>,
    raw,
    from,
    to,
    next_to,
  >(
    value: WrappedData<dictionary, raw, to>,
    output: (value: to) => next_to,
  ): WrappedData<dictionary, unknown, next_to> {
    return this.dimap(value, identity<from>, output);
  },
});

function identity<item>(value: item): item {
  return value;
}

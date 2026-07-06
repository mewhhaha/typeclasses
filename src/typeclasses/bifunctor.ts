import {
  call_typeclass_method,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
  type WrappedData,
} from "../typeclass.ts";

export const bifunctor_typeclass = Symbol("Bifunctor");

export interface Bifunctor<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof bifunctor_typeclass,
      {
        bimap: <raw, left, right, next_left, next_right>(
          this: WrappedData<dictionary, raw, right>,
          left: (value: left) => next_left,
          right: (value: right) => next_right,
        ) => WrappedData<dictionary, unknown, next_right>;
      }
    > {}

export const Bifunctor = typeclass(bifunctor_typeclass, {
  bimap<
    dictionary extends Bifunctor<dictionary>,
    raw,
    left,
    right,
    next_left,
    next_right,
  >(
    value: WrappedData<dictionary, raw, right>,
    left: (value: left) => next_left,
    right: (value: right) => next_right,
  ): WrappedData<dictionary, unknown, next_right> {
    return call_typeclass_method(
      this.instance_for(value).bimap<
        raw,
        left,
        right,
        next_left,
        next_right
      >,
      value,
      left,
      right,
    );
  },

  map_left<
    dictionary extends Bifunctor<dictionary>,
    raw,
    left,
    right,
    next_left,
  >(
    value: WrappedData<dictionary, raw, right>,
    fn: (value: left) => next_left,
  ): WrappedData<dictionary, unknown, right> {
    return this.bimap(value, fn, identity);
  },
});

function identity<item>(value: item): item {
  return value;
}

import {
  type AppliedData,
  call_typeclass_method,
  type Data,
  type DataType,
  type Dictionary,
  type type_data,
  type type_item,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

export const bifunctor_typeclass = Symbol("Bifunctor");
export declare const bifunctor_left: unique symbol;
export declare const bifunctor_context: unique symbol;

export interface BifunctorContext extends DataType {
  readonly [type_data]: Dictionary;
}

type SameBifunctorContext<dictionary extends Dictionary> = {
  readonly [type_item]: unknown;
  readonly [type_data]: dictionary;
};

type BifunctorDefinition = Dictionary & {
  readonly [bifunctor_left]: unknown;
  readonly [bifunctor_context]: BifunctorContext;
  readonly [bifunctor_typeclass]: object;
};

type BifunctorLeft<dictionary extends BifunctorDefinition> =
  dictionary[typeof bifunctor_left];

type BifunctorContextOf<dictionary extends BifunctorDefinition> =
  dictionary[typeof bifunctor_context];

type BifunctorImplementation<dictionary extends BifunctorDefinition> = {
  bimap: <right, next_left, next_right>(
    this: Data<dictionary, right>,
    left: (value: BifunctorLeft<dictionary>) => next_left,
    right: (value: right) => next_right,
  ) => Data<
    AppliedData<BifunctorContextOf<dictionary>, next_left>,
    next_right
  >;
};

export interface Bifunctor<
  dictionary extends Dictionary,
  left = unknown,
  context extends BifunctorContext = SameBifunctorContext<dictionary>,
> extends
  TypeclassDictionary<
    dictionary,
    typeof bifunctor_typeclass,
    {
      bimap: <right, next_left, next_right>(
        this: Data<dictionary, right>,
        left: (value: left) => next_left,
        right: (value: right) => next_right,
      ) => Data<AppliedData<context, next_left>, next_right>;
    }
  > {
  readonly [bifunctor_left]: left;
  readonly [bifunctor_context]: context;
}

type BifunctorTypeclass = Typeclass<typeof bifunctor_typeclass, {
  bimap<
    dictionary extends BifunctorDefinition,
    right,
    next_left,
    next_right,
  >(
    value: Data<dictionary, right>,
    left: (value: BifunctorLeft<dictionary>) => next_left,
    right: (value: right) => next_right,
  ): Data<
    AppliedData<BifunctorContextOf<dictionary>, next_left>,
    next_right
  >;
  map_left<dictionary extends BifunctorDefinition, right, next_left>(
    value: Data<dictionary, right>,
    fn: (value: BifunctorLeft<dictionary>) => next_left,
  ): Data<AppliedData<BifunctorContextOf<dictionary>, next_left>, right>;
}>;

export const Bifunctor: BifunctorTypeclass = typeclass(
  bifunctor_typeclass,
  {
    bimap<
      dictionary extends BifunctorDefinition,
      right,
      next_left,
      next_right,
    >(
      value: Data<dictionary, right>,
      left: (value: BifunctorLeft<dictionary>) => next_left,
      right: (value: right) => next_right,
    ): Data<
      AppliedData<BifunctorContextOf<dictionary>, next_left>,
      next_right
    > {
      const implementation =
        value[bifunctor_typeclass] as unknown as BifunctorImplementation<
          dictionary
        >;

      return call_typeclass_method(
        implementation.bimap<right, next_left, next_right>,
        value,
        left,
        right,
      );
    },

    map_left<dictionary extends BifunctorDefinition, right, next_left>(
      value: Data<dictionary, right>,
      fn: (value: BifunctorLeft<dictionary>) => next_left,
    ): Data<AppliedData<BifunctorContextOf<dictionary>, next_left>, right> {
      return this.bimap(value, fn, identity);
    },
  },
);

function identity<item>(value: item): item {
  return value;
}

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

/** Runtime token for the Bifunctor typeclass. */
export const bifunctor_typeclass = Symbol("Bifunctor");
/** Phantom key for a bifunctor's fixed left parameter. */
export declare const bifunctor_left: unique symbol;
/** Phantom key for rebuilding a bifunctor after mapping its left parameter. */
export declare const bifunctor_context: unique symbol;

/** Higher-kinded context used to rebuild a bifunctor dictionary. */
export interface BifunctorContext extends DataType {
  /** Dictionary produced for the substituted left parameter. */
  readonly [type_data]: Dictionary;
}

/** @ignore */
export type SameBifunctorContext<dictionary extends Dictionary> = {
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

/** Dictionary capability for mapping both parameters of a context. */
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
  /** Fixed left parameter carried by this dictionary. */
  readonly [bifunctor_left]: left;
  /** Context used when the left parameter changes. */
  readonly [bifunctor_context]: context;
}

/** @ignore */
export type BifunctorTypeclass = Typeclass<typeof bifunctor_typeclass, {
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

/** Operations for mapping both sides of Bifunctor values. */
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

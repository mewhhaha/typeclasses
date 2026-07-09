import {
  type AppliedData,
  call_typeclass_method,
  type Data,
  type Dictionary,
  type type_data,
  type type_item,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import type {
  Category as CategoryDictionary,
  CategoryContext,
  CategoryContextOf,
  CategoryDefinition,
  CategoryInput,
} from "./category.ts";

export const arrow_typeclass = Symbol("Arrow");

export interface ArrowContext extends CategoryContext {}

type SameArrowContext<dictionary extends Dictionary> = {
  readonly [type_item]: unknown;
  readonly [type_data]: dictionary;
};

type ArrowDefinition = CategoryDefinition & {
  readonly [arrow_typeclass]: object;
};

type ArrowImplementation<dictionary extends ArrowDefinition> = {
  arr: <from, to>(
    this: dictionary,
    fn: (value: from) => to,
  ) => Data<AppliedData<CategoryContextOf<dictionary>, from>, to>;
  first: <to, extra>(
    this: Data<dictionary, to>,
  ) => Data<
    AppliedData<
      CategoryContextOf<dictionary>,
      readonly [CategoryInput<dictionary>, extra]
    >,
    readonly [to, extra]
  >;
  second: <to, extra>(
    this: Data<dictionary, to>,
  ) => Data<
    AppliedData<
      CategoryContextOf<dictionary>,
      readonly [extra, CategoryInput<dictionary>]
    >,
    readonly [extra, to]
  >;
};

export interface Arrow<
  dictionary extends Dictionary,
  input = unknown,
  context extends ArrowContext = SameArrowContext<dictionary>,
> extends
  TypeclassDictionary<
    dictionary,
    typeof arrow_typeclass,
    {
      arr: <from, to>(
        this: dictionary,
        fn: (value: from) => to,
      ) => Data<AppliedData<context, from>, to>;
      first: <to, extra>(
        this: Data<dictionary, to>,
      ) => Data<
        AppliedData<context, readonly [input, extra]>,
        readonly [to, extra]
      >;
      second: <to, extra>(
        this: Data<dictionary, to>,
      ) => Data<
        AppliedData<context, readonly [extra, input]>,
        readonly [extra, to]
      >;
    }
  >,
  CategoryDictionary<dictionary, input, context> {}

type ArrowTypeclass = Typeclass<typeof arrow_typeclass, {
  arr<dictionary extends ArrowDefinition, from, to>(
    dictionary: dictionary,
    fn: (value: from) => to,
  ): Data<AppliedData<CategoryContextOf<dictionary>, from>, to>;
  first<dictionary extends ArrowDefinition, to, extra>(
    arrow: Data<dictionary, to>,
  ): Data<
    AppliedData<
      CategoryContextOf<dictionary>,
      readonly [CategoryInput<dictionary>, extra]
    >,
    readonly [to, extra]
  >;
  second<dictionary extends ArrowDefinition, to, extra>(
    arrow: Data<dictionary, to>,
  ): Data<
    AppliedData<
      CategoryContextOf<dictionary>,
      readonly [extra, CategoryInput<dictionary>]
    >,
    readonly [extra, to]
  >;
}>;

export const Arrow: ArrowTypeclass = typeclass(arrow_typeclass, {
  arr<dictionary extends ArrowDefinition, from, to>(
    dictionary: dictionary,
    fn: (value: from) => to,
  ): Data<AppliedData<CategoryContextOf<dictionary>, from>, to> {
    const implementation =
      dictionary[arrow_typeclass] as unknown as ArrowImplementation<dictionary>;

    return call_typeclass_method(
      implementation.arr<from, to>,
      dictionary,
      fn,
    );
  },

  first<dictionary extends ArrowDefinition, to, extra>(
    arrow: Data<dictionary, to>,
  ): Data<
    AppliedData<
      CategoryContextOf<dictionary>,
      readonly [CategoryInput<dictionary>, extra]
    >,
    readonly [to, extra]
  > {
    const implementation =
      arrow[arrow_typeclass] as unknown as ArrowImplementation<dictionary>;

    return call_typeclass_method(
      implementation.first<to, extra>,
      arrow,
    );
  },

  second<dictionary extends ArrowDefinition, to, extra>(
    arrow: Data<dictionary, to>,
  ): Data<
    AppliedData<
      CategoryContextOf<dictionary>,
      readonly [extra, CategoryInput<dictionary>]
    >,
    readonly [extra, to]
  > {
    const implementation =
      arrow[arrow_typeclass] as unknown as ArrowImplementation<dictionary>;

    return call_typeclass_method(
      implementation.second<to, extra>,
      arrow,
    );
  },
});

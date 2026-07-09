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

export const category_typeclass = Symbol("Category");
export declare const category_input: unique symbol;
export declare const category_context: unique symbol;

export interface CategoryContext extends DataType {
  readonly [type_data]: Dictionary;
}

type SameCategoryContext<dictionary extends Dictionary> = {
  readonly [type_item]: unknown;
  readonly [type_data]: dictionary;
};

export type CategoryDefinition = Dictionary & {
  readonly [category_input]: unknown;
  readonly [category_context]: CategoryContext;
  readonly [category_typeclass]: object;
};

export type CategoryInput<dictionary extends CategoryDefinition> =
  dictionary[typeof category_input];

export type CategoryContextOf<dictionary extends CategoryDefinition> =
  dictionary[typeof category_context];

type CategoryImplementation<dictionary extends CategoryDefinition> = {
  id: <item>(
    this: dictionary,
  ) => Data<AppliedData<CategoryContextOf<dictionary>, item>, item>;
  compose: <to, next_input>(
    this: Data<dictionary, to>,
    before: Data<
      AppliedData<CategoryContextOf<dictionary>, next_input>,
      CategoryInput<dictionary>
    >,
  ) => Data<AppliedData<CategoryContextOf<dictionary>, next_input>, to>;
};

type InCategoryContext<
  dictionary extends CategoryDefinition,
  member extends CategoryDefinition,
> = member extends AppliedData<
  CategoryContextOf<dictionary>,
  CategoryInput<member>
> ? unknown
  : never;

export interface Category<
  dictionary extends Dictionary,
  input = unknown,
  context extends CategoryContext = SameCategoryContext<dictionary>,
> extends
  TypeclassDictionary<
    dictionary,
    typeof category_typeclass,
    {
      id: <item>(
        this: dictionary,
      ) => Data<AppliedData<context, item>, item>;
      compose: <to, next_input>(
        this: Data<dictionary, to>,
        before: Data<AppliedData<context, next_input>, input>,
      ) => Data<AppliedData<context, next_input>, to>;
    }
  > {
  readonly [category_input]: input;
  readonly [category_context]: context;
}

type CategoryTypeclass = Typeclass<typeof category_typeclass, {
  id<dictionary extends CategoryDefinition, item>(
    dictionary: dictionary,
  ): Data<AppliedData<CategoryContextOf<dictionary>, item>, item>;
  compose<
    dictionary extends CategoryDefinition,
    before_dictionary extends CategoryDefinition,
    to,
  >(
    after: Data<dictionary, to>,
    before:
      & Data<before_dictionary, CategoryInput<dictionary>>
      & InCategoryContext<dictionary, before_dictionary>,
  ): Data<before_dictionary, to>;
}>;

export const Category: CategoryTypeclass = typeclass(category_typeclass, {
  id<dictionary extends CategoryDefinition, item>(
    dictionary: dictionary,
  ): Data<AppliedData<CategoryContextOf<dictionary>, item>, item> {
    const implementation =
      dictionary[category_typeclass] as unknown as CategoryImplementation<
        dictionary
      >;

    return call_typeclass_method(
      implementation.id<item>,
      dictionary,
    );
  },

  compose<
    dictionary extends CategoryDefinition,
    before_dictionary extends CategoryDefinition,
    to,
  >(
    after: Data<dictionary, to>,
    before:
      & Data<before_dictionary, CategoryInput<dictionary>>
      & InCategoryContext<dictionary, before_dictionary>,
  ): Data<before_dictionary, to> {
    const implementation =
      after[category_typeclass] as unknown as CategoryImplementation<
        dictionary
      >;

    return call_typeclass_method(
      implementation.compose<to, CategoryInput<before_dictionary>>,
      after,
      before as unknown as Data<
        AppliedData<
          CategoryContextOf<dictionary>,
          CategoryInput<before_dictionary>
        >,
        CategoryInput<dictionary>
      >,
    ) as unknown as Data<before_dictionary, to>;
  },
});

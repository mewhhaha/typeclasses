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

/** Runtime token for the Category typeclass. */
export const category_typeclass = Symbol("Category");
/** Phantom key for a category arrow's input parameter. */
export declare const category_input: unique symbol;
/** Phantom key for rebuilding category arrows with new inputs. */
export declare const category_context: unique symbol;

/** Higher-kinded context used to rebuild a category dictionary. */
export interface CategoryContext extends DataType {
  /** Dictionary produced for the substituted input parameter. */
  readonly [type_data]: Dictionary;
}

/** @ignore */
export type SameCategoryContext<dictionary extends Dictionary> = {
  readonly [type_item]: unknown;
  readonly [type_data]: dictionary;
};

/** Structural definition shared by category dictionaries. */
export type CategoryDefinition = Dictionary & {
  readonly [category_input]: unknown;
  readonly [category_context]: CategoryContext;
  readonly [category_typeclass]: object;
};

/** Extract the input parameter associated with a category dictionary. */
export type CategoryInput<dictionary extends CategoryDefinition> =
  dictionary[typeof category_input];

/** Extract the rebuilding context associated with a category dictionary. */
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

/** Dictionary capability for identity arrows and composition. */
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
  /** Input parameter carried by this arrow dictionary. */
  readonly [category_input]: input;
  /** Context used when composing arrows with different inputs. */
  readonly [category_context]: context;
}

/** @ignore */
export type CategoryTypeclass = Typeclass<typeof category_typeclass, {
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

/** Operations for category identities and arrow composition. */
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

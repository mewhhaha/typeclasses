import {
  call_typeclass_method,
  type Dictionary,
  typeclass,
  type TypeclassDictionary,
  type WrappedData,
} from "../typeclass.ts";

export const category_typeclass = Symbol("Category");

export interface Category<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof category_typeclass,
      {
        id: <item>(this: dictionary) => WrappedData<dictionary, unknown, item>;
        compose: <after_raw, before_raw, from, middle, to>(
          this: WrappedData<dictionary, after_raw, to>,
          before: WrappedData<dictionary, before_raw, middle>,
        ) => WrappedData<dictionary, unknown, to>;
      }
    > {}

export const Category = typeclass(category_typeclass, {
  id<
    dictionary extends Category<dictionary>,
    item,
  >(
    dictionary: dictionary,
  ): WrappedData<dictionary, unknown, item> {
    return call_typeclass_method(
      this.instance_for(dictionary).id<item>,
      dictionary,
    );
  },

  compose<
    dictionary extends Category<dictionary>,
    after_raw,
    before_raw,
    from,
    middle,
    to,
  >(
    after: WrappedData<dictionary, after_raw, to>,
    before: WrappedData<dictionary, before_raw, middle>,
  ): WrappedData<dictionary, unknown, to> {
    return call_typeclass_method(
      this.instance_for(after).compose<
        after_raw,
        before_raw,
        from,
        middle,
        to
      >,
      after,
      before,
    );
  },
});

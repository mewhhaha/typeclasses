import {
  call_typeclass_method,
  type Data,
  type DataItem,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";

/** Runtime token for the Foldable typeclass. */
export const foldable_typeclass = /* @__PURE__ */ Symbol("Foldable");
/** @ignore Optional resource-aware short-circuit implementation. */
export const fold_while_method = /* @__PURE__ */ Symbol("Foldable.fold_while");

/** @ignore Direct predicate hooks avoid control tuples on collection instances. */
export const some_method = /* @__PURE__ */ Symbol("Foldable.some");
/** @ignore */
export const find_method = /* @__PURE__ */ Symbol("Foldable.find");

/** Dictionary capability for reducing contextual values. */
export interface Foldable<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof foldable_typeclass,
      {
        fold: <item, result>(
          this: Data<dictionary, item>,
          initial: result,
          fn: (state: result, item: DataItem<dictionary, item>) => result,
        ) => result;
        [some_method]?: <item>(
          this: Data<dictionary, item>,
          predicate: (item: DataItem<dictionary, item>) => boolean,
        ) => boolean;
        [find_method]?: <item>(
          this: Data<dictionary, item>,
          predicate: (item: DataItem<dictionary, item>) => boolean,
        ) => DataItem<dictionary, item> | undefined;
        [fold_while_method]?: <item, result>(
          this: Data<dictionary, item>,
          initial: result,
          fn: (
            state: result,
            item: DataItem<dictionary, item>,
          ) => FoldStep<result>,
        ) => result;
      }
    > {}

/** A reduction step that either continues or immediately returns its state. */
export type FoldStep<state> = readonly ["Continue" | "Done", state];

/** @ignore */
export type FoldableTypeclass = Typeclass<typeof foldable_typeclass, {
  fold<dictionary extends Foldable<dictionary>, item, result>(
    value: Data<dictionary, item>,
    initial: result,
    fn: (state: result, item: DataItem<dictionary, item>) => result,
  ): result;
  fold_while<dictionary extends Foldable<dictionary>, item, result>(
    value: Data<dictionary, item>,
    initial: result,
    fn: (state: result, item: DataItem<dictionary, item>) => FoldStep<result>,
  ): result;
  some<dictionary extends Foldable<dictionary>, item>(
    value: Data<dictionary, item>,
    predicate: (item: DataItem<dictionary, item>) => boolean,
  ): boolean;
  find<dictionary extends Foldable<dictionary>, item>(
    value: Data<dictionary, item>,
    predicate: (item: DataItem<dictionary, item>) => boolean,
  ): DataItem<dictionary, item> | undefined;
}>;

/** Operations for reducing values through Foldable dictionaries. */
export const Foldable: FoldableTypeclass = /* @__PURE__ */ typeclass(
  foldable_typeclass,
  {
    fold<dictionary extends Foldable<dictionary>, item, result>(
      value: Data<dictionary, item>,
      initial: result,
      fn: (state: result, item: DataItem<dictionary, item>) => result,
    ): result {
      return call_typeclass_method(
        this.instance_for(value).fold<item, result>,
        value,
        initial,
        fn,
      );
    },
    fold_while<dictionary extends Foldable<dictionary>, item, result>(
      value: Data<dictionary, item>,
      initial: result,
      fn: (state: result, item: DataItem<dictionary, item>) => FoldStep<result>,
    ): result {
      const specialized = this.instance_for(value)[fold_while_method];
      if (specialized !== undefined) {
        return call_typeclass_method(
          specialized<item, result>,
          value,
          initial,
          fn,
        );
      }
      // A fresh private token per call also makes nested reductions safe. Throwing
      // through a for-of fold performs IteratorClose. Resource-owning instances
      // use the optional hook so cleanup failures on normal exit propagate too.
      const done = {};
      let result = initial;
      try {
        return this.fold(value, initial, (state, item) => {
          const [tag, next] = fn(state, item);
          switch (tag) {
            case "Continue":
              return next;
            case "Done":
              result = next;
              throw done;
          }
        });
      } catch (error) {
        if (error === done) return result;
        throw error;
      }
    },
    some<dictionary extends Foldable<dictionary>, item>(
      value: Data<dictionary, item>,
      predicate: (item: DataItem<dictionary, item>) => boolean,
    ): boolean {
      const specialized = this.instance_for(value)[some_method];
      if (specialized !== undefined) {
        return call_typeclass_method(specialized, value, predicate);
      }
      return this.fold_while(value, false, (_, item) => {
        if (predicate(item)) return ["Done", true];
        return ["Continue", false];
      });
    },
    find<dictionary extends Foldable<dictionary>, item>(
      value: Data<dictionary, item>,
      predicate: (item: DataItem<dictionary, item>) => boolean,
    ): DataItem<dictionary, item> | undefined {
      const specialized = this.instance_for(value)[find_method];
      if (specialized !== undefined) {
        return call_typeclass_method(specialized, value, predicate);
      }
      return this.fold_while<
        dictionary,
        item,
        DataItem<dictionary, item> | undefined
      >(
        value,
        undefined,
        (_, item) => {
          if (predicate(item)) return ["Done", item];
          return ["Continue", undefined];
        },
      );
    },
  },
);

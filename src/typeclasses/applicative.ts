import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import { append_item } from "../internal.ts";
import { Functor, type Functor as FunctorDictionary } from "./functor.ts";

/** Runtime token for the Applicative typeclass. */
export const applicative_typeclass = Symbol("Applicative");
/** Optional instance hook for optimized multi-value lifting. */
export const applicative_lift_method = Symbol("Applicative.lift");

/** @ignore */
export type ApplicativeImplementation<dictionary extends Dictionary> = {
  pure: <item>(
    this: dictionary,
    value: item,
  ) => Data<dictionary, item>;
  ap: <from, to>(
    this: Data<dictionary, (value: NoInfer<from>) => to>,
    value: Data<dictionary, from>,
  ) => Data<dictionary, to>;
  [applicative_lift_method]?: <result>(
    this: Data<dictionary, unknown>,
    fn: (...values: unknown[]) => result,
    rest: readonly Data<dictionary, unknown>[],
  ) => Data<dictionary, result>;
};

/** The minimal complete definition of an Applicative instance. */
export type MinimalApplicative<dictionary extends Applicative<dictionary>> = {
  pure: <item>(this: dictionary, value: item) => Data<dictionary, item>;
  ap: <from, to>(
    this: Data<dictionary, (value: NoInfer<from>) => to>,
    value: Data<dictionary, from>,
  ) => Data<dictionary, to>;
};

/** Functor dictionary capability for lifting and applying contextual values. */
export interface Applicative<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof applicative_typeclass,
      ApplicativeImplementation<dictionary>
    >,
    FunctorDictionary<dictionary> {}

/** @ignore */
export type ApplicativeTypeclass =
  & Typeclass<typeof applicative_typeclass, {
    pure<dictionary extends Applicative<dictionary>, item>(
      witness: Data<dictionary, unknown>,
      item: item,
    ): Data<dictionary, item>;
    pure<dictionary extends Applicative<dictionary>, item>(
      dictionary: Applicative<dictionary>,
      item: item,
    ): Data<dictionary, item>;
    lift: typeof applicative_lift;
    ap<dictionary extends Applicative<dictionary>, from, to>(
      value: Data<dictionary, (value: NoInfer<from>) => to>,
      item: Data<dictionary, from>,
    ): Data<dictionary, to>;
  }>
  & {
    derive<dictionary extends Applicative<dictionary>>(
      dictionary: dictionary,
    ): (minimal: MinimalApplicative<dictionary>) => void;
  };

/** Operations for constructing, applying, and lifting Applicative values. */
export const Applicative: ApplicativeTypeclass = typeclass(
  applicative_typeclass,
  {
    derive<dictionary extends Applicative<dictionary>>(
      dictionary: dictionary,
    ): (minimal: MinimalApplicative<dictionary>) => void {
      return (minimal) => {
        Functor.instance(dictionary)({
          map<from, to>(
            this: Data<dictionary, from>,
            fn: (value: from) => to,
          ): Data<dictionary, to> {
            return this.pure(fn).ap(this);
          },
        });

        Applicative.instance(dictionary)({
          pure: minimal.pure,
          ap: minimal.ap,
        });
      };
    },

    pure<
      dictionary extends Applicative<dictionary>,
      item,
    >(
      witness: dictionary | Data<dictionary, unknown>,
      item: item,
    ): Data<dictionary, item> {
      return call_typeclass_method(
        this.instance_for(witness).pure<item>,
        witness as dictionary,
        item,
      );
    },

    lift: applicative_lift,

    ap<
      dictionary extends Applicative<dictionary>,
      from,
      to,
    >(
      value: Data<dictionary, (value: NoInfer<from>) => to>,
      item: Data<dictionary, from>,
    ): Data<dictionary, to> {
      return call_typeclass_method(
        this.instance_for(value).ap<from, to>,
        value,
        item,
      );
    },
  },
);

function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  remaining extends unknown[],
  result,
>(
  fn: (first: first, ...remaining: remaining) => result,
  first: Data<dictionary, first>,
  ...rest: {
    [index in keyof remaining]: Data<NoInfer<dictionary>, remaining[index]>;
  }
): Data<dictionary, result>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  remaining extends unknown[],
  result,
>(
  fn: (first: first, ...remaining: remaining) => result,
  first: Data<dictionary, first>,
  ...rest: {
    [index in keyof remaining]: Data<NoInfer<dictionary>, remaining[index]>;
  }
): Data<dictionary, result> {
  const apply = fn as (...values: unknown[]) => result;
  const remaining_values = rest as unknown as Data<dictionary, unknown>[];
  const instance = Applicative.instance_for(first);
  const lift = instance[applicative_lift_method];

  if (lift !== undefined) {
    return call_typeclass_method(lift, first, apply, remaining_values);
  }

  const values = [
    first as Data<dictionary, unknown>,
    ...remaining_values,
  ];

  if (values.length === 1) {
    return values[0].map((value) => {
      return apply(value);
    });
  }

  if (values.length === 2) {
    const combined = values[0].map((left) => {
      return (right: unknown) => {
        return apply(left, right);
      };
    });

    return combined.ap(values[1]);
  }

  if (values.length === 3) {
    const combined = values[0].map((left) => {
      return (middle: unknown) => {
        return (right: unknown) => {
          return apply(left, middle, right);
        };
      };
    });

    return combined.ap(values[1]).ap(values[2]);
  }

  let combined = values[0].map((value) => [value] as unknown[]);

  for (let index = 1; index < values.length; index += 1) {
    const current = values[index];
    const append = combined.map((items) => {
      return (item: unknown) => append_item(items, item);
    });

    combined = append.ap(current);
  }

  return Functor.map(combined, (items) => {
    return apply(...items);
  });
}

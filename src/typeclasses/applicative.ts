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

export const applicative_typeclass = Symbol("Applicative");
export const applicative_lift_method = Symbol("Applicative.lift");

type ApplicativeImplementation<dictionary extends Dictionary> = {
  pure: <item>(
    this: dictionary,
    value: item,
  ) => Data<dictionary, item>;
  ap: <from, to>(
    this: Data<dictionary, (value: NoInfer<from>) => to>,
    value: Data<dictionary, from>,
  ) => Data<dictionary, to>;
  [applicative_lift_method]?: <out>(
    this: Data<dictionary, unknown>,
    fn: (...values: unknown[]) => out,
    rest: readonly Data<dictionary, unknown>[],
  ) => Data<dictionary, out>;
};

/** The minimal complete definition of an Applicative instance. */
export type MinimalApplicative<dictionary extends Applicative<dictionary>> = {
  pure: <item>(this: dictionary, value: item) => Data<dictionary, item>;
  ap: <from, to>(
    this: Data<dictionary, (value: NoInfer<from>) => to>,
    value: Data<dictionary, from>,
  ) => Data<dictionary, to>;
};

export interface Applicative<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof applicative_typeclass,
      ApplicativeImplementation<dictionary>
    >,
    FunctorDictionary<dictionary> {}

type ApplicativeTypeclass =
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
  out,
>(
  fn: (first: first) => out,
  first: Data<dictionary, first>,
): Data<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  out,
>(
  fn: (first: first, second: second) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
): Data<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  out,
>(
  fn: (first: first, second: second, third: third) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
  third: Data<dictionary, third>,
): Data<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  fourth,
  out,
>(
  fn: (first: first, second: second, third: third, fourth: fourth) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
  third: Data<dictionary, third>,
  fourth: Data<dictionary, fourth>,
): Data<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  fourth,
  fifth,
  out,
>(
  fn: (
    first: first,
    second: second,
    third: third,
    fourth: fourth,
    fifth: fifth,
  ) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
  third: Data<dictionary, third>,
  fourth: Data<dictionary, fourth>,
  fifth: Data<dictionary, fifth>,
): Data<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  out,
>(
  fn: (...values: unknown[]) => out,
  first: Data<dictionary, unknown>,
  ...rest: Data<dictionary, unknown>[]
): Data<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  out,
>(
  fn: (...values: unknown[]) => out,
  first: Data<dictionary, unknown>,
  ...rest: Data<dictionary, unknown>[]
): Data<dictionary, out> {
  const instance = Applicative.instance_for(first);
  const lift = instance[applicative_lift_method];

  if (lift !== undefined) {
    return call_typeclass_method(lift, first, fn, rest);
  }

  const values = [first, ...rest];

  if (values.length === 1) {
    return values[0].map((value) => {
      return fn(value);
    });
  }

  if (values.length === 2) {
    const combined = values[0].map((left) => {
      return (right: unknown) => {
        return fn(left, right);
      };
    });

    return combined.ap(values[1]);
  }

  if (values.length === 3) {
    const combined = values[0].map((left) => {
      return (middle: unknown) => {
        return (right: unknown) => {
          return fn(left, middle, right);
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
    return fn(...items);
  });
}

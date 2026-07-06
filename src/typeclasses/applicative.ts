import {
  call_typeclass_method,
  type Data,
  type Dictionary,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import { Functor, type Functor as FunctorDictionary } from "./functor.ts";

export const applicative_typeclass = Symbol("Applicative");

export interface Applicative<dictionary extends Dictionary>
  extends
    TypeclassDictionary<
      dictionary,
      typeof applicative_typeclass,
      {
        pure: <item>(
          this: Data<dictionary, unknown>,
          value: item,
        ) => Data<dictionary, item>;
        ap: <from, to>(
          this: Data<dictionary, (value: NoInfer<from>) => to>,
          value: Data<dictionary, from>,
        ) => Data<dictionary, to>;
      }
    >,
    FunctorDictionary<dictionary> {}

type ApplicativeTypeclass = Typeclass<typeof applicative_typeclass, {
  pure<dictionary extends Applicative<dictionary>, item>(
    value: Data<dictionary, unknown>,
    item: item,
  ): Data<dictionary, item>;
  lift: typeof applicative_lift;
  ap<dictionary extends Applicative<dictionary>, from, to>(
    value: Data<dictionary, (value: NoInfer<from>) => to>,
    item: Data<dictionary, from>,
  ): Data<dictionary, to>;
}>;

export const Applicative: ApplicativeTypeclass = typeclass(
  applicative_typeclass,
  {
    pure<
      dictionary extends Applicative<dictionary>,
      item,
    >(
      value: Data<dictionary, unknown>,
      item: item,
    ): Data<dictionary, item> {
      return call_typeclass_method(
        this.instance_for(value).pure<item>,
        value,
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

function append_item(values: unknown[], item: unknown): unknown[] {
  const next = new Array<unknown>(values.length + 1);

  for (let index = 0; index < values.length; index += 1) {
    next[index] = values[index];
  }

  next[values.length] = item;

  return next;
}

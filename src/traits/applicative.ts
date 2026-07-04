import {
  call_trait_method,
  define_trait,
  type Dictionary,
  type TraitDictionary,
  type Value,
} from "../trait.ts";
import { Functor, type Functor as FunctorDictionary } from "./functor.ts";

export const applicative_trait = Symbol("Applicative");

export interface Applicative<dictionary extends Dictionary>
  extends
    TraitDictionary<
      dictionary,
      typeof applicative_trait,
      {
        pure: <item>(
          this: Value<dictionary, unknown>,
          value: item,
        ) => Value<dictionary, item>;
        ap: <from, to>(
          this: Value<dictionary, (value: NoInfer<from>) => to>,
          value: Value<dictionary, from>,
        ) => Value<dictionary, to>;
      }
    >,
    FunctorDictionary<dictionary> {}

export const Applicative = define_trait(applicative_trait, {
  pure<
    dictionary extends Applicative<dictionary>,
    item,
  >(
    value: Value<dictionary, unknown>,
    item: item,
  ): Value<dictionary, item> {
    return call_trait_method(
      this.implementation(value).pure<item>,
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
    value: Value<dictionary, (value: NoInfer<from>) => to>,
    item: Value<dictionary, from>,
  ): Value<dictionary, to> {
    return call_trait_method(
      this.implementation(value).ap<from, to>,
      value,
      item,
    );
  },
});

function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  out,
>(
  fn: (first: first) => out,
  first: Value<dictionary, first>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  out,
>(
  fn: (first: first, second: second) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  out,
>(
  fn: (first: first, second: second, third: third) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
  third: Value<dictionary, third>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  first,
  second,
  third,
  fourth,
  out,
>(
  fn: (first: first, second: second, third: third, fourth: fourth) => out,
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
  third: Value<dictionary, third>,
  fourth: Value<dictionary, fourth>,
): Value<dictionary, out>;
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
  first: Value<dictionary, first>,
  second: Value<dictionary, second>,
  third: Value<dictionary, third>,
  fourth: Value<dictionary, fourth>,
  fifth: Value<dictionary, fifth>,
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  out,
>(
  fn: (...values: unknown[]) => out,
  first: Value<dictionary, unknown>,
  ...rest: Value<dictionary, unknown>[]
): Value<dictionary, out>;
function applicative_lift<
  dictionary extends Applicative<dictionary>,
  out,
>(
  fn: (...values: unknown[]) => out,
  first: Value<dictionary, unknown>,
  ...rest: Value<dictionary, unknown>[]
): Value<dictionary, out> {
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

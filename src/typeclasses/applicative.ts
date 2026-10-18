import { traverse_items } from "../traversal.ts";
import {
  type As,
  call_typeclass_method,
  type Data,
  type Dictionary,
  dictionary_of,
  type dictionary_type,
  type IsUnion,
  kind,
  type type_data,
  type type_item,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import { append_item } from "../internal.ts";
import { Functor, type Functor as FunctorDictionary } from "./functor.ts";

/** Runtime token for the Applicative typeclass. */
export const applicative_typeclass = /* @__PURE__ */ Symbol("Applicative");
/** Optional instance hook for optimized multi-value lifting. */
export const applicative_lift_method = /* @__PURE__ */ Symbol(
  "Applicative.lift",
);

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
    collect: typeof collect;
    ap<dictionary extends Applicative<dictionary>, from, to>(
      value: Data<dictionary, (value: NoInfer<from>) => to>,
      item: Data<dictionary, from>,
    ): Data<dictionary, to>;
  }>
  & {
    derive<dictionary extends Applicative<dictionary>>(
      dictionary: Applicative<dictionary>,
    ): (minimal: MinimalApplicative<dictionary>) => void;
  };

/** Operations for constructing, applying, and lifting Applicative values. */
export const Applicative: ApplicativeTypeclass = /* @__PURE__ */ typeclass(
  applicative_typeclass,
  {
    derive<dictionary extends Applicative<dictionary>>(
      dictionary: Applicative<dictionary>,
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
    collect,

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
    for (const current of remaining_values) {
      if (current[kind] !== first[kind]) {
        throw new TypeError("lift requires values from the same dictionary");
      }
    }

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

interface CollectRuntime
  extends As<CollectRuntime, unknown>, Applicative<CollectRuntime> {
  readonly [type_data]: this[typeof type_item];
}

/** @ignore */
type CollectedDictionary<values> = values[keyof values] extends infer value
  ? value extends
    { readonly [dictionary_type]?: infer dictionary extends Dictionary }
    ? dictionary
  : never
  : never;
/** @ignore */
type CollectedShape<values> = {
  readonly [key in keyof values]: values[key] extends {
    [Symbol.iterator](): Generator<unknown, infer item, unknown>;
  } ? item
    : never;
};
/** @ignore */
type InferCollect<values> = [keyof values] extends [never] ? never
  : [CollectedDictionary<values>] extends [never] ? never
  : true extends IsUnion<CollectedDictionary<values>> ? never
  : CollectedDictionary<values> extends Applicative<CollectedDictionary<values>>
    ? unknown
  : never;

/** Infer the dictionary from a nonempty tuple or record of contextual values. */
export function collect<
  const values extends
    | readonly unknown[]
    | Readonly<Record<PropertyKey, unknown>>,
>(
  values: values & InferCollect<values>,
): Data<CollectedDictionary<values>, CollectedShape<values>>;
/** Collect a tuple or record using an explicit context, including empty shapes. */
export function collect<
  dictionary extends Applicative<dictionary>,
  const shape extends readonly unknown[] | Readonly<Record<string, unknown>>,
>(
  dictionary: Applicative<dictionary>,
  values: {
    readonly [key in keyof shape]: Data<NoInfer<dictionary>, shape[key]>;
  },
): Data<dictionary, shape>;
export function collect(
  dictionary_or_values: unknown,
  explicit_values?: unknown,
): unknown {
  let values = explicit_values as Record<
    PropertyKey,
    Data<CollectRuntime, unknown>
  >;
  let selected = dictionary_or_values as CollectRuntime;
  if (explicit_values === undefined) {
    values = dictionary_or_values as typeof values;
    const first = Reflect.ownKeys(values).find((key) =>
      Object.prototype.propertyIsEnumerable.call(values, key)
    );
    if (first === undefined) {
      throw new TypeError("Empty collect requires a dictionary");
    }
    selected = dictionary_of(values[first]) as CollectRuntime;
  }
  const keys = Reflect.ownKeys(values).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(values, key)
  );
  const tuple = Array.isArray(values);
  let length = 0;
  if (tuple) length = (values as unknown as readonly unknown[]).length;
  return traverse_items(keys, selected, (key) => {
    const value = values[key];
    if (value[kind] !== selected[kind]) {
      throw new TypeError(
        "collect requires values from the selected dictionary",
      );
    }
    return Functor.map(value, (item) => [key, item] as const);
  }).map((entries) => {
    if (tuple) {
      const out: unknown[] = new Array(length);
      for (const [key, value] of entries) {
        Object.defineProperty(out, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return out;
    }
    return Object.fromEntries(entries);
  });
}

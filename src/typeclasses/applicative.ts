import { traverse_items_into } from "../traversal.ts";
import {
  type As,
  type Data,
  type Dictionary,
  dictionary_of,
  type dictionary_type,
  instance_for_token,
  type IsUnion,
  kind,
  type type_data,
  type type_item,
  type Typeclass,
  typeclass,
  type TypeclassDictionary,
} from "../typeclass.ts";
import {
  Functor,
  type Functor as FunctorDictionary,
  functor_map,
} from "./functor.ts";

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

    pure: applicative_pure,

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
      return (instance_for_token(applicative_typeclass, value)
        .ap<from, to>).call(value, item);
    },
  },
);

/** @ignore Lifting primitive that does not retain unrelated Applicative operations. */
export function applicative_pure<
  dictionary extends Applicative<dictionary>,
  item,
>(
  witness: dictionary | Data<dictionary, unknown>,
  item: item,
): Data<dictionary, item> {
  return (instance_for_token(applicative_typeclass, witness).pure<item>).call(
    witness as dictionary,
    item,
  );
}

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
  const instance = instance_for_token(applicative_typeclass, first);
  const lift = instance[applicative_lift_method];
  const len = remaining_values.length;

  if (lift !== undefined) {
    const first_kind = first[kind];
    for (let i = 0; i < len; i += 1) {
      if (remaining_values[i][kind] !== first_kind) {
        throw new TypeError("lift requires values from the same dictionary");
      }
    }

    return (lift<result>).call(
      first as Data<dictionary, unknown>,
      apply,
      remaining_values,
    );
  }

  if (len === 0) {
    return first.map((value) => apply(value));
  }

  if (len === 1) {
    return first.map((left) => (right: unknown) => apply(left, right))
      .ap(remaining_values[0]);
  }

  if (len === 2) {
    return first.map((left) => (middle: unknown) => (right: unknown) =>
      apply(left, middle, right)
    ).ap(remaining_values[0]).ap(remaining_values[1]);
  }

  type Prefix = { readonly item: unknown; readonly previous?: Prefix };
  const total = len + 1;
  let combined = first.map((item): Prefix => ({ item }));
  for (let index = 0; index < len; index += 1) {
    combined = combined.map((previous) => (item: unknown): Prefix => ({
      item,
      previous,
    })).ap(remaining_values[index]);
  }
  return functor_map(combined, (prefix) => {
    const items = new Array<unknown>(total);
    let current: Prefix | undefined = prefix;
    for (let index = total - 1; index >= 0; index -= 1) {
      items[index] = current!.item;
      current = current!.previous;
    }
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

const enum_own = Object.prototype.propertyIsEnumerable;

function collect_dense_build(items: Iterable<unknown>): unknown[] {
  return Array.isArray(items) ? items : [...items];
}

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
  const values =
    (explicit_values === undefined
      ? dictionary_or_values
      : explicit_values) as Record<PropertyKey, Data<CollectRuntime, unknown>>;
  const tuple = Array.isArray(values);
  const length = tuple ? (values as unknown as readonly unknown[]).length : 0;
  let dense = tuple && Object.keys(values).length === length &&
    Object.getOwnPropertySymbols(values).length === 0;
  for (let i = 0; dense && i < length; i += 1) {
    dense = enum_own.call(values, i);
  }
  let keys: PropertyKey[] | undefined;
  if (!dense) {
    const raw = Reflect.ownKeys(values);
    let write = 0;
    for (let i = 0; i < raw.length; i += 1) {
      const k = raw[i];
      if (enum_own.call(values, k)) raw[write++] = k;
    }
    raw.length = write;
    keys = raw;
  }
  let selected = dictionary_or_values as CollectRuntime;
  if (explicit_values === undefined) {
    const first = dense
      ? (values as unknown as readonly Data<CollectRuntime, unknown>[])[0]
      : keys![0] === undefined
      ? undefined
      : values[keys![0]];
    if (first === undefined) {
      throw new TypeError("Empty collect requires a dictionary");
    }
    selected = dictionary_of(first) as CollectRuntime;
  }
  const selected_kind = selected[kind];
  const check = (value: Data<CollectRuntime, unknown>) => {
    if (value[kind] !== selected_kind) {
      throw new TypeError(
        "collect requires values from the selected dictionary",
      );
    }
    return value;
  };
  if (dense) {
    return traverse_items_into(
      values as unknown as readonly Data<CollectRuntime, unknown>[],
      selected,
      check,
      collect_dense_build,
    );
  }
  const key_list = keys!;
  return traverse_items_into(
    key_list,
    selected,
    (key) => check(values[key]),
    (items) => {
      const out: Record<PropertyKey, unknown> | unknown[] = tuple
        ? new Array(length)
        : {};
      const list = collect_dense_build(items);
      for (let i = 0; i < list.length; i += 1) {
        const k = key_list[i];
        const v = list[i];
        if (k in out) {
          Object.defineProperty(out, k, {
            value: v,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        } else (out as Record<PropertyKey, unknown>)[k] = v;
      }
      return out;
    },
  );
}

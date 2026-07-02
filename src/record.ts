import {
  as_trait,
  type Dictionary,
  item_type,
  kind,
  type Value,
  value_type,
} from "./trait.ts";
import {
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monoid,
  Semigroup,
  Traversable,
} from "./traits.ts";

export type RecordT<item> = Readonly<Record<string, item>>;

export const record_kind: unique symbol = Symbol("RecordT");

export interface RecordDictionary extends Dictionary<typeof record_kind> {
  <item>(record: RecordT<item>): RecordValue<item>;
  readonly [value_type]: RecordT<this[typeof item_type]>;
}

type RecordValue<item> = Value<RecordDictionary, item>;

export const RecordT: RecordDictionary = function <item>(
  record: RecordT<item>,
) {
  return as_trait(RecordT, { ...record });
} as RecordDictionary;

RecordT[kind] = record_kind;

export function from_entries<item>(
  entries: Iterable<readonly [string, item]>,
): RecordValue<item> {
  return RecordT(Object.fromEntries(entries));
}

export function to_record<item>(
  record: RecordValue<item>,
): Record<string, item> {
  return { ...record.value() };
}

Format.implement(RecordT)({
  fmt(value) {
    const record = value.value();
    return Deno.inspect(record);
  },
});

export interface RecordDictionary extends Format<typeof RecordT> {}

Equal.implement(RecordT)({
  eq(left_value, right) {
    const left = left_value.value();
    const right_value = right.value();
    const left_keys = Object.keys(left);
    const right_keys = Object.keys(right_value);

    if (left_keys.length !== right_keys.length) {
      return false;
    }

    for (const key of left_keys) {
      if (!Object.hasOwn(right_value, key)) {
        return false;
      }

      if (!Object.is(left[key], right_value[key])) {
        return false;
      }
    }

    return true;
  },
});

export interface RecordDictionary extends Equal<typeof RecordT> {}

Functor.implement(RecordT)({
  map(value, fn) {
    const record = value.value();
    const out: Record<string, ReturnType<typeof fn>> = {};

    for (const [key, value] of Object.entries(record)) {
      out[key] = fn(value);
    }

    return RecordT(out);
  },
});

export interface RecordDictionary extends Functor<typeof RecordT> {}

Semigroup.implement(RecordT)({
  concat(left_value, right) {
    const left = left_value.value();
    return RecordT({ ...left, ...right.value() });
  },
});

export interface RecordDictionary extends Semigroup<typeof RecordT> {}

Monoid.implement(RecordT)({
  empty(_record) {
    return RecordT({});
  },
});

export interface RecordDictionary extends Monoid<typeof RecordT> {}

Foldable.implement(RecordT)({
  fold(value, initial, fn) {
    const record = value.value();
    let state = initial;

    for (const value of Object.values(record)) {
      state = fn(state, value);
    }

    return state;
  },
});

export interface RecordDictionary extends Foldable<typeof RecordT> {}

Traversable.implement(RecordT)({
  traverse<applicative extends Applicative<applicative>, from, to>(
    value: RecordValue<from>,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ) {
    const record = value.value();
    const entries = Object.entries(record);
    let out = Applicative.pure(applicative, RecordT<to>({}));

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index];
      const insert = Functor.map(fn(value), (mapped) => {
        return (tail: RecordValue<to>) => {
          return RecordT({ [key]: mapped, ...tail.value() });
        };
      });
      out = Applicative.ap(insert, out);
    }

    return out;
  },
});

export interface RecordDictionary extends Traversable<typeof RecordT> {}

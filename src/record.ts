import {
  type ContextDictionary,
  define_dictionary,
  type DictionaryConstructorContext,
  type Value,
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

declare module "./trait.ts" {
  interface ContextValues<item> {
    [record_kind]: RecordT<item>;
  }
}

export interface RecordDictionary
  extends ContextDictionary<typeof record_kind> {
  <item>(record: RecordT<item>): RecordValue<item>;
}

type RecordValue<item> = Value<RecordDictionary, item>;

export const RecordT = define_dictionary<RecordDictionary>(
  record_kind,
  function <item>(
    this: DictionaryConstructorContext<RecordDictionary>,
    record: RecordT<item>,
  ) {
    return this.as_trait({ ...record });
  },
);

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

export interface RecordDictionary extends Format<RecordDictionary> {}

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

export interface RecordDictionary extends Equal<RecordDictionary> {}

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

export interface RecordDictionary extends Functor<RecordDictionary> {}

Semigroup.implement(RecordT)({
  concat(left_value, right) {
    const left = left_value.value();
    return RecordT({ ...left, ...right.value() });
  },
});

export interface RecordDictionary extends Semigroup<RecordDictionary> {}

Monoid.implement(RecordT)({
  empty(_record) {
    return RecordT({});
  },
});

export interface RecordDictionary extends Monoid<RecordDictionary> {}

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

export interface RecordDictionary extends Foldable<RecordDictionary> {}

Traversable.implement(RecordT)({
  traverse(value, applicative, fn) {
    const record = value.value();
    const entries = Object.entries(record);

    if (entries.length === 0) {
      return Applicative.pure(applicative, RecordT({}));
    }

    let index = entries.length - 1;
    const [key, item] = entries[index];
    let out = Functor.map(fn(item), record_single(key));

    for (index -= 1; index >= 0; index -= 1) {
      const [key, value] = entries[index];
      out = Applicative.ap(Functor.map(fn(value), record_prepend(key)), out);
    }

    return out;
  },
});

export interface RecordDictionary extends Traversable<RecordDictionary> {}

function record_single<item>(key: string) {
  return (value: item): RecordValue<item> => RecordT({ [key]: value });
}

function record_prepend<item>(key: string) {
  return (value: item) => {
    return (tail: RecordValue<item>) => {
      return RecordT({ [key]: value, ...tail.value() });
    };
  };
}

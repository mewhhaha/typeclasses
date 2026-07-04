import { type As, define, type Value } from "./trait.ts";
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

export const record_kind = Symbol("RecordT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [record_kind]: RecordT<item>;
  }
}

export interface AsRecord extends As<typeof record_kind> {}

type RecordValue<item> = Value<AsRecord, item>;

export const RecordT = define<AsRecord>(
  record_kind,
  function (record) {
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
  fmt() {
    const record = this.value();
    return Deno.inspect(record);
  },
});

export interface AsRecord extends Format<AsRecord> {}

Equal.implement(RecordT)({
  eq(right) {
    const left = this.value();
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

export interface AsRecord extends Equal<AsRecord> {}

Functor.implement(RecordT)({
  map(fn) {
    const record = this.value();
    const out: Record<string, ReturnType<typeof fn>> = {};

    for (const [key, value] of Object.entries(record)) {
      out[key] = fn(value);
    }

    return RecordT(out);
  },
});

export interface AsRecord extends Functor<AsRecord> {}

Semigroup.implement(RecordT)({
  concat(right) {
    const left = this.value();
    return RecordT({ ...left, ...right.value() });
  },
});

export interface AsRecord extends Semigroup<AsRecord> {}

Monoid.implement(RecordT)({
  empty() {
    return RecordT({});
  },
});

export interface AsRecord extends Monoid<AsRecord> {}

Foldable.implement(RecordT)({
  fold(initial, fn) {
    const record = this.value();
    let state = initial;

    for (const value of Object.values(record)) {
      state = fn(state, value);
    }

    return state;
  },
});

export interface AsRecord extends Foldable<AsRecord> {}

Traversable.implement(RecordT)({
  traverse(applicative, fn) {
    const record = this.value();
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

export interface AsRecord extends Traversable<AsRecord> {}

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

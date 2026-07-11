import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monoid,
  Ord,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";

export type RecordT<item> = Readonly<Record<string, item>>;

export interface AsRecord
  extends
    As<AsRecord>,
    Show<AsRecord>,
    Eq<AsRecord>,
    Monoid<AsRecord>,
    Traversable<AsRecord>,
    Ord<AsRecord> {
  readonly [type_item]: unknown;
  readonly [type_data]: RecordT<this[typeof type_item]>;
}

type RecordValue<item> = Data<AsRecord, item>;

export const RecordT: AsRecord = data<AsRecord>(
  function (record) {
    return this.data({ ...record });
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

Show.instance(RecordT)({
  show() {
    const record = this.value();
    return inspect(record);
  },
});

Eq.instance(RecordT)({
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

Ord.instance(RecordT)({
  compare(right) {
    const left = Object.entries(this.value()).sort(compare_entry_keys);
    const right_entries = Object.entries(right.value()).sort(
      compare_entry_keys,
    );
    const length = Math.min(left.length, right_entries.length);

    for (let index = 0; index < length; index += 1) {
      const key_order = compare_unknown(
        left[index][0],
        right_entries[index][0],
      );

      switch (key_order) {
        case "lt":
        case "gt":
          return key_order;
        case "eq": {
          const value_order = compare_unknown(
            left[index][1],
            right_entries[index][1],
          );

          if (value_order !== "eq") {
            return value_order;
          }

          break;
        }
      }
    }

    return compare_unknown(left.length, right_entries.length);
  },
});

Functor.instance(RecordT)({
  map(fn) {
    const record = this.value();
    const out: Record<string, ReturnType<typeof fn>> = {};

    for (const [key, value] of Object.entries(record)) {
      out[key] = fn(value);
    }

    return RecordT(out);
  },
});

Semigroup.instance(RecordT)({
  concat(right) {
    const left = this.value();
    return RecordT({ ...left, ...right.value() });
  },
});

Monoid.instance(RecordT)({
  empty() {
    return RecordT({});
  },
});

Foldable.instance(RecordT)({
  fold(initial, fn) {
    const record = this.value();
    let state = initial;

    for (const value of Object.values(record)) {
      state = fn(state, value);
    }

    return state;
  },
});

Traversable.instance(RecordT)({
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

function compare_entry_keys(
  left: readonly [string, unknown],
  right: readonly [string, unknown],
): number {
  return left[0].localeCompare(right[0]);
}

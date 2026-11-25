import { find_method, some_method } from "./typeclasses/foldable.ts";
import {
  type As,
  as_data,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { traverse_items_into } from "./traversal.ts";
import {
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

/** @ignore */
export const record_identity: unique symbol = /* @__PURE__ */ Symbol(
  "record_identity",
);

/** A read-only string-keyed record wrapped by the RecordT dictionary. */
export type RawRecordT<item> = Readonly<Record<string, item>>;

/** @ignore */
export interface AsRecordLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawRecordT<this[typeof type_item]>;
}

/** Dictionary type for records and their value-wise typeclass instances. */
export interface AsRecord
  extends
    As<AsRecordLambda, typeof record_identity>,
    Show<AsRecord>,
    Eq<AsRecord>,
    Monoid<AsRecord>,
    Traversable<AsRecord>,
    Ord<AsRecord> {
}

export type RecordT<item> = Data<AsRecord, item>;

/** Callable record dictionary that copies records when wrapping them. */
export const RecordT: AsRecord = data<AsRecord>(
  record_identity,
  function (record) {
    return this.data({ ...record });
  },
);

/** Build a wrapped record from string-keyed entries. */
export function from_entries<item>(
  entries: Iterable<readonly [string, item]>,
): RecordT<item> {
  return as_data(RecordT, Object.fromEntries(entries));
}

/** Copy a wrapped record into a mutable plain object. */
export function to_record<item>(
  record: RecordT<item>,
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
    const left_record = this.value();
    const right_record = right.value();
    if (left_record === right_record) return "eq";
    const left_keys = Object.keys(left_record);
    const right_keys = Object.keys(right_record);
    if (
      left_keys.length === right_keys.length &&
      left_keys.every((key) =>
        Object.hasOwn(right_record, key) &&
        compare_unknown(left_record[key], right_record[key]) === "eq"
      )
    ) return "eq";
    const left = left_keys.sort();
    const right_entries = right_keys.sort();
    const length = Math.min(left.length, right_entries.length);

    for (let index = 0; index < length; index += 1) {
      const key_order = compare_unknown(
        left[index],
        right_entries[index],
      );

      switch (key_order) {
        case "lt":
        case "gt":
          return key_order;
        case "eq": {
          const value_order = compare_unknown(
            left_record[left[index]],
            right_record[right_entries[index]],
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

    for (const key of Object.keys(record)) {
      set_own(out, key, fn(record[key]));
    }

    return as_data(RecordT, out);
  },
});

Semigroup.instance(RecordT)({
  concat(right) {
    const left = this.value();
    return as_data(RecordT, { ...left, ...right.value() });
  },
});

Monoid.instance(RecordT)({
  empty() {
    return as_data(RecordT, {});
  },
});

Foldable.instance(RecordT)({
  [some_method](predicate) {
    const record = this.value();
    for (const key of Object.keys(record)) {
      if (predicate(record[key])) return true;
    }
    return false;
  },
  [find_method](predicate) {
    const record = this.value();
    for (const key of Object.keys(record)) {
      const item = record[key];
      if (predicate(item)) return item;
    }
    return undefined;
  },

  fold(initial, fn) {
    const record = this.value();
    let state = initial;

    for (const key of Object.keys(record)) {
      state = fn(state, record[key]);
    }

    return state;
  },
});

Traversable.instance(RecordT)({
  traverse(applicative, fn) {
    const source = this.value();
    const keys = Object.keys(source);
    return traverse_items_into(
      keys,
      applicative,
      (key) => fn(source[key]),
      (items) => {
        return as_data(RecordT, record_from_values(keys, items));
      },
    );
  },
});

/** Snapshot own enumerable properties; later source mutations are invisible. */
export function from_snapshot<item>(
  source: Readonly<Record<string, item>>,
): RecordT<item> {
  return RecordT(source);
}
/** Wrap a live record by reference; later source mutations remain visible. */
export function from_record_view<item>(
  source: Readonly<Record<string, item>>,
): RecordT<item> {
  return as_data(RecordT, source);
}

/** Fold own enumerable properties with their keys. */
export function fold_with_key<item, state>(
  record: RecordT<item>,
  initial: state,
  fn: (state: state, item: item, key: string) => state,
): state {
  let result = initial;
  const source = record.value();
  for (const key of Object.keys(source)) result = fn(result, source[key], key);
  return result;
}

function record_from_values<item>(
  keys: readonly string[],
  items: Iterable<item>,
): Record<string, item> {
  const out: Record<string, item> = {};
  let index = 0;
  for (const item of items) set_own(out, keys[index++], item);
  return out;
}

function set_own<item>(
  record: Record<string, item>,
  key: string,
  item: item,
): void {
  if (key === "__proto__") {
    Object.defineProperty(record, key, {
      value: item,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else record[key] = item;
}

import {
  find_method,
  fold_while_method,
  some_method,
} from "./typeclasses/foldable.ts";
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
    if (left === right_value) return true;

    let left_count = 0;
    for (const key in left) {
      if (!Object.hasOwn(left, key)) continue;
      left_count += 1;
      if (!Object.hasOwn(right_value, key)) return false;
      if (!Object.is(left[key], right_value[key])) return false;
    }

    let right_count = 0;
    for (const key in right_value) {
      if (!Object.hasOwn(right_value, key)) continue;
      right_count += 1;
      if (right_count > left_count) return false;
    }

    return left_count === right_count;
  },
});

Ord.instance(RecordT)({
  compare(right) {
    const left_record = this.value();
    const right_record = right.value();
    if (left_record === right_record) return "eq";
    const left_keys = Object.keys(left_record);
    const right_keys = Object.keys(right_record);
    const left_len = left_keys.length;
    const right_len = right_keys.length;
    if (left_len === right_len) {
      let equal = true;
      for (let i = 0; i < left_len; i += 1) {
        const key = left_keys[i];
        if (
          !Object.hasOwn(right_record, key) ||
          !Object.is(left_record[key], right_record[key])
        ) {
          equal = false;
          break;
        }
      }
      if (equal) return "eq";
    }
    if (!is_sorted_strings(left_keys)) left_keys.sort();
    if (!is_sorted_strings(right_keys)) right_keys.sort();
    const length = left_len < right_len ? left_len : right_len;

    for (let index = 0; index < length; index += 1) {
      const lk = left_keys[index];
      const rk = right_keys[index];
      if (lk < rk) return "lt";
      if (lk > rk) return "gt";
      const lv = left_record[lk];
      const rv = right_record[rk];
      if (!Object.is(lv, rv)) {
        const value_order = compare_unknown(lv, rv);
        if (value_order !== "eq") return value_order;
      }
    }

    return left_len < right_len ? "lt" : left_len > right_len ? "gt" : "eq";
  },
});

Functor.instance(RecordT)({
  map(fn) {
    const record = this.value();
    const keys = Object.keys(record);
    const out: Record<string, ReturnType<typeof fn>> = {};

    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
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
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i += 1) {
      if (predicate(record[keys[i]])) return true;
    }
    return false;
  },
  [find_method](predicate) {
    const record = this.value();
    const keys = Object.keys(record);
    for (let i = 0; i < keys.length; i += 1) {
      const item = record[keys[i]];
      if (predicate(item)) return item;
    }
    return undefined;
  },
  [fold_while_method](initial, fn) {
    const record = this.value();
    const keys = Object.keys(record);
    let state = initial;
    for (let i = 0; i < keys.length; i += 1) {
      const step = fn(state, record[keys[i]]);
      state = step[1];
      if (step[0] === "Done") return state;
    }
    return state;
  },

  fold(initial, fn) {
    const record = this.value();
    const keys = Object.keys(record);
    let state = initial;

    for (let i = 0; i < keys.length; i += 1) {
      state = fn(state, record[keys[i]]);
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
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    result = fn(result, source[key], key);
  }
  return result;
}

function is_sorted_strings(keys: readonly string[]): boolean {
  for (let i = 1; i < keys.length; i += 1) {
    if (keys[i - 1] > keys[i]) return false;
  }
  return true;
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

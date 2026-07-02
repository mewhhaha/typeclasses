import {
  type Dictionary,
  kind,
  require_this,
  trait_constructor,
  type Value,
} from "./trait.ts";
import {
  Applicative,
  Equal,
  equal_trait,
  type EqualImplementation,
  Foldable,
  foldable_trait,
  type FoldableImplementation,
  Format,
  format_trait,
  type FormatImplementation,
  Functor,
  functor_trait,
  type FunctorImplementation,
  Monoid,
  monoid_trait,
  type MonoidImplementation,
  Semigroup,
  semigroup_trait,
  type SemigroupImplementation,
  Traversable,
  traversable_trait,
  type TraversableImplementation,
} from "./traits.ts";

export type RecordT<item> = Readonly<Record<string, item>>;

export const record_kind: unique symbol = Symbol("RecordT");

declare module "./registry.ts" {
  interface Registry<item> {
    [record_kind]: RecordT<item>;
  }
}

export interface RecordDictionary {
  <item>(record: RecordT<item>): RecordValue<item>;
  [kind]: typeof record_kind;
}

type RecordValue<item> = Value<RecordDictionary, item>;

export const RecordT = function RecordT<item>(
  record: RecordT<item>,
): RecordValue<item> {
  return record_trait({ ...record });
} as RecordDictionary;

RecordT[kind] = record_kind;

const record_trait = trait_constructor(RecordT);

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

const record_format = {
  fmt(this: RecordValue<unknown> | void): string {
    const record = require_this(this, "RecordT.Format.fmt").value();
    return Deno.inspect(record);
  },
} satisfies FormatImplementation<typeof RecordT>;

RecordT[format_trait] = record_format;
RecordT.fmt = record_format.fmt;

export interface RecordDictionary
  extends Format<typeof RecordT>, FormatImplementation<typeof RecordT> {}

const record_equal = {
  eq<item>(
    this: RecordValue<item> | void,
    right: RecordValue<item>,
  ): boolean {
    const left = require_this(this, "RecordT.Equal.eq").value();
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
} satisfies EqualImplementation<typeof RecordT>;

RecordT[equal_trait] = record_equal;
RecordT.eq = record_equal.eq;

export interface RecordDictionary
  extends Equal<typeof RecordT>, EqualImplementation<typeof RecordT> {}

const record_functor = {
  map<from, to>(
    this: RecordValue<from> | void,
    fn: (value: from) => to,
  ): RecordValue<to> {
    const record = require_this(this, "RecordT.Functor.map").value();
    const out: Record<string, to> = {};

    for (const [key, value] of Object.entries(record)) {
      out[key] = fn(value);
    }

    return RecordT(out);
  },
} satisfies FunctorImplementation<typeof RecordT>;

RecordT[functor_trait] = record_functor;
RecordT.map = record_functor.map;

export interface RecordDictionary
  extends Functor<typeof RecordT>, FunctorImplementation<typeof RecordT> {}

const record_semigroup = {
  concat<item>(
    this: RecordValue<item> | void,
    right: RecordValue<item>,
  ): RecordValue<item> {
    const left = require_this(this, "RecordT.Semigroup.concat").value();
    return RecordT({ ...left, ...right.value() });
  },
} satisfies SemigroupImplementation<typeof RecordT>;

RecordT[semigroup_trait] = record_semigroup;
RecordT.concat = record_semigroup.concat;

export interface RecordDictionary
  extends Semigroup<typeof RecordT>, SemigroupImplementation<typeof RecordT> {}

const record_monoid = {
  empty<item>(): RecordValue<item> {
    return RecordT<item>({});
  },
} satisfies MonoidImplementation<typeof RecordT>;

RecordT[monoid_trait] = record_monoid;
RecordT.empty = record_monoid.empty;

export interface RecordDictionary
  extends Monoid<typeof RecordT>, MonoidImplementation<typeof RecordT> {}

const record_foldable = {
  fold<item, out>(
    this: RecordValue<item> | void,
    initial: out,
    fn: (state: out, item: item) => out,
  ): out {
    const record = require_this(this, "RecordT.Foldable.fold").value();
    let state = initial;

    for (const value of Object.values(record)) {
      state = fn(state, value);
    }

    return state;
  },
} satisfies FoldableImplementation<typeof RecordT>;

RecordT[foldable_trait] = record_foldable;
RecordT.fold = record_foldable.fold;

export interface RecordDictionary
  extends Foldable<typeof RecordT>, FoldableImplementation<typeof RecordT> {}

const record_traversable = {
  traverse<applicative extends Dictionary & Applicative<applicative>, from, to>(
    this: RecordValue<from> | void,
    applicative: Value<applicative, unknown>,
    fn: (value: from) => Value<applicative, to>,
  ): Value<applicative, RecordValue<to>> {
    const record = require_this(this, "RecordT.Traversable.traverse").value();
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
} satisfies TraversableImplementation<typeof RecordT>;

RecordT[traversable_trait] = record_traversable;
RecordT.traverse = record_traversable.traverse;

export interface RecordDictionary
  extends
    Traversable<typeof RecordT>,
    TraversableImplementation<typeof RecordT> {}

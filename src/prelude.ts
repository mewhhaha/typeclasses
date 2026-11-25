import { array_concat_method, ArrayT } from "./array.ts";
import { from_array as list_from_array, List, type RawList } from "./list.ts";
import { MapT } from "./map.ts";
import { SetT } from "./set.ts";
import { as_data, type Data, type DataItem, kind } from "./typeclass.ts";
import { traverse_items_into } from "./traversal.ts";
import { foldable_typeclass, some_method } from "./typeclasses/foldable.ts";
import { do_runner_method, type FastDoSpec } from "./typeclasses/monad.ts";
import { semigroup_typeclass } from "./typeclasses/semigroup.ts";
import { Validation, validation_identity } from "./validation.ts";
export { from_maybe, maybe, to_either, to_nullable } from "./maybe.ts";
export { either, from_left, from_right, hush, note } from "./either.ts";
import {
  Alternative,
  type Alternative as AlternativeDictionary,
  Applicative,
  type Applicative as ApplicativeDictionary,
  applicative_lift_method,
  Eq,
  type Eq as EqDictionary,
  Foldable,
  type Foldable as FoldableDictionary,
  Functor,
  type Functor as FunctorDictionary,
  Monad,
  type Monad as MonadDictionary,
  MonadError,
  type MonadErrorDictionary,
  type MonadErrorType,
  Monoid,
  type Monoid as MonoidDictionary,
  Ord,
  type Ord as OrdDictionary,
  type Ordering,
  Semigroup,
  Show,
  type Show as ShowDictionary,
  Traversable,
  type Traversable as TraversableDictionary,
} from "./typeclasses.ts";

/** Lift a value using an explicit applicative dictionary. */
export function pure<
  dictionary extends ApplicativeDictionary<dictionary>,
  item,
>(
  dictionary: ApplicativeDictionary<dictionary>,
  value: item,
): Data<dictionary, item> {
  return Applicative.pure<dictionary, item>(dictionary as dictionary, value);
}

/** Construct the empty value for an Alternative dictionary. */
export function empty<
  dictionary extends AlternativeDictionary<dictionary>,
  item,
>(dictionary: AlternativeDictionary<dictionary>): Data<dictionary, item> {
  return Alternative.empty<dictionary, item>(dictionary as dictionary);
}

/** Construct the identity value for a Monoid dictionary. */
export function mempty<
  dictionary extends MonoidDictionary<dictionary>,
  item,
>(dictionary: MonoidDictionary<dictionary>): Data<dictionary, item> {
  return Monoid.empty<dictionary, item>(dictionary as dictionary);
}

/** Construct a failed value using an explicit MonadError dictionary. */
export function throw_error<
  dictionary extends MonadErrorDictionary,
  item,
>(
  dictionary: dictionary,
  error: MonadErrorType<dictionary>,
): Data<dictionary, item> {
  return MonadError.throw_error<dictionary, item>(
    dictionary as dictionary,
    error,
  );
}

/** Map a function over a functor. */
export function fmap<
  dictionary extends FunctorDictionary<dictionary>,
  from,
  to,
>(
  fn: (value: from) => to,
  value: Data<dictionary, from>,
): Data<dictionary, to> {
  return Functor.map(value, fn);
}

/** Apply a contextual function to a contextual value. */
export function ap<
  dictionary extends ApplicativeDictionary<dictionary>,
  from,
  to,
>(
  fn: Data<dictionary, (value: NoInfer<from>) => to>,
  value: Data<dictionary, from>,
): Data<dictionary, to> {
  return Applicative.ap(fn, value);
}

/** Lift a function with any positive number of contextual arguments. */
export const lift: typeof Applicative.lift = Applicative.lift;

/** Chain a context-dependent computation. */
export function bind<
  dictionary extends MonadDictionary<dictionary>,
  from,
  to,
>(
  value: Data<dictionary, from>,
  fn: (value: from) => Data<dictionary, to>,
): Data<dictionary, to> {
  return Monad.bind(value, fn);
}

const array_kind: unknown = /* @__PURE__ */ (() => ArrayT[kind])();
const list_kind: unknown = /* @__PURE__ */ (() => List[kind])();
const set_kind: unknown = /* @__PURE__ */ (() => SetT[kind])();
const map_kind: unknown = /* @__PURE__ */ (() => MapT[kind])();

const canonical_array_foldable =
  /* @__PURE__ */ (() => Foldable.instance_for(ArrayT))();
const canonical_list_foldable =
  /* @__PURE__ */ (() => Foldable.instance_for(List))();
const canonical_set_foldable =
  /* @__PURE__ */ (() => Foldable.instance_for(SetT))();
const canonical_map_foldable =
  /* @__PURE__ */ (() => Foldable.instance_for(MapT))();

const canonical_array_fold: unknown = /* @__PURE__ */ (() => ArrayT.fold)();
const canonical_list_fold: unknown = /* @__PURE__ */ (() => List.fold)();
const canonical_set_fold: unknown = /* @__PURE__ */ (() => SetT.fold)();
const canonical_map_fold: unknown = /* @__PURE__ */ (() => MapT.fold)();

const canonical_array_some: unknown =
  /* @__PURE__ */ (() => canonical_array_foldable[some_method])();
const canonical_list_some: unknown =
  /* @__PURE__ */ (() => canonical_list_foldable[some_method])();
const canonical_set_some: unknown =
  /* @__PURE__ */ (() => canonical_set_foldable[some_method])();
const canonical_map_some: unknown =
  /* @__PURE__ */ (() => canonical_map_foldable[some_method])();

const canonical_array_empty = /* @__PURE__ */ (() => ArrayT.empty)();
const canonical_array_pure: unknown = /* @__PURE__ */ (() => ArrayT.pure)();
const canonical_array_ap: unknown = /* @__PURE__ */ (() => ArrayT.ap)();
const canonical_array_map: unknown = /* @__PURE__ */ (() => ArrayT.map)();
const canonical_array_lift: unknown =
  /* @__PURE__ */ (() =>
    (ArrayT as unknown as Record<symbol, unknown>)[applicative_lift_method])();
const canonical_list_concat = /* @__PURE__ */ (() => List.concat)();
const canonical_list_empty = /* @__PURE__ */ (() => List.empty)();
const canonical_set_concat = /* @__PURE__ */ (() => SetT.concat)();
const canonical_set_empty = /* @__PURE__ */ (() => SetT.empty)();
const canonical_map_concat = /* @__PURE__ */ (() => MapT.concat)();
const canonical_map_empty = /* @__PURE__ */ (() => MapT.empty)();
const canonical_validation_pure: unknown =
  /* @__PURE__ */ (() => Validation.pure)();
const canonical_validation_ap: unknown =
  /* @__PURE__ */ (() => Validation.ap)();
const canonical_validation_map: unknown =
  /* @__PURE__ */ (() => Validation.map)();

const array_prototype_includes = Array.prototype.includes;
const identity_fn = <T>(value: T): T => value;
const return_undefined = (): undefined => undefined;
const keep_first = <first, second>(kept: first, _: second): first => kept;
const keep_second = <first, second>(_: first, kept: second): second => kept;
const count_step = (count: number): number => count + 1;
const add_step = (total: number, item: number): number => total + item;
const mul_step = (total: number, item: number): number => total * item;
const push_step = <T>(items: T[], item: T): T[] => {
  items.push(item);
  return items;
};

function is_canonical_array_fold(value: unknown): boolean {
  const v = value as Record<PropertyKey, unknown>;
  return v[kind] === array_kind &&
    v.fold === canonical_array_fold &&
    v[foldable_typeclass] === canonical_array_foldable &&
    canonical_array_foldable.fold === canonical_array_fold;
}

function is_canonical_list_fold(value: unknown): boolean {
  const v = value as Record<PropertyKey, unknown>;
  return v[kind] === list_kind &&
    v.fold === canonical_list_fold &&
    v[foldable_typeclass] === canonical_list_foldable &&
    canonical_list_foldable.fold === canonical_list_fold;
}

function is_canonical_set_fold(value: unknown): boolean {
  const v = value as Record<PropertyKey, unknown>;
  return v[kind] === set_kind &&
    v.fold === canonical_set_fold &&
    v[foldable_typeclass] === canonical_set_foldable &&
    canonical_set_foldable.fold === canonical_set_fold;
}

function is_canonical_map_fold(value: unknown): boolean {
  const v = value as Record<PropertyKey, unknown>;
  return v[kind] === map_kind &&
    v.fold === canonical_map_fold &&
    v[foldable_typeclass] === canonical_map_foldable &&
    canonical_map_foldable.fold === canonical_map_fold;
}

function list_to_array_raw<T>(list: RawList<T>): T[] {
  const out: T[] = [];
  let cur = list;
  while (cur[0] === "Cons") {
    out.push(cur[1]);
    cur = cur[2];
  }
  return out;
}

/** Haskell `join :: Monad m => m (m a) -> m a`. */
export function join<dictionary extends MonadDictionary<dictionary>, item>(
  value: Data<dictionary, Data<dictionary, item>>,
): Data<dictionary, item> {
  return Monad.bind(value, identity_fn);
}

/** Haskell `void :: Functor f => f a -> f ()`. */
export function voided<dictionary extends FunctorDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): Data<dictionary, undefined> {
  return Functor.map(value, return_undefined);
}

/** Haskell `when :: Applicative f => Bool -> f () -> f ()`. */
export function when<dictionary extends ApplicativeDictionary<dictionary>>(
  dictionary: ApplicativeDictionary<dictionary>,
  condition: boolean,
  action: Data<dictionary, void>,
): Data<dictionary, undefined> {
  if (condition) {
    return voided(action);
  }

  return Applicative.pure<dictionary, undefined>(
    dictionary as dictionary,
    undefined,
  );
}

/** Haskell `unless :: Applicative f => Bool -> f () -> f ()`. */
export function unless<dictionary extends ApplicativeDictionary<dictionary>>(
  dictionary: ApplicativeDictionary<dictionary>,
  condition: boolean,
  action: Data<dictionary, void>,
): Data<dictionary, undefined> {
  return when(dictionary, !condition, action);
}

/** Haskell `guard :: Alternative f => Bool -> f ()`. */
export function guard<dictionary extends AlternativeDictionary<dictionary>>(
  dictionary: AlternativeDictionary<dictionary>,
  condition: boolean,
): Data<dictionary, undefined> {
  if (condition) {
    return Applicative.pure<dictionary, undefined>(
      dictionary as dictionary,
      undefined,
    );
  }

  return Alternative.empty<dictionary, undefined>(dictionary as dictionary);
}

/** Haskell `<*`: sequence two effects and keep the value on the left. */
export function ap_first<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
>(
  left: Data<dictionary, first>,
  right: Data<dictionary, second>,
): Data<dictionary, first> {
  return Applicative.lift(keep_first<first, second>, left, right);
}

/** Haskell `*>`: sequence two effects and keep the value on the right. */
export function ap_second<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
>(
  left: Data<dictionary, first>,
  right: Data<dictionary, second>,
): Data<dictionary, second> {
  return Applicative.lift(keep_second<first, second>, left, right);
}

/** Sequence monadic computations and keep the right context. */
export function sequence_right<
  dictionary extends MonadDictionary<dictionary>,
  first,
  second,
>(
  left: Data<dictionary, first>,
  right: Data<dictionary, second>,
): Data<dictionary, second> {
  return Monad.bind(left, () => right);
}

/** Fold a structure from left to right. */
export function foldl<
  dictionary extends FoldableDictionary<dictionary>,
  item,
  result,
>(
  fn: (state: result, item: DataItem<dictionary, item>) => result,
  initial: result,
  value: Data<dictionary, item>,
): result {
  return Foldable.fold(value, initial, fn);
}

/** Haskell `foldMap :: Monoid m => (a -> m) -> t a -> m`. */
export function fold_map<
  dictionary extends FoldableDictionary<dictionary>,
  monoid extends MonoidDictionary<monoid>,
  item,
  result,
>(
  monoid: MonoidDictionary<monoid>,
  fn: (value: DataItem<dictionary, item>) => Data<monoid, result>,
  value: Data<dictionary, item>,
): Data<monoid, result> {
  const mk = (monoid as unknown as { [kind]?: unknown })[kind];
  if (
    mk === array_kind &&
    (monoid as unknown as typeof ArrayT).concat === array_concat_method &&
    (monoid as unknown as typeof ArrayT).empty === canonical_array_empty
  ) {
    const out: unknown[] = [];
    if (is_canonical_array_fold(value)) {
      const src = value.value() as readonly DataItem<dictionary, item>[];
      for (let i = 0; i < src.length; i += 1) {
        const part = fn(src[i]).value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
      }
    } else if (is_canonical_list_fold(value)) {
      let cur = value.value() as RawList<DataItem<dictionary, item>>;
      while (cur[0] === "Cons") {
        const part = fn(cur[1]).value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
        cur = cur[2];
      }
    } else if (is_canonical_set_fold(value)) {
      for (
        const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
      ) {
        const part = fn(item).value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
      }
    } else if (is_canonical_map_fold(value)) {
      for (
        const item of (value.value() as ReadonlyMap<
          unknown,
          DataItem<dictionary, item>
        >).values()
      ) {
        const part = fn(item).value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
      }
    } else {
      Foldable.fold(value, undefined, (_s, item) => {
        const part = fn(item).value() as readonly unknown[];
        for (let i = 0; i < part.length; i += 1) out.push(part[i]);
        return undefined;
      });
    }
    return as_data(ArrayT, out) as unknown as Data<monoid, result>;
  }
  if (
    mk === list_kind &&
    (monoid as unknown as typeof List).concat === canonical_list_concat &&
    (monoid as unknown as typeof List).empty === canonical_list_empty
  ) {
    const out: unknown[] = [];
    if (is_canonical_array_fold(value)) {
      const src = value.value() as readonly DataItem<dictionary, item>[];
      for (let i = 0; i < src.length; i += 1) {
        let cur = fn(src[i]).value() as RawList<unknown>;
        while (cur[0] === "Cons") {
          out.push(cur[1]);
          cur = cur[2];
        }
      }
    } else if (is_canonical_list_fold(value)) {
      let outer = value.value() as RawList<DataItem<dictionary, item>>;
      while (outer[0] === "Cons") {
        let cur = fn(outer[1]).value() as RawList<unknown>;
        while (cur[0] === "Cons") {
          out.push(cur[1]);
          cur = cur[2];
        }
        outer = outer[2];
      }
    } else if (is_canonical_set_fold(value)) {
      for (
        const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
      ) {
        let cur = fn(item).value() as RawList<unknown>;
        while (cur[0] === "Cons") {
          out.push(cur[1]);
          cur = cur[2];
        }
      }
    } else if (is_canonical_map_fold(value)) {
      for (
        const item of (value.value() as ReadonlyMap<
          unknown,
          DataItem<dictionary, item>
        >).values()
      ) {
        let cur = fn(item).value() as RawList<unknown>;
        while (cur[0] === "Cons") {
          out.push(cur[1]);
          cur = cur[2];
        }
      }
    } else {
      Foldable.fold(value, undefined, (_s, item) => {
        let cur = fn(item).value() as RawList<unknown>;
        while (cur[0] === "Cons") {
          out.push(cur[1]);
          cur = cur[2];
        }
        return undefined;
      });
    }
    return list_from_array(out) as unknown as Data<monoid, result>;
  }
  if (
    mk === set_kind &&
    (monoid as unknown as typeof SetT).concat === canonical_set_concat &&
    (monoid as unknown as typeof SetT).empty === canonical_set_empty
  ) {
    const out = new Set<unknown>();
    if (is_canonical_array_fold(value)) {
      const src = value.value() as readonly DataItem<dictionary, item>[];
      for (let i = 0; i < src.length; i += 1) {
        for (const el of fn(src[i]).value() as ReadonlySet<unknown>) {
          out.add(el);
        }
      }
    } else if (is_canonical_list_fold(value)) {
      let cur = value.value() as RawList<DataItem<dictionary, item>>;
      while (cur[0] === "Cons") {
        for (const el of fn(cur[1]).value() as ReadonlySet<unknown>) {
          out.add(el);
        }
        cur = cur[2];
      }
    } else if (is_canonical_set_fold(value)) {
      for (
        const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
      ) {
        for (const el of fn(item).value() as ReadonlySet<unknown>) out.add(el);
      }
    } else if (is_canonical_map_fold(value)) {
      for (
        const item of (value.value() as ReadonlyMap<
          unknown,
          DataItem<dictionary, item>
        >).values()
      ) {
        for (const el of fn(item).value() as ReadonlySet<unknown>) out.add(el);
      }
    } else {
      Foldable.fold(value, undefined, (_s, item) => {
        for (const el of fn(item).value() as ReadonlySet<unknown>) out.add(el);
        return undefined;
      });
    }
    return as_data(SetT, out) as unknown as Data<monoid, result>;
  }
  if (
    mk === map_kind &&
    (monoid as unknown as typeof MapT).concat === canonical_map_concat &&
    (monoid as unknown as typeof MapT).empty === canonical_map_empty
  ) {
    const out = new Map<unknown, unknown>();
    if (is_canonical_array_fold(value)) {
      const src = value.value() as readonly DataItem<dictionary, item>[];
      for (let i = 0; i < src.length; i += 1) {
        for (
          const [k, v] of fn(src[i]).value() as ReadonlyMap<unknown, unknown>
        ) out.set(k, v);
      }
    } else if (is_canonical_list_fold(value)) {
      let cur = value.value() as RawList<DataItem<dictionary, item>>;
      while (cur[0] === "Cons") {
        for (
          const [k, v] of fn(cur[1]).value() as ReadonlyMap<unknown, unknown>
        ) out.set(k, v);
        cur = cur[2];
      }
    } else if (is_canonical_set_fold(value)) {
      for (
        const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
      ) {
        for (
          const [k, v] of fn(item).value() as ReadonlyMap<unknown, unknown>
        ) out.set(k, v);
      }
    } else if (is_canonical_map_fold(value)) {
      for (
        const item of (value.value() as ReadonlyMap<
          unknown,
          DataItem<dictionary, item>
        >).values()
      ) {
        for (
          const [k, v] of fn(item).value() as ReadonlyMap<unknown, unknown>
        ) out.set(k, v);
      }
    } else {
      Foldable.fold(value, undefined, (_s, item) => {
        for (
          const [k, v] of fn(item).value() as ReadonlyMap<unknown, unknown>
        ) {
          out.set(k, v);
        }
        return undefined;
      });
    }
    return as_data(MapT, out) as unknown as Data<monoid, result>;
  }

  // Preserve exact left-to-right empty() + concat() order for custom monoids.
  let acc = Monoid.empty<monoid, result>(monoid as monoid);
  const sg_inst = (monoid as unknown as Record<symbol, unknown>)[
    semigroup_typeclass
  ] as
    | {
      concat: (
        this: Data<monoid, result>,
        right: Data<monoid, result>,
      ) => Data<monoid, result>;
    }
    | undefined;
  const sg_concat = sg_inst?.concat;

  const combine = (
    left: Data<monoid, result>,
    right: Data<monoid, result>,
  ): Data<monoid, result> => {
    if (
      sg_concat !== undefined &&
      (left as unknown as Record<symbol, unknown>)[semigroup_typeclass] ===
        sg_inst
    ) {
      return sg_concat.call(left, right);
    }
    return Semigroup.concat(left, right);
  };

  if (is_canonical_array_fold(value)) {
    const src = value.value() as readonly DataItem<dictionary, item>[];
    for (let i = 0; i < src.length; i += 1) acc = combine(acc, fn(src[i]));
    return acc;
  }
  if (is_canonical_list_fold(value)) {
    let cur = value.value() as RawList<DataItem<dictionary, item>>;
    while (cur[0] === "Cons") {
      acc = combine(acc, fn(cur[1]));
      cur = cur[2];
    }
    return acc;
  }
  if (is_canonical_set_fold(value)) {
    for (
      const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
    ) {
      acc = combine(acc, fn(item));
    }
    return acc;
  }
  if (is_canonical_map_fold(value)) {
    for (
      const item of (value.value() as ReadonlyMap<
        unknown,
        DataItem<dictionary, item>
      >).values()
    ) acc = combine(acc, fn(item));
    return acc;
  }
  return Foldable.fold(value, acc, (state, item) => combine(state, fn(item)));
}

/** Haskell `mconcat :: Monoid m => [m] -> m`. */
export function mconcat<
  dictionary extends FoldableDictionary<dictionary>,
  monoid extends MonoidDictionary<monoid>,
  item,
>(
  monoid: MonoidDictionary<monoid>,
  values: Data<dictionary, Data<monoid, item>>,
): Data<monoid, item> {
  const mk = (monoid as unknown as { [kind]?: unknown })[kind];
  if (
    mk === array_kind &&
    (monoid as unknown as typeof ArrayT).concat === array_concat_method &&
    (monoid as unknown as typeof ArrayT).empty === canonical_array_empty
  ) {
    if (is_canonical_array_fold(values)) {
      const src = values.value() as readonly Data<typeof ArrayT, item>[];
      const len = src.length;
      let total = 0;
      for (let i = 0; i < len; i += 1) {
        total += (src[i].value() as readonly unknown[]).length;
      }
      const out = new Array<unknown>(total);
      let pos = 0;
      for (let i = 0; i < len; i += 1) {
        const part = src[i].value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out[pos++] = part[j];
      }
      return as_data(ArrayT, out) as unknown as Data<monoid, item>;
    }
    const out: unknown[] = [];
    if (is_canonical_list_fold(values)) {
      let cur = values.value() as RawList<Data<typeof ArrayT, item>>;
      while (cur[0] === "Cons") {
        const part = cur[1].value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
        cur = cur[2];
      }
    } else if (is_canonical_set_fold(values)) {
      for (
        const entry of values.value() as ReadonlySet<Data<typeof ArrayT, item>>
      ) {
        const part = entry.value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
      }
    } else if (is_canonical_map_fold(values)) {
      for (
        const entry of (values.value() as ReadonlyMap<
          unknown,
          Data<typeof ArrayT, item>
        >).values()
      ) {
        const part = entry.value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
      }
    } else {
      Foldable.fold(values, undefined, (_s, entry) => {
        const part = (entry as Data<typeof ArrayT, item>)
          .value() as readonly unknown[];
        for (let j = 0; j < part.length; j += 1) out.push(part[j]);
        return undefined;
      });
    }
    return as_data(ArrayT, out) as unknown as Data<monoid, item>;
  }
  return fold_map(monoid, identity_fn, values);
}

/** Haskell `toList :: Foldable t => t a -> [a]`. */
export function to_array<
  dictionary extends FoldableDictionary<dictionary>,
  item,
>(
  value: Data<dictionary, item>,
): DataItem<dictionary, item>[] {
  if (is_canonical_array_fold(value)) {
    const src = value.value() as readonly DataItem<dictionary, item>[];
    const out = new Array<DataItem<dictionary, item>>(src.length);
    for (let i = 0; i < src.length; i += 1) out[i] = src[i];
    return out;
  }
  if (is_canonical_list_fold(value)) {
    return list_to_array_raw(
      value.value() as RawList<DataItem<dictionary, item>>,
    );
  }
  if (is_canonical_set_fold(value)) {
    return [...(value.value() as ReadonlySet<DataItem<dictionary, item>>)];
  }
  if (is_canonical_map_fold(value)) {
    return [
      ...(value.value() as ReadonlyMap<unknown, DataItem<dictionary, item>>)
        .values(),
    ];
  }
  return Foldable.fold(
    value,
    [] as DataItem<dictionary, item>[],
    push_step,
  );
}

/** Haskell `length :: Foldable t => t a -> Int`. */
export function length<dictionary extends FoldableDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): number {
  if (is_canonical_array_fold(value)) {
    return (value.value() as readonly unknown[]).length;
  }
  if (is_canonical_list_fold(value)) {
    let count = 0;
    let cur = value.value() as RawList<unknown>;
    while (cur[0] === "Cons") {
      count += 1;
      cur = cur[2];
    }
    return count;
  }
  if (is_canonical_set_fold(value)) {
    return (value.value() as ReadonlySet<unknown>).size;
  }
  if (is_canonical_map_fold(value)) {
    return (value.value() as ReadonlyMap<unknown, unknown>).size;
  }
  return Foldable.fold(value, 0, count_step);
}

/** Haskell `sum :: (Foldable t, Num a) => t a -> a`, specialized to number. */
export function sum<dictionary extends FoldableDictionary<dictionary>>(
  value:
    & Data<dictionary, number>
    & (DataItem<dictionary, number> extends number ? unknown : never),
): number {
  if (is_canonical_array_fold(value)) {
    const src = value.value() as readonly number[];
    let total = 0;
    for (let i = 0; i < src.length; i += 1) total += src[i];
    return total;
  }
  if (is_canonical_list_fold(value)) {
    let total = 0;
    let cur = value.value() as RawList<number>;
    while (cur[0] === "Cons") {
      total += cur[1];
      cur = cur[2];
    }
    return total;
  }
  if (is_canonical_set_fold(value)) {
    let total = 0;
    for (const item of value.value() as ReadonlySet<number>) total += item;
    return total;
  }
  if (is_canonical_map_fold(value)) {
    let total = 0;
    for (
      const item of (value.value() as ReadonlyMap<unknown, number>).values()
    ) {
      total += item;
    }
    return total;
  }
  return Foldable.fold(value, 0, add_step);
}

/** Haskell `product :: (Foldable t, Num a) => t a -> a`, specialized to number. */
export function product<dictionary extends FoldableDictionary<dictionary>>(
  value:
    & Data<dictionary, number>
    & (DataItem<dictionary, number> extends number ? unknown : never),
): number {
  if (is_canonical_array_fold(value)) {
    const src = value.value() as readonly number[];
    let total = 1;
    for (let i = 0; i < src.length; i += 1) total *= src[i];
    return total;
  }
  if (is_canonical_list_fold(value)) {
    let total = 1;
    let cur = value.value() as RawList<number>;
    while (cur[0] === "Cons") {
      total *= cur[1];
      cur = cur[2];
    }
    return total;
  }
  if (is_canonical_set_fold(value)) {
    let total = 1;
    for (const item of value.value() as ReadonlySet<number>) total *= item;
    return total;
  }
  if (is_canonical_map_fold(value)) {
    let total = 1;
    for (
      const item of (value.value() as ReadonlyMap<unknown, number>).values()
    ) {
      total *= item;
    }
    return total;
  }
  return Foldable.fold(value, 1, mul_step);
}

/** Haskell `elem :: (Foldable t, Eq a) => a -> t a -> Bool`. */
export function elem<dictionary extends FoldableDictionary<dictionary>, item>(
  item: NoInfer<DataItem<dictionary, item>>,
  value: Data<dictionary, item>,
): boolean;
/** Test membership using an explicit Eq dictionary for wrapped items. */
export function elem<
  dictionary extends FoldableDictionary<dictionary>,
  item_dictionary extends EqDictionary<item_dictionary>,
  item,
>(
  dictionary: EqDictionary<item_dictionary>,
  item: Data<item_dictionary, item>,
  value: Data<dictionary, Data<item_dictionary, item>>,
): boolean;
export function elem<
  dictionary extends FoldableDictionary<dictionary>,
  item_dictionary extends EqDictionary<item_dictionary>,
  item,
>(
  item_or_dictionary: item | EqDictionary<item_dictionary>,
  value_or_item: Data<dictionary, item> | Data<item_dictionary, item>,
  contextual_value?: Data<dictionary, Data<item_dictionary, item>>,
): boolean {
  if (contextual_value === undefined) {
    const expected = item_or_dictionary as item;
    const value = value_or_item as Data<dictionary, item>;
    if (
      is_canonical_set_fold(value) &&
      canonical_set_foldable[some_method] === canonical_set_some
    ) {
      if (Object.is(expected, -0)) return false;
      return (value.value() as ReadonlySet<item>).has(expected);
    }
    if (
      is_canonical_array_fold(value) &&
      canonical_array_foldable[some_method] === canonical_array_some
    ) {
      const arr = value.value() as readonly item[];
      if (expected !== 0) {
        return array_prototype_includes.call(arr, expected);
      }
      for (let i = 0; i < arr.length; i += 1) {
        if (Object.is(expected, arr[i])) return true;
      }
      return false;
    }
    if (
      is_canonical_list_fold(value) &&
      canonical_list_foldable[some_method] === canonical_list_some
    ) {
      let cur = value.value() as RawList<item>;
      while (cur[0] === "Cons") {
        if (Object.is(expected, cur[1])) return true;
        cur = cur[2];
      }
      return false;
    }
    if (
      is_canonical_map_fold(value) &&
      canonical_map_foldable[some_method] === canonical_map_some
    ) {
      for (
        const current of (value.value() as ReadonlyMap<unknown, item>).values()
      ) {
        if (Object.is(expected, current)) return true;
      }
      return false;
    }
    return Foldable.some(value, (current) => Object.is(expected, current));
  }

  const expected = value_or_item as Data<item_dictionary, item>;
  if (
    is_canonical_array_fold(contextual_value) &&
    canonical_array_foldable[some_method] === canonical_array_some
  ) {
    const arr = contextual_value.value() as readonly Data<
      item_dictionary,
      item
    >[];
    if (arr.length === 0) return false;
    const eq_fn = Eq.instance_for(expected).eq<item>;
    for (let i = 0; i < arr.length; i += 1) {
      if (eq_fn.call(expected, arr[i])) return true;
    }
    return false;
  }
  if (
    is_canonical_list_fold(contextual_value) &&
    canonical_list_foldable[some_method] === canonical_list_some
  ) {
    let cur = contextual_value.value() as RawList<Data<item_dictionary, item>>;
    if (cur[0] === "Nil") return false;
    const eq_fn = Eq.instance_for(expected).eq<item>;
    while (cur[0] === "Cons") {
      if (eq_fn.call(expected, cur[1])) return true;
      cur = cur[2];
    }
    return false;
  }
  if (
    is_canonical_set_fold(contextual_value) &&
    canonical_set_foldable[some_method] === canonical_set_some
  ) {
    const set = contextual_value.value() as ReadonlySet<
      Data<item_dictionary, item>
    >;
    if (set.size === 0) return false;
    const eq_fn = Eq.instance_for(expected).eq<item>;
    for (const current of set) {
      if (eq_fn.call(expected, current)) return true;
    }
    return false;
  }
  if (
    is_canonical_map_fold(contextual_value) &&
    canonical_map_foldable[some_method] === canonical_map_some
  ) {
    const map = contextual_value.value() as ReadonlyMap<
      unknown,
      Data<item_dictionary, item>
    >;
    if (map.size === 0) return false;
    const eq_fn = Eq.instance_for(expected).eq<item>;
    for (const current of map.values()) {
      if (eq_fn.call(expected, current)) return true;
    }
    return false;
  }

  let cached_eq:
    | ((
      this: Data<item_dictionary, item>,
      right: Data<item_dictionary, item>,
    ) => boolean)
    | undefined;
  return Foldable.some(contextual_value, (current) => {
    cached_eq ??= Eq.instance_for(expected).eq<item>;
    return cached_eq.call(
      expected,
      current as Data<item_dictionary, item>,
    );
  });
}

/** Traverse a structure with an applicative-producing function. */
export function traverse<
  dictionary extends TraversableDictionary<dictionary>,
  applicative extends ApplicativeDictionary<applicative>,
  from,
  to,
>(
  fn: (value: from) => Data<applicative, to>,
  applicative: ApplicativeDictionary<applicative>,
  value: Data<dictionary, from>,
): Data<applicative, Data<dictionary, to>> {
  return Traversable.traverse<dictionary, applicative, from, to>(
    value,
    applicative as applicative,
    fn,
  );
}

/** Haskell `traverse_ :: (Foldable t, Applicative f) => (a -> f b) -> t a -> f ()`. */
export function traverse_<
  dictionary extends FoldableDictionary<dictionary>,
  applicative extends ApplicativeDictionary<applicative>,
  item,
>(
  fn: (value: DataItem<dictionary, item>) => Data<applicative, unknown>,
  applicative: ApplicativeDictionary<applicative>,
  value: Data<dictionary, item>,
): Data<applicative, undefined> {
  const dict = applicative as unknown as {
    readonly [kind]?: unknown;
    readonly [do_runner_method]?: FastDoSpec | ((...args: never[]) => unknown);
    readonly [applicative_lift_method]?: unknown;
    readonly pure?: unknown;
    readonly ap?: unknown;
    readonly map?: unknown;
  };
  const spec = dict[do_runner_method];
  if (Array.isArray(spec) && dict.pure === spec[4]) {
    const [mode, wrap] = spec;
    const fail_tag = mode === 0 ? "Nothing" : "Left";
    let failed: Data<applicative, unknown> | undefined;
    const step = (item: DataItem<dictionary, item>) => {
      const current = fn(item);
      if (mode !== 2 && failed === undefined) {
        const raw = current.value() as readonly [string, unknown];
        if (raw[0] === fail_tag) failed = current;
      }
    };
    if (is_canonical_array_fold(value)) {
      const src = value.value() as readonly DataItem<dictionary, item>[];
      for (let i = 0; i < src.length; i += 1) step(src[i]);
    } else if (is_canonical_list_fold(value)) {
      let cur = value.value() as RawList<DataItem<dictionary, item>>;
      while (cur[0] === "Cons") {
        step(cur[1]);
        cur = cur[2];
      }
    } else if (is_canonical_set_fold(value)) {
      for (
        const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
      ) {
        step(item);
      }
    } else if (is_canonical_map_fold(value)) {
      for (
        const item of (value.value() as ReadonlyMap<
          unknown,
          DataItem<dictionary, item>
        >).values()
      ) step(item);
    } else {
      Foldable.fold(value, undefined, (_s, item) => {
        step(item);
        return undefined;
      });
    }
    return (failed ?? wrap(undefined)) as Data<applicative, undefined>;
  }

  const ak = dict[kind];
  if (
    ak === array_kind &&
    dict.pure === canonical_array_pure &&
    dict.ap === canonical_array_ap &&
    dict.map === canonical_array_map &&
    dict[applicative_lift_method] === canonical_array_lift
  ) {
    let count = 1;
    if (is_canonical_array_fold(value)) {
      const src = value.value() as readonly DataItem<dictionary, item>[];
      for (let i = 0; i < src.length; i += 1) {
        count *= (fn(src[i]).value() as readonly unknown[]).length;
      }
    } else if (is_canonical_list_fold(value)) {
      let cur = value.value() as RawList<DataItem<dictionary, item>>;
      while (cur[0] === "Cons") {
        count *= (fn(cur[1]).value() as readonly unknown[]).length;
        cur = cur[2];
      }
    } else if (is_canonical_set_fold(value)) {
      for (
        const item of value.value() as ReadonlySet<DataItem<dictionary, item>>
      ) {
        count *= (fn(item).value() as readonly unknown[]).length;
      }
    } else if (is_canonical_map_fold(value)) {
      for (
        const item of (value.value() as ReadonlyMap<
          unknown,
          DataItem<dictionary, item>
        >).values()
      ) count *= (fn(item).value() as readonly unknown[]).length;
    } else {
      Foldable.fold(value, undefined, (_s, item) => {
        count *= (fn(item).value() as readonly unknown[]).length;
        return undefined;
      });
    }
    return as_data(
      ArrayT,
      count === 0 ? [] : new Array<undefined>(count).fill(undefined),
    ) as unknown as Data<applicative, undefined>;
  }

  // Direct O(N) flat traversal for registered Applicatives (Task, State, Reader,
  // Writer, Stm, Validation and their keyed/configured variants) on materialized Foldables.
  if (
    typeof spec === "function" ||
    (ak === validation_identity &&
      dict.pure === canonical_validation_pure &&
      dict.ap === canonical_validation_ap &&
      dict.map === canonical_validation_map)
  ) {
    let materialized: Iterable<DataItem<dictionary, item>> | undefined;
    if (is_canonical_array_fold(value)) {
      materialized = value.value() as readonly DataItem<dictionary, item>[];
    } else if (is_canonical_set_fold(value)) {
      materialized = value.value() as ReadonlySet<DataItem<dictionary, item>>;
    } else if (is_canonical_map_fold(value)) {
      materialized = (value.value() as ReadonlyMap<
        unknown,
        DataItem<dictionary, item>
      >).values();
    } else if (is_canonical_list_fold(value)) {
      materialized = list_to_array_raw(
        value.value() as RawList<DataItem<dictionary, item>>,
      );
    }
    if (materialized !== undefined) {
      return traverse_items_into(
        materialized,
        applicative as applicative,
        fn,
        return_undefined,
      );
    }
  }

  // Merge equally sized groups as a binary carry. Callbacks still run in the
  // source's fold order, while deferred execution needs only logarithmic depth.
  const pending: (Data<applicative, undefined> | undefined)[] = [];

  Foldable.fold(value, undefined, (_state, item) => {
    let action = voided<applicative>(fn(item));
    let level = 0;

    while (true) {
      const earlier = pending[level];
      if (earlier === undefined) break;
      action = ap_second(earlier, action);
      pending[level] = undefined;
      level += 1;
    }

    pending[level] = action;
    return undefined;
  });

  let result: Data<applicative, undefined> | undefined;

  for (let level = pending.length - 1; level >= 0; level -= 1) {
    const action = pending[level];
    if (action !== undefined) {
      if (result === undefined) result = action;
      else result = ap_second(result, action);
    }
  }

  return result ?? Applicative.pure<applicative, undefined>(
    applicative as applicative,
    undefined,
  );
}

/** Turn a structure of applicative values into an applicative structure. */
export function sequence<
  dictionary extends TraversableDictionary<dictionary>,
  applicative extends ApplicativeDictionary<applicative>,
  item,
>(
  applicative: ApplicativeDictionary<applicative>,
  value: Data<dictionary, Data<applicative, item>>,
): Data<applicative, Data<dictionary, item>> {
  return Traversable.traverse<
    dictionary,
    applicative,
    Data<applicative, item>,
    item
  >(
    value,
    applicative as applicative,
    identity_fn,
  );
}

/** Render a value through its Show instance. */
export function show<dictionary extends ShowDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): string {
  return Show.show(value);
}

/** Test equality through an Eq instance. */
export function eq<dictionary extends EqDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Eq.eq(left, right);
}

/** Compare two values through an Ord instance. */
export function compare<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Ordering {
  return Ord.compare(left, right);
}

/** Test whether the left value is less than the right value. */
export function lt<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.lt(left, right);
}

/** Test whether the left value is less than or equal to the right value. */
export function lte<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.lte(left, right);
}

/** Test whether the left value is greater than the right value. */
export function gt<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.gt(left, right);
}

/** Test whether the left value is greater than or equal to the right value. */
export function gte<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.gte(left, right);
}

/** Return the lesser of two values according to their Ord instance. */
export function min<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Ord.min(left, right);
}

/** Return the greater of two values according to their Ord instance. */
export function max<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Ord.max(left, right);
}

/** Append two values through their Semigroup instance. */
export const concat: typeof Semigroup.concat = Semigroup.concat;

/** Choose between two alternatives. */
export function alt<
  dictionary extends AlternativeDictionary<dictionary>,
  item,
>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Alternative.alt(left, right);
}

/** Stop reducing as soon as the callback returns a Done step. */
export const fold_while: typeof Foldable.fold_while = Foldable.fold_while;
/** Test whether any item satisfies the predicate, stopping on the first match. */
export const some: typeof Foldable.some = Foldable.some;
/** Find the first matching item, stopping the traversal immediately. */
export const find: typeof Foldable.find = Foldable.find;
/** Explicit monadic traversal that admits later callbacks after success. */
export { traverse_sequential } from "./traversal.ts";

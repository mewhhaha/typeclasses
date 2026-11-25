import { array_concat_method, ArrayT } from "./array.ts";
import { from_array as list_from_array, List, type RawList } from "./list.ts";
import { MapT } from "./map.ts";
import { SetT } from "./set.ts";
import { as_data, type Data, type DataItem, kind } from "./typeclass.ts";
import { do_runner_method, type FastDoSpec } from "./typeclasses/monad.ts";
export { from_maybe, maybe, to_either, to_nullable } from "./maybe.ts";
export { either, from_left, from_right, hush, note } from "./either.ts";
import {
  Alternative,
  type Alternative as AlternativeDictionary,
  Applicative,
  type Applicative as ApplicativeDictionary,
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

const canonical_array_fold: unknown = /* @__PURE__ */ (() => ArrayT.fold)();
const canonical_set_fold: unknown = /* @__PURE__ */ (() => SetT.fold)();
const canonical_map_fold: unknown = /* @__PURE__ */ (() => MapT.fold)();
const canonical_array_empty = /* @__PURE__ */ (() => ArrayT.empty)();
const canonical_list_concat = /* @__PURE__ */ (() => List.concat)();
const canonical_list_empty = /* @__PURE__ */ (() => List.empty)();
const canonical_set_concat = /* @__PURE__ */ (() => SetT.concat)();
const canonical_set_empty = /* @__PURE__ */ (() => SetT.empty)();
const canonical_map_concat = /* @__PURE__ */ (() => MapT.concat)();
const canonical_map_empty = /* @__PURE__ */ (() => MapT.empty)();
const identity_fn = <T>(value: T): T => value;
const return_undefined = (): undefined => undefined;
const keep_first = <first, second>(kept: first, _: second): first => kept;
const keep_second = <first, second>(_: first, kept: second): second => kept;

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
    mk === ArrayT[kind] &&
    (monoid as unknown as typeof ArrayT).concat === array_concat_method &&
    (monoid as unknown as typeof ArrayT).empty === canonical_array_empty
  ) {
    const out: unknown[] = [];
    Foldable.fold(value, undefined, (_s, item) => {
      const part = fn(item).value() as readonly unknown[];
      for (let i = 0; i < part.length; i += 1) out.push(part[i]);
      return undefined;
    });
    return as_data(ArrayT, out) as unknown as Data<monoid, result>;
  }
  if (
    mk === List[kind] &&
    (monoid as unknown as typeof List).concat === canonical_list_concat &&
    (monoid as unknown as typeof List).empty === canonical_list_empty
  ) {
    const out: unknown[] = [];
    Foldable.fold(value, undefined, (_s, item) => {
      let cur = fn(item).value() as RawList<unknown>;
      while (cur[0] === "Cons") {
        out.push(cur[1]);
        cur = cur[2];
      }
      return undefined;
    });
    return list_from_array(out) as unknown as Data<monoid, result>;
  }
  if (
    mk === SetT[kind] &&
    (monoid as unknown as typeof SetT).concat === canonical_set_concat &&
    (monoid as unknown as typeof SetT).empty === canonical_set_empty
  ) {
    const out = new Set<unknown>();
    Foldable.fold(value, undefined, (_s, item) => {
      for (const el of fn(item).value() as ReadonlySet<unknown>) out.add(el);
      return undefined;
    });
    return as_data(SetT, out) as unknown as Data<monoid, result>;
  }
  if (
    mk === MapT[kind] &&
    (monoid as unknown as typeof MapT).concat === canonical_map_concat &&
    (monoid as unknown as typeof MapT).empty === canonical_map_empty
  ) {
    const out = new Map<unknown, unknown>();
    Foldable.fold(value, undefined, (_s, item) => {
      for (const [k, v] of fn(item).value() as ReadonlyMap<unknown, unknown>) {
        out.set(k, v);
      }
      return undefined;
    });
    return as_data(MapT, out) as unknown as Data<monoid, result>;
  }
  return Foldable.fold(
    value,
    Monoid.empty<monoid, result>(monoid as monoid),
    (acc, item) => Semigroup.concat(acc, fn(item)),
  );
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
  return fold_map(monoid, identity_fn, values);
}

/** Haskell `toList :: Foldable t => t a -> [a]`. */
export function to_array<
  dictionary extends FoldableDictionary<dictionary>,
  item,
>(
  value: Data<dictionary, item>,
): DataItem<dictionary, item>[] {
  const vk = (value as unknown as { [kind]?: unknown })[kind];
  if (vk === ArrayT[kind] && value.fold === canonical_array_fold) {
    const src = value.value() as readonly DataItem<dictionary, item>[];
    const out = new Array<DataItem<dictionary, item>>(src.length);
    for (let i = 0; i < src.length; i += 1) out[i] = src[i];
    return out;
  }
  if (vk === SetT[kind] && value.fold === canonical_set_fold) {
    return [...(value.value() as ReadonlySet<DataItem<dictionary, item>>)];
  }
  if (vk === MapT[kind] && value.fold === canonical_map_fold) {
    return [
      ...(value.value() as ReadonlyMap<unknown, DataItem<dictionary, item>>)
        .values(),
    ];
  }
  return Foldable.fold(
    value,
    [] as DataItem<dictionary, item>[],
    (items, item) => {
      items.push(item);
      return items;
    },
  );
}

/** Haskell `length :: Foldable t => t a -> Int`. */
export function length<dictionary extends FoldableDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): number {
  const vk = (value as unknown as { [kind]?: unknown })[kind];
  if (vk === ArrayT[kind] && value.fold === canonical_array_fold) {
    return (value.value() as readonly unknown[]).length;
  }
  if (vk === SetT[kind] && value.fold === canonical_set_fold) {
    return (value.value() as ReadonlySet<unknown>).size;
  }
  if (vk === MapT[kind] && value.fold === canonical_map_fold) {
    return (value.value() as ReadonlyMap<unknown, unknown>).size;
  }
  return Foldable.fold(value, 0, (count) => count + 1);
}

/** Haskell `sum :: (Foldable t, Num a) => t a -> a`, specialized to number. */
export function sum<dictionary extends FoldableDictionary<dictionary>>(
  value:
    & Data<dictionary, number>
    & (DataItem<dictionary, number> extends number ? unknown : never),
): number {
  return Foldable.fold(value, 0, (total, item) => total + item);
}

/** Haskell `product :: (Foldable t, Num a) => t a -> a`, specialized to number. */
export function product<dictionary extends FoldableDictionary<dictionary>>(
  value:
    & Data<dictionary, number>
    & (DataItem<dictionary, number> extends number ? unknown : never),
): number {
  return Foldable.fold(value, 1, (total, item) => total * item);
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

    return Foldable.some(value, (current) => Object.is(expected, current));
  }

  const expected = value_or_item as Data<item_dictionary, item>;

  return Foldable.some(contextual_value, (current) => Eq.eq(expected, current));
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
    readonly [do_runner_method]?: FastDoSpec;
    readonly pure?: unknown;
  };
  const spec = dict[do_runner_method];
  if (Array.isArray(spec) && dict.pure === spec[4]) {
    const [mode, wrap] = spec;
    const fail_tag = mode === 0 ? "Nothing" : "Left";
    let failed: Data<applicative, unknown> | undefined;
    Foldable.fold(value, undefined, (_s, item) => {
      const current = fn(item);
      if (mode !== 2 && failed === undefined) {
        const raw = current.value() as readonly [string, unknown];
        if (raw[0] === fail_tag) failed = current;
      }
      return undefined;
    });
    return (failed ?? wrap(undefined)) as Data<applicative, undefined>;
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
  return Traversable.sequence<dictionary, applicative, item>(
    value,
    applicative as applicative,
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

import type { Data } from "./typeclass.ts";
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
  type MonadError as MonadErrorDictionary,
  Monoid,
  type Monoid as MonoidDictionary,
  Ord,
  type Ord as OrdDictionary,
  type Ordering,
  Semigroup,
  type Semigroup as SemigroupDictionary,
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
  dictionary extends MonadErrorDictionary<dictionary>,
  item,
>(
  dictionary: MonadErrorDictionary<dictionary>,
  error: unknown,
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

/** Lift a unary function into an applicative. */
export function lift_A<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  out,
>(
  fn: (first: first) => out,
  first: Data<dictionary, first>,
): Data<dictionary, out> {
  return Applicative.lift(fn, first);
}

/** Lift a binary function into an applicative. */
export function lift_A2<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
  out,
>(
  fn: (first: first, second: second) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
): Data<dictionary, out> {
  return Applicative.lift(fn, first, second);
}

/** Lift a ternary function into an applicative. */
export function lift_A3<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
  third,
  out,
>(
  fn: (first: first, second: second, third: third) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
  third: Data<dictionary, third>,
): Data<dictionary, out> {
  return Applicative.lift(fn, first, second, third);
}

/** Lift a four-argument function into an applicative. */
export function lift_A4<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
  third,
  fourth,
  out,
>(
  fn: (first: first, second: second, third: third, fourth: fourth) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
  third: Data<dictionary, third>,
  fourth: Data<dictionary, fourth>,
): Data<dictionary, out> {
  return Applicative.lift(fn, first, second, third, fourth);
}

/** Lift a five-argument function into an applicative. */
export function lift_A5<
  dictionary extends ApplicativeDictionary<dictionary>,
  first,
  second,
  third,
  fourth,
  fifth,
  out,
>(
  fn: (
    first: first,
    second: second,
    third: third,
    fourth: fourth,
    fifth: fifth,
  ) => out,
  first: Data<dictionary, first>,
  second: Data<dictionary, second>,
  third: Data<dictionary, third>,
  fourth: Data<dictionary, fourth>,
  fifth: Data<dictionary, fifth>,
): Data<dictionary, out> {
  return Applicative.lift(fn, first, second, third, fourth, fifth);
}

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

/** Haskell `join :: Monad m => m (m a) -> m a`. */
export function join<dictionary extends MonadDictionary<dictionary>, item>(
  value: Data<dictionary, Data<dictionary, item>>,
): Data<dictionary, item> {
  return Monad.bind(value, (inner) => inner);
}

/** Haskell `void :: Functor f => f a -> f ()`. */
export function voided<dictionary extends FunctorDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): Data<dictionary, undefined> {
  return Functor.map(value, () => undefined);
}

/** Haskell `when :: Applicative f => Bool -> f () -> f ()`. */
export function when<dictionary extends ApplicativeDictionary<dictionary>>(
  dictionary: ApplicativeDictionary<dictionary>,
  condition: boolean,
  action: Data<dictionary, undefined>,
): Data<dictionary, undefined> {
  if (condition) {
    return action;
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
  action: Data<dictionary, undefined>,
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
  return Applicative.lift((kept: first, _: second) => kept, left, right);
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
  return Applicative.lift((_: first, kept: second) => kept, left, right);
}

/** Haskell `>>`: sequence monadic computations and keep the right context. */
export function then<
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
  out,
>(
  fn: (state: out, item: item) => out,
  initial: out,
  value: Data<dictionary, item>,
): out {
  return Foldable.fold(value, initial, fn);
}

/** Haskell `foldMap :: Monoid m => (a -> m) -> t a -> m`. */
export function fold_map<
  dictionary extends FoldableDictionary<dictionary>,
  monoid extends MonoidDictionary<monoid>,
  item,
  out,
>(
  monoid: MonoidDictionary<monoid>,
  fn: (value: item) => Data<monoid, out>,
  value: Data<dictionary, item>,
): Data<monoid, out> {
  return Foldable.fold(
    value,
    Monoid.empty<monoid, out>(monoid as monoid),
    (state, item) => Semigroup.concat(state, fn(item)),
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
  return fold_map(monoid, (value) => value, values);
}

/** Haskell `toList :: Foldable t => t a -> [a]`. */
export function to_array<
  dictionary extends FoldableDictionary<dictionary>,
  item,
>(
  value: Data<dictionary, item>,
): item[] {
  return Foldable.fold(value, [] as item[], (items, item) => {
    items.push(item);
    return items;
  });
}

/** Haskell `length :: Foldable t => t a -> Int`. */
export function length<dictionary extends FoldableDictionary<dictionary>>(
  value: Data<dictionary, unknown>,
): number {
  return Foldable.fold(value, 0, (count) => count + 1);
}

/** Haskell `sum :: (Foldable t, Num a) => t a -> a`, specialized to number. */
export function sum<dictionary extends FoldableDictionary<dictionary>>(
  value: Data<dictionary, number>,
): number {
  return Foldable.fold(value, 0, (total, item) => total + item);
}

/** Haskell `product :: (Foldable t, Num a) => t a -> a`, specialized to number. */
export function product<dictionary extends FoldableDictionary<dictionary>>(
  value: Data<dictionary, number>,
): number {
  return Foldable.fold(value, 1, (total, item) => total * item);
}

/** Haskell `elem :: (Foldable t, Eq a) => a -> t a -> Bool`. */
export function elem<dictionary extends FoldableDictionary<dictionary>, item>(
  item: item,
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

    return Foldable.fold(
      value,
      false,
      (found, current) => found || Object.is(expected, current),
    );
  }

  const expected = value_or_item as Data<item_dictionary, item>;

  return Foldable.fold(
    contextual_value,
    false,
    (found, current) => found || Eq.eq(expected, current),
  );
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
  applicative: ApplicativeDictionary<applicative>,
  fn: (value: item) => Data<applicative, unknown>,
  value: Data<dictionary, item>,
): Data<applicative, undefined> {
  return Foldable.fold(
    value,
    Applicative.pure<applicative, undefined>(
      applicative as applicative,
      undefined,
    ),
    (state, item) => ap_second(state, Functor.map(fn(item), () => undefined)),
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

export function lt<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.lt(left, right);
}

export function lte<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.lte(left, right);
}

export function gt<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.gt(left, right);
}

export function gte<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): boolean {
  return Ord.gte(left, right);
}

export function min<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Ord.min(left, right);
}

export function max<dictionary extends OrdDictionary<dictionary>, item>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Ord.max(left, right);
}

/** Append two values through their Semigroup instance. */
export function append<
  dictionary extends SemigroupDictionary<dictionary>,
  item,
>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Semigroup.concat(left, right);
}

/** Alias for append, matching the library's Semigroup method name. */
export function concat<
  dictionary extends SemigroupDictionary<dictionary>,
  item,
>(
  left: Data<dictionary, item>,
  right: Data<dictionary, item>,
): Data<dictionary, item> {
  return Semigroup.concat(left, right);
}

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

/** @deprecated Use {@link throw_error}. */
export const throwError: typeof throw_error = throw_error;

/** @deprecated Use {@link lift_A}. */
export const liftA: typeof lift_A = lift_A;

/** @deprecated Use {@link lift_A2}. */
export const liftA2: typeof lift_A2 = lift_A2;

/** @deprecated Use {@link lift_A3}. */
export const liftA3: typeof lift_A3 = lift_A3;

/** @deprecated Use {@link lift_A4}. */
export const liftA4: typeof lift_A4 = lift_A4;

/** @deprecated Use {@link lift_A5}. */
export const liftA5: typeof lift_A5 = lift_A5;

/** @deprecated Use {@link ap_first}. */
export const apFirst: typeof ap_first = ap_first;

/** @deprecated Use {@link ap_second}. */
export const apSecond: typeof ap_second = ap_second;

/** @deprecated Use {@link fold_map}. */
export const foldMap: typeof fold_map = fold_map;

/** @deprecated Use {@link to_array}. */
export const toArray: typeof to_array = to_array;

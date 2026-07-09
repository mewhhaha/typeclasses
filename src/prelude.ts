import type { Data } from "./typeclass.ts";
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
export function throwError<
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
export function liftA<
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
export function liftA2<
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
export function liftA3<
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
export function liftA4<
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
export function liftA5<
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

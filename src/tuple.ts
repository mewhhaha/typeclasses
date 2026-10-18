import {
  type As,
  type Data,
  data,
  type Dictionary,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  Bifunctor,
  type BifunctorContext,
  Comonad,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  type Monoid as MonoidDictionary,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export const tuple_identity: unique symbol = /* @__PURE__ */ Symbol(
  "tuple_identity",
);

/** An immutable pair whose right component is the higher-kinded value. */
export type RawTuple<left, right> = readonly [left, right];

/** @ignore */
export interface TupleBifunctorContext extends BifunctorContext {
  readonly [type_data]: AsTuple<this[typeof type_item]>;
}

/** @ignore */
export interface AsTupleLambda<left = unknown> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawTuple<left, this[typeof type_item]>;
}

/** Dictionary type for tuples with a fixed left component. */
export interface AsTuple<left = unknown>
  extends
    As<AsTupleLambda<left>, typeof tuple_identity>,
    Show<AsTuple<left>>,
    Ord<AsTuple<left>>,
    Bifunctor<AsTuple<left>, left, TupleBifunctorContext>,
    Traversable<AsTuple<left>>,
    Comonad<AsTuple<left>> {
}

/** A wrapped tuple with explicit left and right component types. */
export type Tuple<left, right> = Data<AsTuple<left>, right>;

/** @ignore */
export interface AsTupleMonoidLambda<output extends Dictionary, left> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawTuple<
    Data<output, left>,
    this[typeof type_item]
  >;
}

/** Tuple dictionary configured to accumulate wrapped left values with a monoid. */
export interface AsTupleMonoid<
  output extends Dictionary,
  left,
> extends
  As<AsTupleMonoidLambda<output, left>, typeof tuple_identity>,
  Monad<AsTupleMonoid<output, left>> {
  /** Wrap a pair for the configured left-value dictionary. */
  <right>(
    value: RawTuple<Data<output, left>, right>,
  ): TupleMonoidValue<output, left, right>;
}

/** A tuple value whose wrapped left component accumulates monoidally. */
export type TupleMonoidValue<
  output extends Dictionary,
  left,
  right,
> = WrappedData<
  AsTupleMonoid<output, left>,
  RawTuple<Data<output, left>, right>,
  right
>;

/** A tuple dictionary configured with a monoid for its left component. */
export type TupleMonoidDictionary<
  output extends Dictionary,
  left,
> = AsTupleMonoid<output, left>;

/** A tuple dictionary specialized to one left-component type. */
export type TupleDictionary<left> = AsTuple<left>;

/** @ignore */
export type TupleConstructor =
  & {
    /** Wrap an immutable pair. */
    <left, right>(value: RawTuple<left, right>): Tuple<left, right>;
    /** Specialize tuple operations to one left-component type. */
    with_left<left>(): TupleDictionary<left>;
    /** Configure tuple applicative and monad operations to accumulate left values. */
    with_monoid<output extends MonoidDictionary<output>, left>(
      empty: Data<output, left>,
    ): TupleMonoidDictionary<output, left>;
  }
  & {
    readonly [key in keyof AsTuple<unknown>]: AsTuple<unknown>[key];
  };

/** Callable tuple dictionary with fixed-left and monoidal-left configurations. */
export const Tuple: TupleConstructor = /* @__PURE__ */ create_tuple();

function tuple_with_left<left>(): TupleDictionary<left> {
  return Tuple as unknown as TupleDictionary<left>;
}

function tuple_with_monoid<
  output extends MonoidDictionary<output>,
  left,
>(empty: Data<output, left>): TupleMonoidDictionary<output, left> {
  const dictionary = data<AsTupleMonoid<output, left>>(tuple_identity);

  Functor.instance(dictionary)({
    map(fn) {
      const [output, value] = this.value();
      return wrap(output, fn(value));
    },
  });

  Applicative.instance(dictionary)({
    pure(value) {
      return wrap(empty.empty(), value);
    },

    ap(value) {
      const [left_output, fn] = this.value();
      const [right_output, item] = value.value();

      return wrap(left_output.concat(right_output), fn(item));
    },
  });

  Monad.instance(dictionary)({
    bind(fn) {
      const [left_output, value] = this.value();
      const [right_output, item] = fn(value).value();

      return wrap(left_output.concat(right_output), item);
    },
  });

  return dictionary;

  function wrap<right>(
    output: Data<output, left>,
    value: right,
  ): TupleMonoidValue<output, left, right> {
    return dictionary([output, value] as const);
  }
}

/** Wrap two components as an immutable tuple value. */
export function tuple<left, right>(
  left: left,
  right: right,
): Tuple<left, right> {
  return Tuple([left, right] as const) as Tuple<left, right>;
}

/** Read the left component of a wrapped tuple. */
export function fst<left, right>(value: Tuple<left, right>): left {
  return value.value()[0];
}

/** Read the right component of a wrapped tuple. */
export function snd<left, right>(value: Tuple<left, right>): right {
  return value.value()[1];
}

/** Swap the components of a wrapped tuple. */
export function swap<left, right>(
  value: Tuple<left, right>,
): Tuple<right, left> {
  const [left, right] = value.value();

  return tuple(right, left);
}

function create_tuple(): TupleConstructor {
  const Tuple = data<AsTuple<unknown>>(
    tuple_identity,
  ) as unknown as TupleConstructor;

  Object.defineProperty(Tuple, "with_left", {
    value: tuple_with_left,
  });

  Object.defineProperty(Tuple, "with_monoid", {
    value: tuple_with_monoid,
  });

  Show.instance(Tuple)({
    show() {
      const [left, right] = this.value();

      return "Tuple(" + inspect(left) + ", " + inspect(right) + ")";
    },
  });

  Eq.instance(Tuple)({
    eq(right) {
      const [left_first, left_second] = this.value();
      const [right_first, right_second] = right.value();

      if (!Object.is(left_first, right_first)) {
        return false;
      }

      return Object.is(left_second, right_second);
    },
  });

  Ord.instance(Tuple)({
    compare(right) {
      const [left_first, left_second] = this.value();
      const [right_first, right_second] = right.value();
      const first_order = compare_unknown(left_first, right_first);

      switch (first_order) {
        case "eq":
          return compare_unknown(left_second, right_second);
        case "lt":
        case "gt":
          return first_order;
      }
    },
  });

  Bifunctor.instance(Tuple)({
    bimap<right, next_left, next_right>(
      this: Data<AsTuple<unknown>, right>,
      map_left: (value: unknown) => next_left,
      map_right: (value: right) => next_right,
    ) {
      const [left, right] = this.value();

      return tuple(map_left(left), map_right(right));
    },
  });

  Functor.instance(Tuple)({
    map(fn) {
      const [left, right] = this.value();

      return tuple(left, fn(right));
    },
  });

  Foldable.instance(Tuple)({
    fold(initial, fn) {
      const [_left, right] = this.value();

      return fn(initial, right);
    },
  });

  Traversable.instance(Tuple)({
    traverse(_applicative, fn) {
      const [left, right] = this.value();

      return Functor.map(fn(right), (value) => tuple(left, value));
    },
  });

  Comonad.instance(Tuple)({
    extract() {
      const [_left, right] = this.value();

      return right;
    },

    extend(fn) {
      const [left] = this.value();

      return tuple(left, fn(this));
    },
  });

  return Tuple;
}

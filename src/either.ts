import type { Matchable } from "./data_value.ts";
import {
  $slot,
  type As,
  type Data,
  data,
  tagged_payload,
  tagged_tag,
  tagged_value,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
  type WrappedData,
} from "./typeclass.ts";
import { same_context } from "./internal.ts";
import {
  Applicative,
  applicative_lift_method,
} from "./typeclasses/applicative.ts";
import { Bifunctor, type BifunctorContext } from "./typeclasses/bifunctor.ts";
import { compare_unknown, Ord } from "./typeclasses/ord.ts";
import { Eq } from "./typeclasses/eq.ts";
import { Foldable } from "./typeclasses/foldable.ts";
import { Functor } from "./typeclasses/functor.ts";
import { Monad, register_fast_do } from "./typeclasses/monad.ts";
import { MonadError } from "./typeclasses/monad_error.ts";
import { MonadRec } from "./typeclasses/monad_rec.ts";
import { Show } from "./typeclasses/show.ts";
import { Traversable } from "./typeclasses/traversable.ts";
import { Just, type Maybe, Nothing, to_either } from "./maybe.ts";
import { inspect } from "./inspect.ts";
import { loop_done, type LoopStep } from "./loop.ts";

/** @ignore */
export const either_identity: unique symbol = /* @__PURE__ */ Symbol(
  "either_identity",
);

/** A raw result containing either a left error or a right success value. */
export type RawEither<left, right> =
  | Left<left>
  | Right<right>;

/** The left branch of an Either value. */
export type Left<left = string> = readonly ["Left", left];
/** The right branch of an Either value. */
export type Right<right> = readonly ["Right", right];

/** @ignore */
// deno-lint-ignore no-explicit-any -- a bare Right is polymorphic in its left type
export type AnyLeft = any;

/** @ignore */
export interface EitherBifunctorContext extends BifunctorContext {
  readonly [type_data]: AsEither<this[typeof type_item]>;
}

/** @ignore */
export interface AsEitherLambda<left = AnyLeft> {
  readonly [type_item]: unknown;
  readonly [type_data]: RawEither<left, this[typeof type_item]>;
}

/** The callable Either dictionary for a fixed left type. */
export interface AsEither<left = AnyLeft>
  extends
    As<AsEitherLambda<left>, typeof either_identity>,
    Show<AsEither<left>>,
    MonadError<AsEither<left>, left>,
    MonadRec<AsEither<left>>,
    Traversable<AsEither<left>>,
    Bifunctor<AsEither<left>, left, EitherBifunctorContext>,
    Ord<AsEither<left>>,
    Matchable {
}

/** A wrapped Either value with instances attached. */
export type Either<left, right> = [left] extends [never] ? (
    & {
      map<next>(
        this: Either<never, right>,
        fn: (value: right) => next,
      ): Either<never, next>;
      bind<result extends Either<AnyLeft, unknown>>(
        this: Either<never, right>,
        fn: (value: right) => result,
      ): Either<
        EitherLeft<ReturnType<result["value"]>>,
        EitherRight<ReturnType<result["value"]>>
      >;
    }
    & WrappedData<AsEither<AnyLeft>, RawEither<never, right>, right>
  )
  : Data<AsEither<left>, right>;

/** An Either dictionary specialized to one left type. */
export type EitherDictionary<left> = UnionDictionary<AsEither<left>>;

/** @ignore */
export type EitherLeft<value> = value extends Left<infer left> ? left : never;
/** @ignore */
export type EitherRight<value> = value extends Right<infer right> ? right
  : never;

/** The callable Either dictionary and its branch constructors. */
export type EitherConstructor =
  & {
    /** Infer both branches while wrapping a raw Either value. */
    <value extends RawEither<AnyLeft, AnyLeft>>(
      value: value,
    ): Either<EitherLeft<value>, EitherRight<value>>;
    /** Wrap a raw Either value with explicit branch types. */
    <left, right>(value: RawEither<left, right>): Either<left, right>;
    /** View the shared dictionary at a particular left type. */
    with_left<left>(): EitherDictionary<left>;
    /** Construct or recognize a left branch. */
    readonly Left: LeftConstructor;
    /** Construct or recognize a right branch. */
    readonly Right: RightConstructor;
  }
  & {
    readonly [key in keyof AsEither<unknown>]: AsEither<unknown>[key];
  };

/** A type guard that recognizes raw left branches. */
export type LeftGuard = {
  <value extends Either<AnyLeft, unknown>>(
    value: value,
  ): value is { value(): Left<EitherLeft<ReturnType<value["value"]>>> } & value;
  /** Narrow a known Either to its left branch. */
  <left, right>(value: RawEither<left, right>): value is Left<left>;
  /** Recognize a left branch at an untrusted boundary. */
  (
    value: unknown,
  ): value is
    | Left<unknown>
    | WrappedData<AsEither<unknown>, Left<unknown>, unknown>;
};

/** A type guard that recognizes raw right branches. */
export type RightGuard = {
  <value extends Either<AnyLeft, unknown>>(
    value: value,
  ): value is
    & { value(): Right<EitherRight<ReturnType<value["value"]>>> }
    & value;
  /** Narrow a known Either to its right branch. */
  <left, right>(value: RawEither<left, right>): value is Right<right>;
  /** Recognize a right branch at an untrusted boundary. */
  (
    value: unknown,
  ): value is
    | Right<unknown>
    | WrappedData<AsEither<unknown>, Right<unknown>, unknown>;
};

/** Construct a wrapped left branch. */
export type LeftConstructor = {
  /** Wrap an error value in the left branch. */
  <left = string, right = never>(
    value: left,
  ): Either<left, NoInfer<right>>;
  /** Test whether a raw value is a left branch. */
  readonly is: LeftGuard;
};

/** Construct a wrapped right branch. */
export type RightConstructor = {
  /** Wrap a success value with a polymorphic left type. */
  <right>(value: right): Either<never, right>;
  /** Wrap a success value with an explicit left type. */
  <left, right>(value: right): Either<left, right>;
  /** Test whether a raw value is a right branch. */
  readonly is: RightGuard;
};

/** The shared Either dictionary with left and right constructors. */
export const Either: EitherConstructor = /* @__PURE__ */ create_either();

/** Construct a wrapped right value. */
export const Right: RightConstructor = /* @__PURE__ */ (() => Either.Right)();
/** Construct a wrapped left value. */
export const Left: LeftConstructor = /* @__PURE__ */ (() => Either.Left)();

function either_with_left<left>(): EitherDictionary<left> {
  return Either as unknown as EitherDictionary<left>;
}

/** Narrow a raw Either value to its left branch. */
export function is_left<value extends Either<AnyLeft, unknown>>(
  value: value,
): value is { value(): Left<EitherLeft<ReturnType<value["value"]>>> } & value;
/** Test a raw Either for its Left variant. */
export function is_left<left, right>(
  value: RawEither<left, right>,
): value is Left<left>;
/** Test whether an unknown value is a raw left branch. */
export function is_left(
  value: unknown,
): value is
  | Left<unknown>
  | WrappedData<AsEither<unknown>, Left<unknown>, unknown>;
export function is_left<left, right>(
  value: RawEither<left, right> | unknown,
): value is
  | Left<left>
  | WrappedData<AsEither<unknown>, Left<unknown>, unknown> {
  return Left.is(value);
}

/** Narrow a raw Either value to its right branch. */
export function is_right<value extends Either<AnyLeft, unknown>>(
  value: value,
): value is { value(): Right<EitherRight<ReturnType<value["value"]>>> } & value;
/** Test a raw Either for its Right variant. */
export function is_right<left, right>(
  value: RawEither<left, right>,
): value is Right<right>;
/** Test whether an unknown value is a raw right branch. */
export function is_right(
  value: unknown,
): value is
  | Right<unknown>
  | WrappedData<AsEither<unknown>, Right<unknown>, unknown>;
export function is_right<left, right>(
  value: RawEither<left, right> | unknown,
): value is
  | Right<right>
  | WrappedData<AsEither<unknown>, Right<unknown>, unknown> {
  return Right.is(value);
}

/** Accept a finite number or return a descriptive left value. */
export function from_number(value: number): Either<string, number> {
  if (Number.isFinite(value)) {
    return Right<string, number>(value);
  }

  return Left<string, number>("Expected a finite number");
}

/** Haskell `either :: (a -> c) -> (b -> c) -> Either a b -> c`. */
export function either<left, right, result>(
  on_left: (value: left) => result,
  on_right: (value: right) => result,
  value: Either<left, right>,
): result {
  const item = unwrap_either<right>(value);
  return item === either_left ? on_left(take_left<left>()) : on_right(item);
}

/** Haskell `fromLeft :: a -> Either a b -> a`. */
export function from_left<left, right>(
  fallback: left,
  value: Either<left, right>,
): left {
  return unwrap_either(value) === either_left ? take_left<left>() : fallback;
}

/** Haskell `fromRight :: b -> Either a b -> b`. */
export function from_right<left, right>(
  fallback: right,
  value: Either<left, right>,
): right {
  const item = unwrap_right<right>(value);
  return item === either_left ? fallback : item;
}

/** Haskell `hush :: Either a b -> Maybe b`. */
export function hush<left, right>(
  value: Either<left, right>,
): Maybe<right> {
  const item = unwrap_right<right>(value);
  return item === either_left ? Nothing<right>() : Just(item);
}

/** Haskell `note :: e -> Maybe a -> Either e a`. */
export function note<left, right>(
  error: left,
  value: Maybe<right>,
): Either<left, right> {
  return to_either(error, value);
}

type TaggedEither = {
  readonly [tagged_tag]?: PropertyKey;
  readonly [tagged_payload]?: unknown;
  readonly [tagged_value]?: () => RawEither<unknown, unknown>;
  value(): RawEither<unknown, unknown>;
};

const either_left = /* @__PURE__ */ Symbol();
let left_payload: unknown;

function take_left<left = unknown>(): left {
  const value = left_payload;
  left_payload = undefined;
  return value as left;
}

function unwrap_right<item = unknown>(
  value: unknown,
): item | typeof either_left {
  const tagged = value as TaggedEither;
  const value_fn = tagged.value;
  if (value_fn !== undefined && value_fn === tagged[tagged_value]) {
    return tagged[tagged_tag] === "Right"
      ? tagged[tagged_payload] as item
      : either_left;
  }
  const raw = value_fn.call(tagged);
  return raw[0] === "Right" ? raw[1] as item : either_left;
}

function unwrap_either<item = unknown>(
  value: unknown,
): item | typeof either_left {
  const tagged = value as TaggedEither;
  const value_fn = tagged.value;
  if (value_fn !== undefined && value_fn === tagged[tagged_value]) {
    if (tagged[tagged_tag] === "Right") return tagged[tagged_payload] as item;
    left_payload = tagged[tagged_payload];
    return either_left;
  }
  const raw = value_fn.call(tagged);
  if (raw[0] === "Right") return raw[1] as item;
  left_payload = raw[1];
  return either_left;
}

const wrap_right = <to>(value: to): Data<AsEither<unknown>, to> =>
  Right<unknown, to>(value);

function lift_right<result>(
  fn: (...values: unknown[]) => result,
  first: unknown,
  rest: readonly WrappedData<AsEither, RawEither<unknown, unknown>, unknown>[],
): WrappedData<AsEither, RawEither<unknown, result>, result> {
  const len = rest.length;
  if (len === 0) return Right(fn(first));
  if (len === 1) {
    const a = unwrap_right(rest[0]);
    return a === either_left ? same_context(rest[0]) : Right(fn(first, a));
  }
  if (len === 2) {
    const a = unwrap_right(rest[0]);
    if (a === either_left) return same_context(rest[0]);
    const b = unwrap_right(rest[1]);
    return b === either_left ? same_context(rest[1]) : Right(fn(first, a, b));
  }

  const values = new Array<unknown>(len + 1);
  values[0] = first;
  for (let i = 0; i < len; i += 1) {
    const current = unwrap_right(rest[i]);
    if (current === either_left) return same_context(rest[i]);
    values[i + 1] = current;
  }

  return Right(fn(...values));
}

/** Chain results while explicitly allowing the error type to grow. */
export function bind_widen<
  left,
  item,
  result extends Either<AnyLeft, unknown>,
>(
  value: Either<left, item>,
  fn: (item: item) => result,
): Either<
  left | EitherLeft<ReturnType<result["value"]>>,
  EitherRight<ReturnType<result["value"]>>
> {
  type Output = Either<
    left | EitherLeft<ReturnType<result["value"]>>,
    EitherRight<ReturnType<result["value"]>>
  >;
  const item = unwrap_right<item>(value);
  return (item === either_left ? same_context(value) : fn(item)) as Output;
}

/** Map only the left error payload while leaving right values untouched. */
export function map_left<value extends Either<AnyLeft, unknown>, next_left>(
  value: value,
  fn: (error: EitherLeft<ReturnType<value["value"]>>) => next_left,
): Either<next_left, EitherRight<ReturnType<value["value"]>>> {
  type Output = Either<next_left, EitherRight<ReturnType<value["value"]>>>;
  return (unwrap_either(value) === either_left
    ? Left<next_left, EitherRight<ReturnType<value["value"]>>>(
      fn(take_left<EitherLeft<ReturnType<value["value"]>>>()),
    )
    : same_context(value)) as Output;
}

/** Execute `fn`, catching synchronous exceptions into the Left branch. */
export function try_catch<error, item>(
  fn: () => item,
  on_error: (cause: unknown) => error,
): Either<error, item> {
  try {
    return Right<error, item>(fn());
  } catch (cause) {
    return Left<error, item>(on_error(cause));
  }
}

/** Recover a result with a lazy fallback while retaining the successful type. */
export function recover_or_else<error, item, fallback>(
  value: Either<error, item>,
  fallback: (error: error) => fallback,
): item | fallback {
  const item = unwrap_either<item>(value);
  return item === either_left ? fallback(take_left<error>()) : item;
}

// Keep dictionary construction and instance installation in one removable unit.
function create_either(): EitherConstructor {
  const Either = data<AsEither<unknown>>(
    either_identity,
    union(["Left", $slot], ["Right", $slot]),
  ) as unknown as EitherConstructor;

  Object.defineProperty(Either, "with_left", {
    value: either_with_left,
  });

  Show.instance(Either)({
    show() {
      const item = unwrap_either(this);
      return item === either_left
        ? "Left(" + inspect(take_left()) + ")"
        : "Right(" + inspect(item) + ")";
    },
  });

  Eq.instance(Either)({
    eq(right) {
      if (this === right) return true;
      const a = unwrap_either(this);
      if (a === either_left) {
        const a_err = take_left();
        return unwrap_either(right) === either_left &&
          Object.is(a_err, take_left());
      }
      const b = unwrap_right(right);
      return b !== either_left && Object.is(a, b);
    },
  });

  Ord.instance(Either)({
    compare(right) {
      if (this === right) return "eq";
      const a = unwrap_either(this);
      if (a === either_left) {
        const a_err = take_left();
        return unwrap_either(right) === either_left
          ? compare_unknown(a_err, take_left())
          : "lt";
      }
      const b = unwrap_right(right);
      return b === either_left ? "gt" : compare_unknown(a, b);
    },
  });

  Bifunctor.instance(Either)({
    bimap<right, next_left, next_right>(
      this: Data<AsEither<unknown>, right>,
      map_left: (value: unknown) => next_left,
      map_right: (value: right) => next_right,
    ) {
      const item = unwrap_either<right>(this);
      return (item === either_left
        ? Left<next_left, next_right>(map_left(take_left()))
        : Right<next_left, next_right>(map_right(item))) as Data<
          AsEither<next_left>,
          next_right
        >;
    },
  });

  Functor.instance(Either)({
    map(fn) {
      const item = unwrap_right(this);
      return item === either_left
        ? same_context(this)
        : Right(fn(item as never));
    },
  });

  Applicative.instance(Either)({
    pure(value) {
      return Right(value);
    },

    // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
    [applicative_lift_method](fn, rest) {
      const item = unwrap_right(this);
      return item === either_left
        ? same_context(this)
        : lift_right(fn, item, rest);
    },

    ap(value) {
      const fn = unwrap_right<(arg: never) => unknown>(this);
      if (fn === either_left) return same_context(this);
      const item = unwrap_right(value);
      return item === either_left
        ? same_context(value)
        : Right(fn(item as never)) as never;
    },
  });

  Monad.instance(Either)({
    bind(fn) {
      const item = unwrap_right(this);
      return item === either_left ? same_context(this) : fn(item as never);
    },
  });

  MonadRec.instance(Either)({
    tail_rec_m<state, output>(
      initial: state,
      step: (
        state: state,
      ) => Data<AsEither<unknown>, LoopStep<state, output>>,
    ): Data<AsEither<unknown>, output> {
      let state = initial;

      while (true) {
        const current = step(state);
        const loop_step = unwrap_right<LoopStep<state, output>>(current);
        if (loop_step === either_left) return same_context(current);
        if (loop_step[0] === loop_done) return Right(loop_step[1]);
        state = loop_step[1];
      }
    },
  });

  MonadError.instance(Either)({
    throw_error<item>(
      this: AsEither<unknown>,
      error: unknown,
    ): Data<AsEither<unknown>, item> {
      return Left<unknown, item>(error);
    },

    catch_error(handler) {
      return unwrap_either(this) === either_left
        ? handler(take_left())
        : same_context(this);
    },
  });

  register_fast_do(Either, 1, Either.Right, Either.Left);

  Foldable.instance(Either)({
    fold(initial, fn) {
      const item = unwrap_right(this);
      return item === either_left ? initial : fn(initial, item as never);
    },
  });

  Traversable.instance(Either)({
    traverse<applicative extends Applicative<applicative>, from, to>(
      this: Data<AsEither<unknown>, from>,
      applicative: applicative,
      fn: (value: from) => Data<applicative, to>,
    ): Data<applicative, Data<AsEither<unknown>, to>> {
      const item = unwrap_right<from>(this);
      return item === either_left
        ? Applicative.pure(applicative, same_context(this))
        : Functor.map(fn(item), wrap_right);
    },
  });
  return Either;
}

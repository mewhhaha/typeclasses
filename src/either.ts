import {
  $slot,
  type As,
  type Data,
  data,
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
  Bifunctor,
  type BifunctorContext,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  MonadError,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";
import { Just, type MaybeValue, Nothing } from "./maybe.ts";
import { inspect } from "./inspect.ts";

/** @ignore */
export declare const either_identity: unique symbol;

/** A raw result containing either a left error or a right success value. */
export type Either<left, right> =
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

/** The callable Either dictionary for a fixed left type. */
export interface AsEither<left = AnyLeft>
  extends
    As<AsEither<left>, typeof either_identity>,
    Show<AsEither<left>>,
    MonadError<AsEither<left>, left>,
    Traversable<AsEither<left>>,
    Bifunctor<AsEither<left>, left, EitherBifunctorContext>,
    Ord<AsEither<left>> {
  /** The right value supplied when applying this data type. */
  readonly [type_item]: unknown;
  /** The raw Either shape produced for the selected right value. */
  readonly [type_data]: Either<left, this[typeof type_item]>;
}

/** A wrapped Either value with instances attached. */
export type EitherValue<left, right> = [left] extends [never]
  ? WrappedData<AsEither<AnyLeft>, Either<never, right>, right>
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
    <value extends Either<AnyLeft, AnyLeft>>(
      value: value,
    ): EitherValue<EitherLeft<value>, EitherRight<value>>;
    /** Wrap a raw Either value with explicit branch types. */
    <left, right>(value: Either<left, right>): EitherValue<left, right>;
    /** View the shared dictionary at a particular left type. */
    with_left<left>(): EitherDictionary<left>;
    /** @deprecated Use with_left. */
    withLeft<left>(): EitherDictionary<left>;
  }
  & {
    readonly [key in keyof UnionDictionary<AsEither<unknown>>]: UnionDictionary<
      AsEither<unknown>
    >[key];
  };

/** A type guard that recognizes raw left branches. */
export type LeftGuard = {
  /** Narrow a known Either to its left branch. */
  <left, right>(value: Either<left, right>): value is Left<left>;
  /** Recognize a left branch at an untrusted boundary. */
  (value: unknown): value is Left<unknown>;
};

/** A type guard that recognizes raw right branches. */
export type RightGuard = {
  /** Narrow a known Either to its right branch. */
  <left, right>(value: Either<left, right>): value is Right<right>;
  /** Recognize a right branch at an untrusted boundary. */
  (value: unknown): value is Right<unknown>;
};

/** Construct a wrapped left branch. */
export type LeftConstructor = {
  /** Wrap an error value in the left branch. */
  <left = string, right = never>(value: left): EitherValue<left, right>;
  /** Test whether a raw value is a left branch. */
  readonly is: LeftGuard;
};

/** Construct a wrapped right branch. */
export type RightConstructor = {
  /** Wrap a success value with a polymorphic left type. */
  <right>(value: right): EitherValue<never, right>;
  /** Wrap a success value with an explicit left type. */
  <left, right>(value: right): EitherValue<left, right>;
  /** Test whether a raw value is a right branch. */
  readonly is: RightGuard;
};

/** The shared Either dictionary with left and right constructors. */
export const Either = data<AsEither<unknown>>(
  union(["Left", $slot], ["Right", $slot]),
) as EitherConstructor;

Object.defineProperty(Either, "with_left", {
  value: either_with_left,
});

Object.defineProperty(Either, "withLeft", {
  value: either_with_left,
});

/** Construct a wrapped right value. */
export const Right: RightConstructor = Object.assign(construct_right, {
  is: is_right,
});
/** Construct a wrapped left value. */
export const Left: LeftConstructor = Object.assign(construct_left, {
  is: is_left,
});

function either_with_left<left>(): EitherDictionary<left> {
  return Either as unknown as EitherDictionary<left>;
}

/** Narrow a raw Either value to its left branch. */
export function is_left<left, right>(
  value: Either<left, right>,
): value is Left<left>;
/** Test whether an unknown value is a raw left branch. */
export function is_left(value: unknown): value is Left<unknown>;
export function is_left<left, right>(
  value: Either<left, right> | unknown,
): value is Left<left> {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.length === 2 && value[0] === "Left";
}

/** Narrow a raw Either value to its right branch. */
export function is_right<left, right>(
  value: Either<left, right>,
): value is Right<right>;
/** Test whether an unknown value is a raw right branch. */
export function is_right(value: unknown): value is Right<unknown>;
export function is_right<left, right>(
  value: Either<left, right> | unknown,
): value is Right<right> {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.length === 2 && value[0] === "Right";
}

function construct_left<left = string, right = never>(
  value: left,
): EitherValue<left, right> {
  return Either<left, right>([
    "Left",
    value,
  ]);
}

function construct_right<right>(value: right): EitherValue<never, right>;
function construct_right<left, right>(
  value: right,
): EitherValue<left, right>;
function construct_right<left, right>(
  value: right,
): EitherValue<left, right> {
  return Either<left, right>([
    "Right",
    value,
  ]) as EitherValue<left, right>;
}

/** Accept a finite number or return a descriptive left value. */
export function from_number(value: number): EitherValue<string, number> {
  if (Number.isFinite(value)) {
    return Right<string, number>(value);
  }

  return Left<string, number>("Expected a finite number");
}

/** Haskell `either :: (a -> c) -> (b -> c) -> Either a b -> c`. */
export function either<left, right, result>(
  on_left: (value: left) => result,
  on_right: (value: right) => result,
  value: EitherValue<left, right>,
): result {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Left":
      return on_left(payload as left);
    case "Right":
      return on_right(payload as right);
  }
}

/** Haskell `fromLeft :: a -> Either a b -> a`. */
export function from_left<left, right>(
  fallback: left,
  value: EitherValue<left, right>,
): left {
  return either((error) => error, () => fallback, value);
}

/** Haskell `fromRight :: b -> Either a b -> b`. */
export function from_right<left, right>(
  fallback: right,
  value: EitherValue<left, right>,
): right {
  return either(() => fallback, (item) => item, value);
}

/** Haskell `hush :: Either a b -> Maybe b`. */
export function hush<left, right>(
  value: EitherValue<left, right>,
): MaybeValue<right> {
  return either(() => Nothing<right>(), (item) => Just(item), value);
}

/** Haskell `note :: e -> Maybe a -> Either e a`. */
export function note<left, right>(
  error: left,
  value: MaybeValue<right>,
): EitherValue<left, right> {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Just":
      return Right<left, right>(payload);
    case "Nothing":
      return Left<left, right>(error);
  }
}

Show.instance(Either)({
  show() {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Right":
        return "Right(" + inspect(payload) + ")";
      case "Left":
        return "Left(" + inspect(payload) + ")";
    }
  },
});

Eq.instance(Either)({
  eq(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "Left":
        if (right_tag === "Left") {
          return Object.is(left_payload, right_payload);
        }

        return false;
      case "Right":
        if (right_tag === "Left") {
          return false;
        }

        return Object.is(left_payload, right_payload);
    }
  },
});

Ord.instance(Either)({
  compare(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "Left":
        if (right_tag === "Left") {
          return compare_unknown(left_payload, right_payload);
        }

        return "lt";
      case "Right":
        if (right_tag === "Left") {
          return "gt";
        }

        return compare_unknown(left_payload, right_payload);
    }
  },
});

Bifunctor.instance(Either)({
  bimap<right, next_left, next_right>(
    this: Data<AsEither<unknown>, right>,
    map_left: (value: unknown) => next_left,
    map_right: (value: right) => next_right,
  ) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return Either.with_left<next_left>().Left<next_right>(
          map_left(payload),
        );
      case "Right":
        return Either.with_left<next_left>().Right(
          map_right(payload),
        );
    }
  },
});

Functor.instance(Either)({
  map(fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return same_context(this);
      case "Right":
        return Right(fn(payload));
    }
  },
});

Applicative.instance(Either)({
  pure(value) {
    return Right(value);
  },

  // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
  [applicative_lift_method](fn, rest) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return same_context(this);
      case "Right":
        return lift_right(fn, payload, rest);
    }
  },

  ap(value) {
    const [fn_tag, fn] = this.value();

    switch (fn_tag) {
      case "Left":
        return same_context(this);
      case "Right": {
        const [either_tag, either] = value.value();

        switch (either_tag) {
          case "Left":
            return same_context(value);
          case "Right":
            return Right(fn(either));
        }
      }
    }
  },
});

Monad.instance(Either)({
  bind(fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return same_context(this);
      case "Right":
        return fn(payload);
    }
  },
});

MonadError.instance(Either)({
  throw_error(error) {
    return Left(error);
  },

  catch_error(handler) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return handler(payload);
      case "Right":
        return same_context(this);
    }
  },
});

Foldable.instance(Either)({
  fold(initial, fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return initial;
      case "Right":
        return fn(initial, payload);
    }
  },
});

Traversable.instance(Either)({
  traverse(applicative, fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Left":
        return Applicative.pure(applicative, Left(payload));
      case "Right":
        return Functor.map(fn(payload), (value) => Right(value));
    }
  },
});

function lift_right<result>(
  fn: (...values: unknown[]) => result,
  first: unknown,
  rest: readonly WrappedData<AsEither, Either<unknown, unknown>, unknown>[],
): WrappedData<AsEither, Either<unknown, result>, result> {
  switch (rest.length) {
    case 0:
      return Right(fn(first));
    case 1: {
      const [tag, payload] = rest[0].value();

      switch (tag) {
        case "Left":
          return same_context(rest[0]);
        case "Right":
          return Right(fn(first, payload));
      }
    }
  }

  const values = [first];

  for (const current of rest) {
    const [tag, payload] = current.value();

    switch (tag) {
      case "Left":
        return same_context(current);
      case "Right":
        values.push(payload);
        break;
    }
  }

  return Right(fn(...values));
}

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

export type Either<left, right> =
  | Left<left>
  | Right<right>;

export type Left<left = string> = readonly ["Left", left];
export type Right<right> = readonly ["Right", right];

// deno-lint-ignore no-explicit-any -- a bare Right is polymorphic in its left type
type AnyLeft = any;

interface EitherBifunctorContext extends BifunctorContext {
  readonly [type_data]: AsEither<this[typeof type_item]>;
}

export interface AsEither<left = AnyLeft>
  extends
    As<AsEither<left>>,
    Show<AsEither<left>>,
    MonadError<AsEither<left>>,
    Traversable<AsEither<left>>,
    Bifunctor<AsEither<left>, left, EitherBifunctorContext>,
    Ord<AsEither<left>> {
  readonly [type_item]: unknown;
  readonly [type_data]: Either<left, this[typeof type_item]>;
}

export type EitherValue<left, right> = [left] extends [never]
  ? WrappedData<AsEither<AnyLeft>, Either<never, right>, right>
  : Data<AsEither<left>, right>;

export type EitherDictionary<left> = UnionDictionary<AsEither<left>>;

type EitherLeft<value> = value extends Left<infer left> ? left : never;
type EitherRight<value> = value extends Right<infer right> ? right : never;

export type EitherConstructor =
  & {
    <value extends Either<AnyLeft, AnyLeft>>(
      value: value,
    ): EitherValue<EitherLeft<value>, EitherRight<value>>;
    <left, right>(value: Either<left, right>): EitherValue<left, right>;
    with_left<left>(): EitherDictionary<left>;
    /** @deprecated Use with_left. */
    withLeft<left>(): EitherDictionary<left>;
  }
  & {
    readonly [key in keyof UnionDictionary<AsEither<unknown>>]: UnionDictionary<
      AsEither<unknown>
    >[key];
  };

export type LeftGuard = {
  <left, right>(value: Either<left, right>): value is Left<left>;
  (value: unknown): value is Left<unknown>;
};

export type RightGuard = {
  <left, right>(value: Either<left, right>): value is Right<right>;
  (value: unknown): value is Right<unknown>;
};

export type LeftConstructor = {
  <left = string, right = never>(value: left): EitherValue<left, right>;
  readonly is: LeftGuard;
};

export type RightConstructor = {
  <right>(value: right): EitherValue<never, right>;
  <left, right>(value: right): EitherValue<left, right>;
  readonly is: RightGuard;
};

export const Either = data<AsEither<unknown>>(
  union(["Left", $slot], ["Right", $slot]),
) as EitherConstructor;

Object.defineProperty(Either, "with_left", {
  value: either_with_left,
});

Object.defineProperty(Either, "withLeft", {
  value: either_with_left,
});

export const Right: RightConstructor = Object.assign(construct_right, {
  is: is_right,
});
export const Left: LeftConstructor = Object.assign(construct_left, {
  is: is_left,
});

function either_with_left<left>(): EitherDictionary<left> {
  return Either as unknown as EitherDictionary<left>;
}

export function is_left<left, right>(
  value: Either<left, right>,
): value is Left<left>;
export function is_left(value: unknown): value is Left<unknown>;
export function is_left<left, right>(
  value: Either<left, right> | unknown,
): value is Left<left> {
  if (!Array.isArray(value)) {
    return false;
  }

  const [tag] = value;

  return tag === "Left";
}

export function is_right<left, right>(
  value: Either<left, right>,
): value is Right<right>;
export function is_right(value: unknown): value is Right<unknown>;
export function is_right<left, right>(
  value: Either<left, right> | unknown,
): value is Right<right> {
  if (!Array.isArray(value)) {
    return false;
  }

  const [tag] = value;

  return tag === "Right";
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

export function from_number(value: number): EitherValue<string, number> {
  if (Number.isFinite(value)) {
    return Right<string, number>(value);
  }

  return Left<string, number>("Expected a finite number");
}

/** Haskell `either :: (a -> c) -> (b -> c) -> Either a b -> c`. */
export function either<left, right, out>(
  on_left: (value: left) => out,
  on_right: (value: right) => out,
  value: EitherValue<left, right>,
): out {
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

function lift_right<out>(
  fn: (...values: unknown[]) => out,
  first: unknown,
  rest: readonly WrappedData<AsEither, Either<unknown, unknown>, unknown>[],
): WrappedData<AsEither, Either<unknown, out>, out> {
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

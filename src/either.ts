import {
  $slot,
  type As,
  as_data,
  data,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
  type WrappedData,
} from "./typeclass.ts";
import {
  Applicative,
  applicative_lift_method,
  Bifunctor,
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

export type Either<left, right> =
  | Left<left>
  | Right<right>;

export type Left<left = string> = readonly ["Left", left];
export type Right<right> = readonly ["Right", right];

export interface AsEither
  extends
    As<AsEither>,
    Show<AsEither>,
    Eq<AsEither>,
    Functor<AsEither>,
    Applicative<AsEither>,
    Monad<AsEither>,
    MonadError<AsEither>,
    Foldable<AsEither>,
    Traversable<AsEither>,
    Bifunctor<AsEither>,
    Ord<AsEither> {
  readonly [type_item]: unknown;
  readonly [type_data]: Either<unknown, this[typeof type_item]>;
}

export type EitherValue<left, right> = WrappedData<
  AsEither,
  Either<left, right>,
  right
>;

export type EitherConstructor = UnionDictionary<AsEither>;

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

export const Either: EitherConstructor = data<AsEither>(
  union(["Left", $slot], ["Right", $slot]),
);
export const Right: RightConstructor = Object.assign(construct_right, {
  is: is_right,
});
export const Left: LeftConstructor = Object.assign(construct_left, {
  is: is_left,
});

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
  return as_data<AsEither, Either<left, right>, right>(Either, [
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
  return as_data<AsEither, Either<left, right>, right>(Either, [
    "Right",
    value,
  ]);
}

export function from_number(value: number): EitherValue<string, number> {
  if (Number.isFinite(value)) {
    return Right<string, number>(value);
  }

  return Left<string, number>("Expected a finite number");
}

Show.instance(Either)({
  show() {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Right":
        return "Right(" + Deno.inspect(payload) + ")";
      case "Left":
        return "Left(" + Deno.inspect(payload) + ")";
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
  bimap<raw, left, right, next_left, next_right>(
    this: WrappedData<AsEither, raw, right>,
    map_left: (value: left) => next_left,
    map_right: (value: right) => next_right,
  ) {
    const [tag, payload] = this.value() as Either<left, right>;

    switch (tag) {
      case "Left":
        return unknown_typeclass<next_right>(Left(map_left(payload)));
      case "Right":
        return unknown_typeclass<next_right>(Right(map_right(payload)));
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

function same_context<out>(value: unknown): out {
  return value as out;
}

function unknown_typeclass<item>(
  value: unknown,
): WrappedData<AsEither, unknown, item> {
  return value as WrappedData<AsEither, unknown, item>;
}

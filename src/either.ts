import {
  type As,
  data,
  type type_data,
  type type_item,
  type WrappedData,
} from "./typeclass.ts";
import {
  Applicative,
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

export type Left<left = string> = readonly ["left", left];
export type Right<right> = readonly ["right", right];

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

type EitherConstructor =
  & AsEither
  & {
    <left, right>(value: Either<left, right>): EitherValue<left, right>;
  };

export const Either = data<AsEither>() as EitherConstructor;

export function right<right>(value: right): EitherValue<never, right> {
  return Either(either_right(value)) as EitherValue<never, right>;
}

export function left<left = string, right = never>(
  value: left,
): EitherValue<left, right> {
  return Either(either_left<left, right>(value)) as EitherValue<left, right>;
}

export function is_left<left, right>(
  value: Either<left, right>,
): value is Left<left> {
  const [tag] = value;

  return tag === "left";
}

export function is_right<left, right>(
  value: Either<left, right>,
): value is Right<right> {
  const [tag] = value;

  return tag === "right";
}

export function from_number(value: number): EitherValue<string, number> {
  if (Number.isFinite(value)) {
    return right(value) as EitherValue<string, number>;
  }

  return left("Expected a finite number") as EitherValue<string, number>;
}

Show.instance(Either)({
  show() {
    const [tag, payload] = this.value();

    switch (tag) {
      case "right":
        return "Right(" + Deno.inspect(payload) + ")";
      case "left":
        return "Left(" + Deno.inspect(payload) + ")";
    }
  },
});

Eq.instance(Either)({
  eq(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "left":
        switch (right_tag) {
          case "left":
            return Object.is(left_payload, right_payload);
          case "right":
            return false;
        }
        break;
      case "right":
        switch (right_tag) {
          case "left":
            return false;
          case "right":
            return Object.is(left_payload, right_payload);
        }
        break;
    }

    return false;
  },
});

Ord.instance(Either)({
  compare(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "left":
        switch (right_tag) {
          case "left":
            return compare_unknown(left_payload, right_payload);
          case "right":
            return "lt";
        }
        break;
      case "right":
        switch (right_tag) {
          case "left":
            return "gt";
          case "right":
            return compare_unknown(left_payload, right_payload);
        }
        break;
    }

    return "eq";
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
      case "left":
        return unknown_typeclass<next_right>(left(map_left(payload)));
      case "right":
        return unknown_typeclass<next_right>(right(map_right(payload)));
    }
  },
});

Functor.instance(Either)({
  map(fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "left":
        return same_context(this);
      case "right":
        return right(fn(payload));
    }
  },
});

Applicative.instance(Either)({
  pure(value) {
    return right(value);
  },

  ap(value) {
    const [fn_tag, fn] = this.value();

    switch (fn_tag) {
      case "left":
        return same_context(this);
      case "right": {
        const [either_tag, either] = value.value();

        switch (either_tag) {
          case "left":
            return same_context(value);
          case "right":
            return right(fn(either));
        }
      }
    }
  },
});

Monad.instance(Either)({
  bind(fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "left":
        return same_context(this);
      case "right":
        return fn(payload);
    }
  },
});

MonadError.instance(Either)({
  throw_error(error) {
    return left(error);
  },

  catch_error(handler) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "left":
        return handler(payload);
      case "right":
        return same_context(this);
    }
  },
});

Foldable.instance(Either)({
  fold(initial, fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "left":
        return initial;
      case "right":
        return fn(initial, payload);
    }
  },
});

Traversable.instance(Either)({
  traverse(applicative, fn) {
    const [tag, payload] = this.value();

    switch (tag) {
      case "left":
        return Applicative.pure(applicative, left(payload));
      case "right":
        return Functor.map(fn(payload), (value) => right(value));
    }
  },
});

function either_right<right>(value: right): Right<right> {
  return ["right", value];
}

function either_left<left = string, right = never>(
  value: left,
): Either<left, right> {
  return ["left", value];
}

function same_context<out>(value: unknown): out {
  return value as out;
}

function unknown_typeclass<item>(
  value: unknown,
): WrappedData<AsEither, unknown, item> {
  return value as WrappedData<AsEither, unknown, item>;
}

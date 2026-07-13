import {
  $slot,
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
} from "./typeclass.ts";
import { same_context } from "./internal.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  Monoid,
  Ord,
  Semigroup,
  Show,
  Traversable,
} from "./typeclasses.ts";
import { type EitherValue, Left, Right } from "./either.ts";
import { inspect } from "./inspect.ts";

/** @ignore */
export declare const maybe_identity: unique symbol;

/** An optional value represented by a Just or Nothing tagged tuple. */
export type Maybe<item> =
  | Just<item>
  | Nothing;

/** The present branch of Maybe. */
export type Just<item> = readonly ["Just", item];
/** The absent branch of Maybe. */
export type Nothing = readonly ["Nothing"];

/** Dictionary type for optional values and their typeclass instances. */
export interface AsMaybe
  extends
    As<AsMaybe, typeof maybe_identity>,
    Show<AsMaybe>,
    Alternative<AsMaybe>,
    Monad<AsMaybe>,
    Monoid<AsMaybe>,
    Traversable<AsMaybe>,
    Ord<AsMaybe> {
  /** Higher-kinded slot for the optional item type. */
  readonly [type_item]: unknown;
  /** Maybe representation at the selected item type. */
  readonly [type_data]: Maybe<this[typeof type_item]>;
}

/** A Maybe tuple wrapped with the Maybe dictionary's fluent methods. */
export type MaybeValue<item> = Data<AsMaybe, item>;
/** Callable Maybe dictionary with constructors for both branches. */
export type MaybeConstructor = UnionDictionary<AsMaybe>;

/** Callable Maybe dictionary and the source of its typeclass instances. */
export const Maybe: MaybeConstructor = data<AsMaybe>(
  union(["Just", $slot], ["Nothing"]),
);
/** Construct a present Maybe value. */
export const Just: MaybeConstructor["Just"] = Maybe.Just;
/** Construct or match the absent Maybe value. */
export const Nothing: MaybeConstructor["Nothing"] = Maybe.Nothing;

const nothing_singleton = Nothing<never>();

/** Convert null or undefined to Nothing and every other value to Just. */
export function from_nullable<item>(
  value: item | null | undefined,
): MaybeValue<item> {
  if (value === null) {
    return nothing_value();
  }

  if (value === undefined) {
    return nothing_value();
  }

  return Just(value);
}

/** Haskell `toNullable :: Maybe a -> a | null`. */
export function to_nullable<item>(value: MaybeValue<item>): item | null {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Just":
      return payload;
    case "Nothing":
      return null;
  }
}

/** Haskell `fromMaybe :: a -> Maybe a -> a`. */
export function from_maybe<item>(
  fallback: item,
  value: MaybeValue<item>,
): item {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Just":
      return payload;
    case "Nothing":
      return fallback;
  }
}

/** Haskell `maybe :: b -> (a -> b) -> Maybe a -> b`. */
export function maybe<item, result>(
  fallback: result,
  fn: (value: item) => result,
  value: MaybeValue<item>,
): result {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Just":
      return fn(payload);
    case "Nothing":
      return fallback;
  }
}

/** Haskell `maybeToEither :: e -> Maybe a -> Either e a`. */
export function to_either<error, item>(
  error: error,
  value: MaybeValue<item>,
): EitherValue<error, item> {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Just":
      return Right<error, item>(payload);
    case "Nothing":
      return Left<error, item>(error);
  }
}

Show.instance(Maybe)({
  show() {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Just":
        return "Just(" + inspect(payload) + ")";
      case "Nothing":
        return "Nothing";
    }
  },
});

Eq.instance(Maybe)({
  eq(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "Nothing":
        return right_tag === "Nothing";
      case "Just":
        switch (right_tag) {
          case "Nothing":
            return false;
          case "Just":
            return Object.is(left_payload, right_payload);
        }
    }
  },
});

Ord.instance(Maybe)({
  compare(right) {
    const [left_tag, left_payload] = this.value();
    const [right_tag, right_payload] = right.value();

    switch (left_tag) {
      case "Nothing":
        if (right_tag === "Nothing") {
          return "eq";
        }

        return "lt";
      case "Just":
        if (right_tag === "Nothing") {
          return "gt";
        }

        return compare_unknown(left_payload, right_payload);
    }
  },
});

Functor.instance(Maybe)({
  map(fn) {
    if (is_Nothing_value(this)) {
      return same_context(this);
    }

    const [tag, payload] = this.value();

    switch (tag) {
      case "Nothing":
        return same_context(this);
      case "Just":
        return Just(fn(payload));
    }
  },
});

Applicative.instance(Maybe)({
  pure(value) {
    return Just(value);
  },

  // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
  [applicative_lift_method](fn, rest) {
    if (is_Nothing_value(this)) {
      return same_context(this);
    }

    const [tag, payload] = this.value();

    switch (tag) {
      case "Nothing":
        return same_context(this);
      case "Just":
        return lift_just(fn, payload, rest);
    }
  },

  ap(value) {
    if (is_Nothing_value(this)) {
      return same_context(this);
    }

    const [fn_tag, fn] = this.value();

    switch (fn_tag) {
      case "Nothing":
        return same_context(this);
      case "Just": {
        if (is_Nothing_value(value)) {
          return same_context(value);
        }

        const [maybe_tag, maybe] = value.value();

        switch (maybe_tag) {
          case "Nothing":
            return same_context(value);
          case "Just":
            return Just(fn(maybe));
        }
      }
    }
  },
});

Alternative.instance(Maybe)({
  empty() {
    return nothing_value();
  },

  alt(right) {
    if (is_Nothing_value(this)) {
      return right;
    }

    const [tag] = this.value();

    switch (tag) {
      case "Just":
        return same_context(this);
      case "Nothing":
        return right;
    }
  },
});

Semigroup.instance(Maybe)({
  concat(right) {
    if (is_Nothing_value(this)) {
      return right;
    }

    const [tag] = this.value();

    switch (tag) {
      case "Just":
        return same_context(this);
      case "Nothing":
        return right;
    }
  },
});

Monoid.instance(Maybe)({
  empty() {
    return nothing_value();
  },
});

Monad.instance(Maybe)({
  bind(fn) {
    if (is_Nothing_value(this)) {
      return same_context(this);
    }

    const [tag, payload] = this.value();

    switch (tag) {
      case "Nothing":
        return same_context(this);
      case "Just":
        return fn(payload);
    }
  },
});

Foldable.instance(Maybe)({
  fold(initial, fn) {
    if (is_Nothing_value(this)) {
      return initial;
    }

    const [tag, payload] = this.value();

    switch (tag) {
      case "Nothing":
        return initial;
      case "Just":
        return fn(initial, payload);
    }
  },
});

Traversable.instance(Maybe)({
  traverse(applicative, fn) {
    if (is_Nothing_value(this)) {
      return Applicative.pure(applicative, nothing_value());
    }

    const [tag, payload] = this.value();

    switch (tag) {
      case "Nothing":
        return Applicative.pure(applicative, nothing_value());
      case "Just":
        return Functor.map(fn(payload), (value) => Just(value));
    }
  },
});

function lift_just<result>(
  fn: (...values: unknown[]) => result,
  first: unknown,
  rest: readonly MaybeValue<unknown>[],
): MaybeValue<result> {
  switch (rest.length) {
    case 0:
      return Just(fn(first));
    case 1: {
      if (is_Nothing_value(rest[0])) {
        return same_context(rest[0]);
      }

      const [tag, payload] = rest[0].value();

      switch (tag) {
        case "Nothing":
          return same_context(rest[0]);
        case "Just":
          return Just(fn(first, payload));
      }
    }
  }

  const values = [first];

  for (const current of rest) {
    if (is_Nothing_value(current)) {
      return same_context(current);
    }

    const [tag, payload] = current.value();

    switch (tag) {
      case "Nothing":
        return same_context(current);
      case "Just":
        values.push(payload);
        break;
    }
  }

  return Just(fn(...values));
}

function nothing_value<item>(): MaybeValue<item> {
  return nothing_singleton as MaybeValue<item>;
}

function is_Nothing_value(value: unknown): value is MaybeValue<never> {
  return value === nothing_singleton;
}

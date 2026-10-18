import type { Matchable } from "./data_value.ts";
import {
  $slot,
  type As,
  type Data,
  data,
  install_instance,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
} from "./typeclass.ts";
import { same_context } from "./internal.ts";
import {
  type Alternative,
  alternative_typeclass,
  Applicative,
  applicative_lift_method,
  applicative_typeclass,
  compare_unknown,
  eq_typeclass,
  foldable_typeclass,
  Functor,
  functor_typeclass,
  type Monad,
  monad_rec_typeclass,
  monad_typeclass,
  type MonadRec,
  type Monoid,
  monoid_typeclass,
  type Ord,
  ord_typeclass,
  semigroup_typeclass,
  type Show,
  show_typeclass,
  type Traversable,
  traversable_typeclass,
} from "./typeclasses.ts";
import { type Either, Left, Right } from "./either.ts";
import { inspect } from "./inspect.ts";
import { loop_done, loop_rec } from "./loop.ts";

/** @ignore */
export const maybe_identity: unique symbol = /* @__PURE__ */ Symbol(
  "maybe_identity",
);

/** An optional value represented by a Just or Nothing tagged tuple. */
export type RawMaybe<item> =
  | Just<item>
  | Nothing;

/** The present branch of Maybe. */
export type Just<item> = readonly ["Just", item];
/** The absent branch of Maybe. */
export type Nothing = readonly ["Nothing"];

/** @ignore */
export interface AsMaybeLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawMaybe<this[typeof type_item]>;
}

/** Dictionary type for optional values and their typeclass instances. */
export interface AsMaybe
  extends
    As<AsMaybeLambda, typeof maybe_identity>,
    Show<AsMaybe>,
    Alternative<AsMaybe>,
    Monad<AsMaybe>,
    MonadRec<AsMaybe>,
    Monoid<AsMaybe>,
    Traversable<AsMaybe>,
    Ord<AsMaybe>,
    Matchable {
}

/** A Maybe tuple wrapped with the Maybe dictionary's fluent methods. */
export type Maybe<item> = Data<AsMaybe, item>;
/** Callable Maybe dictionary with constructors for both branches. */
export type MaybeConstructor = UnionDictionary<AsMaybe>;

/** Callable Maybe dictionary and the source of its typeclass instances. */
export const Maybe: MaybeConstructor = /* @__PURE__ */ create_maybe();
/** Construct a present Maybe value. */
export const Just: MaybeConstructor["Just"] =
  /* @__PURE__ */ (() => Maybe.Just)();
/** Construct or match the absent Maybe value. */
export const Nothing: MaybeConstructor["Nothing"] =
  /* @__PURE__ */ (() => Maybe.Nothing)();

const nothing_singleton = /* @__PURE__ */ Nothing<never>();

/** Convert null or undefined to Nothing and every other value to Just. */
export function from_nullable<item>(
  value: item | null | undefined,
): Maybe<NonNullable<item>> {
  if (value === null) {
    return nothing_value();
  }

  if (value === undefined) {
    return nothing_value();
  }

  return Just(value);
}

/** Haskell `toNullable :: Maybe a -> a | null`. */
export function to_nullable<item>(value: Maybe<item>): item | null {
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
  value: Maybe<item>,
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
  value: Maybe<item>,
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
  value: Maybe<item>,
): Either<error, item> {
  const [tag, payload] = value.value();

  switch (tag) {
    case "Just":
      return Right<error, item>(payload);
    case "Nothing":
      return Left<error, item>(error);
  }
}

function empty_maybe<item>(this: AsMaybe): Data<AsMaybe, item> {
  return nothing_value();
}

function lift_just<result>(
  fn: (...values: unknown[]) => result,
  first: unknown,
  rest: readonly Maybe<unknown>[],
): Maybe<result> {
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

function nothing_value<item>(): Maybe<item> {
  return nothing_singleton as Maybe<item>;
}

function is_Nothing_value(value: unknown): value is Maybe<never> {
  return value === nothing_singleton;
}

/** Return the present value, evaluating the fallback only for Nothing. */
export function get_or_else<item, fallback>(
  value: Maybe<item>,
  fallback: () => fallback,
): item | fallback {
  return value.match<item | fallback>({
    Just: (item) => item,
    Nothing: fallback,
  });
}

// Keep dictionary construction and instance installation in one removable unit.
function create_maybe(): MaybeConstructor {
  function instance<token extends keyof AsMaybe>(
    token: token,
  ): (implementation: AsMaybe[token]) => void {
    return (implementation) => {
      install_instance(Maybe, token, implementation as object);
    };
  }
  const Maybe: MaybeConstructor = data<AsMaybe>(
    maybe_identity,
    union(["Just", $slot], ["Nothing"]),
  );

  instance(show_typeclass)({
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

  instance(eq_typeclass)({
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

  instance(ord_typeclass)({
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

  instance(functor_typeclass)({
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

  instance(applicative_typeclass)({
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

  instance(alternative_typeclass)({
    empty: empty_maybe,

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

  instance(semigroup_typeclass)({
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

  instance(monoid_typeclass)({
    empty: empty_maybe,
  });

  instance(monad_typeclass)({
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

  instance(monad_rec_typeclass)({
    tail_rec_m(initial, step) {
      let state = initial;

      while (true) {
        const current = step(state);
        const [maybe_tag, loop_step] = current.value();

        switch (maybe_tag) {
          case "Nothing":
            return Nothing();
          case "Just": {
            const [loop_tag, value] = loop_step;

            switch (loop_tag) {
              case loop_done:
                return Just(value);
              case loop_rec:
                state = value;
                break;
            }
            break;
          }
        }
      }
    },
  });

  instance(foldable_typeclass)({
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

  instance(traversable_typeclass)({
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
  return Maybe;
}

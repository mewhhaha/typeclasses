import type { Matchable } from "./data_value.ts";
import {
  $slot,
  type As,
  type Data,
  data,
  install_instance,
  tagged_payload,
  tagged_tag,
  tagged_value,
  type type_data,
  type type_item,
  union,
  type UnionDictionary,
} from "./typeclass.ts";
import { same_context } from "./internal.ts";
import {
  type Alternative,
  alternative_typeclass,
} from "./typeclasses/alternative.ts";
import {
  applicative_lift_method,
  applicative_pure,
  applicative_typeclass,
} from "./typeclasses/applicative.ts";
import { compare_unknown, type Ord, ord_typeclass } from "./typeclasses/ord.ts";
import { eq_typeclass } from "./typeclasses/eq.ts";
import { foldable_typeclass } from "./typeclasses/foldable.ts";
import { functor_map, functor_typeclass } from "./typeclasses/functor.ts";
import {
  type Monad,
  monad_typeclass,
  register_fast_do,
} from "./typeclasses/monad.ts";
import { monad_rec_typeclass, type MonadRec } from "./typeclasses/monad_rec.ts";
import { type Monoid, monoid_typeclass } from "./typeclasses/monoid.ts";
import { semigroup_typeclass } from "./typeclasses/semigroup.ts";
import { type Show, show_typeclass } from "./typeclasses/show.ts";
import {
  type Traversable,
  traversable_typeclass,
} from "./typeclasses/traversable.ts";
import { type Either, Left, Right } from "./either.ts";
import { inspect } from "./inspect.ts";
import { loop_done } from "./loop.ts";

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

type TaggedMaybe<item = unknown> = {
  readonly [tagged_tag]?: PropertyKey;
  readonly [tagged_payload]?: item;
  readonly [tagged_value]?: () => RawMaybe<item>;
  value(): RawMaybe<item>;
};

const maybe_none = /* @__PURE__ */ Symbol();

function unwrap_just<item>(value: Maybe<item>): item | typeof maybe_none {
  const tagged = value as unknown as TaggedMaybe<item>;
  const value_fn = tagged.value;
  if (value_fn !== undefined && value_fn === tagged[tagged_value]) {
    return tagged[tagged_tag] === "Just"
      ? tagged[tagged_payload] as item
      : maybe_none;
  }
  const raw = value_fn.call(tagged);
  return raw[0] === "Just" ? raw[1] : maybe_none;
}

const wrap_just = <item>(value: item): Maybe<item> => Just(value);

/** Convert null or undefined to Nothing and every other value to Just. */
export function from_nullable<item>(
  value: item | null | undefined,
): Maybe<NonNullable<item>> {
  return value == null ? nothing_value() : Just(value);
}

/** Haskell `toNullable :: Maybe a -> a | null`. */
export function to_nullable<item>(value: Maybe<item>): item | null {
  const item = unwrap_just(value);
  return item === maybe_none ? null : item;
}

/** Haskell `fromMaybe :: a -> Maybe a -> a`. */
export function from_maybe<item>(
  fallback: item,
  value: Maybe<item>,
): item {
  const item = unwrap_just(value);
  return item === maybe_none ? fallback : item;
}

/** Haskell `maybe :: b -> (a -> b) -> Maybe a -> b`. */
export function maybe<item, result>(
  fallback: result,
  fn: (value: item) => result,
  value: Maybe<item>,
): result {
  const item = unwrap_just(value);
  return item === maybe_none ? fallback : fn(item);
}

/** Haskell `maybeToEither :: e -> Maybe a -> Either e a`. */
export function to_either<error, item>(
  error: error,
  value: Maybe<item>,
): Either<error, item> {
  const item = unwrap_just(value);
  return item === maybe_none
    ? Left<error, item>(error)
    : Right<error, item>(item);
}

function empty_maybe<item>(this: AsMaybe): Data<AsMaybe, item> {
  return nothing_value();
}

function lift_just<result>(
  fn: (...values: unknown[]) => result,
  first: unknown,
  rest: readonly Maybe<unknown>[],
): Maybe<result> {
  const len = rest.length;
  if (len === 0) return Just(fn(first));
  if (len === 1) {
    const a = unwrap_just(rest[0]);
    return a === maybe_none ? same_context(rest[0]) : Just(fn(first, a));
  }
  if (len === 2) {
    const a = unwrap_just(rest[0]);
    if (a === maybe_none) return same_context(rest[0]);
    const b = unwrap_just(rest[1]);
    return b === maybe_none ? same_context(rest[1]) : Just(fn(first, a, b));
  }

  const values = new Array<unknown>(len + 1);
  values[0] = first;
  for (let i = 0; i < len; i += 1) {
    const current = unwrap_just(rest[i]);
    if (current === maybe_none) return same_context(rest[i]);
    values[i + 1] = current;
  }

  return Just(fn(...values));
}

function nothing_value<item>(): Maybe<item> {
  return nothing_singleton as Maybe<item>;
}

/** Keep a Just value when it satisfies `predicate`, narrowing its type. */
export function filter<item, narrowed extends item>(
  value: Maybe<item>,
  predicate: (item: item) => item is narrowed,
): Maybe<narrowed>;
/** Keep a Just value when it satisfies `predicate`; otherwise return Nothing. */
export function filter<item>(
  value: Maybe<item>,
  predicate: (item: item) => boolean,
): Maybe<item>;
export function filter<item>(
  value: Maybe<item>,
  predicate: (item: item) => boolean,
): Maybe<item> {
  const item = unwrap_just(value);
  return item !== maybe_none && predicate(item) ? value : nothing_value();
}

/** Return the present value, evaluating the fallback only for Nothing. */
export function get_or_else<item, fallback>(
  value: Maybe<item>,
  fallback: () => fallback,
): item | fallback {
  const item = unwrap_just(value);
  return item === maybe_none ? fallback() : item;
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
      const item = unwrap_just(this);
      return item === maybe_none ? "Nothing" : "Just(" + inspect(item) + ")";
    },
  });

  instance(eq_typeclass)({
    eq(right) {
      if (this === right) return true;
      const a = unwrap_just(this);
      const b = unwrap_just(right);
      return a === maybe_none
        ? b === maybe_none
        : b !== maybe_none && Object.is(a, b);
    },
  });

  instance(ord_typeclass)({
    compare(right) {
      if (this === right) return "eq";
      const a = unwrap_just(this);
      const b = unwrap_just(right);
      if (a === maybe_none) return b === maybe_none ? "eq" : "lt";
      if (b === maybe_none) return "gt";
      return compare_unknown(a, b);
    },
  });

  instance(functor_typeclass)({
    map(fn) {
      const item = unwrap_just(this);
      return item === maybe_none ? same_context(this) : Just(fn(item));
    },
  });

  instance(applicative_typeclass)({
    pure(value) {
      return Just(value);
    },

    // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
    [applicative_lift_method](fn, rest) {
      const item = unwrap_just(this);
      return item === maybe_none
        ? same_context(this)
        : lift_just(fn, item, rest);
    },

    ap(value) {
      const fn = unwrap_just(this);
      if (fn === maybe_none) return same_context(this);
      const item = unwrap_just(value);
      return item === maybe_none ? same_context(value) : Just(fn(item));
    },
  });

  function alt_maybe<item>(
    this: Data<AsMaybe, item>,
    right: Data<AsMaybe, item>,
  ): Data<AsMaybe, item> {
    return unwrap_just(this) === maybe_none ? right : same_context(this);
  }

  instance(alternative_typeclass)({
    empty: empty_maybe,
    alt: alt_maybe,
  });

  instance(semigroup_typeclass)({
    concat: alt_maybe,
  });

  instance(monoid_typeclass)({
    empty: empty_maybe,
  });

  instance(monad_typeclass)({
    bind(fn) {
      const item = unwrap_just(this);
      return item === maybe_none ? same_context(this) : fn(item);
    },
  });

  register_fast_do(Maybe, 0, Maybe.Just);

  instance(monad_rec_typeclass)({
    tail_rec_m(initial, step) {
      let state = initial;

      while (true) {
        const loop_step = unwrap_just(step(state));
        if (loop_step === maybe_none) return nothing_value();
        if (loop_step[0] === loop_done) return Just(loop_step[1]);
        state = loop_step[1];
      }
    },
  });

  instance(foldable_typeclass)({
    fold(initial, fn) {
      const item = unwrap_just(this);
      return item === maybe_none ? initial : fn(initial, item);
    },
  });

  instance(traversable_typeclass)({
    traverse(applicative, fn) {
      const item = unwrap_just(this);
      return item === maybe_none
        ? applicative_pure(applicative, nothing_value())
        : functor_map(fn(item), wrap_just);
    },
  });
  return Maybe;
}

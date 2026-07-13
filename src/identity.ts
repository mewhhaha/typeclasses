import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import {
  Applicative,
  applicative_lift_method,
  Comonad,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export declare const identity_identity: unique symbol;

/** A value carried without adding any runtime context. */
export type Identity<item> = item;

/** Dictionary type for the identity context and its typeclass instances. */
export interface AsIdentity
  extends
    As<AsIdentity, typeof identity_identity>,
    Show<AsIdentity>,
    Monad<AsIdentity>,
    Traversable<AsIdentity>,
    Comonad<AsIdentity>,
    Ord<AsIdentity> {
  /** Higher-kinded slot for the identity value type. */
  readonly [type_item]: unknown;
  /** Identity representation at the selected value type. */
  readonly [type_data]: Identity<this[typeof type_item]>;
}

/** An identity value wrapped with fluent typeclass methods. */
export type IdentityValue<item> = Data<AsIdentity, item>;

/** Callable Identity dictionary and the source of its instances. */
export const Identity: AsIdentity = data<AsIdentity>();

/** Wrap a value in the Identity context. */
export function identity<item>(value: item): IdentityValue<item> {
  return Identity(value);
}

Show.instance(Identity)({
  show() {
    return "Identity(" + inspect(this.value()) + ")";
  },
});

Eq.instance(Identity)({
  eq(right) {
    return Object.is(this.value(), right.value());
  },
});

Ord.instance(Identity)({
  compare(right) {
    return compare_unknown(this.value(), right.value());
  },
});

Functor.instance(Identity)({
  map(fn) {
    return identity(fn(this.value()));
  },
});

Applicative.instance(Identity)({
  pure(value) {
    return identity(value);
  },

  [applicative_lift_method](fn, rest) {
    const values = [this.value()];

    for (const current of rest) {
      values.push(current.value());
    }

    return identity(fn(...values));
  },

  ap(value) {
    return identity(this.value()(value.value()));
  },
});

Monad.instance(Identity)({
  bind(fn) {
    return fn(this.value());
  },
});

Foldable.instance(Identity)({
  fold(initial, fn) {
    return fn(initial, this.value());
  },
});

Traversable.instance(Identity)({
  traverse(_applicative, fn) {
    return Functor.map(fn(this.value()), identity);
  },
});

Comonad.instance(Identity)({
  extract() {
    return this.value();
  },

  extend(fn) {
    return identity(fn(this));
  },
});

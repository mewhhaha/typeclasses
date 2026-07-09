import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
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

export type Identity<item> = item;

export interface AsIdentity
  extends
    As<AsIdentity>,
    Show<AsIdentity>,
    Monad<AsIdentity>,
    Traversable<AsIdentity>,
    Comonad<AsIdentity>,
    Ord<AsIdentity> {
  readonly [type_item]: unknown;
  readonly [type_data]: Identity<this[typeof type_item]>;
}

export type IdentityValue<item> = Data<AsIdentity, item>;

export const Identity: AsIdentity = data<AsIdentity>();

export function identity<item>(value: item): IdentityValue<item> {
  return Identity(value);
}

Show.instance(Identity)({
  show() {
    return "Identity(" + Deno.inspect(this.value()) + ")";
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

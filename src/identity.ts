import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { inspect } from "./inspect.ts";
import { loop_done } from "./loop.ts";
import { register_fast_do } from "./typeclasses/monad.ts";
import {
  Applicative,
  applicative_lift_method,
  Comonad,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  MonadRec,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";

/** @ignore */
export const identity_identity: unique symbol = /* @__PURE__ */ Symbol(
  "identity_identity",
);

/** A value carried without adding any runtime context. */
export type RawIdentity<item> = item;

/** @ignore */
export interface AsIdentityLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawIdentity<this[typeof type_item]>;
}

/** Dictionary type for the identity context and its typeclass instances. */
export interface AsIdentity
  extends
    As<AsIdentityLambda, typeof identity_identity>,
    Show<AsIdentity>,
    Monad<AsIdentity>,
    MonadRec<AsIdentity>,
    Traversable<AsIdentity>,
    Comonad<AsIdentity>,
    Ord<AsIdentity> {
}

/** An identity value wrapped with fluent typeclass methods. */
export type Identity<item> = Data<AsIdentity, item>;

/** Callable Identity dictionary and the source of its instances. */
export const Identity: AsIdentity = /* @__PURE__ */ create_identity();

/** Wrap a value in the Identity context. */
export function identity<item>(value: item): Identity<item> {
  return Identity(value);
}

function create_identity(): AsIdentity {
  const Identity: AsIdentity = data<AsIdentity>(identity_identity);
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
      const first = this.value();
      const len = rest.length;
      if (len === 0) return identity(fn(first));
      if (len === 1) return identity(fn(first, rest[0].value()));
      if (len === 2) {
        return identity(fn(first, rest[0].value(), rest[1].value()));
      }
      const values = [first];
      for (let i = 0; i < len; i += 1) values.push(rest[i].value());
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

  register_fast_do(Identity, 2, Identity);

  MonadRec.instance(Identity)({
    tail_rec_m(initial, step) {
      let state = initial;
      while (true) {
        const [tag, value] = step(state).value();
        if (tag === loop_done) return identity(value);
        state = value;
      }
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

  return Identity;
}

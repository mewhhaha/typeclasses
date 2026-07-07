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
import {
  Alternative,
  Applicative,
  applicative_lift_method,
  compare_unknown,
  Eq,
  Foldable,
  Functor,
  Monad,
  Ord,
  Show,
  Traversable,
} from "./typeclasses.ts";

export type Maybe<item> =
  | Just<item>
  | Nothing;

export type Just<item> = readonly ["Just", item];
export type Nothing = readonly ["Nothing"];

export interface AsMaybe
  extends
    As<AsMaybe>,
    Show<AsMaybe>,
    Eq<AsMaybe>,
    Functor<AsMaybe>,
    Applicative<AsMaybe>,
    Alternative<AsMaybe>,
    Monad<AsMaybe>,
    Foldable<AsMaybe>,
    Traversable<AsMaybe>,
    Ord<AsMaybe> {
  readonly [type_item]: unknown;
  readonly [type_data]: Maybe<this[typeof type_item]>;
}

export type MaybeValue<item> = Data<AsMaybe, item>;
export type MaybeConstructor = UnionDictionary<AsMaybe>;

export const Maybe: MaybeConstructor = data<AsMaybe>(
  union(["Just", $slot], ["Nothing"]),
);
export const Just: MaybeConstructor["Just"] = Maybe.Just;
export const Nothing: MaybeConstructor["Nothing"] = Maybe.Nothing;

const nothing_singleton = Nothing<never>();

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

Show.instance(Maybe)({
  show() {
    const [tag, payload] = this.value();

    switch (tag) {
      case "Just":
        return "Just(" + Deno.inspect(payload) + ")";
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

function lift_just<out>(
  fn: (...values: unknown[]) => out,
  first: unknown,
  rest: readonly MaybeValue<unknown>[],
): MaybeValue<out> {
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

function same_context<out>(value: unknown): out {
  return value as out;
}

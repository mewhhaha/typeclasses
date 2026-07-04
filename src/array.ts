import { type As, define, type Value } from "./trait.ts";
import {
  Alternative,
  Applicative,
  Equal,
  Foldable,
  Format,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Traversable,
} from "./traits.ts";

export type ArrayT<item> = readonly item[];

export const array_kind = Symbol("ArrayT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [array_kind]: ArrayT<item>;
  }
}

export interface AsArray extends As<typeof array_kind> {}

type ArrayValue<item> = Value<AsArray, item>;

export const ArrayT = define<AsArray>(
  array_kind,
);

export function from_array<item>(items: readonly item[]): ArrayValue<item> {
  return ArrayT([...items]);
}

export function to_array<item>(array: ArrayValue<item>): item[] {
  return [...array.value()];
}

Format.implement(ArrayT)({
  fmt() {
    const array = this.value();
    return Deno.inspect(array);
  },
});

export interface AsArray extends Format<AsArray> {}

Equal.implement(ArrayT)({
  eq(right) {
    const left = this.value();
    const right_value = right.value();

    if (left.length !== right_value.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!Object.is(left[index], right_value[index])) {
        return false;
      }
    }

    return true;
  },
});

export interface AsArray extends Equal<AsArray> {}

Functor.implement(ArrayT)({
  map(fn) {
    const array = this.value();
    return ArrayT(array.map(fn));
  },
});

export interface AsArray extends Functor<AsArray> {}

Applicative.implement(ArrayT)({
  pure(value) {
    return ArrayT([value]);
  },

  ap(values) {
    const fns = this.value();
    const items = values.value();

    return ArrayT(fns.flatMap((fn) => items.map(fn)));
  },
});

export interface AsArray extends Applicative<AsArray> {}

Semigroup.implement(ArrayT)({
  concat(right) {
    const left = this.value();
    return ArrayT([...left, ...right.value()]);
  },
});

export interface AsArray extends Semigroup<AsArray> {}

Monoid.implement(ArrayT)({
  empty() {
    return ArrayT([]);
  },
});

export interface AsArray extends Monoid<AsArray> {}

Alternative.implement(ArrayT)({
  empty() {
    return ArrayT([]);
  },

  alt(right) {
    const left = this.value();
    return ArrayT([...left, ...right.value()]);
  },
});

export interface AsArray extends Alternative<AsArray> {}

Monad.implement(ArrayT)({
  bind(fn) {
    const array = this.value();
    return ArrayT(array.flatMap((item) => fn(item).value()));
  },
});

export interface AsArray extends Monad<AsArray> {}

Foldable.implement(ArrayT)({
  fold(initial, fn) {
    const array = this.value();
    let state = initial;

    for (const item of array) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface AsArray extends Foldable<AsArray> {}

Traversable.implement(ArrayT)({
  traverse(applicative, fn) {
    const array = this.value();

    if (array.length === 0) {
      return Applicative.pure(applicative, ArrayT([]));
    }

    let index = array.length - 1;
    let out = Functor.map(fn(array[index]), array_single);

    for (index -= 1; index >= 0; index -= 1) {
      out = Applicative.ap(Functor.map(fn(array[index]), array_prepend), out);
    }

    return out;
  },
});

export interface AsArray extends Traversable<AsArray> {}

function array_single<item>(item: item): ArrayValue<item> {
  return ArrayT([item]);
}

function array_prepend<item>(head: item) {
  return (tail: ArrayValue<item>) => ArrayT([head, ...tail.value()]);
}

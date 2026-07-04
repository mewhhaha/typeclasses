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

export type IterableT<item> = () => Iterable<item>;

export const iterable_kind = Symbol("IterableT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [iterable_kind]: IterableT<item>;
  }
}

export interface AsIterable extends As<typeof iterable_kind> {}

type IterableValue<item> = Value<AsIterable, item>;

export const IterableT = define<AsIterable>(
  iterable_kind,
);

export function from_factory<item>(
  factory: () => Iterable<item>,
): IterableValue<item> {
  return IterableT(factory);
}

export function from_iterable<item>(
  iterable: Iterable<item>,
): IterableValue<item> {
  const items = [...iterable];
  return IterableT(() => items);
}

export function to_array<item>(iterable: IterableValue<item>): item[] {
  return [...iterable.value()()];
}

Format.implement(IterableT)({
  fmt() {
    return Deno.inspect([...this.value()()]);
  },
});

export interface AsIterable extends Format<AsIterable> {}

Equal.implement(IterableT)({
  eq(right) {
    const left_iterator = this.value()()[Symbol.iterator]();
    const right_iterator = right.value()()[Symbol.iterator]();

    while (true) {
      const left = left_iterator.next();
      const right = right_iterator.next();

      if (left.done === true || right.done === true) {
        return left.done === right.done;
      }

      if (!Object.is(left.value, right.value)) {
        return false;
      }
    }
  },
});

export interface AsIterable extends Equal<AsIterable> {}

Functor.implement(IterableT)({
  map(fn) {
    const source = this.value();

    return IterableT(function* () {
      for (const item of source()) {
        yield fn(item);
      }
    });
  },
});

export interface AsIterable extends Functor<AsIterable> {}

Applicative.implement(IterableT)({
  pure(value) {
    return IterableT(function* () {
      yield value;
    });
  },

  ap(values) {
    const fns = this.value();
    const items = values.value();

    return IterableT(function* () {
      for (const fn of fns()) {
        for (const item of items()) {
          yield fn(item);
        }
      }
    });
  },
});

export interface AsIterable extends Applicative<AsIterable> {}

Semigroup.implement(IterableT)({
  concat(right) {
    const left = this.value();
    const right_value = right.value();

    return IterableT(function* () {
      yield* left();
      yield* right_value();
    });
  },
});

export interface AsIterable extends Semigroup<AsIterable> {}

Monoid.implement(IterableT)({
  empty() {
    return IterableT(function* () {});
  },
});

export interface AsIterable extends Monoid<AsIterable> {}

Alternative.implement(IterableT)({
  empty() {
    return IterableT(function* () {});
  },

  alt(right) {
    const left = this.value();
    const right_value = right.value();

    return IterableT(function* () {
      yield* left();
      yield* right_value();
    });
  },
});

export interface AsIterable extends Alternative<AsIterable> {}

Monad.implement(IterableT)({
  bind(fn) {
    const source = this.value();

    return IterableT(function* () {
      for (const item of source()) {
        yield* fn(item).value()();
      }
    });
  },
});

export interface AsIterable extends Monad<AsIterable> {}

Foldable.implement(IterableT)({
  fold(initial, fn) {
    let state = initial;

    for (const item of this.value()()) {
      state = fn(state, item);
    }

    return state;
  },
});

export interface AsIterable extends Foldable<AsIterable> {}

Traversable.implement(IterableT)({
  traverse(applicative, fn) {
    const items = [...this.value()()];

    if (items.length === 0) {
      return Applicative.pure(applicative, IterableT(function* () {}));
    }

    let index = items.length - 1;
    let out = Functor.map(fn(items[index]), iterable_single);

    for (index -= 1; index >= 0; index -= 1) {
      out = Applicative.ap(
        Functor.map(fn(items[index]), iterable_prepend),
        out,
      );
    }

    return out;
  },
});

export interface AsIterable extends Traversable<AsIterable> {}

function iterable_single<item>(item: item): IterableValue<item> {
  return IterableT(function* () {
    yield item;
  });
}

function iterable_prepend<item>(head: item) {
  return (tail: IterableValue<item>) => {
    return IterableT(function* () {
      yield head;
      yield* tail.value()();
    });
  };
}

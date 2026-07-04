import { type As, define, type Value } from "./trait.ts";
import {
  Alternative,
  Applicative,
  Format,
  Functor,
  Monad,
  Monoid,
  Semigroup,
} from "./traits.ts";

export type AsyncIterableT<item> = () => AsyncIterable<item>;

export const async_iterable_kind = Symbol("AsyncIterableT");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [async_iterable_kind]: AsyncIterableT<item>;
  }
}

export interface AsAsyncIterable extends As<typeof async_iterable_kind> {}

type AsyncIterableValue<item> = Value<AsAsyncIterable, item>;

export const AsyncIterableT = define<AsAsyncIterable>(
  async_iterable_kind,
);

export function from_factory<item>(
  factory: () => AsyncIterable<item>,
): AsyncIterableValue<item> {
  return AsyncIterableT(factory);
}

export function from_async_iterable<item>(
  iterable: AsyncIterable<item>,
): AsyncIterableValue<item> {
  return AsyncIterableT(() => iterable);
}

export async function to_array<item>(
  iterable: AsyncIterableValue<item>,
): Promise<item[]> {
  const items: item[] = [];

  for await (const item of iterable.value()()) {
    items.push(item);
  }

  return items;
}

Format.implement(AsyncIterableT)({
  fmt() {
    return "AsyncIterable(?)";
  },
});

export interface AsAsyncIterable extends Format<AsAsyncIterable> {}

Functor.implement(AsyncIterableT)({
  map(fn) {
    const source = this.value();

    return AsyncIterableT(async function* () {
      for await (const item of source()) {
        yield fn(item);
      }
    });
  },
});

export interface AsAsyncIterable extends Functor<AsAsyncIterable> {}

Applicative.implement(AsyncIterableT)({
  pure(value) {
    return AsyncIterableT(async function* () {
      yield value;
    });
  },

  ap(values) {
    const fns = this.value();
    const items = values.value();

    return AsyncIterableT(async function* () {
      for await (const fn of fns()) {
        for await (const item of items()) {
          yield fn(item);
        }
      }
    });
  },
});

export interface AsAsyncIterable extends Applicative<AsAsyncIterable> {}

Semigroup.implement(AsyncIterableT)({
  concat(right) {
    const left = this.value();
    const right_value = right.value();

    return AsyncIterableT(async function* () {
      yield* left();
      yield* right_value();
    });
  },
});

export interface AsAsyncIterable extends Semigroup<AsAsyncIterable> {}

Monoid.implement(AsyncIterableT)({
  empty() {
    return AsyncIterableT(async function* () {});
  },
});

export interface AsAsyncIterable extends Monoid<AsAsyncIterable> {}

Alternative.implement(AsyncIterableT)({
  empty() {
    return AsyncIterableT(async function* () {});
  },

  alt(right) {
    const left = this.value();
    const right_value = right.value();

    return AsyncIterableT(async function* () {
      yield* left();
      yield* right_value();
    });
  },
});

export interface AsAsyncIterable extends Alternative<AsAsyncIterable> {}

Monad.implement(AsyncIterableT)({
  bind(fn) {
    const source = this.value();

    return AsyncIterableT(async function* () {
      for await (const item of source()) {
        yield* fn(item).value()();
      }
    });
  },
});

export interface AsAsyncIterable extends Monad<AsAsyncIterable> {}

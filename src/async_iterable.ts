import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Alternative,
  Applicative,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Show,
} from "./typeclasses.ts";

export type AsyncIterableT<item> = () => AsyncIterable<item>;

export interface AsAsyncIterable
  extends
    As<AsAsyncIterable>,
    Show<AsAsyncIterable>,
    Functor<AsAsyncIterable>,
    Applicative<AsAsyncIterable>,
    Semigroup<AsAsyncIterable>,
    Monoid<AsAsyncIterable>,
    Alternative<AsAsyncIterable>,
    Monad<AsAsyncIterable> {
  readonly [type_item]: unknown;
  readonly [type_data]: AsyncIterableT<this[typeof type_item]>;
}

type AsyncIterableValue<item> = Data<AsAsyncIterable, item>;

export const AsyncIterableT = data<AsAsyncIterable>();

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

Show.instance(AsyncIterableT)({
  show() {
    return "AsyncIterable(?)";
  },
});

Functor.instance(AsyncIterableT)({
  map(fn) {
    const source = this.value();

    return AsyncIterableT(async function* () {
      for await (const item of source()) {
        yield fn(item);
      }
    });
  },
});

Applicative.instance(AsyncIterableT)({
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

Semigroup.instance(AsyncIterableT)({
  concat(right) {
    const left = this.value();
    const right_value = right.value();

    return AsyncIterableT(async function* () {
      yield* left();
      yield* right_value();
    });
  },
});

Monoid.instance(AsyncIterableT)({
  empty() {
    return AsyncIterableT(async function* () {});
  },
});

Alternative.instance(AsyncIterableT)({
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

Monad.instance(AsyncIterableT)({
  bind(fn) {
    const source = this.value();

    return AsyncIterableT(async function* () {
      for await (const item of source()) {
        yield* fn(item).value()();
      }
    });
  },
});

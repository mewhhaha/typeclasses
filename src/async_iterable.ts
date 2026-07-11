import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { append_item } from "./internal.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
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
    Monoid<AsAsyncIterable>,
    Alternative<AsAsyncIterable>,
    Monad<AsAsyncIterable> {
  readonly [type_item]: unknown;
  readonly [type_data]: AsyncIterableT<this[typeof type_item]>;
}

type AsyncIterableValue<item> = Data<AsAsyncIterable, item>;

export const AsyncIterableT: AsAsyncIterable = data<AsAsyncIterable>();

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

  // The specialized ladder avoids the generic applicative_lift fallback's intermediates.
  [applicative_lift_method](fn, rest) {
    const first = this.value();

    switch (rest.length) {
      case 0:
        return AsyncIterableT(async function* () {
          for await (const value of first()) {
            yield fn(value);
          }
        });
      case 1:
        return lift_async_iterable_two(fn, first, rest[0].value());
      case 2:
        return lift_async_iterable_three(
          fn,
          first,
          rest[0].value(),
          rest[1].value(),
        );
      default:
        return lift_async_iterable_many(fn, first, rest);
    }
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

function lift_async_iterable_two<out>(
  fn: (...values: unknown[]) => out,
  first: AsyncIterableT<unknown>,
  second: AsyncIterableT<unknown>,
): AsyncIterableValue<out> {
  return AsyncIterableT(async function* () {
    for await (const left of first()) {
      for await (const right of second()) {
        yield fn(left, right);
      }
    }
  });
}

function lift_async_iterable_three<out>(
  fn: (...values: unknown[]) => out,
  first: AsyncIterableT<unknown>,
  second: AsyncIterableT<unknown>,
  third: AsyncIterableT<unknown>,
): AsyncIterableValue<out> {
  return AsyncIterableT(async function* () {
    for await (const left of first()) {
      for await (const middle of second()) {
        for await (const right of third()) {
          yield fn(left, middle, right);
        }
      }
    }
  });
}

function lift_async_iterable_many<out>(
  fn: (...values: unknown[]) => out,
  first: AsyncIterableT<unknown>,
  rest: readonly AsyncIterableValue<unknown>[],
): AsyncIterableValue<out> {
  const sources = [
    first,
    ...rest.map((current) => current.value()),
  ];

  return AsyncIterableT(async function* () {
    yield* iterate_async_iterable_product(fn, sources, 0, []);
  });
}

async function* iterate_async_iterable_product<out>(
  fn: (...values: unknown[]) => out,
  sources: readonly AsyncIterableT<unknown>[],
  index: number,
  values: readonly unknown[],
): AsyncGenerator<out> {
  if (index >= sources.length) {
    yield fn(...values);
    return;
  }

  for await (const item of sources[index]()) {
    yield* iterate_async_iterable_product(
      fn,
      sources,
      index + 1,
      append_item(values, item),
    );
  }
}

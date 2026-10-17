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
  applicative_lift_method,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const async_iterable_identity: unique symbol;

/** A factory that supplies the async iterable wrapped by the dictionary. */
export type AsyncIterableT<item> = () => AsyncIterable<item>;

/** Dictionary type for lazy asynchronous iterable factories. */
export interface AsAsyncIterable
  extends
    As<AsAsyncIterable, typeof async_iterable_identity>,
    Show<AsAsyncIterable>,
    Monoid<AsAsyncIterable>,
    Alternative<AsAsyncIterable>,
    Monad<AsAsyncIterable> {
  /** Higher-kinded slot for the asynchronously yielded value type. */
  readonly [type_item]: unknown;
  /** Async-iterable factory at the selected value type. */
  readonly [type_data]: AsyncIterableT<this[typeof type_item]>;
  /** Keep matching values lazily. */
  filter<item, narrowed extends item>(
    this: AsyncIterableValue<item>,
    predicate: (item: item) => item is narrowed,
  ): AsyncIterableValue<narrowed>;
  /** Keep matching values lazily, awaiting asynchronous predicates. */
  filter<item>(
    this: AsyncIterableValue<item>,
    predicate: (item: item) => boolean | PromiseLike<boolean>,
  ): AsyncIterableValue<item>;
  /** Yield at most count values and close the upstream iterator. */
  take<item>(
    this: AsyncIterableValue<item>,
    count: number,
  ): AsyncIterableValue<item>;
}

/** @ignore */
export type AsyncIterableValue<item> = Data<AsAsyncIterable, item>;

/** Callable async-iterable dictionary with lazy list-like instances. */
export const AsyncIterableT: AsAsyncIterable = data<AsAsyncIterable>();

/** Wrap a factory whose async iterable is requested for each traversal. */
export function from_factory<item>(
  factory: () => AsyncIterable<item>,
): AsyncIterableValue<item> {
  return AsyncIterableT(factory);
}

/** Snapshot a finite async iterable so the wrapped value can be replayed. */
export async function from_async_iterable<item>(
  iterable: AsyncIterable<item>,
): Promise<AsyncIterableValue<item>> {
  const items: item[] = [];

  for await (const item of iterable) {
    items.push(item);
  }

  return AsyncIterableT(async function* () {
    yield* items;
  });
}

/** Asynchronously materialize a wrapped iterable into a mutable array. */
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
  empty: empty_async_iterable,
});

Alternative.instance(AsyncIterableT)({
  empty: empty_async_iterable,

  alt(right) {
    const left = this.value();
    const right_value = right.value();

    return AsyncIterableT(async function* () {
      yield* left();
      yield* right_value();
    });
  },
});

function empty_async_iterable<item>(
  this: AsAsyncIterable,
): Data<AsAsyncIterable, item> {
  return AsyncIterableT(async function* () {});
}

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

function lift_async_iterable_two<output>(
  fn: (...values: unknown[]) => output,
  first: AsyncIterableT<unknown>,
  second: AsyncIterableT<unknown>,
): AsyncIterableValue<output> {
  return AsyncIterableT(async function* () {
    for await (const left of first()) {
      for await (const right of second()) {
        yield fn(left, right);
      }
    }
  });
}

function lift_async_iterable_three<output>(
  fn: (...values: unknown[]) => output,
  first: AsyncIterableT<unknown>,
  second: AsyncIterableT<unknown>,
  third: AsyncIterableT<unknown>,
): AsyncIterableValue<output> {
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

function lift_async_iterable_many<output>(
  fn: (...values: unknown[]) => output,
  first: AsyncIterableT<unknown>,
  rest: readonly AsyncIterableValue<unknown>[],
): AsyncIterableValue<output> {
  const sources = [
    first,
    ...rest.map((current) => current.value()),
  ];

  return AsyncIterableT(async function* () {
    yield* iterate_async_iterable_product(fn, sources, 0, []);
  });
}

async function* iterate_async_iterable_product<output>(
  fn: (...values: unknown[]) => output,
  sources: readonly AsyncIterableT<unknown>[],
  index: number,
  values: unknown[],
): AsyncGenerator<output> {
  if (index >= sources.length) {
    yield fn(...values);
    return;
  }

  for await (const item of sources[index]()) {
    values[index] = item;
    yield* iterate_async_iterable_product(
      fn,
      sources,
      index + 1,
      values,
    );
  }
}

/** Lazily retain values, preserving type guard narrowing. */
export function filter<item, narrowed extends item>(
  iterable: AsyncIterableValue<item>,
  predicate: (item: NoInfer<item>) => item is narrowed,
): AsyncIterableValue<narrowed>;
/** Lazily retain values, awaiting asynchronous predicates. */
export function filter<item>(
  iterable: AsyncIterableValue<item>,
  predicate: (item: NoInfer<item>) => boolean | PromiseLike<boolean>,
): AsyncIterableValue<item>;
export function filter<item>(
  iterable: AsyncIterableValue<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): AsyncIterableValue<item> {
  const source = iterable.value();
  return AsyncIterableT(async function* () {
    for await (const item of source()) {
      if (await predicate(item)) yield item;
    }
  });
}

/** Bound demand without reading ahead. Zero never opens the source. */
export function take<item>(
  iterable: AsyncIterableValue<item>,
  count: number,
): AsyncIterableValue<item> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("take count must be a nonnegative safe integer");
  }
  const source = iterable.value();
  return AsyncIterableT(async function* () {
    if (count === 0) return;
    let remaining = count;
    for await (const item of source()) {
      yield item;
      remaining -= 1;
      if (remaining === 0) return;
    }
  });
}

AsyncIterableT.filter = function <item>(
  this: AsyncIterableValue<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): AsyncIterableValue<item> {
  return filter(this, predicate);
};
AsyncIterableT.take = function <item>(
  this: AsyncIterableValue<item>,
  count: number,
): AsyncIterableValue<item> {
  return take(this, count);
};

/** Collect at most limit values and close upstream without reading ahead. */
export function preview<item>(
  iterable: AsyncIterableValue<item>,
  limit = 100,
): Promise<item[]> {
  return to_array(take(iterable, limit));
}

/** Explicit finite snapshot; consumes the source immediately. */
export const from_snapshot = from_async_iterable;

/**
 * Map with bounded, ordered concurrency and incremental source demand. At most
 * concurrency inputs are admitted ahead of the consumer. Early exit closes the
 * source and aborts in-flight callbacks through their shared signal. Callbacks
 * must cooperate with cancellation; their outcomes are always observed.
 */
export function map_concurrent<from, to>(
  iterable: AsyncIterableValue<from>,
  concurrency: number,
  fn: (item: from, index: number, signal: AbortSignal) => to | PromiseLike<to>,
  options: { readonly signal?: AbortSignal } = {},
): AsyncIterableValue<to> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive safe integer");
  }
  const external = options.signal;
  return AsyncIterableT(async function* () {
    const controller = new AbortController();
    const signal = controller.signal;
    const abort = () => controller.abort(external?.reason);
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    type Outcome =
      | { readonly ok: true; readonly value: to }
      | { readonly ok: false; readonly error: unknown };
    const pending: Promise<Outcome>[] = [];
    let source: AsyncIterator<from> | undefined;
    let index = 0;
    let ended = false;
    let failure: { readonly error: unknown } | undefined;
    try {
      signal.throwIfAborted();
      source = iterable.value()()[Symbol.asyncIterator]();
      while (true) {
        while (
          !ended && pending.length < concurrency && failure === undefined
        ) {
          signal.throwIfAborted();
          const next = await wait_for(source.next(), signal);
          signal.throwIfAborted();
          if (next.done) {
            ended = true;
            break;
          }
          const task_index = index++;
          const task = Promise.resolve().then(async () => {
            signal.throwIfAborted();
            return await fn(next.value, task_index, signal);
          }).then(
            (value): Outcome => ({ ok: true, value }),
            (error): Outcome => {
              failure = { error };
              controller.abort(error);
              return { ok: false, error };
            },
          );
          pending.push(task);
        }
        if (failure !== undefined) throw failure.error;
        if (pending.length === 0) return;
        const outcome = await wait_for(pending.shift()!, signal);
        if (!outcome.ok) throw outcome.error;
        signal.throwIfAborted();
        yield outcome.value;
      }
    } finally {
      controller.abort();
      external?.removeEventListener("abort", abort);
      if (!ended) await source?.return?.();
    }
  });
}

function wait_for<item>(
  operation: PromiseLike<item>,
  signal: AbortSignal,
): Promise<item> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    // Both continuations remain attached even after cancellation, observing late
    // failures from user callbacks and upstream reads.
    Promise.resolve(operation).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

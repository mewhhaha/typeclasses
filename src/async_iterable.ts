import type { Runnable } from "./data_value.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import { Just, type Maybe, Nothing } from "./maybe.ts";
import {
  Alternative,
  Applicative,
  applicative_lift_method,
  type FoldStep,
  Functor,
  Monad,
  Monoid,
  Semigroup,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export const async_iterable_identity: unique symbol = /* @__PURE__ */ Symbol(
  "async_iterable_identity",
);

/** A factory that supplies the async iterable wrapped by the dictionary. */
export type RawAsyncIterableT<item> = () => AsyncIterable<item>;

/** @ignore */
export interface AsAsyncIterableLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawAsyncIterableT<this[typeof type_item]>;
}

/** Dictionary type for lazy asynchronous iterable factories. */
export interface AsAsyncIterable
  extends
    As<AsAsyncIterableLambda, typeof async_iterable_identity>,
    Show<AsAsyncIterable>,
    Monoid<AsAsyncIterable>,
    Alternative<AsAsyncIterable>,
    Monad<AsAsyncIterable>,
    Runnable {
  /** Keep matching values lazily. */
  filter<item, narrowed extends item>(
    this: AsyncIterableT<item>,
    predicate: (item: item) => item is narrowed,
  ): AsyncIterableT<narrowed>;
  /** Keep matching values lazily, awaiting asynchronous predicates. */
  filter<item>(
    this: AsyncIterableT<item>,
    predicate: (item: item) => boolean | PromiseLike<boolean>,
  ): AsyncIterableT<item>;
  /** Yield at most count values and close the upstream iterator. */
  take<item>(
    this: AsyncIterableT<item>,
    count: number,
  ): AsyncIterableT<item>;
}

/** A wrapped AsyncIterableT value with its dictionary operations. */
export type AsyncIterableT<item> = Data<AsAsyncIterable, item>;

/** Callable async-iterable dictionary with lazy list-like instances. */
export const AsyncIterableT: AsAsyncIterable = data<AsAsyncIterable>(
  async_iterable_identity,
);

/** Wrap a factory whose async iterable is requested for each traversal. */
export function from_factory<item>(
  factory: () => AsyncIterable<item>,
): AsyncIterableT<item> {
  return AsyncIterableT(factory);
}

/** Snapshot a finite async iterable so the wrapped value can be replayed. */
export async function from_async_iterable<item>(
  iterable: AsyncIterable<item>,
): Promise<AsyncIterableT<item>> {
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
  iterable: AsyncIterableT<item>,
): Promise<item[]> {
  const items: item[] = [];
  const factory = iterable.value();
  const chunks = chunk_sources.get(factory);
  if (chunks !== undefined) {
    for await (const chunk of chunks()) {
      for (const item of chunk) {
        if (is_promise_like(item)) items.push(await item as item);
        else items.push(item as item);
      }
    }
    return items;
  }
  for await (const item of factory()) items.push(item);
  return items;
}

Show.instance(AsyncIterableT)({
  show() {
    return "AsyncIterable(?)";
  },
});

Functor.instance(AsyncIterableT)({
  map(fn) {
    return pipeline(this, { tag: "map", fn: fn as (item: unknown) => unknown });
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
  first: RawAsyncIterableT<unknown>,
  second: RawAsyncIterableT<unknown>,
): AsyncIterableT<output> {
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
  first: RawAsyncIterableT<unknown>,
  second: RawAsyncIterableT<unknown>,
  third: RawAsyncIterableT<unknown>,
): AsyncIterableT<output> {
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
  first: RawAsyncIterableT<unknown>,
  rest: readonly AsyncIterableT<unknown>[],
): AsyncIterableT<output> {
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
  sources: readonly RawAsyncIterableT<unknown>[],
  _index: number,
  values: unknown[],
): AsyncGenerator<output> {
  const iterators: AsyncIterator<unknown>[] = [];
  let depth = 0;
  let failed = false;
  try {
    while (depth >= 0) {
      if (depth === sources.length) {
        yield fn(...values);
        depth -= 1;
        continue;
      }
      const iterator = iterators[depth] ??= sources[depth]()
        [Symbol.asyncIterator]();
      const next = await iterator.next();
      if (next.done) {
        iterators.pop();
        depth -= 1;
        continue;
      }
      values[depth] = next.value;
      depth += 1;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await close_iterators(iterators, failed);
  }
}

/** Lazily retain values, preserving type guard narrowing. */
export function filter<item, narrowed extends item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: NoInfer<item>) => item is narrowed,
): AsyncIterableT<narrowed>;
/** Lazily retain values, awaiting asynchronous predicates. */
export function filter<item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: NoInfer<item>) => boolean | PromiseLike<boolean>,
): AsyncIterableT<item>;
export function filter<item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): AsyncIterableT<item> {
  return pipeline(iterable, {
    tag: "filter",
    fn: predicate as (item: unknown) => boolean | PromiseLike<boolean>,
  });
}

/** Bound demand without reading ahead. Zero never opens the source. */
export function take<item>(
  iterable: AsyncIterableT<item>,
  count: number,
): AsyncIterableT<item> {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError("take count must be a nonnegative safe integer");
  }
  return pipeline(iterable, { tag: "take", count });
}

AsyncIterableT.filter = function <item>(
  this: AsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): AsyncIterableT<item> {
  return filter(this, predicate);
};
AsyncIterableT.take = function <item>(
  this: AsyncIterableT<item>,
  count: number,
): AsyncIterableT<item> {
  return take(this, count);
};

/** Collect at most limit values and close upstream without reading ahead. */
export function preview<item>(
  iterable: AsyncIterableT<item>,
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
  iterable: AsyncIterableT<from>,
  concurrency: number,
  fn: (item: from, index: number, signal: AbortSignal) => to | PromiseLike<to>,
  options: { readonly signal?: AbortSignal } = {},
): AsyncIterableT<to> {
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
    const pending: (Promise<Outcome> | undefined)[] = [];
    let pending_head = 0;
    let pending_count = 0;
    const waiter = traversal_waiter(signal);
    let source: AsyncIterator<from> | undefined;
    let index = 0;
    let ended = false;
    let failure: { readonly error: unknown } | undefined;
    let primary_failure: { readonly error: unknown } | undefined;
    try {
      signal.throwIfAborted();
      source = iterable.value()()[Symbol.asyncIterator]();
      while (true) {
        while (
          !ended && pending_count < concurrency && failure === undefined
        ) {
          signal.throwIfAborted();
          const next = await waiter.wait(source.next());
          signal.throwIfAborted();
          if (next.done) {
            ended = true;
            break;
          }
          const task_index = index++;
          const task = Promise.resolve().then(() => {
            signal.throwIfAborted();
            return fn(next.value, task_index, signal);
          }).then(
            (value): Outcome => ({ ok: true, value }),
            (error): Outcome => {
              failure = { error };
              controller.abort(error);
              return { ok: false, error };
            },
          );
          pending[(pending_head + pending_count) % concurrency] = task;
          pending_count += 1;
        }
        if (failure !== undefined) throw failure.error;
        if (pending_count === 0) return;
        const task = pending[pending_head]!;
        pending[pending_head] = undefined;
        pending_head = (pending_head + 1) % concurrency;
        pending_count -= 1;
        const outcome = await waiter.wait(task);
        if (!outcome.ok) throw outcome.error;
        signal.throwIfAborted();
        yield outcome.value;
      }
    } catch (error) {
      primary_failure = { error };
      throw error;
    } finally {
      controller.abort();
      waiter.close();
      external?.removeEventListener("abort", abort);
      if (!ended) await close_concurrent_source(source, primary_failure);
    }
  });
}

// One cancellation listener per traversal. Each operation still has both
// continuations attached so cancellation cannot leave a late rejection unobserved.
function traversal_waiter(signal: AbortSignal) {
  const waiting = new Set<(reason: unknown) => void>();
  const abort = () => {
    for (const reject of waiting) reject(signal.reason);
    waiting.clear();
  };
  signal.addEventListener("abort", abort, { once: true });
  return {
    wait<item>(operation: PromiseLike<item>): Promise<item> {
      return new Promise((resolve, reject) => {
        waiting.add(reject);
        Promise.resolve(operation).then(
          (value) => {
            waiting.delete(reject);
            resolve(value);
          },
          (error) => {
            waiting.delete(reject);
            reject(error);
          },
        );
        if (signal.aborted) abort();
      });
    },
    notification(register: (resolve: () => void) => void): Promise<void> {
      return new Promise((resolve, reject) => {
        waiting.add(reject);
        register(() => {
          waiting.delete(reject);
          resolve();
        });
        if (signal.aborted) abort();
      });
    },
    close() {
      signal.removeEventListener("abort", abort);
    },
  };
}

/** Reduce until Done, closing the source before resolving. */
export async function fold_while<item, state>(
  iterable: AsyncIterableT<item>,
  initial: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  let state = initial;
  for await (const item of iterable.value()()) {
    const [tag, next] = await fn(state, item);
    state = next;
    if (tag === "Done") return state;
  }
  return state;
}

/** Find the first match and close the source before resolving. */
export async function find<item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  for await (const item of iterable.value()()) {
    if (await predicate(item)) return Just(item);
  }
  return Nothing();
}

/** Test for a matching value with bounded demand. */
export async function some<item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  for await (const item of iterable.value()()) {
    if (await predicate(item)) return true;
  }
  return false;
}

type Stage =
  | {
    readonly tag: "map" | "map_sync";
    readonly fn: (item: unknown) => unknown;
  }
  | {
    readonly tag: "filter_map";
    readonly fn: (item: unknown) => Maybe<unknown>;
  }
  | {
    readonly tag: "filter";
    readonly fn: (item: unknown) => boolean | PromiseLike<boolean>;
  }
  | { readonly tag: "take"; readonly count: number };
type Stages = { readonly stage: Stage; readonly previous?: Stages };
type Pipeline = {
  readonly source: RawAsyncIterableT<unknown>;
  readonly stages: Stages;
  ordered?: readonly Stage[];
};
const pipelines = new WeakMap<RawAsyncIterableT<unknown>, Pipeline>();
const sync_sources = new WeakMap<
  RawAsyncIterableT<unknown>,
  () => Iterable<unknown>
>();
const chunk_sources = new WeakMap<
  RawAsyncIterableT<unknown>,
  () => AsyncIterable<readonly unknown[]>
>();

function pipeline<from, to = from>(
  value: AsyncIterableT<from>,
  stage: Stage,
): AsyncIterableT<to> {
  const current = value.value();
  const previous = pipelines.get(current);
  let source: RawAsyncIterableT<unknown> = current;
  let stages: Stages = { stage };
  if (previous !== undefined) {
    source = previous.source;
    stages = { stage, previous: previous.stages };
  }
  const plan: Pipeline = { source, stages };
  const factory = async function* (): AsyncGenerator<to> {
    if (plan.ordered === undefined) {
      const ordered: Stage[] = [];
      let link: Stages | undefined = stages;
      while (link !== undefined) {
        ordered.push(link.stage);
        link = link.previous;
      }
      plan.ordered = ordered.reverse();
    }
    const ordered = plan.ordered;
    let remaining: number[] | undefined;
    if (ordered.some((stage) => stage.tag === "take")) {
      remaining = ordered.map((stage) => {
        if (stage.tag === "take") return stage.count;
        return Infinity;
      });
      if (remaining.includes(0)) return;
    }
    const synchronous = sync_sources.get(source);
    let sync: Iterator<unknown> | undefined;
    let async: AsyncIterator<unknown> | undefined;
    if (synchronous !== undefined) sync = synchronous()[Symbol.iterator]();
    else async = source()[Symbol.asyncIterator]();
    let ended = false;
    let failed = false;
    try {
      while (true) {
        let next: IteratorResult<unknown>;
        if (sync !== undefined) next = sync.next();
        else next = await async!.next();
        if (next.done) {
          ended = true;
          return;
        }
        let item = next.value;
        let keep = true;
        let stop = false;
        for (let index = 0; index < ordered.length; index += 1) {
          const operation = ordered[index];
          switch (operation.tag) {
            case "map":
              item = operation.fn(item);
              if (is_promise_like(item)) item = await item;
              break;
            case "filter": {
              const result = operation.fn(item);
              if (is_promise_like(result)) keep = await result;
              else keep = result;
              break;
            }
            case "take":
              remaining![index] -= 1;
              if (remaining![index] === 0) stop = true;
              break;
            case "map_sync":
              item = operation.fn(item);
              break;
            case "filter_map": {
              const [tag, value] = operation.fn(item).value();
              if (tag === "Nothing") keep = false;
              else item = value;
              break;
            }
          }
          if (!keep) break;
        }
        if (keep) yield item as to;
        if (stop) return;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!ended) await close_pipeline_source(sync, async, failed);
    }
  };
  pipelines.set(factory, plan);
  return AsyncIterableT(factory);
}

function is_promise_like<item>(
  value: item | PromiseLike<item>,
): value is PromiseLike<item> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value && typeof value.then === "function";
}

/**
 * Yield results in completion order. Admission is bounded by concurrency,
 * including completed results awaiting demand. Early exit aborts callbacks and
 * closes upstream; every callback rejection remains observed.
 */
export function map_concurrent_unordered<from, to>(
  iterable: AsyncIterableT<from>,
  concurrency: number,
  fn: (item: from, index: number, signal: AbortSignal) => to | PromiseLike<to>,
  options: { readonly signal?: AbortSignal } = {},
): AsyncIterableT<to> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive safe integer");
  }
  return AsyncIterableT(async function* () {
    const controller = new AbortController();
    const signal = controller.signal;
    const external = options.signal;
    const abort = () => controller.abort(external?.reason);
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    const ready: (to | undefined)[] = [];
    let ready_head = 0;
    let ready_count = 0;
    const waiter = traversal_waiter(signal);
    let wake: (() => void) | undefined;
    let admitted = 0;
    let index = 0;
    let ended = false;
    let reading = false;
    let read: IteratorResult<from> | undefined;
    let source: AsyncIterator<from> | undefined;
    let failure: { error: unknown } | undefined;
    let primary_failure: { readonly error: unknown } | undefined;
    const fail = (error: unknown) => {
      failure = { error };
      controller.abort(error);
      wake?.();
    };
    try {
      signal.throwIfAborted();
      source = iterable.value()()[Symbol.asyncIterator]();
      while (true) {
        if (failure !== undefined) throw failure.error;
        signal.throwIfAborted();
        if (read !== undefined) {
          const next = read;
          read = undefined;
          if (next.done) ended = true;
          else {
            const id = index++;
            admitted += 1;
            Promise.resolve().then(() => {
              signal.throwIfAborted();
              return fn(next.value, id, signal);
            }).then(
              (value) => {
                ready[(ready_head + ready_count) % concurrency] = value;
                ready_count += 1;
                wake?.();
              },
              fail,
            );
          }
          continue;
        }
        // A pending upstream read never blocks an already completed callback.
        // The read reserves one of the available admission slots.
        if (!ended && admitted < concurrency && !reading) {
          reading = true;
          Promise.resolve().then(() => {
            signal.throwIfAborted();
            return source!.next();
          }).then(
            (next) => {
              reading = false;
              read = next;
              wake?.();
            },
            fail,
          );
        }
        if (ready_count > 0) {
          admitted -= 1;
          const value = ready[ready_head]!;
          ready[ready_head] = undefined;
          ready_head = (ready_head + 1) % concurrency;
          ready_count -= 1;
          yield value;
          continue;
        }
        if (ended && admitted === 0) return;
        await waiter.notification((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    } catch (error) {
      primary_failure = { error };
      throw error;
    } finally {
      controller.abort();
      waiter.close();
      external?.removeEventListener("abort", abort);
      if (!ended) await close_concurrent_source(source, primary_failure);
    }
  });
}

async function close_concurrent_source(
  source: AsyncIterator<unknown> | undefined,
  primary_failure: { readonly error: unknown } | undefined,
): Promise<void> {
  try {
    await source?.return?.();
  } catch (cleanup_error) {
    if (primary_failure !== undefined) {
      throw new AggregateError(
        [primary_failure.error, cleanup_error],
        "Async iterable mapping and iterator cleanup both failed",
      );
    }
    throw cleanup_error;
  }
}

async function close_iterators(
  iterators: readonly AsyncIterator<unknown>[],
  failed: boolean,
): Promise<void> {
  let failure: { error: unknown } | undefined;
  for (let index = iterators.length - 1; index >= 0; index -= 1) {
    try {
      await iterators[index].return?.();
    } catch (error) {
      failure ??= { error };
    }
  }
  if (!failed && failure !== undefined) throw failure.error;
}

/** Trust a synchronous source: values are read without an await per input. */
export function from_sync_factory<item>(
  factory: () => Iterable<item>,
): AsyncIterableT<item> {
  const source = async function* () {
    yield* factory();
  };
  sync_sources.set(source, factory);
  return AsyncIterableT(source);
}

/** Map without inspecting or awaiting intermediate callback results. */
export function map_sync<from, to>(
  iterable: AsyncIterableT<from>,
  fn: (item: from) => to,
): AsyncIterableT<to> {
  return pipeline(iterable, {
    tag: "map_sync",
    fn: fn as (item: unknown) => unknown,
  });
}

/** Keep and transform synchronously in one stage; Nothing drops it. */
export function filter_map<from, to>(
  iterable: AsyncIterableT<from>,
  fn: (item: from) => Maybe<to>,
): AsyncIterableT<to> {
  return pipeline(iterable, {
    tag: "filter_map",
    fn: fn as (item: unknown) => Maybe<unknown>,
  });
}

/** Accept finite chunks. Direct materialization awaits once per chunk. */
export function from_chunks<item>(
  factory: () => AsyncIterable<readonly item[]>,
): AsyncIterableT<Awaited<item>> {
  const source = async function* () {
    for await (const chunk of factory()) yield* chunk;
  };
  chunk_sources.set(source, factory);
  return AsyncIterableT(source);
}

async function close_pipeline_source(
  sync: Iterator<unknown> | undefined,
  async: AsyncIterator<unknown> | undefined,
  failed: boolean,
): Promise<void> {
  try {
    if (sync !== undefined) sync.return?.();
    else await async!.return?.();
  } catch (error) {
    if (!failed) throw error;
  }
}

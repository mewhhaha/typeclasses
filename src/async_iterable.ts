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

const PENDING = Symbol("AsyncIterableT.pending");
const async_pipeline = Symbol("AsyncIterableT.pipeline");
const async_array = Symbol("AsyncIterableT.array");
const async_sync = Symbol("AsyncIterableT.sync");
const async_chunks = Symbol("AsyncIterableT.chunks");
const async_stream = Symbol("AsyncIterableT.stream");
const async_concurrent = Symbol("AsyncIterableT.concurrent");

const MODE_ARRAY = 0;
const MODE_SOME = 1;
const MODE_FIND = 2;
const MODE_FOLD_WHILE = 3;

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
type PipelineMeta = {
  readonly ordered: readonly Stage[];
  readonly has_take: boolean;
  readonly has_zero_take: boolean;
};
type Pipeline = {
  readonly source: RawAsyncIterableT<unknown>;
  readonly stages: Stages;
  meta?: PipelineMeta;
};
type StreamSpec = {
  readonly stream: ReadableStream<unknown>;
  readonly prevent_cancel: boolean;
};
type ConcurrentPlan = {
  readonly ordered: boolean;
  readonly source: RawAsyncIterableT<unknown>;
  readonly concurrency: number;
  readonly fn: (
    item: unknown,
    index: number,
    signal: AbortSignal,
  ) => unknown;
  readonly signal: AbortSignal | undefined;
};
type TaggedAsyncFactory<item = unknown> = RawAsyncIterableT<item> & {
  [async_pipeline]?: Pipeline;
  [async_array]?: readonly unknown[];
  [async_sync]?: () => Iterable<unknown>;
  [async_chunks]?: () => AsyncIterable<readonly unknown[]>;
  [async_stream]?: StreamSpec;
  [async_concurrent]?: ConcurrentPlan;
};

function pipeline_of(
  factory: RawAsyncIterableT<unknown>,
): Pipeline | undefined {
  return (factory as TaggedAsyncFactory)[async_pipeline];
}
function array_of(
  factory: RawAsyncIterableT<unknown>,
): readonly unknown[] | undefined {
  return (factory as TaggedAsyncFactory)[async_array];
}
function sync_of(
  factory: RawAsyncIterableT<unknown>,
): (() => Iterable<unknown>) | undefined {
  return (factory as TaggedAsyncFactory)[async_sync];
}
function chunks_of(
  factory: RawAsyncIterableT<unknown>,
): (() => AsyncIterable<readonly unknown[]>) | undefined {
  return (factory as TaggedAsyncFactory)[async_chunks];
}
function stream_of(
  factory: RawAsyncIterableT<unknown>,
): StreamSpec | undefined {
  return (factory as TaggedAsyncFactory)[async_stream];
}
function concurrent_of(
  factory: RawAsyncIterableT<unknown>,
): ConcurrentPlan | undefined {
  return (factory as TaggedAsyncFactory)[async_concurrent];
}

function is_promise_like<item>(
  value: item | PromiseLike<item>,
): value is PromiseLike<item> {
  return value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<item>).then === "function";
}

function is_canonical_array(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) &&
    value[Symbol.iterator] === Array.prototype[Symbol.iterator];
}

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

  const factory: TaggedAsyncFactory<item> = () => ({
    [Symbol.asyncIterator](): AsyncIterator<item> {
      let index = 0;
      let done = false;
      return {
        next(): Promise<IteratorResult<item>> {
          if (done || index >= items.length) {
            done = true;
            return Promise.resolve({ done: true, value: undefined });
          }
          const value = items[index++];
          if (is_promise_like(value)) {
            return Promise.resolve(value).then((resolved) => ({
              done: false,
              value: resolved as item,
            }));
          }
          return Promise.resolve({ done: false, value });
        },
        return(): Promise<IteratorResult<item>> {
          done = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  });
  factory[async_array] = items;
  return AsyncIterableT(factory);
}

/** @ignore Internal adapter for ReadableStreamT without async generator overhead. */
export function from_readable_stream_source<item>(
  stream: ReadableStream<item>,
  prevent_cancel: boolean,
): AsyncIterableT<item> {
  const factory: TaggedAsyncFactory<item> = () => ({
    [Symbol.asyncIterator](): AsyncIterator<item> {
      let reader: ReadableStreamDefaultReader<item> | undefined;
      let done = false;
      let closed = false;
      const finish = async (): Promise<void> => {
        if (closed) return;
        closed = true;
        const active = reader;
        if (active === undefined) return;
        reader = undefined;
        try {
          if (!done && !prevent_cancel) await active.cancel();
        } finally {
          active.releaseLock();
        }
      };
      return {
        next(): Promise<IteratorResult<item>> {
          if (done || closed) {
            return Promise.resolve({ done: true, value: undefined });
          }
          if (reader === undefined) {
            try {
              reader = stream.getReader();
            } catch (error) {
              closed = true;
              return Promise.reject(error);
            }
          }
          return reader.read().then(
            (result) => {
              if (result.done === true) {
                done = true;
                if (!closed) {
                  closed = true;
                  const active = reader;
                  reader = undefined;
                  active?.releaseLock();
                }
                return result as IteratorResult<item>;
              }
              return result as IteratorResult<item>;
            },
            async (error) => {
              await finish();
              throw error;
            },
          );
        },
        async return(): Promise<IteratorResult<item>> {
          await finish();
          return { done: true, value: undefined };
        },
        async throw(error?: unknown): Promise<IteratorResult<item>> {
          await finish();
          throw error;
        },
      };
    },
  });
  factory[async_stream] = {
    stream: stream as ReadableStream<unknown>,
    prevent_cancel,
  };
  return AsyncIterableT(factory);
}

/** Asynchronously materialize a wrapped iterable into a mutable array. */
export function to_array<item>(
  iterable: AsyncIterableT<item>,
): Promise<item[]> {
  return to_array_bounded(iterable, Infinity);
}

/** Collect at most limit values and close upstream without reading ahead. */
export function preview<item>(
  iterable: AsyncIterableT<item>,
  limit = 100,
): Promise<item[]> {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("take count must be a nonnegative safe integer");
  }
  if (limit === 0) return Promise.resolve([]);
  return to_array_bounded(iterable, limit);
}

function to_array_bounded<item>(
  iterable: AsyncIterableT<item>,
  limit: number,
): Promise<item[]> {
  try {
    const factory = iterable.value() as RawAsyncIterableT<unknown>;
    const plan = pipeline_of(factory);
    if (plan !== undefined) {
      return drive_pipeline_to_array<item>(plan, limit);
    }
    const concurrent = concurrent_of(factory);
    if (concurrent !== undefined) {
      return drive_concurrent_to_array<item>(concurrent, limit);
    }
    const snap = array_of(factory);
    if (snap !== undefined) {
      const len = limit < snap.length ? limit : snap.length;
      const items = new Array<item>(len);
      for (let i = 0; i < len; i += 1) {
        const value = snap[i];
        if (is_promise_like(value)) {
          return finish_snap_to_array(snap, items, i, len, value);
        }
        items[i] = value as item;
      }
      return Promise.resolve(items);
    }
    const chunks = chunks_of(factory);
    if (chunks !== undefined) {
      return drive_chunks_to_array<item>(chunks, limit);
    }
    const synchronous = sync_of(factory);
    if (synchronous !== undefined) {
      const iter = synchronous();
      if (is_canonical_array(iter)) {
        return Promise.resolve(
          (limit < iter.length ? iter.slice(0, limit) : iter.slice()) as item[],
        );
      }
      const items: item[] = [];
      const sync = iter[Symbol.iterator]();
      let ended = false;
      let failed = false;
      try {
        while (true) {
          const next = sync.next();
          if (next.done) {
            ended = true;
            break;
          }
          items.push(next.value as item);
          if (items.length >= limit) break;
        }
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        if (!ended) close_sync_iterator(sync, failed);
      }
      return Promise.resolve(items);
    }
    const stream = stream_of(factory);
    if (stream !== undefined) {
      return drive_stream_to_array<item>(stream, limit);
    }
    return drive_generic_to_array<item>(
      factory as RawAsyncIterableT<item>,
      limit,
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

async function finish_snap_to_array<item>(
  snap: readonly unknown[],
  items: item[],
  index: number,
  len: number,
  first_pending: PromiseLike<unknown>,
): Promise<item[]> {
  items[index] = (await first_pending) as item;
  for (let i = index + 1; i < len; i += 1) {
    const value = snap[i];
    items[i] = (is_promise_like(value) ? await value : value) as item;
  }
  return items;
}

async function drive_chunks_to_array<item>(
  chunks: () => AsyncIterable<readonly unknown[]>,
  limit: number,
): Promise<item[]> {
  const items: item[] = [];
  const chunk_iter = chunks()[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await chunk_iter.next();
      if (next.done) {
        ended = true;
        return items;
      }
      const chunk = next.value;
      for (let i = 0; i < chunk.length; i += 1) {
        const value = chunk[i];
        items.push((is_promise_like(value) ? await value : value) as item);
        if (items.length >= limit) return items;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, chunk_iter, failed);
  }
}

async function drive_stream_to_array<item>(
  spec: StreamSpec,
  limit: number,
): Promise<item[]> {
  const items: item[] = [];
  const reader = spec.stream.getReader();
  const prevent_cancel = spec.prevent_cancel;
  let done = false;
  let failed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done === true) {
        done = true;
        return items;
      }
      items.push(next.value as item);
      if (items.length >= limit) return items;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await close_stream_reader(reader, done, prevent_cancel, failed);
  }
}

async function drive_generic_to_array<item>(
  factory: RawAsyncIterableT<item>,
  limit: number,
): Promise<item[]> {
  const items: item[] = [];
  for await (const item of factory()) {
    items.push(item);
    if (items.length >= limit) break;
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

/** Explicit finite snapshot; consumes the source immediately. */
export const from_snapshot = from_async_iterable;

// --- Concurrent source opening & cleanup helpers ---

type OpenedSource = {
  // 0 = sync array, 1 = snap array, 2 = sync iter, 3 = chunks, 4 = stream, 5 = async iter
  readonly kind: number;
  arr?: readonly unknown[];
  idx: number;
  sync_iter?: Iterator<unknown>;
  chunk_iter?: AsyncIterator<readonly unknown[]>;
  stream_reader?: ReadableStreamDefaultReader<unknown>;
  prevent_cancel: boolean;
  async_iter?: AsyncIterator<unknown>;
};

function open_concurrent_source(
  source: RawAsyncIterableT<unknown>,
): OpenedSource {
  const snap = array_of(source);
  if (snap !== undefined) {
    return { kind: 1, arr: snap, idx: 0, prevent_cancel: false };
  }
  const chunks = chunks_of(source);
  if (chunks !== undefined) {
    return {
      kind: 3,
      arr: undefined,
      idx: 0,
      chunk_iter: chunks()[Symbol.asyncIterator](),
      prevent_cancel: false,
    };
  }
  const synchronous = sync_of(source);
  if (synchronous !== undefined) {
    const iter = synchronous();
    if (is_canonical_array(iter)) {
      return { kind: 0, arr: iter, idx: 0, prevent_cancel: false };
    }
    return {
      kind: 2,
      idx: 0,
      sync_iter: iter[Symbol.iterator](),
      prevent_cancel: false,
    };
  }
  const stream = stream_of(source);
  if (stream !== undefined) {
    return {
      kind: 4,
      idx: 0,
      stream_reader: stream.stream.getReader(),
      prevent_cancel: stream.prevent_cancel,
    };
  }
  return {
    kind: 5,
    idx: 0,
    async_iter: source()[Symbol.asyncIterator](),
    prevent_cancel: false,
  };
}

async function close_concurrent_resource(
  opened: OpenedSource | undefined,
  primary_failure: { readonly error: unknown } | undefined,
): Promise<void> {
  if (opened === undefined) return;
  try {
    switch (opened.kind) {
      case 0:
      case 1:
        return;
      case 2:
        opened.sync_iter?.return?.();
        return;
      case 3:
        await opened.chunk_iter?.return?.();
        return;
      case 4: {
        const reader = opened.stream_reader;
        if (reader === undefined) return;
        opened.stream_reader = undefined;
        try {
          if (!opened.prevent_cancel) await reader.cancel();
        } finally {
          reader.releaseLock();
        }
        return;
      }
      case 5:
        await opened.async_iter?.return?.();
        return;
    }
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
  const plan: ConcurrentPlan = {
    ordered: true,
    source: iterable.value() as RawAsyncIterableT<unknown>,
    concurrency,
    fn: fn as (item: unknown, index: number, signal: AbortSignal) => unknown,
    signal: options.signal,
  };
  const factory: TaggedAsyncFactory<to> = async function* () {
    const external = plan.signal;
    if (external?.aborted) throw external.reason;
    const controller = new AbortController();
    const signal = controller.signal;
    let aborted = false;
    let abort_reason: unknown;
    let wake_resolve: (() => void) | undefined;
    let wake_reject: ((reason: unknown) => void) | undefined;
    const trigger_abort = (reason: unknown) => {
      if (!aborted) {
        aborted = true;
        abort_reason = reason;
        controller.abort(reason);
        const rej = wake_reject;
        if (rej !== undefined) {
          wake_resolve = undefined;
          wake_reject = undefined;
          rej(reason);
        }
      }
    };
    const on_external_abort = () => trigger_abort(external!.reason);
    if (external !== undefined) {
      external.addEventListener("abort", on_external_abort, { once: true });
      if (external.aborted) trigger_abort(external.reason);
    }

    const slots = new Array<unknown>(concurrency).fill(PENDING);
    let head = 0;
    let count = 0;
    let in_flight = 0;
    let index = 0;
    let ended = false;
    let opened: OpenedSource | undefined;
    let has_failure = false;
    let fail_error: unknown;
    let primary_failure: { readonly error: unknown } | undefined;

    const on_fail = (error: unknown) => {
      in_flight -= 1;
      if (!has_failure) {
        has_failure = true;
        fail_error = error;
        trigger_abort(error);
      }
    };

    const race_async = <T>(promise: PromiseLike<T>): Promise<T> => {
      if (external === undefined && in_flight === 0) {
        return promise instanceof Promise ? promise : Promise.resolve(promise);
      }
      return new Promise<T>((resolve, reject) => {
        if (aborted) {
          Promise.resolve(promise).then(noop, noop);
          reject(abort_reason);
          return;
        }
        wake_reject = reject;
        const on_res = (v: T) => {
          if (wake_reject === reject) wake_reject = undefined;
          resolve(v);
        };
        const on_err = (e: unknown) => {
          if (wake_reject === reject) wake_reject = undefined;
          reject(e);
        };
        if (promise instanceof Promise) promise.then(on_res, on_err);
        else Promise.resolve(promise).then(on_res, on_err);
      });
    };

    try {
      if (aborted) throw abort_reason;
      opened = open_concurrent_source(plan.source);
      const src_kind = opened.kind;
      while (true) {
        while (
          !ended && count < concurrency && !has_failure && !aborted
        ) {
          let value: unknown;
          if (src_kind === 0) {
            const arr = opened.arr!;
            if (opened.idx >= arr.length) {
              ended = true;
              break;
            }
            value = arr[opened.idx++];
          } else if (src_kind === 1) {
            const arr = opened.arr!;
            if (opened.idx >= arr.length) {
              ended = true;
              break;
            }
            const raw_item = arr[opened.idx++];
            value = is_promise_like(raw_item)
              ? await race_async(raw_item)
              : raw_item;
          } else if (src_kind === 2) {
            const next = opened.sync_iter!.next();
            if (next.done) {
              ended = true;
              break;
            }
            value = next.value;
          } else if (src_kind === 3) {
            let chunk = opened.arr;
            while (chunk === undefined || opened.idx >= chunk.length) {
              const next = await race_async(opened.chunk_iter!.next());
              if (aborted) throw abort_reason;
              if (next.done) {
                ended = true;
                break;
              }
              chunk = next.value;
              opened.arr = chunk;
              opened.idx = 0;
            }
            if (ended) break;
            const raw_item = chunk![opened.idx++];
            value = is_promise_like(raw_item)
              ? await race_async(raw_item)
              : raw_item;
          } else if (src_kind === 4) {
            const next = await race_async(opened.stream_reader!.read());
            if (aborted) throw abort_reason;
            if (next.done === true) {
              ended = true;
              const r = opened.stream_reader;
              opened.stream_reader = undefined;
              r?.releaseLock();
              break;
            }
            value = next.value;
          } else {
            const next = await race_async(opened.async_iter!.next());
            if (aborted) throw abort_reason;
            if (next.done) {
              ended = true;
              break;
            }
            value = next.value;
          }
          if (has_failure) break;
          if (aborted) throw abort_reason;
          const pos = (head + count) % concurrency;
          count += 1;
          const task_index = index++;
          try {
            const raw = plan.fn(value, task_index, signal);
            if (is_promise_like(raw)) {
              slots[pos] = PENDING;
              in_flight += 1;
              const on_ok = (res: unknown) => {
                in_flight -= 1;
                if (aborted) return;
                slots[pos] = res;
                if (pos === head && wake_resolve !== undefined) {
                  const r = wake_resolve;
                  wake_resolve = undefined;
                  wake_reject = undefined;
                  r();
                }
              };
              if (raw instanceof Promise) raw.then(on_ok, on_fail);
              else Promise.resolve(raw).then(on_ok, on_fail);
            } else {
              slots[pos] = raw;
            }
          } catch (error) {
            if (!has_failure) {
              has_failure = true;
              fail_error = error;
              trigger_abort(error);
            }
            break;
          }
        }
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;
        if (count === 0) return;
        let out_val = slots[head];
        if (out_val === PENDING) {
          await new Promise<void>((resolve, reject) => {
            if (aborted) {
              reject(abort_reason);
              return;
            }
            wake_resolve = resolve;
            wake_reject = reject;
          });
          if (has_failure) throw fail_error;
          if (aborted) throw abort_reason;
          out_val = slots[head];
        }
        slots[head] = PENDING;
        head = (head + 1) % concurrency;
        count -= 1;
        if (aborted) throw abort_reason;
        yield out_val as to;
      }
    } catch (error) {
      primary_failure = { error };
      throw error;
    } finally {
      aborted = true;
      controller.abort();
      if (external !== undefined) {
        external.removeEventListener("abort", on_external_abort);
      }
      if (!ended) await close_concurrent_resource(opened, primary_failure);
    }
  };
  factory[async_concurrent] = plan;
  return AsyncIterableT(factory);
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
  const plan: ConcurrentPlan = {
    ordered: false,
    source: iterable.value() as RawAsyncIterableT<unknown>,
    concurrency,
    fn: fn as (item: unknown, index: number, signal: AbortSignal) => unknown,
    signal: options.signal,
  };
  const factory: TaggedAsyncFactory<to> = async function* () {
    const external = plan.signal;
    if (external?.aborted) throw external.reason;
    const controller = new AbortController();
    const signal = controller.signal;
    let aborted = false;
    let abort_reason: unknown;
    let wake_resolve: (() => void) | undefined;
    let wake_reject: ((reason: unknown) => void) | undefined;
    const trigger_abort = (reason: unknown) => {
      if (!aborted) {
        aborted = true;
        abort_reason = reason;
        controller.abort(reason);
        const rej = wake_reject;
        if (rej !== undefined) {
          wake_resolve = undefined;
          wake_reject = undefined;
          rej(reason);
        }
      }
    };
    const on_external_abort = () => trigger_abort(external!.reason);
    if (external !== undefined) {
      external.addEventListener("abort", on_external_abort, { once: true });
      if (external.aborted) trigger_abort(external.reason);
    }

    const ready = new Array<unknown>(concurrency);
    let ready_head = 0;
    let ready_count = 0;
    let admitted = 0;
    let index = 0;
    let ended = false;
    let reading = false;
    let read: IteratorResult<unknown> | undefined;
    let read_chunk: IteratorResult<readonly unknown[]> | undefined;
    let opened: OpenedSource | undefined;
    let has_failure = false;
    let fail_error: unknown;
    let primary_failure: { readonly error: unknown } | undefined;

    const wake_now = () => {
      const r = wake_resolve;
      if (r !== undefined) {
        wake_resolve = undefined;
        wake_reject = undefined;
        r();
      }
    };
    const on_fail = (error: unknown) => {
      if (!has_failure) {
        has_failure = true;
        fail_error = error;
        trigger_abort(error);
      }
    };
    const on_value = (value: unknown) => {
      if (aborted) return;
      ready[(ready_head + ready_count) % concurrency] = value;
      ready_count += 1;
      wake_now();
    };
    const on_read = (next: IteratorResult<unknown>) => {
      reading = false;
      if (aborted) return;
      read = next;
      wake_now();
    };
    const on_chunk = (next: IteratorResult<readonly unknown[]>) => {
      reading = false;
      if (aborted) return;
      read_chunk = next;
      wake_now();
    };
    const on_item_resolved = (resolved: unknown) => {
      if (aborted) return;
      const id = index++;
      try {
        const raw = plan.fn(resolved, id, signal);
        if (is_promise_like(raw)) {
          if (raw instanceof Promise) raw.then(on_value, on_fail);
          else Promise.resolve(raw).then(on_value, on_fail);
        } else {
          ready[(ready_head + ready_count) % concurrency] = raw;
          ready_count += 1;
          wake_now();
        }
      } catch (error) {
        on_fail(error);
      }
    };

    const admit_value = (val: unknown) => {
      const id = index++;
      admitted += 1;
      try {
        if (aborted) throw abort_reason;
        const raw = plan.fn(val, id, signal);
        if (is_promise_like(raw)) {
          if (raw instanceof Promise) raw.then(on_value, on_fail);
          else Promise.resolve(raw).then(on_value, on_fail);
        } else {
          ready[(ready_head + ready_count) % concurrency] = raw;
          ready_count += 1;
        }
      } catch (error) {
        on_fail(error);
      }
    };

    try {
      if (aborted) throw abort_reason;
      opened = open_concurrent_source(plan.source);
      const src_kind = opened.kind;
      while (true) {
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;

        if (src_kind === 0) {
          const arr = opened.arr!;
          while (
            !ended && admitted < concurrency && !has_failure &&
            !aborted
          ) {
            if (opened.idx >= arr.length) {
              ended = true;
              break;
            }
            admit_value(arr[opened.idx++]);
          }
          if (has_failure) throw fail_error;
          if (aborted) throw abort_reason;
        } else if (src_kind === 1) {
          const arr = opened.arr!;
          while (
            !ended && admitted < concurrency && !has_failure &&
            !aborted
          ) {
            if (opened.idx >= arr.length) {
              ended = true;
              break;
            }
            const raw_item = arr[opened.idx++];
            if (is_promise_like(raw_item)) {
              admitted += 1;
              if (raw_item instanceof Promise) {
                raw_item.then(on_item_resolved, on_fail);
              } else {
                Promise.resolve(raw_item).then(on_item_resolved, on_fail);
              }
            } else {
              admit_value(raw_item);
            }
          }
          if (has_failure) throw fail_error;
          if (aborted) throw abort_reason;
        } else if (src_kind === 2) {
          const sync_iter = opened.sync_iter!;
          while (
            !ended && admitted < concurrency && !has_failure &&
            !aborted
          ) {
            const next = sync_iter.next();
            if (next.done) {
              ended = true;
              break;
            }
            admit_value(next.value);
          }
          if (has_failure) throw fail_error;
          if (aborted) throw abort_reason;
        } else if (src_kind === 3) {
          if (read_chunk !== undefined) {
            const next = read_chunk;
            read_chunk = undefined;
            if (next.done) ended = true;
            else {
              opened.arr = next.value;
              opened.idx = 0;
            }
          }
          while (
            !ended && admitted < concurrency && !has_failure &&
            !aborted && opened.arr !== undefined &&
            opened.idx < opened.arr.length
          ) {
            const raw_item = opened.arr[opened.idx++];
            if (is_promise_like(raw_item)) {
              admitted += 1;
              if (raw_item instanceof Promise) {
                raw_item.then(on_item_resolved, on_fail);
              } else {
                Promise.resolve(raw_item).then(on_item_resolved, on_fail);
              }
            } else {
              admit_value(raw_item);
            }
          }
          if (has_failure) throw fail_error;
          if (aborted) throw abort_reason;
          if (
            !ended && admitted < concurrency && !reading &&
            (opened.arr === undefined || opened.idx >= opened.arr.length)
          ) {
            reading = true;
            try {
              const p = opened.chunk_iter!.next();
              if (p instanceof Promise) p.then(on_chunk, on_fail);
              else Promise.resolve(p).then(on_chunk, on_fail);
            } catch (error) {
              reading = false;
              on_fail(error);
              throw fail_error;
            }
          }
        } else {
          if (read !== undefined) {
            const next = read;
            read = undefined;
            if (next.done) {
              ended = true;
              if (src_kind === 4) {
                const r = opened.stream_reader;
                opened.stream_reader = undefined;
                r?.releaseLock();
              }
            } else {
              admit_value(next.value);
            }
            continue;
          }
          // A pending upstream read never blocks an already completed callback.
          if (!ended && admitted < concurrency && !reading) {
            reading = true;
            try {
              const p = src_kind === 4
                ? opened.stream_reader!.read() as Promise<
                  IteratorResult<unknown>
                >
                : opened.async_iter!.next();
              if (p instanceof Promise) p.then(on_read, on_fail);
              else Promise.resolve(p).then(on_read, on_fail);
            } catch (error) {
              reading = false;
              on_fail(error);
              throw fail_error;
            }
          }
        }

        if (ready_count > 0) {
          admitted -= 1;
          const value = ready[ready_head];
          ready[ready_head] = undefined;
          ready_head = (ready_head + 1) % concurrency;
          ready_count -= 1;
          yield value as to;
          continue;
        }
        if (ended && admitted === 0) return;
        await new Promise<void>((resolve, reject) => {
          if (aborted) {
            reject(abort_reason);
            return;
          }
          wake_resolve = resolve;
          wake_reject = reject;
        });
      }
    } catch (error) {
      primary_failure = { error };
      throw error;
    } finally {
      aborted = true;
      controller.abort();
      if (external !== undefined) {
        external.removeEventListener("abort", on_external_abort);
      }
      if (!ended) await close_concurrent_resource(opened, primary_failure);
    }
  };
  factory[async_concurrent] = plan;
  return AsyncIterableT(factory);
}

// --- Direct push concurrent drivers (bypass async function* for terminals) ---

function drive_concurrent_to_array<item>(
  plan: ConcurrentPlan,
  limit: number,
): Promise<item[]> {
  const external = plan.signal;
  if (external?.aborted) return Promise.reject(external.reason);
  if (limit === 0) return Promise.resolve([]);
  const synchronous = sync_of(plan.source);
  if (
    synchronous !== undefined && limit === Infinity && external === undefined
  ) {
    const iter = synchronous();
    if (is_canonical_array(iter)) {
      const controller = new AbortController();
      const signal = controller.signal;
      const fn = plan.fn;
      const out: item[] = [];
      for (let i = 0; i < iter.length; i += 1) {
        let raw: unknown;
        try {
          raw = fn(iter[i], i, signal);
        } catch (error) {
          controller.abort(error);
          return Promise.reject(error);
        }
        if (is_promise_like(raw)) {
          return finish_concurrent_sync_array<item>(
            iter,
            i,
            raw,
            out,
            plan,
            controller,
          );
        }
        out.push(raw as item);
      }
      controller.abort();
      return Promise.resolve(out);
    }
  }
  return plan.ordered
    ? drive_concurrent_ordered_push<item, item[]>(
      plan,
      MODE_ARRAY,
      undefined,
      limit,
      [],
    )
    : drive_concurrent_unordered_push<item, item[]>(
      plan,
      MODE_ARRAY,
      undefined,
      limit,
      [],
    );
}

async function finish_concurrent_sync_array<item>(
  arr: readonly unknown[],
  start_index: number,
  first_pending: PromiseLike<unknown>,
  out: item[],
  plan: ConcurrentPlan,
  controller: AbortController,
): Promise<item[]> {
  const concurrency = plan.concurrency;
  const fn = plan.fn;
  const signal = controller.signal;
  let aborted = false;
  let abort_reason: unknown;
  let wake_resolve: (() => void) | undefined;
  let wake_reject: ((reason: unknown) => void) | undefined;
  let has_failure = false;
  let fail_error: unknown;

  const trigger_abort = (reason: unknown) => {
    if (!aborted) {
      aborted = true;
      abort_reason = reason;
      controller.abort(reason);
      const rej = wake_reject;
      if (rej !== undefined) {
        wake_resolve = undefined;
        wake_reject = undefined;
        rej(reason);
      }
    }
  };
  const wake_now = () => {
    const r = wake_resolve;
    if (r !== undefined) {
      wake_resolve = undefined;
      wake_reject = undefined;
      r();
    }
  };

  try {
    if (plan.ordered) {
      const slots = new Array<unknown>(concurrency).fill(PENDING);
      let head = 0;
      let count = 1;
      let idx = start_index + 1;
      const on_fail = (error: unknown) => {
        if (!has_failure) {
          has_failure = true;
          fail_error = error;
          trigger_abort(error);
        }
      };
      const on_first_ok = (res: unknown) => {
        if (aborted) return;
        slots[0] = res;
        if (head === 0) wake_now();
      };
      if (first_pending instanceof Promise) {
        first_pending.then(on_first_ok, on_fail);
      } else {
        Promise.resolve(first_pending).then(on_first_ok, on_fail);
      }

      while (true) {
        while (
          count < concurrency && idx < arr.length && !has_failure
        ) {
          const pos = (head + count) % concurrency;
          count += 1;
          const task_index = idx++;
          try {
            const raw = fn(arr[task_index], task_index, signal);
            if (is_promise_like(raw)) {
              slots[pos] = PENDING;
              const on_ok = (res: unknown) => {
                if (aborted) return;
                slots[pos] = res;
                if (pos === head) wake_now();
              };
              if (raw instanceof Promise) raw.then(on_ok, on_fail);
              else Promise.resolve(raw).then(on_ok, on_fail);
            } else {
              slots[pos] = raw;
            }
          } catch (error) {
            on_fail(error);
            break;
          }
        }
        if (has_failure) throw fail_error;
        if (count === 0) return out;
        let val = slots[head];
        if (val === PENDING) {
          await new Promise<void>((resolve, reject) => {
            if (aborted) {
              reject(abort_reason);
              return;
            }
            wake_resolve = resolve;
            wake_reject = reject;
          });
          if (has_failure) throw fail_error;
          val = slots[head];
        }
        slots[head] = PENDING;
        head = (head + 1) % concurrency;
        count -= 1;
        out.push(val as item);
      }
    } else {
      const ready = new Array<unknown>(concurrency);
      let ready_head = 0;
      let ready_count = 0;
      let admitted = 1;
      let idx = start_index + 1;
      const on_fail = (error: unknown) => {
        if (!has_failure) {
          has_failure = true;
          fail_error = error;
          trigger_abort(error);
        }
      };
      const on_value = (value: unknown) => {
        if (aborted) return;
        ready[(ready_head + ready_count) % concurrency] = value;
        ready_count += 1;
        wake_now();
      };
      if (first_pending instanceof Promise) {
        first_pending.then(on_value, on_fail);
      } else {
        Promise.resolve(first_pending).then(on_value, on_fail);
      }

      while (true) {
        while (
          admitted < concurrency && idx < arr.length && !has_failure
        ) {
          const task_index = idx++;
          admitted += 1;
          try {
            const raw = fn(arr[task_index], task_index, signal);
            if (is_promise_like(raw)) {
              if (raw instanceof Promise) raw.then(on_value, on_fail);
              else Promise.resolve(raw).then(on_value, on_fail);
            } else {
              ready[(ready_head + ready_count) % concurrency] = raw;
              ready_count += 1;
            }
          } catch (error) {
            on_fail(error);
            break;
          }
        }
        if (has_failure) throw fail_error;
        if (ready_count > 0) {
          while (ready_count > 0) {
            admitted -= 1;
            out.push(ready[ready_head] as item);
            ready[ready_head] = undefined;
            ready_head = (ready_head + 1) % concurrency;
            ready_count -= 1;
          }
          continue;
        }
        if (idx >= arr.length && admitted === 0) return out;
        await new Promise<void>((resolve, reject) => {
          if (aborted) {
            reject(abort_reason);
            return;
          }
          wake_resolve = resolve;
          wake_reject = reject;
        });
      }
    }
  } finally {
    aborted = true;
    controller.abort();
  }
}

async function drive_concurrent_ordered_push<item, result>(
  plan: ConcurrentPlan,
  mode: number,
  terminal_fn: unknown,
  limit_or_initial: unknown,
  out?: item[],
): Promise<result> {
  const external = plan.signal;
  if (external?.aborted) throw external.reason;
  const concurrency = plan.concurrency;
  const controller = new AbortController();
  const signal = controller.signal;
  let aborted = false;
  let abort_reason: unknown;
  let wake_resolve: (() => void) | undefined;
  let wake_reject: ((reason: unknown) => void) | undefined;
  const trigger_abort = (reason: unknown) => {
    if (!aborted) {
      aborted = true;
      abort_reason = reason;
      controller.abort(reason);
      const rej = wake_reject;
      if (rej !== undefined) {
        wake_resolve = undefined;
        wake_reject = undefined;
        rej(reason);
      }
    }
  };
  const on_external_abort = () => trigger_abort(external!.reason);
  if (external !== undefined) {
    external.addEventListener("abort", on_external_abort, { once: true });
    if (external.aborted) trigger_abort(external.reason);
  }

  const slots = new Array<unknown>(concurrency).fill(PENDING);
  let head = 0;
  let count = 0;
  let in_flight = 0;
  let index = 0;
  let ended = false;
  let opened: OpenedSource | undefined;
  let has_failure = false;
  let fail_error: unknown;
  let primary_failure: { readonly error: unknown } | undefined;
  const limit = mode === MODE_ARRAY ? (limit_or_initial as number) : Infinity;
  let fold_state = mode === MODE_FOLD_WHILE ? limit_or_initial : undefined;

  const on_fail = (error: unknown) => {
    in_flight -= 1;
    if (!has_failure) {
      has_failure = true;
      fail_error = error;
      trigger_abort(error);
    }
  };

  const race_async = <T>(promise: PromiseLike<T>): Promise<T> => {
    if (external === undefined && in_flight === 0) {
      return promise instanceof Promise ? promise : Promise.resolve(promise);
    }
    return new Promise<T>((resolve, reject) => {
      if (aborted) {
        Promise.resolve(promise).then(noop, noop);
        reject(abort_reason);
        return;
      }
      wake_reject = reject;
      const on_res = (v: T) => {
        if (wake_reject === reject) wake_reject = undefined;
        resolve(v);
      };
      const on_err = (e: unknown) => {
        if (wake_reject === reject) wake_reject = undefined;
        reject(e);
      };
      if (promise instanceof Promise) promise.then(on_res, on_err);
      else Promise.resolve(promise).then(on_res, on_err);
    });
  };

  try {
    if (aborted) throw abort_reason;
    opened = open_concurrent_source(plan.source);
    const src_kind = opened.kind;
    while (true) {
      while (
        !ended && count < concurrency && !has_failure && !aborted
      ) {
        let value: unknown;
        if (src_kind === 0) {
          const arr = opened.arr!;
          if (opened.idx >= arr.length) {
            ended = true;
            break;
          }
          value = arr[opened.idx++];
        } else if (src_kind === 1) {
          const arr = opened.arr!;
          if (opened.idx >= arr.length) {
            ended = true;
            break;
          }
          const raw_item = arr[opened.idx++];
          value = is_promise_like(raw_item)
            ? await race_async(raw_item)
            : raw_item;
        } else if (src_kind === 2) {
          const next = opened.sync_iter!.next();
          if (next.done) {
            ended = true;
            break;
          }
          value = next.value;
        } else if (src_kind === 3) {
          let chunk = opened.arr;
          while (chunk === undefined || opened.idx >= chunk.length) {
            const next = await race_async(opened.chunk_iter!.next());
            if (aborted) throw abort_reason;
            if (next.done) {
              ended = true;
              break;
            }
            chunk = next.value;
            opened.arr = chunk;
            opened.idx = 0;
          }
          if (ended) break;
          const raw_item = chunk![opened.idx++];
          value = is_promise_like(raw_item)
            ? await race_async(raw_item)
            : raw_item;
        } else if (src_kind === 4) {
          const next = await race_async(opened.stream_reader!.read());
          if (aborted) throw abort_reason;
          if (next.done === true) {
            ended = true;
            const r = opened.stream_reader;
            opened.stream_reader = undefined;
            r?.releaseLock();
            break;
          }
          value = next.value;
        } else {
          const next = await race_async(opened.async_iter!.next());
          if (aborted) throw abort_reason;
          if (next.done) {
            ended = true;
            break;
          }
          value = next.value;
        }
        if (has_failure) break;
        if (aborted) throw abort_reason;
        const task_index = index++;
        let raw: unknown;
        try {
          raw = plan.fn(value, task_index, signal);
        } catch (error) {
          if (!has_failure) {
            has_failure = true;
            fail_error = error;
            trigger_abort(error);
          }
          break;
        }
        if (is_promise_like(raw)) {
          const pos = (head + count) % concurrency;
          count += 1;
          slots[pos] = PENDING;
          in_flight += 1;
          const on_ok = (res: unknown) => {
            in_flight -= 1;
            if (aborted) return;
            slots[pos] = res;
            if (pos === head && wake_resolve !== undefined) {
              const r = wake_resolve;
              wake_resolve = undefined;
              wake_reject = undefined;
              r();
            }
          };
          if (raw instanceof Promise) raw.then(on_ok, on_fail);
          else Promise.resolve(raw).then(on_ok, on_fail);
        } else if (
          mode === MODE_ARRAY && limit === Infinity && count === 0 &&
          in_flight === 0 && !aborted
        ) {
          out!.push(raw as item);
        } else {
          const pos = (head + count) % concurrency;
          count += 1;
          slots[pos] = raw;
        }
      }
      if (has_failure) throw fail_error;
      if (aborted) throw abort_reason;
      if (count === 0) {
        if (mode === MODE_ARRAY) return out as unknown as result;
        if (mode === MODE_SOME) return false as unknown as result;
        if (mode === MODE_FIND) return Nothing<item>() as unknown as result;
        return fold_state as result;
      }
      let out_val = slots[head];
      if (out_val === PENDING) {
        await new Promise<void>((resolve, reject) => {
          if (aborted) {
            reject(abort_reason);
            return;
          }
          wake_resolve = resolve;
          wake_reject = reject;
        });
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;
        out_val = slots[head];
      }
      slots[head] = PENDING;
      head = (head + 1) % concurrency;
      count -= 1;
      if (aborted) throw abort_reason;
      if (mode === MODE_ARRAY) {
        out!.push(out_val as item);
        if (out!.length >= limit) return out as unknown as result;
      } else if (mode === MODE_SOME) {
        const m = (terminal_fn as (v: item) => boolean | PromiseLike<boolean>)(
          out_val as item,
        );
        if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
          return true as unknown as result;
        }
      } else if (mode === MODE_FIND) {
        const m = (terminal_fn as (v: item) => boolean | PromiseLike<boolean>)(
          out_val as item,
        );
        if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
          return Just(out_val as item) as unknown as result;
        }
      } else {
        const raw_step = (
          terminal_fn as (
            s: unknown,
            v: item,
          ) => FoldStep<unknown> | PromiseLike<FoldStep<unknown>>
        )(fold_state, out_val as item);
        const step = is_promise_like(raw_step) ? await raw_step : raw_step;
        fold_state = step[1];
        if (step[0] === "Done") return fold_state as result;
      }
    }
  } catch (error) {
    primary_failure = { error };
    throw error;
  } finally {
    aborted = true;
    controller.abort();
    if (external !== undefined) {
      external.removeEventListener("abort", on_external_abort);
    }
    if (!ended) await close_concurrent_resource(opened, primary_failure);
  }
}

async function drive_concurrent_unordered_push<item, result>(
  plan: ConcurrentPlan,
  mode: number,
  terminal_fn: unknown,
  limit_or_initial: unknown,
  out?: item[],
): Promise<result> {
  const external = plan.signal;
  if (external?.aborted) throw external.reason;
  const concurrency = plan.concurrency;
  const controller = new AbortController();
  const signal = controller.signal;
  let aborted = false;
  let abort_reason: unknown;
  let wake_resolve: (() => void) | undefined;
  let wake_reject: ((reason: unknown) => void) | undefined;
  const trigger_abort = (reason: unknown) => {
    if (!aborted) {
      aborted = true;
      abort_reason = reason;
      controller.abort(reason);
      const rej = wake_reject;
      if (rej !== undefined) {
        wake_resolve = undefined;
        wake_reject = undefined;
        rej(reason);
      }
    }
  };
  const on_external_abort = () => trigger_abort(external!.reason);
  if (external !== undefined) {
    external.addEventListener("abort", on_external_abort, { once: true });
    if (external.aborted) trigger_abort(external.reason);
  }

  const ready = new Array<unknown>(concurrency);
  let ready_head = 0;
  let ready_count = 0;
  let admitted = 0;
  let index = 0;
  let ended = false;
  let reading = false;
  let read: IteratorResult<unknown> | undefined;
  let read_chunk: IteratorResult<readonly unknown[]> | undefined;
  let opened: OpenedSource | undefined;
  let has_failure = false;
  let fail_error: unknown;
  let primary_failure: { readonly error: unknown } | undefined;
  const limit = mode === MODE_ARRAY ? (limit_or_initial as number) : Infinity;
  let fold_state = mode === MODE_FOLD_WHILE ? limit_or_initial : undefined;

  const wake_now = () => {
    const r = wake_resolve;
    if (r !== undefined) {
      wake_resolve = undefined;
      wake_reject = undefined;
      r();
    }
  };
  const on_fail = (error: unknown) => {
    if (!has_failure) {
      has_failure = true;
      fail_error = error;
      trigger_abort(error);
    }
  };
  const on_value = (value: unknown) => {
    if (aborted) return;
    ready[(ready_head + ready_count) % concurrency] = value;
    ready_count += 1;
    wake_now();
  };
  const on_read = (next: IteratorResult<unknown>) => {
    reading = false;
    if (aborted) return;
    read = next;
    wake_now();
  };
  const on_chunk = (next: IteratorResult<readonly unknown[]>) => {
    reading = false;
    if (aborted) return;
    read_chunk = next;
    wake_now();
  };
  const on_item_resolved = (resolved: unknown) => {
    if (aborted) return;
    const id = index++;
    try {
      const raw = plan.fn(resolved, id, signal);
      if (is_promise_like(raw)) {
        if (raw instanceof Promise) raw.then(on_value, on_fail);
        else Promise.resolve(raw).then(on_value, on_fail);
      } else {
        ready[(ready_head + ready_count) % concurrency] = raw;
        ready_count += 1;
        wake_now();
      }
    } catch (error) {
      on_fail(error);
    }
  };
  const admit_value = (val: unknown) => {
    const id = index++;
    admitted += 1;
    try {
      if (aborted) throw abort_reason;
      const raw = plan.fn(val, id, signal);
      if (is_promise_like(raw)) {
        if (raw instanceof Promise) raw.then(on_value, on_fail);
        else Promise.resolve(raw).then(on_value, on_fail);
      } else {
        ready[(ready_head + ready_count) % concurrency] = raw;
        ready_count += 1;
      }
    } catch (error) {
      on_fail(error);
    }
  };

  try {
    if (aborted) throw abort_reason;
    opened = open_concurrent_source(plan.source);
    const src_kind = opened.kind;
    while (true) {
      if (has_failure) throw fail_error;
      if (aborted) throw abort_reason;

      if (src_kind === 0) {
        const arr = opened.arr!;
        while (
          !ended && admitted < concurrency && !has_failure && !aborted
        ) {
          if (opened.idx >= arr.length) {
            ended = true;
            break;
          }
          admit_value(arr[opened.idx++]);
        }
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;
      } else if (src_kind === 1) {
        const arr = opened.arr!;
        while (
          !ended && admitted < concurrency && !has_failure && !aborted
        ) {
          if (opened.idx >= arr.length) {
            ended = true;
            break;
          }
          const raw_item = arr[opened.idx++];
          if (is_promise_like(raw_item)) {
            admitted += 1;
            if (raw_item instanceof Promise) {
              raw_item.then(on_item_resolved, on_fail);
            } else {
              Promise.resolve(raw_item).then(on_item_resolved, on_fail);
            }
          } else {
            admit_value(raw_item);
          }
        }
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;
      } else if (src_kind === 2) {
        const sync_iter = opened.sync_iter!;
        while (
          !ended && admitted < concurrency && !has_failure && !aborted
        ) {
          const next = sync_iter.next();
          if (next.done) {
            ended = true;
            break;
          }
          admit_value(next.value);
        }
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;
      } else if (src_kind === 3) {
        if (read_chunk !== undefined) {
          const next = read_chunk;
          read_chunk = undefined;
          if (next.done) ended = true;
          else {
            opened.arr = next.value;
            opened.idx = 0;
          }
        }
        while (
          !ended && admitted < concurrency && !has_failure &&
          !aborted && opened.arr !== undefined && opened.idx < opened.arr.length
        ) {
          const raw_item = opened.arr[opened.idx++];
          if (is_promise_like(raw_item)) {
            admitted += 1;
            if (raw_item instanceof Promise) {
              raw_item.then(on_item_resolved, on_fail);
            } else {
              Promise.resolve(raw_item).then(on_item_resolved, on_fail);
            }
          } else {
            admit_value(raw_item);
          }
        }
        if (has_failure) throw fail_error;
        if (aborted) throw abort_reason;
        if (
          !ended && admitted < concurrency && !reading &&
          (opened.arr === undefined || opened.idx >= opened.arr.length)
        ) {
          reading = true;
          try {
            const p = opened.chunk_iter!.next();
            if (p instanceof Promise) p.then(on_chunk, on_fail);
            else Promise.resolve(p).then(on_chunk, on_fail);
          } catch (error) {
            reading = false;
            on_fail(error);
            throw fail_error;
          }
        }
      } else {
        if (read !== undefined) {
          const next = read;
          read = undefined;
          if (next.done) {
            ended = true;
            if (src_kind === 4) {
              const r = opened.stream_reader;
              opened.stream_reader = undefined;
              r?.releaseLock();
            }
          } else {
            admit_value(next.value);
          }
          continue;
        }
        if (!ended && admitted < concurrency && !reading) {
          reading = true;
          try {
            const p = src_kind === 4
              ? opened.stream_reader!.read() as Promise<IteratorResult<unknown>>
              : opened.async_iter!.next();
            if (p instanceof Promise) p.then(on_read, on_fail);
            else Promise.resolve(p).then(on_read, on_fail);
          } catch (error) {
            reading = false;
            on_fail(error);
            throw fail_error;
          }
        }
      }

      if (ready_count > 0) {
        if (mode === MODE_ARRAY && limit === Infinity) {
          while (ready_count > 0) {
            admitted -= 1;
            out!.push(ready[ready_head] as item);
            ready[ready_head] = undefined;
            ready_head = (ready_head + 1) % concurrency;
            ready_count -= 1;
          }
          continue;
        }
        admitted -= 1;
        const val = ready[ready_head];
        ready[ready_head] = undefined;
        ready_head = (ready_head + 1) % concurrency;
        ready_count -= 1;
        if (mode === MODE_ARRAY) {
          out!.push(val as item);
          if (out!.length >= limit) return out as unknown as result;
        } else if (mode === MODE_SOME) {
          const m = (
            terminal_fn as (v: item) => boolean | PromiseLike<boolean>
          )(val as item);
          if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
            return true as unknown as result;
          }
        } else if (mode === MODE_FIND) {
          const m = (
            terminal_fn as (v: item) => boolean | PromiseLike<boolean>
          )(val as item);
          if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
            return Just(val as item) as unknown as result;
          }
        } else {
          const raw_step = (
            terminal_fn as (
              s: unknown,
              v: item,
            ) => FoldStep<unknown> | PromiseLike<FoldStep<unknown>>
          )(fold_state, val as item);
          const step = is_promise_like(raw_step) ? await raw_step : raw_step;
          fold_state = step[1];
          if (step[0] === "Done") return fold_state as result;
        }
        continue;
      }
      if (ended && admitted === 0) {
        if (mode === MODE_ARRAY) return out as unknown as result;
        if (mode === MODE_SOME) return false as unknown as result;
        if (mode === MODE_FIND) return Nothing<item>() as unknown as result;
        return fold_state as result;
      }
      await new Promise<void>((resolve, reject) => {
        if (aborted) {
          reject(abort_reason);
          return;
        }
        wake_resolve = resolve;
        wake_reject = reject;
      });
    }
  } catch (error) {
    primary_failure = { error };
    throw error;
  } finally {
    aborted = true;
    controller.abort();
    if (external !== undefined) {
      external.removeEventListener("abort", on_external_abort);
    }
    if (!ended) await close_concurrent_resource(opened, primary_failure);
  }
}

function noop(): void {}

// --- Terminals: fold_while, find, some (COL-03) ---

/** Reduce until Done, closing the source before resolving. */
export function fold_while<item, state>(
  iterable: AsyncIterableT<item>,
  initial: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  try {
    const factory = iterable.value() as RawAsyncIterableT<unknown>;
    const plan = pipeline_of(factory);
    if (plan !== undefined) {
      return drive_pipeline_terminal<item, state>(
        plan,
        MODE_FOLD_WHILE,
        fn,
        initial,
      );
    }
    const concurrent = concurrent_of(factory);
    if (concurrent !== undefined) {
      return concurrent.ordered
        ? drive_concurrent_ordered_push<item, state>(
          concurrent,
          MODE_FOLD_WHILE,
          fn,
          initial,
        )
        : drive_concurrent_unordered_push<item, state>(
          concurrent,
          MODE_FOLD_WHILE,
          fn,
          initial,
        );
    }
    const synchronous = sync_of(factory);
    if (synchronous !== undefined) {
      const iter = synchronous();
      if (is_canonical_array(iter)) {
        let state = initial;
        for (let i = 0; i < iter.length; i += 1) {
          const step = fn(state, iter[i] as item);
          if (is_promise_like(step)) {
            return finish_array_fold_while(iter, i, step, fn, false);
          }
          state = step[1];
          if (step[0] === "Done") return Promise.resolve(state);
        }
        return Promise.resolve(state);
      }
      return drive_sync_iter_fold_while(iter, initial, fn);
    }
    const snap = array_of(factory);
    if (snap !== undefined) {
      let state = initial;
      for (let i = 0; i < snap.length; i += 1) {
        const val = snap[i];
        if (is_promise_like(val)) {
          return finish_snap_fold_while(snap, i, val, state, fn);
        }
        const step = fn(state, val as item);
        if (is_promise_like(step)) {
          return finish_array_fold_while(snap, i, step, fn, true);
        }
        state = step[1];
        if (step[0] === "Done") return Promise.resolve(state);
      }
      return Promise.resolve(state);
    }
    const chunks = chunks_of(factory);
    if (chunks !== undefined) {
      return drive_chunks_fold_while(chunks, initial, fn);
    }
    const stream = stream_of(factory);
    if (stream !== undefined) {
      return drive_stream_fold_while(stream, initial, fn);
    }
    return drive_generic_fold_while(
      factory as RawAsyncIterableT<item>,
      initial,
      fn,
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

async function finish_array_fold_while<item, state>(
  arr: readonly unknown[],
  index: number,
  first_pending: PromiseLike<FoldStep<state>>,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
  await_source: boolean,
): Promise<state> {
  const first = await first_pending;
  let state = first[1];
  if (first[0] === "Done") return state;
  for (let i = index + 1; i < arr.length; i += 1) {
    let val = arr[i];
    if (await_source && is_promise_like(val)) val = await val;
    const raw = fn(state, val as item);
    const step = is_promise_like(raw) ? await raw : raw;
    state = step[1];
    if (step[0] === "Done") return state;
  }
  return state;
}

async function finish_snap_fold_while<item, state>(
  snap: readonly unknown[],
  index: number,
  first_val: PromiseLike<unknown>,
  initial_state: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  let state = initial_state;
  const resolved = await first_val;
  const first_raw = fn(state, resolved as item);
  const first_step = is_promise_like(first_raw) ? await first_raw : first_raw;
  state = first_step[1];
  if (first_step[0] === "Done") return state;
  for (let i = index + 1; i < snap.length; i += 1) {
    let val = snap[i];
    if (is_promise_like(val)) val = await val;
    const raw = fn(state, val as item);
    const step = is_promise_like(raw) ? await raw : raw;
    state = step[1];
    if (step[0] === "Done") return state;
  }
  return state;
}

async function drive_sync_iter_fold_while<item, state>(
  iter: Iterable<unknown>,
  initial: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  const sync = iter[Symbol.iterator]();
  let state = initial;
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = sync.next();
      if (next.done) {
        ended = true;
        return state;
      }
      const raw = fn(state, next.value as item);
      const step = is_promise_like(raw) ? await raw : raw;
      state = step[1];
      if (step[0] === "Done") return state;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(sync, undefined, failed);
  }
}

async function drive_chunks_fold_while<item, state>(
  chunks: () => AsyncIterable<readonly unknown[]>,
  initial: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  const chunk_iter = chunks()[Symbol.asyncIterator]();
  let state = initial;
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await chunk_iter.next();
      if (next.done) {
        ended = true;
        return state;
      }
      const chunk = next.value;
      for (let i = 0; i < chunk.length; i += 1) {
        let val = chunk[i];
        if (is_promise_like(val)) val = await val;
        const raw = fn(state, val as item);
        const step = is_promise_like(raw) ? await raw : raw;
        state = step[1];
        if (step[0] === "Done") return state;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, chunk_iter, failed);
  }
}

async function drive_stream_fold_while<item, state>(
  spec: StreamSpec,
  initial: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  const reader = spec.stream.getReader();
  const prevent_cancel = spec.prevent_cancel;
  let state = initial;
  let done = false;
  let failed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done === true) {
        done = true;
        return state;
      }
      const raw = fn(state, next.value as item);
      const step = is_promise_like(raw) ? await raw : raw;
      state = step[1];
      if (step[0] === "Done") return state;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await close_stream_reader(reader, done, prevent_cancel, failed);
  }
}

async function drive_generic_fold_while<item, state>(
  factory: RawAsyncIterableT<item>,
  initial: state,
  fn: (
    state: state,
    item: item,
  ) => FoldStep<state> | PromiseLike<FoldStep<state>>,
): Promise<state> {
  const async_iter = factory()[Symbol.asyncIterator]();
  let state = initial;
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await async_iter.next();
      if (next.done) {
        ended = true;
        return state;
      }
      const raw = fn(state, next.value);
      const step = is_promise_like(raw) ? await raw : raw;
      state = step[1];
      if (step[0] === "Done") return state;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, async_iter, failed);
  }
}

/** Find the first match and close the source before resolving. */
export function find<item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  try {
    const factory = iterable.value() as RawAsyncIterableT<unknown>;
    const plan = pipeline_of(factory);
    if (plan !== undefined) {
      return drive_pipeline_terminal<item, Maybe<item>>(
        plan,
        MODE_FIND,
        predicate,
        undefined,
      );
    }
    const concurrent = concurrent_of(factory);
    if (concurrent !== undefined) {
      return concurrent.ordered
        ? drive_concurrent_ordered_push<item, Maybe<item>>(
          concurrent,
          MODE_FIND,
          predicate,
          undefined,
        )
        : drive_concurrent_unordered_push<item, Maybe<item>>(
          concurrent,
          MODE_FIND,
          predicate,
          undefined,
        );
    }
    const synchronous = sync_of(factory);
    if (synchronous !== undefined) {
      const iter = synchronous();
      if (is_canonical_array(iter)) {
        for (let i = 0; i < iter.length; i += 1) {
          const val = iter[i] as item;
          const m = predicate(val);
          if (m === true) return Promise.resolve(Just(val));
          if (is_promise_like(m)) {
            return finish_array_find(iter, i, val, m, predicate, false);
          }
          if (m) return Promise.resolve(Just(val));
        }
        return Promise.resolve(Nothing<item>());
      }
      return drive_sync_iter_find(iter, predicate);
    }
    const snap = array_of(factory);
    if (snap !== undefined) {
      for (let i = 0; i < snap.length; i += 1) {
        const val = snap[i];
        if (is_promise_like(val)) {
          return finish_snap_find(snap, i, val, predicate);
        }
        const m = predicate(val as item);
        if (m === true) return Promise.resolve(Just(val as item));
        if (is_promise_like(m)) {
          return finish_array_find(snap, i, val as item, m, predicate, true);
        }
        if (m) return Promise.resolve(Just(val as item));
      }
      return Promise.resolve(Nothing<item>());
    }
    const chunks = chunks_of(factory);
    if (chunks !== undefined) {
      return drive_chunks_find(chunks, predicate);
    }
    const stream = stream_of(factory);
    if (stream !== undefined) {
      return drive_stream_find(stream, predicate);
    }
    return drive_generic_find(factory as RawAsyncIterableT<item>, predicate);
  } catch (error) {
    return Promise.reject(error);
  }
}

async function finish_array_find<item>(
  arr: readonly unknown[],
  index: number,
  first_item: item,
  first_pending: PromiseLike<boolean>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
  await_source: boolean,
): Promise<Maybe<item>> {
  if (await first_pending) return Just(first_item);
  for (let i = index + 1; i < arr.length; i += 1) {
    let val = arr[i];
    if (await_source && is_promise_like(val)) val = await val;
    const m = predicate(val as item);
    if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
      return Just(val as item);
    }
  }
  return Nothing<item>();
}

async function finish_snap_find<item>(
  snap: readonly unknown[],
  index: number,
  first_val: PromiseLike<unknown>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  const resolved = (await first_val) as item;
  const fm = predicate(resolved);
  if (fm === true || (is_promise_like(fm) ? await fm : Boolean(fm))) {
    return Just(resolved);
  }
  for (let i = index + 1; i < snap.length; i += 1) {
    let val = snap[i];
    if (is_promise_like(val)) val = await val;
    const m = predicate(val as item);
    if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
      return Just(val as item);
    }
  }
  return Nothing<item>();
}

async function drive_sync_iter_find<item>(
  iter: Iterable<unknown>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  const sync = iter[Symbol.iterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = sync.next();
      if (next.done) {
        ended = true;
        return Nothing<item>();
      }
      const val = next.value as item;
      const m = predicate(val);
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        return Just(val);
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(sync, undefined, failed);
  }
}

async function drive_chunks_find<item>(
  chunks: () => AsyncIterable<readonly unknown[]>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  const chunk_iter = chunks()[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await chunk_iter.next();
      if (next.done) {
        ended = true;
        return Nothing<item>();
      }
      const chunk = next.value;
      for (let i = 0; i < chunk.length; i += 1) {
        let val = chunk[i];
        if (is_promise_like(val)) val = await val;
        const m = predicate(val as item);
        if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
          return Just(val as item);
        }
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, chunk_iter, failed);
  }
}

async function drive_stream_find<item>(
  spec: StreamSpec,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  const reader = spec.stream.getReader();
  const prevent_cancel = spec.prevent_cancel;
  let done = false;
  let failed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done === true) {
        done = true;
        return Nothing<item>();
      }
      const val = next.value as item;
      const m = predicate(val);
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        return Just(val);
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await close_stream_reader(reader, done, prevent_cancel, failed);
  }
}

async function drive_generic_find<item>(
  factory: RawAsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<Maybe<item>> {
  const async_iter = factory()[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await async_iter.next();
      if (next.done) {
        ended = true;
        return Nothing<item>();
      }
      const val = next.value;
      const m = predicate(val);
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        return Just(val);
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, async_iter, failed);
  }
}

/** Test for a matching value with bounded demand. */
export function some<item>(
  iterable: AsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  try {
    const factory = iterable.value() as RawAsyncIterableT<unknown>;
    const plan = pipeline_of(factory);
    if (plan !== undefined) {
      return drive_pipeline_terminal<item, boolean>(
        plan,
        MODE_SOME,
        predicate,
        undefined,
      );
    }
    const concurrent = concurrent_of(factory);
    if (concurrent !== undefined) {
      return concurrent.ordered
        ? drive_concurrent_ordered_push<item, boolean>(
          concurrent,
          MODE_SOME,
          predicate,
          undefined,
        )
        : drive_concurrent_unordered_push<item, boolean>(
          concurrent,
          MODE_SOME,
          predicate,
          undefined,
        );
    }
    const synchronous = sync_of(factory);
    if (synchronous !== undefined) {
      const iter = synchronous();
      if (is_canonical_array(iter)) {
        for (let i = 0; i < iter.length; i += 1) {
          const m = predicate(iter[i] as item);
          if (m === true) return Promise.resolve(true);
          if (is_promise_like(m)) {
            return finish_array_some(iter, i, m, predicate, false);
          }
          if (m) return Promise.resolve(true);
        }
        return Promise.resolve(false);
      }
      return drive_sync_iter_some(iter, predicate);
    }
    const snap = array_of(factory);
    if (snap !== undefined) {
      for (let i = 0; i < snap.length; i += 1) {
        const val = snap[i];
        if (is_promise_like(val)) {
          return finish_snap_some(snap, i, val, predicate);
        }
        const m = predicate(val as item);
        if (m === true) return Promise.resolve(true);
        if (is_promise_like(m)) {
          return finish_array_some(snap, i, m, predicate, true);
        }
        if (m) return Promise.resolve(true);
      }
      return Promise.resolve(false);
    }
    const chunks = chunks_of(factory);
    if (chunks !== undefined) {
      return drive_chunks_some(chunks, predicate);
    }
    const stream = stream_of(factory);
    if (stream !== undefined) {
      return drive_stream_some(stream, predicate);
    }
    return drive_generic_some(factory as RawAsyncIterableT<item>, predicate);
  } catch (error) {
    return Promise.reject(error);
  }
}

async function finish_array_some<item>(
  arr: readonly unknown[],
  index: number,
  first_pending: PromiseLike<boolean>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
  await_source: boolean,
): Promise<boolean> {
  if (await first_pending) return true;
  for (let i = index + 1; i < arr.length; i += 1) {
    let val = arr[i];
    if (await_source && is_promise_like(val)) val = await val;
    const m = predicate(val as item);
    if (m === true || (is_promise_like(m) ? await m : Boolean(m))) return true;
  }
  return false;
}

async function finish_snap_some<item>(
  snap: readonly unknown[],
  index: number,
  first_val: PromiseLike<unknown>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  const resolved = (await first_val) as item;
  const fm = predicate(resolved);
  if (fm === true || (is_promise_like(fm) ? await fm : Boolean(fm))) {
    return true;
  }
  for (let i = index + 1; i < snap.length; i += 1) {
    let val = snap[i];
    if (is_promise_like(val)) val = await val;
    const m = predicate(val as item);
    if (m === true || (is_promise_like(m) ? await m : Boolean(m))) return true;
  }
  return false;
}

async function drive_sync_iter_some<item>(
  iter: Iterable<unknown>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  const sync = iter[Symbol.iterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = sync.next();
      if (next.done) {
        ended = true;
        return false;
      }
      const m = predicate(next.value as item);
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        return true;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(sync, undefined, failed);
  }
}

async function drive_chunks_some<item>(
  chunks: () => AsyncIterable<readonly unknown[]>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  const chunk_iter = chunks()[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await chunk_iter.next();
      if (next.done) {
        ended = true;
        return false;
      }
      const chunk = next.value;
      for (let i = 0; i < chunk.length; i += 1) {
        let val = chunk[i];
        if (is_promise_like(val)) val = await val;
        const m = predicate(val as item);
        if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
          return true;
        }
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, chunk_iter, failed);
  }
}

async function drive_stream_some<item>(
  spec: StreamSpec,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  const reader = spec.stream.getReader();
  const prevent_cancel = spec.prevent_cancel;
  let done = false;
  let failed = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done === true) {
        done = true;
        return false;
      }
      const m = predicate(next.value as item);
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        return true;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await close_stream_reader(reader, done, prevent_cancel, failed);
  }
}

async function drive_generic_some<item>(
  factory: RawAsyncIterableT<item>,
  predicate: (item: item) => boolean | PromiseLike<boolean>,
): Promise<boolean> {
  const async_iter = factory()[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await async_iter.next();
      if (next.done) {
        ended = true;
        return false;
      }
      const m = predicate(next.value);
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        return true;
      }
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, async_iter, failed);
  }
}

// --- Pipeline metadata & specialized drivers (COL-02) ---

function pipeline_meta(plan: Pipeline): PipelineMeta {
  if (plan.meta !== undefined) return plan.meta;
  const ordered: Stage[] = [];
  let link: Stages | undefined = plan.stages;
  while (link !== undefined) {
    ordered.push(link.stage);
    link = link.previous;
  }
  ordered.reverse();
  let has_take = false;
  let has_zero_take = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const stage = ordered[index];
    if (stage.tag === "take") {
      has_take = true;
      if (stage.count === 0) has_zero_take = true;
    }
  }
  const meta: PipelineMeta = { ordered, has_take, has_zero_take };
  plan.meta = meta;
  return meta;
}

function init_remaining(ordered: readonly Stage[]): number[] {
  const remaining = new Array<number>(ordered.length);
  for (let index = 0; index < ordered.length; index += 1) {
    const stage = ordered[index];
    remaining[index] = stage.tag === "take" ? stage.count : Infinity;
  }
  return remaining;
}

type TerminalBox = {
  done: boolean;
  found: boolean;
  value: unknown;
};

async function finish_async_stage<item>(
  ordered: readonly Stage[],
  remaining: number[] | undefined,
  mode: number,
  terminal_fn: unknown,
  out: item[] | undefined,
  limit: number,
  box: TerminalBox | undefined,
  pending: PromiseLike<unknown>,
  start_index: number,
  is_filter: boolean,
  initial_stop: boolean,
  initial_item?: unknown,
): Promise<boolean> {
  const stage_count = ordered.length;
  let item = initial_item;
  let keep = true;
  let stop = initial_stop;
  if (is_filter) {
    keep = Boolean(await pending);
  } else {
    item = await pending;
  }
  if (keep) {
    for (let index = start_index + 1; index < stage_count; index += 1) {
      const operation = ordered[index];
      switch (operation.tag) {
        case "map_sync":
          item = operation.fn(item);
          break;
        case "filter_map": {
          const pair = operation.fn(item).value();
          if (pair[0] === "Nothing") keep = false;
          else item = pair[1];
          break;
        }
        case "take":
          remaining![index] -= 1;
          if (remaining![index] === 0) stop = true;
          break;
        case "map":
          item = operation.fn(item);
          if (is_promise_like(item)) item = await item;
          break;
        case "filter": {
          const result = operation.fn(item);
          keep = typeof result === "boolean"
            ? result
            : is_promise_like(result)
            ? Boolean(await result)
            : Boolean(result);
          break;
        }
      }
      if (!keep) break;
    }
  }
  if (keep) {
    if (mode === MODE_ARRAY) {
      out!.push(item as item);
      if (out!.length >= limit) return true;
    } else if (mode === MODE_SOME) {
      const m = (terminal_fn as (v: item) => boolean | PromiseLike<boolean>)(
        item as item,
      );
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        box!.done = true;
        box!.found = true;
        return true;
      }
    } else if (mode === MODE_FIND) {
      const m = (terminal_fn as (v: item) => boolean | PromiseLike<boolean>)(
        item as item,
      );
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        box!.done = true;
        box!.found = true;
        box!.value = item;
        return true;
      }
    } else {
      const raw = (
        terminal_fn as (
          s: unknown,
          v: item,
        ) => FoldStep<unknown> | PromiseLike<FoldStep<unknown>>
      )(box!.value, item as item);
      const step = is_promise_like(raw) ? await raw : raw;
      box!.value = step[1];
      if (step[0] === "Done") {
        box!.done = true;
        return true;
      }
    }
  }
  return stop;
}

// Specialized fast loops for sync canonical array -> to_array / preview (0 async frames if sync)

function drive_sync_array_pipeline<item>(
  arr: readonly unknown[],
  ordered: readonly Stage[],
  effective_len: number,
  cap: number,
  has_take: boolean,
): Promise<item[]> {
  if (effective_len === 0) {
    return Promise.resolve(
      (cap < arr.length ? arr.slice(0, cap) : arr.slice()) as item[],
    );
  }
  if (effective_len === 1) {
    const s0 = ordered[0];
    if (s0.tag === "map_sync") {
      const fn0 = s0.fn;
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        out.push(fn0(arr[i]) as item);
        if (out.length >= cap) break;
      }
      return Promise.resolve(out);
    }
    if (s0.tag === "map") {
      const fn0 = s0.fn;
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        const v = fn0(arr[i]);
        if (is_promise_like(v)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            v,
            0,
            false,
            false,
            undefined,
          );
        }
        out.push(v as item);
        if (out.length >= cap) break;
      }
      return Promise.resolve(out);
    }
    if (s0.tag === "filter") {
      const fn0 = s0.fn;
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        const v = arr[i];
        const r = fn0(v);
        if (typeof r === "boolean") {
          if (r) {
            out.push(v as item);
            if (out.length >= cap) break;
          }
        } else if (is_promise_like(r)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            r,
            0,
            true,
            false,
            v,
          );
        } else if (r) {
          out.push(v as item);
          if (out.length >= cap) break;
        }
      }
      return Promise.resolve(out);
    }
    if (s0.tag === "filter_map") {
      const fn0 = s0.fn;
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        const pair = fn0(arr[i]).value();
        if (pair[0] !== "Nothing") {
          out.push(pair[1] as item);
          if (out.length >= cap) break;
        }
      }
      return Promise.resolve(out);
    }
  } else if (effective_len === 2) {
    const s0 = ordered[0];
    const s1 = ordered[1];
    if (
      (s0.tag === "map" || s0.tag === "map_sync") && s1.tag === "filter"
    ) {
      const fn0 = s0.fn;
      const sync0 = s0.tag === "map_sync";
      const fn1 = s1.fn;
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        const v = fn0(arr[i]);
        if (!sync0 && is_promise_like(v)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            v,
            0,
            false,
            false,
            undefined,
          );
        }
        const r = fn1(v);
        if (typeof r === "boolean") {
          if (r) {
            out.push(v as item);
            if (out.length >= cap) break;
          }
        } else if (is_promise_like(r)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            r,
            1,
            true,
            false,
            v,
          );
        } else if (r) {
          out.push(v as item);
          if (out.length >= cap) break;
        }
      }
      return Promise.resolve(out);
    }
    if (
      s0.tag === "filter" && (s1.tag === "map" || s1.tag === "map_sync")
    ) {
      const fn0 = s0.fn;
      const fn1 = s1.fn;
      const sync1 = s1.tag === "map_sync";
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        const raw = arr[i];
        const r = fn0(raw);
        let ok: boolean;
        if (typeof r === "boolean") ok = r;
        else if (is_promise_like(r)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            r,
            0,
            true,
            false,
            raw,
          );
        } else ok = Boolean(r);
        if (!ok) continue;
        const v = fn1(raw);
        if (!sync1 && is_promise_like(v)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            v,
            1,
            false,
            false,
            undefined,
          );
        }
        out.push(v as item);
        if (out.length >= cap) break;
      }
      return Promise.resolve(out);
    }
    if (
      (s0.tag === "map" || s0.tag === "map_sync") &&
      (s1.tag === "map" || s1.tag === "map_sync")
    ) {
      const fn0 = s0.fn;
      const sync0 = s0.tag === "map_sync";
      const fn1 = s1.fn;
      const sync1 = s1.tag === "map_sync";
      const out: item[] = [];
      for (let i = 0; i < arr.length; i += 1) {
        const v0 = fn0(arr[i]);
        if (!sync0 && is_promise_like(v0)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            v0,
            0,
            false,
            false,
            undefined,
          );
        }
        const v1 = fn1(v0);
        if (!sync1 && is_promise_like(v1)) {
          return finish_sync_arr_general(
            arr,
            i,
            ordered,
            has_take ? init_remaining(ordered) : undefined,
            out,
            cap,
            v1,
            1,
            false,
            false,
            undefined,
          );
        }
        out.push(v1 as item);
        if (out.length >= cap) break;
      }
      return Promise.resolve(out);
    }
  }
  const out: item[] = [];
  const remaining = has_take ? init_remaining(ordered) : undefined;
  const stage_count = ordered.length;
  for (let i = 0; i < arr.length; i += 1) {
    let item = arr[i];
    let keep = true;
    let stop = false;
    for (let index = 0; index < stage_count; index += 1) {
      const operation = ordered[index];
      switch (operation.tag) {
        case "map_sync":
          item = operation.fn(item);
          break;
        case "filter_map": {
          const pair = operation.fn(item).value();
          if (pair[0] === "Nothing") keep = false;
          else item = pair[1];
          break;
        }
        case "take":
          remaining![index] -= 1;
          if (remaining![index] === 0) stop = true;
          break;
        case "map":
          item = operation.fn(item);
          if (is_promise_like(item)) {
            return finish_sync_arr_general(
              arr,
              i,
              ordered,
              remaining,
              out,
              cap,
              item,
              index,
              false,
              stop,
              undefined,
            );
          }
          break;
        case "filter": {
          const result = operation.fn(item);
          if (typeof result === "boolean") keep = result;
          else if (is_promise_like(result)) {
            return finish_sync_arr_general(
              arr,
              i,
              ordered,
              remaining,
              out,
              cap,
              result,
              index,
              true,
              stop,
              item,
            );
          } else keep = Boolean(result);
          break;
        }
      }
      if (!keep) break;
    }
    if (keep) {
      out.push(item as item);
      if (out.length >= cap) break;
    }
    if (stop) break;
  }
  return Promise.resolve(out);
}

function step_pipeline_to_array<item>(
  raw_item: unknown,
  ordered: readonly Stage[],
  remaining: number[] | undefined,
  out: item[],
  limit: number,
): boolean | Promise<boolean> {
  let item = raw_item;
  let keep = true;
  let stop = false;
  for (let index = 0; index < ordered.length; index += 1) {
    const operation = ordered[index];
    switch (operation.tag) {
      case "map_sync":
        item = operation.fn(item);
        break;
      case "filter_map": {
        const pair = operation.fn(item).value();
        if (pair[0] === "Nothing") keep = false;
        else item = pair[1];
        break;
      }
      case "take":
        remaining![index] -= 1;
        if (remaining![index] === 0) stop = true;
        break;
      case "map":
        item = operation.fn(item);
        if (is_promise_like(item)) {
          return finish_async_stage(
            ordered,
            remaining,
            MODE_ARRAY,
            undefined,
            out,
            limit,
            undefined,
            item,
            index,
            false,
            stop,
            undefined,
          );
        }
        break;
      case "filter": {
        const result = operation.fn(item);
        if (typeof result === "boolean") keep = result;
        else if (is_promise_like(result)) {
          return finish_async_stage(
            ordered,
            remaining,
            MODE_ARRAY,
            undefined,
            out,
            limit,
            undefined,
            result,
            index,
            true,
            stop,
            item,
          );
        } else keep = Boolean(result);
        break;
      }
    }
    if (!keep) break;
  }
  if (keep) {
    out.push(item as item);
    if (out.length >= limit) return true;
  }
  return stop;
}

async function finish_sync_arr_general<item>(
  arr: readonly unknown[],
  start_i: number,
  ordered: readonly Stage[],
  remaining: number[] | undefined,
  out: item[],
  cap: number,
  pending: PromiseLike<unknown>,
  stage_index: number,
  is_filter: boolean,
  initial_stop: boolean,
  initial_item: unknown,
): Promise<item[]> {
  if (
    await finish_async_stage(
      ordered,
      remaining,
      MODE_ARRAY,
      undefined,
      out,
      cap,
      undefined,
      pending,
      stage_index,
      is_filter,
      initial_stop,
      initial_item,
    )
  ) return out;
  for (let i = start_i + 1; i < arr.length; i += 1) {
    const done = step_pipeline_to_array(arr[i], ordered, remaining, out, cap);
    if (done === true || (done !== false && await done)) return out;
  }
  return out;
}

// Specialized fast chunk/snap processor for 0/1/2 stages + trailing take -> out[]
async function drive_chunk_fast<item>(
  chunk: readonly unknown[],
  ordered: readonly Stage[],
  effective_len: number,
  out: item[],
  cap: number,
): Promise<boolean> {
  if (effective_len === 0) {
    for (let i = 0; i < chunk.length; i += 1) {
      let v = chunk[i];
      if (is_promise_like(v)) v = await v;
      out.push(v as item);
      if (out.length >= cap) return true;
    }
    return false;
  }
  if (effective_len === 1) {
    const s0 = ordered[0];
    if (s0.tag === "map" || s0.tag === "map_sync") {
      const fn0 = s0.fn;
      const sync0 = s0.tag === "map_sync";
      for (let i = 0; i < chunk.length; i += 1) {
        let v = chunk[i];
        if (is_promise_like(v)) v = await v;
        v = fn0(v);
        if (!sync0 && is_promise_like(v)) v = await v;
        out.push(v as item);
        if (out.length >= cap) return true;
      }
      return false;
    }
    if (s0.tag === "filter") {
      const fn0 = s0.fn;
      for (let i = 0; i < chunk.length; i += 1) {
        let v = chunk[i];
        if (is_promise_like(v)) v = await v;
        const r = fn0(v);
        const ok = typeof r === "boolean"
          ? r
          : is_promise_like(r)
          ? Boolean(await r)
          : Boolean(r);
        if (ok) {
          out.push(v as item);
          if (out.length >= cap) return true;
        }
      }
      return false;
    }
    if (s0.tag === "filter_map") {
      const fn0 = s0.fn;
      for (let i = 0; i < chunk.length; i += 1) {
        let v = chunk[i];
        if (is_promise_like(v)) v = await v;
        const pair = fn0(v).value();
        if (pair[0] !== "Nothing") {
          out.push(pair[1] as item);
          if (out.length >= cap) return true;
        }
      }
      return false;
    }
  }
  if (effective_len === 2) {
    const s0 = ordered[0];
    const s1 = ordered[1];
    if ((s0.tag === "map" || s0.tag === "map_sync") && s1.tag === "filter") {
      const fn0 = s0.fn;
      const sync0 = s0.tag === "map_sync";
      const fn1 = s1.fn;
      for (let i = 0; i < chunk.length; i += 1) {
        let v = chunk[i];
        if (is_promise_like(v)) v = await v;
        v = fn0(v);
        if (!sync0 && is_promise_like(v)) v = await v;
        const r = fn1(v);
        const ok = typeof r === "boolean"
          ? r
          : is_promise_like(r)
          ? Boolean(await r)
          : Boolean(r);
        if (ok) {
          out.push(v as item);
          if (out.length >= cap) return true;
        }
      }
      return false;
    }
    if (s0.tag === "filter" && (s1.tag === "map" || s1.tag === "map_sync")) {
      const fn0 = s0.fn;
      const fn1 = s1.fn;
      const sync1 = s1.tag === "map_sync";
      for (let i = 0; i < chunk.length; i += 1) {
        let v = chunk[i];
        if (is_promise_like(v)) v = await v;
        const r = fn0(v);
        const ok = typeof r === "boolean"
          ? r
          : is_promise_like(r)
          ? Boolean(await r)
          : Boolean(r);
        if (!ok) continue;
        v = fn1(v);
        if (!sync1 && is_promise_like(v)) v = await v;
        out.push(v as item);
        if (out.length >= cap) return true;
      }
      return false;
    }
    if (
      (s0.tag === "map" || s0.tag === "map_sync") &&
      (s1.tag === "map" || s1.tag === "map_sync")
    ) {
      const fn0 = s0.fn;
      const sync0 = s0.tag === "map_sync";
      const fn1 = s1.fn;
      const sync1 = s1.tag === "map_sync";
      for (let i = 0; i < chunk.length; i += 1) {
        let v = chunk[i];
        if (is_promise_like(v)) v = await v;
        v = fn0(v);
        if (!sync0 && is_promise_like(v)) v = await v;
        v = fn1(v);
        if (!sync1 && is_promise_like(v)) v = await v;
        out.push(v as item);
        if (out.length >= cap) return true;
      }
      return false;
    }
  }
  return false;
}

function is_specializable_stages(
  ordered: readonly Stage[],
  effective_len: number,
): boolean {
  if (effective_len === 0) return true;
  if (effective_len === 1) return ordered[0].tag !== "take";
  if (effective_len === 2) {
    const t0 = ordered[0].tag;
    const t1 = ordered[1].tag;
    return (
      ((t0 === "map" || t0 === "map_sync") &&
        (t1 === "filter" || t1 === "map" || t1 === "map_sync")) ||
      (t0 === "filter" && (t1 === "map" || t1 === "map_sync"))
    );
  }
  return false;
}

function drive_pipeline_to_array<item>(
  plan: Pipeline,
  limit: number,
): Promise<item[]> {
  const meta = pipeline_meta(plan);
  if (meta.has_zero_take || limit === 0) return Promise.resolve([]);
  const ordered = meta.ordered;
  let effective_len = ordered.length;
  let cap = limit;
  if (ordered[effective_len - 1].tag === "take") {
    const last_count = (ordered[effective_len - 1] as {
      readonly tag: "take";
      readonly count: number;
    }).count;
    if (last_count < cap) cap = last_count;
    effective_len -= 1;
  }
  const source = plan.source;
  const synchronous = sync_of(source);
  if (synchronous !== undefined) {
    const iter = synchronous();
    if (is_canonical_array(iter)) {
      return drive_sync_array_pipeline<item>(
        iter,
        ordered,
        effective_len,
        cap,
        meta.has_take,
      );
    }
    return drive_pipeline_sync_iter_to_array<item>(
      iter,
      ordered,
      meta.has_take,
      limit,
    );
  }
  return drive_pipeline_async_to_array<item>(
    source,
    ordered,
    effective_len,
    cap,
    meta.has_take,
    limit,
  );
}

async function drive_pipeline_sync_iter_to_array<item>(
  iterable: Iterable<unknown>,
  ordered: readonly Stage[],
  has_take: boolean,
  limit: number,
): Promise<item[]> {
  const out: item[] = [];
  const remaining = has_take ? init_remaining(ordered) : undefined;
  const sync = iterable[Symbol.iterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = sync.next();
      if (next.done) {
        ended = true;
        return out;
      }
      const done = step_pipeline_to_array(
        next.value,
        ordered,
        remaining,
        out,
        limit,
      );
      if (done === true || (done !== false && await done)) return out;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(sync, undefined, failed);
  }
}

async function drive_pipeline_async_to_array<item>(
  source: RawAsyncIterableT<unknown>,
  ordered: readonly Stage[],
  effective_len: number,
  cap: number,
  has_take: boolean,
  limit: number,
): Promise<item[]> {
  const out: item[] = [];
  const specializable = is_specializable_stages(ordered, effective_len);
  const snap = array_of(source);
  if (snap !== undefined) {
    if (specializable) {
      await drive_chunk_fast(snap, ordered, effective_len, out, cap);
      return out;
    }
    const remaining = has_take ? init_remaining(ordered) : undefined;
    for (let i = 0; i < snap.length; i += 1) {
      let item = snap[i];
      if (is_promise_like(item)) item = await item;
      const done = step_pipeline_to_array(item, ordered, remaining, out, limit);
      if (done === true || (done !== false && await done)) return out;
    }
    return out;
  }

  const chunks = chunks_of(source);
  if (chunks !== undefined) {
    const chunk_iter = chunks()[Symbol.asyncIterator]();
    let ended = false;
    let failed = false;
    try {
      if (specializable) {
        while (true) {
          const next = await chunk_iter.next();
          if (next.done) {
            ended = true;
            return out;
          }
          if (
            await drive_chunk_fast(
              next.value,
              ordered,
              effective_len,
              out,
              cap,
            )
          ) return out;
        }
      }
      const remaining = has_take ? init_remaining(ordered) : undefined;
      while (true) {
        const next = await chunk_iter.next();
        if (next.done) {
          ended = true;
          return out;
        }
        const chunk = next.value;
        for (let i = 0; i < chunk.length; i += 1) {
          let item = chunk[i];
          if (is_promise_like(item)) item = await item;
          const done = step_pipeline_to_array(
            item,
            ordered,
            remaining,
            out,
            limit,
          );
          if (done === true || (done !== false && await done)) return out;
        }
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!ended) await close_pipeline_source(undefined, chunk_iter, failed);
    }
  }

  const stream = stream_of(source);
  if (stream !== undefined) {
    const reader = stream.stream.getReader();
    const prevent_cancel = stream.prevent_cancel;
    const remaining = has_take ? init_remaining(ordered) : undefined;
    let done = false;
    let failed = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done === true) {
          done = true;
          return out;
        }
        const stop = step_pipeline_to_array(
          next.value,
          ordered,
          remaining,
          out,
          limit,
        );
        if (stop === true || (stop !== false && await stop)) return out;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await close_stream_reader(reader, done, prevent_cancel, failed);
    }
  }

  const async_iter = source()[Symbol.asyncIterator]();
  const remaining = has_take ? init_remaining(ordered) : undefined;
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await async_iter.next();
      if (next.done) {
        ended = true;
        return out;
      }
      const stop = step_pipeline_to_array(
        next.value,
        ordered,
        remaining,
        out,
        limit,
      );
      if (stop === true || (stop !== false && await stop)) return out;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, async_iter, failed);
  }
}

async function drive_pipeline_terminal<item, result>(
  plan: Pipeline,
  mode: number,
  terminal_fn: unknown,
  initial: unknown,
): Promise<result> {
  const meta = pipeline_meta(plan);
  if (meta.has_zero_take) {
    if (mode === MODE_SOME) return false as unknown as result;
    if (mode === MODE_FIND) return Nothing<item>() as unknown as result;
    return initial as result;
  }
  const ordered = meta.ordered;
  const stage_count = ordered.length;
  const remaining = meta.has_take ? init_remaining(ordered) : undefined;
  const source = plan.source;
  const box: TerminalBox = { done: false, found: false, value: initial };

  const emit_sync = async (val: item): Promise<boolean> => {
    if (mode === MODE_SOME) {
      const m = (terminal_fn as (v: item) => boolean | PromiseLike<boolean>)(
        val,
      );
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        box.done = true;
        box.found = true;
        return true;
      }
      return false;
    }
    if (mode === MODE_FIND) {
      const m = (terminal_fn as (v: item) => boolean | PromiseLike<boolean>)(
        val,
      );
      if (m === true || (is_promise_like(m) ? await m : Boolean(m))) {
        box.done = true;
        box.found = true;
        box.value = val;
        return true;
      }
      return false;
    }
    const raw = (
      terminal_fn as (
        s: unknown,
        v: item,
      ) => FoldStep<unknown> | PromiseLike<FoldStep<unknown>>
    )(box.value, val);
    const step = is_promise_like(raw) ? await raw : raw;
    box.value = step[1];
    if (step[0] === "Done") {
      box.done = true;
      return true;
    }
    return false;
  };

  const finish_result = (): result => {
    if (mode === MODE_SOME) return box.found as unknown as result;
    if (mode === MODE_FIND) {
      return (box.found
        ? Just(box.value as item)
        : Nothing<item>()) as unknown as result;
    }
    return box.value as result;
  };

  const run_item = async (raw_item: unknown): Promise<boolean> => {
    let item = raw_item;
    let keep = true;
    let stop = false;
    for (let index = 0; index < stage_count; index += 1) {
      const operation = ordered[index];
      switch (operation.tag) {
        case "map_sync":
          item = operation.fn(item);
          break;
        case "filter_map": {
          const pair = operation.fn(item).value();
          if (pair[0] === "Nothing") keep = false;
          else item = pair[1];
          break;
        }
        case "take":
          remaining![index] -= 1;
          if (remaining![index] === 0) stop = true;
          break;
        case "map":
          item = operation.fn(item);
          if (is_promise_like(item)) {
            return await finish_async_stage(
              ordered,
              remaining,
              mode,
              terminal_fn,
              undefined,
              Infinity,
              box,
              item,
              index,
              false,
              stop,
              undefined,
            );
          }
          break;
        case "filter": {
          const res = operation.fn(item);
          if (typeof res === "boolean") keep = res;
          else if (is_promise_like(res)) {
            return await finish_async_stage(
              ordered,
              remaining,
              mode,
              terminal_fn,
              undefined,
              Infinity,
              box,
              res,
              index,
              true,
              stop,
              item,
            );
          } else keep = Boolean(res);
          break;
        }
      }
      if (!keep) break;
    }
    if (keep && await emit_sync(item as item)) return true;
    return stop;
  };

  const snap = array_of(source);
  if (snap !== undefined) {
    for (let i = 0; i < snap.length; i += 1) {
      let item = snap[i];
      if (is_promise_like(item)) item = await item;
      if (await run_item(item)) return finish_result();
    }
    return finish_result();
  }

  const chunks = chunks_of(source);
  if (chunks !== undefined) {
    const chunk_iter = chunks()[Symbol.asyncIterator]();
    let ended = false;
    let failed = false;
    try {
      while (true) {
        const next = await chunk_iter.next();
        if (next.done) {
          ended = true;
          return finish_result();
        }
        const chunk = next.value;
        for (let i = 0; i < chunk.length; i += 1) {
          let item = chunk[i];
          if (is_promise_like(item)) item = await item;
          if (await run_item(item)) return finish_result();
        }
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!ended) await close_pipeline_source(undefined, chunk_iter, failed);
    }
  }

  const synchronous = sync_of(source);
  if (synchronous !== undefined) {
    const iterable = synchronous();
    if (is_canonical_array(iterable)) {
      for (let i = 0; i < iterable.length; i += 1) {
        if (await run_item(iterable[i])) return finish_result();
      }
      return finish_result();
    }
    const sync = iterable[Symbol.iterator]();
    let ended = false;
    let failed = false;
    try {
      while (true) {
        const next = sync.next();
        if (next.done) {
          ended = true;
          return finish_result();
        }
        if (await run_item(next.value)) return finish_result();
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      if (!ended) await close_pipeline_source(sync, undefined, failed);
    }
  }

  const stream = stream_of(source);
  if (stream !== undefined) {
    const reader = stream.stream.getReader();
    const prevent_cancel = stream.prevent_cancel;
    let done = false;
    let failed = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done === true) {
          done = true;
          return finish_result();
        }
        if (await run_item(next.value)) return finish_result();
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await close_stream_reader(reader, done, prevent_cancel, failed);
    }
  }

  const async_iter = source()[Symbol.asyncIterator]();
  let ended = false;
  let failed = false;
  try {
    while (true) {
      const next = await async_iter.next();
      if (next.done) {
        ended = true;
        return finish_result();
      }
      if (await run_item(next.value)) return finish_result();
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!ended) await close_pipeline_source(undefined, async_iter, failed);
  }
}

// --- Pipeline constructor & lightweight custom AsyncIterator fallback (COL-02) ---

function pipeline<from, to = from>(
  value: AsyncIterableT<from>,
  stage: Stage,
): AsyncIterableT<to> {
  const current = value.value();
  const previous = pipeline_of(current);
  let source: RawAsyncIterableT<unknown> = current;
  let stages: Stages = { stage };
  if (previous !== undefined) {
    source = previous.source;
    if (stage.tag === "take" && previous.stages.stage.tag === "take") {
      stages = {
        stage: {
          tag: "take",
          count: Math.min(previous.stages.stage.count, stage.count),
        },
        previous: previous.stages.previous,
      };
    } else {
      stages = { stage, previous: previous.stages };
    }
  }
  const plan: Pipeline = { source, stages };
  const factory: TaggedAsyncFactory<to> = async function* () {
    const meta = pipeline_meta(plan);
    if (meta.has_zero_take) return;
    const ordered = meta.ordered;
    const remaining = meta.has_take ? init_remaining(ordered) : undefined;
    const opened = open_concurrent_source(source);
    let ended = false;
    let primary_failure: { readonly error: unknown } | undefined;
    try {
      while (true) {
        let item: unknown;
        if (opened.kind === 0) {
          const arr = opened.arr!;
          if (opened.idx >= arr.length) {
            ended = true;
            return;
          }
          item = arr[opened.idx++];
        } else if (opened.kind === 1) {
          const arr = opened.arr!;
          if (opened.idx >= arr.length) {
            ended = true;
            return;
          }
          item = arr[opened.idx++];
          if (is_promise_like(item)) item = await item;
        } else if (opened.kind === 2) {
          const next = opened.sync_iter!.next();
          if (next.done) {
            ended = true;
            return;
          }
          item = next.value;
        } else if (opened.kind === 3) {
          let chunk = opened.arr;
          while (chunk === undefined || opened.idx >= chunk.length) {
            const next = await opened.chunk_iter!.next();
            if (next.done) {
              ended = true;
              return;
            }
            chunk = next.value;
            opened.arr = chunk;
            opened.idx = 0;
          }
          item = chunk[opened.idx++];
          if (is_promise_like(item)) item = await item;
        } else if (opened.kind === 4) {
          const next = await opened.stream_reader!.read();
          if (next.done === true) {
            ended = true;
            const r = opened.stream_reader;
            opened.stream_reader = undefined;
            r?.releaseLock();
            return;
          }
          item = next.value;
        } else {
          const next = await opened.async_iter!.next();
          if (next.done) {
            ended = true;
            return;
          }
          item = next.value;
        }
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
              keep = typeof result === "boolean"
                ? result
                : is_promise_like(result)
                ? Boolean(await result)
                : Boolean(result);
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
      primary_failure = { error };
      throw error;
    } finally {
      if (!ended) await close_concurrent_resource(opened, primary_failure);
    }
  };
  factory[async_pipeline] = plan;
  return AsyncIterableT(factory);
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
  const source: TaggedAsyncFactory<item> = () => ({
    [Symbol.asyncIterator](): AsyncIterator<item> {
      let arr: readonly item[] | undefined;
      let idx = 0;
      let sync: Iterator<item> | undefined;
      let opened = false;
      let ended = false;
      let closed = false;
      return {
        next(): Promise<IteratorResult<item>> {
          if (ended || closed) {
            return Promise.resolve({ done: true, value: undefined });
          }
          try {
            if (!opened) {
              opened = true;
              const iter = factory();
              if (is_canonical_array(iter)) arr = iter as readonly item[];
              else sync = iter[Symbol.iterator]();
            }
            if (arr !== undefined) {
              if (idx >= arr.length) {
                ended = true;
                return Promise.resolve({ done: true, value: undefined });
              }
              return Promise.resolve({ done: false, value: arr[idx++] });
            }
            const next = sync!.next();
            if (next.done) {
              ended = true;
              return Promise.resolve({ done: true, value: undefined });
            }
            return Promise.resolve(next);
          } catch (error) {
            closed = true;
            try {
              if (!ended) sync?.return?.();
            } catch {
              // Suppress cleanup error in favor of primary error.
            }
            return Promise.reject(error);
          }
        },
        return(): Promise<IteratorResult<item>> {
          if (!closed && !ended) {
            closed = true;
            try {
              sync?.return?.();
            } catch (error) {
              return Promise.reject(error);
            }
          }
          closed = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
  });
  source[async_sync] = factory;
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
  const source: TaggedAsyncFactory<Awaited<item>> = () => ({
    [Symbol.asyncIterator](): AsyncIterator<Awaited<item>> {
      let chunk_iter: AsyncIterator<readonly item[]> | undefined;
      let chunk: readonly item[] | undefined;
      let idx = 0;
      let ended = false;
      let closed = false;
      const close_chunks = async (failed: boolean): Promise<void> => {
        if (closed) return;
        closed = true;
        if (ended || chunk_iter === undefined) return;
        try {
          await chunk_iter.return?.();
        } catch (error) {
          if (!failed) throw error;
        }
      };
      const pull_next_chunk = async (): Promise<
        IteratorResult<Awaited<item>>
      > => {
        try {
          if (chunk_iter === undefined) {
            chunk_iter = factory()[Symbol.asyncIterator]();
          }
          while (chunk === undefined || idx >= chunk.length) {
            const next = await chunk_iter.next();
            if (next.done) {
              ended = true;
              return { done: true, value: undefined };
            }
            chunk = next.value;
            idx = 0;
          }
          const raw = chunk[idx++];
          const value = is_promise_like(raw) ? await raw : raw;
          return { done: false, value: value as Awaited<item> };
        } catch (error) {
          await close_chunks(true);
          throw error;
        }
      };
      return {
        next(): Promise<IteratorResult<Awaited<item>>> {
          if (ended || closed) {
            return Promise.resolve({ done: true, value: undefined });
          }
          if (chunk !== undefined && idx < chunk.length) {
            const raw = chunk[idx++];
            if (is_promise_like(raw)) {
              return Promise.resolve(raw).then(
                (v) => ({ done: false, value: v as Awaited<item> }),
                async (error) => {
                  await close_chunks(true);
                  throw error;
                },
              );
            }
            return Promise.resolve({
              done: false,
              value: raw as Awaited<item>,
            });
          }
          return pull_next_chunk();
        },
        async return(): Promise<IteratorResult<Awaited<item>>> {
          await close_chunks(false);
          return { done: true, value: undefined };
        },
        async throw(error?: unknown): Promise<IteratorResult<Awaited<item>>> {
          await close_chunks(true);
          throw error;
        },
      };
    },
  });
  source[async_chunks] = factory;
  return AsyncIterableT(source);
}

function close_sync_iterator(
  sync: Iterator<unknown>,
  failed: boolean,
): void {
  try {
    sync.return?.();
  } catch (cleanup_error) {
    if (!failed) throw cleanup_error;
  }
}

async function close_stream_reader(
  reader: ReadableStreamDefaultReader<unknown>,
  done: boolean,
  prevent_cancel: boolean,
  failed: boolean,
): Promise<void> {
  try {
    if (!done && !prevent_cancel) {
      try {
        await reader.cancel();
      } catch (cancel_error) {
        if (!failed) throw cancel_error;
      }
    }
  } finally {
    reader.releaseLock();
  }
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

import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "./effects.ts";
import { type AsTask, from_fn } from "./task.ts";
import type { Data } from "./typeclass.ts";

/** A request to map inputs through a module worker in parallel. */
export type ParallelMap<input, output> =
  & Operation<readonly output[]>
  & readonly [
    "parallel.map",
    {
      /** The worker module URL. */
      readonly worker: string;
      /** Inputs sent to the worker pool. */
      readonly inputs: readonly input[];
      /** The requested maximum worker count. */
      readonly workers: number | undefined;
      /** Inputs sent in each worker message. */
      readonly batch_size: number | undefined;
      /** Cancels the map request when aborted. */
      readonly signal: AbortSignal | undefined;
    },
  ];

/** Any parallel-map effect requirement. */
export type Parallel = ParallelMap<unknown, unknown>;

/** Options for creating or temporarily using workers. */
export type ParallelOptions = {
  /** Inputs sent in each worker message; defaults to one. */
  readonly batch_size?: number;
  /** Maximum outstanding map requests; new requests reject at this limit. */
  readonly max_pending_requests?: number;
  /** Maximum admitted input items across active and queued requests. */
  readonly max_pending_items?: number;
  /** Maximum admitted bytes, measured with `input_bytes`. */
  readonly max_pending_bytes?: number;
  /** Estimates retained input bytes; required with max_pending_bytes. */
  readonly input_bytes?: (input: unknown) => number;
  /** Defaults to shared batch metadata when the worker advertises support. */
  readonly protocol?: "legacy" | "range";
  /** Allows cooperative cancellation before replacing an unresponsive worker. */
  readonly abort_grace_ms?: number;
  /** The maximum number of workers to create. */
  readonly workers?: number;
  /** Cancels worker creation or active work when aborted. */
  readonly signal?: AbortSignal;
};

/** Options for one map submitted to an existing worker pool. */
export type WorkerMapOptions<input = unknown> = {
  /** Inputs sent in each worker message; defaults to one. */
  readonly batch_size?: number;
  /** Explicitly transfers ownership of these input buffers to the worker. */
  readonly transfer?: (input: input, index: number) => Transferable[];
  /** Cancels this map request when aborted. */
  readonly signal?: AbortSignal;
};

/** A serializable error reported by a module worker. */
export type WorkerFailure = {
  /** The remote error name, when available. */
  readonly name: string | undefined;
  /** The remote error message. */
  readonly message: string;
  /** The remote stack trace, when available. */
  readonly stack: string | undefined;
};

/** A reusable fixed-size pool for one module worker. */
export type WorkerPool<input, output> = {
  /** The normalized module URL served by this pool. */
  readonly worker: string;
  /** Resolves when every initial worker announces readiness or replies once. */
  readonly ready: Promise<void>;
  /** Maps inputs through the pool and preserves their order. */
  map(
    inputs: readonly input[],
    options?: WorkerMapOptions<input>,
  ): Promise<readonly output[]>;
  /** Lazily submits one bounded window at a time, preserving input order. */
  stream(
    inputs: Iterable<input>,
    options?: WorkerMapOptions<input> & { readonly window_size?: number },
  ): AsyncIterable<output>;
  /** Aborts active work and terminates every worker. */
  close(): void;
  /** Closes the pool when used with explicit resource management. */
  [Symbol.dispose](): void;
};

type WorkerJob<input> = readonly [
  "job",
  {
    readonly batch: number;
    readonly id: number;
    readonly input: input;
  },
];

type WorkerReply<output> =
  | readonly [
    "done",
    { readonly batch: number; readonly id: number; readonly output: output },
  ]
  | readonly [
    "failed",
    {
      readonly batch: number;
      readonly id: number;
      readonly error: WorkerFailure;
    },
  ];

let worker_batch = 0;
const empty_parallel_options: ParallelOptions = {};
const empty_map_options: WorkerMapOptions<unknown> = {};

/** @ignore */
export type WithoutParallel<requirements> = requirements extends Parallel
  ? never
  : requirements;

/** Suspends a parallel map request inside an effect program. */
export function parallel_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions = empty_parallel_options,
): Effect<ParallelMap<input, output>, readonly output[]> {
  return Effect.send<ParallelMap<input, output>>([
    "parallel.map",
    {
      worker: worker_href(worker),
      inputs,
      workers: options.workers,
      batch_size: options.batch_size,
      signal: options.signal,
    },
  ]);
}

/** Creates a deferred Task that maps inputs with temporary workers. */
export function worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions & WorkerMapOptions<input> = empty_parallel_options,
): Data<AsTask, readonly output[]> {
  return from_fn((signal) =>
    run_worker_map<input, output>(
      worker,
      inputs,
      signal === undefined ? options : {
        ...options,
        signal: combine_signals(options.signal, signal),
      },
    )
  );
}

/** Interprets parallel requests as deferred Task lifts. */
export function run_parallel<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<WithoutParallel<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return effect as Effect<WithoutParallel<requirements> | Uses<AsTask>, item>;
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "parallel.map") {
    const [, map] = effect[1] as ParallelMap<unknown, unknown>;
    const map_options = map.workers === undefined &&
        map.batch_size === undefined && map.signal === undefined
      ? empty_parallel_options
      : {
        workers: map.workers,
        batch_size: map.batch_size,
        signal: map.signal,
      };

    return Effect.bind_from(
      worker_map(map.worker, map.inputs, map_options),
      (result) => run_parallel(effect[2](result)),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutParallel<requirements>,
    (value) => run_parallel(effect[2](value)),
  );
}

/** Interprets matching parallel requests with a reusable worker pool. */
export function run_parallel_with_pool<requirements, item>(
  effect: Effect<requirements, item>,
  pool: WorkerPool<unknown, unknown>,
): Effect<WithoutParallel<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return effect as Effect<WithoutParallel<requirements> | Uses<AsTask>, item>;
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "parallel.map") {
    const [, map] = effect[1] as ParallelMap<unknown, unknown>;
    let task: Data<AsTask, readonly unknown[]>;
    if (map.worker === pool.worker) {
      const map_options = map.signal === undefined &&
          map.batch_size === undefined
        ? empty_map_options
        : {
          signal: map.signal,
          batch_size: map.batch_size,
        };
      task = worker_pool_map(pool, map.inputs, map_options);
    } else {
      const map_options = map.workers === undefined &&
          map.batch_size === undefined && map.signal === undefined
        ? empty_parallel_options
        : {
          workers: map.workers,
          batch_size: map.batch_size,
          signal: map.signal,
        };
      task = worker_map(map.worker, map.inputs, map_options);
    }

    return Effect.bind_from(
      task,
      (result) => run_parallel_with_pool(effect[2](result), pool),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutParallel<requirements>,
    (value) => run_parallel_with_pool(effect[2](value), pool),
  );
}

/** Creates a reusable pool for one module worker. */
export function create_worker_pool<input, output>(
  worker: string | URL,
  options: ParallelOptions = empty_parallel_options,
): WorkerPool<input, output> {
  const worker_href_value = worker_href(worker);
  const worker_count = normalize_pool_worker_count(options);
  const protocol_option = options.protocol;
  const default_batch_size = options.batch_size ?? 1;
  const pending_limit = options.max_pending_requests ?? Infinity;
  if (
    pending_limit !== Infinity &&
    (!Number.isInteger(pending_limit) || pending_limit < 1)
  ) {
    throw new RangeError(
      "Worker max_pending_requests must be a positive integer",
    );
  }

  const item_limit = options.max_pending_items ?? Infinity;
  const byte_limit = options.max_pending_bytes ?? Infinity;
  if (
    item_limit !== Infinity &&
    (!Number.isSafeInteger(item_limit) || item_limit < 1)
  ) {
    throw new RangeError(
      "Worker admission limits must be positive safe integers",
    );
  }
  if (
    byte_limit !== Infinity &&
    (!Number.isSafeInteger(byte_limit) || byte_limit < 1)
  ) {
    throw new RangeError(
      "Worker admission limits must be positive safe integers",
    );
  }
  if (byte_limit !== Infinity && options.input_bytes === undefined) {
    throw new TypeError("Worker max_pending_bytes requires input_bytes");
  }
  if (
    options.abort_grace_ms !== undefined &&
    (!Number.isFinite(options.abort_grace_ms) || options.abort_grace_ms < 0)
  ) {
    throw new RangeError(
      "Worker abort_grace_ms must be finite and nonnegative",
    );
  }
  let pending_items = 0;
  let pending_bytes = 0;

  type Request = {
    readonly batch: number;
    readonly bytes: number;
    readonly items: number;
    readonly inputs: readonly input[];
    readonly options: WorkerMapOptions<input>;
    results: output[] | undefined;
    readonly resolve: (value: readonly output[]) => void;
    readonly reject: (error: unknown) => void;
    readonly abort: (() => void) | undefined;
    next: number;
    completed: number;
    settled: boolean;
    active: number;
    released: boolean;
    previous?: Request;
    following?: Request;
  };
  type WorkerSlot = {
    readonly index: number;
    readonly worker: Worker;
    alive: boolean;
    range: boolean;
    range_ok: boolean;
    compact: boolean;
    cooperative: boolean;
    ready: boolean;
    cancellation: ReturnType<typeof setTimeout> | undefined;
    request: Request | undefined;
    start: number;
    count: number;
    range_assigned: boolean;
    compact_assigned: boolean;
  };

  const slots: WorkerSlot[] = new Array(worker_count);
  const idle: WorkerSlot[] = new Array(worker_count);
  try {
    for (let index = 0; index < worker_count; index += 1) {
      const slot: WorkerSlot = {
        index,
        worker: new Worker(worker_href_value, { type: "module" }),
        alive: true,
        range: false,
        range_ok: false,
        compact: false,
        cooperative: false,
        ready: false,
        cancellation: undefined,
        request: undefined,
        start: 0,
        count: 0,
        range_assigned: false,
        compact_assigned: false,
      };
      slots[index] = slot;
      idle[index] = slot;
    }
  } catch (cause) {
    for (let index = 0; index < worker_count; index += 1) {
      slots[index]?.worker.terminate();
    }
    throw new Error(
      `Could not create worker pool for ${worker_href_value} with ${worker_count} workers`,
      { cause },
    );
  }

  const requests = new Set<Request>();
  let ready_request: Request | undefined;
  let closed_reason: Error | undefined;
  let resolve_ready!: () => void;
  let reject_ready!: (error: unknown) => void;
  let ready_count = 0;
  let all_ready = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolve_ready = resolve;
    reject_ready = reject;
  });
  void ready.catch(() => {});
  function mark_ready(slot: WorkerSlot): void {
    if (all_ready || slot.ready) return;
    slot.ready = true;
    ready_count += 1;
    if (ready_count === worker_count) {
      all_ready = true;
      resolve_ready();
    }
  }
  function enqueue(request: Request): void {
    if (ready_request === undefined) {
      request.previous = request;
      request.following = request;
      ready_request = request;
      return;
    }
    const last = ready_request.previous!;
    request.previous = last;
    request.following = ready_request;
    last.following = request;
    ready_request.previous = request;
  }
  function remove_ready(request: Request): void {
    if (request.following === undefined) return;
    if (request.following === request) ready_request = undefined;
    else {
      request.previous!.following = request.following;
      request.following.previous = request.previous;
      if (ready_request === request) ready_request = request.following;
    }
    request.previous = undefined;
    request.following = undefined;
  }
  function release(request: Request): void {
    if (!request.settled || request.active !== 0 || request.released) return;
    request.released = true;
    requests.delete(request);
    pending_items -= request.items;
    pending_bytes -= request.bytes;
  }
  function release_assignment(slot: WorkerSlot): void {
    const request = slot.request;
    if (request === undefined) return;
    slot.request = undefined;
    request.active -= 1;
    release(request);
  }
  function replace_worker(slot: WorkerSlot): void {
    if (!slot.alive) return;
    slot.alive = false;
    if (slot.cancellation !== undefined) {
      clearTimeout(slot.cancellation);
      slot.cancellation = undefined;
    }
    if (!all_ready && slot.ready) ready_count -= 1;
    slot.worker.terminate();
    release_assignment(slot);
    const index = slot.index;
    const replacement: WorkerSlot = {
      index,
      worker: new Worker(worker_href_value, { type: "module" }),
      alive: true,
      range: false,
      range_ok: false,
      compact: false,
      cooperative: false,
      ready: false,
      cancellation: undefined,
      request: undefined,
      start: 0,
      count: 0,
      range_assigned: false,
      compact_assigned: false,
    };
    slots[index] = replacement;
    install(replacement);
    idle.push(replacement);
  }
  function reclaim(request: Request, cooperative = false): void {
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      if (slot.request !== request) continue;
      if (
        cooperative && options.abort_grace_ms !== undefined &&
        slot.cooperative
      ) {
        slot.worker.postMessage(["cancel", request.batch]);
        slot.cancellation = setTimeout(() => {
          if (!slot.alive || closed_reason !== undefined) return;
          try {
            replace_worker(slot);
            dispatch();
          } catch (cause) {
            close_with(error_with_context("Could not replace worker", cause));
          }
        }, options.abort_grace_ms);
      } else {
        replace_worker(slot);
      }
    }
  }
  function settle(request: Request, error?: { readonly cause: unknown }): void {
    if (request.settled) return;
    request.settled = true;
    if (request.abort !== undefined) {
      request.options.signal?.removeEventListener("abort", request.abort);
    }
    release(request);
    remove_ready(request);
    if (error !== undefined) request.reject(error.cause);
    else request.resolve(request.results!);
  }
  function close_with(reason: Error): void {
    if (closed_reason !== undefined) return;
    closed_reason = reason;
    reject_ready(reason);
    for (const request of [...requests]) settle(request, { cause: reason });
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      slot.alive = false;
      if (slot.cancellation !== undefined) {
        clearTimeout(slot.cancellation);
        slot.cancellation = undefined;
      }
      slot.worker.terminate();
      release_assignment(slot);
    }
    options.signal?.removeEventListener("abort", close_from_signal);
  }
  function close(): void {
    close_with(new Error(`Worker pool for ${worker_href_value} is closed`));
  }
  const close_from_signal = () =>
    close_with(
      worker_abort_error(worker_href_value, undefined, options.signal),
    );
  function dispatch(): void {
    if (closed_reason !== undefined) return;
    while (idle.length > 0 && ready_request !== undefined) {
      const slot = idle.pop()!;
      const request = ready_request;
      ready_request = request.following;
      const size = request.options.batch_size ?? default_batch_size;
      const start = request.next;
      const end = start + size < request.items ? start + size : request.items;
      const count = end - start;
      request.next = end;
      if (end === request.items) remove_ready(request);
      let transfer: Transferable[] | undefined;
      try {
        const transfer_fn = request.options.transfer;
        if (transfer_fn !== undefined) {
          for (let id = start; id < end; id += 1) {
            const items = transfer_fn(request.inputs[id], id);
            const item_len = items.length;
            if (item_len > 0) {
              if (transfer === undefined) transfer = [];
              for (let j = 0; j < item_len; j += 1) {
                transfer.push(items[j]);
              }
            }
            if (request.settled || closed_reason !== undefined) break;
          }
        }
        if (closed_reason !== undefined) return;
        if (request.settled) {
          idle.push(slot);
          continue;
        }
        const range = protocol_option === "range" ||
          (protocol_option === undefined && slot.range);
        const compact = count === 1 && protocol_option !== "legacy" &&
          slot.compact;
        slot.request = request;
        slot.start = start;
        slot.count = count;
        slot.range_assigned = range;
        slot.compact_assigned = compact;
        request.active += 1;
        if (count === 1) {
          const msg = compact
            ? ["one", request.batch, start, request.inputs[start]]
            : [
              "job",
              {
                batch: request.batch,
                id: start,
                input: request.inputs[start],
              },
            ];
          if (transfer !== undefined) slot.worker.postMessage(msg, transfer);
          else slot.worker.postMessage(msg);
        } else if (range) {
          const slice = start === 0 && end === request.items &&
              Array.isArray(request.inputs)
            ? request.inputs
            : request.inputs.slice(start, end);
          const msg = [
            slot.range_ok ? "range-compact" : "range",
            request.batch,
            start,
            slice,
          ];
          if (transfer !== undefined) slot.worker.postMessage(msg, transfer);
          else slot.worker.postMessage(msg);
        } else {
          const jobs = new Array<WorkerJob<input>[1]>(count);
          for (let i = 0; i < count; i += 1) {
            const id = start + i;
            jobs[i] = { batch: request.batch, id, input: request.inputs[id] };
          }
          const msg = ["jobs", jobs];
          if (transfer !== undefined) slot.worker.postMessage(msg, transfer);
          else slot.worker.postMessage(msg);
        }
      } catch (cause) {
        release_assignment(slot);
        idle.push(slot);
        settle(request, {
          cause: error_with_context(
            `Could not send input ${start} to ${worker_href_value} in batch ${request.batch}`,
            cause,
          ),
        });
        try {
          reclaim(request);
        } catch (cause) {
          close_with(error_with_context("Could not replace worker", cause));
        }
      }
    }
  }

  function accept(
    request: Request,
    reply: WorkerReply<output>,
    id: number,
  ): void {
    const [tag, payload] = reply;
    if (payload.batch !== request.batch || payload.id !== id) {
      throw new Error("Worker reply does not match its assignment");
    }
    if (request.settled) return;
    switch (tag) {
      case "done": {
        const results = request.results ??
          (request.results = new Array(request.items));
        results[id] = payload.output;
        request.completed += 1;
        break;
      }
      case "failed":
        settle(request, {
          cause: worker_error(payload.error, {
            worker: worker_href_value,
            batch: request.batch,
          }, id),
        });
        reclaim(request);
        break;
    }
  }
  function install(slot: WorkerSlot): void {
    const worker = slot.worker;
    worker.onmessage = (event) => {
      if (closed_reason !== undefined || !slot.alive) return;
      const message = event.data;
      if (Array.isArray(message) && message[0] === "ready") {
        const capabilities = message[1];
        if (capabilities?.range === true) slot.range = true;
        if (capabilities?.range_ok === true) slot.range_ok = true;
        if (capabilities?.compact === true) slot.compact = true;
        if (capabilities?.cooperative === true) slot.cooperative = true;
        if (!all_ready) mark_ready(slot);
        return;
      }
      const request = slot.request;
      try {
        if (request === undefined) {
          throw new Error("Reply without an active assignment");
        }
        if (slot.cancellation !== undefined) {
          if (
            !Array.isArray(message) || message[0] !== "cancelled" ||
            message[1] !== request.batch
          ) return;
          clearTimeout(slot.cancellation);
          slot.cancellation = undefined;
          release_assignment(slot);
          idle.push(slot);
          dispatch();
          return;
        }
        const start = slot.start;
        const count = slot.count;
        const range_assigned = slot.range_assigned;
        const compact_assigned = slot.compact_assigned;
        // Validate the complete envelope before publishing results or releasing
        // this worker.
        if (count === 1) {
          if (compact_assigned) {
            if (
              !Array.isArray(message) || message.length !== 4 ||
              message[1] !== request.batch || message[2] !== start
            ) {
              throw new Error("Invalid compact reply");
            }
            const tag = message[0];
            if (tag === "one-ok") {
              const output = message[3] as output;
              release_assignment(slot);
              if (!request.settled) {
                if (request.items === 1) {
                  request.results = [output];
                  request.completed = 1;
                } else {
                  const results = request.results ??
                    (request.results = new Array(request.items));
                  results[start] = output;
                  request.completed += 1;
                }
              }
            } else if (tag === "one-failed") {
              validate_worker_failure(message[3]);
              const failure = message[3] as WorkerFailure;
              release_assignment(slot);
              if (!request.settled) {
                settle(request, {
                  cause: worker_error(failure, {
                    worker: worker_href_value,
                    batch: request.batch,
                  }, start),
                });
                reclaim(request);
              }
            } else {
              throw new Error("Invalid compact reply");
            }
          } else {
            const reply = parse_worker_reply<output>(message);
            release_assignment(slot);
            accept(request, reply, start);
          }
        } else if (Array.isArray(message) && message[0] === "range-ok") {
          if (
            !range_assigned || message.length !== 4 ||
            message[1] !== request.batch || message[2] !== start ||
            !Array.isArray(message[3]) || message[3].length !== count
          ) {
            throw new Error("Invalid range reply");
          }
          const outputs = message[3] as output[];
          release_assignment(slot);
          if (!request.settled) {
            if (start === 0 && count === request.items) {
              request.results = outputs;
              request.completed = count;
            } else {
              const results = request.results ??
                (request.results = new Array(request.items));
              for (let offset = 0; offset < count; offset += 1) {
                results[start + offset] = outputs[offset];
              }
              request.completed += count;
            }
          }
        } else if (Array.isArray(message) && message[0] === "range-results") {
          if (
            !range_assigned || message.length !== 4 ||
            message[1] !== request.batch || message[2] !== start ||
            !Array.isArray(message[3]) || message[3].length !== count
          ) {
            throw new Error("Invalid range reply");
          }
          const values = message[3];
          for (let offset = 0; offset < count; offset += 1) {
            const entry = values[offset];
            if (
              !Array.isArray(entry) || entry.length !== 2 ||
              (entry[0] !== "done" && entry[0] !== "failed")
            ) {
              throw new Error("Invalid range result");
            }
            if (entry[0] === "failed") {
              validate_worker_failure(entry[1]);
            }
          }
          release_assignment(slot);
          if (!request.settled) {
            const results = request.results ??
              (request.results = new Array(request.items));
            for (let offset = 0; offset < count; offset += 1) {
              const entry = values[offset];
              if (entry[0] === "done") {
                results[start + offset] = entry[1];
                request.completed += 1;
              } else {
                settle(request, {
                  cause: worker_error(entry[1], {
                    worker: worker_href_value,
                    batch: request.batch,
                  }, start + offset),
                });
                reclaim(request);
                break;
              }
            }
          }
        } else {
          if (
            !Array.isArray(message) || message[0] !== "results" ||
            !Array.isArray(message[1]) || message[1].length !== count
          ) {
            throw new Error("Wrong worker reply count");
          }
          const replies = message[1];
          for (let offset = 0; offset < count; offset += 1) {
            const parsed = parse_worker_reply<output>(replies[offset]);
            const payload = parsed[1];
            if (
              payload.batch !== request.batch ||
              payload.id !== start + offset
            ) {
              throw new Error("Worker reply does not match its assignment");
            }
          }
          release_assignment(slot);
          if (!request.settled) {
            const results = request.results ??
              (request.results = new Array(request.items));
            for (let offset = 0; offset < count; offset += 1) {
              const [tag, payload] = replies[offset] as WorkerReply<output>;
              if (tag === "done") {
                results[start + offset] = payload.output;
                request.completed += 1;
              } else {
                settle(request, {
                  cause: worker_error(payload.error, {
                    worker: worker_href_value,
                    batch: request.batch,
                  }, start + offset),
                });
                reclaim(request);
                break;
              }
            }
          }
        }
        if (!all_ready) mark_ready(slot);
        if (!request.settled && request.completed === request.items) {
          settle(request);
        }
        idle.push(slot);
        dispatch();
      } catch (cause) {
        close_with(
          error_with_context(
            `Worker pool for ${worker_href_value} failed in batch ${request?.batch}: invalid reply`,
            cause,
          ),
        );
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (closed_reason !== undefined || !slot.alive) return;
      close_with(
        error_with_context(
          `Worker pool for ${worker_href_value} failed in batch ${slot.request?.batch}: ${event.message}`,
          event.error,
        ),
      );
    };
    worker.onmessageerror = () => {
      if (closed_reason !== undefined || !slot.alive) return;
      close_with(
        new Error(
          `Worker pool for ${worker_href_value} failed: message could not be deserialized`,
        ),
      );
    };
  }
  for (let i = 0; i < slots.length; i += 1) install(slots[i]);
  options.signal?.addEventListener("abort", close_from_signal, { once: true });
  if (options.signal?.aborted) close_from_signal();

  function pool_map(
    inputs: readonly input[],
    map_options: WorkerMapOptions<input> = empty_map_options,
  ): Promise<readonly output[]> {
    if (closed_reason !== undefined) return Promise.reject(closed_reason);
    const size = map_options.batch_size ?? default_batch_size;
    if (!Number.isInteger(size) || size < 1) {
      return Promise.reject(
        new RangeError("Worker batch_size must be a positive integer"),
      );
    }
    const signal = map_options.signal;
    if (signal?.aborted) {
      return Promise.reject(
        worker_abort_error(worker_href_value, undefined, signal),
      );
    }
    const item_count = inputs.length;
    if (item_count === 0) return Promise.resolve([]);
    if (requests.size >= pending_limit) {
      return Promise.reject(
        new RangeError("Worker pool pending request limit reached"),
      );
    }
    if (item_count > item_limit - pending_items) {
      return Promise.reject(
        new RangeError("Worker pool pending item limit reached"),
      );
    }
    let bytes = 0;
    if (byte_limit !== Infinity) {
      try {
        const measure_bytes = options.input_bytes!;
        for (let i = 0; i < item_count; i += 1) {
          const item_bytes = measure_bytes(inputs[i]);
          if (!Number.isSafeInteger(item_bytes) || item_bytes < 0) {
            throw new RangeError(
              "Worker input byte size must be a nonnegative safe integer",
            );
          }
          bytes += item_bytes;
          if (bytes > byte_limit - pending_bytes) {
            throw new RangeError("Worker pool pending byte limit reached");
          }
        }
      } catch (cause) {
        return Promise.reject(cause);
      }
      // Size callbacks may synchronously close the pool or submit other maps.
      if (closed_reason !== undefined) return Promise.reject(closed_reason);
      if (
        requests.size >= pending_limit ||
        item_count > item_limit - pending_items ||
        bytes > byte_limit - pending_bytes
      ) {
        return Promise.reject(
          new RangeError("Worker pool admission limit reached"),
        );
      }
      if (signal?.aborted) {
        return Promise.reject(
          worker_abort_error(worker_href_value, undefined, signal),
        );
      }
    }
    pending_items += item_count;
    pending_bytes += bytes;
    return new Promise<readonly output[]>((resolve, reject) => {
      const request: Request = {
        batch: next_worker_batch(),
        bytes,
        items: item_count,
        inputs,
        options: map_options,
        results: undefined,
        resolve,
        reject,
        abort: undefined,
        next: 0,
        completed: 0,
        settled: false,
        active: 0,
        released: false,
      };
      if (signal !== undefined) {
        const on_abort = () => {
          settle(request, {
            cause: worker_abort_error(
              worker_href_value,
              request.batch,
              signal,
            ),
          });
          try {
            reclaim(request, true);
          } catch (cause) {
            close_with(error_with_context("Could not replace worker", cause));
          }
          dispatch();
        };
        (request as { abort: (() => void) | undefined }).abort = on_abort;
        signal.addEventListener("abort", on_abort, { once: true });
      }
      requests.add(request);
      enqueue(request);
      dispatch();
    });
  }

  return {
    worker: worker_href_value,
    ready,
    map: pool_map,
    stream(inputs, stream_options) {
      const opts: WorkerMapOptions<input> & { readonly window_size?: number } =
        stream_options ?? empty_map_options;
      const window_size = opts.window_size ??
        worker_count * (opts.batch_size ?? default_batch_size);
      const is_plain_array = Array.isArray(inputs) &&
        inputs[Symbol.iterator] === Array.prototype[Symbol.iterator];
      let started = false;
      let finished = false;
      let exhausted = false;
      let iterator: Iterator<input> | undefined;
      let array_offset = 0;
      let buffer: readonly output[] | undefined;
      let buf_index = 0;
      let buf_len = 0;

      const close_source_once = (): void => {
        if (exhausted) return;
        exhausted = true;
        if (iterator !== undefined) {
          iterator.return?.();
        }
      };

      const fail_with_cleanup = (error: unknown): never => {
        finished = true;
        buffer = undefined;
        buf_index = 0;
        buf_len = 0;
        if (!exhausted && iterator !== undefined) {
          exhausted = true;
          try {
            iterator.return?.();
          } catch (cleanup_error) {
            throw new AggregateError(
              [error, cleanup_error],
              "Worker stream and iterator cleanup both failed",
            );
          }
        }
        throw error;
      };

      const fetch_next_window = async (): Promise<
        IteratorResult<output, void>
      > => {
        if (!started) {
          started = true;
          if (!Number.isSafeInteger(window_size) || window_size < 1) {
            finished = true;
            throw new RangeError(
              "Worker window_size must be a positive safe integer",
            );
          }
          if (closed_reason !== undefined) {
            finished = true;
            throw closed_reason;
          }
          if (opts.signal?.aborted) {
            finished = true;
            throw worker_abort_error(
              worker_href_value,
              undefined,
              opts.signal,
            );
          }
          if (!is_plain_array) {
            iterator = inputs[Symbol.iterator]();
          }
        }

        if (is_plain_array) {
          const arr = inputs as readonly input[];
          if (array_offset >= arr.length) {
            finished = true;
            exhausted = true;
            return { value: undefined, done: true };
          }
          if (closed_reason !== undefined) {
            finished = true;
            throw closed_reason;
          }
          if (opts.signal?.aborted) {
            finished = true;
            throw worker_abort_error(
              worker_href_value,
              undefined,
              opts.signal,
            );
          }
          const end = array_offset + window_size;
          const slice = array_offset === 0 && end >= arr.length
            ? arr
            : arr.slice(array_offset, end);
          array_offset = end;
          if (array_offset >= arr.length) exhausted = true;
          try {
            const mapped = await pool_map(slice, opts);
            if (mapped.length > 1) {
              buffer = mapped;
              buf_len = mapped.length;
              buf_index = 1;
            }
            return { value: mapped[0], done: false };
          } catch (error) {
            finished = true;
            throw error;
          }
        }

        if (exhausted) {
          finished = true;
          return { value: undefined, done: true };
        }
        let window: input[];
        try {
          window = [];
          while (window.length < window_size) {
            if (closed_reason !== undefined) throw closed_reason;
            if (opts.signal?.aborted) {
              throw worker_abort_error(
                worker_href_value,
                undefined,
                opts.signal,
              );
            }
            const step = iterator!.next();
            if (step.done) {
              exhausted = true;
              break;
            }
            window.push(step.value);
          }
        } catch (error) {
          fail_with_cleanup(error);
        }
        if (window!.length === 0) {
          finished = true;
          return { value: undefined, done: true };
        }
        try {
          const mapped = await pool_map(window!, opts);
          if (mapped.length > 1) {
            buffer = mapped;
            buf_len = mapped.length;
            buf_index = 1;
          }
          return { value: mapped[0], done: false };
        } catch (error) {
          fail_with_cleanup(error);
        }
        return { value: undefined, done: true };
      };

      let pending_op: Promise<unknown> | undefined;
      const run_serialized = <result>(
        op: () => Promise<result>,
      ): Promise<result> => {
        const prev = pending_op;
        const next_promise = prev === undefined ? op() : prev.then(op, op);
        pending_op = next_promise;
        void next_promise.then(
          () => {
            if (pending_op === next_promise) pending_op = undefined;
          },
          () => {
            if (pending_op === next_promise) pending_op = undefined;
          },
        );
        return next_promise;
      };

      const step_next = (): Promise<IteratorResult<output, void>> => {
        if (buf_index < buf_len) {
          const value = buffer![buf_index++];
          if (buf_index === buf_len) {
            buffer = undefined;
            buf_index = 0;
            buf_len = 0;
          }
          return Promise.resolve({ value, done: false });
        }
        if (finished) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return fetch_next_window();
      };

      const async_iter: AsyncIterableIterator<output> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<output, void>> {
          if (pending_op === undefined && buf_index < buf_len) {
            const value = buffer![buf_index++];
            if (buf_index === buf_len) {
              buffer = undefined;
              buf_index = 0;
              buf_len = 0;
            }
            return Promise.resolve({ value, done: false });
          }
          if (pending_op === undefined && finished) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return run_serialized(step_next);
        },
        return(value?: unknown): Promise<IteratorResult<output, void>> {
          return run_serialized(() => {
            finished = true;
            buffer = undefined;
            buf_index = 0;
            buf_len = 0;
            try {
              close_source_once();
              return Promise.resolve({ value: value as void, done: true });
            } catch (error) {
              return Promise.reject(error);
            }
          });
        },
        throw(error?: unknown): Promise<IteratorResult<output, void>> {
          return run_serialized(() => {
            finished = true;
            buffer = undefined;
            buf_index = 0;
            buf_len = 0;
            try {
              close_source_once();
              return Promise.reject(error);
            } catch (cleanup_error) {
              return Promise.reject(
                new AggregateError(
                  [error, cleanup_error],
                  "Worker stream and iterator cleanup both failed",
                ),
              );
            }
          });
        },
      };
      return async_iter;
    },
    close,
    [Symbol.dispose]: close,
  };
}

/** Creates a pool, passes it to `use`, and always closes it afterward. */
export async function with_worker_pool<input, output, item>(
  worker: string | URL,
  use: (pool: WorkerPool<input, output>) => item | Promise<item>,
  options: ParallelOptions = empty_parallel_options,
): Promise<item> {
  using pool = create_worker_pool<input, output>(worker, options);

  return await use(pool);
}

/** Creates a deferred Task that submits inputs to an existing pool. */
export function worker_pool_map<input, output>(
  pool: WorkerPool<input, output>,
  inputs: readonly input[],
  options: WorkerMapOptions<input> = empty_map_options,
): Data<AsTask, readonly output[]> {
  return from_fn((signal) =>
    pool.map(
      inputs,
      signal === undefined ? options : {
        ...options,
        signal: combine_signals(options.signal, signal),
      },
    )
  );
}

/** Maps inputs with temporary workers and terminates them afterward. */
export async function run_worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions & WorkerMapOptions<input> = empty_parallel_options,
): Promise<readonly output[]> {
  if (options.signal?.aborted) {
    throw worker_abort_error(worker_href(worker), undefined, options.signal);
  }
  if (inputs.length === 0) return [];
  using pool = create_worker_pool<input, output>(worker, {
    ...options,
    workers: normalize_worker_count(options.workers, inputs.length),
  });
  return await pool.map(inputs, options);
}

type WorkerRun = { readonly worker: string; readonly batch: number };

/** Installs the worker protocol, optionally transferring output buffers. */
export function serve_worker<input, output>(
  handler: (input: input, signal: AbortSignal) => output | Promise<output>,
  options: {
    readonly transfer?: (output: output) => Transferable[];
    /** Independent asynchronous jobs per message; defaults to one. */
    readonly concurrency?: number;
    /** Enables abort signals and cancellation acknowledgements. */
    readonly cooperative?: boolean;
  } = {},
): void {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Worker concurrency must be a positive integer");
  }
  const transfer_fn = options.transfer;
  const cooperative = options.cooperative === true;
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<unknown[]>) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  const active = new Map<number, AbortController>();
  const never_aborted = new AbortController().signal;
  const post = (message: unknown, transfers: Transferable[] | undefined) => {
    if (transfers !== undefined && transfers.length > 0) {
      scope.postMessage(message, transfers);
    } else {
      scope.postMessage(message);
    }
  };
  scope.onmessage = (event) => {
    const data = event.data;
    const tag = data[0];
    if (tag === "cancel") {
      const batch_id = data[1] as number;
      const controller = active.get(batch_id);
      if (controller !== undefined) controller.abort();
      else if (cooperative) {
        scope.postMessage(["cancelled", batch_id]);
      }
      return;
    }

    if (tag === "one") {
      const batch = data[1] as number;
      const start = data[2] as number;
      const input = data[3] as input;
      let controller: AbortController | undefined;
      let signal = never_aborted;
      if (cooperative) {
        controller = new AbortController();
        signal = controller.signal;
        active.set(batch, controller);
      }
      try {
        const pending = handler(input, signal);
        if (
          ((typeof pending === "object" && pending !== null) ||
            typeof pending === "function") &&
          typeof (pending as PromiseLike<output>).then === "function"
        ) {
          void (async () => {
            let reply: unknown;
            let transfers: Transferable[] | undefined;
            try {
              const output = await (pending as PromiseLike<output>);
              if (transfer_fn !== undefined) {
                const list = transfer_fn(output);
                if (list.length > 0) transfers = list;
              }
              reply = ["one-ok", batch, start, output];
            } catch (error) {
              reply = ["one-failed", batch, start, serialize_error(error)];
            }
            if (controller !== undefined) active.delete(batch);
            if (signal.aborted) scope.postMessage(["cancelled", batch]);
            else post(reply, transfers);
          })();
          return;
        }
        const output = pending as output;
        let transfers: Transferable[] | undefined;
        if (transfer_fn !== undefined) {
          const list = transfer_fn(output);
          if (list.length > 0) transfers = list;
        }
        if (controller !== undefined) active.delete(batch);
        if (signal.aborted) scope.postMessage(["cancelled", batch]);
        else post(["one-ok", batch, start, output], transfers);
      } catch (error) {
        if (controller !== undefined) active.delete(batch);
        if (signal.aborted) scope.postMessage(["cancelled", batch]);
        else {
          scope.postMessage([
            "one-failed",
            batch,
            start,
            serialize_error(error),
          ]);
        }
      }
      return;
    }

    let batch: number;
    let start = 0;
    let count = 1;
    let jobs: WorkerJob<input>[1][] | undefined;
    let inputs: input[] | undefined;
    let single: WorkerJob<input>[1] | undefined;
    switch (tag) {
      case "range":
      case "range-compact":
        batch = data[1] as number;
        start = data[2] as number;
        inputs = data[3] as input[];
        count = inputs.length;
        break;
      case "jobs":
        jobs = data[1] as WorkerJob<input>[1][];
        batch = jobs[0].batch;
        count = jobs.length;
        break;
      case "job":
        single = data[1] as WorkerJob<input>[1];
        batch = single.batch;
        break;
      default:
        throw new TypeError("Unknown worker request");
    }

    let controller: AbortController | undefined;
    let signal = never_aborted;
    if (cooperative) {
      controller = new AbortController();
      signal = controller.signal;
      active.set(batch, controller);
    }

    let transfers: Transferable[] | undefined;
    const collect_transfers = (output: output) => {
      const list = transfer_fn!(output);
      const len = list.length;
      if (len === 0) return;
      if (transfers === undefined) transfers = [];
      for (let i = 0; i < len; i += 1) {
        transfers.push(list[i]);
      }
    };

    const is_range = tag === "range" || tag === "range-compact";
    const range_compact = tag === "range-compact";
    if (concurrency === 1) {
      if (is_range) {
        const outputs = new Array<unknown>(count);
        let failed = false;
        let replies: unknown[] | undefined;
        const finish_range = () => {
          if (controller !== undefined) active.delete(batch);
          if (signal.aborted) scope.postMessage(["cancelled", batch]);
          else if (failed) {
            post(["range-results", batch, start, replies], transfers);
          } else if (range_compact) {
            post(["range-ok", batch, start, outputs], transfers);
          } else {
            const wrapped = new Array<unknown>(count);
            for (let j = 0; j < count; j += 1) {
              wrapped[j] = ["done", outputs[j]];
            }
            post(["range-results", batch, start, wrapped], transfers);
          }
        };
        const promote_failed = (
          up_to: number,
          index: number,
          error: unknown,
        ) => {
          if (!failed) {
            failed = true;
            replies = new Array<unknown>(count);
            for (let j = 0; j < up_to; j += 1) {
              replies[j] = ["done", outputs[j]];
            }
          }
          replies![index] = ["failed", serialize_error(error)];
        };
        for (let index = 0; index < count && !signal.aborted; index += 1) {
          try {
            const pending = handler(inputs![index], signal);
            if (
              ((typeof pending === "object" && pending !== null) ||
                typeof pending === "function") &&
              typeof (pending as PromiseLike<output>).then === "function"
            ) {
              void (async () => {
                let first_pending: unknown = pending;
                for (let i = index; i < count && !signal.aborted; i += 1) {
                  try {
                    const p = i === index
                      ? first_pending
                      : handler(inputs![i], signal);
                    first_pending = undefined;
                    let output: output;
                    if (
                      ((typeof p === "object" && p !== null) ||
                        typeof p === "function") &&
                      typeof (p as PromiseLike<output>).then === "function"
                    ) {
                      output = await (p as PromiseLike<output>);
                    } else {
                      output = p as output;
                    }
                    if (transfer_fn !== undefined) collect_transfers(output);
                    if (failed) replies![i] = ["done", output];
                    else outputs[i] = output;
                  } catch (error) {
                    promote_failed(i, i, error);
                  }
                }
                finish_range();
              })();
              return;
            }
            const output = pending as output;
            if (transfer_fn !== undefined) collect_transfers(output);
            if (failed) replies![index] = ["done", output];
            else outputs[index] = output;
          } catch (error) {
            promote_failed(index, index, error);
          }
        }
        finish_range();
        return;
      }

      if (tag === "job") {
        const id = single!.id;
        try {
          const pending = handler(single!.input, signal);
          if (
            ((typeof pending === "object" && pending !== null) ||
              typeof pending === "function") &&
            typeof (pending as PromiseLike<output>).then === "function"
          ) {
            void (async () => {
              let single_reply: unknown;
              try {
                const output = await (pending as PromiseLike<output>);
                if (transfer_fn !== undefined) collect_transfers(output);
                single_reply = ["done", { batch, id, output }];
              } catch (error) {
                single_reply = [
                  "failed",
                  { batch, id, error: serialize_error(error) },
                ];
              }
              if (controller !== undefined) active.delete(batch);
              if (signal.aborted) scope.postMessage(["cancelled", batch]);
              else post(single_reply, transfers);
            })();
            return;
          }
          const output = pending as output;
          if (transfer_fn !== undefined) collect_transfers(output);
          if (controller !== undefined) active.delete(batch);
          if (signal.aborted) scope.postMessage(["cancelled", batch]);
          else post(["done", { batch, id, output }], transfers);
        } catch (error) {
          if (controller !== undefined) active.delete(batch);
          if (signal.aborted) scope.postMessage(["cancelled", batch]);
          else {
            scope.postMessage([
              "failed",
              { batch, id, error: serialize_error(error) },
            ]);
          }
        }
        return;
      }

      const replies = new Array<unknown>(count);
      const finish_jobs = () => {
        if (controller !== undefined) active.delete(batch);
        if (signal.aborted) scope.postMessage(["cancelled", batch]);
        else post(["results", replies], transfers);
      };
      for (let index = 0; index < count && !signal.aborted; index += 1) {
        const job = jobs![index];
        const id = job.id;
        try {
          const pending = handler(job.input, signal);
          if (
            ((typeof pending === "object" && pending !== null) ||
              typeof pending === "function") &&
            typeof (pending as PromiseLike<output>).then === "function"
          ) {
            void (async () => {
              let first_pending: unknown = pending;
              for (let i = index; i < count && !signal.aborted; i += 1) {
                const cur_job = jobs![i];
                const cur_id = cur_job.id;
                try {
                  const p = i === index
                    ? first_pending
                    : handler(cur_job.input, signal);
                  first_pending = undefined;
                  let output: output;
                  if (
                    ((typeof p === "object" && p !== null) ||
                      typeof p === "function") &&
                    typeof (p as PromiseLike<output>).then === "function"
                  ) {
                    output = await (p as PromiseLike<output>);
                  } else {
                    output = p as output;
                  }
                  if (transfer_fn !== undefined) collect_transfers(output);
                  replies[i] = ["done", { batch, id: cur_id, output }];
                } catch (error) {
                  replies[i] = [
                    "failed",
                    { batch, id: cur_id, error: serialize_error(error) },
                  ];
                }
              }
              finish_jobs();
            })();
            return;
          }
          const output = pending as output;
          if (transfer_fn !== undefined) collect_transfers(output);
          replies[index] = ["done", { batch, id, output }];
        } catch (error) {
          replies[index] = [
            "failed",
            { batch, id, error: serialize_error(error) },
          ];
        }
      }
      finish_jobs();
      return;
    }

    const replies = tag === "job" ? undefined : new Array<unknown>(count);
    const range_outputs = is_range ? new Array<unknown>(count) : undefined;
    let range_failed = false;
    let single_reply: unknown;
    let next = 0;
    const run = async (): Promise<void> => {
      while (next < count && !signal.aborted) {
        const index = next++;
        let id = start + index;
        let input: input;
        if (inputs !== undefined) input = inputs[index];
        else {
          let job = single!;
          if (jobs !== undefined) job = jobs[index];
          id = job.id;
          input = job.input;
        }
        try {
          const pending = handler(input, signal);
          let output: output;
          if (
            ((typeof pending === "object" && pending !== null) ||
              typeof pending === "function") &&
            typeof (pending as PromiseLike<output>).then === "function"
          ) {
            output = await (pending as PromiseLike<output>);
          } else {
            output = pending as output;
          }
          if (transfer_fn !== undefined) collect_transfers(output);
          if (is_range) {
            if (range_failed) replies![index] = ["done", output];
            else range_outputs![index] = output;
          } else if (replies === undefined) {
            single_reply = ["done", { batch, id, output }];
          } else {
            replies[index] = ["done", { batch, id, output }];
          }
        } catch (error) {
          const failure = serialize_error(error);
          if (is_range) {
            range_failed = true;
            replies![index] = ["failed", failure];
          } else if (replies === undefined) {
            single_reply = ["failed", { batch, id, error: failure }];
          } else {
            replies[index] = ["failed", { batch, id, error: failure }];
          }
        }
      }
    };
    const worker_limit = concurrency < count ? concurrency : count;
    const pending_runs = new Array<Promise<void>>(worker_limit);
    for (let index = 0; index < worker_limit; index += 1) {
      pending_runs[index] = run();
    }
    void Promise.all(pending_runs).then(() => {
      if (controller !== undefined) active.delete(batch);
      if (signal.aborted) {
        scope.postMessage(["cancelled", batch]);
      } else if (tag === "job") {
        post(single_reply, transfers);
      } else if (is_range) {
        if (range_failed || !range_compact) {
          for (let i = 0; i < count; i += 1) {
            if (replies![i] === undefined) {
              replies![i] = ["done", range_outputs![i]];
            }
          }
          post(["range-results", batch, start, replies], transfers);
        } else {
          post(["range-ok", batch, start, range_outputs], transfers);
        }
      } else {
        post(["results", replies], transfers);
      }
    });
  };
  scope.postMessage([
    "ready",
    {
      range: true,
      range_ok: true,
      compact: true,
      cooperative,
    },
  ]);
}

function normalize_worker_count(
  requested: number | undefined,
  input_count: number,
): number {
  let count = requested;

  if (count === undefined) {
    count = default_worker_count();
  }

  if (!Number.isFinite(count)) {
    count = 1;
  }

  count = Math.trunc(count);

  if (count < 1) {
    count = 1;
  }

  if (count > input_count) {
    count = input_count;
  }

  return count;
}

function normalize_pool_worker_count(options: ParallelOptions): number {
  let count = options.workers;

  if (count === undefined) {
    count = default_worker_count();
  }

  if (!Number.isFinite(count)) {
    count = 1;
  }

  count = Math.trunc(count);

  if (count < 1) {
    count = 1;
  }

  return count;
}

function default_worker_count(): number {
  const concurrency = navigator.hardwareConcurrency;

  if (typeof concurrency !== "number") {
    return 1;
  }

  if (!Number.isFinite(concurrency)) {
    return 1;
  }

  return Math.max(1, concurrency);
}

function worker_href(worker: string | URL): string {
  if (typeof worker === "string") {
    return worker;
  }

  return worker.href;
}

function worker_error(
  error: WorkerFailure,
  run: WorkerRun,
  input: number,
): Error {
  const value = new Error(
    `Worker ${run.worker} failed in batch ${run.batch} for input ${input}: ${error.message}`,
  );
  value.name = error.name ?? "WorkerError";

  if (error.stack !== undefined && value.stack !== undefined) {
    value.stack += "\nRemote worker stack:\n" + error.stack;
  }

  return value;
}

function validate_worker_failure(error: unknown): void {
  if (typeof error !== "object" || error === null) {
    throw new TypeError("Worker failed reply is missing its error payload");
  }

  const failure = error as Record<string, unknown>;

  if (typeof failure.message !== "string") {
    throw new TypeError("Worker failed reply has no error message");
  }

  if (failure.name !== undefined && typeof failure.name !== "string") {
    throw new TypeError("Worker failed reply has an invalid error name");
  }

  if (failure.stack !== undefined && typeof failure.stack !== "string") {
    throw new TypeError("Worker failed reply has an invalid error stack");
  }
}

function parse_worker_reply<output>(value: unknown): WorkerReply<output> {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError("Worker reply must be a tagged pair");
  }

  const [tag, payload] = value;

  if (tag !== "done" && tag !== "failed") {
    throw new TypeError(`Worker reply has unknown tag ${String(tag)}`);
  }

  if (typeof payload !== "object" || payload === null) {
    throw new TypeError(`Worker ${tag} reply must have an object payload`);
  }

  const reply = payload as Record<string, unknown>;

  if (!is_job_number(reply.batch)) {
    throw new TypeError(
      `Worker ${tag} reply has invalid batch ${String(reply.batch)}`,
    );
  }

  if (!is_job_number(reply.id)) {
    throw new TypeError(
      `Worker ${tag} reply has invalid input id ${String(reply.id)}`,
    );
  }

  if (tag === "done") {
    if (!("output" in reply)) {
      throw new TypeError("Worker done reply is missing output");
    }

    return value as unknown as WorkerReply<output>;
  }

  validate_worker_failure(reply.error);

  return value as unknown as WorkerReply<output>;
}

function is_job_number(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function next_worker_batch(): number {
  const batch = worker_batch;
  worker_batch += 1;

  if (!Number.isSafeInteger(worker_batch)) {
    worker_batch = 0;
  }

  return batch;
}

function combine_signals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return AbortSignal.any([first, second]);
}

function worker_abort_error(
  worker: string,
  batch: number | undefined,
  signal: AbortSignal | undefined,
): Error {
  let message = `Worker map for ${worker}`;

  if (batch !== undefined) {
    message += ` in batch ${batch}`;
  }

  message += " was aborted";
  const reason = signal?.reason;

  if (reason instanceof Error) {
    message += `: ${reason.message}`;
  } else if (reason !== undefined) {
    message += `: ${String(reason)}`;
  }

  const error = new Error(message, { cause: reason });
  error.name = "AbortError";

  return error;
}

function error_with_context(context: string, cause: unknown): Error {
  let evidence = String(cause);
  if (cause instanceof Error) evidence = cause.message;
  const error = new Error(`${context}: ${evidence}`, { cause });

  if (cause instanceof Error) {
    error.name = cause.name;
  }

  return error;
}

function serialize_error(error: unknown): WorkerFailure {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: undefined,
    message: String(error),
    stack: undefined,
  };
}

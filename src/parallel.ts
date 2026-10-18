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

/** @ignore */
export type WithoutParallel<requirements> = requirements extends Parallel
  ? never
  : requirements;

/** Suspends a parallel map request inside an effect program. */
export function parallel_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions = {},
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
  options: ParallelOptions & WorkerMapOptions<input> = {},
): Data<AsTask, readonly output[]> {
  return from_fn((signal) =>
    run_worker_map<input, output>(worker, inputs, {
      ...options,
      signal: combine_signals(options.signal, signal),
    })
  );
}

/** Interprets parallel requests as deferred Task lifts. */
export function run_parallel<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<WithoutParallel<requirements> | Uses<AsTask>, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "parallel.map") {
    const [, map] = effect[1] as ParallelMap<unknown, unknown>;

    return Effect.bind(
      Effect.lift(
        worker_map(map.worker, map.inputs, {
          workers: map.workers,
          batch_size: map.batch_size,
          signal: map.signal,
        }),
      ),
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
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "parallel.map") {
    const [, map] = effect[1] as ParallelMap<unknown, unknown>;
    let task: Data<AsTask, readonly unknown[]>;
    if (map.worker === pool.worker) {
      task = worker_pool_map(pool, map.inputs, {
        signal: map.signal,
        batch_size: map.batch_size,
      });
    } else {
      task = worker_map(map.worker, map.inputs, {
        workers: map.workers,
        batch_size: map.batch_size,
        signal: map.signal,
      });
    }

    return Effect.bind(
      Effect.lift(task),
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
  options: ParallelOptions = {},
): WorkerPool<input, output> {
  const worker_href_value = worker_href(worker);
  const worker_count = normalize_pool_worker_count(options);
  const workers: Worker[] = [];
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
  for (const limit of [item_limit, byte_limit]) {
    if (limit !== Infinity && (!Number.isSafeInteger(limit) || limit < 1)) {
      throw new RangeError(
        "Worker admission limits must be positive safe integers",
      );
    }
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
  const cancellations = new Map<Worker, ReturnType<typeof setTimeout>>();

  try {
    for (let index = 0; index < worker_count; index += 1) {
      workers.push(new Worker(worker_href_value, { type: "module" }));
    }
  } catch (cause) {
    close_workers(workers);
    throw new Error(
      `Could not create worker pool for ${worker_href_value} with ${worker_count} workers`,
      { cause },
    );
  }

  type Request = {
    readonly batch: number;
    readonly bytes: number;
    readonly items: number;
    readonly inputs: readonly input[];
    readonly options: WorkerMapOptions<input>;
    readonly results: output[];
    readonly resolve: (value: readonly output[]) => void;
    readonly reject: (error: unknown) => void;
    readonly abort: () => void;
    next: number;
    completed: number;
    settled: boolean;
    active: number;
    released: boolean;
    previous?: Request;
    following?: Request;
  };
  type Assignment = {
    readonly request: Request;
    readonly start: number;
    readonly count: number;
    readonly range: boolean;
  };
  const requests = new Set<Request>();
  const assignments = new Map<Worker, Assignment>();
  const idle = [...workers];
  const worker_members = new Set(workers);
  const range_workers = new Set<Worker>();
  const cooperative_workers = new Set<Worker>();
  let ready_request: Request | undefined;
  let closed_reason: Error | undefined;
  let resolve_ready!: () => void;
  let reject_ready!: (error: unknown) => void;
  const ready_workers = new Set<Worker>();
  const ready = new Promise<void>((resolve, reject) => {
    resolve_ready = resolve;
    reject_ready = reject;
  });
  void ready.catch(() => {});
  function mark_ready(worker: Worker): void {
    ready_workers.add(worker);
    if (ready_workers.size === worker_count) resolve_ready();
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
  function release_assignment(worker: Worker): void {
    const assignment = assignments.get(worker);
    if (assignment === undefined) return;
    assignments.delete(worker);
    assignment.request.active -= 1;
    release(assignment.request);
  }
  function replace_worker(worker: Worker): void {
    const timer = cancellations.get(worker);
    if (timer !== undefined) clearTimeout(timer);
    cancellations.delete(worker);
    worker.terminate();
    release_assignment(worker);
    worker_members.delete(worker);
    range_workers.delete(worker);
    cooperative_workers.delete(worker);
    ready_workers.delete(worker);
    const index = workers.indexOf(worker);
    const replacement = new Worker(worker_href_value, { type: "module" });
    workers[index] = replacement;
    worker_members.add(replacement);
    install(replacement);
    idle.push(replacement);
  }
  function reclaim(request: Request, cooperative = false): void {
    for (const [worker, assignment] of assignments) {
      if (assignment.request !== request) continue;
      if (
        cooperative && options.abort_grace_ms !== undefined &&
        cooperative_workers.has(worker)
      ) {
        worker.postMessage(["cancel", request.batch]);
        const timer = setTimeout(() => {
          try {
            replace_worker(worker);
            dispatch();
          } catch (cause) {
            close_with(error_with_context("Could not replace worker", cause));
          }
        }, options.abort_grace_ms);
        cancellations.set(worker, timer);
      } else replace_worker(worker);
    }
  }
  function settle(request: Request, error?: { readonly cause: unknown }): void {
    if (request.settled) return;
    request.settled = true;
    request.options.signal?.removeEventListener("abort", request.abort);
    release(request);
    remove_ready(request);
    if (error !== undefined) request.reject(error.cause);
    else request.resolve(request.results);
  }
  function close_with(reason: Error): void {
    if (closed_reason !== undefined) return;
    closed_reason = reason;
    reject_ready(reason);
    for (const request of [...requests]) settle(request, { cause: reason });
    close_workers(workers);
    for (const worker of assignments.keys()) release_assignment(worker);
    for (const timer of cancellations.values()) clearTimeout(timer);
    cancellations.clear();
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
      const worker = idle.pop()!;
      const request = ready_request;
      ready_request = request.following;
      const size = request.options.batch_size ?? options.batch_size ?? 1;
      const start = request.next;
      const end = Math.min(start + size, request.items);
      request.next = end;
      if (end === request.items) remove_ready(request);
      const transfer: Transferable[] = [];
      try {
        if (request.options.transfer !== undefined) {
          for (let id = start; id < end; id += 1) {
            for (
              const item of request.options.transfer(request.inputs[id], id)
            ) {
              transfer.push(item);
            }
            if (request.settled || closed_reason !== undefined) break;
          }
        }
        if (closed_reason !== undefined) return;
        if (request.settled) {
          idle.push(worker);
          continue;
        }
        const range = options.protocol === "range" ||
          (options.protocol === undefined && range_workers.has(worker));
        assignments.set(worker, { request, start, count: end - start, range });
        request.active += 1;
        if (range && end - start > 1) {
          worker.postMessage([
            "range",
            request.batch,
            start,
            request.inputs.slice(start, end),
          ], transfer);
        } else if (end - start === 1) {
          worker.postMessage(["job", {
            batch: request.batch,
            id: start,
            input: request.inputs[start],
          }], transfer);
        } else {
          const jobs: WorkerJob<input>[1][] = [];
          for (let id = start; id < end; id += 1) {
            jobs.push({ batch: request.batch, id, input: request.inputs[id] });
          }
          worker.postMessage(["jobs", jobs], transfer);
        }
      } catch (cause) {
        release_assignment(worker);
        idle.push(worker);
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
      case "done":
        request.results[id] = payload.output;
        request.completed += 1;
        break;
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
  function install(worker: Worker): void {
    worker.onmessage = (event) => {
      if (closed_reason !== undefined || !worker_members.has(worker)) return;
      if (Array.isArray(event.data) && event.data[0] === "ready") {
        const capabilities = event.data[1];
        if (capabilities?.range === true) range_workers.add(worker);
        if (capabilities?.cooperative === true) cooperative_workers.add(worker);
        mark_ready(worker);
        return;
      }
      const assignment = assignments.get(worker);
      try {
        if (assignment === undefined) {
          throw new Error("Reply without an active assignment");
        }
        const message = event.data;
        if (cancellations.has(worker)) {
          if (
            !Array.isArray(message) || message[0] !== "cancelled" ||
            message[1] !== assignment.request.batch
          ) return;
          clearTimeout(cancellations.get(worker));
          cancellations.delete(worker);
          release_assignment(worker);
          idle.push(worker);
          dispatch();
          return;
        }
        const { request, start, count } = assignment;
        // Validate the complete envelope before publishing results or releasing
        // this worker. Single replies avoid wrapper and parsed-reply arrays.
        if (count === 1) {
          const reply = parse_worker_reply<output>(message);
          release_assignment(worker);
          accept(request, reply, start);
        } else if (Array.isArray(message) && message[0] === "range-results") {
          if (
            !assignment.range || message[1] !== request.batch ||
            message[2] !== start || !Array.isArray(message[3]) ||
            message[3].length !== count
          ) throw new Error("Invalid range reply");
          const values = message[3];
          for (const entry of values) {
            if (
              !Array.isArray(entry) || entry.length !== 2 ||
              (entry[0] !== "done" && entry[0] !== "failed")
            ) {
              throw new Error("Invalid range result");
            }
            if (entry[0] === "failed") {
              parse_worker_reply(["failed", {
                batch: request.batch,
                id: start,
                error: entry[1],
              }]);
            }
          }
          release_assignment(worker);
          for (let offset = 0; offset < count; offset += 1) {
            const entry = values[offset];
            if (entry[0] === "done") {
              if (!request.settled) {
                request.results[start + offset] = entry[1];
                request.completed += 1;
              }
            } else {
              accept(request, ["failed", {
                batch: request.batch,
                id: start + offset,
                error: entry[1],
              }], start + offset);
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
            parse_worker_reply<output>(replies[offset]);
          }
          release_assignment(worker);
          for (let offset = 0; offset < count; offset += 1) {
            accept(request, replies[offset], start + offset);
          }
        }
        mark_ready(worker);
        if (!request.settled && request.completed === request.items) {
          settle(request);
        }
        idle.push(worker);
        dispatch();
      } catch (cause) {
        close_with(
          error_with_context(
            `Worker pool for ${worker_href_value} failed in batch ${assignment?.request.batch}: invalid reply`,
            cause,
          ),
        );
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (closed_reason !== undefined || !worker_members.has(worker)) return;
      close_with(
        error_with_context(
          `Worker pool for ${worker_href_value} failed in batch ${
            assignments.get(worker)?.request.batch
          }: ${event.message}`,
          event.error,
        ),
      );
    };
    worker.onmessageerror = () =>
      close_with(
        new Error(
          `Worker pool for ${worker_href_value} failed: message could not be deserialized`,
        ),
      );
  }
  for (const worker of workers) install(worker);
  options.signal?.addEventListener("abort", close_from_signal, { once: true });
  if (options.signal?.aborted) close_from_signal();
  return {
    worker: worker_href_value,
    ready,
    map(inputs, map_options = {}) {
      if (closed_reason !== undefined) return Promise.reject(closed_reason);
      const size = map_options.batch_size ?? options.batch_size ?? 1;
      if (!Number.isInteger(size) || size < 1) {
        return Promise.reject(
          new RangeError("Worker batch_size must be a positive integer"),
        );
      }
      if (map_options.signal?.aborted) {
        return Promise.reject(
          worker_abort_error(worker_href_value, undefined, map_options.signal),
        );
      }
      if (inputs.length === 0) return Promise.resolve([]);
      if (requests.size >= pending_limit) {
        return Promise.reject(
          new RangeError("Worker pool pending request limit reached"),
        );
      }
      if (inputs.length > item_limit - pending_items) {
        return Promise.reject(
          new RangeError("Worker pool pending item limit reached"),
        );
      }
      let bytes = 0;
      if (byte_limit !== Infinity) {
        try {
          for (const value of inputs) {
            const size = options.input_bytes!(value);
            if (!Number.isSafeInteger(size) || size < 0) {
              throw new RangeError(
                "Worker input byte size must be a nonnegative safe integer",
              );
            }
            bytes += size;
            if (bytes > byte_limit - pending_bytes) {
              throw new RangeError("Worker pool pending byte limit reached");
            }
          }
        } catch (cause) {
          return Promise.reject(cause);
        }
      }
      // Size callbacks may synchronously close the pool or submit other maps.
      if (closed_reason !== undefined) return Promise.reject(closed_reason);
      if (
        requests.size >= pending_limit ||
        inputs.length > item_limit - pending_items ||
        bytes > byte_limit - pending_bytes
      ) {
        return Promise.reject(
          new RangeError("Worker pool admission limit reached"),
        );
      }
      if (map_options.signal?.aborted) {
        return Promise.reject(
          worker_abort_error(worker_href_value, undefined, map_options.signal),
        );
      }
      pending_items += inputs.length;
      pending_bytes += bytes;
      return new Promise<readonly output[]>((resolve, reject) => {
        const request: Request = {
          batch: next_worker_batch(),
          bytes,
          items: inputs.length,
          inputs,
          options: map_options,
          results: new Array(inputs.length),
          resolve,
          reject,
          next: 0,
          completed: 0,
          settled: false,
          active: 0,
          released: false,
          abort() {
            settle(request, {
              cause: worker_abort_error(
                worker_href_value,
                request.batch,
                map_options.signal,
              ),
            });
            try {
              reclaim(request, true);
            } catch (cause) {
              close_with(error_with_context("Could not replace worker", cause));
            }
            dispatch();
          },
        };
        requests.add(request);
        enqueue(request);
        map_options.signal?.addEventListener("abort", request.abort, {
          once: true,
        });
        dispatch();
      });
    },
    async *stream(inputs, stream_options = {}) {
      const window_size = stream_options.window_size ?? worker_count *
          (stream_options.batch_size ?? options.batch_size ?? 1);
      if (!Number.isSafeInteger(window_size) || window_size < 1) {
        throw new RangeError(
          "Worker window_size must be a positive safe integer",
        );
      }
      if (closed_reason !== undefined) throw closed_reason;
      if (stream_options.signal?.aborted) {
        throw worker_abort_error(
          worker_href_value,
          undefined,
          stream_options.signal,
        );
      }
      const iterator = inputs[Symbol.iterator]();
      let exhausted = false;
      try {
        let window: input[] = [];
        while (true) {
          if (closed_reason !== undefined) throw closed_reason;
          if (stream_options.signal?.aborted) {
            throw worker_abort_error(
              worker_href_value,
              undefined,
              stream_options.signal,
            );
          }
          const next = iterator.next();
          if (next.done) {
            exhausted = true;
            break;
          }
          window.push(next.value);
          if (window.length === window_size) {
            yield* await this.map(window, stream_options);
            window = [];
          }
        }
        if (window.length > 0) yield* await this.map(window, stream_options);
      } catch (error) {
        if (!exhausted) {
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
      } finally {
        if (!exhausted) {
          exhausted = true;
          iterator.return?.();
        }
      }
    },
    close,
    [Symbol.dispose]: close,
  };
}

/** Creates a pool, passes it to `use`, and always closes it afterward. */
export async function with_worker_pool<input, output, item>(
  worker: string | URL,
  use: (pool: WorkerPool<input, output>) => item | Promise<item>,
  options: ParallelOptions = {},
): Promise<item> {
  using pool = create_worker_pool<input, output>(worker, options);

  return await use(pool);
}

/** Creates a deferred Task that submits inputs to an existing pool. */
export function worker_pool_map<input, output>(
  pool: WorkerPool<input, output>,
  inputs: readonly input[],
  options: WorkerMapOptions<input> = {},
): Data<AsTask, readonly output[]> {
  return from_fn((signal) =>
    pool.map(inputs, {
      ...options,
      signal: combine_signals(options.signal, signal),
    })
  );
}

/** Maps inputs with temporary workers and terminates them afterward. */
export async function run_worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions & WorkerMapOptions<input> = {},
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
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<unknown[]>) => void) | null;
    postMessage(message: unknown, transfer: Transferable[]): void;
  };
  const active = new Map<number, AbortController>();
  const never_aborted = new AbortController().signal;
  scope.onmessage = async (event) => {
    const [tag, payload] = event.data;
    if (tag === "cancel") {
      const controller = active.get(payload as number);
      if (controller !== undefined) controller.abort();
      else if (options.cooperative) {
        scope.postMessage(["cancelled", payload], []);
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
        batch = payload as number;
        start = event.data[2] as number;
        inputs = event.data[3] as input[];
        count = inputs.length;
        break;
      case "jobs":
        jobs = payload as WorkerJob<input>[1][];
        batch = jobs[0].batch;
        count = jobs.length;
        break;
      case "job":
        single = payload as WorkerJob<input>[1];
        batch = single.batch;
        break;
      default:
        throw new TypeError("Unknown worker request");
    }
    let controller: AbortController | undefined;
    let signal = never_aborted;
    if (options.cooperative) {
      controller = new AbortController();
      signal = controller.signal;
      active.set(batch, controller);
    }
    let replies: unknown[] | undefined;
    if (tag !== "job") replies = [];
    let single_reply: unknown;
    const transfers: Transferable[] = [];
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
        let reply: unknown;
        try {
          const pending = handler(input, signal);
          let output: output;
          if (
            (typeof pending === "object" && pending !== null) ||
            typeof pending === "function"
          ) {
            output = await pending;
          } else output = pending as output;
          if (options.transfer !== undefined) {
            for (const transfer of options.transfer(output)) {
              transfers.push(transfer);
            }
          }
          if (tag === "range") reply = ["done", output];
          else reply = ["done", { batch, id, output }];
        } catch (error) {
          const failure = serialize_error(error);
          if (tag === "range") reply = ["failed", failure];
          else reply = ["failed", { batch, id, error: failure }];
        }
        if (replies === undefined) single_reply = reply;
        else replies[index] = reply;
      }
    };
    if (concurrency === 1) await run();
    else {
      const pending: Promise<void>[] = [];
      for (let index = 0; index < concurrency && index < count; index += 1) {
        pending.push(run());
      }
      await Promise.all(pending);
    }
    if (controller !== undefined) active.delete(batch);
    if (signal.aborted) scope.postMessage(["cancelled", batch], []);
    else if (tag === "job") scope.postMessage(single_reply, transfers);
    else if (tag === "range") {
      scope.postMessage(["range-results", batch, start, replies], transfers);
    } else scope.postMessage(["results", replies], transfers);
  };
  scope.postMessage(["ready", {
    range: true,
    cooperative: options.cooperative === true,
  }], []);
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

function close_workers(workers: readonly Worker[]) {
  for (const worker of workers) {
    worker.terminate();
  }
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

  if (typeof reply.error !== "object" || reply.error === null) {
    throw new TypeError("Worker failed reply is missing its error payload");
  }

  const failure = reply.error as Record<string, unknown>;

  if (typeof failure.message !== "string") {
    throw new TypeError("Worker failed reply has no error message");
  }

  if (failure.name !== undefined && typeof failure.name !== "string") {
    throw new TypeError("Worker failed reply has an invalid error name");
  }

  if (failure.stack !== undefined && typeof failure.stack !== "string") {
    throw new TypeError("Worker failed reply has an invalid error stack");
  }

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

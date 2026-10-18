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
    let task = worker_map(map.worker, map.inputs, {
      workers: map.workers,
      batch_size: map.batch_size,
      signal: map.signal,
    });

    if (map.worker === pool.worker) {
      task = worker_pool_map(pool, map.inputs, {
        signal: map.signal,
        batch_size: map.batch_size,
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
    readonly inputs: readonly input[];
    readonly options: WorkerMapOptions<input>;
    readonly results: output[];
    readonly resolve: (value: readonly output[]) => void;
    readonly reject: (error: unknown) => void;
    readonly abort: () => void;
    next: number;
    completed: number;
    settled: boolean;
    previous?: Request;
    following?: Request;
  };
  type Assignment = {
    readonly request: Request;
    readonly ids: readonly number[];
  };
  const requests = new Set<Request>();
  const assignments = new Map<Worker, Assignment>();
  const idle = [...workers];
  const worker_members = new Set(workers);
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
  function reclaim(request: Request): void {
    for (const [worker, assignment] of assignments) {
      if (assignment.request !== request) continue;
      assignments.delete(worker);
      worker.terminate();
      worker_members.delete(worker);
      ready_workers.delete(worker);
      const index = workers.indexOf(worker);
      const replacement = new Worker(worker_href_value, { type: "module" });
      workers[index] = replacement;
      worker_members.add(replacement);
      install(replacement);
      idle.push(replacement);
    }
  }
  function settle(request: Request, error?: { readonly cause: unknown }): void {
    if (request.settled) return;
    request.settled = true;
    request.options.signal?.removeEventListener("abort", request.abort);
    requests.delete(request);
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
      const ids: number[] = [];
      const jobs: WorkerJob<input>[1][] = [];
      const transfer: Transferable[] = [];
      while (jobs.length < size && request.next < request.inputs.length) {
        const id = request.next++;
        ids.push(id);
        jobs.push({ batch: request.batch, id, input: request.inputs[id] });
      }
      if (request.next === request.inputs.length) remove_ready(request);
      try {
        for (const id of ids) {
          transfer.push(
            ...(request.options.transfer?.(request.inputs[id], id) ?? []),
          );
          if (request.settled || closed_reason !== undefined) break;
        }
        // Transfer callbacks are user code and may synchronously abort or close.
        // This worker is reserved locally until an assignment is posted.
        if (closed_reason !== undefined) return;
        if (request.settled) {
          idle.push(worker);
          continue;
        }
        assignments.set(worker, { request, ids });
        if (size === 1) worker.postMessage(["job", jobs[0]], transfer);
        else worker.postMessage(["jobs", jobs], transfer);
      } catch (cause) {
        assignments.delete(worker);
        idle.push(worker);
        settle(request, {
          cause: error_with_context(
            `Could not send input ${
              ids[0]
            } to ${worker_href_value} in batch ${request.batch}`,
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

  function install(worker: Worker): void {
    worker.onmessage = (event) => {
      if (closed_reason !== undefined || !worker_members.has(worker)) return;
      if (Array.isArray(event.data) && event.data[0] === "ready") {
        mark_ready(worker);
        return;
      }
      const assignment = assignments.get(worker);
      try {
        if (assignment === undefined) {
          throw new Error("Reply without an active assignment");
        }
        let replies: unknown[] = [event.data];
        if (Array.isArray(event.data) && event.data[0] === "results") {
          replies = event.data[1];
        }
        if (
          !Array.isArray(replies) || replies.length !== assignment.ids.length
        ) throw new Error("Wrong worker reply count");
        const parsed = replies.map((reply) =>
          parse_worker_reply<output>(reply)
        );
        assignments.delete(worker);
        mark_ready(worker);
        for (let index = 0; index < parsed.length; index += 1) {
          const [tag, payload] = parsed[index];
          const { request, ids } = assignment;
          if (payload.batch !== request.batch || payload.id !== ids[index]) {
            throw new Error("Worker reply does not match its assignment");
          }
          if (request.settled) continue;
          switch (tag) {
            case "done":
              request.results[payload.id] = payload.output;
              request.completed += 1;
              if (request.completed === request.inputs.length) settle(request);
              break;
            case "failed":
              settle(request, {
                cause: worker_error(payload.error, {
                  worker: worker_href_value,
                  batch: request.batch,
                }, payload.id),
              });
              reclaim(request);
              break;
          }
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
      return new Promise<readonly output[]>((resolve, reject) => {
        const request: Request = {
          batch: next_worker_batch(),
          inputs,
          options: map_options,
          results: new Array(inputs.length),
          resolve,
          reject,
          next: 0,
          completed: 0,
          settled: false,
          abort() {
            settle(request, {
              cause: worker_abort_error(
                worker_href_value,
                request.batch,
                map_options.signal,
              ),
            });
            try {
              reclaim(request);
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
  handler: (input: input) => output | Promise<output>,
  options: {
    readonly transfer?: (output: output) => Transferable[];
    /** Independent asynchronous jobs per message; defaults to one. */
    readonly concurrency?: number;
  } = {},
): void {
  const concurrency = options.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Worker concurrency must be a positive integer");
  }
  const scope = self as unknown as {
    onmessage:
      | ((
        event: MessageEvent<
          readonly [string, WorkerJob<input>[1] | WorkerJob<input>[1][]]
        >,
      ) => void)
      | null;
    postMessage(message: unknown, transfer: Transferable[]): void;
  };
  scope.onmessage = async (event) => {
    const [tag, payload] = event.data;
    let jobs: WorkerJob<input>[1][];
    if (tag === "jobs") jobs = payload as WorkerJob<input>[1][];
    else if (tag === "job") jobs = [payload as WorkerJob<input>[1]];
    else throw new TypeError("Unknown worker request");
    const replies: WorkerReply<output>[] = [];
    const transfers: Transferable[] = [];
    if (concurrency === 1) {
      for (const job of jobs) {
        try {
          const output = await handler(job.input);
          transfers.push(...(options.transfer?.(output) ?? []));
          replies.push(["done", { batch: job.batch, id: job.id, output }]);
        } catch (error) {
          replies.push(["failed", {
            batch: job.batch,
            id: job.id,
            error: serialize_error(error),
          }]);
        }
      }
    } else {
      const output_transfers: Transferable[][] = new Array(jobs.length);
      let next = 0;
      const run = async (): Promise<void> => {
        while (next < jobs.length) {
          const index = next++;
          const job = jobs[index];
          try {
            const output = await handler(job.input);
            output_transfers[index] = options.transfer?.(output) ?? [];
            replies[index] = ["done", { batch: job.batch, id: job.id, output }];
          } catch (error) {
            output_transfers[index] = [];
            replies[index] = ["failed", {
              batch: job.batch,
              id: job.id,
              error: serialize_error(error),
            }];
          }
        }
      };
      const pending: Promise<void>[] = [];
      for (
        let index = 0;
        index < concurrency && index < jobs.length;
        index += 1
      ) {
        pending.push(run());
      }
      await Promise.all(pending);
      transfers.push(...output_transfers.flat());
    }
    if (tag === "job") scope.postMessage(replies[0], transfers);
    else scope.postMessage(["results", replies], transfers);
  };
  scope.postMessage(["ready"], []);
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

    return [
      "done",
      { batch: reply.batch, id: reply.id, output: reply.output as output },
    ];
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

  return [
    "failed",
    {
      batch: reply.batch,
      id: reply.id,
      error: {
        name: failure.name,
        message: failure.message,
        stack: failure.stack,
      },
    },
  ];
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

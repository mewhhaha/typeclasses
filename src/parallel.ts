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
  };
  type Assignment = {
    readonly request: Request;
    readonly ids: readonly number[];
  };
  const requests: Request[] = [];
  const assignments = new Map<Worker, Assignment>();
  let closed_reason: Error | undefined;
  let cursor = 0;
  function settle(request: Request, error?: { readonly cause: unknown }): void {
    if (request.settled) return;
    request.settled = true;
    request.options.signal?.removeEventListener("abort", request.abort);
    const index = requests.indexOf(request);
    if (index >= 0) requests.splice(index, 1);
    if (error !== undefined) request.reject(error.cause);
    else request.resolve(request.results);
  }
  function close_with(reason: Error): void {
    if (closed_reason !== undefined) return;
    closed_reason = reason;
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
    let reschedule = true;
    while (reschedule) {
      reschedule = false;
      for (const worker of workers) {
        if (assignments.has(worker)) continue;
        let request: Request | undefined;
        for (let count = 0; count < requests.length; count += 1) {
          cursor %= requests.length;
          const candidate = requests[cursor++];
          if (candidate.next < candidate.inputs.length) {
            request = candidate;
            break;
          }
        }
        if (request === undefined) continue;
        const size = request.options.batch_size ?? options.batch_size ?? 1;
        const ids: number[] = [];
        const jobs: WorkerJob<input>[1][] = [];
        const transfer: Transferable[] = [];
        while (jobs.length < size && request.next < request.inputs.length) {
          const id = request.next++;
          ids.push(id);
          jobs.push({ batch: request.batch, id, input: request.inputs[id] });
        }
        try {
          for (const id of ids) {
            transfer.push(
              ...(request.options.transfer?.(request.inputs[id], id) ?? []),
            );
          }
          assignments.set(worker, { request, ids });
          if (size === 1) worker.postMessage(["job", jobs[0]], transfer);
          else worker.postMessage(["jobs", jobs], transfer);
        } catch (cause) {
          reschedule = true;
          assignments.delete(worker);
          settle(request, {
            cause: error_with_context(
              `Could not send input ${
                ids[0]
              } to ${worker_href_value} in batch ${request.batch}`,
              cause,
            ),
          });
        }
      }
    }
  }

  for (const worker of workers) {
    worker.onmessage = (event) => {
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
              break;
          }
        }
        assignments.delete(worker);
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
  options.signal?.addEventListener("abort", close_from_signal, { once: true });
  if (options.signal?.aborted) close_from_signal();
  return {
    worker: worker_href_value,
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
            dispatch();
          },
        };
        requests.push(request);
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
  options: { readonly transfer?: (output: output) => Transferable[] } = {},
): void {
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
    if (tag === "job") scope.postMessage(replies[0], transfers);
    else scope.postMessage(["results", replies], transfers);
  };
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
  const evidence = cause instanceof Error ? cause.message : String(cause);
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

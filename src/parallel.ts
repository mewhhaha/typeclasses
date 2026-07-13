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
      /** Cancels the map request when aborted. */
      readonly signal: AbortSignal | undefined;
    },
  ];

/** Any parallel-map effect requirement. */
export type Parallel = ParallelMap<unknown, unknown>;

/** Options for creating or temporarily using workers. */
export type ParallelOptions = {
  /** The maximum number of workers to create. */
  readonly workers?: number;
  /** Cancels worker creation or active work when aborted. */
  readonly signal?: AbortSignal;
};

/** Options for one map submitted to an existing worker pool. */
export type WorkerMapOptions = {
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
    options?: WorkerMapOptions,
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

type WorkerScope<input, output> = {
  onmessage: ((event: MessageEvent<WorkerJob<input>>) => void) | null;
  postMessage(message: WorkerReply<output>): void;
};

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
  return Effect.send([
    "parallel.map",
    {
      worker: worker_href(worker),
      inputs,
      workers: options.workers,
      signal: options.signal,
    },
  ] as ParallelMap<input, output>);
}

/** Creates a deferred Task that maps inputs with temporary workers. */
export function worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions = {},
): Data<AsTask, readonly output[]> {
  return from_fn(() => run_worker_map<input, output>(worker, inputs, options));
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
      signal: map.signal,
    });

    if (map.worker === pool.worker) {
      task = worker_pool_map(pool, map.inputs, { signal: map.signal });
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

  let closed_reason: Error | undefined;
  let previous = Promise.resolve();
  let active: AbortController | undefined;

  const close_from_signal = () => {
    close_with(
      worker_abort_error(worker_href_value, undefined, options.signal),
    );
  };

  if (options.signal !== undefined) {
    options.signal.addEventListener("abort", close_from_signal, { once: true });

    if (options.signal.aborted) {
      close_from_signal();
    }
  }

  function close() {
    close_with(new Error(`Worker pool for ${worker_href_value} is closed`));
  }

  function close_with(reason: Error) {
    if (closed_reason !== undefined) {
      return;
    }

    closed_reason = reason;
    active?.abort(reason);
    close_workers(workers);

    if (options.signal !== undefined) {
      options.signal.removeEventListener("abort", close_from_signal);
    }
  }

  return {
    worker: worker_href_value,

    map(inputs, map_options = {}) {
      if (closed_reason !== undefined) {
        return Promise.reject(closed_reason);
      }

      const batch = next_worker_batch();
      const run = previous.then(async () => {
        if (closed_reason !== undefined) {
          throw closed_reason;
        }

        if (map_options.signal?.aborted) {
          throw worker_abort_error(
            worker_href_value,
            batch,
            map_options.signal,
          );
        }

        const controller = new AbortController();
        active = controller;

        try {
          return await run_worker_map_with_workers<input, output>(
            workers,
            inputs,
            {
              worker: worker_href_value,
              batch,
              signals: compact_signals(controller.signal, map_options.signal),
            },
          );
        } catch (cause) {
          const failure = error_with_context(
            `Worker pool for ${worker_href_value} failed in batch ${batch}`,
            cause,
          );
          close_with(failure);
          throw failure;
        } finally {
          if (active === controller) {
            active = undefined;
          }
        }
      });

      previous = run.then(ignore_value, ignore_value);

      return run;
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
  options: WorkerMapOptions = {},
): Data<AsTask, readonly output[]> {
  return from_fn(() => pool.map(inputs, options));
}

/** Maps inputs with temporary workers and terminates them afterward. */
export async function run_worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions = {},
): Promise<readonly output[]> {
  const worker_href_value = worker_href(worker);

  if (options.signal?.aborted) {
    throw worker_abort_error(worker_href_value, undefined, options.signal);
  }

  if (inputs.length === 0) {
    return [];
  }

  const worker_count = normalize_worker_count(options.workers, inputs.length);
  using cleanup = new DisposableStack();
  const workers = Array.from({ length: worker_count }, () => {
    const current_worker = new Worker(worker_href_value, { type: "module" });
    cleanup.defer(() => current_worker.terminate());

    return current_worker;
  });

  return await run_worker_map_with_workers(workers, inputs, {
    worker: worker_href_value,
    batch: next_worker_batch(),
    signals: options.signal === undefined ? [] : [options.signal],
  });
}

type WorkerRun = {
  readonly worker: string;
  readonly batch: number;
  readonly signals: readonly AbortSignal[];
};

async function run_worker_map_with_workers<input, output>(
  workers: readonly Worker[],
  inputs: readonly input[],
  run: WorkerRun,
): Promise<readonly output[]> {
  if (inputs.length === 0) {
    return [];
  }

  if (workers.length === 0) {
    throw new Error("Worker map needs at least one worker");
  }

  const active_workers = workers.slice(0, inputs.length);

  return await new Promise<readonly output[]>((resolve, reject) => {
    const results = new Array<output>(inputs.length);
    const assignments = new Map<Worker, number>();
    let next = 0;
    let completed = 0;
    let settled = false;

    const abort = () => {
      const signal = run.signals.find((candidate) => candidate.aborted);
      fail(worker_abort_error(run.worker, run.batch, signal));
    };

    if (run.signals.some((signal) => signal.aborted)) {
      abort();
      return;
    }

    for (const signal of run.signals) {
      signal.addEventListener("abort", abort, { once: true });
    }

    function finish() {
      if (settled) {
        return;
      }

      settled = true;
      clear_listeners();
      resolve(results);
    }

    function fail(error: unknown) {
      if (settled) {
        return;
      }

      settled = true;
      clear_listeners();
      reject(error_with_context(
        `Worker map for ${run.worker} failed in batch ${run.batch}`,
        error,
      ));
    }

    function clear_listeners() {
      for (const signal of run.signals) {
        signal.removeEventListener("abort", abort);
      }

      for (const worker of active_workers) {
        worker.onmessage = null;
        worker.onerror = null;
      }
    }

    function send_next(worker: Worker) {
      if (settled) {
        return;
      }

      if (next >= inputs.length) {
        return;
      }

      const id = next;
      next += 1;
      assignments.set(worker, id);

      try {
        worker.postMessage(
          ["job", { batch: run.batch, id, input: inputs[id] }] as WorkerJob<
            input
          >,
        );
      } catch (cause) {
        fail(error_with_context(
          `Could not send input ${id} to ${run.worker} in batch ${run.batch}`,
          cause,
        ));
      }
    }

    for (
      let worker_index = 0;
      worker_index < active_workers.length;
      worker_index += 1
    ) {
      const worker = active_workers[worker_index];

      worker.onmessage = (event: MessageEvent<WorkerReply<output>>) => {
        if (settled) {
          return;
        }

        try {
          const [tag, payload] = parse_worker_reply<output>(event.data);
          const expected = assignments.get(worker);

          if (payload.batch !== run.batch) {
            throw new Error(
              `Worker ${worker_index} replied for batch ${payload.batch}; expected ${run.batch}`,
            );
          }

          if (expected === undefined) {
            throw new Error(
              `Worker ${worker_index} replied for input ${payload.id} without an active assignment`,
            );
          }

          if (payload.id !== expected) {
            throw new Error(
              `Worker ${worker_index} replied for input ${payload.id}; expected ${expected}`,
            );
          }

          assignments.delete(worker);

          switch (tag) {
            case "done":
              results[payload.id] = payload.output;
              completed += 1;

              if (completed === inputs.length) {
                finish();
                return;
              }

              send_next(worker);
              return;
            case "failed":
              fail(worker_error(payload.error, run, payload.id));
              return;
          }
        } catch (cause) {
          fail(error_with_context(
            `Worker ${worker_index} sent an invalid reply for ${run.worker} in batch ${run.batch}`,
            cause,
          ));
        }
      };

      worker.onerror = (event) => {
        event.preventDefault();
        const input = assignments.get(worker);
        fail(
          new Error(
            `Worker ${worker_index} failed for ${run.worker} in batch ${run.batch}` +
              (input === undefined ? "" : ` while running input ${input}`) +
              `: ${event.message}`,
            { cause: event.error },
          ),
        );
      };

      send_next(worker);
    }
  });
}

/** Installs the message protocol used by the parallel map runners. */
export function serve_worker<input, output>(
  handler: (input: input) => output | Promise<output>,
) {
  const scope = self as unknown as WorkerScope<input, output>;

  scope.onmessage = async (event) => {
    const [tag, payload] = event.data;

    switch (tag) {
      case "job":
        try {
          const output = await handler(payload.input);
          scope.postMessage([
            "done",
            { batch: payload.batch, id: payload.id, output },
          ]);
        } catch (error) {
          scope.postMessage([
            "failed",
            {
              batch: payload.batch,
              id: payload.id,
              error: serialize_error(error),
            },
          ]);
        }
        return;
    }
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

function compact_signals(
  first: AbortSignal,
  second: AbortSignal | undefined,
): readonly AbortSignal[] {
  if (second === undefined) {
    return [first];
  }

  return [first, second];
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

function ignore_value() {}

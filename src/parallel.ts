import {
  Effect,
  type Operation,
  type TaggedOperation,
  type Uses,
} from "./effects.ts";
import { type AsTask, from_fn } from "./task.ts";
import type { Data } from "./typeclass.ts";

export type ParallelMap<input, output> =
  & Operation<readonly output[]>
  & readonly [
    "parallel.map",
    {
      readonly worker: string;
      readonly inputs: readonly input[];
      readonly workers: number | undefined;
    },
  ];

type ParallelMapPayload<input> = {
  readonly worker: string;
  readonly inputs: readonly input[];
  readonly workers: number | undefined;
};

export type Parallel = ParallelMap<unknown, unknown>;

export type ParallelOptions = {
  readonly workers?: number;
};

export type WorkerFailure = {
  readonly name: string | undefined;
  readonly message: string;
  readonly stack: string | undefined;
};

export type WorkerPool<input, output> = {
  readonly worker: string;
  map(inputs: readonly input[]): Promise<readonly output[]>;
  close(): void;
  [Symbol.dispose](): void;
};

type WorkerJob<input> = readonly [
  "job",
  {
    readonly id: number;
    readonly input: input;
  },
];

type WorkerReply<output> =
  | readonly ["done", { readonly id: number; readonly output: output }]
  | readonly ["failed", { readonly id: number; readonly error: WorkerFailure }];

type WorkerScope<input, output> = {
  onmessage: ((event: MessageEvent<WorkerJob<input>>) => void) | null;
  postMessage(message: WorkerReply<output>): void;
};

type WithoutParallel<requirements> = requirements extends Parallel ? never
  : requirements;

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
    },
  ] as ParallelMap<input, output>);
}

export function worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions = {},
): Data<AsTask, readonly output[]> {
  return from_fn(() => run_worker_map<input, output>(worker, inputs, options));
}

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
      Effect.lift(worker_map(map.worker, map.inputs, { workers: map.workers })),
      (result) => run_parallel(effect[2](result)),
    );
  }

  return Effect.suspend(
    effect[1] as WithoutParallel<requirements>,
    (value) => run_parallel(effect[2](value)),
  );
}

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
    let task = worker_map(map.worker, map.inputs, { workers: map.workers });

    if (map.worker === pool.worker) {
      task = worker_pool_map(pool, map.inputs);
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

export function create_worker_pool<input, output>(
  worker: string | URL,
  options: ParallelOptions = {},
): WorkerPool<input, output> {
  const worker_href_value = worker_href(worker);
  const workers = Array.from(
    { length: normalize_pool_worker_count(options) },
    () => {
      return new Worker(worker_href_value, { type: "module" });
    },
  );
  let closed = false;
  let previous = Promise.resolve();

  function close() {
    if (closed) {
      return;
    }

    closed = true;
    close_workers(workers);
  }

  return {
    worker: worker_href_value,

    map(inputs) {
      if (closed) {
        return Promise.reject(new Error("Worker pool is closed"));
      }

      const run = previous.then(() => {
        if (closed) {
          throw new Error("Worker pool is closed");
        }

        return run_worker_map_with_workers<input, output>(workers, inputs);
      });

      previous = run.then(ignore_value, ignore_value);

      return run;
    },

    close,

    [Symbol.dispose]: close,
  };
}

export async function with_worker_pool<input, output, item>(
  worker: string | URL,
  use: (pool: WorkerPool<input, output>) => item | Promise<item>,
  options: ParallelOptions = {},
): Promise<item> {
  using pool = create_worker_pool<input, output>(worker, options);

  return await use(pool);
}

export function worker_pool_map<input, output>(
  pool: WorkerPool<input, output>,
  inputs: readonly input[],
): Data<AsTask, readonly output[]> {
  return from_fn(() => pool.map(inputs));
}

export async function run_worker_map<input, output>(
  worker: string | URL,
  inputs: readonly input[],
  options: ParallelOptions = {},
): Promise<readonly output[]> {
  if (inputs.length === 0) {
    return [];
  }

  const worker_count = normalize_worker_count(options.workers, inputs.length);
  using cleanup = new DisposableStack();
  const workers = Array.from({ length: worker_count }, () => {
    const current_worker = new Worker(worker_href(worker), { type: "module" });
    cleanup.defer(() => current_worker.terminate());

    return current_worker;
  });

  return await run_worker_map_with_workers(workers, inputs);
}

async function run_worker_map_with_workers<input, output>(
  workers: readonly Worker[],
  inputs: readonly input[],
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
    let next = 0;
    let completed = 0;
    let settled = false;

    function finish() {
      settled = true;
      resolve(results);
    }

    function fail(error: unknown) {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
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
      worker.postMessage(
        ["job", { id, input: inputs[id] }] as WorkerJob<input>,
      );
    }

    for (const worker of active_workers) {
      worker.onmessage = (event: MessageEvent<WorkerReply<output>>) => {
        const [tag, payload] = event.data;

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
            fail(worker_error(payload.error));
            return;
        }
      };

      worker.onerror = (event) => {
        event.preventDefault();
        fail(new Error("Worker failed: " + event.message));
      };

      send_next(worker);
    }
  });
}

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
          scope.postMessage(["done", { id: payload.id, output }]);
        } catch (error) {
          scope.postMessage([
            "failed",
            { id: payload.id, error: serialize_error(error) },
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

function worker_error(error: WorkerFailure): Error {
  const value = new Error(error.message);
  value.name = error.name ?? "WorkerError";
  value.stack = error.stack;

  return value;
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

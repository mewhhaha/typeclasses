import { assert_equals, assert_true } from "./assert.ts";
import {
  create_worker_pool,
  run_worker_map,
  serve_worker,
} from "./parallel.ts";

const worker_source = `
self.onmessage = async (event) => {
  const [, job] = event.data;
  const input = job.input;

  if (input.delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, input.delay));
  }

  if (input.kind === "crash") {
    throw new Error(input.value);
  }

  if (input.kind === "fail") {
    self.postMessage([
      "failed",
      {
        batch: job.batch,
        id: job.id,
        error: { name: "Error", message: input.value, stack: undefined },
      },
    ]);
    return;
  }

  self.postMessage([
    "done",
    { batch: job.batch, id: job.id, output: input.value },
  ]);
};
`;

type WorkerInput = {
  readonly kind: "done" | "fail" | "crash";
  readonly delay: number;
  readonly value: string;
};

Deno.test("worker maps preserve input order across concurrent jobs", async () => {
  using script = worker_script(worker_source);
  const result = await run_worker_map<WorkerInput, string>(
    script.url,
    [
      { kind: "done", delay: 30, value: "first" },
      { kind: "done", delay: 0, value: "second" },
      { kind: "done", delay: 10, value: "third" },
    ],
    { workers: 2 },
  );

  assert_equals(result, ["first", "second", "third"]);
});

Deno.test("a job failure leaves its pool reusable without stale replies", async () => {
  using script = worker_script(worker_source);
  using pool = create_worker_pool<WorkerInput, string>(script.url, {
    workers: 2,
  });

  const first_error = await rejection_from(pool.map([
    { kind: "fail", delay: 0, value: "boom" },
    { kind: "done", delay: 50, value: "stale" },
  ]));
  const next_result = await settles_within(pool.map([
    { kind: "done", delay: 0, value: "new" },
  ]));

  assert_true(
    first_error.message.includes("boom"),
    "the failed input is present in the first batch error",
  );
  assert_equals(next_result, ["new"]);
});

Deno.test("a later structured-clone error rejects instead of hanging", async () => {
  using script = worker_script(`
self.onmessage = (event) => {
  const [, job] = event.data;
  self.postMessage([
    "done",
    { batch: job.batch, id: job.id, output: typeof job.input },
  ]);
};
`);
  const error = await settles_within(rejection_from(
    run_worker_map<unknown, string>(script.url, [1, () => 2], { workers: 1 }),
  ));

  assert_true(
    error.message.includes("input 1"),
    "the clone error identifies the input that could not be sent",
  );
});

Deno.test("closing a pool rejects its active batch", async () => {
  using script = worker_script(worker_source);
  const pool = create_worker_pool<WorkerInput, string>(script.url, {
    workers: 1,
  });
  const pending = pool.map([
    { kind: "done", delay: 1_000, value: "late" },
  ]);

  await Promise.resolve();
  pool.close();
  const error = await settles_within(rejection_from(pending));

  assert_true(
    error.message.includes("closed"),
    "closing the pool explains why its active batch was aborted",
  );
});

Deno.test("a crashed worker makes its pool terminal", async () => {
  using script = worker_script(worker_source);
  using pool = create_worker_pool<WorkerInput, string>(script.url, {
    workers: 1,
  });

  const crash = await settles_within(rejection_from(pool.map([
    { kind: "crash", delay: 0, value: "worker exploded" },
  ])));
  const reuse = await settles_within(rejection_from(pool.map([
    { kind: "done", delay: 0, value: "unreachable" },
  ])));

  assert_true(
    crash.message.includes("worker exploded"),
    "the worker crash includes its runtime evidence",
  );
  assert_true(
    reuse.message.includes("failed in batch"),
    "a pool does not reuse a worker after it crashes",
  );
});

Deno.test("an AbortSignal cancels an active one-shot worker map", async () => {
  using script = worker_script(worker_source);
  const controller = new AbortController();
  const pending = run_worker_map<WorkerInput, string>(
    script.url,
    [{ kind: "done", delay: 1_000, value: "late" }],
    { workers: 1, signal: controller.signal },
  );

  await Promise.resolve();
  controller.abort("test cancellation");
  const error = await settles_within(rejection_from(pending));

  assert_equals(error.name, "AbortError");
  assert_true(
    error.message.includes("test cancellation"),
    "the cancellation reason is attached to the worker-map error",
  );
});

function worker_script(source: string) {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );

  return {
    url,
    [Symbol.dispose]() {
      URL.revokeObjectURL(url);
    },
  };
}

async function rejection_from(promise: Promise<unknown>): Promise<Error> {
  let caught: unknown;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  assert_true(
    caught instanceof Error,
    "expected the promise to reject with Error",
  );
  return caught as Error;
}

async function settles_within<value>(promise: Promise<value>): Promise<value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("promise did not settle")),
      2_000,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("pool callers multiplex while a previous request is still active", async () => {
  using script = worker_script(worker_source);
  using pool = create_worker_pool<WorkerInput, string>(script.url, {
    workers: 2,
  });
  let long_finished = false;
  const long = pool.map([{ kind: "done", delay: 100, value: "long" }]).then(
    (value) => {
      long_finished = true;
      return value;
    },
  );
  assert_equals(await pool.map([{ kind: "done", delay: 0, value: "short" }]), [
    "short",
  ]);
  assert_equals(long_finished, false);
  assert_equals(await long, ["long"]);
});

Deno.test("malformed replies make the pool terminal", async () => {
  using script = worker_script(
    `self.onmessage = () => self.postMessage(["mystery", {}]);`,
  );
  using pool = create_worker_pool<number, number>(script.url, { workers: 1 });
  const first = await rejection_from(pool.map([1]));
  const second = await rejection_from(pool.map([2]));
  assert_true(
    first.message.includes("invalid reply"),
    "protocol violation has context",
  );
  assert_true(first === second, "pool retains its terminal failure");
});

Deno.test("batched worker protocol and explicit transfers preserve buffers", async () => {
  using script = worker_script(`
const serialize_error = (error) => ({ name: error.name, message: error.message, stack: error.stack });
(${serve_worker.toString()})((input) => {
  const bytes = new Uint8Array(input);
  bytes[0] += 1;
  return input;
}, { transfer: (output) => [output] });
`);
  using pool = create_worker_pool<ArrayBuffer, ArrayBuffer>(script.url, {
    workers: 1,
  });
  const first = new Uint8Array([1]).buffer;
  const second = new Uint8Array([2]).buffer;
  const pending = pool.map([first, second], {
    batch_size: 2,
    transfer: (input) => [input],
  });
  assert_equals(first.byteLength, 0);
  assert_equals(second.byteLength, 0);
  const result = await pending;
  assert_equals(result.map((buffer) => new Uint8Array(buffer)[0]), [2, 3]);
});

Deno.test("a clone failure rejects one map while preserving pool health", async () => {
  using script = worker_script(`self.onmessage = (event) => {
    const [, job] = event.data;
    self.postMessage(["done", { batch: job.batch, id: job.id, output: job.input }]);
  };`);
  using pool = create_worker_pool<unknown, unknown>(script.url, { workers: 1 });
  await rejection_from(pool.map([() => 1]));
  assert_equals(await pool.map([42]), [42]);
});

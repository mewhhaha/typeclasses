import { assert_equals, assert_true } from "./assert.ts";
import {
  from_fn,
  run_task,
  run_task_exit,
  succeed,
  type Task,
  traverse_task,
} from "./task.ts";
import { create_worker_pool, serve_worker } from "./parallel.ts";
import { Reader } from "./reader.ts";
import { State } from "./state.ts";
import {
  atomically,
  new_tvar,
  or_else,
  read_tvar,
  Stm,
  type StmJournal,
  write_tvar,
} from "./stm.ts";

Deno.test("Task plans run and replay 100k map/bind steps without recursive invocation", async () => {
  let calls = 0;
  let task = succeed<number>(0);
  for (let index = 0; index < 50_000; index += 1) {
    task = task.map((value) => {
      calls += 1;
      return value + 1;
    })
      .bind((value) => succeed(value + 1));
  }
  assert_equals(calls, 0);
  assert_equals(await run_task(task), 100_000);
  assert_equals(await task.run(), 100_000);
  assert_equals(calls, 100_000);
  assert_equals(
    await run_task(task.bind(() => from_fn(() => Promise.resolve(7)))),
    7,
  );
});

Deno.test("Task cold thunks infer sync and async items and run once per execution", async () => {
  let calls = 0;
  const sync: Task<number> = from_fn(() => ++calls);
  const async: Task<string> = from_fn(() => Promise.resolve(String(++calls)));
  const mixed: Task<number> = from_fn(() => {
    if (calls === 0) return 1;
    return Promise.resolve(2);
  });
  assert_equals(await run_task(mixed), 1);
  assert_equals(calls, 0);
  assert_equals(await run_task(sync), 1);
  assert_equals(await run_task(async), "2");
  assert_equals(await run_task(sync), 3);
});

Deno.test("cooperative Task plans yield within the selected budget and remain cancellable", async () => {
  const controller = new AbortController();
  let task = succeed<number>(0);
  let steps = 0;
  for (let index = 0; index < 1000; index += 1) {
    task = task.map((value) => {
      steps += 1;
      return value + 1;
    });
  }
  let schedules = 0;
  const exit = await run_task_exit(task, {
    signal: controller.signal,
    yield_every: 64,
    schedule: () => {
      schedules += 1;
      controller.abort("budget reached");
      return Promise.resolve();
    },
  });
  assert_equals(exit.status, "cancelled");
  assert_equals(schedules, 1);
  assert_equals(steps, 63);
});

Deno.test("Task traversal closes once and retains both work and cleanup failures", async () => {
  const failure = new Error("work");
  const cleanup = new Error("cleanup");
  let closed = 0;
  const input: Iterable<number> = {
    [Symbol.iterator]() {
      return {
        next: () => ({ value: 1, done: false }),
        return: () => {
          closed += 1;
          throw cleanup;
        },
      };
    },
  };
  const error = await rejection(
    run_task(traverse_task(input, 2, () =>
      from_fn<number>(() => {
        throw failure;
      }))),
  );
  assert_true(error instanceof AggregateError, "both failures are observable");
  assert_equals((error as AggregateError).errors, [failure, cleanup]);
  assert_equals(closed, 1);
});

Deno.test("cancelled hung worker assignments free the only slot for the next map", async () => {
  using script = worker_script(`self.onmessage = (event) => {
    const [, job] = event.data;
    if (job.input === "hang") return;
    self.postMessage(["done", { batch: job.batch, id: job.id, output: job.input }]);
  };`);
  using pool = create_worker_pool<string, string>(script.url, { workers: 1 });
  const controller = new AbortController();
  const hanging = pool.map(["hang"], { signal: controller.signal });
  const cancelled = rejection(hanging);
  controller.abort("stop");
  assert_equals((await cancelled as Error).name, "AbortError");
  assert_equals(await within(pool.map(["next"])), ["next"]);
});

Deno.test("worker pending limits reject excess admissions and release capacity", async () => {
  using script = worker_script(`self.onmessage = (event) => {
    const [, job] = event.data;
    if (job.input === 0) return;
    self.postMessage(["done", { batch: job.batch, id: job.id, output: job.input }]);
  };`);
  using pool = create_worker_pool<number, number>(script.url, {
    workers: 1,
    max_pending_requests: 1,
  });
  const controller = new AbortController();
  const first = rejection(pool.map([0], { signal: controller.signal }));
  assert_true(
    await rejection(pool.map([1])) instanceof RangeError,
    "bounded admission",
  );
  controller.abort();
  await first;
  assert_equals(await within(pool.map([2])), [2]);
});

Deno.test("worker readiness reports successful startup before any input and load errors", async () => {
  using good = worker_script(`(${serve_worker.toString()})((value) => value);`);
  using pool = create_worker_pool<number, number>(good.url, { workers: 2 });
  await within(pool.ready);
  assert_equals(await pool.map([2]), [2]);
  using bad = worker_script(`throw new Error("startup failed");`);
  using broken = create_worker_pool<number, number>(bad.url, { workers: 1 });
  const error = await within(rejection(broken.ready));
  assert_true(
    String(error).includes("startup failed"),
    "load error reaches readiness",
  );
  assert_true(
    await rejection(broken.map([1])) === error,
    "startup failure is terminal",
  );
});

Deno.test("worker batch asynchronous concurrency is bounded and replies stay ordered", async () => {
  using script = worker_script(`
    const serialize_error = (error) => ({ message: String(error) });
    let active = 0;
    let peak = 0;
    (${serve_worker.toString()})(async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, (5 - input) * 2));
      active -= 1;
      return { input, peak };
    }, { concurrency: 2 });
  `);
  using pool = create_worker_pool<number, { input: number; peak: number }>(
    script.url,
    { workers: 1 },
  );
  const result = await pool.map([0, 1, 2, 3, 4], { batch_size: 5 });
  assert_equals(result.map((item) => item.input), [0, 1, 2, 3, 4]);
  assert_equals(Math.max(...result.map((item) => item.peak)), 2);
});

Deno.test("cached Reader and State plans preserve reentrancy and dynamic nested binds", () => {
  let entered = false;
  let reader = Reader((value: number) => value).map((value) => value + 1);
  reader = reader.bind((value) =>
    Reader((context: number) => {
      if (!entered) {
        entered = true;
        assert_equals(reader.run(10), 22);
      }
      return value + context;
    }).map((result) => result + 1)
  );
  assert_equals(reader.run(3), 8);
  assert_equals(reader.run(4), 10);
  const state = State((value: number) => [value, value + 1] as const)
    .bind((first) =>
      State((value: number) => [first + value, value + 1] as const)
        .map((value) => value * 2)
    );
  assert_equals(state.run(1), [6, 3]);
  assert_equals(state.run(10), [42, 12]);
});

Deno.test("STM staged ownership preserves escaped writes and raw journal escapes", () => {
  const variable = new_tvar({ count: 0 });
  const input = { count: 1 };
  let raw: StmJournal | undefined;
  const transaction = write_tvar(variable, input).bind(() =>
    Stm((journal) => {
      raw = journal;
      // Inspecting the raw map conservatively invalidates private ownership.
      void journal.writes;
    })
  );
  atomically(transaction);
  input.count = 3;
  for (const value of raw!.writes.values()) {
    (value as { count: number }).count = 4;
  }
  assert_equals(atomically(read_tvar(variable)), { count: 1 });
  const escaped = atomically(
    write_tvar(variable, { count: 5 })
      .bind(() => or_else(read_tvar(variable), read_tvar(variable))),
  );
  escaped.count = 9;
  assert_equals(atomically(read_tvar(variable)), { count: 5 });
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
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected rejection");
}
async function within<item>(promise: Promise<item>): Promise<item> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Request timed out")), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

Deno.test("Task traversal cancellation waits for cleanup and preserves cleanup failure", async () => {
  const controller = new AbortController();
  const cleanup = new Error("cancel cleanup");
  let closed = 0;
  const inputs: Iterable<number> = {
    [Symbol.iterator]() {
      return {
        next: () => ({ value: 1, done: false }),
        return: () => {
          closed += 1;
          throw cleanup;
        },
      };
    },
  };
  const pending = run_task(
    traverse_task(
      inputs,
      1,
      () => from_fn<number>(() => new Promise(() => {})),
    ),
    { signal: controller.signal },
  );
  controller.abort("cancel");
  const error = await rejection(pending);
  assert_true(
    error instanceof AggregateError,
    "cleanup failure survives cancellation",
  );
  assert_equals((error as AggregateError).errors[1], cleanup);
  assert_equals(closed, 1);
});

Deno.test("empty STM runs allocate no journal Maps", () => {
  const transaction = Stm.pure(1);
  const OriginalMap = globalThis.Map;
  let maps = 0;
  class CountingMap<key, value> extends OriginalMap<key, value> {
    constructor(entries?: Iterable<readonly [key, value]> | null) {
      super(entries);
      maps += 1;
    }
  }
  globalThis.Map = CountingMap;
  try {
    assert_equals(atomically(transaction), 1);
    assert_equals(maps, 0);
  } finally {
    globalThis.Map = OriginalMap;
  }
});

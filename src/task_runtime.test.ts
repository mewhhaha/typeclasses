import { assert_equals, assert_true } from "./assert.ts";
import { Applicative } from "./typeclasses.ts";
import { Effect, has_tag } from "./effects.ts";
import {
  from_fn,
  from_promise,
  handle_operation_task,
  is_task_cancellation,
  parallel,
  ParallelTask,
  run_task,
  run_task_exit,
  sequential,
  succeed,
  Task,
} from "./task.ts";

Deno.test("Task rejects thenable values returned from map", async () => {
  const invalid = succeed(1).map(() => Promise.resolve(2));
  const error = await rejection_from(invalid.run());

  assert_true(
    error.message.includes("Task.map cannot produce a PromiseLike item"),
    "the error explains Task's non-thenable item contract",
  );
});

Deno.test("ParallelTask starts every factory before observing a synchronous failure", async () => {
  const events: string[] = [];
  const combined = Applicative.lift(
    (left: number, right: number) => left + right,
    parallel(from_fn<number>(() => {
      events.push("left");
      throw new Error("left failed before returning a promise");
    })),
    parallel(from_fn(() => {
      events.push("right");
      return Promise.resolve(2);
    })),
  );

  const error = await rejection_from(combined.run());

  assert_equals(events, ["left", "right"]);
  assert_true(
    error.message.includes("left failed"),
    "the synchronous factory error remains observable",
  );
});

Deno.test("Task from_fn receives and observes its AbortSignal", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const task = from_fn<number>((signal) => {
    received = signal;
    return new Promise(() => {});
  });
  const pending = task.run(controller.signal);

  controller.abort("test cancellation");
  const error = await rejection_from(pending);

  assert_equals(received, controller.signal);
  assert_equals(error.name, "AbortError");
  assert_true(
    error.message.includes("test cancellation"),
    "the Task cancellation error includes its reason",
  );
});

Deno.test("run_task propagates cancellation through mapped and bound work", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const task = from_fn<number>((signal) => {
    received = signal;
    return new Promise(() => {});
  }).map((value) => value + 1).bind((value) => succeed(value + 1));
  const pending = run_task(Effect.lift(task), { signal: controller.signal });

  controller.abort("stop composed task");
  const error = await rejection_from(pending);

  assert_equals(received, controller.signal);
  assert_equals(error.name, "AbortError");
});

Deno.test("run_task_exit distinguishes cancellation from failure", async () => {
  const controller = new AbortController();
  const cancelled = run_task_exit(
    Effect.lift(from_fn(() => new Promise(() => {}))),
    { signal: controller.signal },
  );

  controller.abort("stop");
  const exit = await cancelled;

  assert_equals(exit.status, "cancelled");
  if (exit.status === "cancelled") {
    assert_equals(exit.reason, "stop");
  }
});

Deno.test("ordinary AbortError rejections remain Task failures", async () => {
  const host_error = Object.assign(
    new Error("HTTP request was aborted upstream"),
    { name: "AbortError" },
  );
  const exits: string[] = [];
  const protected_effect = Effect.ensuring(
    Effect.lift(from_fn<never>(() => Promise.reject(host_error))),
    (exit) => {
      exits.push(exit.status);
    },
  );
  const exit = await run_task_exit(protected_effect);

  assert_equals(exit.status, "failed");
  if (exit.status === "failed") {
    assert_true(exit.error === host_error, "the host error is preserved");
  }
  assert_equals(exits, ["failed"]);
});

Deno.test("Task operation handlers receive the execution AbortSignal", async () => {
  const ReadAnswer = Effect.operation<number>()(["test.task_read_answer"]);
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const handled = handle_operation_task(
    Effect.send(ReadAnswer),
    (operation): operation is typeof ReadAnswer =>
      has_tag(operation, "test.task_read_answer"),
    (_operation, signal) => {
      received = signal;
      return Promise.resolve(42);
    },
  );

  assert_equals(
    await run_task(handled, { signal: controller.signal }),
    42,
  );
  assert_equals(received, controller.signal);
});

Deno.test("ParallelTask aborts siblings after one fails", async () => {
  let sibling_signal: AbortSignal | undefined;
  const combined = Applicative.lift(
    (left: number, right: number) => left + right,
    parallel(from_fn<number>(() => Promise.reject(new Error("failed")))),
    parallel(from_fn<number>((signal) => {
      sibling_signal = signal;
      return new Promise(() => {});
    })),
  );

  await rejection_from(combined.run());
  assert_equals(sibling_signal?.aborted, true);
});

Deno.test("Task from_promise adopts work that has already started", async () => {
  const events: string[] = [];
  const pending = new Promise<number>((resolve) => {
    events.push("started");
    resolve(42);
  });
  const task = from_promise(pending);

  assert_equals(events, ["started"]);
  assert_equals(await task.run(), 42);
});

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

Deno.test("Task Applicative agrees with application derived from bind", async () => {
  let shared = 0;
  const fn = from_fn(async () => {
    await Promise.resolve();
    shared = 1;
    return (value: number) => value;
  });
  const value = from_fn(() => Promise.resolve(shared));
  assert_equals(await fn.ap(value).run(), 1);
  shared = 0;
  assert_equals(await fn.bind((f) => value.map(f)).run(), 1);
});

Deno.test("Task Applicative does not start later work after a failure", async () => {
  const events: string[] = [];
  const combined = Applicative.lift(
    (left: number, right: number) => left + right,
    from_fn<number>(() => {
      events.push("left");
      return Promise.reject(new Error("stop"));
    }),
    from_fn(() => {
      events.push("right");
      return Promise.resolve(2);
    }),
  );
  await rejection_from(combined.run());
  assert_equals(events, ["left"]);
});

Deno.test("ParallelTask conversions preserve deferred work and run_task support", async () => {
  let calls = 0;
  const task = from_fn(() => Promise.resolve(++calls));
  const concurrent = parallel(task);
  const restored = sequential(concurrent);
  assert_equals(calls, 0);
  assert_equals(await run_task(Effect.lift(concurrent)), 1);
  assert_equals(await restored.run(), 2);
  assert_equals(await ParallelTask.pure(42).run(), 42);
});

Deno.test("adopted rejected promises remain observed after pre-aborted execution", async () => {
  const unhandled: unknown[] = [];
  const observe = (event: PromiseRejectionEvent) => {
    event.preventDefault();
    unhandled.push(event.reason);
  };
  addEventListener("unhandledrejection", observe);
  try {
    const controller = new AbortController();
    controller.abort("already cancelled");
    const task = from_promise(Promise.reject(new Error("adopted failure")));
    const error = await rejection_from(task.run(controller.signal));
    assert_equals(error.name, "AbortError");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert_equals(unhandled, []);
    assert_equals(
      (await rejection_from(task.run())).message,
      "adopted failure",
    );
  } finally {
    removeEventListener("unhandledrejection", observe);
  }
});

function check_parallel_task_is_applicative_only(): void {
  // @ts-expect-error concurrent Tasks have no dependent bind operation
  ParallelTask.pure(1).bind(() => ParallelTask.pure(2));
}
void check_parallel_task_is_applicative_only;

Deno.test("run_task_exit cancels pure terminal effects with a pre-aborted signal", async () => {
  const controller = new AbortController();
  controller.abort("cancel pure completion");
  const exit = await run_task_exit(Effect.pure(42), {
    signal: controller.signal,
  });
  assert_equals(exit.status, "cancelled");
  if (exit.status === "cancelled") {
    assert_equals(exit.reason, "cancel pure completion");
  }
});

Deno.test("pre-aborted protected pure effects finalize exactly once as cancelled", async () => {
  const controller = new AbortController();
  controller.abort("cancel protected completion");
  const exits: unknown[] = [];
  const effect = Effect.ensuring(Effect.pure(42), (exit) => {
    exits.push(exit);
  });
  const result = await run_task_exit(effect, { signal: controller.signal });
  assert_equals(result.status, "cancelled");
  assert_equals(exits, [{
    status: "cancelled",
    reason: "cancel protected completion",
  }]);
});

Deno.test("built-in pure Tasks respect cancellation during direct execution", async () => {
  const controller = new AbortController();
  controller.abort("cancel built-in pure");
  for (const task of [succeed(42), Task.pure(42), ParallelTask.pure(42)]) {
    const error = await rejection_from(task.run(controller.signal));
    assert_equals(is_task_cancellation(error), true);
    assert_equals(error.cause, "cancel built-in pure");
    assert_equals(await task.run(), 42);
  }
});

Deno.test("Task throw_error observes direct cancellation and preserves ordinary errors", async () => {
  const controller = new AbortController();
  controller.abort("cancel deferred failure");
  const failure = new Error("ordinary failure");
  const task = Task.throw_error(failure);
  const cancelled = await rejection_from(task.run(controller.signal));
  assert_equals(is_task_cancellation(cancelled), true);
  assert_equals(cancelled.cause, "cancel deferred failure");
  assert_true(
    (await rejection_from(task.run())) === failure,
    "ordinary failures keep their identity",
  );
});

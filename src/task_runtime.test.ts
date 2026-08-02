import { assert_equals, assert_true } from "./assert.ts";
import { Applicative } from "./typeclasses.ts";
import { Effect } from "./effects.ts";
import {
  from_fn,
  from_promise,
  run_task,
  run_task_exit,
  succeed,
} from "./task.ts";

Deno.test("Task rejects thenable values returned from map", async () => {
  const invalid = succeed(1).map(() => Promise.resolve(2));
  const error = await rejection_from(invalid.run());

  assert_true(
    error.message.includes("Task.map cannot produce a PromiseLike item"),
    "the error explains Task's non-thenable item contract",
  );
});

Deno.test("Task Applicative starts every factory before observing a synchronous failure", async () => {
  const events: string[] = [];
  const combined = Applicative.lift(
    (left: number, right: number) => left + right,
    from_fn<number>(() => {
      events.push("left");
      throw new Error("left failed before returning a promise");
    }),
    from_fn(() => {
      events.push("right");
      return Promise.resolve(2);
    }),
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

Deno.test("Task Applicative aborts siblings after one fails", async () => {
  let sibling_signal: AbortSignal | undefined;
  const combined = Applicative.lift(
    (left: number, right: number) => left + right,
    from_fn<number>(() => Promise.reject(new Error("failed"))),
    from_fn<number>((signal) => {
      sibling_signal = signal;
      return new Promise(() => {});
    }),
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

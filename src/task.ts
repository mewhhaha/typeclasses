import {
  type As,
  type Data,
  data,
  type Dictionary,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import type { Effect, EffectFinalizer, Ensuring, Lift } from "./effects.ts";
import { is_kind_of } from "./internal.ts";
import { loop_done, loop_rec } from "./loop.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  MonadError,
  MonadRec,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const task_identity: unique symbol;

/** Excludes thenables so a Task has one unambiguous asynchronous layer. */
export type TaskItem<item> = Extract<item, PromiseLike<unknown>> extends never
  ? item
  : never;

/** Deferred async work whose resolved item cannot itself be a thenable. */
export type Task<item> = (
  signal?: AbortSignal,
) => Promise<TaskItem<item>>;

/** Options supplied when running Task effects. */
export type RunTaskOptions = {
  /** Cancels the whole composed computation when aborted. */
  readonly signal?: AbortSignal;
};

/** The observable outcome of a Task computation. */
export type TaskExit<item> =
  | { readonly status: "succeeded"; readonly value: item }
  | { readonly status: "failed"; readonly error: unknown }
  | {
    readonly status: "cancelled";
    readonly error: Error;
    readonly reason: unknown;
  };

/** The callable dictionary for deferred Task computations. */
export interface AsTask
  extends
    As<AsTask, typeof task_identity>,
    Show<AsTask>,
    MonadError<AsTask>,
    MonadRec<AsTask> {
  /** The item carried by a Task value. */
  readonly [type_item]: unknown;
  /** The deferred computation represented by a Task value. */
  readonly [type_data]: Task<this[typeof type_item]>;
}

/** @ignore */
export type TaskValue<item> = Data<AsTask, item>;

/** The Task dictionary and constructor. */
export const Task: AsTask = data<AsTask>();

/** Creates a Task that succeeds with a non-thenable value. */
export function succeed<item>(value: item & TaskItem<item>): TaskValue<item> {
  return succeed_task(value, "Task.succeed");
}

/** Defers asynchronous work until the returned Task is run. */
export function from_fn<item>(
  run: (signal: AbortSignal | undefined) => Promise<TaskItem<item>>,
): TaskValue<item> {
  return Task((signal) => {
    if (signal?.aborted) {
      return Promise.reject(task_abort_error("Task.from_fn", signal));
    }

    let pending: Promise<TaskItem<item>>;

    try {
      pending = Promise.resolve(run(signal));
    } catch (error) {
      return Promise.reject(error);
    }

    return await_with_signal(pending, signal, "Task.from_fn");
  });
}

/** Adopts an already-running promise. Use `from_fn` when work must be deferred. */
export function from_promise<item>(
  promise: PromiseLike<TaskItem<item>>,
): TaskValue<item> {
  return Task((signal) => {
    const pending = Promise.resolve(promise);
    return await_with_signal(pending, signal, "Task.from_promise");
  });
}

/** Runs an effect containing Task lifts and cleanup scopes. */
export async function run_task<
  requirements extends Lift<AsTask, unknown> | Ensuring,
  item,
>(
  effect: Effect<requirements, item>,
  options: RunTaskOptions = {},
): Promise<item> {
  let current = effect as Effect<
    Lift<AsTask, unknown> | Ensuring,
    unknown
  >;

  while (true) {
    switch (current[0]) {
      case "pure":
        return current[1] as item;
      case "impure": {
        const operation = current[1] as readonly [string, unknown];

        if (operation[0] === "lift" && is_task_value(operation[1])) {
          const lifted = current[1] as unknown as Lift<AsTask, unknown>;
          current = current[2](
            await start_task(lifted[1].value(), options.signal, "run_task"),
          ) as Effect<
            Lift<AsTask, unknown> | Ensuring,
            unknown
          >;
          continue;
        }

        if (operation[0] === "effect.ensuring") {
          const [, scope] = current[1] as Ensuring;
          let value: unknown;

          try {
            value = await run_task(
              scope.effect as Effect<
                Lift<AsTask, unknown> | Ensuring,
                unknown
              >,
              options,
            );
          } catch (error) {
            if (is_task_cancellation(error)) {
              await finalize_cancelled_effect(
                scope.finalize,
                error,
                options.signal?.reason ?? error.cause,
              );
            }

            await finalize_failed_effect(scope.finalize, error);
          }

          await finalize_successful_effect(scope.finalize);
          current = current[2](value) as Effect<
            Lift<AsTask, unknown> | Ensuring,
            unknown
          >;
          continue;
        }

        throw new TypeError(
          `Unhandled effect operation while running Task: ${
            String(operation[0])
          }`,
        );
      }
    }
  }
}

/** Runs a Task effect and returns its success, failure, or cancellation. */
export async function run_task_exit<
  requirements extends Lift<AsTask, unknown> | Ensuring,
  item,
>(
  effect: Effect<requirements, item>,
  options: RunTaskOptions = {},
): Promise<TaskExit<item>> {
  try {
    return { status: "succeeded", value: await run_task(effect, options) };
  } catch (error) {
    if (is_task_cancellation(error)) {
      return {
        status: "cancelled",
        error,
        reason: options.signal?.reason ?? error.cause,
      };
    }

    return { status: "failed", error };
  }
}

function is_task_value(value: unknown): value is Dictionary {
  return is_kind_of(value, Task);
}

Show.instance(Task)({
  show() {
    return "Task(?)";
  },
});

Functor.instance(Task)({
  map(fn) {
    return Task((signal) => {
      return start_task(this.value(), signal, "Task.map").then((value) => {
        return task_item(fn(value), "Task.map");
      });
    });
  },
});

Applicative.instance(Task)({
  pure(value) {
    return succeed_task(value, "Task.pure");
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const tasks = rest.map((current) => current.value());

    return Task((signal) => {
      return run_concurrently(
        [first, ...tasks],
        signal,
        "Task Applicative.lift",
      )
        .then((values) => {
          return task_item(fn(...values), "Task Applicative.lift");
        });
    });
  },

  ap<from, to>(
    this: Data<AsTask, (value: NoInfer<from>) => to>,
    value: Data<AsTask, from>,
  ): Data<AsTask, to> {
    return Task((signal) => {
      return run_concurrently(
        [this.value() as Task<unknown>, value.value() as Task<unknown>],
        signal,
        "Task.ap",
      ).then(([fn, item]) => {
        return task_item(
          (fn as (value: from) => to)(item as from),
          "Task.ap",
        );
      });
    });
  },
});

Monad.instance(Task)({
  bind(fn) {
    return Task((signal) => {
      return start_task(this.value(), signal, "Task.bind").then((value) => {
        return start_task(fn(value).value(), signal, "Task.bind");
      });
    });
  },
});

MonadRec.instance(Task)({
  tail_rec_m(initial, step) {
    return Task(async (signal) => {
      let state = initial;

      while (true) {
        const [tag, value] = await start_task(
          step(state).value(),
          signal,
          "Task.tail_rec_m",
        );

        switch (tag) {
          case loop_done:
            return task_item(value, "Task.tail_rec_m");
          case loop_rec:
            state = value;
            break;
        }
      }
    });
  },
});

MonadError.instance(Task)({
  throw_error(error) {
    return Task(() => Promise.reject(error));
  },

  catch_error(handler) {
    return Task((signal) => {
      return start_task(this.value(), signal, "Task.catch_error").catch(
        (error) => {
          if (is_task_cancellation(error)) {
            throw error;
          }

          return start_task(handler(error).value(), signal, "Task.catch_error");
        },
      );
    });
  },
});

function start_task<item>(
  task: Task<item>,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<TaskItem<item>> {
  if (signal?.aborted) {
    return Promise.reject(task_abort_error(operation, signal));
  }

  let pending: Promise<TaskItem<item>>;

  try {
    pending = task(signal);
  } catch (error) {
    return Promise.reject(error);
  }

  return await_with_signal(pending, signal, operation);
}

function succeed_task<item>(value: item, operation: string): TaskValue<item> {
  const resolved = task_item(value, operation);
  return Task(() => Promise.resolve(resolved));
}

function run_concurrently(
  tasks: readonly Task<unknown>[],
  signal: AbortSignal | undefined,
  operation: string,
): Promise<readonly unknown[]> {
  const controller = new AbortController();
  const abort_from_parent = () => controller.abort(signal?.reason);

  if (signal?.aborted) {
    controller.abort(signal.reason);
  } else {
    signal?.addEventListener("abort", abort_from_parent, { once: true });
  }

  let primary_failure: readonly [unknown] | undefined;

  const pending = tasks.map((task) => {
    return start_task(task, controller.signal, operation).catch((error) => {
      if (primary_failure === undefined) {
        primary_failure = [error];
        controller.abort(error);
      }

      throw primary_failure[0];
    });
  });

  return Promise.all(pending).finally(() => {
    signal?.removeEventListener("abort", abort_from_parent);
  });
}

function task_item<item>(value: item, operation: string): TaskItem<item> {
  if (is_thenable(value)) {
    throw new TypeError(
      `${operation} cannot produce a PromiseLike item; use Task.bind for dependent async work`,
    );
  }

  return value as TaskItem<item>;
}

function is_thenable(value: unknown): value is PromiseLike<unknown> {
  if (
    (typeof value !== "object" && typeof value !== "function") || value === null
  ) {
    return false;
  }

  return typeof (value as { readonly then?: unknown }).then === "function";
}

function await_with_signal<item>(
  pending: Promise<item>,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<item> {
  if (signal === undefined) {
    return pending;
  }

  if (signal.aborted) {
    return Promise.reject(task_abort_error(operation, signal));
  }

  return new Promise((resolve, reject) => {
    const abort = () => reject(task_abort_error(operation, signal));
    signal.addEventListener("abort", abort, { once: true });

    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function task_abort_error(operation: string, signal: AbortSignal): Error {
  const reason = signal.reason;
  let message = `${operation} was aborted`;

  if (reason instanceof Error) {
    message += `: ${reason.message}`;
  } else if (reason !== undefined) {
    message += `: ${String(reason)}`;
  }

  const error = new Error(message, { cause: reason });
  error.name = "AbortError";

  return error;
}

/** Tests whether an unknown failure represents Task cancellation. */
export function is_task_cancellation(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

async function finalize_successful_effect(
  finalize: EffectFinalizer,
): Promise<void> {
  try {
    await finalize({ status: "succeeded" });
  } catch (cause) {
    throw new Error("Effect finalizer failed after Task success", { cause });
  }
}

async function finalize_failed_effect(
  finalize: EffectFinalizer,
  failure: unknown,
): Promise<never> {
  try {
    await finalize({ status: "failed", error: failure });
  } catch (finalizer_failure) {
    throw new AggregateError(
      [failure, finalizer_failure],
      "Effect and its finalizer both failed while running Task",
    );
  }

  throw failure;
}

async function finalize_cancelled_effect(
  finalize: EffectFinalizer,
  cancellation: Error,
  reason: unknown,
): Promise<never> {
  try {
    await finalize({ status: "cancelled", reason });
  } catch (finalizer_failure) {
    throw new AggregateError(
      [cancellation, finalizer_failure],
      "Effect cancellation and its finalizer both failed while running Task",
    );
  }

  throw cancellation;
}

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
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  MonadError,
  Show,
} from "./typeclasses.ts";

/** @ignore */
export declare const task_identity: unique symbol;

/** Excludes thenables so a Task has one unambiguous asynchronous layer. */
export type TaskItem<item> = Extract<item, PromiseLike<unknown>> extends never
  ? item
  : never;

/** Deferred async work whose resolved item cannot itself be a thenable. */
export type Task<item> = () => Promise<TaskItem<item>>;

/** Options shared by Task constructors. */
export type TaskOptions = {
  /** Cancels waiting for the task when aborted. */
  readonly signal?: AbortSignal;
};

/** The callable dictionary for deferred Task computations. */
export interface AsTask
  extends As<AsTask, typeof task_identity>, Show<AsTask>, MonadError<AsTask> {
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
  options: TaskOptions = {},
): TaskValue<item> {
  return Task(() => {
    if (options.signal?.aborted) {
      return Promise.reject(task_abort_error("Task.from_fn", options.signal));
    }

    let pending: Promise<TaskItem<item>>;

    try {
      pending = Promise.resolve(run(options.signal));
    } catch (error) {
      return Promise.reject(error);
    }

    return await_with_signal(pending, options.signal, "Task.from_fn");
  });
}

/** Adopts an already-running promise. Use `from_fn` when work must be deferred. */
export function from_promise<item>(
  promise: PromiseLike<TaskItem<item>>,
  options: TaskOptions = {},
): TaskValue<item> {
  return Task(() => {
    const pending = Promise.resolve(promise);
    return await_with_signal(pending, options.signal, "Task.from_promise");
  });
}

/** Runs an effect containing Task lifts and cleanup scopes. */
export async function run_task<
  requirements extends Lift<AsTask, unknown> | Ensuring,
  item,
>(
  effect: Effect<requirements, item>,
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
          current = current[2](await lifted[1].value()()) as Effect<
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
            );
          } catch (error) {
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
    return Task(() => {
      return start_task(this.value()).then((value) => {
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

    return Task(() => {
      return Promise.all([first, ...tasks].map(start_task)).then((values) => {
        return task_item(fn(...values), "Task Applicative.lift");
      });
    });
  },

  ap(value) {
    return Task(() => {
      return Promise.all([
        start_task(this.value()),
        start_task(value.value()),
      ]).then(([fn, item]) => {
        return task_item(fn(item), "Task.ap");
      });
    });
  },
});

Monad.instance(Task)({
  bind(fn) {
    return Task(() => {
      return start_task(this.value()).then((value) => {
        return start_task(fn(value).value());
      });
    });
  },
});

MonadError.instance(Task)({
  throw_error(error) {
    return Task(() => Promise.reject(error));
  },

  catch_error(handler) {
    return Task(() => {
      return start_task(this.value()).catch((error) => {
        return start_task(handler(error).value());
      });
    });
  },
});

function start_task<item>(task: Task<item>): Promise<TaskItem<item>> {
  try {
    return task();
  } catch (error) {
    return Promise.reject(error);
  }
}

function succeed_task<item>(value: item, operation: string): TaskValue<item> {
  const resolved = task_item(value, operation);
  return Task(() => Promise.resolve(resolved));
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

import type { Runnable } from "./data_value.ts";
import {
  type As,
  type Data,
  data,
  kind,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import {
  Effect,
  type EffectFinalizer,
  type Ensuring,
  handle_operation,
  type Lift,
  type Operation,
  type OperationOutput,
  type TaggedOperation,
  type Uses,
  type WithoutOperation,
} from "./effects.ts";
import { is_kind_of } from "./internal.ts";
import { loop_done, loop_rec } from "./loop.ts";
import { register_traversal } from "./traversal.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  MonadError,
  MonadRec,
  Show,
} from "./typeclasses.ts";
import { type CustomDoRunner, do_runner_method } from "./typeclasses/monad.ts";
import { monad_error_typeclass } from "./typeclasses/monad_error.ts";

/** @ignore */
export const task_identity: unique symbol = /* @__PURE__ */ Symbol(
  "task_identity",
);

/** @ignore */
export const parallel_task_identity: unique symbol = /* @__PURE__ */ Symbol(
  "parallel_task_identity",
);

const task_cancellation = Symbol("Task cancellation");
const protected_promises = new WeakMap<Promise<unknown>, AbortSignal>();
const task_completed = Symbol("Task.completed");
const completed_undefined = Symbol("Task.completed.undefined");
function completed_item(value: unknown): unknown {
  if (value === completed_undefined) return undefined;
  return value;
}
type TaskStep =
  | {
    readonly tag: "map";
    readonly apply: (value: unknown) => unknown;
    readonly operation: string;
  }
  | {
    readonly tag: "bind";
    readonly apply: (value: unknown) => Task<unknown>;
  };
type TaskPlan = TaskStep & { source: RawTask<unknown>; runs: number };
const task_plan = Symbol("Task.plan");
const task_sync = Symbol("Task.sync");
type SyncTaskFn = (signal: AbortSignal | undefined) => unknown;
type PlannedTask = RawTask<unknown> & {
  [task_plan]?: TaskPlan;
  [task_completed]?: unknown;
  [task_sync]?: SyncTaskFn;
};
function plan_of(task: RawTask<unknown>): TaskPlan | undefined {
  return (task as PlannedTask)[task_plan];
}
function completed_of(task: RawTask<unknown>): unknown {
  return (task as PlannedTask)[task_completed];
}
function sync_fn_of(task: RawTask<unknown>): SyncTaskFn | undefined {
  return (task as PlannedTask)[task_sync];
}

/** Excludes thenables so a Task has one unambiguous asynchronous layer. */
export type TaskItem<item> = Extract<item, PromiseLike<unknown>> extends never
  ? item
  : never;

/** Deferred async work whose resolved item cannot itself be a thenable. */
export type RawTask<item> = (
  signal?: AbortSignal,
) => Promise<TaskItem<item>>;

/** Options supplied when running Task effects. */
export type RunTaskOptions = {
  /** Cancels the whole composed computation when aborted. */
  readonly signal?: AbortSignal;
  /** Yields to the host after this many pure plan steps; disabled by default. */
  readonly yield_every?: number;
  /** Optional host scheduler used with `yield_every`. */
  readonly schedule?: () => Promise<void>;
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

/** @ignore */
export interface AsTaskLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawTask<this[typeof type_item]>;
}

/** The callable dictionary for deferred Task computations. */
export interface AsTask
  extends
    As<AsTaskLambda, typeof task_identity>,
    Show<AsTask>,
    MonadError<AsTask>,
    MonadRec<AsTask>,
    Runnable {
}

/** A wrapped Task value with its dictionary operations. */
export type Task<item> = Data<AsTask, item>;

/** The Task dictionary and constructor. */
export const Task: AsTask = data<AsTask>(task_identity);

/** The raw deferred function carried by a parallel Task. */
export type RawParallelTask<item> = RawTask<item>;

/** @ignore */
export interface AsParallelTaskLambda {
  readonly [type_item]: unknown;
  readonly [type_data]: RawParallelTask<this[typeof type_item]>;
}

/** Deferred tasks whose Applicative instance runs independent work concurrently. */
export interface AsParallelTask
  extends
    As<AsParallelTaskLambda, typeof parallel_task_identity>,
    Show<AsParallelTask>,
    Applicative<AsParallelTask>,
    Runnable {
}

/** A Task using the concurrent, applicative-only dictionary. */
export type ParallelTask<item> = Data<AsParallelTask, item>;

/** The parallel Task dictionary and constructor. */
export const ParallelTask: AsParallelTask = data<AsParallelTask>(
  parallel_task_identity,
);

/** Selects concurrent Applicative composition without starting this Task. */
export function parallel<item>(task: Task<item>): ParallelTask<item> {
  return ParallelTask(task.value());
}

/** Selects sequential Monad composition without starting this parallel Task. */
export function sequential<item>(
  task: ParallelTask<item>,
): Task<item> {
  return Task(task.value());
}

/** Operations supported by the Task terminal runners. */
export type TaskRequirements =
  | Lift<AsTask, unknown>
  | Lift<AsParallelTask, unknown>
  | Ensuring;

/** The item produced by a Task runner input, including unions of inputs. */
export type RunTaskItem<value> = value extends
  Effect<TaskRequirements, infer item> ? item
  : value extends Task<infer item> | ParallelTask<infer item> ? item
  : never;

/** Creates a Task that succeeds with a non-thenable value. */
export function succeed<item>(value: item & TaskItem<item>): Task<item> {
  return succeed_task(value, "Task.succeed");
}

/** Defers asynchronous work until the returned Task is run. */
export function from_fn<item>(
  run: (signal: AbortSignal | undefined) => PromiseLike<TaskItem<item>>,
): Task<item>;
/** Defers synchronous work with the same cold and cancellation semantics. */
export function from_fn<item>(
  run: (signal: AbortSignal | undefined) => TaskItem<item>,
): Task<item>;
/** Infers the resolved item when the thunk conditionally returns async work. */
export function from_fn<item>(
  run: (signal: AbortSignal | undefined) => item | PromiseLike<item>,
): Task<Awaited<item>>;
export function from_fn(
  run: (signal: AbortSignal | undefined) => unknown,
): Task<unknown> {
  const raw: PlannedTask = (signal) => {
    if (signal?.aborted) {
      return Promise.reject(task_abort_error("Task.from_fn", signal));
    }

    let pending: Promise<unknown>;

    try {
      pending = Promise.resolve(run(signal));
    } catch (error) {
      return Promise.reject(error);
    }

    return await_with_signal(pending, signal, "Task.from_fn");
  };
  raw[task_sync] = run;
  return Task(raw);
}

/** Adopts an already-running promise. Use `from_fn` when work must be deferred. */
export function from_promise<item>(
  promise: PromiseLike<TaskItem<item>>,
): Task<item> {
  const pending = Promise.resolve(promise);
  // Adoption takes responsibility for rejection immediately, even if the Task
  // is run later or starts with an already-aborted signal.
  void pending.catch(ignore_failure);
  return Task((signal) =>
    await_with_signal(pending, signal, "Task.from_promise")
  );
}

/**
 * Handles selected operations as deferred Tasks.
 *
 * The handler receives the signal supplied to `run_task`; unmatched operations
 * remain suspended for later handlers.
 */
export function handle_operation_task<
  requirements,
  selected extends TaggedOperation & Operation<unknown>,
  item,
>(
  effect: Effect<requirements, item>,
  select: (operation: unknown) => operation is selected,
  handle: (
    operation: selected,
    signal: AbortSignal | undefined,
  ) => Promise<TaskItem<OperationOutput<selected>>>,
): Effect<
  WithoutOperation<requirements, selected> | Uses<AsTask>,
  item
> {
  return handle_operation(
    effect,
    select,
    (operation) =>
      Effect.lift<AsTask, OperationOutput<selected>>(
        from_fn<OperationOutput<selected>>((signal) =>
          handle(operation, signal)
        ),
      ),
  );
}

/** Runs a Task value or an effect containing only Task lifts and cleanup scopes. */
export async function run_task<
  requirements extends TaskRequirements = TaskRequirements,
  item = unknown,
  value extends
    | Task<unknown>
    | ParallelTask<unknown>
    | Effect<TaskRequirements, unknown> =
      | Effect<requirements, item>
      | Task<item>
      | ParallelTask<item>,
>(
  value: value,
  options: RunTaskOptions = {},
): Promise<RunTaskItem<value>> {
  if (
    options.yield_every !== undefined &&
    (!Number.isInteger(options.yield_every) || options.yield_every < 1)
  ) {
    throw new RangeError("Task yield_every must be a positive integer");
  }
  if (is_task_value(value)) {
    const task = value.value();
    if (options.signal?.aborted) {
      throw task_abort_error("run_task", options.signal);
    }
    const completed = completed_of(task);
    if (completed !== undefined) {
      return completed_item(completed) as RunTaskItem<value>;
    }
    const sync_fn = sync_fn_of(task);
    if (sync_fn !== undefined) {
      const raw = sync_fn(options.signal);
      if (is_thenable(raw)) {
        const pending = raw instanceof Promise ? raw : Promise.resolve(raw);
        return await await_with_signal(
          pending,
          options.signal,
          "Task.from_fn",
        ) as RunTaskItem<value>;
      }
      if (options.signal?.aborted) {
        throw task_abort_error("Task.from_fn", options.signal);
      }
      return raw as RunTaskItem<value>;
    }
    return await start_task(
      task,
      options.signal,
      "run_task",
      options,
    ) as RunTaskItem<
      value
    >;
  }
  let current = value as Effect<TaskRequirements, unknown>;

  while (true) {
    switch (current[0]) {
      case "pure":
        if (options.signal?.aborted) {
          throw task_abort_error("run_task", options.signal);
        }
        return current[1] as RunTaskItem<value>;
      case "impure": {
        const operation = current[1] as readonly [string, unknown];

        if (operation[0] === "lift" && is_task_value(operation[1])) {
          const lifted = current[1] as unknown as Lift<AsTask, unknown>;
          const task = lifted[1].value();
          if (options.signal?.aborted) {
            throw task_abort_error("run_task", options.signal);
          }
          let value: unknown;
          const completed = completed_of(task);
          if (completed !== undefined) value = completed_item(completed);
          else {
            const sync_fn = sync_fn_of(task);
            if (sync_fn !== undefined) {
              const raw = sync_fn(options.signal);
              if (is_thenable(raw)) {
                const pending = raw instanceof Promise
                  ? raw
                  : Promise.resolve(raw);
                value = await await_with_signal(
                  pending,
                  options.signal,
                  "Task.from_fn",
                );
              } else {
                if (options.signal?.aborted) {
                  throw task_abort_error("Task.from_fn", options.signal);
                }
                value = raw;
              }
            } else {
              value = await start_task(
                task,
                options.signal,
                "run_task",
                options,
              );
            }
          }
          current = current[2](value) as Effect<
            TaskRequirements,
            unknown
          >;
          continue;
        }

        if (operation[0] === "effect.ensuring") {
          let [, scope] = current[1] as Ensuring;
          while (scope.prepare !== undefined) scope = scope.prepare();
          let value: unknown;

          try {
            value = await run_task(
              scope.effect as Effect<
                TaskRequirements,
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
            TaskRequirements,
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

/** Observes a Task value or an effect containing only Task lifts and cleanup scopes. */
export async function run_task_exit<
  requirements extends TaskRequirements = TaskRequirements,
  item = unknown,
  value extends
    | Task<unknown>
    | ParallelTask<unknown>
    | Effect<TaskRequirements, unknown> =
      | Effect<requirements, item>
      | Task<item>
      | ParallelTask<item>,
>(
  value: value,
  options: RunTaskOptions = {},
): Promise<TaskExit<RunTaskItem<value>>> {
  try {
    return { status: "succeeded", value: await run_task(value, options) };
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

function is_task_value(
  value: unknown,
): value is Task<unknown> | ParallelTask<unknown> {
  return is_kind_of(value, Task) || is_kind_of(value, ParallelTask);
}

Show.instance(Task)({
  show() {
    return "Task(?)";
  },
});

Functor.instance(Task)({
  map(fn) {
    return Task(compose_task(this.value(), {
      tag: "map",
      apply: fn,
      operation: "Task.map",
    }));
  },
});

Applicative.instance(Task)({
  pure(value) {
    return succeed_task(value, "Task.pure");
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    if (rest.length === 0) {
      return Task(compose_task(first, {
        tag: "map",
        apply: fn,
        operation: "Task Applicative.lift",
      }));
    }
    if (rest.length === 1) {
      const second = rest[0].value();
      return Task(async (signal) => {
        if (signal?.aborted) {
          throw task_abort_error("Task Applicative.lift", signal);
        }
        let a: unknown;
        const c1 = completed_of(first);
        if (c1 !== undefined) a = completed_item(c1);
        else {
          const s1 = sync_fn_of(first);
          if (s1 !== undefined) {
            const r1 = s1(signal);
            a = is_thenable(r1)
              ? await await_with_signal(
                r1 instanceof Promise ? r1 : Promise.resolve(r1),
                signal,
                "Task Applicative.lift",
              )
              : r1;
          } else a = await start_task(first, signal, "Task Applicative.lift");
        }
        if (signal?.aborted) {
          throw task_abort_error("Task Applicative.lift", signal);
        }
        let b: unknown;
        const c2 = completed_of(second);
        if (c2 !== undefined) b = completed_item(c2);
        else {
          const s2 = sync_fn_of(second);
          if (s2 !== undefined) {
            const r2 = s2(signal);
            b = is_thenable(r2)
              ? await await_with_signal(
                r2 instanceof Promise ? r2 : Promise.resolve(r2),
                signal,
                "Task Applicative.lift",
              )
              : r2;
          } else b = await start_task(second, signal, "Task Applicative.lift");
        }
        if (signal?.aborted) {
          throw task_abort_error("Task Applicative.lift", signal);
        }
        return task_item(fn(a, b), "Task Applicative.lift");
      });
    }
    const tasks = [first, ...rest.map((current) => current.value())];
    return Task(async (signal) => {
      const values = new Array<unknown>(tasks.length);
      for (let i = 0; i < tasks.length; i += 1) {
        if (signal?.aborted) {
          throw task_abort_error("Task Applicative.lift", signal);
        }
        const task = tasks[i];
        const comp = completed_of(task);
        if (comp !== undefined) values[i] = completed_item(comp);
        else {
          const s = sync_fn_of(task);
          if (s !== undefined) {
            const raw = s(signal);
            values[i] = is_thenable(raw)
              ? await await_with_signal(
                raw instanceof Promise ? raw : Promise.resolve(raw),
                signal,
                "Task Applicative.lift",
              )
              : raw;
          } else {
            values[i] = await start_task(task, signal, "Task Applicative.lift");
          }
        }
      }
      if (signal?.aborted) {
        throw task_abort_error("Task Applicative.lift", signal);
      }
      return task_item(fn(...values), "Task Applicative.lift");
    });
  },

  ap(value) {
    const first = this.value();
    const second = value.value();
    return Task(async (signal) => {
      if (signal?.aborted) throw task_abort_error("Task.ap", signal);
      let fn: unknown;
      const c1 = completed_of(first);
      if (c1 !== undefined) fn = completed_item(c1);
      else {
        const s1 = sync_fn_of(first);
        if (s1 !== undefined) {
          const r1 = s1(signal);
          fn = is_thenable(r1)
            ? await await_with_signal(
              r1 instanceof Promise ? r1 : Promise.resolve(r1),
              signal,
              "Task.ap",
            )
            : r1;
        } else fn = await start_task(first, signal, "Task.ap");
      }
      if (signal?.aborted) throw task_abort_error("Task.ap", signal);
      let item: unknown;
      const c2 = completed_of(second);
      if (c2 !== undefined) item = completed_item(c2);
      else {
        const s2 = sync_fn_of(second);
        if (s2 !== undefined) {
          const r2 = s2(signal);
          item = is_thenable(r2)
            ? await await_with_signal(
              r2 instanceof Promise ? r2 : Promise.resolve(r2),
              signal,
              "Task.ap",
            )
            : r2;
        } else item = await start_task(second, signal, "Task.ap");
      }
      if (signal?.aborted) throw task_abort_error("Task.ap", signal);
      return task_item(
        (fn as (item: unknown) => unknown)(item),
        "Task.ap",
      ) as never;
    });
  },
});

Show.instance(ParallelTask)({
  show() {
    return "ParallelTask(?)";
  },
});

Functor.instance(ParallelTask)({
  map(fn) {
    return ParallelTask(compose_task(this.value(), {
      tag: "map",
      apply: fn,
      operation: "ParallelTask.map",
    }));
  },
});

Applicative.instance(ParallelTask)({
  pure(value) {
    return ParallelTask(completed_raw_task(value, "ParallelTask.pure"));
  },

  [applicative_lift_method](fn, rest) {
    const all_tasks: RawTask<unknown>[] = [this.value()];
    for (let i = 0; i < rest.length; i += 1) all_tasks.push(rest[i].value());

    return ParallelTask((signal) =>
      run_concurrently(
        all_tasks,
        signal,
        "ParallelTask Applicative.lift",
        (values) => fn(...values),
      )
    );
  },

  ap<from, to>(
    this: Data<AsParallelTask, (value: NoInfer<from>) => to>,
    value: Data<AsParallelTask, from>,
  ): Data<AsParallelTask, to> {
    const pair: readonly RawTask<unknown>[] = [
      this.value() as RawTask<unknown>,
      value.value() as RawTask<unknown>,
    ];
    return ParallelTask((signal) =>
      run_concurrently(
        pair,
        signal,
        "ParallelTask.ap",
        ([fn, item]) => (fn as (value: from) => to)(item as from),
      )
    );
  },
});

Monad.instance(Task)({
  bind(fn) {
    return Task(compose_task(this.value(), {
      tag: "bind",
      apply: fn,
    }));
  },
});

MonadRec.instance(Task)({
  tail_rec_m(initial, step) {
    return Task(async (signal) => {
      let state = initial;

      while (true) {
        const task = step(state).value();
        if (signal?.aborted) throw task_abort_error("Task.tail_rec_m", signal);
        let instruction: Awaited<ReturnType<typeof task>>;
        const completed = completed_of(task);
        if (completed !== undefined) {
          instruction = completed_item(completed) as typeof instruction;
        } else {
          const sync_fn = sync_fn_of(task);
          if (sync_fn !== undefined) {
            const raw = sync_fn(signal);
            if (is_thenable(raw)) {
              const pending = raw instanceof Promise
                ? raw
                : Promise.resolve(raw);
              instruction = await await_with_signal(
                pending,
                signal,
                "Task.from_fn",
              ) as typeof instruction;
            } else {
              if (signal?.aborted) {
                throw task_abort_error("Task.from_fn", signal);
              }
              instruction = raw as typeof instruction;
            }
          } else {
            instruction = await start_task(task, signal, "Task.tail_rec_m");
          }
        }
        const [tag, value] = instruction;

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
    return Task((signal) =>
      signal?.aborted
        ? Promise.reject(task_abort_error("Task.throw_error", signal))
        : Promise.reject(error)
    );
  },

  catch_error(handler) {
    const first = this.value();
    const on_error = (signal: AbortSignal | undefined) => (error: unknown) => {
      if (is_task_cancellation(error)) throw error;
      return start_task(handler(error).value(), signal, "Task.catch_error");
    };
    const raw: PlannedTask = (signal) =>
      start_task(first, signal, "Task.catch_error").catch(on_error(signal));
    raw[task_sync] = (signal) => {
      if (signal?.aborted) throw task_abort_error("Task.catch_error", signal);
      const completed = completed_of(first);
      if (completed !== undefined) return completed_item(completed);
      const sync_fn = sync_fn_of(first);
      if (sync_fn !== undefined) {
        try {
          const out = sync_fn(signal);
          if (is_thenable(out)) {
            const p = out instanceof Promise ? out : Promise.resolve(out);
            return await_with_signal(p, signal, "Task.catch_error").catch(
              on_error(signal),
            );
          }
          if (signal?.aborted) {
            throw task_abort_error("Task.catch_error", signal);
          }
          return out;
        } catch (error) {
          if (is_task_cancellation(error)) throw error;
          const recovery = handler(error).value();
          const rc = completed_of(recovery);
          if (rc !== undefined) return completed_item(rc);
          const rs = sync_fn_of(recovery);
          if (rs !== undefined) {
            const rout = rs(signal);
            if (is_thenable(rout)) {
              const rp = rout instanceof Promise ? rout : Promise.resolve(rout);
              return await_with_signal(rp, signal, "Task.catch_error");
            }
            if (signal?.aborted) {
              throw task_abort_error("Task.catch_error", signal);
            }
            return rout;
          }
          return start_task(recovery, signal, "Task.catch_error");
        }
      }
      return start_task(first, signal, "Task.catch_error").catch(
        on_error(signal),
      );
    };
    return Task(raw);
  },
});

const task_kind = Task[kind];
const canonical_task_bind = Task.bind;
const canonical_task_pure = Task.pure;
const canonical_task_map = Task.map;
const canonical_task_err = (Task as unknown as Record<symbol, unknown>)[
  monad_error_typeclass
];
const task_do: CustomDoRunner = (first_value, first_iterator, run) => {
  const first = first_value as Task<unknown>;
  if (
    first[kind] !== task_kind ||
    first.bind !== canonical_task_bind ||
    first.pure !== canonical_task_pure ||
    first.map !== canonical_task_map ||
    (first as unknown as Record<symbol, unknown>)[monad_error_typeclass] !==
      canonical_task_err
  ) return undefined;
  let first_claimed = false;
  return Task(async (signal) => {
    if (signal?.aborted) throw task_abort_error("Task", signal);
    let iter: Generator<unknown, unknown, unknown>;
    let current: unknown;
    if (!first_claimed) {
      first_claimed = true;
      iter = first_iterator;
      current = first_value;
    } else {
      iter = run();
      const n0 = iter.next();
      if (n0.done) return task_item(n0.value, "Task.pure");
      current = n0.value;
    }
    while (true) {
      if (signal?.aborted) throw task_abort_error("Task", signal);
      const task = (current as Task<unknown>).value();
      let failed = false;
      let val: unknown;
      let err: unknown;
      const completed = completed_of(task);
      if (completed !== undefined) {
        val = completed_item(completed);
      } else {
        const sync_fn = sync_fn_of(task);
        if (sync_fn !== undefined) {
          try {
            const raw = sync_fn(signal);
            if (is_thenable(raw)) {
              const p = raw instanceof Promise ? raw : Promise.resolve(raw);
              val = await await_with_signal(p, signal, "Task.from_fn");
            } else {
              if (signal?.aborted) {
                throw task_abort_error("Task.from_fn", signal);
              }
              val = raw;
            }
          } catch (error) {
            if (is_task_cancellation(error)) throw error;
            failed = true;
            err = error;
          }
        } else {
          try {
            val = await start_task(task, signal, "Task");
          } catch (error) {
            if (is_task_cancellation(error)) throw error;
            failed = true;
            err = error;
          }
        }
      }
      const next = failed ? iter.throw(err) : iter.next(val);
      if (next.done) return task_item(next.value, "Task.pure");
      current = next.value;
    }
  });
};
Object.defineProperty(Task, do_runner_method, { value: task_do });

function start_task<item>(
  task: RawTask<item>,
  signal: AbortSignal | undefined,
  operation: string,
  options: RunTaskOptions = {},
): Promise<TaskItem<item>> {
  if (signal?.aborted) {
    return Promise.reject(task_abort_error(operation, signal));
  }

  let pending: Promise<TaskItem<item>>;

  try {
    const plan = plan_of(task as RawTask<unknown>);
    if (plan !== undefined) {
      pending = evaluate_task(plan, signal, options) as Promise<TaskItem<item>>;
      if (signal !== undefined) protected_promises.set(pending, signal);
    } else pending = task(signal);
  } catch (error) {
    return Promise.reject(error);
  }

  return await_with_signal(pending, signal, operation);
}

function succeed_task<item>(value: item, operation: string): Task<item> {
  return Task(completed_raw_task(value, operation));
}
function completed_raw_task<item>(
  value: item,
  operation: string,
): RawTask<item> {
  const resolved = task_item(value, operation);
  const task: RawTask<item> = (signal) => {
    if (signal?.aborted) {
      return Promise.reject(task_abort_error(operation, signal));
    }
    return Promise.resolve(resolved);
  };
  let stored: unknown = resolved;
  if (stored === undefined) stored = completed_undefined;
  (task as PlannedTask)[task_completed] = stored;
  return task;
}

function run_concurrently<result>(
  tasks: readonly RawTask<unknown>[],
  signal: AbortSignal | undefined,
  operation: string,
  apply: (values: readonly unknown[]) => result,
): Promise<TaskItem<result>> {
  if (signal?.aborted) {
    return Promise.reject(task_abort_error(operation, signal));
  }
  const len = tasks.length;
  const values = new Array<unknown>(len);
  let sync_prefix = 0;
  let first_settled: Promise<unknown> | undefined;
  let first_settled_index = -1;
  for (let index = 0; index < len; index += 1) {
    const task = tasks[index];
    const completed = completed_of(task);
    if (completed !== undefined) {
      values[index] = completed_item(completed);
      sync_prefix = index + 1;
      continue;
    }
    const sync_fn = sync_fn_of(task);
    if (sync_fn !== undefined && sync_fn.length === 0) {
      try {
        const raw = sync_fn(undefined);
        if (!is_thenable(raw)) {
          if (signal?.aborted) {
            return Promise.reject(task_abort_error(operation, signal));
          }
          values[index] = raw;
          sync_prefix = index + 1;
          continue;
        }
        first_settled = raw instanceof Promise ? raw : Promise.resolve(raw);
        first_settled_index = index;
        break;
      } catch (error) {
        first_settled = Promise.reject(error);
        first_settled_index = index;
        break;
      }
    }
    break;
  }
  if (sync_prefix === len) {
    try {
      return Promise.resolve(task_item(apply(values), operation));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const controller = new AbortController();
  const child_signal = controller.signal;

  return new Promise<TaskItem<result>>((resolve, reject) => {
    let settled = false;
    let remaining = len - sync_prefix;

    const cleanup = () => {
      signal?.removeEventListener("abort", abort_from_parent);
    };
    const abort_from_parent = () => {
      controller.abort(signal?.reason);
      if (!settled) {
        settled = true;
        cleanup();
        reject(task_abort_error(operation, signal!));
      }
    };
    const on_err = (error: unknown) => {
      if (!settled) {
        settled = true;
        cleanup();
        controller.abort(error);
        reject(error);
      }
    };
    const finish_if_done = () => {
      if (remaining === 0 && !settled) {
        settled = true;
        cleanup();
        try {
          resolve(task_item(apply(values), operation));
        } catch (error) {
          reject(error);
        }
      }
    };

    if (signal?.aborted) {
      abort_from_parent();
      return;
    }
    signal?.addEventListener("abort", abort_from_parent, { once: true });

    const attach = (index: number, promise: Promise<unknown>) => {
      promise.then(
        (resolved) => {
          if (settled) return;
          values[index] = resolved;
          remaining -= 1;
          finish_if_done();
        },
        on_err,
      );
    };

    let start_from = sync_prefix;
    if (first_settled !== undefined) {
      attach(first_settled_index, first_settled);
      start_from = first_settled_index + 1;
    }
    for (let index = start_from; index < len; index += 1) {
      const task = tasks[index];
      const completed = completed_of(task);
      if (completed !== undefined) {
        values[index] = completed_item(completed);
        remaining -= 1;
        continue;
      }
      const sync_fn = sync_fn_of(task);
      if (sync_fn !== undefined && sync_fn.length === 0) {
        try {
          const raw = sync_fn(undefined);
          if (!is_thenable(raw)) {
            values[index] = raw;
            remaining -= 1;
            continue;
          }
          attach(index, raw instanceof Promise ? raw : Promise.resolve(raw));
        } catch (error) {
          attach(index, Promise.reject(error));
        }
        continue;
      }
      let child: Promise<unknown>;
      try {
        const plan = plan_of(task);
        child = plan !== undefined
          ? evaluate_task(plan, child_signal, {})
          : task(child_signal);
      } catch (error) {
        child = Promise.reject(error);
      }
      attach(index, child);
    }
    finish_if_done();
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
  if (signal === undefined || protected_promises.get(pending) === signal) {
    return pending;
  }

  if (signal.aborted) {
    void pending.catch(ignore_failure);
    return Promise.reject(task_abort_error(operation, signal));
  }

  const protected_pending = new Promise<item>((resolve, reject) => {
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
  protected_promises.set(protected_pending, signal);
  return protected_pending;
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
  Object.defineProperty(error, task_cancellation, { value: true });

  return error;
}

/** Tests whether an unknown failure represents Task cancellation. */
export function is_task_cancellation(error: unknown): error is Error {
  return error instanceof Error && task_cancellation in error;
}

/** @ignore Throws a Task cancellation error when `signal` is already aborted. */
export function task_check_signal(
  signal: AbortSignal | undefined,
  operation = "run_task",
): void {
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
}

/** @ignore Awaits a value or PromiseLike while racing against an AbortSignal. */
export function task_await_signal<item>(
  value: item | PromiseLike<item>,
  signal: AbortSignal | undefined,
  operation = "Task.from_fn",
): Promise<Awaited<item>> | item {
  if (is_thenable(value)) {
    const pending = value instanceof Promise ? value : Promise.resolve(value);
    return await_with_signal(pending, signal, operation) as Promise<
      Awaited<item>
    >;
  }
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
  return value;
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

function ignore_failure(_error: unknown): void {}

/** Lazily traverses inputs with bounded concurrency, preserving input order.
 * Failure or cancellation stops admission and signals active siblings.
 */
export function traverse_task<input, output>(
  inputs: Iterable<input>,
  concurrency: number,
  fn: (input: input, index: number) => Task<output>,
  options: RunTaskOptions = {},
): Task<readonly output[]> {
  if (
    options.yield_every !== undefined &&
    (!Number.isInteger(options.yield_every) || options.yield_every < 1)
  ) {
    throw new RangeError("Task yield_every must be a positive integer");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      "Task traversal concurrency must be a positive integer",
    );
  }
  return Task<readonly output[]>((parent_signal) => {
    const pending = traverse(parent_signal);
    // The workers observe cancellation and finish iterator cleanup before the
    // public Task settles, including when cleanup itself fails.
    if (parent_signal !== undefined) {
      protected_promises.set(pending, parent_signal);
    }
    return pending;
  });
  async function traverse(
    parent_signal: AbortSignal | undefined,
  ): Promise<readonly output[]> {
    const array_inputs = Array.isArray(inputs)
      ? (inputs as readonly input[])
      : undefined;
    if (
      array_inputs !== undefined &&
      parent_signal === undefined &&
      options.signal === undefined
    ) {
      const len = array_inputs.length;
      const sync_results = new Array<output>(len);
      let idx = 0;
      while (idx < len) {
        const task = fn(array_inputs[idx], idx).value();
        const completed = completed_of(task);
        if (completed !== undefined) {
          sync_results[idx] = completed_item(completed) as output;
          idx += 1;
          continue;
        }
        const sync_fn = sync_fn_of(task);
        if (sync_fn !== undefined && sync_fn.length === 0) {
          const raw = sync_fn(undefined);
          if (!is_thenable(raw)) {
            sync_results[idx] = raw as output;
            idx += 1;
            continue;
          }
          if (concurrency === 1) {
            sync_results[idx] = await raw as output;
            idx += 1;
            continue;
          }
          return await traverse_async(
            undefined,
            array_inputs,
            sync_results,
            idx,
            raw instanceof Promise ? raw : Promise.resolve(raw),
          );
        }
        if (concurrency === 1 && plan_of(task) === undefined) {
          sync_results[idx] = await task(undefined);
          idx += 1;
          continue;
        }
        return await traverse_async(
          undefined,
          array_inputs,
          sync_results,
          idx,
          undefined,
          task,
        );
      }
      return sync_results;
    }
    return await traverse_async(
      parent_signal,
      array_inputs,
      array_inputs !== undefined ? new Array<output>(array_inputs.length) : [],
      0,
    );
  }
  async function traverse_async(
    parent_signal: AbortSignal | undefined,
    array_inputs: readonly input[] | undefined,
    results: output[],
    start_index: number,
    first_pending?: Promise<unknown>,
    first_task?: RawTask<output>,
  ): Promise<readonly output[]> {
    const controller = new AbortController();
    let signal = controller.signal;
    if (
      parent_signal !== undefined && options.signal !== undefined &&
      parent_signal !== options.signal
    ) {
      signal = AbortSignal.any([parent_signal, options.signal, signal]);
    } else if (parent_signal !== undefined) {
      signal = AbortSignal.any([parent_signal, signal]);
    } else if (options.signal !== undefined) {
      signal = AbortSignal.any([options.signal, signal]);
    }
    if (signal.aborted) throw task_abort_error("Task.traverse", signal);
    const iterator = array_inputs === undefined
      ? inputs[Symbol.iterator]()
      : undefined;
    let next_index = start_index;
    let exhausted = false;
    let failed = false;
    let failure: unknown;
    const waiting = new Set<(error: unknown) => void>();
    const on_abort = () => {
      const err = task_abort_error("Task.traverse", signal);
      for (const reject_waiter of waiting) reject_waiter(err);
      waiting.clear();
    };
    signal.addEventListener("abort", on_abort, { once: true });
    function await_shared<T>(pending: Promise<T>): Promise<T> {
      if (signal.aborted) {
        void pending.catch(ignore_failure);
        return Promise.reject(task_abort_error("Task.traverse", signal));
      }
      return new Promise<T>((resolve, reject) => {
        waiting.add(reject);
        pending.then(
          (val) => {
            waiting.delete(reject);
            resolve(val);
          },
          (err) => {
            waiting.delete(reject);
            reject(err);
          },
        );
      });
    }
    let pending_slot = first_pending;
    let task_slot = first_task;
    async function worker(): Promise<void> {
      while (!signal.aborted && !failed && !exhausted) {
        try {
          if (pending_slot !== undefined) {
            const p = pending_slot;
            pending_slot = undefined;
            const index = next_index++;
            results[index] = await await_shared(p) as output;
            continue;
          }
          let index: number;
          let task: RawTask<output>;
          if (task_slot !== undefined) {
            task = task_slot;
            task_slot = undefined;
            index = next_index++;
          } else if (array_inputs !== undefined) {
            if (next_index >= array_inputs.length) {
              exhausted = true;
              return;
            }
            index = next_index++;
            task = fn(array_inputs[index], index).value();
          } else {
            const next = iterator!.next();
            if (next.done) {
              exhausted = true;
              return;
            }
            index = next_index++;
            task = fn(next.value, index).value();
          }
          const completed = completed_of(task);
          if (completed !== undefined) {
            results[index] = completed_item(completed) as output;
          } else {
            const sync_fn = sync_fn_of(task);
            if (sync_fn !== undefined) {
              const raw = sync_fn(signal);
              if (is_thenable(raw)) {
                const pending = raw instanceof Promise
                  ? raw
                  : Promise.resolve(raw);
                results[index] = await await_shared(pending) as output;
              } else {
                if (signal.aborted) {
                  throw task_abort_error("Task.from_fn", signal);
                }
                results[index] = raw as output;
              }
            } else {
              const plan = plan_of(task as RawTask<unknown>);
              const pending = plan !== undefined
                ? (evaluate_task(plan, signal, options) as Promise<
                  TaskItem<output>
                >)
                : task(signal);
              results[index] = await await_shared(pending);
            }
          }
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = error;
            controller.abort(error);
          }
          return;
        }
      }
    }
    try {
      const workers: Promise<void>[] = [];
      for (
        let index = 0;
        index < concurrency && !exhausted && !failed;
        index += 1
      ) workers.push(worker());
      await Promise.all(workers);
      if (failed) throw failure;
      if (signal.aborted) throw task_abort_error("Task.traverse", signal);
      return results;
    } catch (error) {
      if (!exhausted) {
        exhausted = true;
        if (iterator !== undefined) {
          try {
            iterator.return?.();
          } catch (cleanup_error) {
            throw new AggregateError(
              [error, cleanup_error],
              "Task traversal and iterator cleanup both failed",
            );
          }
        }
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", on_abort);
      if (!exhausted) {
        exhausted = true;
        iterator?.return?.();
      }
    }
  }
}

function compose_task<from, to>(
  source: RawTask<from>,
  step: {
    readonly tag: "bind";
    readonly apply: (value: TaskItem<from>) => Task<to>;
  },
): RawTask<to>;
function compose_task<from, to>(
  source: RawTask<from>,
  step: {
    readonly tag: "map";
    readonly apply: (value: TaskItem<from>) => to;
    readonly operation: string;
  },
): RawTask<to>;
function compose_task(
  source: RawTask<unknown>,
  step: TaskStep,
): RawTask<unknown> {
  const plan = step as TaskPlan;
  plan.source = source;
  plan.runs = 0;
  const task: RawTask<unknown> = (signal) => {
    const pending = evaluate_task(plan, signal, {});
    if (signal !== undefined) protected_promises.set(pending, signal);
    return pending;
  };
  (task as PlannedTask)[task_plan] = plan;
  return task;
}

type CompiledTask = {
  readonly source: RawTask<unknown>;
  readonly frames: readonly TaskStep[];
};
const compiled_tasks = new Map<TaskPlan, CompiledTask>();
let compiled_task_frames = 0;
function compile_task(plan: TaskPlan): CompiledTask {
  const cached = compiled_tasks.get(plan);
  if (cached !== undefined) return cached;
  const frames: TaskStep[] = [plan];
  let source = plan.source;
  let nested = plan_of(source);
  while (nested !== undefined) {
    frames.push(nested);
    source = nested.source;
    nested = plan_of(source);
  }
  frames.reverse();
  const segment = { source, frames };
  plan.runs += 1;
  if (frames.length <= 4096 && (frames.length >= 16 || plan.runs >= 2)) {
    compiled_tasks.set(plan, segment);
    compiled_task_frames += frames.length;
    while (compiled_task_frames > 4096) {
      const [oldest, cached] = compiled_tasks.entries().next().value!;
      compiled_tasks.delete(oldest);
      compiled_task_frames -= cached.frames.length;
    }
  }
  return segment;
}
async function evaluate_task(
  initial_plan: TaskPlan,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): Promise<unknown> {
  let plan = initial_plan;
  let steps = 0;
  const yield_every = options.yield_every;
  // Fast path: single-frame right-nested chains avoid compile_task & Map overhead.
  while (plan_of(plan.source) === undefined) {
    if (signal?.aborted) throw task_abort_error("Task plan", signal);
    const src = plan.source;
    const completed = completed_of(src);
    let value: unknown;
    if (completed !== undefined) {
      value = completed_item(completed);
    } else {
      const sync_fn = sync_fn_of(src);
      if (sync_fn !== undefined) {
        const raw = sync_fn(signal);
        if (is_thenable(raw)) {
          const pending = raw instanceof Promise ? raw : Promise.resolve(raw);
          value = await await_with_signal(pending, signal, "Task.from_fn");
        } else {
          if (signal?.aborted) throw task_abort_error("Task.from_fn", signal);
          value = raw;
        }
      } else {
        value = await start_task(src, signal, "Task plan");
      }
    }
    if (signal?.aborted) throw task_abort_error("Task plan", signal);
    if (yield_every !== undefined && ++steps >= yield_every) {
      steps = 0;
      const scheduled = options.schedule !== undefined
        ? options.schedule()
        : new Promise<void>((resolve) => setTimeout(resolve, 0));
      await await_with_signal(scheduled, signal, "Task scheduler");
      if (signal?.aborted) throw task_abort_error("Task plan", signal);
    }
    if (plan.tag === "map") {
      return task_item(plan.apply(value), plan.operation);
    }
    const next_raw = plan.apply(value).value();
    const next_plan = plan_of(next_raw);
    if (next_plan === undefined) {
      const next_completed = completed_of(next_raw);
      if (next_completed !== undefined) return completed_item(next_completed);
      const next_sync = sync_fn_of(next_raw);
      if (next_sync !== undefined) {
        const raw = next_sync(signal);
        if (is_thenable(raw)) {
          const pending = raw instanceof Promise ? raw : Promise.resolve(raw);
          return await await_with_signal(pending, signal, "Task.from_fn");
        }
        if (signal?.aborted) throw task_abort_error("Task.from_fn", signal);
        return raw;
      }
      return await start_task(next_raw, signal, "Task plan");
    }
    plan = next_plan;
  }

  let segment = compile_task(plan);
  let pending: { segment: CompiledTask; index: number }[] | undefined;
  let index = 0;
  let current = segment.source;
  let value: unknown;
  while (true) {
    if (signal?.aborted) throw task_abort_error("Task plan", signal);
    const completed = completed_of(current);
    if (completed !== undefined) value = completed_item(completed);
    else {
      const sync_fn = sync_fn_of(current);
      if (sync_fn !== undefined) {
        const raw = sync_fn(signal);
        if (is_thenable(raw)) {
          const p = raw instanceof Promise ? raw : Promise.resolve(raw);
          value = await await_with_signal(p, signal, "Task.from_fn");
        } else {
          if (signal?.aborted) throw task_abort_error("Task.from_fn", signal);
          value = raw;
        }
      } else {
        value = await start_task(current, signal, "Task plan");
      }
    }
    while (true) {
      if (signal?.aborted) throw task_abort_error("Task plan", signal);
      if (index === segment.frames.length) {
        const previous = pending?.pop();
        if (previous === undefined) return value;
        segment = previous.segment;
        index = previous.index;
        continue;
      }
      const step = segment.frames[index++];
      if (yield_every !== undefined && ++steps >= yield_every) {
        steps = 0;
        let scheduled: Promise<void>;
        if (options.schedule !== undefined) scheduled = options.schedule();
        else scheduled = new Promise((resolve) => setTimeout(resolve, 0));
        await await_with_signal(scheduled, signal, "Task scheduler");
        if (signal?.aborted) throw task_abort_error("Task plan", signal);
      }
      switch (step.tag) {
        case "map": {
          const apply = step.apply;
          value = task_item(apply(value), step.operation);
          break;
        }
        case "bind": {
          const apply = step.apply;
          current = apply(value).value();
          const nested = plan_of(current);
          if (nested !== undefined) {
            if (index < segment.frames.length) {
              pending ??= [];
              pending.push({ segment, index });
            }
            segment = compile_task(nested);
            index = 0;
            current = segment.source;
          }
          break;
        }
      }
      if (step.tag === "bind") break;
    }
  }
}

register_traversal(
  Task,
  <from, to, result>(
    items: Iterable<from>,
    fn: (item: from) => Data<AsTask, to>,
    build: (items: Iterable<to>) => result,
  ): Data<AsTask, result> => {
    let tasks: RawTask<to>[];
    if (Array.isArray(items)) {
      tasks = new Array<RawTask<to>>(items.length);
      for (let i = 0; i < items.length; i += 1) tasks[i] = fn(items[i]).value();
    } else {
      tasks = [];
      for (const item of items) tasks.push(fn(item).value());
    }
    return Task(async (signal) => {
      const out = new Array<to>(tasks.length);
      for (let i = 0; i < tasks.length; i += 1) {
        if (signal?.aborted) throw task_abort_error("Task.traverse", signal);
        const current = tasks[i];
        const completed = completed_of(current);
        if (completed !== undefined) {
          out[i] = completed_item(completed) as to;
        } else {
          const sync_fn = sync_fn_of(current);
          if (sync_fn !== undefined) {
            const raw = sync_fn(signal);
            if (is_thenable(raw)) {
              const p = raw instanceof Promise ? raw : Promise.resolve(raw);
              out[i] = await await_with_signal(
                p,
                signal,
                "Task.from_fn",
              ) as to;
            } else {
              if (signal?.aborted) {
                throw task_abort_error("Task.from_fn", signal);
              }
              out[i] = raw as to;
            }
          } else {
            out[i] = await start_task(current, signal, "Task.traverse");
          }
        }
      }
      return task_item(build(out), "Task.traverse");
    });
  },
  <from, to>(
    items: readonly from[],
    fn: (item: from) => Data<AsTask, to>,
  ): Data<AsTask, to[]> =>
    Task(async (signal) => {
      const len = items.length;
      const out = new Array<to>(len);
      for (let i = 0; i < len; i += 1) {
        if (signal?.aborted) {
          throw task_abort_error("Task.traverse_sequential", signal);
        }
        const current = fn(items[i]).value();
        const completed = completed_of(current);
        if (completed !== undefined) {
          out[i] = completed_item(completed) as to;
        } else {
          const sync_fn = sync_fn_of(current);
          if (sync_fn !== undefined) {
            const raw = sync_fn(signal);
            if (is_thenable(raw)) {
              const p = raw instanceof Promise ? raw : Promise.resolve(raw);
              out[i] = await await_with_signal(
                p,
                signal,
                "Task.from_fn",
              ) as to;
            } else {
              if (signal?.aborted) {
                throw task_abort_error("Task.from_fn", signal);
              }
              out[i] = raw as to;
            }
          } else {
            out[i] = await start_task(
              current,
              signal,
              "Task.traverse_sequential",
            );
          }
        }
      }
      return out;
    }),
);

register_traversal(
  ParallelTask,
  <from, to, result>(
    items: Iterable<from>,
    fn: (item: from) => Data<AsParallelTask, to>,
    build: (items: Iterable<to>) => result,
  ): Data<AsParallelTask, result> => {
    let tasks: RawTask<unknown>[];
    if (Array.isArray(items)) {
      tasks = new Array<RawTask<unknown>>(items.length);
      for (let i = 0; i < items.length; i += 1) tasks[i] = fn(items[i]).value();
    } else {
      tasks = [];
      for (const item of items) tasks.push(fn(item).value());
    }
    return ParallelTask((signal) =>
      run_concurrently(
        tasks,
        signal,
        "ParallelTask.traverse",
        (values) => build(values as readonly to[]),
      )
    );
  },
);

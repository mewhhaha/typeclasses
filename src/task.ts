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
const not_signal_free = Symbol("Task.not_signal_free");
const empty_options: RunTaskOptions = {};

function completed_item(value: unknown): unknown {
  if (value === completed_undefined) return undefined;
  return value;
}

type TaskPlan =
  | {
    readonly tag: "map";
    readonly apply: (value: unknown) => unknown;
    readonly operation: string;
    readonly source: RawTask<unknown>;
    runs: number;
    compiled: CompiledTask | undefined;
  }
  | {
    readonly tag: "bind";
    readonly apply: (value: unknown) => Task<unknown>;
    readonly operation: string;
    readonly source: RawTask<unknown>;
    runs: number;
    compiled: CompiledTask | undefined;
  };
type CompiledTask = {
  readonly source: RawTask<unknown>;
  readonly frames: readonly TaskPlan[];
};
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

function wrap_sync_task<item>(sync_fn: SyncTaskFn): RawTask<item> {
  const raw: PlannedTask = (signal) => {
    try {
      const out = sync_fn(signal);
      if (is_thenable(out)) return out as Promise<unknown>;
      return Promise.resolve(out);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  raw[task_sync] = sync_fn;
  return raw as RawTask<item>;
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

    let out: unknown;
    try {
      out = run(signal);
    } catch (error) {
      return Promise.reject(error);
    }

    if (is_thenable(out)) {
      const pending = out instanceof Promise ? out : Promise.resolve(out);
      return await_with_signal(pending, signal, "Task.from_fn");
    }

    if (signal?.aborted) {
      return Promise.reject(task_abort_error("Task.from_fn", signal));
    }

    return Promise.resolve(out);
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

function finalize_success_maybe_sync(finalize: EffectFinalizer): unknown {
  let out: void | PromiseLike<void>;
  try {
    out = finalize({ status: "succeeded" });
  } catch (cause) {
    throw new Error("Effect finalizer failed after Task success", { cause });
  }
  if (is_thenable(out)) {
    const p = out instanceof Promise ? out : Promise.resolve(out);
    return p.then(undefined, (cause) => {
      throw new Error("Effect finalizer failed after Task success", { cause });
    });
  }
  return undefined;
}

function finalize_failure_maybe_sync(
  finalize: EffectFinalizer,
  error: unknown,
  signal: AbortSignal | undefined,
): Promise<never> | never {
  const cancelled = is_task_cancellation(error);
  let out: void | PromiseLike<void>;
  try {
    out = cancelled
      ? finalize({
        status: "cancelled",
        reason: signal?.reason ?? error.cause,
      })
      : finalize({ status: "failed", error });
  } catch (finalizer_failure) {
    throw new AggregateError(
      [error, finalizer_failure],
      cancelled
        ? "Effect cancellation and its finalizer both failed while running Task"
        : "Effect and its finalizer both failed while running Task",
    );
  }
  if (is_thenable(out)) {
    const p = out instanceof Promise ? out : Promise.resolve(out);
    return p.then(
      () => {
        throw error;
      },
      (finalizer_failure) => {
        throw new AggregateError(
          [error, finalizer_failure],
          cancelled
            ? "Effect cancellation and its finalizer both failed while running Task"
            : "Effect and its finalizer both failed while running Task",
        );
      },
    );
  }
  throw error;
}

async function resume_effect_loop(
  initial: Effect<TaskRequirements, unknown>,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): Promise<unknown> {
  let current = initial;
  while (true) {
    switch (current[0]) {
      case "pure":
        if (signal?.aborted) {
          throw task_abort_error("run_task", signal);
        }
        return current[1];
      case "impure": {
        const operation = current[1] as readonly [string, unknown];

        if (operation[0] === "lift" && is_task_value(operation[1])) {
          const task = (operation[1] as Task<unknown>).value();
          const out = eval_task_maybe_sync(task, signal, "run_task", options);
          const val = is_thenable(out) ? await out : out;
          current = current[2](val) as Effect<TaskRequirements, unknown>;
          continue;
        }

        if (operation[0] === "effect.ensuring") {
          let [, scope] = current[1] as Ensuring;
          while (scope.prepare !== undefined) scope = scope.prepare();
          let value: unknown;
          try {
            const body = run_effect_maybe_sync(
              scope.effect as Effect<TaskRequirements, unknown>,
              signal,
              options,
            );
            value = is_thenable(body) ? await body : body;
          } catch (error) {
            const fin = finalize_failure_maybe_sync(
              scope.finalize,
              error,
              signal,
            );
            await fin;
            throw error;
          }
          const fin = finalize_success_maybe_sync(scope.finalize);
          if (is_thenable(fin)) await fin;
          current = current[2](value) as Effect<TaskRequirements, unknown>;
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

async function resume_effect_task(
  pending: Promise<unknown>,
  resume: (value: unknown) => Effect<TaskRequirements, unknown>,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): Promise<unknown> {
  const val = await pending;
  return await resume_effect_loop(resume(val), signal, options);
}

async function resume_ensuring_effect(
  pending: Promise<unknown>,
  finalize: EffectFinalizer,
  resume: (value: unknown) => Effect<TaskRequirements, unknown>,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): Promise<unknown> {
  let value: unknown;
  try {
    value = await pending;
  } catch (error) {
    const fin = finalize_failure_maybe_sync(finalize, error, signal);
    await fin;
    throw error;
  }
  const fin = finalize_success_maybe_sync(finalize);
  if (is_thenable(fin)) await fin;
  return await resume_effect_loop(resume(value), signal, options);
}

async function resume_ensuring_after_finalizer(
  pending_finalizer: Promise<void>,
  value: unknown,
  resume: (value: unknown) => Effect<TaskRequirements, unknown>,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): Promise<unknown> {
  await pending_finalizer;
  return await resume_effect_loop(resume(value), signal, options);
}

function run_effect_maybe_sync(
  initial: Effect<TaskRequirements, unknown>,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): unknown {
  let current = initial;
  while (true) {
    switch (current[0]) {
      case "pure":
        if (signal?.aborted) {
          throw task_abort_error("run_task", signal);
        }
        return current[1];
      case "impure": {
        const operation = current[1] as readonly [string, unknown];

        if (operation[0] === "lift" && is_task_value(operation[1])) {
          const task = (operation[1] as Task<unknown>).value();
          const out = eval_task_maybe_sync(task, signal, "run_task", options);
          if (is_thenable(out)) {
            return resume_effect_task(
              out as Promise<unknown>,
              current[2] as (
                value: unknown,
              ) => Effect<TaskRequirements, unknown>,
              signal,
              options,
            );
          }
          current = current[2](out) as Effect<TaskRequirements, unknown>;
          continue;
        }

        if (operation[0] === "effect.ensuring") {
          let [, scope] = current[1] as Ensuring;
          while (scope.prepare !== undefined) scope = scope.prepare();
          let body_out: unknown;
          let body_failed = false;
          let body_error: unknown;
          try {
            body_out = run_effect_maybe_sync(
              scope.effect as Effect<TaskRequirements, unknown>,
              signal,
              options,
            );
          } catch (error) {
            body_failed = true;
            body_error = error;
          }
          if (body_failed) {
            return finalize_failure_maybe_sync(
              scope.finalize,
              body_error,
              signal,
            );
          }
          if (is_thenable(body_out)) {
            return resume_ensuring_effect(
              body_out as Promise<unknown>,
              scope.finalize,
              current[2] as (
                value: unknown,
              ) => Effect<TaskRequirements, unknown>,
              signal,
              options,
            );
          }
          const fin_out = finalize_success_maybe_sync(scope.finalize);
          if (is_thenable(fin_out)) {
            return resume_ensuring_after_finalizer(
              fin_out as Promise<void>,
              body_out,
              current[2] as (
                value: unknown,
              ) => Effect<TaskRequirements, unknown>,
              signal,
              options,
            );
          }
          current = current[2](body_out) as Effect<TaskRequirements, unknown>;
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

function run_task_maybe_sync(
  value: unknown,
  options: RunTaskOptions,
): unknown {
  if (
    options.yield_every !== undefined &&
    (!Number.isInteger(options.yield_every) || options.yield_every < 1)
  ) {
    throw new RangeError("Task yield_every must be a positive integer");
  }
  const signal = options.signal;
  if (is_task_value(value)) {
    return eval_task_maybe_sync(value.value(), signal, "run_task", options);
  }
  return run_effect_maybe_sync(
    value as Effect<TaskRequirements, unknown>,
    signal,
    options,
  );
}

/** Runs a Task value or an effect containing only Task lifts and cleanup scopes. */
export function run_task<
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
  options: RunTaskOptions = empty_options,
): Promise<RunTaskItem<value>> {
  try {
    const out = run_task_maybe_sync(value, options);
    if (is_thenable(out)) return out as Promise<RunTaskItem<value>>;
    return Promise.resolve(out as RunTaskItem<value>);
  } catch (error) {
    return Promise.reject(error);
  }
}

function wrap_exit_succeeded<item>(value: item): TaskExit<item> {
  return { status: "succeeded", value };
}

function wrap_exit_error(
  error: unknown,
  signal: AbortSignal | undefined,
): TaskExit<never> {
  if (is_task_cancellation(error)) {
    return {
      status: "cancelled",
      error,
      reason: signal?.reason ?? error.cause,
    };
  }
  return { status: "failed", error };
}

/** Observes a Task value or an effect containing only Task lifts and cleanup scopes. */
export function run_task_exit<
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
  options: RunTaskOptions = empty_options,
): Promise<TaskExit<RunTaskItem<value>>> {
  try {
    const out = run_task_maybe_sync(value, options);
    if (is_thenable(out)) {
      return (out as Promise<RunTaskItem<value>>).then(
        wrap_exit_succeeded,
        (error) => wrap_exit_error(error, options.signal),
      );
    }
    return Promise.resolve({
      status: "succeeded",
      value: out as RunTaskItem<value>,
    });
  } catch (error) {
    return Promise.resolve(wrap_exit_error(error, options.signal));
  }
}

function is_task_value(
  value: unknown,
): value is Task<unknown> | ParallelTask<unknown> {
  return is_kind_of(value, Task) || is_kind_of(value, ParallelTask);
}

async function resume_task_lift2(
  p1: Promise<unknown>,
  second: RawTask<unknown>,
  fn: (a: unknown, b: unknown) => unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const a = await p1;
  const r2 = eval_task_maybe_sync(
    second,
    signal,
    "Task Applicative.lift",
    empty_options,
  );
  const b = is_thenable(r2) ? await r2 : r2;
  if (signal?.aborted) {
    throw task_abort_error("Task Applicative.lift", signal);
  }
  return task_item(fn(a, b), "Task Applicative.lift");
}

async function resume_task_lift2_second(
  a: unknown,
  p2: Promise<unknown>,
  fn: (a: unknown, b: unknown) => unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const b = await p2;
  if (signal?.aborted) {
    throw task_abort_error("Task Applicative.lift", signal);
  }
  return task_item(fn(a, b), "Task Applicative.lift");
}

async function resume_task_lift3(
  pending: Promise<unknown>,
  stage: 0 | 1 | 2,
  a_in: unknown,
  b_in: unknown,
  second: RawTask<unknown>,
  third: RawTask<unknown>,
  fn: (a: unknown, b: unknown, c: unknown) => unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let a = a_in;
  let b = b_in;
  let c: unknown;
  if (stage === 0) {
    a = await pending;
    const r2 = eval_task_maybe_sync(
      second,
      signal,
      "Task Applicative.lift",
      empty_options,
    );
    b = is_thenable(r2) ? await r2 : r2;
    const r3 = eval_task_maybe_sync(
      third,
      signal,
      "Task Applicative.lift",
      empty_options,
    );
    c = is_thenable(r3) ? await r3 : r3;
  } else if (stage === 1) {
    b = await pending;
    const r3 = eval_task_maybe_sync(
      third,
      signal,
      "Task Applicative.lift",
      empty_options,
    );
    c = is_thenable(r3) ? await r3 : r3;
  } else {
    c = await pending;
  }
  if (signal?.aborted) {
    throw task_abort_error("Task Applicative.lift", signal);
  }
  return task_item(fn(a, b, c), "Task Applicative.lift");
}

async function resume_task_lift_many(
  tasks: readonly RawTask<unknown>[],
  values: unknown[],
  start_index: number,
  first_pending: Promise<unknown>,
  fn: (...values: unknown[]) => unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  values[start_index] = await first_pending;
  for (let i = start_index + 1; i < tasks.length; i += 1) {
    const out = eval_task_maybe_sync(
      tasks[i],
      signal,
      "Task Applicative.lift",
      empty_options,
    );
    values[i] = is_thenable(out) ? await out : out;
  }
  if (signal?.aborted) {
    throw task_abort_error("Task Applicative.lift", signal);
  }
  return task_item(fn(...values), "Task Applicative.lift");
}

async function resume_task_ap(
  p1: Promise<unknown>,
  second: RawTask<unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const fn = await p1;
  const r2 = eval_task_maybe_sync(second, signal, "Task.ap", empty_options);
  const item = is_thenable(r2) ? await r2 : r2;
  if (signal?.aborted) throw task_abort_error("Task.ap", signal);
  return task_item((fn as (item: unknown) => unknown)(item), "Task.ap");
}

async function resume_task_ap_second(
  fn: unknown,
  p2: Promise<unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const item = await p2;
  if (signal?.aborted) throw task_abort_error("Task.ap", signal);
  return task_item((fn as (item: unknown) => unknown)(item), "Task.ap");
}

Show.instance(Task)({
  show() {
    return "Task(?)";
  },
});

Functor.instance(Task)({
  map(fn) {
    return Task(compose_map(this.value(), fn, "Task.map"));
  },
});

Applicative.instance(Task)({
  pure(value) {
    return succeed_task(value, "Task.pure");
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const rest_len = rest.length;
    if (rest_len === 0) {
      return Task(compose_map(first, fn, "Task Applicative.lift"));
    }
    if (rest_len === 1) {
      const second = rest[0].value();
      return Task(wrap_sync_task((signal) => {
        const a = eval_task_maybe_sync(
          first,
          signal,
          "Task Applicative.lift",
          empty_options,
        );
        if (is_thenable(a)) {
          const p = resume_task_lift2(
            a as Promise<unknown>,
            second,
            fn,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        const b = eval_task_maybe_sync(
          second,
          signal,
          "Task Applicative.lift",
          empty_options,
        );
        if (is_thenable(b)) {
          const p = resume_task_lift2_second(
            a,
            b as Promise<unknown>,
            fn,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        if (signal?.aborted) {
          throw task_abort_error("Task Applicative.lift", signal);
        }
        return task_item(fn(a, b), "Task Applicative.lift");
      }));
    }
    if (rest_len === 2) {
      const second = rest[0].value();
      const third = rest[1].value();
      return Task(wrap_sync_task((signal) => {
        const a = eval_task_maybe_sync(
          first,
          signal,
          "Task Applicative.lift",
          empty_options,
        );
        if (is_thenable(a)) {
          const p = resume_task_lift3(
            a as Promise<unknown>,
            0,
            undefined,
            undefined,
            second,
            third,
            fn,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        const b = eval_task_maybe_sync(
          second,
          signal,
          "Task Applicative.lift",
          empty_options,
        );
        if (is_thenable(b)) {
          const p = resume_task_lift3(
            b as Promise<unknown>,
            1,
            a,
            undefined,
            second,
            third,
            fn,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        const c = eval_task_maybe_sync(
          third,
          signal,
          "Task Applicative.lift",
          empty_options,
        );
        if (is_thenable(c)) {
          const p = resume_task_lift3(
            c as Promise<unknown>,
            2,
            a,
            b,
            second,
            third,
            fn,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        if (signal?.aborted) {
          throw task_abort_error("Task Applicative.lift", signal);
        }
        return task_item(fn(a, b, c), "Task Applicative.lift");
      }));
    }
    const len = rest_len + 1;
    const tasks = new Array<RawTask<unknown>>(len);
    tasks[0] = first;
    for (let i = 1; i < len; i += 1) tasks[i] = rest[i - 1].value();
    return Task(wrap_sync_task((signal) => {
      const values = new Array<unknown>(len);
      for (let i = 0; i < len; i += 1) {
        const out = eval_task_maybe_sync(
          tasks[i],
          signal,
          "Task Applicative.lift",
          empty_options,
        );
        if (is_thenable(out)) {
          const p = resume_task_lift_many(
            tasks,
            values,
            i,
            out as Promise<unknown>,
            fn,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        values[i] = out;
      }
      if (signal?.aborted) {
        throw task_abort_error("Task Applicative.lift", signal);
      }
      return task_item(fn(...values), "Task Applicative.lift");
    }));
  },

  ap(value) {
    const first = this.value();
    const second = value.value();
    return Task(wrap_sync_task((signal) => {
      const fn = eval_task_maybe_sync(first, signal, "Task.ap", empty_options);
      if (is_thenable(fn)) {
        const p = resume_task_ap(fn as Promise<unknown>, second, signal);
        if (signal !== undefined) protected_promises.set(p, signal);
        return p;
      }
      const item = eval_task_maybe_sync(
        second,
        signal,
        "Task.ap",
        empty_options,
      );
      if (is_thenable(item)) {
        const p = resume_task_ap_second(fn, item as Promise<unknown>, signal);
        if (signal !== undefined) protected_promises.set(p, signal);
        return p;
      }
      if (signal?.aborted) throw task_abort_error("Task.ap", signal);
      return task_item((fn as (item: unknown) => unknown)(item), "Task.ap");
    }));
  },
});

function apply_fn_value(fn: unknown, item: unknown): unknown {
  return (fn as (value: unknown) => unknown)(item);
}

Show.instance(ParallelTask)({
  show() {
    return "ParallelTask(?)";
  },
});

Functor.instance(ParallelTask)({
  map(fn) {
    return ParallelTask(compose_map(this.value(), fn, "ParallelTask.map"));
  },
});

Applicative.instance(ParallelTask)({
  pure(value) {
    return ParallelTask(completed_raw_task(value, "ParallelTask.pure"));
  },

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const rest_len = rest.length;
    if (rest_len === 0) {
      return ParallelTask(
        compose_map(first, fn, "ParallelTask Applicative.lift"),
      );
    }
    if (rest_len === 1) {
      const second = rest[0].value();
      return ParallelTask(
        wrap_sync_task((signal) =>
          run_concurrently_2_maybe_sync(
            first,
            second,
            signal,
            "ParallelTask Applicative.lift",
            fn,
          )
        ),
      );
    }
    if (rest_len === 2) {
      const second = rest[0].value();
      const third = rest[1].value();
      return ParallelTask(
        wrap_sync_task((signal) =>
          run_concurrently_3_maybe_sync(
            first,
            second,
            third,
            signal,
            "ParallelTask Applicative.lift",
            fn,
          )
        ),
      );
    }
    const len = rest_len + 1;
    const all_tasks = new Array<RawTask<unknown>>(len);
    all_tasks[0] = first;
    for (let i = 1; i < len; i += 1) all_tasks[i] = rest[i - 1].value();
    return ParallelTask(wrap_sync_task((signal) =>
      run_concurrently_maybe_sync(
        all_tasks,
        signal,
        "ParallelTask Applicative.lift",
        (values) => fn(...values),
      )
    ));
  },

  ap<from, to>(
    this: Data<AsParallelTask, (value: NoInfer<from>) => to>,
    value: Data<AsParallelTask, from>,
  ): Data<AsParallelTask, to> {
    const first = this.value() as RawTask<unknown>;
    const second = value.value() as RawTask<unknown>;
    return ParallelTask(
      wrap_sync_task((signal) =>
        run_concurrently_2_maybe_sync(
          first,
          second,
          signal,
          "ParallelTask.ap",
          apply_fn_value,
        )
      ),
    ) as Data<AsParallelTask, to>;
  },
});

Monad.instance(Task)({
  bind(fn) {
    return Task(compose_bind(this.value(), fn));
  },
});

async function resume_tail_rec_m<state, output>(
  first_pending: Promise<readonly [unknown, unknown]>,
  step: (
    state: state,
  ) => Task<
    readonly [typeof loop_done, output] | readonly [typeof loop_rec, state]
  >,
  signal: AbortSignal | undefined,
): Promise<TaskItem<output>> {
  let instruction = await first_pending;
  while (true) {
    const [tag, value] = instruction;
    switch (tag) {
      case loop_done:
        return task_item(value as output, "Task.tail_rec_m");
      case loop_rec: {
        const task = step(value as state).value();
        const out = eval_task_maybe_sync(
          task as RawTask<unknown>,
          signal,
          "Task.tail_rec_m",
          empty_options,
        );
        instruction = (is_thenable(out) ? await out : out) as readonly [
          unknown,
          unknown,
        ];
        break;
      }
    }
  }
}

MonadRec.instance(Task)({
  tail_rec_m(initial, step) {
    return Task(wrap_sync_task((signal) => {
      let state = initial;
      while (true) {
        const task = step(state).value();
        const out = eval_task_maybe_sync(
          task as RawTask<unknown>,
          signal,
          "Task.tail_rec_m",
          empty_options,
        );
        if (is_thenable(out)) {
          const p = resume_tail_rec_m(
            out as Promise<readonly [unknown, unknown]>,
            step,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        const [tag, value] = out as readonly [unknown, unknown];
        switch (tag) {
          case loop_done:
            return task_item(value, "Task.tail_rec_m");
          case loop_rec:
            state = value as typeof initial;
            break;
        }
      }
    }));
  },
});

MonadError.instance(Task)({
  throw_error(error) {
    return Task(wrap_sync_task((signal) => {
      if (signal?.aborted) {
        throw task_abort_error("Task.throw_error", signal);
      }
      throw error;
    }));
  },

  catch_error(handler) {
    const first = this.value();
    return Task(wrap_sync_task((signal) => {
      if (signal?.aborted) throw task_abort_error("Task.catch_error", signal);
      let out: unknown;
      try {
        out = eval_task_maybe_sync(
          first,
          signal,
          "Task.catch_error",
          empty_options,
        );
      } catch (error) {
        if (is_task_cancellation(error)) throw error;
        return eval_task_maybe_sync(
          handler(error).value(),
          signal,
          "Task.catch_error",
          empty_options,
        );
      }
      if (is_thenable(out)) {
        const p = (out as Promise<unknown>).catch((error) => {
          if (is_task_cancellation(error)) throw error;
          const recovery = eval_task_maybe_sync(
            handler(error).value(),
            signal,
            "Task.catch_error",
            empty_options,
          );
          return is_thenable(recovery) ? recovery : Promise.resolve(recovery);
        });
        if (signal !== undefined) protected_promises.set(p, signal);
        return p;
      }
      return out;
    }));
  },
});

const task_kind = Task[kind];
const canonical_task_bind = Task.bind;
const canonical_task_pure = Task.pure;
const canonical_task_map = Task.map;
const canonical_task_err = (Task as unknown as Record<symbol, unknown>)[
  monad_error_typeclass
];

async function resume_task_do_loop(
  first_pending: Promise<unknown>,
  iter: Generator<unknown, unknown, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let step_failed = false;
  let step_val: unknown;
  let step_err: unknown;
  try {
    step_val = await first_pending;
  } catch (error) {
    if (is_task_cancellation(error)) throw error;
    step_failed = true;
    step_err = error;
  }
  let next = step_failed ? iter.throw(step_err) : iter.next(step_val);
  while (!next.done) {
    const task = (next.value as Task<unknown>).value();
    step_failed = false;
    try {
      const out = eval_task_maybe_sync(task, signal, "Task", empty_options);
      step_val = is_thenable(out) ? await out : out;
    } catch (error) {
      if (is_task_cancellation(error)) throw error;
      step_failed = true;
      step_err = error;
    }
    next = step_failed ? iter.throw(step_err) : iter.next(step_val);
  }
  return task_item(next.value, "Task.pure");
}

async function resume_task_do_first(
  first_pending: Promise<unknown>,
  claim_first: () => boolean,
  first_iterator: Generator<unknown, unknown, unknown>,
  run: () => Generator<unknown, unknown, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  let first_failed = false;
  let first_val: unknown;
  let first_err: unknown;
  try {
    first_val = await first_pending;
  } catch (error) {
    if (is_task_cancellation(error)) throw error;
    first_failed = true;
    first_err = error;
  }
  let iter: Generator<unknown, unknown, unknown>;
  let next: IteratorResult<unknown, unknown>;
  if (claim_first()) {
    iter = first_iterator;
    next = first_failed ? iter.throw(first_err) : iter.next(first_val);
  } else {
    iter = run();
    const skipped = iter.next();
    if (skipped.done) return task_item(skipped.value, "Task.pure");
    next = first_failed ? iter.throw(first_err) : iter.next(first_val);
  }
  while (!next.done) {
    const task = (next.value as Task<unknown>).value();
    let step_failed = false;
    let step_val: unknown;
    let step_err: unknown;
    try {
      const out = eval_task_maybe_sync(task, signal, "Task", empty_options);
      step_val = is_thenable(out) ? await out : out;
    } catch (error) {
      if (is_task_cancellation(error)) throw error;
      step_failed = true;
      step_err = error;
    }
    next = step_failed ? iter.throw(step_err) : iter.next(step_val);
  }
  return task_item(next.value, "Task.pure");
}

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
  const first_raw = first.value();
  let first_claimed = false;
  return Task(wrap_sync_task((signal) => {
    if (signal?.aborted) throw task_abort_error("Task", signal);
    let first_failed = false;
    let first_val: unknown;
    let first_err: unknown;
    try {
      first_val = eval_task_maybe_sync(
        first_raw,
        signal,
        "Task",
        empty_options,
      );
    } catch (error) {
      if (is_task_cancellation(error)) throw error;
      first_failed = true;
      first_err = error;
    }
    if (!first_failed && is_thenable(first_val)) {
      const p = resume_task_do_first(
        first_val as Promise<unknown>,
        () => {
          if (first_claimed) return false;
          first_claimed = true;
          return true;
        },
        first_iterator,
        run,
        signal,
      );
      if (signal !== undefined) protected_promises.set(p, signal);
      return p;
    }
    let iter: Generator<unknown, unknown, unknown>;
    let next: IteratorResult<unknown, unknown>;
    if (!first_claimed) {
      first_claimed = true;
      iter = first_iterator;
      next = first_failed ? iter.throw(first_err) : iter.next(first_val);
    } else {
      iter = run();
      const skipped = iter.next();
      if (skipped.done) return task_item(skipped.value, "Task.pure");
      next = first_failed ? iter.throw(first_err) : iter.next(first_val);
    }
    while (!next.done) {
      const task = (next.value as Task<unknown>).value();
      let step_failed = false;
      let step_val: unknown;
      let step_err: unknown;
      try {
        step_val = eval_task_maybe_sync(task, signal, "Task", empty_options);
      } catch (error) {
        if (is_task_cancellation(error)) throw error;
        step_failed = true;
        step_err = error;
      }
      if (!step_failed && is_thenable(step_val)) {
        const p = resume_task_do_loop(
          step_val as Promise<unknown>,
          iter,
          signal,
        );
        if (signal !== undefined) protected_promises.set(p, signal);
        return p;
      }
      next = step_failed ? iter.throw(step_err) : iter.next(step_val);
    }
    return task_item(next.value, "Task.pure");
  }));
};
Object.defineProperty(Task, do_runner_method, { value: task_do });

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

function apply_map_frames(
  initial: unknown,
  frames: readonly TaskPlan[],
): unknown {
  let value = initial;
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    value = task_item(frame.apply(value), frame.operation);
  }
  return value;
}

function eval_signal_free_plan(plan: TaskPlan): unknown {
  if (plan.tag !== "map") return not_signal_free;
  if (plan_of(plan.source) === undefined) {
    const src = plan.source;
    const comp = completed_of(src);
    if (comp !== undefined) {
      return task_item(plan.apply(completed_item(comp)), plan.operation);
    }
    const sf = sync_fn_of(src);
    if (sf !== undefined && sf.length === 0) {
      const raw = sf(undefined);
      if (!is_thenable(raw)) {
        return task_item(plan.apply(raw), plan.operation);
      }
      const p = raw instanceof Promise ? raw : Promise.resolve(raw);
      return p.then((v) => task_item(plan.apply(v), plan.operation));
    }
    return not_signal_free;
  }
  const seg = compile_task(plan);
  const frames = seg.frames;
  for (let i = 0; i < frames.length; i += 1) {
    if (frames[i].tag !== "map") return not_signal_free;
  }
  const src = seg.source;
  const comp = completed_of(src);
  if (comp !== undefined) {
    return apply_map_frames(completed_item(comp), frames);
  }
  const sf = sync_fn_of(src);
  if (sf !== undefined && sf.length === 0) {
    const raw = sf(undefined);
    if (!is_thenable(raw)) {
      return apply_map_frames(raw, frames);
    }
    const p = raw instanceof Promise ? raw : Promise.resolve(raw);
    return p.then((v) => apply_map_frames(v, frames));
  }
  return not_signal_free;
}

function is_signal_free_plan(plan: TaskPlan): boolean {
  let current: TaskPlan | undefined = plan;
  let source: RawTask<unknown> = plan.source;
  while (current !== undefined) {
    if (current.tag !== "map") return false;
    source = current.source;
    current = plan_of(source);
  }
  if (completed_of(source) !== undefined) return true;
  const sf = sync_fn_of(source);
  return sf !== undefined && sf.length === 0;
}

function eval_signal_free(task: RawTask<unknown>): unknown {
  const comp = completed_of(task);
  if (comp !== undefined) return completed_item(comp);
  const sf = sync_fn_of(task);
  if (sf !== undefined) {
    if (sf.length === 0) return sf(undefined);
    return not_signal_free;
  }
  const plan = plan_of(task);
  if (plan !== undefined) return eval_signal_free_plan(plan);
  return not_signal_free;
}

function eval_signal_free_with_options(
  task: RawTask<unknown>,
  options: RunTaskOptions,
): unknown {
  const comp = completed_of(task);
  if (comp !== undefined) return completed_item(comp);
  const sf = sync_fn_of(task);
  if (sf !== undefined) {
    if (sf.length === 0) return sf(undefined);
    return not_signal_free;
  }
  const plan = plan_of(task);
  if (plan !== undefined) {
    if (options.yield_every === undefined) {
      return eval_signal_free_plan(plan);
    }
    if (is_signal_free_plan(plan)) {
      return eval_plan_maybe_sync(plan, undefined, options);
    }
  }
  return not_signal_free;
}

function run_concurrently_controller<result>(
  tasks: readonly RawTask<unknown>[],
  values: unknown[],
  split_index: number,
  signal: AbortSignal | undefined,
  operation: string,
  apply: (values: readonly unknown[]) => result,
): Promise<TaskItem<result>> {
  const len = tasks.length;
  const controller = new AbortController();
  const child_signal = controller.signal;

  const pending = new Promise<TaskItem<result>>((resolve, reject) => {
    let settled = false;
    let remaining = len - split_index;

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

    for (let k = 0; k < split_index; k += 1) {
      const prior = values[k];
      if (prior instanceof Promise) {
        remaining += 1;
        attach(k, prior);
      }
    }

    for (let index = split_index; index < len; index += 1) {
      const task = tasks[index];
      let out: unknown;
      try {
        out = eval_task_maybe_sync(
          task,
          child_signal,
          operation,
          empty_options,
        );
      } catch (error) {
        attach(index, Promise.reject(error));
        continue;
      }
      if (is_thenable(out)) {
        attach(index, out instanceof Promise ? out : Promise.resolve(out));
      } else {
        values[index] = out;
        remaining -= 1;
      }
    }
    finish_if_done();
  });

  if (signal !== undefined) protected_promises.set(pending, signal);
  return pending;
}

function run_concurrently_2_maybe_sync(
  t0: RawTask<unknown>,
  t1: RawTask<unknown>,
  signal: AbortSignal | undefined,
  operation: string,
  fn: (a: unknown, b: unknown) => unknown,
): unknown {
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
  let v0: unknown;
  let p0: Promise<unknown> | undefined;
  try {
    const r0 = eval_signal_free(t0);
    if (r0 === not_signal_free) {
      return run_concurrently_controller(
        [t0, t1],
        new Array<unknown>(2),
        0,
        signal,
        operation,
        (vals) => fn(vals[0], vals[1]),
      );
    }
    if (is_thenable(r0)) {
      p0 = r0 instanceof Promise ? r0 : Promise.resolve(r0);
    } else {
      v0 = r0;
    }
  } catch (error) {
    p0 = Promise.reject(error);
  }

  if (p0 !== undefined && signal !== undefined) {
    return run_concurrently_controller(
      [t0, t1],
      [p0, undefined],
      1,
      signal,
      operation,
      (vals) => fn(vals[0], vals[1]),
    );
  }

  let v1: unknown;
  let p1: Promise<unknown> | undefined;
  try {
    const r1 = eval_signal_free(t1);
    if (r1 === not_signal_free) {
      return run_concurrently_controller(
        [t0, t1],
        [p0 !== undefined ? p0 : v0, undefined],
        1,
        signal,
        operation,
        (vals) => fn(vals[0], vals[1]),
      );
    }
    if (is_thenable(r1)) {
      p1 = r1 instanceof Promise ? r1 : Promise.resolve(r1);
    } else {
      v1 = r1;
    }
  } catch (error) {
    p1 = Promise.reject(error);
  }

  if (p0 === undefined && p1 === undefined) {
    if (signal?.aborted) throw task_abort_error(operation, signal);
    return task_item(fn(v0, v1), operation);
  }
  if (signal !== undefined) {
    return run_concurrently_controller(
      [t0, t1],
      [p0 !== undefined ? p0 : v0, p1 !== undefined ? p1 : v1],
      2,
      signal,
      operation,
      (vals) => fn(vals[0], vals[1]),
    );
  }
  if (p0 !== undefined && p1 !== undefined) {
    return Promise.all([p0, p1]).then(([a, b]) =>
      task_item(fn(a, b), operation)
    );
  }
  if (p0 !== undefined) {
    return p0.then((a) => task_item(fn(a, v1), operation));
  }
  return p1!.then((b) => task_item(fn(v0, b), operation));
}

function run_concurrently_3_maybe_sync(
  t0: RawTask<unknown>,
  t1: RawTask<unknown>,
  t2: RawTask<unknown>,
  signal: AbortSignal | undefined,
  operation: string,
  fn: (a: unknown, b: unknown, c: unknown) => unknown,
): unknown {
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
  let v0: unknown;
  let p0: Promise<unknown> | undefined;
  try {
    const r0 = eval_signal_free(t0);
    if (r0 === not_signal_free) {
      return run_concurrently_controller(
        [t0, t1, t2],
        new Array<unknown>(3),
        0,
        signal,
        operation,
        (vals) => fn(vals[0], vals[1], vals[2]),
      );
    }
    if (is_thenable(r0)) {
      p0 = r0 instanceof Promise ? r0 : Promise.resolve(r0);
    } else {
      v0 = r0;
    }
  } catch (error) {
    p0 = Promise.reject(error);
  }

  if (p0 !== undefined && signal !== undefined) {
    return run_concurrently_controller(
      [t0, t1, t2],
      [p0, undefined, undefined],
      1,
      signal,
      operation,
      (vals) => fn(vals[0], vals[1], vals[2]),
    );
  }

  let v1: unknown;
  let p1: Promise<unknown> | undefined;
  try {
    const r1 = eval_signal_free(t1);
    if (r1 === not_signal_free) {
      return run_concurrently_controller(
        [t0, t1, t2],
        [p0 !== undefined ? p0 : v0, undefined, undefined],
        1,
        signal,
        operation,
        (vals) => fn(vals[0], vals[1], vals[2]),
      );
    }
    if (is_thenable(r1)) {
      p1 = r1 instanceof Promise ? r1 : Promise.resolve(r1);
    } else {
      v1 = r1;
    }
  } catch (error) {
    p1 = Promise.reject(error);
  }

  if (p1 !== undefined && signal !== undefined) {
    return run_concurrently_controller(
      [t0, t1, t2],
      [p0 !== undefined ? p0 : v0, p1, undefined],
      2,
      signal,
      operation,
      (vals) => fn(vals[0], vals[1], vals[2]),
    );
  }

  let v2: unknown;
  let p2: Promise<unknown> | undefined;
  try {
    const r2 = eval_signal_free(t2);
    if (r2 === not_signal_free) {
      return run_concurrently_controller(
        [t0, t1, t2],
        [
          p0 !== undefined ? p0 : v0,
          p1 !== undefined ? p1 : v1,
          undefined,
        ],
        2,
        signal,
        operation,
        (vals) => fn(vals[0], vals[1], vals[2]),
      );
    }
    if (is_thenable(r2)) {
      p2 = r2 instanceof Promise ? r2 : Promise.resolve(r2);
    } else {
      v2 = r2;
    }
  } catch (error) {
    p2 = Promise.reject(error);
  }

  if (p0 === undefined && p1 === undefined && p2 === undefined) {
    if (signal?.aborted) throw task_abort_error(operation, signal);
    return task_item(fn(v0, v1, v2), operation);
  }
  if (signal !== undefined) {
    return run_concurrently_controller(
      [t0, t1, t2],
      [
        p0 !== undefined ? p0 : v0,
        p1 !== undefined ? p1 : v1,
        p2 !== undefined ? p2 : v2,
      ],
      3,
      signal,
      operation,
      (vals) => fn(vals[0], vals[1], vals[2]),
    );
  }
  return Promise.all([
    p0 !== undefined ? p0 : v0,
    p1 !== undefined ? p1 : v1,
    p2 !== undefined ? p2 : v2,
  ]).then(([a, b, c]) => task_item(fn(a, b, c), operation));
}

function run_concurrently_maybe_sync<result>(
  tasks: readonly RawTask<unknown>[],
  signal: AbortSignal | undefined,
  operation: string,
  apply: (values: readonly unknown[]) => result,
): unknown {
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
  const len = tasks.length;
  const values = new Array<unknown>(len);
  let has_async = false;
  for (let index = 0; index < len; index += 1) {
    let raw: unknown;
    try {
      raw = eval_signal_free(tasks[index]);
    } catch (error) {
      raw = Promise.reject(error);
    }
    if (raw === not_signal_free) {
      return run_concurrently_controller(
        tasks,
        values,
        index,
        signal,
        operation,
        apply,
      );
    }
    if (is_thenable(raw)) {
      const p = raw instanceof Promise ? raw : Promise.resolve(raw);
      values[index] = p;
      has_async = true;
      if (signal !== undefined) {
        return run_concurrently_controller(
          tasks,
          values,
          index + 1,
          signal,
          operation,
          apply,
        );
      }
    } else {
      values[index] = raw;
    }
  }
  if (!has_async) {
    if (signal?.aborted) {
      throw task_abort_error(operation, signal);
    }
    return task_item(apply(values), operation);
  }
  return Promise.all(values).then((resolved) =>
    task_item(apply(resolved), operation)
  );
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

function ignore_failure(_error: unknown): void {}

/** Lazily traverses inputs with bounded concurrency, preserving input order.
 * Failure or cancellation stops admission and signals active siblings.
 */
export function traverse_task<input, output>(
  inputs: Iterable<input>,
  concurrency: number,
  fn: (input: input, index: number) => Task<output>,
  options: RunTaskOptions = empty_options,
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
  return Task<readonly output[]>(wrap_sync_task((parent_signal) => {
    const opt_signal = options.signal;
    if (parent_signal?.aborted) {
      throw task_abort_error("Task.traverse", parent_signal);
    }
    if (opt_signal?.aborted) {
      throw task_abort_error("Task.traverse", opt_signal);
    }
    const array_inputs = Array.isArray(inputs)
      ? (inputs as readonly input[])
      : undefined;
    if (array_inputs !== undefined) {
      const results: output[] = [];
      let idx = 0;
      // Preserve live array_inputs.length in the sync fast path.
      while (idx < array_inputs.length) {
        if (parent_signal?.aborted) {
          throw task_abort_error("Task.traverse", parent_signal);
        }
        if (opt_signal?.aborted) {
          throw task_abort_error("Task.traverse", opt_signal);
        }
        const task = fn(array_inputs[idx], idx).value();
        const out = eval_signal_free_with_options(
          task as RawTask<unknown>,
          options,
        );
        if (out === not_signal_free) {
          return traverse_async(
            parent_signal,
            array_inputs,
            undefined,
            results,
            idx,
            undefined,
            task,
          );
        }
        if (is_thenable(out)) {
          const p = out instanceof Promise ? out : Promise.resolve(out);
          if (
            concurrency === 1 &&
            parent_signal === undefined &&
            opt_signal === undefined
          ) {
            return continue_sequential_array(array_inputs, results, idx, p);
          }
          return traverse_async(
            parent_signal,
            array_inputs,
            undefined,
            results,
            idx,
            p,
            undefined,
          );
        }
        if (parent_signal?.aborted) {
          throw task_abort_error("Task.traverse", parent_signal);
        }
        if (opt_signal?.aborted) {
          throw task_abort_error("Task.traverse", opt_signal);
        }
        results[idx] = out as output;
        idx += 1;
      }
      return results;
    }

    const iterator = inputs[Symbol.iterator]();
    const results: output[] = [];
    let idx = 0;
    let exhausted = false;
    try {
      while (true) {
        if (parent_signal?.aborted) {
          throw task_abort_error("Task.traverse", parent_signal);
        }
        if (opt_signal?.aborted) {
          throw task_abort_error("Task.traverse", opt_signal);
        }
        const step = iterator.next();
        if (step.done) {
          exhausted = true;
          return results;
        }
        const task = fn(step.value, idx).value();
        const out = eval_signal_free_with_options(
          task as RawTask<unknown>,
          options,
        );
        if (out === not_signal_free) {
          return traverse_async(
            parent_signal,
            undefined,
            iterator,
            results,
            idx,
            undefined,
            task,
          );
        }
        if (is_thenable(out)) {
          const p = out instanceof Promise ? out : Promise.resolve(out);
          return traverse_async(
            parent_signal,
            undefined,
            iterator,
            results,
            idx,
            p,
            undefined,
          );
        }
        if (parent_signal?.aborted) {
          throw task_abort_error("Task.traverse", parent_signal);
        }
        if (opt_signal?.aborted) {
          throw task_abort_error("Task.traverse", opt_signal);
        }
        results[idx] = out as output;
        idx += 1;
      }
    } catch (error) {
      if (!exhausted) {
        exhausted = true;
        try {
          iterator.return?.();
        } catch (cleanup_error) {
          throw new AggregateError(
            [error, cleanup_error],
            "Task traversal and iterator cleanup both failed",
          );
        }
      }
      throw error;
    }
  }));

  async function continue_sequential_array(
    array_inputs: readonly input[],
    results: output[],
    start_idx: number,
    first_pending: Promise<unknown>,
  ): Promise<readonly output[]> {
    results[start_idx] = await first_pending as output;
    let idx = start_idx + 1;
    while (idx < array_inputs.length) {
      const task = fn(array_inputs[idx], idx).value();
      const out = eval_signal_free_with_options(
        task as RawTask<unknown>,
        options,
      );
      if (out === not_signal_free) {
        return await traverse_async(
          undefined,
          array_inputs,
          undefined,
          results,
          idx,
          undefined,
          task,
        );
      }
      results[idx] = (is_thenable(out) ? await out : out) as output;
      idx += 1;
    }
    return results;
  }

  function traverse_async(
    parent_signal: AbortSignal | undefined,
    array_inputs: readonly input[] | undefined,
    existing_iterator: Iterator<input> | undefined,
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
    if (signal.aborted) {
      const abort_err = task_abort_error("Task.traverse", signal);
      if (existing_iterator !== undefined) {
        try {
          existing_iterator.return?.();
        } catch (cleanup_error) {
          const agg = Promise.reject(
            new AggregateError(
              [abort_err, cleanup_error],
              "Task traversal and iterator cleanup both failed",
            ),
          );
          if (parent_signal !== undefined) {
            protected_promises.set(agg, parent_signal);
          }
          return agg;
        }
      }
      return Promise.reject(abort_err);
    }

    let iterator: Iterator<input> | undefined;
    try {
      iterator = existing_iterator ??
        (array_inputs === undefined ? inputs[Symbol.iterator]() : undefined);
    } catch (error) {
      return Promise.reject(error);
    }

    const pending_promise = new Promise<readonly output[]>(
      (resolve, reject) => {
        let next_index = start_index;
        let active = 0;
        let protected_active = 0;
        let exhausted = false;
        let settled = false;
        let aborting = false;
        let abort_error: unknown;
        let pumping = false;
        let pending_slot = first_pending;
        let task_slot = first_task;

        const close_iterator_with_error = (primary: unknown): unknown => {
          if (!exhausted) {
            exhausted = true;
            if (iterator !== undefined) {
              try {
                iterator.return?.();
              } catch (cleanup_error) {
                return new AggregateError(
                  [primary, cleanup_error],
                  "Task traversal and iterator cleanup both failed",
                );
              }
            }
          }
          return primary;
        };

        const fail = (error: unknown, should_abort_controller: boolean) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", on_abort);
          if (should_abort_controller) {
            controller.abort(error);
          }
          reject(close_iterator_with_error(error));
        };

        const on_abort = () => {
          if (settled) return;
          const err = task_abort_error("Task.traverse", signal);
          if (protected_active > 0) {
            aborting = true;
            abort_error = err;
            return;
          }
          fail(err, false);
        };

        signal.addEventListener("abort", on_abort, { once: true });

        const on_item_reject = (error: unknown) => {
          if (settled) return;
          fail(error, true);
        };

        const on_protected_reject = (error: unknown) => {
          protected_active -= 1;
          if (settled) return;
          fail(error, !aborting);
        };

        const attach_item = (index: number, promise: Promise<unknown>) => {
          const is_protected = protected_promises.get(promise) === signal;
          active += 1;
          if (is_protected) {
            protected_active += 1;
            promise.then(
              (val) => {
                protected_active -= 1;
                if (settled) return;
                if (aborting) {
                  if (protected_active === 0) fail(abort_error, false);
                  return;
                }
                results[index] = val as output;
                active -= 1;
                pump();
              },
              on_protected_reject,
            );
            return;
          }
          promise.then(
            (val) => {
              if (settled || aborting) return;
              results[index] = val as output;
              active -= 1;
              pump();
            },
            on_item_reject,
          );
        };

        const pump = () => {
          if (pumping || settled || aborting) return;
          pumping = true;
          try {
            while (
              !settled && !aborting && !exhausted && active < concurrency
            ) {
              if (signal.aborted) {
                if (protected_active > 0) {
                  aborting = true;
                  abort_error = task_abort_error("Task.traverse", signal);
                  return;
                }
                fail(task_abort_error("Task.traverse", signal), false);
                return;
              }
              if (pending_slot !== undefined) {
                const p = pending_slot;
                pending_slot = undefined;
                const index = next_index++;
                attach_item(index, p);
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
                  break;
                }
                index = next_index++;
                task = fn(array_inputs[index], index).value();
              } else {
                const next = iterator!.next();
                if (next.done) {
                  exhausted = true;
                  break;
                }
                index = next_index++;
                task = fn(next.value, index).value();
              }
              if (settled || aborting) return;
              const completed = completed_of(task as RawTask<unknown>);
              if (completed !== undefined) {
                results[index] = completed_item(completed) as output;
                continue;
              }
              const sync_fn = sync_fn_of(task as RawTask<unknown>);
              if (sync_fn !== undefined) {
                const raw = sync_fn(signal);
                if (settled) {
                  if (is_thenable(raw)) {
                    void (raw instanceof Promise ? raw : Promise.resolve(raw))
                      .catch(ignore_failure);
                  }
                  return;
                }
                if (is_thenable(raw)) {
                  const p = raw instanceof Promise ? raw : Promise.resolve(raw);
                  if (aborting && protected_promises.get(p) !== signal) {
                    void p.catch(ignore_failure);
                    return;
                  }
                  attach_item(index, p);
                } else {
                  if (signal.aborted) {
                    if (protected_active > 0) {
                      aborting = true;
                      abort_error = task_abort_error("Task.from_fn", signal);
                      return;
                    }
                    fail(task_abort_error("Task.from_fn", signal), false);
                    return;
                  }
                  results[index] = raw as output;
                }
                continue;
              }
              const plan = plan_of(task as RawTask<unknown>);
              if (plan !== undefined) {
                const out = eval_plan_maybe_sync(plan, signal, options);
                if (settled) {
                  if (is_thenable(out)) {
                    void (out as Promise<unknown>).catch(ignore_failure);
                  }
                  return;
                }
                if (is_thenable(out)) {
                  const p = out as Promise<unknown>;
                  if (aborting && protected_promises.get(p) !== signal) {
                    void p.catch(ignore_failure);
                    return;
                  }
                  attach_item(index, p);
                } else {
                  results[index] = out as output;
                }
                continue;
              }
              const pending = task(signal);
              if (settled) {
                void pending.catch(ignore_failure);
                return;
              }
              if (aborting && protected_promises.get(pending) !== signal) {
                void pending.catch(ignore_failure);
                return;
              }
              attach_item(index, pending);
            }
            if (!settled && !aborting && exhausted && active === 0) {
              settled = true;
              signal.removeEventListener("abort", on_abort);
              if (signal.aborted) {
                reject(task_abort_error("Task.traverse", signal));
                return;
              }
              resolve(results);
            }
          } catch (error) {
            fail(error, true);
          } finally {
            pumping = false;
          }
        };

        pump();
      },
    );

    // The pump observes cancellation and finishes iterator cleanup before the
    // public Task settles, including when cleanup itself fails.
    if (parent_signal !== undefined) {
      protected_promises.set(pending_promise, parent_signal);
    }
    return pending_promise;
  }
}

function compose_map<from, to>(
  source: RawTask<from>,
  apply: (value: TaskItem<from>) => to,
  operation: string,
): RawTask<to> {
  return compose_plan({
    tag: "map",
    apply: apply as (value: unknown) => unknown,
    operation,
    source: source as RawTask<unknown>,
    runs: 0,
    compiled: undefined,
  }) as RawTask<to>;
}

function compose_bind<from, to>(
  source: RawTask<from>,
  apply: (value: TaskItem<from>) => Task<to>,
): RawTask<to> {
  return compose_plan({
    tag: "bind",
    apply: apply as (value: unknown) => Task<unknown>,
    operation: "",
    source: source as RawTask<unknown>,
    runs: 0,
    compiled: undefined,
  }) as RawTask<to>;
}

function compose_plan(plan: TaskPlan): RawTask<unknown> {
  const task: PlannedTask = (signal) => {
    try {
      const out = eval_plan_maybe_sync(plan, signal, empty_options);
      if (is_thenable(out)) return out as Promise<unknown>;
      return Promise.resolve(out);
    } catch (error) {
      return Promise.reject(error);
    }
  };
  task[task_plan] = plan;
  return task as RawTask<unknown>;
}

const compiled_tasks = new Map<TaskPlan, CompiledTask>();
const large_compiled_tasks = new WeakMap<TaskPlan, CompiledTask>();
let compiled_task_frames = 0;

function compile_task(plan: TaskPlan): CompiledTask {
  const cached = plan.compiled;
  if (cached !== undefined) return cached;
  if (plan.runs >= 2) {
    const large = large_compiled_tasks.get(plan);
    if (large !== undefined) return large;
  }
  // Frames are stored outer-to-inner and iterated backwards (no reverse()).
  const frames: TaskPlan[] = [plan];
  let source = plan.source;
  let nested = plan_of(source);
  while (nested !== undefined) {
    frames.push(nested);
    source = nested.source;
    nested = plan_of(source);
  }
  const segment: CompiledTask = { source, frames };
  plan.runs += 1;
  if (frames.length <= 4096) {
    if (frames.length >= 16 || plan.runs >= 2) {
      plan.compiled = segment;
      compiled_tasks.set(plan, segment);
      compiled_task_frames += frames.length;
      while (compiled_task_frames > 4096) {
        const [oldest, evicted] = compiled_tasks.entries().next().value!;
        compiled_tasks.delete(oldest);
        oldest.compiled = undefined;
        compiled_task_frames -= evicted.frames.length;
      }
    }
  } else if (plan.runs >= 2) {
    large_compiled_tasks.set(plan, segment);
  }
  return segment;
}

function eval_non_plan_maybe_sync(
  task: RawTask<unknown>,
  signal: AbortSignal | undefined,
  operation: string,
): unknown {
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
  const completed = completed_of(task);
  if (completed !== undefined) {
    return completed_item(completed);
  }
  const sync_fn = sync_fn_of(task);
  if (sync_fn !== undefined) {
    const raw = sync_fn(signal);
    if (is_thenable(raw)) {
      const pending = raw instanceof Promise ? raw : Promise.resolve(raw);
      return await_with_signal(pending, signal, "Task.from_fn");
    }
    if (signal?.aborted) {
      throw task_abort_error("Task.from_fn", signal);
    }
    return raw;
  }
  return await_with_signal(task(signal), signal, operation);
}

function eval_task_maybe_sync(
  task: RawTask<unknown>,
  signal: AbortSignal | undefined,
  operation: string,
  options: RunTaskOptions,
): unknown {
  if (signal?.aborted) {
    throw task_abort_error(operation, signal);
  }
  const completed = completed_of(task);
  if (completed !== undefined) {
    return completed_item(completed);
  }
  const sync_fn = sync_fn_of(task);
  if (sync_fn !== undefined) {
    const raw = sync_fn(signal);
    if (is_thenable(raw)) {
      const pending = raw instanceof Promise ? raw : Promise.resolve(raw);
      return await_with_signal(pending, signal, "Task.from_fn");
    }
    if (signal?.aborted) {
      throw task_abort_error("Task.from_fn", signal);
    }
    return raw;
  }
  const plan = plan_of(task);
  if (plan !== undefined) {
    return eval_plan_maybe_sync(plan, signal, options);
  }
  return await_with_signal(task(signal), signal, operation);
}

async function yield_task_step(
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): Promise<void> {
  const scheduled = options.schedule !== undefined
    ? options.schedule()
    : new Promise<void>((resolve) => setTimeout(resolve, 0));
  await await_with_signal(scheduled, signal, "Task scheduler");
  if (signal?.aborted) throw task_abort_error("Task plan", signal);
}

async function resume_single_frame(
  pending: Promise<unknown> | undefined,
  initial_plan: TaskPlan,
  initial_steps: number,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
  yield_first: boolean,
  initial_value: unknown,
): Promise<unknown> {
  const yield_every = options.yield_every;
  let plan = initial_plan;
  let steps = initial_steps;
  let value: unknown;
  if (yield_first) {
    value = initial_value;
    steps = 0;
    await yield_task_step(signal, options);
  } else {
    value = await pending!;
    if (signal?.aborted) throw task_abort_error("Task plan", signal);
    if (yield_every !== undefined && ++steps >= yield_every) {
      steps = 0;
      await yield_task_step(signal, options);
    }
  }
  while (true) {
    if (plan.tag === "map") {
      return task_item(plan.apply(value), plan.operation);
    }
    const next_raw = plan.apply(value).value();
    const next_plan = plan_of(next_raw);
    if (next_plan === undefined) {
      const out = eval_non_plan_maybe_sync(next_raw, signal, "Task plan");
      return is_thenable(out) ? await out : out;
    }
    plan = next_plan;
    if (plan_of(plan.source) !== undefined) {
      const out = eval_compiled_maybe_sync(plan, steps, signal, options);
      return is_thenable(out) ? await out : out;
    }
    const src_out = eval_non_plan_maybe_sync(plan.source, signal, "Task plan");
    value = is_thenable(src_out) ? await src_out : src_out;
    if (signal?.aborted) throw task_abort_error("Task plan", signal);
    if (yield_every !== undefined && ++steps >= yield_every) {
      steps = 0;
      await yield_task_step(signal, options);
    }
  }
}

async function resume_compiled_task(
  pending: Promise<unknown> | undefined,
  initial_segment: CompiledTask,
  initial_index: number,
  initial_pending_seg: CompiledTask[] | undefined,
  initial_pending_idx: number[] | undefined,
  initial_steps: number,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
  yield_first: boolean,
  initial_value: unknown,
): Promise<unknown> {
  const yield_every = options.yield_every;
  let steps = initial_steps;
  let segment = initial_segment;
  let frames = segment.frames;
  let index = initial_index;
  let pending_seg = initial_pending_seg;
  let pending_idx = initial_pending_idx;
  let current: RawTask<unknown>;
  let value: unknown;
  let skip_yield = false;

  if (yield_first) {
    value = initial_value;
    steps = 0;
    await yield_task_step(signal, options);
    skip_yield = true;
  } else {
    value = await pending!;
  }

  while (true) {
    inner: while (true) {
      if (signal?.aborted) throw task_abort_error("Task plan", signal);
      if (index < 0) {
        if (pending_seg === undefined || pending_seg.length === 0) {
          return value;
        }
        segment = pending_seg.pop()!;
        frames = segment.frames;
        index = pending_idx!.pop()!;
        continue;
      }
      const step = frames[index--];
      if (skip_yield) {
        skip_yield = false;
      } else if (yield_every !== undefined && ++steps >= yield_every) {
        steps = 0;
        await yield_task_step(signal, options);
      }
      if (step.tag === "map") {
        value = task_item(step.apply(value), step.operation);
        continue;
      }
      current = step.apply(value).value();
      let nested = plan_of(current);
      while (nested !== undefined && plan_of(nested.source) === undefined) {
        const nested_out = eval_non_plan_maybe_sync(
          nested.source,
          signal,
          "Task plan",
        );
        value = is_thenable(nested_out) ? await nested_out : nested_out;
        if (signal?.aborted) throw task_abort_error("Task plan", signal);
        if (yield_every !== undefined && ++steps >= yield_every) {
          steps = 0;
          await yield_task_step(signal, options);
        }
        if (nested.tag === "map") {
          value = task_item(nested.apply(value), nested.operation);
          continue inner;
        }
        current = nested.apply(value).value();
        nested = plan_of(current);
      }
      if (nested !== undefined) {
        if (index >= 0) {
          if (pending_seg === undefined) {
            pending_seg = [segment];
            pending_idx = [index];
          } else {
            pending_seg.push(segment);
            pending_idx!.push(index);
          }
        }
        segment = compile_task(nested);
        frames = segment.frames;
        index = frames.length - 1;
        current = segment.source;
      }
      break;
    }

    const src_out = eval_non_plan_maybe_sync(current, signal, "Task plan");
    value = is_thenable(src_out) ? await src_out : src_out;
  }
}

function eval_compiled_maybe_sync(
  plan: TaskPlan,
  initial_steps: number,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): unknown {
  const yield_every = options.yield_every;
  let steps = initial_steps;
  let segment = compile_task(plan);
  let frames = segment.frames;
  let index = frames.length - 1;
  let pending_seg: CompiledTask[] | undefined;
  let pending_idx: number[] | undefined;
  let current = segment.source;
  let value: unknown;

  while (true) {
    const src_out = eval_non_plan_maybe_sync(current, signal, "Task plan");
    if (is_thenable(src_out)) {
      const p = resume_compiled_task(
        src_out as Promise<unknown>,
        segment,
        index,
        pending_seg,
        pending_idx,
        steps,
        signal,
        options,
        false,
        undefined,
      );
      if (signal !== undefined) protected_promises.set(p, signal);
      return p;
    }
    value = src_out;

    inner: while (true) {
      if (signal?.aborted) throw task_abort_error("Task plan", signal);
      if (index < 0) {
        if (pending_seg === undefined || pending_seg.length === 0) {
          return value;
        }
        segment = pending_seg.pop()!;
        frames = segment.frames;
        index = pending_idx!.pop()!;
        continue;
      }
      const step = frames[index--];
      if (yield_every !== undefined && ++steps >= yield_every) {
        const p = resume_compiled_task(
          undefined,
          segment,
          index + 1,
          pending_seg,
          pending_idx,
          0,
          signal,
          options,
          true,
          value,
        );
        if (signal !== undefined) protected_promises.set(p, signal);
        return p;
      }
      if (step.tag === "map") {
        value = task_item(step.apply(value), step.operation);
        continue;
      }
      current = step.apply(value).value();
      let nested = plan_of(current);
      // Inline 1-frame nested plans to avoid pending push/pop & compile_task.
      while (nested !== undefined && plan_of(nested.source) === undefined) {
        const nested_out = eval_non_plan_maybe_sync(
          nested.source,
          signal,
          "Task plan",
        );
        if (is_thenable(nested_out)) {
          if (index >= 0) {
            if (pending_seg === undefined) {
              pending_seg = [segment];
              pending_idx = [index];
            } else {
              pending_seg.push(segment);
              pending_idx!.push(index);
            }
          }
          const nested_seg: CompiledTask = {
            source: nested.source,
            frames: [nested],
          };
          const p = resume_compiled_task(
            nested_out as Promise<unknown>,
            nested_seg,
            0,
            pending_seg,
            pending_idx,
            steps,
            signal,
            options,
            false,
            undefined,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        value = nested_out;
        if (signal?.aborted) throw task_abort_error("Task plan", signal);
        if (yield_every !== undefined && ++steps >= yield_every) {
          if (index >= 0) {
            if (pending_seg === undefined) {
              pending_seg = [segment];
              pending_idx = [index];
            } else {
              pending_seg.push(segment);
              pending_idx!.push(index);
            }
          }
          const nested_seg: CompiledTask = {
            source: nested.source,
            frames: [nested],
          };
          const p = resume_compiled_task(
            undefined,
            nested_seg,
            0,
            pending_seg,
            pending_idx,
            0,
            signal,
            options,
            true,
            value,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        if (nested.tag === "map") {
          value = task_item(nested.apply(value), nested.operation);
          continue inner;
        }
        current = nested.apply(value).value();
        nested = plan_of(current);
      }
      if (nested !== undefined) {
        if (index >= 0) {
          if (pending_seg === undefined) {
            pending_seg = [segment];
            pending_idx = [index];
          } else {
            pending_seg.push(segment);
            pending_idx!.push(index);
          }
        }
        segment = compile_task(nested);
        frames = segment.frames;
        index = frames.length - 1;
        current = segment.source;
      }
      break;
    }
  }
}

function eval_plan_maybe_sync(
  initial_plan: TaskPlan,
  signal: AbortSignal | undefined,
  options: RunTaskOptions,
): unknown {
  let plan = initial_plan;
  let steps = 0;
  const yield_every = options.yield_every;
  // Fast path: single-frame right-nested chains avoid compile_task & Map overhead.
  while (plan_of(plan.source) === undefined) {
    const val = eval_non_plan_maybe_sync(plan.source, signal, "Task plan");
    if (is_thenable(val)) {
      const p = resume_single_frame(
        val as Promise<unknown>,
        plan,
        steps,
        signal,
        options,
        false,
        undefined,
      );
      if (signal !== undefined) protected_promises.set(p, signal);
      return p;
    }
    if (signal?.aborted) throw task_abort_error("Task plan", signal);
    if (yield_every !== undefined && ++steps >= yield_every) {
      const p = resume_single_frame(
        undefined,
        plan,
        0,
        signal,
        options,
        true,
        val,
      );
      if (signal !== undefined) protected_promises.set(p, signal);
      return p;
    }
    if (plan.tag === "map") {
      return task_item(plan.apply(val), plan.operation);
    }
    const next_raw = plan.apply(val).value();
    const next_plan = plan_of(next_raw);
    if (next_plan === undefined) {
      return eval_non_plan_maybe_sync(next_raw, signal, "Task plan");
    }
    plan = next_plan;
  }

  return eval_compiled_maybe_sync(plan, steps, signal, options);
}

async function resume_task_traverse<to, result>(
  tasks: readonly RawTask<to>[],
  out: to[],
  start_index: number,
  first_pending: Promise<unknown>,
  build: (items: Iterable<to>) => result,
  signal: AbortSignal | undefined,
): Promise<TaskItem<result>> {
  out[start_index] = await first_pending as to;
  for (let i = start_index + 1; i < tasks.length; i += 1) {
    const res = eval_task_maybe_sync(
      tasks[i] as RawTask<unknown>,
      signal,
      "Task.traverse",
      empty_options,
    );
    out[i] = (is_thenable(res) ? await res : res) as to;
  }
  return task_item(build(out), "Task.traverse");
}

async function resume_task_traverse_sequential<from, to>(
  snapshot: readonly from[],
  fn: (item: from) => Data<AsTask, to>,
  out: to[],
  start_index: number,
  first_pending: Promise<unknown>,
  signal: AbortSignal | undefined,
): Promise<to[]> {
  out[start_index] = await first_pending as to;
  for (let i = start_index + 1; i < snapshot.length; i += 1) {
    if (signal?.aborted) {
      throw task_abort_error("Task.traverse_sequential", signal);
    }
    const current = fn(snapshot[i]).value();
    const res = eval_task_maybe_sync(
      current as RawTask<unknown>,
      signal,
      "Task.traverse_sequential",
      empty_options,
    );
    out[i] = (is_thenable(res) ? await res : res) as to;
  }
  return out;
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
    return Task(wrap_sync_task((signal) => {
      const len = tasks.length;
      const out = new Array<to>(len);
      for (let i = 0; i < len; i += 1) {
        const res = eval_task_maybe_sync(
          tasks[i] as RawTask<unknown>,
          signal,
          "Task.traverse",
          empty_options,
        );
        if (is_thenable(res)) {
          const p = resume_task_traverse(
            tasks,
            out,
            i,
            res as Promise<unknown>,
            build,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        out[i] = res as to;
      }
      return task_item(build(out), "Task.traverse");
    }));
  },
  <from, to>(
    items: readonly from[],
    fn: (item: from) => Data<AsTask, to>,
  ): Data<AsTask, to[]> => {
    const snapshot = items.slice();
    return Task(wrap_sync_task((signal) => {
      const len = snapshot.length;
      const out = new Array<to>(len);
      for (let i = 0; i < len; i += 1) {
        if (signal?.aborted) {
          throw task_abort_error("Task.traverse_sequential", signal);
        }
        const current = fn(snapshot[i]).value();
        const res = eval_task_maybe_sync(
          current as RawTask<unknown>,
          signal,
          "Task.traverse_sequential",
          empty_options,
        );
        if (is_thenable(res)) {
          const p = resume_task_traverse_sequential(
            snapshot,
            fn,
            out,
            i,
            res as Promise<unknown>,
            signal,
          );
          if (signal !== undefined) protected_promises.set(p, signal);
          return p;
        }
        out[i] = res as to;
      }
      return out;
    }));
  },
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
    return ParallelTask(wrap_sync_task((signal) =>
      run_concurrently_maybe_sync(
        tasks,
        signal,
        "ParallelTask.traverse",
        (values) => build(values as readonly to[]),
      )
    ));
  },
);

import { type As, define, type Value } from "./trait.ts";
import { type Effect, is_effect, is_lift_of, type Lift } from "./effects.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Task<item> = () => Promise<item>;

export const task_kind = Symbol("Task");

declare module "./trait.ts" {
  interface TraitTypes<dictionary, item> {
    [task_kind]: Task<item>;
  }
}

export interface AsTask extends As<typeof task_kind> {}

type TaskValue<item> = Value<AsTask, item>;

export const Task = define<AsTask>(
  task_kind,
);

export function succeed<item>(value: item): TaskValue<item> {
  return Task(() => Promise.resolve(value));
}

export function from_fn<item>(
  run: () => Promise<item>,
): TaskValue<item> {
  return Task(run);
}

export function from_promise<item>(
  promise: PromiseLike<item>,
): TaskValue<item> {
  return Task(() => Promise.resolve(promise));
}

export function run<item>(task: TaskValue<item>): Promise<item>;
export function run<requirements extends Lift<AsTask, unknown>, item>(
  effect: Effect<requirements, item>,
): Promise<item>;
export function run<requirements extends Lift<AsTask, unknown>, item>(
  task_or_effect: TaskValue<item> | Effect<requirements, item>,
): Promise<item> {
  if (is_effect(task_or_effect)) {
    return run_task_effect(task_or_effect);
  }

  return task_or_effect.value()();
}

async function run_task_effect<
  requirements extends Lift<AsTask, unknown>,
  item,
>(
  effect: Effect<requirements, item>,
): Promise<item> {
  if (effect.tag === "pure") {
    return effect.value;
  }

  if (is_lift_of(effect.operation, task_kind)) {
    const operation = effect.operation as unknown as Lift<AsTask, unknown>;
    return await run_task_effect(effect.resume(await run(operation.value)));
  }

  throw new TypeError("Unhandled effect operation");
}

Format.implement(Task)({
  fmt() {
    return "Task(?)";
  },
});

export interface AsTask extends Format<AsTask> {}

Functor.implement(Task)({
  map(fn) {
    return Task(async () => fn(await run(this)));
  },
});

export interface AsTask extends Functor<AsTask> {}

Applicative.implement(Task)({
  pure(value) {
    return succeed(value);
  },

  ap(value) {
    return Task(async () => {
      const [fn, item] = await Promise.all([run(this), run(value)]);
      return fn(item);
    });
  },
});

export interface AsTask extends Applicative<AsTask> {}

Monad.implement(Task)({
  bind(fn) {
    return Task(async () => {
      const value = await run(this);
      return await run(fn(value));
    });
  },
});

export interface AsTask extends Monad<AsTask> {}

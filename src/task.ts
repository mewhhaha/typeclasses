import { type As, define, type Value } from "./trait.ts";
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

export function run<item>(task: TaskValue<item>): Promise<item> {
  return task.value()();
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

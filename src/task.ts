import {
  define_dictionary,
  type DefinedDictionary,
  type Value,
} from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Task<item> = () => Promise<item>;

export const task_kind = Symbol("Task");

declare module "./trait.ts" {
  interface ContextValues<item> {
    [task_kind]: Task<item>;
  }
}

export interface TaskDictionary extends DefinedDictionary<typeof task_kind> {}

type TaskValue<item> = Value<TaskDictionary, item>;

export const Task = define_dictionary<TaskDictionary>(
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
  fmt(_task) {
    return "Task(?)";
  },
});

export interface TaskDictionary extends Format<TaskDictionary> {}

Functor.implement(Task)({
  map(task, fn) {
    return Task(async () => fn(await run(task)));
  },
});

export interface TaskDictionary extends Functor<TaskDictionary> {}

Applicative.implement(Task)({
  pure(_task, value) {
    return succeed(value);
  },

  ap(task, value) {
    return Task(async () => {
      const [fn, item] = await Promise.all([run(task), run(value)]);
      return fn(item);
    });
  },
});

export interface TaskDictionary extends Applicative<TaskDictionary> {}

Monad.implement(Task)({
  bind(task, fn) {
    return Task(async () => {
      const value = await run(task);
      return await run(fn(value));
    });
  },
});

export interface TaskDictionary extends Monad<TaskDictionary> {}

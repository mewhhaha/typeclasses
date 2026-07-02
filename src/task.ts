import { kind, require_this, trait_constructor, type Value } from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Task<item> = () => Promise<item>;

export const task_kind: unique symbol = Symbol("Task");

declare module "./registry.ts" {
  interface Registry<item> {
    [task_kind]: Task<item>;
  }
}

export interface TaskDictionary {
  <item>(run: Task<item>): TaskValue<item>;
  [kind]: typeof task_kind;
}

type TaskValue<item> = Value<TaskDictionary, item>;

export const Task = function Task<item>(
  run: Task<item>,
): TaskValue<item> {
  return task_trait(run);
} as TaskDictionary;

Task[kind] = task_kind;

const task_trait = trait_constructor(Task);

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

Format.implement(Task, {
  fmt(this: TaskValue<unknown> | void): string {
    require_this(this, "Task.Format.fmt");
    return "Task(?)";
  },
});

export interface TaskDictionary extends Format<typeof Task> {}

Functor.implement(Task, {
  map<from, to>(
    this: TaskValue<from> | void,
    fn: (value: from) => to,
  ): TaskValue<to> {
    const task = require_this(this, "Task.Functor.map");

    return Task(async () => fn(await run(task)));
  },
});

export interface TaskDictionary extends Functor<typeof Task> {}

Applicative.implement(Task, {
  pure<item>(
    value: item,
  ): TaskValue<item> {
    return succeed(value);
  },

  ap<from, to>(
    this: TaskValue<(value: from) => to> | void,
    value: TaskValue<from>,
  ): TaskValue<to> {
    const task = require_this(this, "Task.Applicative.ap");

    return Task(async () => {
      const [fn, item] = await Promise.all([run(task), run(value)]);
      return fn(item);
    });
  },
});

export interface TaskDictionary extends Applicative<typeof Task> {}

Monad.implement(Task, {
  bind<from, to>(
    this: TaskValue<from> | void,
    fn: (value: from) => TaskValue<to>,
  ): TaskValue<to> {
    const task = require_this(this, "Task.Monad.bind");

    return Task(async () => {
      const value = await run(task);
      return await run(fn(value));
    });
  },
});

export interface TaskDictionary extends Monad<typeof Task> {}

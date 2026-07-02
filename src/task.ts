import {
  as_trait,
  type Dictionary,
  item_type,
  kind,
  require_this,
  type Value,
  value_type,
} from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Task<item> = () => Promise<item>;

export const task_kind: unique symbol = Symbol("Task");

export interface TaskDictionary extends Dictionary<typeof task_kind> {
  <item>(run: Task<item>): TaskValue<item>;
  readonly [value_type]: Task<this[typeof item_type]>;
}

type TaskValue<item> = Value<TaskDictionary, item>;

export const Task: TaskDictionary = function <item>(
  run: Task<item>,
) {
  return as_trait(Task, run);
} as TaskDictionary;

Task[kind] = task_kind;

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
  fmt() {
    require_this(this, "Task.Format.fmt");
    return "Task(?)";
  },
});

export interface TaskDictionary extends Format<typeof Task> {}

Functor.implement(Task, {
  map<from, to>(
    this: TaskValue<from> | void,
    fn: (value: from) => to,
  ) {
    const task = require_this(this, "Task.Functor.map");

    return Task(async () => fn(await run(task)));
  },
});

export interface TaskDictionary extends Functor<typeof Task> {}

Applicative.implement(Task, {
  pure<item>(
    value: item,
  ) {
    return succeed(value);
  },

  ap<from, to>(
    this: TaskValue<(value: from) => to> | void,
    value: TaskValue<from>,
  ) {
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
  ) {
    const task = require_this(this, "Task.Monad.bind");

    return Task(async () => {
      const value = await run(task);
      return await run(fn(value));
    });
  },
});

export interface TaskDictionary extends Monad<typeof Task> {}

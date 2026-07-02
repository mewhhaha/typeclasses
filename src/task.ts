import { kind, require_this, type Trait, trait } from "./trait.ts";
import { Applicative, Format, Functor, Monad } from "./traits.ts";

export type Task<item> = () => Promise<item>;

type TaskValue<item> = Trait<typeof Task, Task<item>, item>;

export const task_kind: unique symbol = Symbol("Task");

declare module "./registry.ts" {
  interface Registry<item> {
    [task_kind]: Task<item>;
  }
}

export function Task<item>(
  run: Task<item>,
): TaskValue<item> {
  return trait<typeof Task, Task<item>, item>(
    Task,
    run,
  );
}

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

Task.fmt = function fmt(
  this: TaskValue<unknown> | void,
): string {
  require_this(this, "Task.fmt");
  return "Task(?)";
};

declare module "./traits.ts" {
  interface FormatImpl {
    [task_kind]: Format<typeof Task>;
  }
}

Task.map = function map<from, to>(
  this: TaskValue<from> | void,
  fn: (value: from) => to,
): TaskValue<to> {
  const task = require_this(this, "Task.map");

  return Task(async () => fn(await run(task)));
};

declare module "./traits.ts" {
  interface FunctorImpl {
    [task_kind]: Functor<typeof Task>;
  }
}

Task.pure = function pure<item>(
  value: item,
): TaskValue<item> {
  return succeed(value);
};

Task.ap = function ap<from, to>(
  this: TaskValue<(value: from) => to> | void,
  value: TaskValue<from>,
): TaskValue<to> {
  const task = require_this(this, "Task.ap");

  return Task(async () => {
    const [fn, item] = await Promise.all([run(task), run(value)]);
    return fn(item);
  });
};

declare module "./traits.ts" {
  interface ApplicativeImpl {
    [task_kind]: Applicative<typeof Task>;
  }
}

Task.bind = function bind<from, to>(
  this: TaskValue<from> | void,
  fn: (value: from) => TaskValue<to>,
): TaskValue<to> {
  const task = require_this(this, "Task.bind");

  return Task(async () => {
    const value = await run(task);
    return await run(fn(value));
  });
};

declare module "./traits.ts" {
  interface MonadImpl {
    [task_kind]: Monad<typeof Task>;
  }
}

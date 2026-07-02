import { kind, require_this, trait_constructor, type Value } from "./trait.ts";
import {
  Applicative,
  applicative_trait,
  type ApplicativeImplementation,
  Format,
  format_trait,
  type FormatImplementation,
  Functor,
  functor_trait,
  type FunctorImplementation,
  Monad,
  monad_trait,
  type MonadImplementation,
} from "./traits.ts";

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

const task_format = {
  fmt(this: TaskValue<unknown> | void): string {
    require_this(this, "Task.Format.fmt");
    return "Task(?)";
  },
} satisfies FormatImplementation<typeof Task>;

Task[format_trait] = task_format;
Task.fmt = task_format.fmt;

export interface TaskDictionary
  extends Format<typeof Task>, FormatImplementation<typeof Task> {}

const task_functor = {
  map<from, to>(
    this: TaskValue<from> | void,
    fn: (value: from) => to,
  ): TaskValue<to> {
    const task = require_this(this, "Task.Functor.map");

    return Task(async () => fn(await run(task)));
  },
} satisfies FunctorImplementation<typeof Task>;

Task[functor_trait] = task_functor;
Task.map = task_functor.map;

export interface TaskDictionary
  extends Functor<typeof Task>, FunctorImplementation<typeof Task> {}

const task_applicative = {
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
} satisfies ApplicativeImplementation<typeof Task>;

Task[applicative_trait] = task_applicative;
Task.pure = task_applicative.pure;
Task.ap = task_applicative.ap;

export interface TaskDictionary
  extends Applicative<typeof Task>, ApplicativeImplementation<typeof Task> {}

const task_monad = {
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
} satisfies MonadImplementation<typeof Task>;

Task[monad_trait] = task_monad;
Task.bind = task_monad.bind;

export interface TaskDictionary
  extends Monad<typeof Task>, MonadImplementation<typeof Task> {}

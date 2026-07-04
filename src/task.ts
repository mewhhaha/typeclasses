import { type As, define, type Value } from "./trait.ts";
import { type Effect, is_lift_of, type Lift } from "./effects.ts";
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

export async function run_task<
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
    return await run_task(effect.resume(await operation.value.value()()));
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
    return Task(async () => fn(await this.value()()));
  },
});

export interface AsTask extends Functor<AsTask> {}

Applicative.implement(Task)({
  pure(value) {
    return succeed(value);
  },

  ap(value) {
    return Task(async () => {
      const [fn, item] = await Promise.all([
        this.value()(),
        value.value()(),
      ]);
      return fn(item);
    });
  },
});

export interface AsTask extends Applicative<AsTask> {}

Monad.implement(Task)({
  bind(fn) {
    return Task(async () => {
      const value = await this.value()();
      return await fn(value).value()();
    });
  },
});

export interface AsTask extends Monad<AsTask> {}

import {
  type As,
  type Data,
  data,
  type Dictionary,
  kind,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import type { Effect, Lift } from "./effects.ts";
import { Applicative, Functor, Monad, Show } from "./typeclasses.ts";

export type Task<item> = () => Promise<item>;

export interface AsTask
  extends
    As<AsTask>,
    Show<AsTask>,
    Functor<AsTask>,
    Applicative<AsTask>,
    Monad<AsTask> {
  readonly [type_item]: unknown;
  readonly [type_data]: Task<this[typeof type_item]>;
}

type TaskValue<item> = Data<AsTask, item>;

export const Task: AsTask = data<AsTask>();

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

  const operation = effect.operation as {
    readonly tag?: string;
    readonly value?: unknown;
  };

  if (operation.tag === "lift" && is_task_value(operation.value)) {
    const lifted = effect.operation as unknown as Lift<AsTask, unknown>;
    return await run_task(effect.resume(await lifted.value.value()()));
  }

  throw new TypeError("Unhandled effect operation");
}

function is_task_value(value: unknown): value is Dictionary {
  if (typeof value !== "object") {
    return false;
  }

  if (value === null) {
    return false;
  }

  return (value as Dictionary)[kind] === Task[kind];
}

Show.instance(Task)({
  show() {
    return "Task(?)";
  },
});

Functor.instance(Task)({
  map(fn) {
    return Task(async () => fn(await this.value()()));
  },
});

Applicative.instance(Task)({
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

Monad.instance(Task)({
  bind(fn) {
    return Task(async () => {
      const value = await this.value()();
      return await fn(value).value()();
    });
  },
});

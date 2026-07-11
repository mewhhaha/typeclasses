import {
  type As,
  type Data,
  data,
  type Dictionary,
  type type_data,
  type type_item,
} from "./typeclass.ts";
import type { Effect, Lift } from "./effects.ts";
import { is_kind_of } from "./internal.ts";
import {
  Applicative,
  applicative_lift_method,
  Functor,
  Monad,
  MonadError,
  Show,
} from "./typeclasses.ts";

export type Task<item> = () => Promise<item>;

export interface AsTask extends As<AsTask>, Show<AsTask>, MonadError<AsTask> {
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
  let current = effect as Effect<Lift<AsTask, unknown>, unknown>;

  while (true) {
    switch (current[0]) {
      case "pure":
        return current[1] as item;
      case "impure": {
        const operation = current[1] as readonly [string, unknown];

        if (operation[0] === "lift" && is_task_value(operation[1])) {
          const lifted = current[1] as unknown as Lift<AsTask, unknown>;
          current = current[2](await lifted[1].value()()) as Effect<
            Lift<AsTask, unknown>,
            unknown
          >;
          continue;
        }

        throw new TypeError("Unhandled effect operation");
      }
    }
  }
}

function is_task_value(value: unknown): value is Dictionary {
  return is_kind_of(value, Task);
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

  [applicative_lift_method](fn, rest) {
    const first = this.value();
    const tasks = rest.map((current) => current.value());

    return Task(async () => {
      const values = await Promise.all([
        first(),
        ...tasks.map((task) => task()),
      ]);

      return fn(...values);
    });
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

MonadError.instance(Task)({
  throw_error(error) {
    return Task(() => Promise.reject(error));
  },

  catch_error(handler) {
    return Task(async () => {
      try {
        return await this.value()();
      } catch (error) {
        return await handler(error).value()();
      }
    });
  },
});

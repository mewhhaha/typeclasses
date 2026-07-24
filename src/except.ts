import {
  type Effect,
  type Ensuring,
  has_tag,
  type Operation,
  pure,
  send,
  suspend,
} from "./effects.ts";
import { type EitherValue, Left, Right } from "./either.ts";
import { from_fn, type TaskOptions, type TaskValue } from "./task.ts";

/** An operation that short-circuits a program with a typed error.
 *
 * `Fails` is a capability like `Uses<AsReader<config>>`: it is declared in a
 * program's requirement union and removed by its handler. Unlike a lift it
 * produces no value, because a failing program never resumes.
 */
export type Fails<error> = Operation<never> & readonly ["except.fail", error];

/** Removes the failure capability from a requirement union. */
export type WithoutFails<requirements, error> = requirements extends
  Fails<error> ? never
  : requirements;

/** Short-circuits the current program with `error`.
 *
 * The returned effect never produces an item, so `yield* fail(...)` is usable
 * in any position:
 *
 * ```ts
 * import { Program, type Uses } from "@mewhhaha/typeclasses/effects";
 * import { fail, type Fails } from "@mewhhaha/typeclasses/except";
 *
 * type Missing = readonly ["missing", string];
 * const Lookup = Program.scope<Fails<Missing>>();
 *
 * const find = (table: Record<string, number>, key: string) =>
 *   Lookup(function* () {
 *     const value = table[key];
 *     if (value === undefined) {
 *       yield* fail<Missing>(["missing", key]);
 *     }
 *     return value as number;
 *   });
 * ```
 */
export function fail<error>(error: error): Effect<Fails<error>, never> {
  // `Operation` marks its output with an optional phantom property, so
  // `OperationOutput<Operation<never>>` widens to `undefined`. A failing
  // operation genuinely never resumes, so the declared `never` is the honest
  // signature and the cast stays local to this function.
  return send(["except.fail", error] as Fails<error>) as unknown as Effect<
    Fails<error>,
    never
  >;
}

/** Lifts an Either, failing the program on its left branch. */
export function from_either<error, item>(
  value: EitherValue<error, item>,
): Effect<Fails<error>, item> {
  const raw = value.value();

  if (raw[0] === "Left") {
    return fail(raw[1] as error);
  }

  return pure(raw[1] as item);
}

/** Defers a promise, routing rejection into the failure channel.
 *
 * The `Task` dictionary reports rejection as an untyped promise failure.
 * `attempt` converts that into a typed `Fails` operation so the error stays
 * visible in the program's requirements.
 */
export function attempt<error, item>(
  run: (signal: AbortSignal | undefined) => Promise<item>,
  on_error: (cause: unknown) => error,
  options: TaskOptions = {},
): TaskValue<Attempted<error, item>> {
  return from_fn<Attempted<error, item>>(async (signal) => {
    try {
      return ["ok", await run(signal)] as const;
    } catch (cause) {
      return ["error", on_error(cause)] as const;
    }
  }, options);
}

/** The settled outcome of an `attempt`, before it re-enters the program. */
export type Attempted<error, item> =
  | readonly ["ok", item]
  | readonly ["error", error];

/** Re-enters the failure channel from a settled `attempt` outcome. */
export function attempted<error, item>(
  outcome: Attempted<error, item>,
): Effect<Fails<error>, item> {
  if (outcome[0] === "error") {
    return fail(outcome[1]);
  }

  return pure(outcome[1]);
}

/** Handles failures, collapsing the program's item into an Either.
 *
 * Each handler removes one capability, so `run_except` sits alongside
 * `run_reader` and `run_state` in an interpreter chain:
 *
 * ```ts
 * const handled = run_except<App, Missing, number>(program);
 * const result = await run_task(run_reader(handled, config));
 * ```
 */
export function run_except<requirements, error, item>(
  effect: Effect<requirements, item>,
): Effect<WithoutFails<requirements, error>, EitherValue<error, item>> {
  type Handled = Effect<
    WithoutFails<requirements, error>,
    EitherValue<error, item>
  >;

  if (effect[0] === "pure") {
    return pure(Right<error, item>(effect[1])) as unknown as Handled;
  }

  const operation = effect[1];
  const resume = effect[2];

  if (has_tag(operation, "except.fail")) {
    // Drop the continuation: this is the short circuit, and the reason the
    // capability cannot be expressed through `handle_lift`, whose handler must
    // always produce a value for the program to resume with.
    return pure(
      Left<error, item>((operation as Fails<error>)[1]),
    ) as unknown as Handled;
  }

  if (has_tag(operation, "effect.ensuring")) {
    // Failures raised inside a protected scope must still be caught, so the
    // nested effect is handled too and its Either is unwrapped before the
    // outer program resumes. The finalizer therefore observes a successful
    // exit for a failing scope, because `run_except` turned that failure into
    // a value before `run_task` interpreted the scope.
    const scope = (operation as Ensuring)[1];
    const nested: Ensuring = ["effect.ensuring", {
      effect: run_except<unknown, error, unknown>(scope.effect),
      finalize: scope.finalize,
    }] as Ensuring;

    return suspend<
      WithoutFails<requirements, error>,
      EitherValue<error, item>
    >(
      nested as unknown as WithoutFails<requirements, error>,
      (value: unknown) => {
        const raw = (value as EitherValue<error, unknown>).value();

        if (raw[0] === "Left") {
          return pure(Left<error, item>(raw[1] as error)) as unknown as Handled;
        }

        return run_except<requirements, error, item>(resume(raw[1]));
      },
    ) as unknown as Handled;
  }

  return suspend(
    operation,
    (value: unknown) =>
      run_except<requirements, error, item>(
        resume(value),
      ),
  ) as unknown as Handled;
}

/** Handles failures by supplying a replacement program for the error. */
export function recover<requirements, error, item>(
  effect: Effect<requirements, item>,
  on_error: (error: error) => Effect<requirements, item>,
): Effect<WithoutFails<requirements, error>, item> {
  const handled = run_except<requirements, error, item>(effect);

  return bind_handled(handled, (result) => {
    const raw = result.value();

    if (raw[0] === "Left") {
      return on_error(raw[1] as error) as unknown as Effect<
        WithoutFails<requirements, error>,
        item
      >;
    }

    return pure(raw[1] as item);
  });
}

function bind_handled<requirements, error, item>(
  effect: Effect<requirements, EitherValue<error, item>>,
  next: (
    value: EitherValue<error, item>,
  ) => Effect<requirements, item>,
): Effect<requirements, item> {
  if (effect[0] === "pure") {
    return next(effect[1]);
  }

  const resume = effect[2];

  return suspend(
    effect[1],
    (value: unknown) => bind_handled(resume(value), next),
  );
}

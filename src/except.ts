import {
  bind,
  bind_from,
  type Effect,
  type Ensuring,
  has_tag,
  map,
  type Operation,
  pure,
  suspend,
  type Uses,
} from "./effects.ts";
import { type EitherValue, Left, Right } from "./either.ts";
import { type AsTask, from_fn, type TaskOptions } from "./task.ts";

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
 * import { Program } from "@mewhhaha/typeclasses/effects";
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
 *
 * A `try`/`finally` around a failure does not run its `finally` block: the
 * handler abandons the generator instead of resuming it. Use `Effect.ensuring`
 * for cleanup that must survive a failure.
 */
export function fail<error>(error: error): Effect<Fails<error>, never> {
  return suspend<Fails<error>, never>(["except.fail", error], refuse_resume);
}

/** Lifts an Either, failing the program on its left branch. */
export function from_either<error, item>(
  value: EitherValue<error, item>,
): Effect<Fails<error>, item> {
  const [branch, payload] = value.value();

  switch (branch) {
    case "Left":
      return fail(payload);
    case "Right":
      return pure(payload);
  }
}

/** Defers a promise, routing its rejection into the failure channel.
 *
 * The `Task` dictionary reports rejection as an untyped promise failure, so a
 * program that wants the error in its requirements awaits it through `attempt`:
 *
 * ```ts
 * const fetched = App(function* () {
 *   return yield* attempt(
 *     () => fetch_port(),
 *     (cause): Missing => ["missing", String(cause)],
 *   );
 * });
 * ```
 */
export function attempt<error, item>(
  run: (signal: AbortSignal | undefined) => Promise<item>,
  on_error: (cause: unknown) => error,
  options: TaskOptions = {},
): Effect<Uses<AsTask> | Fails<error>, item> {
  const settled = from_fn<Settled<error, item>>(async (signal) => {
    try {
      return ["ok", await run(signal)] as const;
    } catch (cause) {
      return ["error", on_error(cause)] as const;
    }
  }, options);

  return bind_from(settled, (outcome) => {
    const [branch, payload] = outcome;

    switch (branch) {
      case "error":
        return fail(payload);
      case "ok":
        return pure(payload);
    }
  });
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
 *
 * Name the program's whole error union: `run_except` catches every failure it
 * meets, and any `Fails` it does not name stays in the requirements.
 */
export function run_except<requirements, error, item>(
  effect: Effect<requirements, item>,
): Effect<WithoutFails<requirements, error>, EitherValue<error, item>> {
  return handle_fails<error, item>(effect) as Effect<
    WithoutFails<requirements, error>,
    EitherValue<error, item>
  >;
}

/** Handles failures by supplying a replacement program for the error.
 *
 * The replacement's own requirements join the result, so a replacement that can
 * fail keeps a `Fails` for the next handler to remove.
 */
export function recover<requirements, error, item, replacement = never>(
  effect: Effect<requirements, item>,
  on_error: (error: error) => Effect<replacement, item>,
): Effect<WithoutFails<requirements, error> | replacement, item> {
  const recovered = bind(
    handle_fails<error, item>(effect),
    (outcome): Effect<replacement, item> => {
      const [branch, payload] = outcome.value();

      switch (branch) {
        case "Left":
          return on_error(payload);
        case "Right":
          return pure(payload);
      }
    },
  );

  return recovered as Effect<
    WithoutFails<requirements, error> | replacement,
    item
  >;
}

/** The settled outcome of an `attempt`, before it re-enters the program. */
type Settled<error, item> =
  | readonly ["ok", item]
  | readonly ["error", error];

function handle_fails<error, item>(
  effect: Effect<unknown, item>,
): Effect<unknown, EitherValue<error, item>> {
  if (effect[0] === "pure") {
    return pure(Right<error, item>(effect[1]));
  }

  const operation = effect[1];
  const resume = effect[2];

  if (is_fails<error>(operation)) {
    // Dropping the continuation is the short circuit, and the reason this
    // capability cannot go through `handle_lift`, whose handler must always
    // produce a value for the program to resume with.
    return pure(Left<error, item>(operation[1]));
  }

  if (is_ensuring(operation)) {
    return handle_protected_fails<error, item>(operation[1], resume);
  }

  return suspend(
    operation,
    (value) => handle_fails<error, item>(resume(value)),
  );
}

function handle_protected_fails<error, item>(
  scope: Ensuring[1],
  resume: (value: unknown) => Effect<unknown, item>,
): Effect<unknown, EitherValue<error, item>> {
  // A failure inside the scope must still be caught, so the nested effect is
  // handled too. That turns the failure into a value before the terminal runner
  // interprets the scope, and an `EffectExit` carries no value, so the error
  // travels beside the effect for the finalizer to see it.
  let failure: readonly [error] | undefined;

  const protect: Ensuring = ["effect.ensuring", {
    effect: map(handle_fails<error, unknown>(scope.effect), (outcome) => {
      const [branch, payload] = outcome.value();

      if (branch === "Left") {
        failure = [payload];
      }

      return outcome;
    }),
    finalize: (exit) =>
      scope.finalize(
        failure === undefined ? exit : { status: "failed", error: failure[0] },
      ),
  }];

  return suspend(protect, (value) => {
    // The runner resumes with the nested effect's item, which the handler above
    // made an Either.
    const [branch, payload] = (value as EitherValue<error, unknown>).value();

    switch (branch) {
      case "Left":
        return pure(Left<error, item>(payload));
      case "Right":
        return handle_fails<error, item>(resume(payload));
    }
  });
}

function is_fails<error>(operation: unknown): operation is Fails<error> {
  return has_tag(operation, "except.fail");
}

function is_ensuring(operation: unknown): operation is Ensuring {
  return has_tag(operation, "effect.ensuring");
}

function refuse_resume(): never {
  throw new TypeError(
    "A failed program was resumed; except.fail never produces a value",
  );
}

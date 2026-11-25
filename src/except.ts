import {
  bind_from,
  type Effect,
  type Ensuring,
  type Operation,
  pure,
  suspend,
  type Uses,
} from "./effects.ts";
import { type Either, Left, Right } from "./either.ts";
import type { Maybe } from "./maybe.ts";
import { type AsTask, from_fn, is_task_cancellation } from "./task.ts";
import type { Validation } from "./validation.ts";

/** An operation that short-circuits a program with a typed error.
 *
 * `Fails` is a capability like `Uses<AsReader<config>>`: it is declared in a
 * program's requirement union and removed by its handler. Unlike a lift it
 * produces no value, because a failing program never resumes.
 */
export type Fails<error> = Operation<never> & readonly ["except.fail", error];

/** Removes the failure capability from a requirement union. */
export type WithoutFails<requirements> = requirements extends Fails<unknown>
  ? never
  : requirements;

/**
 * The error every failure in `requirements` can short-circuit with.
 *
 * Failures are dispatched by tag, so one handler catches every `fail` in the
 * program regardless of the error type it carries. The handler *produces* that
 * error rather than consuming it, so several failure types yield their union —
 * the Either's left branch is whichever one actually fired.
 */
export type FailsError<requirements> = requirements extends Fails<infer error>
  ? error
  : never;

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
  value: Either<error, item>,
): Effect<Fails<error>, item> {
  const [branch, payload] = value.value();

  switch (branch) {
    case "Left":
      return fail(payload);
    case "Right":
      return pure(payload);
  }
}

/** Lifts a Maybe, lazily producing a typed failure for Nothing. */
export function from_maybe<error, item>(
  value: Maybe<item>,
  on_nothing: () => error,
): Effect<Fails<error>, item> {
  const [branch, payload] = value.value();

  switch (branch) {
    case "Nothing":
      return fail(on_nothing());
    case "Just":
      return pure(payload);
  }
}

/** Lifts a nullable value, lazily producing a typed failure for null or undefined. */
export function from_nullable<error, item>(
  value: item | null | undefined,
  on_null: () => error,
): Effect<Fails<error>, NonNullable<item>> {
  if (value === null || value === undefined) {
    return fail(on_null());
  }

  return pure(value as NonNullable<item>);
}

/** Lifts a Validation, failing the program with its accumulated error on Invalid. */
export function from_validation<error, item>(
  value: Validation<error, item>,
): Effect<Fails<error>, item> {
  const [branch, payload] = value.value();

  switch (branch) {
    case "invalid":
      return fail(payload);
    case "valid":
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
class AttemptFailure<error> {
  readonly error: error;
  constructor(error: error) {
    this.error = error;
  }
}

class ProtectedFailure<error> {
  readonly error: error;
  constructor(error: error) {
    this.error = error;
  }
}

function resume_attempt<error, item>(
  outcome: unknown,
): Effect<Fails<error>, item> {
  if (outcome instanceof AttemptFailure) {
    return fail(outcome.error as error);
  }
  return pure(outcome as item);
}

export function attempt<error, item>(
  run: (signal: AbortSignal | undefined) => Promise<item>,
  on_error: (cause: unknown) => error,
): Effect<Uses<AsTask> | Fails<error>, item> {
  const settled = from_fn<unknown>((signal) => {
    let pending: Promise<item>;
    try {
      pending = run(signal);
    } catch (cause) {
      if (is_task_cancellation(cause)) {
        throw cause;
      }
      return new AttemptFailure(on_error(cause));
    }
    const promise = pending instanceof Promise
      ? pending
      : Promise.resolve(pending);
    return promise.catch((cause) => {
      if (is_task_cancellation(cause)) {
        throw cause;
      }
      return new AttemptFailure(on_error(cause));
    });
  });

  return bind_from(
    settled,
    resume_attempt as (outcome: unknown) => Effect<Fails<error>, item>,
  );
}

/** Handles failures, collapsing the program's item into an Either.
 *
 * Each handler removes one capability, so `run_except` sits alongside
 * `run_reader` and `run_state` in an interpreter chain:
 *
 * ```ts
 * const handled = run_except(program);
 * const result = await run_task(run_reader(handled, config));
 * ```
 *
 * `run_except` catches every failure it meets, so it removes the whole failure
 * capability and the left branch is the union of every error the program can
 * raise. The error type is read off the requirements rather than named, so it
 * cannot disagree with what the handler actually catches.
 */
export function run_except<requirements, item>(
  effect: Effect<requirements, item>,
): Effect<
  WithoutFails<requirements>,
  Either<FailsError<requirements>, item>
> {
  return handle_fails<FailsError<requirements>, item>(effect) as Effect<
    WithoutFails<requirements>,
    Either<FailsError<requirements>, item>
  >;
}

/** Handles failures by supplying a replacement program for the error.
 *
 * The replacement's own requirements join the result, so a replacement that can
 * fail keeps a `Fails` for the next handler to remove.
 */
export function recover<requirements, item, replacement = never>(
  effect: Effect<requirements, item>,
  on_error: (error: FailsError<requirements>) => Effect<replacement, item>,
): Effect<WithoutFails<requirements> | replacement, item> {
  return handle_recover<FailsError<requirements>, item, replacement>(
    effect as Effect<unknown, item>,
    on_error,
  ) as Effect<WithoutFails<requirements> | replacement, item>;
}

/** Translates failures into another error type while keeping other capabilities intact. */
export function map_error<requirements, item, next_error>(
  effect: Effect<requirements, item>,
  fn: (error: FailsError<requirements>) => next_error,
): Effect<WithoutFails<requirements> | Fails<next_error>, item> {
  return recover(effect, (error) => fail(fn(error)));
}

function operation_tag(operation: unknown): unknown {
  return typeof operation === "object" && operation !== null
    ? (operation as readonly [unknown])[0]
    : undefined;
}

function handle_fails_raw<error, item>(
  effect: Effect<unknown, item>,
  record: (error: error) => void,
): Effect<unknown, unknown> {
  if (effect[0] === "pure") {
    return effect;
  }

  const operation = effect[1];
  const resume = effect[2];
  const tag = operation_tag(operation);

  if (tag === "except.fail") {
    const error = (operation as Fails<error>)[1];
    record(error);
    return pure(new ProtectedFailure<error>(error));
  }

  if (tag === "effect.ensuring") {
    return handle_protected_raw<error, item>(
      (operation as Ensuring)[1],
      resume,
      record,
    );
  }

  return suspend(
    operation,
    (value) => handle_fails_raw<error, item>(resume(value), record),
  );
}

function make_protected_ensuring<error>(scope: Ensuring[1]): Ensuring {
  // Prepare allocates outcome state when the runner enters the scope. Reusing
  // the handled effect, including concurrent runs, never shares that state.
  return ["effect.ensuring", {
    effect: scope.effect,
    finalize: scope.finalize,
    prepare() {
      let original = scope;
      while (original.prepare !== undefined) original = original.prepare();
      const entered = original;
      let failed = false;
      let failure: error | undefined;
      const record = (error: error) => {
        failed = true;
        failure = error;
      };

      return {
        effect: handle_fails_raw<error, unknown>(entered.effect, record),
        finalize: (exit) =>
          entered.finalize(
            exit.status === "succeeded" && failed
              ? { status: "failed", error: failure }
              : exit,
          ),
      };
    },
  }];
}

function handle_protected_raw<error, item>(
  scope: Ensuring[1],
  resume: (value: unknown) => Effect<unknown, item>,
  outer_record: (error: error) => void,
): Effect<unknown, unknown> {
  return suspend(make_protected_ensuring<error>(scope), (value) => {
    if (value instanceof ProtectedFailure) {
      outer_record(value.error as error);
      return pure(value);
    }
    return handle_fails_raw<error, item>(resume(value), outer_record);
  });
}

function handle_recover<error, item, replacement>(
  effect: Effect<unknown, item>,
  on_error: (error: error) => Effect<replacement, item>,
): Effect<unknown, item> {
  if (effect[0] === "pure") {
    return effect;
  }

  const operation = effect[1];
  const resume = effect[2];
  const tag = operation_tag(operation);

  if (tag === "except.fail") {
    return on_error((operation as Fails<error>)[1]) as Effect<unknown, item>;
  }

  if (tag === "effect.ensuring") {
    return handle_protected_recover<error, item, replacement>(
      (operation as Ensuring)[1],
      resume,
      on_error,
    );
  }

  return suspend(
    operation,
    (value) =>
      handle_recover<error, item, replacement>(resume(value), on_error),
  );
}

function handle_protected_recover<error, item, replacement>(
  scope: Ensuring[1],
  resume: (value: unknown) => Effect<unknown, item>,
  on_error: (error: error) => Effect<replacement, item>,
): Effect<unknown, item> {
  return suspend(make_protected_ensuring<error>(scope), (value) => {
    if (value instanceof ProtectedFailure) {
      return on_error(value.error as error) as Effect<unknown, item>;
    }
    return handle_recover<error, item, replacement>(resume(value), on_error);
  });
}

function handle_fails<error, item>(
  effect: Effect<unknown, item>,
): Effect<unknown, Either<error, item>> {
  if (effect[0] === "pure") {
    return pure(Right<error, item>(effect[1]));
  }

  const operation = effect[1];
  const resume = effect[2];
  const tag = operation_tag(operation);

  if (tag === "except.fail") {
    // Dropping the continuation is the short circuit, and the reason this
    // capability cannot go through `handle_lift`, whose handler must always
    // produce a value for the program to resume with.
    return pure(Left<error, item>((operation as Fails<error>)[1]));
  }

  if (tag === "effect.ensuring") {
    return handle_protected_fails<error, item>(
      (operation as Ensuring)[1],
      resume,
    );
  }

  return suspend(
    operation,
    (value) => handle_fails<error, item>(resume(value)),
  );
}

function handle_protected_fails<error, item>(
  scope: Ensuring[1],
  resume: (value: unknown) => Effect<unknown, item>,
): Effect<unknown, Either<error, item>> {
  return suspend(make_protected_ensuring<error>(scope), (value) => {
    if (value instanceof ProtectedFailure) {
      return pure(Left<error, item>(value.error as error));
    }
    return handle_fails<error, item>(resume(value));
  });
}

function refuse_resume(): never {
  throw new TypeError(
    "A failed program was resumed; except.fail never produces a value",
  );
}

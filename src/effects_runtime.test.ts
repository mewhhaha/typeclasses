import { assert_equals, assert_true } from "./assert.ts";
import { Effect, type EffectExit, Program, type Uses } from "./effects.ts";
import { type AsTask, from_fn, run_task, succeed } from "./task.ts";

Deno.test("Effect runs deep map chains without growing the JavaScript stack", async () => {
  let effect: Effect<Uses<AsTask>, number> = Effect.lift(succeed(0));

  for (let index = 0; index < 50_000; index += 1) {
    effect = Effect.map(effect, (value) => value + 1);
  }

  assert_equals(await run_task(effect), 50_000);
});

Deno.test("Effect runs deep bind chains without growing the JavaScript stack", async () => {
  let effect: Effect<Uses<AsTask>, number> = Effect.lift(succeed(0));

  for (let index = 0; index < 50_000; index += 1) {
    effect = Effect.bind(effect, (value) => Effect.pure(value + 1));
  }

  assert_equals(await run_task(effect), 50_000);
});

Deno.test("Effect frames remain ordered when bind introduces another operation", async () => {
  const first = Effect.lift(succeed(20));
  const bound = Effect.bind(first, (value) => Effect.lift(succeed(value + 1)));
  const result = Effect.map(
    Effect.map(bound, (value) => value * 2),
    (value) => value + 1,
  );

  assert_equals(await run_task(result), 43);
});

Deno.test("Effect ensuring finalizes a Program when a lifted Task rejects", async () => {
  const exits: EffectExit[] = [];
  const program = Program(function* () {
    yield* Effect.lift(from_fn<never>(() => Promise.reject(new Error("boom"))));
    return "unreachable";
  });
  const protected_program = Effect.ensuring(program, (exit) => {
    exits.push(exit);
  });

  const error = await rejection_from(run_task(protected_program));

  assert_true(
    error.message.includes("boom"),
    "the program failure is preserved",
  );
  assert_equals(exits.length, 1);
  assert_equals(exits[0].status, "failed");
});

Deno.test("Effect ensuring runs an asynchronous finalizer after success", async () => {
  const events: string[] = [];
  const protected_effect = Effect.ensuring(
    Effect.lift(succeed(42)),
    async (exit) => {
      await Promise.resolve();
      events.push(exit.status);
    },
  );

  assert_equals(await run_task(protected_effect), 42);
  assert_equals(events, ["succeeded"]);
});

Deno.test("Effect ensuring reports both program and finalizer failures", async () => {
  const failed = Effect.ensuring(
    Effect.lift(
      from_fn<never>(() => Promise.reject(new Error("program failed"))),
    ),
    () => {
      throw new Error("cleanup failed");
    },
  );
  const error = await rejection_from(run_task(failed));

  assert_true(
    error instanceof AggregateError,
    "both failures use AggregateError",
  );
  assert_true(
    error.message.includes("both failed"),
    "the aggregate error explains the two failure paths",
  );
});

async function rejection_from(promise: Promise<unknown>): Promise<Error> {
  let caught: unknown;

  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  assert_true(
    caught instanceof Error,
    "expected the promise to reject with Error",
  );
  return caught as Error;
}

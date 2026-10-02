import { assert_equals, assert_true } from "./assert.ts";
import {
  Effect,
  type EffectExit,
  has_tag,
  Program,
  run,
  type Uses,
} from "./effects.ts";
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

Deno.test("operation builders preserve phantom output inference", () => {
  const ReadAnswer = Effect.operation<number>()(["test.read_answer"]);
  const requested: Effect<typeof ReadAnswer, number> = Effect.send(ReadAnswer);
  const doubled = Effect.map(requested, (answer) => answer * 2);

  assert_equals(doubled[0], "impure");

  if (doubled[0] === "pure") {
    throw new Error("expected the read operation to remain suspended");
  }

  assert_equals(doubled[1], ["test.read_answer"]);
  assert_equals(doubled[2](21)[1], 42);
});

Deno.test("custom operation handlers resume deep synchronous sequences iteratively", () => {
  const Tick = Effect.operation<void>()(["test.tick"]);
  const TickProgram = Program.scope<typeof Tick>();
  const program = TickProgram(function* () {
    for (let index = 0; index < 10_000; index += 1) {
      yield* Effect.send(Tick);
    }

    return "done";
  });
  let ticks = 0;
  const handled = Effect.handle_operation(
    program,
    (operation): operation is typeof Tick => has_tag(operation, "test.tick"),
    () => {
      ticks += 1;
      return Effect.pure<void>(undefined);
    },
  );

  assert_equals(run(handled), "done");
  assert_equals(ticks, 10_000);
});

Deno.test("custom operation handlers preserve unmatched operations", () => {
  const ReadAnswer = Effect.operation<number>()(["test.read_answer"]);
  const RecordAnswer = Effect.operation<void>()(["test.record_answer"]);
  const App = Program.scope<typeof ReadAnswer | typeof RecordAnswer>();
  const program = App(function* () {
    const answer = yield* Effect.send(ReadAnswer);
    yield* Effect.send(RecordAnswer);
    return answer * 2;
  });
  const answered = Effect.handle_operation(
    program,
    (operation): operation is typeof ReadAnswer =>
      has_tag(operation, "test.read_answer"),
    () => Effect.pure(21),
  );
  let records = 0;
  const recorded = Effect.handle_operation(
    answered,
    (operation): operation is typeof RecordAnswer =>
      has_tag(operation, "test.record_answer"),
    () => {
      records += 1;
      return Effect.pure<void>(undefined);
    },
  );

  assert_equals(run(recorded), 42);
  assert_equals(records, 1);
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

Deno.test("Program consumes deep pure yields before and after a suspension", async () => {
  const program = Program(function* () {
    let total = 0;
    for (let index = 0; index < 25_000; index += 1) {
      total += yield* Effect.pure(1);
    }
    total += yield* succeed(1);
    for (let index = 0; index < 25_000; index += 1) {
      total += yield* Effect.pure(1);
    }
    return total;
  });
  assert_equals(await run_task(program), 50_001);
  assert_equals(await run_task(program), 50_001);
});

Deno.test("suspended bind suffixes stay ordered and reusable across nested chunks", async () => {
  let effect: Effect<Uses<AsTask>, number> = Effect.lift(succeed(0));
  for (let index = 0; index < 50_000; index += 1) {
    effect = Effect.bind(effect, (value) => {
      const nested = Effect.bind(
        Effect.lift(succeed(value)),
        (item) => Effect.map(Effect.lift(succeed(item)), (item) => item + 1),
      );
      return Effect.map(nested, (item) => item + 1);
    });
  }
  assert_equals(await run_task(effect), 100_000);
  assert_equals(await run_task(effect), 100_000);
});

Deno.test("pending nested continuation queues concatenate without copying their prefix", () => {
  const Tick = Effect.operation<number>()(["test.queue_tick"]);
  let effect: Effect<typeof Tick, number> = Effect.send(Tick);
  for (let index = 0; index < 50_000; index += 1) {
    const previous = effect;
    const wrapped = Effect.map(
      Effect.bind(Effect.send(Tick), () => previous),
      (value) => value + 1,
    );
    if (wrapped[0] !== "impure") throw new Error("expected a suspended tick");
    effect = wrapped[2](0);
  }
  const execute = () =>
    run(Effect.handle_operation(
      effect,
      (operation): operation is typeof Tick =>
        has_tag(operation, "test.queue_tick"),
      () => Effect.pure(0),
    ));
  assert_equals(execute(), 50_000);
  assert_equals(execute(), 50_000);
});

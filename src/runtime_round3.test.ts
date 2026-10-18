import { assert_equals, assert_true } from "./assert.ts";
import { chunk_log, ChunkLog, flatten_chunk_log } from "./chunk_log.ts";
import { tell } from "./writer.ts";
import { compile_effect_plan, Effect, Program, run } from "./effects.ts";
import {
  handle_operations,
  prepare_cells,
  prepare_operations,
  provide_state,
} from "./handlers.ts";
import { State, state } from "./state.ts";
import { Applicative } from "./typeclasses.ts";
import { Reader } from "./reader.ts";
import { ParallelTask, run_task, succeed, traverse_task } from "./task.ts";

Deno.test("ChunkLog snapshots leaves, appends persistently and flattens deep Writer logs", () => {
  const input = [1, 2];
  const original = chunk_log(input);
  input[0] = 99;
  const extended = original.concat(chunk_log([3]));
  assert_equals(flatten_chunk_log(original), [1, 2]);
  assert_equals(flatten_chunk_log(extended), [1, 2, 3]);
  let writer = tell(ChunkLog.empty<number>());
  for (let index = 0; index < 10_000; index++) {
    writer = writer.bind(() => tell(chunk_log([index])));
  }
  assert_equals(
    flatten_chunk_log(writer.value()[1]),
    Array.from({ length: 10_000 }, (_, index) => index),
  );
});

Deno.test("compiled Effect graphs preserve branches, dynamic continuations, replay and multiresume", () => {
  const Read = Effect.operation<number>()(["round3.read"]);
  const plan = compile_effect_plan<typeof Read, number, number>([
    {
      tag: "branch",
      select: (value) => {
        if (value >= 3) return 2;
        return 1;
      },
    },
    {
      tag: "step",
      effect: (state) =>
        Effect.map(Effect.send(Read), (value) => value + state),
      resume: (_state, value) => value as number,
      next: 0,
    },
    { tag: "done", finish: (value) => value },
  ]);
  const pending = plan(0);
  const execute = (effect: Effect<typeof Read, number>) =>
    run(handle_operations(effect, { "round3.read": () => Effect.pure(1) }));
  assert_equals(execute(pending), 3);
  assert_equals(execute(pending), 3);
  assert_true(pending[0] === "impure", "plan should suspend");
  if (pending[0] !== "impure") throw new Error("expected suspension");
  assert_equals(execute(pending[2](5)), 5);
  assert_equals(execute(pending[2](2)), 3);
  const pure_loop = compile_effect_plan<never, number, number>([
    {
      tag: "branch",
      select: (value) => {
        if (value === 100_000) return 2;
        return 1;
      },
    },
    {
      tag: "step",
      effect: () => Effect.pure(1),
      resume: (state) => state + 1,
      next: 0,
    },
    { tag: "done", finish: (value) => value },
  ]);
  assert_equals(run(pure_loop(0)), 100_000);
});

Deno.test("prepared operation tables snapshot own functions and preserve emitted operations", () => {
  const A = Effect.operation<number>()(["round3.a"]);
  const B = Effect.operation<number>()(["round3.b"]);
  const table = { "round3.a": () => Effect.send(B) };
  const prepared = prepare_operations(table);
  table["round3.a"] = () => Effect.pure(99) as Effect<typeof B, number>;
  const pending = prepared(Effect.send(A));
  assert_equals(
    run(handle_operations(pending, { "round3.b": () => Effect.pure(7) })),
    7,
  );
});

Deno.test("prepared named cells preserve symbols, special keys, and repeated initial state", () => {
  const cell = state<"round3.state", number>("round3.state");
  const symbol = Symbol("name");
  const bindings = { [symbol]: provide_state(cell, 10) };
  const prepared = prepare_cells(bindings);
  const effect = Program(function* () {
    yield* cell.modify((value) => value + 1);
    return yield* cell.get();
  });
  assert_equals(prepared(effect), {
    result: 11,
    states: { [symbol]: 11 },
    logs: {},
  });
  assert_equals(prepared(effect), {
    result: 11,
    states: { [symbol]: 11 },
    logs: {},
  });
});

Deno.test("State register plans keep dynamic nested binds and reentrant runs isolated", () => {
  const S = State.with_state<number>();
  const base = S((state) => [state, state + 1] as const).map((value) =>
    value * 2
  );
  const bound = base.bind((value) => base.map((nested) => value + nested)).map((
    value,
  ) => value + 1);
  assert_equals(bound.run(2), [11, 4]);
  assert_equals(bound.run(2), [11, 4]);
  const reentrant = base.map((value) => value + base.run(10)[0]);
  assert_equals(reentrant.run(1), [22, 2]);
  assert_equals(
    Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      base,
      base,
      base,
    ).run(0),
    [6, 3],
  );
  const R = Reader.with_environment<number>();
  assert_equals(
    Applicative.lift(
      (a: number, b: number, c: number) => a + b + c,
      R((x) => x),
      R((x) => x + 1),
      R((x) => x + 2),
    ).run(2),
    9,
  );
});

Deno.test("Task completed slots distinguish undefined and parallel completion respects abort", async () => {
  assert_equals(await run_task(succeed(undefined)), undefined);
  assert_equals(await run_task(succeed(undefined).map(() => 2)), 2);
  assert_equals(
    await run_task(
      ParallelTask.pure((value: unknown) => value).ap(
        ParallelTask.pure(undefined),
      ),
    ),
    undefined,
  );
  assert_equals(
    await run_task(traverse_task([0, 1, 2], 8, () => succeed(undefined))),
    [undefined, undefined, undefined],
  );
  const controller = new AbortController();
  controller.abort("stop");
  let failed = false;
  try {
    await run_task(ParallelTask.pure(1), { signal: controller.signal });
  } catch {
    failed = true;
  }
  assert_true(failed, "aborted completed tasks must reject");
});

Deno.test("Reader and State preserve raw computations wrapped across families", () => {
  const S = State.with_state<number>();
  const R = Reader.with_environment<number>();
  const read_pair = R((value) => [value, value + 1] as const).map((
    [value, state],
  ) => [value + 2, state] as const);
  assert_equals(S(read_pair.value()).map((value) => value * 3).run(4), [18, 5]);
  const stateful = S((state) => [state * 2, state + 1] as const).map((value) =>
    value + 1
  );
  assert_equals(
    R(stateful.value()).map(([value, state]) => value + state).run(4),
    14,
  );
  assert_equals(S.pure(0).bind(() => S(read_pair.value())).run(4), [6, 5]);
  assert_equals(R.pure(0).bind(() => R(stateful.value())).run(4), [9, 5]);
});

Deno.test("Do preserves complete replay history after a generator mutates bind", async () => {
  const { Do } = await import("./typeclasses/monad.ts");
  const { Identity } = await import("./identity.ts");
  const descriptor = Object.getOwnPropertyDescriptor(Identity, "bind")!;
  let starts = 0;
  const bind = function (
    this: { value(): number },
    fn: (value: number) => unknown,
  ) {
    fn(this.value() + 10);
    return fn(this.value() + 20);
  };
  try {
    const result = Do(Identity, function* () {
      starts++;
      const first = yield* Identity(1);
      Object.defineProperty(Identity, "bind", {
        configurable: true,
        value: bind,
      });
      const second = yield* Identity(2);
      return first + second;
    });
    assert_equals(result.value(), 23);
    assert_equals(starts, 2);
  } finally {
    Object.defineProperty(Identity, "bind", descriptor);
  }
});

Deno.test("Do respects direct map overrides installed after a yield", async () => {
  const { Do } = await import("./typeclasses/monad.ts");
  const { Either, Right } = await import("./either.ts");
  const descriptor = Object.getOwnPropertyDescriptor(Either, "map")!;
  const original = Right(0).map;
  let calls = 0;
  const map = function (
    this: ReturnType<typeof Right<number>>,
    fn: (value: number) => unknown,
  ) {
    calls++;
    return original.call(this, (value: unknown) => fn(value as number));
  };
  try {
    const result = Do(Either, function* () {
      const first = yield* Right(1);
      Object.defineProperty(Either, "map", { configurable: true, value: map });
      const second = yield* Right(2);
      return first + second;
    });
    assert_equals(result.value(), ["Right", 3]);
    assert_equals(calls, 1);
  } finally {
    Object.defineProperty(Either, "map", descriptor);
  }
});

Deno.test("Task traversal forwards its cooperative scheduling budget to composed items", async () => {
  let schedules = 0;
  const traversal = traverse_task(
    [1, 2],
    1,
    (value) => succeed(value).map((item) => item + 1).map((item) => item + 1),
    {
      yield_every: 1,
      schedule: () => {
        schedules++;
        return Promise.resolve();
      },
    },
  );
  assert_equals(await run_task(traversal), [3, 4]);
  assert_equals(schedules, 4);
  let invalid = false;
  try {
    traverse_task([1], 1, succeed, { yield_every: 0 });
  } catch (error) {
    invalid = error instanceof RangeError;
  }
  assert_true(invalid, "invalid traversal scheduling budgets must reject");
});

Deno.test("prepared operation tables retain correlated output checking at application", () => {
  const Count = Effect.operation<number>()(["round3.count"]);
  const correct = prepare_operations({ "round3.count": () => Effect.pure(1) });
  assert_equals(run(correct(Effect.send(Count))), 1);
  const incorrect = prepare_operations({
    "round3.count": () => Effect.pure("wrong"),
  });
  const rejects_wrong_output = () => {
    // @ts-expect-error handlers must produce the operation's declared output
    incorrect(Effect.send(Count));
  };
  void rejects_wrong_output;
});

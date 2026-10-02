import { assert_equals, assert_true } from "./assert.ts";
import { Effect, type EffectExit, Program, type Uses } from "./effects.ts";
import { type EitherValue, Left, Right } from "./either.ts";
import {
  attempt,
  fail,
  type Fails,
  from_either,
  recover,
  run_except,
} from "./except.ts";
import { ask, type AsReader, reader, run_reader } from "./reader.ts";
import { ArrayT, type AsArray } from "./array.ts";
import { run_state, state } from "./state.ts";
import { run_writer, writer_cell } from "./writer.ts";
import {
  type AsTask,
  from_fn,
  run_task,
  run_task_exit,
  succeed,
} from "./task.ts";

type Missing = readonly ["missing", string];
type Invalid = readonly ["invalid", number];

// Failures dispatch by tag, so one handler catches every `fail` in the program
// whatever error it carries. Naming a single error type used to let the types
// claim the others were still pending while the handler had already caught them
// and mistyped them into the Either's left branch.
Deno.test("run_except reports every error the program can raise", async () => {
  const program = Program(function* () {
    const value = yield* Effect.lift(succeed(1));

    if (value > 0) {
      yield* fail<Invalid>(["invalid", value]);
    }

    yield* fail<Missing>(["missing", "key"]);
    return 0;
  });

  const handled = run_except(program);
  const result = await run_task(handled);

  // The left branch is the union of every error the program can raise, derived
  // from the requirements rather than named at the call site.
  expect_type<EitherValue<Missing | Invalid, number>>(result);
  // @ts-expect-error the left branch cannot be narrowed to one of them
  expect_type<EitherValue<Missing, number>>(result);

  assert_equals(
    result.value(),
    Left<Missing | Invalid, number>(["invalid", 1]).value(),
  );
});

Deno.test("run_except removes the failure capability entirely", () => {
  const program = Program(function* () {
    yield* fail<Invalid>(["invalid", 1]);
    yield* fail<Missing>(["missing", "key"]);
    return 0;
  });

  // Both failure types leave the requirements together, because the handler
  // catches both. Neither may be reported as still pending, which is what the
  // old `WithoutFails<requirements, error>` did for whichever one went unnamed.
  expect_type<Effect<never, EitherValue<Missing | Invalid, number>>>(
    run_except(program),
  );
});

function expect_type<expected>(_value: expected): void {}

Deno.test("run_except reports a successful program as a right branch", async () => {
  const program = Program(function* () {
    const value = yield* Effect.lift(succeed(41));
    return value + 1;
  });

  const handled = run_except(program);

  assert_equals((await run_task(handled)).value(), Right(42).value());
});

Deno.test("fail short-circuits the rest of the program", async () => {
  const performed: string[] = [];

  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    performed.push("before");
    yield* fail<Missing>(["missing", "key"]);
    performed.push("after");
    return yield* Effect.lift(succeed(1));
  });

  const handled = run_except(program);
  const result = await run_task(handled);

  assert_equals(
    result.value(),
    Left<Missing, number>(["missing", "key"]).value(),
  );
  assert_equals(performed, ["before"]);
});

Deno.test("from_either routes a left branch into the failure channel", async () => {
  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    const value = yield* from_either<Missing, number>(
      Left<Missing, number>(["missing", "port"]),
    );
    return value + 1;
  });

  const handled = run_except(program);

  assert_equals(
    (await run_task(handled)).value(),
    Left<Missing, number>(["missing", "port"]).value(),
  );
});

Deno.test("attempt converts a rejecting promise into a typed failure", async () => {
  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    return yield* attempt(
      () => Promise.reject(new Error("boom")),
      (cause): Missing => ["missing", String(cause)],
    );
  });

  const handled = run_except(program);
  const raw = (await run_task(handled)).value();

  assert_equals(raw[0], "Left");
  assert_true(
    String((raw[1] as Missing)[1]).includes("boom"),
    "the rejection reason is preserved in the typed error",
  );
});

Deno.test("attempt keeps a resolving promise on the success path", async () => {
  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    const value = yield* attempt(
      () => Promise.resolve(41),
      (cause): Missing => ["missing", String(cause)],
    );
    return value + 1;
  });

  const handled = run_except(program);

  assert_equals((await run_task(handled)).value(), Right(42).value());
});

Deno.test("recover replaces a failure with another program", async () => {
  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    yield* fail<Missing>(["missing", "key"]);
    return 0;
  });

  const recovered = recover(
    program,
    (error) => Effect.pure(error[1].length),
  );

  assert_equals(await run_task(recovered), 3);
});

Deno.test("a replacement that fails keeps the failure for the next handler", async () => {
  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    yield* fail<Missing>(["missing", "key"]);
    return 0;
  });

  const recovered = recover(
    program,
    (error: Missing) =>
      Program.scope<Fails<Missing>>()(function* () {
        yield* fail<Missing>(["missing", error[1] + "-retry"]);
        return 0;
      }),
  );

  const handled = run_except(recovered);

  assert_equals(
    (await run_task(handled)).value(),
    Left<Missing, number>(["missing", "key-retry"]).value(),
  );
});

Deno.test("recover leaves a successful program untouched", async () => {
  const program = Program(function* () {
    return yield* Effect.lift(succeed(42));
  });

  const recovered = recover(
    program,
    () => Effect.pure(0),
  );

  assert_equals(await run_task(recovered), 42);
});

Deno.test("failures compose with other capabilities in one program", async () => {
  type Config = { readonly minimum: number };
  type App = Uses<AsReader<Config>> | Uses<AsTask> | Fails<Missing>;

  const App = Program.scope<App>();

  const program = (candidate: number) =>
    App(function* () {
      const config = yield* ask<Config>();

      if (candidate < config.minimum) {
        yield* fail<Missing>(["missing", "candidate"]);
      }

      const scaled = yield* Effect.lift(
        from_fn(() => Promise.resolve(candidate * 2)),
      );
      return scaled;
    });

  const run = async (candidate: number) => {
    const handled = run_except(program(candidate));
    return (await run_task(run_reader(handled, { minimum: 10 }))).value();
  };

  assert_equals(await run(20), Right(40).value());
  assert_equals(
    await run(1),
    Left<Missing, number>(["missing", "candidate"]).value(),
  );
});

Deno.test("a failure inside a protected scope still runs the finalizer", async () => {
  const exits: EffectExit[] = [];

  const scope = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    yield* fail<Missing>(["missing", "resource"]);
    return 0;
  });

  const program = Effect.ensuring(scope, (exit) => {
    exits.push(exit);
  });

  const handled = run_except(program);
  const result = await run_task(handled);

  assert_equals(
    result.value(),
    Left<Missing, number>(["missing", "resource"]).value(),
  );
  assert_equals(exits, [{ status: "failed", error: ["missing", "resource"] }]);
});

Deno.test("a protected scope that succeeds still reports a successful exit", async () => {
  const exits: EffectExit[] = [];

  const scope = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    return yield* Effect.lift(succeed(7));
  });

  const program = Effect.ensuring(scope, (exit) => {
    exits.push(exit);
  });

  const handled = run_except(program);

  assert_equals((await run_task(handled)).value(), Right(7).value());
  assert_equals(exits, [{ status: "succeeded" }]);
});

Deno.test("run_except handles deep chains without growing the JavaScript stack", async () => {
  let effect: Effect<Uses<AsTask> | Fails<Missing>, number> = Effect.lift(
    succeed(0),
  );

  // Each bind adds an operation the handler must suspend and re-enter, so the
  // chain is far deeper than the JavaScript stack allows.
  for (let index = 0; index < 20_000; index += 1) {
    effect = Effect.bind(effect, (value) => Effect.lift(succeed(value + 1)));
  }

  const handled = run_except(effect);

  assert_equals((await run_task(handled)).value(), Right(20_000).value());
});

Deno.test("protected Except scopes keep outcomes local to repeated executions", async () => {
  let calls = 0;
  const exits: EffectExit[] = [];
  const scope = Program(function* () {
    const current = yield* from_fn(() => Promise.resolve(++calls));
    if (current === 1) return yield* fail("first execution");
    return 42;
  });
  const handled = run_except(Effect.ensuring(scope, (exit) => {
    exits.push(exit);
  }));
  assert_equals((await run_task(handled)).value(), ["Left", "first execution"]);
  assert_equals((await run_task(handled)).value(), ["Right", 42]);
  assert_equals(exits, [{ status: "failed", error: "first execution" }, {
    status: "succeeded",
  }]);
});

Deno.test("protected Except scopes keep concurrent outcomes separate", async () => {
  let calls = 0;
  const exits: EffectExit[] = [];
  const scope = Program(function* () {
    const current = yield* from_fn(() => Promise.resolve(++calls));
    if (current === 1) return yield* fail("first execution");
    return 42;
  });
  const handled = run_except(Effect.ensuring(scope, async (exit) => {
    await Promise.resolve();
    exits.push(exit);
  }));
  const results = await Promise.all([run_task(handled), run_task(handled)]);
  assert_equals(results.map((value) => value.value()), [[
    "Left",
    "first execution",
  ], ["Right", 42]]);
  assert_equals(exits.map((exit) => exit.status).sort(), [
    "failed",
    "succeeded",
  ]);
});

Deno.test("nested protected Except scopes finalize from inner to outer on every run", async () => {
  let calls = 0;
  const exits: string[] = [];
  const program = Program(function* () {
    const current = yield* from_fn(() => Promise.resolve(++calls));
    if (current === 1) return yield* fail("nested failure");
    return 42;
  });
  const protected_program = Effect.ensuring(
    Effect.ensuring(program, (exit) => {
      exits.push("inner:" + exit.status);
    }),
    (exit) => {
      exits.push("outer:" + exit.status);
    },
  );
  const handled = run_except(protected_program);
  assert_equals((await run_task(handled)).value(), ["Left", "nested failure"]);
  assert_equals((await run_task(handled)).value(), ["Right", 42]);
  assert_equals(exits, [
    "inner:failed",
    "outer:failed",
    "inner:succeeded",
    "outer:succeeded",
  ]);
});

Deno.test("protected Except execution preserves prepared Reader, State, and Writer handlers", async () => {
  const config = reader<"except-runtime-config", number>();
  const count = state<"except-runtime-count", number>();
  const audit = writer_cell<"except-runtime-audit", AsArray, string>(
    ArrayT<string>([]),
  );
  let calls = 0;
  const exits: EffectExit[] = [];
  const program = Program(function* () {
    const base = yield* config.ask();
    yield* count.modify((value) => value + base);
    yield* audit.tell(ArrayT(["before task"]));
    const current = yield* from_fn(() => Promise.resolve(++calls));
    if (current === 1) return yield* fail("first execution");
    const final = yield* count.get();
    yield* audit.tell(ArrayT(["after task"]));
    return final;
  });
  const prepared = run_writer(
    audit,
    run_state(count, run_reader(config, program, 2), 0),
    ArrayT<string>([]),
  );
  const handled = run_except(Effect.ensuring(prepared, (exit) => {
    exits.push(exit);
  }));
  assert_equals((await run_task(handled)).value(), ["Left", "first execution"]);
  const [tag, output] = (await run_task(handled)).value();
  assert_equals(tag, "Right");
  if (tag === "Right") {
    const [[item, final], log] = output;
    assert_equals([item, final], [2, 2]);
    assert_equals(log.value(), ["before task", "after task"]);
  }
  assert_equals(exits, [{ status: "failed", error: "first execution" }, {
    status: "succeeded",
  }]);
});

Deno.test("Except protected scopes preserve cancellation before pure handled failure completes", async () => {
  const controller = new AbortController();
  controller.abort("cancel handled completion");
  const exits: EffectExit[] = [];
  const handled = run_except(Effect.ensuring(fail("typed failure"), (exit) => {
    exits.push(exit);
  }));
  const result = await run_task_exit(handled, { signal: controller.signal });
  assert_equals(result.status, "cancelled");
  assert_equals(exits, [{
    status: "cancelled",
    reason: "cancel handled completion",
  }]);
});

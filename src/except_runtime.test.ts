import { assert_equals, assert_true } from "./assert.ts";
import {
  Effect,
  type EffectExit,
  type Ensuring,
  Program,
  type Uses,
} from "./effects.ts";
import { Left, Right } from "./either.ts";
import {
  attempt,
  fail,
  type Fails,
  from_either,
  recover,
  run_except,
} from "./except.ts";
import { ask, type AsReader, run_reader } from "./reader.ts";
import { type AsTask, from_fn, run_task, succeed } from "./task.ts";

type Missing = readonly ["missing", string];

Deno.test("run_except reports a successful program as a right branch", async () => {
  const program = Program(function* () {
    const value = yield* Effect.lift(succeed(41));
    return value + 1;
  });

  const handled = run_except<Uses<AsTask>, Missing, number>(program);

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

  const handled = run_except<
    Uses<AsTask> | Fails<Missing>,
    Missing,
    number
  >(program);
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

  const handled = run_except<
    Uses<AsTask> | Fails<Missing>,
    Missing,
    number
  >(program);

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

  const handled = run_except<
    Uses<AsTask> | Fails<Missing>,
    Missing,
    never
  >(program);
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

  const handled = run_except<
    Uses<AsTask> | Fails<Missing>,
    Missing,
    number
  >(program);

  assert_equals((await run_task(handled)).value(), Right(42).value());
});

Deno.test("recover replaces a failure with another program", async () => {
  const program = Program.scope<Uses<AsTask> | Fails<Missing>>()(function* () {
    yield* fail<Missing>(["missing", "key"]);
    return 0;
  });

  const recovered = recover<Uses<AsTask> | Fails<Missing>, Missing, number>(
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

  const handled = run_except<
    Uses<AsTask> | Fails<Missing>,
    Missing,
    number
  >(recovered);

  assert_equals(
    (await run_task(handled)).value(),
    Left<Missing, number>(["missing", "key-retry"]).value(),
  );
});

Deno.test("recover leaves a successful program untouched", async () => {
  const program = Program(function* () {
    return yield* Effect.lift(succeed(42));
  });

  const recovered = recover<Uses<AsTask>, Missing, number>(
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
    const handled = run_except<App, Missing, number>(program(candidate));
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

  const handled = run_except<
    Ensuring | Fails<Missing>,
    Missing,
    number
  >(program);
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

  const handled = run_except<
    Uses<AsTask> | Ensuring | Fails<Missing>,
    Missing,
    number
  >(program);

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

  const handled = run_except<
    Uses<AsTask> | Fails<Missing>,
    Missing,
    number
  >(effect);

  assert_equals((await run_task(handled)).value(), Right(20_000).value());
});

import { assert_equals } from "./assert.ts";
import { type AsEither, Either, Left, Right } from "./either.ts";
import { data, kind } from "./typeclass.ts";
import { same_context } from "./internal.ts";
import { from_fn, Task } from "./task.ts";
import { Do, Monad, MonadError } from "./typeclasses.ts";

Deno.test("runtime Do routes MonadError failures through generator catch", () => {
  const Strings = Either.with_left<string>();
  const recovered = Do(Strings, function* () {
    try {
      yield* Left<string, number>("missing");
      return 0;
    } catch (error) {
      const offset = yield* Right<string, number>(1);
      return String(error).length + offset;
    }
  });
  const unhandled = Do(Strings, function* () {
    yield* Left<string, number>("missing");
    return 0;
  });

  assert_equals(recovered.value(), ["Right", 8] as const);
  assert_equals(unhandled.value(), ["Left", "missing"] as const);
});

Deno.test("runtime Do catches rejected Task values", async () => {
  const recovered = Do(Task, function* () {
    try {
      yield* MonadError.throw_error<typeof Task, number>(
        Task,
        new Error("boom"),
      );
      return "unreachable";
    } catch (error) {
      return (error as Error).message;
    }
  });

  assert_equals(await recovered.run(), "boom");
});

Deno.test("runtime Do executes each rejected Task yield once per run", async () => {
  const calls: string[] = [];
  const failure = new Error("boom");
  const program = Do(Task, function* () {
    yield* from_fn(() => {
      calls.push("first");
      return Promise.resolve(1);
    });
    yield* from_fn<number>(() => {
      calls.push("failed");
      return Promise.reject(failure);
    });
    return 0;
  });
  for (let index = 0; index < 2; index += 1) {
    let caught: unknown;
    try {
      await program.run();
    } catch (error) {
      caught = error;
    }
    assert_equals(caught, failure);
  }
  assert_equals(calls, ["first", "failed", "first", "failed"]);
});

Deno.test("runtime Do replays Task catch paths with yielding recovery", async () => {
  const calls: string[] = [];
  const program = Do(Task, function* () {
    try {
      yield* from_fn<number>(() => {
        calls.push("failed");
        return Promise.reject(new Error("boom"));
      });
      return 0;
    } catch (error) {
      const offset = yield* from_fn(() => {
        calls.push("recovered");
        return Promise.resolve(1);
      });
      return (error as Error).message.length + offset;
    }
  });
  assert_equals(await program.run(), 5);
  assert_equals(await program.run(), 5);
  assert_equals(calls, ["failed", "recovered", "failed", "recovered"]);
});

Deno.test("runtime Do converts a rethrown error through the yielded dictionary", () => {
  const Strings = Either.with_left<string>();
  const program = Do(Strings, function* () {
    try {
      yield* Left<string, number>("original");
    } catch (error) {
      throw String(error) + " replaced";
    }
    return 0;
  });
  assert_equals(program.value(), ["Left", "original replaced"]);
});

Deno.test("runtime Do propagates errors through the yielded value's own dictionary", () => {
  const Errors = data<AsEither<string>>();
  const raised: string[] = [];
  Monad.derive(Errors)({
    pure(value) {
      return Errors(["Right", value]);
    },
    bind(fn) {
      const [tag, value] = this.value();
      switch (tag) {
        case "Left":
          return same_context(this);
        case "Right":
          return fn(value);
      }
    },
  });
  MonadError.instance(Errors)({
    throw_error<item>(error: string) {
      raised.push(error);
      return Errors<item>(["Left", error]);
    },
    catch_error(handler) {
      const [tag, value] = this.value();
      switch (tag) {
        case "Left":
          return handler(value);
        case "Right":
          return same_context(this);
      }
    },
  });
  const program = Do(Errors, function* () {
    yield* Errors(["Left", "custom failure"]);
    return 0;
  });
  assert_equals(program.value(), ["Left", "custom failure"]);
  assert_equals(program[kind], Errors[kind]);
  assert_equals(raised, ["custom failure"]);
});

Deno.test("runtime Do keeps concurrent Task recoveries separate", async () => {
  let calls = 0;
  const program = Do(Task, function* () {
    try {
      yield* from_fn<never>(() => Promise.reject(++calls));
      return 0;
    } catch (error) {
      const current = error as number;
      const offset = yield* from_fn(() => Promise.resolve(10));
      return current + offset;
    }
  });
  assert_equals(await Promise.all([program.run(), program.run()]), [11, 12]);
  assert_equals(calls, 2);
});

import { assert_equals } from "./assert.ts";
import { Either, Left, Right } from "./either.ts";
import { Task } from "./task.ts";
import { Do, MonadError } from "./typeclasses.ts";

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

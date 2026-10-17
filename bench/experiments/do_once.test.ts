import { assert_equals, assert_true } from "../../src/assert.ts";
import { ArrayT } from "../../src/array.ts";
import { Identity } from "../../src/identity.ts";
import { from_fn, run_task, succeed } from "../../src/task.ts";
import { Do } from "../../src/typeclasses.ts";
import { Do_once } from "./do_once.ts";
Deno.test("Do_once preserves linear values and rejects branching resumes", () => {
  const linear = Do_once(function* () {
    const first = yield* Identity(20);
    return first + (yield* Identity(22));
  });
  assert_equals(linear.value(), 42);
  let error: unknown;
  try {
    Do_once(function* () {
      return yield* ArrayT([1, 2]);
    });
  } catch (caught) {
    error = caught;
  }
  assert_true(
    error instanceof TypeError,
    "one-shot generator rejects multi-resume",
  );
  assert_equals(
    Do(function* () {
      return (yield* ArrayT([1, 2])) + 1;
    }).value(),
    [2, 3],
  );
});

Deno.test("Do_once routes asynchronous errors through generator recovery", async () => {
  const task = Do_once(function* () {
    try {
      yield* from_fn(() => Promise.reject(new Error("expected")));
    } catch {
      return yield* succeed(42);
    }
    return 0;
  });
  assert_equals(await run_task(task), 42);
});

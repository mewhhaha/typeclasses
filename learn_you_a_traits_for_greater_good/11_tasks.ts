import { assert_equals } from "../src/assert.ts";
import { from_fn, succeed } from "../src/task.ts";
import { Applicative, Do } from "../src/typeclasses.ts";

export async function lesson_11_tasks() {
  const sequential = Do(function* () {
    const left = yield* from_fn(() => Promise.resolve(20));
    const right = yield* succeed(22);

    return left + right;
  });
  const independent = Applicative.lift(
    (left: number, right: number) => left + right,
    from_fn(() => Promise.resolve(20)),
    from_fn(() => Promise.resolve(22)),
  );

  assert_equals(await sequential.run(), 42);
  assert_equals(await independent.run(), 42);
}

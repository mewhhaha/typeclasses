import { ArrayT } from "./array.ts";
import { assert_equals } from "./assert.ts";
import { Either, Right } from "./either.ts";
import { Effect } from "./effects.ts";
import { Identity } from "./identity.ts";
import { from_array as list_from_array, List, to_array } from "./list.ts";
import { done, rec } from "./loop.ts";
import { Maybe } from "./maybe.ts";
import { run_task, Task } from "./task.ts";
import { MonadRec } from "./typeclasses.ts";

const iterations = 50_000;

Deno.test("MonadRec runs strict monads without growing the stack", async () => {
  assert_equals(
    MonadRec.tail_rec_m(Identity, 0 as number, (current) =>
      Identity.pure(
        current === iterations ? done(current) : rec(current + 1),
      )).value(),
    iterations,
  );
  assert_equals(
    MonadRec.tail_rec_m(Maybe, 0 as number, (current) =>
      Maybe.pure(
        current === iterations ? done(current) : rec(current + 1),
      )).value(),
    ["Just", iterations],
  );
  assert_equals(
    MonadRec.tail_rec_m(
      Either.with_left<string>(),
      0 as number,
      (current) =>
        Right<
          string,
          ReturnType<typeof done<number>> | ReturnType<typeof rec<number>>
        >(
          current === iterations ? done(current) : rec(current + 1),
        ),
    ).value(),
    ["Right", iterations],
  );
  assert_equals(
    MonadRec.tail_rec_m(ArrayT, 0 as number, (current) =>
      ArrayT.pure(
        current === iterations ? done(current) : rec(current + 1),
      )).value(),
    [iterations],
  );
  assert_equals(
    to_array(
      MonadRec.tail_rec_m(List, 0 as number, (current) =>
        list_from_array([
          current === iterations ? done(current) : rec(current + 1),
        ])),
    ),
    [iterations],
  );
  assert_equals(
    await run_task(Effect.lift(
      MonadRec.tail_rec_m(Task, 0 as number, (current) =>
        Task.pure(
          current === iterations ? done(current) : rec(current + 1),
        )),
    )),
    iterations,
  );
});

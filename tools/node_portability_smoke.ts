import { Effect, Just, Nothing, Ord, Program, worker_map } from "../src/mod.ts";
import { Right } from "../src/either.ts";
import { done, loop, rec } from "../src/loop.ts";
import { fmap } from "../src/prelude.ts";
import { atomically, new_tvar, read_tvar } from "../src/stm.ts";
import { succeed } from "../src/task.ts";

const shown = Just({ count: 1 }).show();

if (shown !== "Just({ count: 1 })") {
  throw new Error("unexpected Show output: " + shown);
}

if (!Just(42).eq(Just(42))) {
  throw new Error("Eq failed under this runtime");
}

if (Ord.compare(Nothing<number>(), Just(1)) !== "lt") {
  throw new Error("Ord failed under this runtime");
}

if (Ord.compare(Just({ count: 1 }), Just({ count: 2 })) !== "lt") {
  throw new Error("Ord structural fallback failed under this runtime");
}

const matched = Right<string, number>(41).match({
  Left: () => 0,
  Right: (value) => value + 1,
});

if (matched !== 42) {
  throw new Error("tagged match failed under this runtime: " + String(matched));
}

const mapped = fmap((value: number) => value + 1, Just(41));

if (!mapped.eq(Just(42))) {
  throw new Error("prelude fmap failed under this runtime");
}

const task_result = await succeed(42).run();

if (task_result !== 42) {
  throw new Error("Task failed under this runtime: " + String(task_result));
}

const counter = new_tvar(42);
const counter_value = atomically(read_tvar(counter));

if (counter_value !== 42) {
  throw new Error("Stm failed under this runtime: " + String(counter_value));
}

const loop_result = loop(
  0,
  (value) => value === 42 ? done(value) : rec(value + 1),
);

if (loop_result !== 42) {
  throw new Error("loop failed under this runtime: " + String(loop_result));
}

if (
  typeof Effect.pure !== "function" || typeof Program !== "function" ||
  typeof worker_map !== "function"
) {
  throw new Error("root package entrypoint is incomplete under this runtime");
}

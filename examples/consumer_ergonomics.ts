import { ArrayT } from "../src/array.ts";
import { Either } from "../src/either.ts";
import { Just, Maybe } from "../src/maybe.ts";
import { fmap, lift, traverse, unless, when } from "../src/prelude.ts";
import { Reader } from "../src/reader.ts";
import { State } from "../src/state.ts";
import { from_fn, parallel, run_task, Task } from "../src/task.ts";
import { Functor } from "../src/typeclasses.ts";
import { Validation } from "../src/validation.ts";
import { writer_cell } from "../src/writer.ts";

/** Compare public calling styles and infer configured contexts from their inputs. */
export async function run_consumer_ergonomics_scenario() {
  const fluent = Just(41).map((value) => value + 1);
  const { map } = Functor;
  const generic = map(Just(41), (value) => value + 1);
  const function_first = fmap((value) => value + 1, Just(41));

  // Namespaced constructors preserve the same inference as standalone ones.
  const either = Either.Right(41).map((value) => value + 1);
  const validation = Validation.Valid(41).map((value) => value + 1);
  const traversed = traverse((value) => Just(value + 1), Maybe, ArrayT([1, 2]));
  const profile = lift(
    (id, name, email, enabled, rank, tags) => ({
      id,
      name,
      email,
      enabled,
      rank,
      tags,
    }),
    Just(42),
    Just("Ada"),
    Just("ada@example.test"),
    Just(true),
    Just(1),
    Just(["math"]),
  );

  // Fixed dictionaries give pure and dependent steps their context types.
  const Configuration = Reader.with_environment<{ prefix: string }>();
  const label = Configuration((config) => config.prefix)
    .bind((prefix) => Configuration.pure(prefix + "ready"));
  const Counter = State.with_state<number>();
  const count = Counter((state) => [state, state + 1] as const)
    .bind((previous) => Counter.pure(previous));

  const audit = writer_cell("audit", ArrayT<string>([]));
  const recorded = audit.pure("ready")
    .bind((value) => audit.tell(ArrayT([value])).map(() => value));
  const [recorded_value, recorded_log] = recorded.value();

  const events: string[] = [];
  const notify = from_fn(async () => {
    await Promise.resolve();
    events.push("notify");
  });
  const skipped = when(Task, false, notify);
  const selected = unless(Task, false, notify);
  const sequential_sum = lift(
    (left, right) => left + right,
    from_fn(() => {
      events.push("left");
      return Promise.resolve(20);
    }),
    from_fn(() => {
      events.push("right");
      return Promise.resolve(22);
    }),
  );
  const parallel_sum = lift(
    (left, right) => left + right,
    parallel(from_fn(() => Promise.resolve(20))),
    parallel(from_fn(() => Promise.resolve(22))),
  );

  const before_run = [...events];
  await run_task(skipped);
  const after_skip = [...events];
  await run_task(selected);

  return {
    fluent: fluent.value(),
    generic: generic.value(),
    function_first: function_first.value(),
    either: either.value(),
    validation: validation.value(),
    traversed: traversed.map((values) => values.value()).value(),
    profile: profile.value(),
    reader: label.run({ prefix: "app:" }),
    state: count.run(7),
    audit: [recorded_value, recorded_log.value()] as const,
    before_run,
    after_skip,
    sequential_sum: await run_task(sequential_sum),
    parallel_sum: await run_task(parallel_sum),
    events,
  };
}

export async function run_consumer_ergonomics_examples() {
  console.log("consumer ergonomics", await run_consumer_ergonomics_scenario());
}

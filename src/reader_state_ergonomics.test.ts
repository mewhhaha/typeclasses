import { assert_equals, assert_true } from "./assert.ts";
import { Effect } from "./effects.ts";
import {
  ask,
  asks,
  Reader,
  type ReaderValue,
  run_reader_terminal,
} from "./reader.ts";
import {
  get,
  gets,
  modify,
  run_state_terminal,
  State,
  type StateValue,
} from "./state.ts";
import { kind } from "./typeclass.ts";
import { Do } from "./typeclasses.ts";

type Config = { readonly port: number };

Deno.test("Reader environment views support pure, fluent bind, and explicit Do", () => {
  const ConfigReader = Reader.with_environment<Config>();
  const pure: ReaderValue<Config, number> = ConfigReader.pure(1);
  const incremented: ReaderValue<Config, number> = pure.bind((value) =>
    asks((config: Config) => value + config.port)
  );
  const program = Do(ConfigReader, function* () {
    const config = yield* ask<Config>();
    return config.port + 2;
  });
  // deno-lint-ignore require-yield
  const yield_free = Do(ConfigReader, function* () {
    return 3;
  });

  assert_true(ConfigReader[kind] === Reader[kind], "views share Reader's kind");
  assert_equals(incremented.run({ port: 80 }), 81);
  assert_equals(incremented.run({ port: 90 }), 91);
  assert_equals(program.run({ port: 80 }), 82);
  assert_equals(yield_free.run({ port: 80 }), 3);
  assert_equals(
    run_reader_terminal(Effect.lift(incremented), { port: 80 }),
    81,
  );
});

Deno.test("State type views support pure, fluent bind, and explicit Do", () => {
  const NumberState = State.with_state<number>();
  const pure: StateValue<number, number> = NumberState.pure(1);
  const incremented: StateValue<number, number> = pure.bind((value) =>
    gets((current: number) => current + value)
  );
  const program = Do(NumberState, function* () {
    yield* modify((current: number) => current + 2);
    return yield* get<number>();
  });
  // deno-lint-ignore require-yield
  const yield_free = Do(NumberState, function* () {
    return 3;
  });

  assert_true(NumberState[kind] === State[kind], "views share State's kind");
  assert_equals(incremented.run(80), [81, 80]);
  assert_equals(incremented.run(90), [91, 90]);
  assert_equals(program.run(80), [82, 82]);
  assert_equals(program.run(90), [92, 92]);
  assert_equals(yield_free.run(80), [3, 80]);
  assert_equals(run_state_terminal(Effect.lift(incremented), 80), [81, 80]);
});

function fixed_input_type_checks() {
  const ConfigReader = Reader.with_environment<Config>();
  const NumberState = State.with_state<number>();

  // @ts-expect-error a selected Reader environment stays fixed for pure values
  ConfigReader.pure(1).run({ port: "invalid" });
  // @ts-expect-error a selected State type stays fixed for pure values
  NumberState.pure(1).run("invalid");
  // @ts-expect-error bind cannot change the selected state type
  NumberState.pure(1).bind(() => get<string>());
}

void fixed_input_type_checks;

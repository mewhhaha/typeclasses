import {
  type AsArray,
  from_array as array_from_array,
  to_array as array_to_array,
} from "../src/array.ts";
import { Effect, Program, type Uses } from "../src/effects.ts";
import { ask, type AsReader, run_reader } from "../src/reader.ts";
import { type AsState, get, modify, run_state } from "../src/state.ts";
import { type AsTask, from_fn, run_task } from "../src/task.ts";
import { type AsWriter, run_writer, tell } from "../src/writer.ts";

export async function run_effect_examples() {
  const [effect_result_value, effect_result_logs] = await Effect.handle_with(
    effect_program,
    [
      (effect) =>
        run_reader(effect, {
          label: "step",
          increment: 2,
        }),
      (effect) => run_state(effect, 40),
      (effect) => run_writer(effect, array_from_array<string>([])),
      run_task,
    ],
  );

  console.log(
    "effect reader state writer task",
    Deno.inspect(
      [effect_result_value, array_to_array(effect_result_logs)],
    ),
  );
}

type EffectConfig = {
  readonly label: string;
  readonly increment: number;
};
type LabelConfig = {
  readonly label: string;
};
type Label =
  | Uses<AsReader<LabelConfig>>
  | Uses<AsTask>;
type App =
  | Uses<AsReader<EffectConfig>>
  | Uses<AsState<number>>
  | Uses<AsWriter<AsArray, string>>
  | Uses<AsTask>;

const Label = Program.scope<Label>();
const App = Program.scope<App>();

const effect_label = Label(function* () {
  const config = yield* ask<LabelConfig>();

  return config.label;
});

const effect_async_label = Label(function* () {
  const label = yield* effect_label;
  const suffix = yield* from_fn(() => Promise.resolve(":async"));

  return label + suffix;
});

const effect_program = App(function* () {
  const config = yield* ask<EffectConfig>();
  const before = yield* get<number>();
  const label = yield* run_reader(effect_async_label, {
    label: config.label,
  });

  yield* modify((value: number) => value + config.increment);
  yield* tell(array_from_array([label + ":" + before.toString()]));

  const after = yield* get<number>();

  return { before, after };
});

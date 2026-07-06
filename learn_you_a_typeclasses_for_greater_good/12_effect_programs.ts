import { ArrayT, type AsArray, to_array } from "../src/array.ts";
import { assert_equals } from "../src/assert.ts";
import { Effect, Program, type Uses } from "../src/effects.ts";
import { ask, type AsReader, run_reader } from "../src/reader.ts";
import { type AsTask, from_fn, run_task } from "../src/task.ts";
import { type AsWriter, run_writer, tell } from "../src/writer.ts";

type Config = {
  readonly prefix: string;
};

type App =
  | Uses<AsReader<Config>>
  | Uses<AsWriter<AsArray, string>>
  | Uses<AsTask>;

const App = Program.scope<App>();

export async function lesson_12_effect_programs() {
  const program = App(function* () {
    const config = yield* ask<Config>();
    const name = yield* from_fn(() => Promise.resolve("Ada"));

    yield* tell(ArrayT([config.prefix + name]));

    return name.length;
  });
  const [value, log] = await Effect.interpret(program)
    .handle((effect) => run_reader(effect, { prefix: "hello " }))
    .handle((effect) => run_writer(effect, ArrayT<string>([])))
    .run(run_task);

  assert_equals(value, 3);
  assert_equals(to_array(log), ["hello Ada"]);
}

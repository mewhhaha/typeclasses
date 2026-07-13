import { assert_equals, assert_true } from "../src/assert.ts";

Deno.test({
  name: "transformer lowers Do generators to direct typeclass methods",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";
import { ask, asks } from "../src/reader.ts";

const program = Do(function* () {
  const config = yield* ask<Config>();
  const label = yield* asks<Config, string>((config) => config.label);

  return label.length + config.increment;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, 'import { Do } from "../src/typeclasses.ts";');
    assert_true(
      !result.code.includes("Applicative") && !result.code.includes("Monad"),
      "expected Do lowering to avoid helper imports\n\n" + result.code,
    );
    assert_includes(result.code, "const program = ask<Config>().bind");
    assert_includes(result.code, "return asks<Config, string>");
    assert_includes(result.code, ").map");
    assert_true(
      !result.code.includes("context_"),
      "expected straight-line Do lowering to avoid generated context locals\n\n" +
        result.code,
    );
    assert_true(
      !result.code.includes("(() =>"),
      "expected Do lowering to avoid generated IIFEs\n\n" + result.code,
    );
  },
});

Deno.test("transformer emits a source map for rewritten TypeScript", async () => {
  const source = `
import { Do } from "../src/typeclasses.ts";

const value = Do(Maybe, function* () {
  return 42;
});
`;
  const result = await transform(source);

  assert_true(result.map !== null, "expected transformed output source map");
  if (result.map === null) {
    throw new Error("expected transformed output source map");
  }

  assert_equals(result.map.sourcesContent?.[0], source);
  assert_true(result.map.mappings.length > 0, "expected source mappings");
});

Deno.test({
  name: "transformer lowers Program generators to Effect bind/map chains",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";
import { ask } from "../src/reader.ts";
import { from_fn } from "../src/task.ts";

const program = Program(function* () {
  const config = yield* ask<Config>();
  const suffix = yield* from_fn(() => Promise.resolve(":async"));

  return config.label + suffix;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "import { Program, Effect }");
    assert_includes(result.code, "Effect.bind_from(ask<Config>()");
    assert_includes(result.code, "Effect.map_from(from_fn(");
    assert_includes(result.code, "return config.label + suffix;");
  },
});

Deno.test({
  name: "transformer lowers Program.scope aliases",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";
import { ask } from "../src/reader.ts";

type App = unknown;
const App = Program.scope<App>();

const program = App(function* () {
  const config = yield* ask<Config>();
  const label = config.label;

  return label;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "const App = Program.scope<App>()");
    assert_includes(result.code, "Effect.map_from(ask<Config>()");
    assert_includes(result.code, "const label = config.label;");
    assert_includes(result.code, "return label;");
  },
});

Deno.test({
  name: "transformer adds runtime Effect import next to type Effect imports",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { type Effect, Program, type Uses } from "../src/effects.ts";

export const page: Effect<Uses<AsPage>, number> = Program(function* () {
  yield* start();

  return 1;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(
      result.code,
      'import { type Effect, Program, type Uses, Effect } from "../src/effects.ts";',
    );
    assert_includes(result.code, "Effect.map_from(start()");
  },
});

Deno.test({
  name: "transformer inlines immediate Effect interpreter run calls",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Effect, run } from "../src/effects.ts";

const value = Effect.interpret(effect).run(run);
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "const value = run(effect);");
    assert_true(
      !result.code.includes("Effect.interpret"),
      "expected immediate interpreter run to be removed\n\n" + result.code,
    );
  },
});

Deno.test({
  name: "transformer inlines immediate Effect interpreter value calls",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Effect } from "../src/effects.ts";

const value = Effect.interpret(effect).value();
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "const value = effect;");
    assert_true(
      !result.code.includes("Effect.interpret"),
      "expected immediate interpreter value to be removed\n\n" + result.code,
    );
  },
});

Deno.test({
  name: "transformer inlines immediate Effect interpreter handle chains",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Effect, run } from "../src/effects.ts";
import { run_reader } from "../src/reader.ts";
import { run_state } from "../src/state.ts";

const value = Effect.interpret(effect)
  .handle((effect) => run_reader(effect, config))
  .handle((effect) => run_state(effect, 0))
  .run(run);
`);

    assert_equals(result.transformed, 2);
    assert_equals(result.diagnostics, []);
    assert_true(
      result.code.includes("run_state_terminal") &&
        result.code.includes("run_reader(effect, config), 0"),
      "expected the terminal State handler to return directly\n\n" +
        result.code,
    );
    assert_true(
      !result.code.includes("Effect.interpret"),
      "expected immediate interpreter handle chain to be removed\n\n" +
        result.code,
    );
  },
});

Deno.test({
  name: "transformer lowers terminal Reader, State, and Writer handlers",
  permissions: { env: true },
  async fn() {
    const named = await transform(`
import { run as finish } from "../src/effects.ts";
import { run_reader as handle_reader } from "../src/reader.ts";
import { run_state as handle_state } from "../src/state.ts";
import { run_writer as handle_writer } from "../src/writer.ts";

const reader = finish(handle_reader(reader_effect, config));
const state = finish(handle_state(state_effect, 0));
const writer = finish(handle_writer(writer_effect, empty));
`);

    assert_equals(named.transformed, 3);
    assert_equals(named.diagnostics, []);
    assert_true(
      !named.code.includes("finish(handle_"),
      "expected terminal wrappers to be removed\n\n" + named.code,
    );
    assert_includes(named.code, "run_reader_terminal as");
    assert_includes(named.code, "run_state_terminal as");
    assert_includes(named.code, "run_writer_terminal as");

    const explicit = await transform(`
import { run as finish } from "../src/effects.ts";
import { run_reader as handle_reader } from "../src/reader.ts";
import { run_state as handle_state } from "../src/state.ts";
import { run_writer as handle_writer } from "../src/writer.ts";

const reader = finish(handle_reader<Requirements, Config, string>(reader_effect, config));
const state = finish(handle_state<Requirements, number, string>(state_effect, 0));
const writer = finish(handle_writer<Output, string, Requirements, number>(writer_effect, empty));
`);

    assert_equals(explicit.transformed, 3);
    assert_equals(explicit.diagnostics, []);
    assert_true(
      /run_reader_terminal_\d+<Config, string>/.test(explicit.code),
      "expected Reader type arguments to omit requirements\n\n" +
        explicit.code,
    );
    assert_true(
      /run_state_terminal_\d+<number, string>/.test(explicit.code),
      "expected State type arguments to omit requirements\n\n" + explicit.code,
    );
    assert_true(
      /run_writer_terminal_\d+<Output, string, number>/.test(explicit.code),
      "expected Writer type arguments to omit requirements\n\n" +
        explicit.code,
    );

    const explicit_outer = await transform(`
import { run as finish } from "../src/effects.ts";
import { run_reader as handle_reader } from "../src/reader.ts";

const value = finish<number | string>(handle_reader(effect, config));
`);

    assert_equals(explicit_outer.transformed, 0);
    assert_equals(explicit_outer.diagnostics, []);
    assert_includes(
      explicit_outer.code,
      "finish<number | string>(handle_reader(effect, config))",
    );

    const explicit_interpreter = await transform(`
import { Effect, run as finish } from "../src/effects.ts";
import { run_reader as handle_reader } from "../src/reader.ts";

const value = Effect.interpret(handle_reader(effect, config))
  .run<number | string>(finish);
`);

    assert_equals(explicit_interpreter.transformed, 0);
    assert_equals(explicit_interpreter.diagnostics, []);
    assert_includes(
      explicit_interpreter.code,
      ".run<number | string>(finish)",
    );

    const namespaced = await transform(`
import * as effects from "../src/effects.ts";
import * as reader from "../src/reader.ts";

const value = effects.run(reader.run_reader(program, config));
`);

    assert_equals(namespaced.transformed, 1);
    assert_equals(namespaced.diagnostics, []);
    assert_includes(
      namespaced.code,
      "reader.run_reader_terminal(program, config)",
    );

    const optional = await transform(`
import * as effects from "../src/effects.ts";
import * as reader from "../src/reader.ts";

const outer = effects?.run(reader.run_reader(program, config));
const inner = effects.run(reader?.run_reader(program, config));
`);

    assert_equals(optional.transformed, 0);
    assert_equals(optional.diagnostics, []);

    const jsr = await transform(`
import { run, run_reader } from "jsr:@mewhhaha/typeclasses@^1.0.0";
const value = run(run_reader(program, config));
`);

    assert_equals(jsr.transformed, 1);
    assert_equals(jsr.diagnostics, []);
    assert_includes(jsr.code, "run_reader_terminal as");

    const local = await transform(`
const run = (value: unknown) => value;
const run_reader = (value: unknown, _config: unknown) => value;
const value = run(run_reader(program, config));
`);

    assert_equals(local.transformed, 0);
    assert_equals(local.diagnostics, []);

    const shadowed = await transform(`
import { run as finish } from "../src/effects.ts";
import { run_reader as handle_reader } from "../src/reader.ts";

function evaluate(
  finish: (value: unknown) => unknown,
  handle_reader: (value: unknown, config: unknown) => unknown,
) {
  return finish(handle_reader(program, config));
}
`);

    assert_equals(shadowed.transformed, 0);
    assert_equals(shadowed.diagnostics, []);
    assert_includes(
      shadowed.code,
      "return finish(handle_reader(program, config));",
    );

    const shadowed_namespace = await transform(`
import * as effects from "../src/effects.ts";
import * as reader from "../src/reader.ts";

function evaluate(effects: Runner, reader: ReaderRunner) {
  return effects.run(reader.run_reader(program, config));
}
`);

    assert_equals(shadowed_namespace.transformed, 0);
    assert_equals(shadowed_namespace.diagnostics, []);
    assert_includes(
      shadowed_namespace.code,
      "return effects.run(reader.run_reader(program, config));",
    );

    const transformer = await import("./transform_do_program.ts");
    const facade_source = `
import { run, run_reader } from "./local-reexport.ts";
const value = run(run_reader(program, config));
`;
    const facade = transformer.transform_do_program_source(
      facade_source,
      "input.ts",
      { library_specifiers: ["./local-reexport.ts"] },
    );
    const terminal_facade = transformer.transform_do_program_source(
      facade_source,
      "input.ts",
      { terminal_library_specifiers: ["./local-reexport.ts"] },
    );

    assert_equals(facade.transformed, 0);
    assert_equals(facade.diagnostics, []);
    assert_equals(terminal_facade.transformed, 1);
    assert_equals(terminal_facade.diagnostics, []);
    assert_includes(terminal_facade.code, "run_reader_terminal as");
  },
});

Deno.test({
  name: "transformer fuses immediate straight-line terminal Programs",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, asks, run_reader } from "../src/reader.ts";
import { get, modify, run_state } from "../src/state.ts";
import { run_writer, tell, writer } from "../src/writer.ts";

const reader = run(run_reader(Program(function* () {
  const config = yield* ask<Config>();
  const label = yield* asks<Config, string>((value) => value.label);
  return label.length + config.increment;
}), config));

const state = run(run_state(Program(function* () {
  const before = yield* get<number>();
  yield* modify((value: number) => value + 2);
  const after = yield* get<number>();
  return { before, after };
}), initial));

const output = run(run_writer(Program(function* () {
  yield* tell(start);
  const value = yield* writer(input, middle);
  yield* tell(end);
  return value + 2;
}), empty));
`);

    assert_equals(result.transformed, 3);
    assert_equals(result.diagnostics, []);
    assert_true(
      !result.code.includes("Effect.bind_from") &&
        !result.code.includes("Effect.map_from"),
      "expected the Effect spine to be absent\n\n" + result.code,
    );
    assert_true(
      !result.code.includes("run_reader_terminal") &&
        !result.code.includes("run_state_terminal") &&
        !result.code.includes("run_writer_terminal") &&
        !result.code.includes("Effect.prepare_yield"),
      "expected canonical primitives to avoid terminal dispatch\n\n" +
        result.code,
    );
    assert_includes(result.code, "reader_input_1 =>");
    assert_includes(result.code, "const ask_value_1: Config = environment_1");
    assert_includes(result.code, "const config = ask_value_1");
    assert_includes(result.code, "state_1 = modify_argument_0_1(state_1)");
    assert_includes(result.code, "output_1 = output_1.concat");
    assert_includes(
      result.code,
      "return [{ before, after }, state_1] as const",
    );

    const returned = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* ask<number>();
}), environment));
`);

    assert_equals(returned.transformed, 1);
    assert_equals(returned.diagnostics, []);
    assert_true(
      !returned.code.includes("Effect.from"),
      "expected return yield* to fuse\n\n" + returned.code,
    );

    const scoped = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const P = Program.scope<Uses<Reader, number>>();
const value = run(run_reader(P(function* () {
  return yield* ask<number>();
}), environment));
`);

    assert_equals(scoped.transformed, 1);
    assert_equals(scoped.diagnostics, []);
    assert_true(
      !scoped.code.includes("Effect.from"),
      "expected a tracked Program scope to fuse\n\n" + scoped.code,
    );

    const branch = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  if (enabled) {
    yield* ask<number>();
  }
  return 1;
}), environment));
`);

    assert_equals(branch.transformed, 2);
    assert_equals(branch.diagnostics, []);
    assert_includes(branch.code, "Effect.map_from");

    const awaited = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
async function evaluate() {
  return run(run_reader(Program(function* () {
    return yield* ask<number>();
  }), await environment()));
}
`);

    assert_equals(awaited.transformed, 2);
    assert_equals(awaited.diagnostics, []);
    assert_includes(awaited.code, "await environment()");
    assert_includes(awaited.code, "Effect.from");
  },
});

Deno.test({
  name: "terminal Program fusion respects lexical bindings and hazards",
  permissions: { env: true },
  async fn() {
    const root = new URL("../src/", import.meta.url).href;
    const shadowed_source = `
import { Effect, Program, run } from ${JSON.stringify(root + "effects.ts")};
import { ask, run_reader } from ${JSON.stringify(root + "reader.ts")};

function evaluate(Program) {
  return run(run_reader(Program(function* () {
    return yield* ask();
  }), 7));
}

export default evaluate(() => Effect.pure(99));
`;
    const shadowed = await transform(shadowed_source);

    assert_equals(shadowed.transformed, 1);
    assert_equals(shadowed.diagnostics.length, 1);
    assert_includes(shadowed.code, "Program(function*");
    assert_equals(
      await evaluate_module(shadowed.code, "shadowed-program-transformed"),
      await evaluate_module(shadowed_source, "shadowed-program-original"),
    );

    const alias_source = `
import { Effect, Program, run } from ${JSON.stringify(root + "effects.ts")};
import { ask, run_reader } from ${JSON.stringify(root + "reader.ts")};

const ReaderProgram = Program.scope();
function evaluate(ReaderProgram) {
  return run(run_reader(ReaderProgram(function* () {
    return yield* ask();
  }), 7));
}

export default evaluate(() => Effect.pure(99));
`;
    const shadowed_alias = await transform(alias_source);

    assert_equals(shadowed_alias.transformed, 1);
    assert_equals(shadowed_alias.diagnostics, []);
    assert_includes(shadowed_alias.code, "ReaderProgram(function*");
    assert_equals(
      await evaluate_module(shadowed_alias.code, "shadowed-scope-transformed"),
      await evaluate_module(alias_source, "shadowed-scope-original"),
    );

    const tdz_alias = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const value = run(run_reader(ReaderProgram(function* () {
  return yield* ask();
}), 7));
const ReaderProgram = Program.scope();
`);

    assert_equals(tdz_alias.transformed, 1);
    assert_equals(tdz_alias.diagnostics, []);
    assert_includes(tdz_alias.code, "ReaderProgram(function*");

    const direct_eval = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
function evaluate(one, two, three) {
  return run(run_reader(Program(function* () {
    const count = eval("arguments.length");
    yield* ask();
    return count;
  }), 7));
}
`);

    assert_equals(direct_eval.transformed, 1);
    assert_equals(direct_eval.diagnostics.length, 1);
    assert_includes(direct_eval.code, "Program(function*");
  },
});

Deno.test({
  name: "terminal primitive fusion stays import-anchored and capability-safe",
  permissions: { env: true, read: true, run: true, write: true },
  async fn() {
    const aliased = await transform(`
import { Program, run } from "../src/effects.ts";
import { asks as read, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* read<number, number>((item) => item + 1);
}), 41));
`);

    assert_equals(aliased.transformed, 1);
    assert_equals(aliased.diagnostics, []);
    assert_true(
      !aliased.code.includes("Effect.prepare_yield") &&
        !aliased.code.includes("run_reader_terminal"),
      "expected an exact named primitive import to lower directly\n\n" +
        aliased.code,
    );

    const namespaced = await transform(`
import { Program, run } from "../src/effects.ts";
import * as state from "../src/state.ts";
const value = run(state.run_state(Program(function* () {
  const selected = yield* state.gets<number, number>((item) => item + 1);
  yield* state.put<number>(selected);
  return yield* state.get<number>();
}), 41));
`);

    assert_equals(namespaced.transformed, 1);
    assert_equals(namespaced.diagnostics, []);
    assert_true(
      !namespaced.code.includes("Effect.prepare_yield") &&
        !namespaced.code.includes("run_state_terminal"),
      "expected an exact primitive namespace to lower directly\n\n" +
        namespaced.code,
    );

    const local_alias = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const read = ask;
const value = run(run_reader(Program(function* () {
  return yield* read<number>();
}), 41));
`);

    assert_equals(local_alias.transformed, 1);
    assert_equals(local_alias.diagnostics, []);
    assert_includes(local_alias.code, "Program(function*");
    assert_includes(local_alias.code, "run_reader_terminal");

    const shadowed = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
function evaluate(ask) {
  return run(run_reader(Program(function* () {
    return yield* ask();
  }), 41));
}
`);

    assert_equals(shadowed.transformed, 1);
    assert_equals(shadowed.diagnostics, []);
    assert_includes(shadowed.code, "Program(function*");
    assert_includes(shadowed.code, "run_reader_terminal");

    const wrong_capability = await transform(`
import { Program, run } from "../src/effects.ts";
import { run_reader } from "../src/reader.ts";
import { get } from "../src/state.ts";
const value = run(run_reader(Program(function* () {
  return yield* get<number>();
}), 41));
`);

    assert_equals(wrong_capability.transformed, 1);
    assert_equals(wrong_capability.diagnostics, []);
    assert_includes(wrong_capability.code, "Program(function*");
    assert_includes(wrong_capability.code, "run_reader_terminal");

    const optional = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* ask?.<number>();
}), 41));
`);

    assert_equals(optional.transformed, 1);
    assert_equals(optional.diagnostics, []);
    assert_includes(optional.code, "Program(function*");
    assert_includes(optional.code, "run_reader_terminal");

    const explicit_types = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* ask<number, string>();
}), 41));
`);

    assert_equals(explicit_types.transformed, 1);
    assert_equals(explicit_types.diagnostics, []);
    assert_includes(explicit_types.code, "Program(function*");
    assert_includes(explicit_types.code, "run_reader_terminal");

    const contextual_callback = await transform(`
import { Program, run } from "../src/effects.ts";
import { asks, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* asks((item) => item + 1);
}), 41));
`);

    assert_equals(contextual_callback.transformed, 1);
    assert_equals(contextual_callback.diagnostics, []);
    assert_includes(contextual_callback.code, "Program(function*");
    assert_includes(contextual_callback.code, "run_reader_terminal");

    const mixed_inference = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, asks, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  const environment = yield* ask();
  return yield* asks<number, number>((item) => item + Number(environment));
}), 41));
`);

    assert_equals(mixed_inference.transformed, 1);
    assert_equals(mixed_inference.diagnostics, []);
    assert_includes(mixed_inference.code, "Program(function*");

    const zero_parameter_callback = await transform(`
import { Program, run } from "../src/effects.ts";
import { modify, run_state } from "../src/state.ts";
const value = run(run_state(Program(function* () {
  yield* modify(() => 1);
  return 0;
}), 0));
`);

    assert_equals(zero_parameter_callback.transformed, 1);
    assert_equals(zero_parameter_callback.diagnostics, []);
    assert_includes(zero_parameter_callback.code, "Program(function*");
    assert_includes(zero_parameter_callback.code, "run_state_terminal");

    const inferred_put = await transform(`
import { Program, run } from "../src/effects.ts";
import { get, put, run_state } from "../src/state.ts";
const one = 1 as const;
const value = run(run_state(Program(function* () {
  yield* put(one);
  return yield* get<number>();
}), 0));
`);

    assert_equals(inferred_put.transformed, 1);
    assert_equals(inferred_put.diagnostics, []);
    assert_includes(inferred_put.code, "Program(function*");

    const inferred_callback = await transform(`
import { Program, run } from "../src/effects.ts";
import { get, modify, run_state } from "../src/state.ts";
const increment = () => 1;
const value = run(run_state(Program(function* () {
  yield* modify(increment);
  return yield* get<number>();
}), 0));
`);

    assert_equals(inferred_callback.transformed, 1);
    assert_equals(inferred_callback.diagnostics, []);
    assert_includes(inferred_callback.code, "Program(function*");

    const unrelated_module = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../other/src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* ask();
}), 41));
`);

    assert_equals(unrelated_module.transformed, 1);
    assert_equals(unrelated_module.diagnostics, []);
    assert_includes(unrelated_module.code, "Effect.from(ask())");
    assert_true(
      !unrelated_module.code.includes("reader_input_1 =>"),
      "expected unrelated ask implementation to remain observable\n\n" +
        unrelated_module.code,
    );

    const unrelated_program = await transform(`
import { Program } from "../other/src/effects.ts";
import { run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* ask();
}), 41));
`);

    assert_equals(unrelated_program.transformed, 1);
    assert_equals(unrelated_program.diagnostics.length, 1);
    assert_includes(unrelated_program.code, "Program(function*");
    assert_true(
      !unrelated_program.code.includes("reader_input_1 =>"),
      "expected unrelated Program constructor to remain observable\n\n" +
        unrelated_program.code,
    );

    const effect_collision = await transform(`
import * as effects from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const Effect = 123;
const read = ask;
const value = effects.run(run_reader(effects.Program(function* () {
  return yield* read<number>();
}), 41));
`);

    assert_equals(effect_collision.transformed, 1);
    assert_equals(effect_collision.diagnostics, []);
    assert_includes(effect_collision.code, "const Effect = 123");
    assert_includes(effect_collision.code, "Program(function*");
    assert_true(
      !effect_collision.code.includes("Effect.prepare_yield"),
      "expected preserved fallback not to synthesize an Effect reference\n\n" +
        effect_collision.code,
    );

    const root = new URL("../src/", import.meta.url).href;
    const typed = await transform(`
import { Program, run } from ${JSON.stringify(root + "effects.ts")};
import { ask, asks, run_reader } from ${JSON.stringify(root + "reader.ts")};
import { get, modify, run_state } from ${JSON.stringify(root + "state.ts")};
type Config = { readonly label: string };
const reader = run(run_reader(Program(function* () {
  const config = yield* ask<Config>();
  return yield* asks<Config, string>(value => value.label + config.label);
}), { label: "x" }));
const state = run(run_state(Program(function* () {
  const before = yield* get<number>();
  yield* modify<number>(value => value + 1);
  return before;
}), 1));
`);

    assert_equals(typed.transformed, 2);
    assert_equals(typed.diagnostics, []);
    await assert_module_typechecks(typed.code);

    const invalid_typed = await transform(`
import { Program, run } from ${JSON.stringify(root + "effects.ts")};
import { ask, run_reader } from ${JSON.stringify(root + "reader.ts")};
const value = run(run_reader(Program(function* () {
  return yield* ask<string>();
}), 41));
`);

    assert_equals(invalid_typed.transformed, 1);
    assert_equals(invalid_typed.diagnostics, []);
    assert_includes(invalid_typed.code, "reader_input_1 =>");
    await assert_module_has_type_error(invalid_typed.code);

    const asserted_yield = await transform(`
import { Program, run } from "../src/effects.ts";
import { ask, run_reader, type ReaderValue } from "../src/reader.ts";
const value = run(run_reader(Program(function* () {
  return yield* (ask<number>() as unknown as ReaderValue<string, string>);
}), "ok"));
`);

    assert_equals(asserted_yield.transformed, 1);
    assert_equals(asserted_yield.diagnostics, []);
    assert_includes(asserted_yield.code, "Program(function*");
    assert_includes(asserted_yield.code, "run_reader_terminal");
  },
});

Deno.test({
  name: "fused terminal Programs preserve evaluation and handler order",
  permissions: { env: true },
  async fn() {
    const root = new URL("../src/", import.meta.url).href;
    const source = `
import { Effect, Program, run } from ${JSON.stringify(root + "effects.ts")};
import { ask, asks, run_reader } from ${JSON.stringify(root + "reader.ts")};
import { State, get, gets, modify, put, run_state } from ${
      JSON.stringify(root + "state.ts")
    };
import { run_writer, tell, writer } from ${JSON.stringify(root + "writer.ts")};
import { ArrayT, from_array, to_array } from ${
      JSON.stringify(root + "array.ts")
    };

const events = [];
const config = { label: "step", increment: 2 };
function read_primitive_increment(environment) {
  events.push("reader.primitive:call");
  return environment.increment;
}
function read_discarded_increment(environment) {
  events.push("reader.primitive:discarded:" + environment.increment);
  return environment.increment;
}
const primitive_reader = run(run_reader(Program(function* () {
  const increment = yield* asks((events.push("reader.primitive:argument"),
    read_primitive_increment));
  yield* asks(read_discarded_increment);
  events.push("reader.primitive:resume");
  return increment;
}), (events.push("reader.primitive:input"), config)));

const pure_first_reader = run(run_reader(Program(function* () {
  const one = yield* Effect.pure(1);
  events.push("reader.pure:resume");
  const environment = yield* ask();
  return one + environment.increment;
}), (events.push("reader.pure:input"), config)));

const completed_reader_iterable = {
  [Symbol.iterator]() {
    events.push("reader.completed:iterator");
    return {
      next() {
        events.push("reader.completed:next");
        return {
          get done() {
            events.push("reader.completed:done");
            return true;
          },
          get value() {
            events.push("reader.completed:value");
            return 40;
          },
        };
      },
    };
  },
};
const completed_reader = run(run_reader(Program(function* () {
  const value = yield* completed_reader_iterable;
  events.push("reader.completed:resume");
  const environment = yield* ask();
  return value + environment.increment;
}), (events.push("reader.completed:input"), config)));

const overridden_reader = ask();
Object.defineProperty(overridden_reader, Symbol.iterator, {
  value: function* () {
    events.push("reader.override:iterator");
    return 99;
  },
});
const overridden_reader_value = run(run_reader(Program(function* () {
  return yield* overridden_reader;
}), (events.push("reader.override:input"), config)));

function* delegated_reader_program() {
  events.push("reader.delegate:start");
  const environment = yield* ask();
  events.push("reader.delegate:resume");
  return environment.increment;
}
const delegated_reader = run(run_reader(Program(function* () {
  return yield* delegated_reader_program();
}), (events.push("reader.delegate:input"), config)));

const custom_reader_iterable = {
  [Symbol.iterator]() {
    const iterator = {
      step: 0,
      get next() {
        events.push("reader.iterator:next:get");
        return function (value) {
          events.push("reader.iterator:next:call:" + arguments.length);
          if (this.step++ === 0) {
            return { done: false, value: ask() };
          }
          return { done: true, value: value.increment };
        };
      },
    };
    return iterator;
  },
};
const custom_delegated_reader = run(run_reader(Program(function* () {
  return yield* custom_reader_iterable;
}), (events.push("reader.iterator:input"), config)));

const reader = run(run_reader(Program(function* () {
  events.push("reader.prefix");
  const environment = yield* (events.push("reader.first"), ask());
  events.push("reader.resume");
  const label = yield* asks((value) => value.label);
  const nested = yield* Effect.lift(asks((value) => value.increment));
  return label.length + environment.increment + nested;
}), (events.push("reader.input"), config)));

const shadowed_input = run(run_reader(Program(function* () {
  const config = yield* ask();
  return config.increment;
}), config));

const state = run(run_state(Program(function* () {
  events.push("state.prefix");
  const before = yield* (events.push("state.first"), get());
  events.push("state.resume");
  yield* modify((value) => value + 2);
  const after = yield* get();
  return { before, after };
}), (events.push("state.input"), 40)));

function modify_primitive_state(value) {
  events.push("state.primitive:call");
  return value + 2;
}
function read_discarded_state(value) {
  events.push("state.primitive:discarded:" + value);
  return value;
}
const primitive_state = run(run_state(Program(function* () {
  yield* modify((events.push("state.primitive:argument"),
    modify_primitive_state));
  yield* put((events.push("state.primitive:put"), 45));
  yield* gets(read_discarded_state);
  events.push("state.primitive:resume");
  return yield* get();
}), (events.push("state.primitive:input"), 40)));

function* delegated_state_program() {
  events.push("state.delegate:start");
  const before = yield* get();
  yield* modify((value) => value + 2);
  events.push("state.delegate:resume");
  return before;
}
const delegated_state = run(run_state(Program(function* () {
  return yield* delegated_state_program();
}), (events.push("state.delegate:input"), 40)));

const observed_state = State(() => {
  const pair = [];
  Object.defineProperties(pair, {
    0: { get() { events.push("state.value"); return 7; } },
    1: { get() { events.push("state.next"); return 9; } },
  });
  pair.length = 2;
  pair[Symbol.iterator] = function* () {
    events.push("state.iterator:value");
    yield 10;
    events.push("state.iterator:next");
    yield 20;
  };
  return pair;
});
const observed = run(run_state(Program(function* () {
  const value = yield* observed_state;
  events.push("state.getter.resume");
  return value;
}), 0));

const empty = ArrayT([]);
Object.defineProperty(empty, "concat", {
  value(right) {
    events.push("writer.concat:" + to_array(right).join("+"));
    return from_array([...to_array(this), ...to_array(right)]);
  },
});
const output = run(run_writer(Program(function* () {
  events.push("writer.prefix");
  yield* (events.push("writer.first"), tell(ArrayT(["start"])));
  events.push("writer.resume:first");
  const value = yield* writer(40, ArrayT(["value"]));
  events.push("writer.resume:value");
  yield* tell(ArrayT(["end"]));
  events.push("writer.resume:end");
  return value + 2;
}), (events.push("writer.input"), empty)));

const ordered_empty = ArrayT([]);
Object.defineProperty(ordered_empty, "concat", {
  get() {
    events.push("writer.primitive:concat:get");
    return function (right) {
      events.push("writer.primitive:concat:call");
      return from_array([...to_array(this), ...to_array(right)]);
    };
  },
});
const primitive_output = run(run_writer(Program(function* () {
  const value = yield* writer(
    (events.push("writer.primitive:value"), 42),
    (events.push("writer.primitive:output"), ArrayT(["primitive"])),
  );
  events.push("writer.primitive:resume");
  return value;
}), (events.push("writer.primitive:input"), ordered_empty)));

const anonymous_writer = run(run_writer(Program(function* () {
  const value = yield* writer(function () {}, ArrayT([]));
  return value.name;
}), ArrayT([])));

function* delegated_writer_program() {
  events.push("writer.delegate:start");
  yield* tell(ArrayT(["delegated"]));
  events.push("writer.delegate:resume");
  return 42;
}
const delegated_output = run(run_writer(Program(function* () {
  return yield* delegated_writer_program();
}), (events.push("writer.delegate:input"), empty)));

try {
  run(run_reader(Program(function* () {
    yield* (events.push("throw.first"), (() => { throw new Error("first"); })());
    events.push("throw.resume.bad");
  }), (events.push("throw.input.bad"), config)));
} catch (error) {
  events.push("caught:" + error.message);
}

try {
  run(run_reader(Program(function* () {
    yield* (events.push("undefined.first"), undefined);
    events.push("undefined.resume.bad");
  }), (events.push("undefined.input.bad"), config)));
} catch {
  events.push("undefined.caught");
}

try {
  run(run_reader(Program(function* () {
    yield* (events.push("input.first"), ask());
    events.push("input.resume.bad");
  }), (events.push("input.throw"), (() => { throw new Error("input"); })())));
} catch (error) {
  events.push("caught:" + error.message);
}

let wrong;
try {
  run(run_reader(Program(function* () {
    yield* get();
    events.push("wrong.resume.bad");
  }), config));
} catch (error) {
  wrong = error.message;
}

export default {
  primitive_reader,
  pure_first_reader,
  completed_reader,
  overridden_reader_value,
  delegated_reader,
  custom_delegated_reader,
  reader,
  shadowed_input,
  state,
  primitive_state,
  delegated_state,
  observed,
  output: [output[0], to_array(output[1])],
  primitive_output: [primitive_output[0], to_array(primitive_output[1])],
  anonymous_writer: anonymous_writer[0],
  delegated_output: [delegated_output[0], to_array(delegated_output[1])],
  wrong,
  events,
};
`;
    const transformed = await transform(source);

    assert_equals(transformed.transformed, 20);
    assert_equals(transformed.diagnostics, []);
    assert_true(
      !transformed.code.includes("Effect.bind_from"),
      "expected runtime probe to use fused lowering\n\n" + transformed.code,
    );

    const original_value = await evaluate_module(source, "original");
    const transformed_value = await evaluate_module(
      transformed.code,
      "transformed",
    );
    assert_equals(transformed_value, original_value);
  },
});

Deno.test({
  name: "transformer lowers return yield star",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";

const program = Program(function* () {
  return yield* json({ right: true });
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(
      result.code,
      "const program = Effect.from(json({ right: true }));",
    );
    assert_true(
      !result.code.includes("Effect.bind(Effect.from(json"),
      "expected return yield* to avoid bind/pure\n\n" + result.code,
    );
  },
});

Deno.test({
  name: "transformer lowers switch cases with yielded branches",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";
import { ask } from "../src/reader.ts";

const App = Program.scope<App>();

const program = App(function* () {
  const input = yield* ask<Input>();
  const [tag, payload] = input;

  switch (tag) {
    case "echo": {
      yield* stdout(payload.text);
      return 0;
    }

    case "cat": {
      const result = yield* read_file(payload.path);
      const [result_tag, result_payload] = result.value();
      let exit_code: number;

      switch (result_tag) {
        case "right":
          yield* stdout(result_payload);
          exit_code = 0;
          break;
        case "left":
          yield* stdout(format_error(result_payload));
          exit_code = 1;
          break;
      }

      return exit_code;
    }
  }
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "switch (tag)");
    assert_includes(
      result.code,
      "Effect.map_from(stdout(payload.text)",
    );
    assert_includes(result.code, "switch (result_tag)");
    assert_includes(
      result.code,
      "Effect.map_from(stdout(result_payload)",
    );
    assert_includes(result.code, "return Effect.pure(exit_code);");
  },
});

Deno.test({
  name: "transformer lowers conditional yielded branches",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";

const identifier = Do(function* () {
  const name = yield* read_name();

  if (reserved_words.has(name)) {
    yield* fail("identifier", "reserved word");
  }

  return name;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "if (reserved_words.has(name))");
    assert_includes(result.code, "const identifier = context_1.bind");
    assert_includes(result.code, "return fail");
    assert_includes(result.code, ").map");
    assert_includes(result.code, "return context_1.pure(name);");
  },
});

Deno.test({
  name: "transformer removes generated Do wrappers from static call arguments",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";

const parser = label(Do(function* () {
  const name = yield* identifier;

  return { name };
}), "identifier");
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "const parser = label(identifier.map");
    assert_true(
      !result.code.includes("(() =>"),
      "expected generated Do argument wrapper to be removed\n\n" + result.code,
    );
  },
});

Deno.test({
  name:
    "transformer removes generated Do wrappers from returned call arguments",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";

function parser() {
  return label(Do(function* () {
    const name = yield* identifier;

    return { name };
  }), "identifier");
}
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "return label(identifier.map");
    assert_true(
      !result.code.includes("(() =>"),
      "expected generated Do return wrapper to be removed\n\n" + result.code,
    );
  },
});

Deno.test({
  name: "transformer removes generated Do wrappers from later call arguments",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";

const parser = label(right(skip_hidden(), Do(function* () {
  const name = yield* identifier;

  return { name };
})), "identifier");
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(
      result.code,
      "right(skip_hidden(), identifier.map",
    );
    assert_true(
      !result.code.includes("(() =>"),
      "expected generated Do argument wrapper to be removed\n\n" +
        result.code,
    );
  },
});

Deno.test({
  name: "transformer lowers simple for loops with yielded continue branches",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";

const App = Program.scope<App>();

const program = App(function* () {
  yield* start();

  for (let turn = 1; turn <= max_turns; turn += 1) {
    const action = yield* next_action(turn);

    switch (action) {
      case "retry": {
        yield* log("retry");
        continue;
      }

      case "done": {
        yield* log("done");
        return turn;
      }
    }
  }

  yield* log("stopped");
  return 0;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "function loop");
    assert_includes(result.code, "if (turn <= max_turns)");
    assert_includes(result.code, "return loop");
    assert_includes(result.code, "Effect.bind_from(next_action(turn)");
    assert_includes(result.code, 'Effect.map_from(log("stopped")');
  },
});

Deno.test({
  name: "transformer inlines static Effect.handle_with handlers",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Effect, Program } from "../src/effects.ts";

const program = Program(function* () {
  const value = yield* task;
  return value + 1;
});

const output = Effect.handle_with(program, [
  (effect) => run_reader(effect, input),
  run_task,
]);
`);

    assert_equals(result.transformed, 2);
    assert_equals(result.diagnostics, []);
    assert_true(
      !result.code.includes("Effect.handle_with"),
      "expected Effect.handle_with call to be inlined\n\n" + result.code,
    );
    assert_includes(result.code, "run_task");
    assert_includes(result.code, "run_task(run_reader(program, input))");
    assert_includes(result.code, "Effect.map_from(task");
  },
});

Deno.test({
  name: "transformer keeps rejecting switch fallthrough",
  permissions: { env: true },
  async fn() {
    const source = `
import { Program } from "../src/effects.ts";

const program = Program(function* () {
  const value = yield* load();

  switch (value) {
    case "left":
      yield* log("left");
    case "right":
      return 1;
  }
});
`;
    const result = await transform(source);

    assert_equals(result.transformed, 0);
    assert_equals(result.diagnostics.length, 1);
    assert_true(
      result.diagnostics[0].message.includes("fallthrough"),
      "diagnostic mentions fallthrough",
    );
    assert_equals(result.code, source);
  },
});

Deno.test({
  name:
    "transformer lowers explicit Do dictionaries including yield-free blocks",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";

const yielded = Do(Maybe, function* () {
  const value = yield* load();
  return value + 1;
});

const yielded_free = Do(Maybe, function* () {
  return 42;
});
`);

    assert_equals(result.transformed, 2);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "const yielded = load().map");
    assert_includes(result.code, "const yielded_free = Maybe.pure(42);");
  },
});

Deno.test({
  name:
    "transformer evaluates an explicit complex Do dictionary once before its yields",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";

const program = Do(Writer.with(ArrayT([])), function* () {
  const value = yield* load();
  return value;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "const dictionary_");
    assert_includes(result.code, "= Writer.with(ArrayT([]));");
    assert_equals(
      (result.code.match(/Writer\.with\(ArrayT\(\[\]\)\)/g) ?? []).length,
      1,
    );
  },
});

Deno.test({
  name: "transformer lowers while, do/while, for-of, and loop breaks",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";

const program = Program(function* () {
  while (enabled) {
    const value = yield* load();
    if (value === "done") break;
  }

  do {
    yield* tick();
  } while (again);

  for (const item of items()) {
    yield* visit(item);
    if (stop(item)) break;
  }

  return 1;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, "function loop");
    assert_includes(result.code, "const items_");
    assert_includes(result.code, "[...items()]");
    assert_true(
      !result.code.includes("break;"),
      "expected loop breaks to lower\n\n" + result.code,
    );
  },
});

Deno.test({
  name:
    "transformer lowers explicit Do try/catch and retains unsupported diagnostics",
  permissions: { env: true },
  async fn() {
    const handled = await transform(`
import { Do } from "../src/typeclasses.ts";
const program = Do(Either, function* () {
  try {
    return yield* load();
  } catch (error) {
    return recover(error);
  }
});
`);
    assert_equals(handled.transformed, 1);
    assert_equals(handled.diagnostics, []);
    assert_includes(handled.code, ".catch_error(error =>");
    assert_true(
      !handled.code.includes(".bind(() =>"),
      "expected terminal try/catch to preserve its returned value",
    );

    const continued = await transform(`
import { Do } from "../src/typeclasses.ts";
const program = Do(Either, function* () {
  try { yield* load(); } catch (error) { yield* recover(error); }
  return 1;
});
`);
    assert_equals(continued.transformed, 1);
    assert_equals(continued.diagnostics, []);
    assert_includes(continued.code, ".catch_error(error =>");
    assert_includes(continued.code, ".map(() => {");
    assert_includes(continued.code, "return 1;");

    const unsupported = await transform(`
import { Program } from "../src/effects.ts";
const program = Program(function* () {
  try { return yield* load(); } catch (error) { return recover(error); }
});
`);
    assert_equals(unsupported.transformed, 0);
    assert_true(
      unsupported.diagnostics[0].message.includes("catch_error"),
      "expected Program catch diagnostic",
    );

    const labeled = await transform(`
import { Program } from "../src/effects.ts";
const program = Program(function* () {
  loop: while (enabled) { yield* load(); break loop; }
  return 1;
});
`);
    assert_equals(labeled.transformed, 0);
    assert_true(
      labeled.diagnostics[0].message.includes("labeled"),
      "expected retained label diagnostic",
    );
  },
});

Deno.test({
  name:
    "transformer executes lowered loop control flow with the same Maybe result",
  permissions: { env: true, read: true },
  async fn() {
    await assert_do_equivalent(`
import { Do } from "../src/typeclasses.ts";

const program = Do(Maybe, function* () {
  let total = 0;

  while (total < 4) {
    const increment = yield* Just(1);
    total += increment;
    if (total === 2) continue;
    if (total === 4) break;
  }

  do {
    const increment = yield* Just(2);
    total += increment;
  } while (false);

  for (const item of [1, 2, 3]) {
    const increment = yield* Just(item);
    total += increment;
    if (item === 2) break;
  }

  return total;
});
`);
  },
});

Deno.test({
  name: "transformer preserves representative ArrayT multi-shot raw results",
  permissions: { env: true, read: true },
  async fn() {
    await assert_do_equivalent(`
import { Do } from "../src/typeclasses.ts";

const program = Do(ArrayT, function* () {
  for (const item of [1, 2]) {
    const choice = yield* ArrayT([item, item + 10]);
    yield* ArrayT([choice]);
  }

  return "done";
});
`);
  },
});

Deno.test({
  name:
    "transformer evaluates an explicit complex Do dictionary once at runtime",
  permissions: { env: true, read: true },
  async fn() {
    await assert_do_equivalent(`
import { Do } from "../src/typeclasses.ts";

let calls = 0;
const dictionary = () => {
  calls += 1;
  return Maybe;
};

const program = Do(dictionary(), function* () {
  const value = yield* Just(1);
  return [value, calls];
});
`);
  },
});

Deno.test({
  name: "explicit Do try/catch handles monadic Left values like runtime Do",
  permissions: { env: true, read: true },
  async fn() {
    const source = `
import { Do } from "../src/typeclasses.ts";

const load = () => Left("missing");
const recover = (error) => Right("recovered:" + error);

const program = Do(Either, function* () {
  try {
    return yield* load();
  } catch (error) {
    return yield* recover(error);
  }
});
`;
    await assert_do_equivalent(source);
  },
});

Deno.test({
  name: "transformer diagnoses a zero-argument anchored Do call",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/typeclasses.ts";
const program = Do();
`);

    assert_equals(result.transformed, 0);
    assert_equals(result.diagnostics.length, 1);
    assert_true(
      result.diagnostics[0].message.includes("function* argument"),
      "expected zero-argument Do diagnostic",
    );
  },
});

Deno.test({
  name: "transformer CLI --check fails when a tracked fixture has diagnostics",
  permissions: { env: true, read: true, run: true },
  async fn() {
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env",
        "--allow-read",
        new URL("./transform_do_program.ts", import.meta.url).pathname,
        "--check",
        new URL("./fixtures/unsupported_do_try.ts", import.meta.url).pathname,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();

    assert_equals(output.code, 1);
    assert_true(
      new TextDecoder().decode(output.stderr).includes("try/catch requires"),
      "expected CLI diagnostic on stderr",
    );

    const terminal_command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env",
        "--allow-read",
        new URL("./transform_do_program.ts", import.meta.url).pathname,
        "--check",
        new URL("./fixtures/terminal_program.ts", import.meta.url).pathname,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const terminal_output = await terminal_command.output();

    assert_equals(terminal_output.code, 0);
    assert_true(
      new TextDecoder().decode(terminal_output.stdout).includes(
        "reader_input_1();",
      ),
      "expected CLI terminal fusion output",
    );
  },
});

Deno.test({
  name:
    "transformer anchors Do, Program, and Effect to imports including aliases and namespaces",
  permissions: { env: true },
  async fn() {
    const aliased = await transform(`
import { Do as monadDo } from "../src/typeclasses.ts";
import { Program as P } from "../src/effects.ts";
const one = monadDo(Maybe, function* () { return 1; });
const two = P(function* () { return 2; });
`);
    assert_equals(aliased.transformed, 2);
    assert_equals(aliased.diagnostics, []);
    assert_includes(aliased.code, "Maybe.pure(1)");
    assert_includes(aliased.code, "Effect.pure(2)");

    const namespaced = await transform(`
import * as tc from "../src/typeclasses.ts";
const value = tc.Do(Maybe, function* () { return 1; });
`);
    assert_equals(namespaced.transformed, 1);
    assert_equals(namespaced.diagnostics, []);

    const namespaced_program = await transform(`
import * as tc from "../src/effects.ts";
const value = tc.Program(function* () { return 1; });
`);
    assert_equals(namespaced_program.transformed, 1);
    assert_equals(namespaced_program.diagnostics, []);
    assert_includes(namespaced_program.code, "Effect.pure(1)");

    const local = await transform(`
function Do(run: () => Generator<unknown>) { return run(); }
const value = Do(function* () { return 1; });
`);
    assert_equals(local.transformed, 0);
    assert_equals(local.diagnostics.length, 1);
    assert_includes(local.code, "Do(function*");

    const local_effect = await transform(`
const Effect = { handle_with: (value: unknown) => value };
const value = Effect.handle_with(effect, [run]);
`);
    assert_equals(local_effect.transformed, 0);
    assert_includes(local_effect.code, "Effect.handle_with(effect");

    const configured_transformer = await import("./transform_do_program.ts");
    const configured = configured_transformer.transform_do_program_source(
      `
import { Do as run } from "./local-reexport.ts";
const value = run(Maybe, function* () { return 1; });
`,
      "input.ts",
      { library_specifiers: ["./local-reexport.ts"] },
    );
    assert_equals(configured.transformed, 1);
    assert_equals(configured.diagnostics, []);
  },
});

Deno.test("transformer preserves source text when no rewrite is possible", async () => {
  const without_targets =
    `// Deliberately irregular formatting.\nconst answer={value:42};\n`;
  const type_only_target =
    `import type { Effect } from "../src/effects.ts";\nconst answer={value:42};\n`;

  const untouched = await transform(without_targets);
  const type_only = await transform(type_only_target);

  assert_equals(untouched.code, without_targets);
  assert_equals(untouched.transformed, 0);
  assert_equals(untouched.diagnostics, []);
  assert_equals(untouched.map, null);
  assert_equals(type_only.code, type_only_target);
  assert_equals(type_only.transformed, 0);
  assert_equals(type_only.diagnostics, []);
  assert_equals(type_only.map, null);
});

Deno.test("transformer ignores control flow inside nested functions", async () => {
  const result = await transform(`
import { Do } from "../src/typeclasses.ts";

const value = Do(Maybe, function* () {
  function* nested() {
    return yield* Just(1);
  }

  const item = yield* Just(41);
  return item + 1;
});
`);

  assert_equals(result.transformed, 1);
  assert_equals(result.diagnostics, []);
  assert_includes(result.code, "function* nested()");
  assert_includes(result.code, "Just(41).map");
});

async function transform(source: string) {
  const transformer = await import("./transform_do_program.ts");

  return transformer.transform_do_program_source(source);
}

async function evaluate_module(
  source: string,
  label: string,
): Promise<unknown> {
  const executable = source.replace(/\s+as const\b/g, "");
  const module = await import(
    "data:application/javascript," +
      encodeURIComponent(executable + "\n//# sourceURL=" + label + ".ts")
  );

  return module.default;
}

async function assert_module_typechecks(source: string): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: ".ts" });

  try {
    await Deno.writeTextFile(path, source);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["check", path],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assert_true(
      output.code === 0,
      "expected transformed module to type-check\n\n" +
        new TextDecoder().decode(output.stderr) + "\n\n" + source,
    );
  } finally {
    await Deno.remove(path);
  }
}

async function assert_module_has_type_error(source: string): Promise<void> {
  const path = await Deno.makeTempFile({ suffix: ".ts" });

  try {
    await Deno.writeTextFile(path, source);
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["check", path],
      stdout: "piped",
      stderr: "piped",
    }).output();

    assert_true(
      output.code !== 0,
      "expected transformed module to retain its type error\n\n" + source,
    );
  } finally {
    await Deno.remove(path);
  }
}

async function assert_do_equivalent(source: string) {
  const transformed = await transform(source);

  assert_equals(transformed.transformed, 1);
  assert_equals(transformed.diagnostics, []);
  assert_equals(
    await evaluate_do_raw(transformed.code),
    await evaluate_do_raw(source),
    "lowered Do raw result differs from runtime Do\n\n" + transformed.code,
  );
}

async function evaluate_do_raw(source: string): Promise<unknown> {
  const typeclasses = new URL("../src/typeclasses.ts", import.meta.url).href;
  const maybe = new URL("../src/maybe.ts", import.meta.url).href;
  const array = new URL("../src/array.ts", import.meta.url).href;
  const either = new URL("../src/either.ts", import.meta.url).href;
  const executable = `
import { Do } from ${JSON.stringify(typeclasses)};
import { Maybe, Just } from ${JSON.stringify(maybe)};
import { ArrayT } from ${JSON.stringify(array)};
import { Either, Left, Right } from ${JSON.stringify(either)};
${strip_anchoring_import(source)}
export default program.value();
`;
  const module = await import(
    "data:application/javascript," + encodeURIComponent(executable)
  );

  return module.default;
}

function strip_anchoring_import(source: string): string {
  return source.replace(
    /^import \{ Do \} from "\.\.\/src\/typeclasses\.ts";\s*$/gm,
    "",
  );
}

function assert_includes(value: string, part: string) {
  assert_true(
    value.includes(part),
    "expected output to include: " + part + "\n\n" + value,
  );
}

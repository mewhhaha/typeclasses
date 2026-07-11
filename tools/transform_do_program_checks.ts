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
  assert_equals(type_only.code, type_only_target);
  assert_equals(type_only.transformed, 0);
  assert_equals(type_only.diagnostics, []);
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

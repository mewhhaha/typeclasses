import { assert_equals, assert_true } from "../src/assert.ts";

Deno.test({
  name: "transformer lowers Do generators to direct trait methods",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/traits.ts";
import { ask, asks } from "../src/reader.ts";

const program = Do(function* () {
  const config = yield* ask<Config>();
  const label = yield* asks<Config, string>((config) => config.label);

  return label.length + config.increment;
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(result.code, 'import { Do } from "../src/traits.ts";');
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
    assert_includes(result.code, "Effect.bind(Effect.from(ask<Config>())");
    assert_includes(result.code, "Effect.map(Effect.from(from_fn(");
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
    assert_includes(result.code, "Effect.map(Effect.from(ask<Config>())");
    assert_includes(result.code, "const label = config.label;");
    assert_includes(result.code, "return label;");
  },
});

Deno.test({
  name: "transformer lowers return yield star",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";

const program = Program(function* () {
  return yield* json({ ok: true });
});
`);

    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    assert_includes(
      result.code,
      "const program = Effect.from(json({ ok: true }));",
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
        case "ok":
          yield* stdout(result_payload);
          exit_code = 0;
          break;
        case "err":
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
      "Effect.map(Effect.from(stdout(payload.text))",
    );
    assert_includes(result.code, "switch (result_tag)");
    assert_includes(
      result.code,
      "Effect.map(Effect.from(stdout(result_payload))",
    );
    assert_includes(result.code, "return Effect.pure(exit_code);");
  },
});

Deno.test({
  name: "transformer lowers conditional yielded branches",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Do } from "../src/traits.ts";

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
import { Do } from "../src/traits.ts";

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
import { Do } from "../src/traits.ts";

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
import { Do } from "../src/traits.ts";

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
    assert_includes(result.code, "Effect.bind(Effect.from(next_action(turn))");
    assert_includes(result.code, 'Effect.map(Effect.from(log("stopped"))');
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
    assert_includes(result.code, "Effect.map(Effect.from(task)");
  },
});

Deno.test({
  name: "transformer keeps rejecting switch fallthrough",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
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
`);

    assert_equals(result.transformed, 0);
    assert_equals(result.diagnostics.length, 1);
    assert_true(
      result.diagnostics[0].message.includes("fallthrough"),
      "diagnostic mentions fallthrough",
    );
    assert_includes(result.code, "Program(function*");
  },
});

Deno.test({
  name: "transformer skips unsupported nested loops",
  permissions: { env: true },
  async fn() {
    const result = await transform(`
import { Program } from "../src/effects.ts";

const program = Program(function* () {
  while (enabled) {
    yield* task;
  }

  return 1;
});
`);

    assert_equals(result.transformed, 0);
    assert_equals(result.diagnostics.length, 1);
    assert_true(
      result.diagnostics[0].message.includes("top level"),
      "diagnostic mentions unsupported nested control flow",
    );
    assert_includes(result.code, "Program(function*");
  },
});

async function transform(source: string) {
  const transformer = await import("./transform_do_program.ts");

  return transformer.transform_do_program_source(source);
}

function assert_includes(value: string, part: string) {
  assert_true(
    value.includes(part),
    "expected output to include: " + part + "\n\n" + value,
  );
}

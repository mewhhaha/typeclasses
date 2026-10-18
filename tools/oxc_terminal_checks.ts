import { parseSync } from "oxc-parser";
import type { CallExpression, Expression, Node } from "oxc-parser";
import { create_binding_analysis } from "./transform_bindings.ts";
import { id, walk } from "./transform_ast.ts";
import type { TransformServices } from "./transform_context.ts";
import { create_terminal_transform } from "./transform_terminals.ts";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function setup(source: string, terminal_body = true) {
  const program = parseSync("terminal.ts", source).program;
  const bindings = create_binding_analysis(program);
  let fresh = 0;
  const services: TransformServices = {
    program,
    bindings,
    source,
    file_name: "terminal.ts",
    config: { optimizations: { terminal_body } },
    imports: {
      do_names: new Set(),
      program_names: new Set(["Program"]),
      effect_names: new Set(["Effect"]),
      namespaces: new Set(),
      terminal_functions: new Map([
        ["run", { imported: "run" }],
        ["run_reader", { imported: "run_reader" }],
        ["run_state", { imported: "run_state" }],
        ["run_writer", { imported: "run_writer" }],
      ]),
      terminal_namespaces: new Map(),
      primitive_functions: new Map([
        ["ask", "ask"],
        ["asks", "asks"],
        ["get", "get"],
        ["put", "put"],
        ["modify", "modify"],
        ["tell", "tell"],
        ["writer", "writer"],
      ]),
      primitive_namespaces: new Map(),
      effect_helper_shadowed: false,
    },
    recursive_dictionaries: new Set(),
    task_dictionaries: new Set(),
    fresh(prefix) {
      fresh += 1;
      return id(prefix + fresh);
    },
    diagnose() {},
    report() {},
    kind(call) {
      if (
        call.callee.type === "Identifier" && call.callee.name === "Program" &&
        bindings.imported(call.callee)
      ) return "program";
      return undefined;
    },
    effect() {
      return id("Effect");
    },
    loop() {
      return undefined;
    },
    flat_dictionary() {
      return undefined;
    },
    terminal(imported) {
      return id(imported);
    },
    compile() {
      return undefined;
    },
  };
  const transform = create_terminal_transform(services);
  const calls: CallExpression[] = [];
  walk(program, (node) => {
    if (
      node.type === "CallExpression" && node.callee.type === "Identifier" &&
      node.callee.name === "run"
    ) calls.push(node);
  });
  return { program, transform, calls };
}
const imports = `import { Program, Effect, run } from "effects";
import { ask, asks, run_reader } from "reader";
import { get, put, modify, run_state } from "state";
import { tell, writer, run_writer } from "writer";`;
function nodes(root: Node, type: Node["type"]) {
  const result: Node[] = [];
  walk(root, (child) => {
    if (child.type === type) result.push(child);
  });
  return result;
}

Deno.test("Oxc terminals fuse primitive bodies and retain input evaluation order", () => {
  const { transform, calls } = setup(
    imports + `
const value = run(run_reader(Program(function* () {
  before();
  const n = yield* asks<number, number>(callback());
  return n + 1;
}), input()));`,
  );
  const lowered = transform.lower(calls[0]);
  assert(lowered?.direct, "expected direct Reader fusion");
  const calls_after = nodes(
    lowered.expression,
    "CallExpression",
  ) as CallExpression[];
  const names = calls_after.map((call) => {
    if (call.callee.type === "Identifier") return call.callee.name;
    return "";
  });
  assert(
    !names.includes("Program") && !names.includes("asks"),
    "primitive dispatch survived",
  );
  assert(
    names.indexOf("before") < names.indexOf("callback"),
    "body prelude order changed",
  );
  assert(
    names.indexOf("callback") <
      names.findIndex((name) => name.startsWith("reader_input")),
    "input moved ahead of primitive argument",
  );
  assert(
    nodes(lowered.expression, "TSFunctionType").length === 1,
    "callback lost contextual typing",
  );
});

Deno.test("Oxc terminals preserve capability, assertion, and callback safety barriers", () => {
  for (
    const operation of [
      "get<number>()",
      "(ask<number>() as unknown)",
      "asks(value => value)",
      "asks?.<number, number>(value => value)",
    ]
  ) {
    const { transform, calls } = setup(
      imports +
        `const value = run(run_reader(Program(function* () { return yield* ${operation}; }), 1));`,
    );
    const lowered = transform.lower(calls[0]);
    assert(
      lowered !== undefined && !lowered.direct,
      "unsafe primitive fused: " + operation,
    );
    assert(
      (lowered.expression as CallExpression).callee.type === "Identifier",
      "terminal fallback missing",
    );
  }
});

Deno.test("Oxc terminals fuse only same-scope nonescaping named Programs", () => {
  const source = imports + `
const program = Program(function* () { const n = yield* ask<number>(); return n + 1; });
const value = run(run_reader(program, 1));`;
  const supported = setup(source);
  const declaration = supported.program.body[4];
  assert(
    supported.transform.skip(declaration),
    "named candidate was not protected",
  );
  assert(
    supported.transform.lower(supported.calls[0])?.direct,
    "named Program did not fuse",
  );
  assert(
    supported.transform.remove(declaration),
    "fused declaration not removed",
  );
  const escaping = setup(source + "consume(program);");
  assert(
    !escaping.transform.skip(escaping.program.body[4]),
    "escaping Program marked fusible",
  );
  assert(
    !escaping.transform.lower(escaping.calls[0])?.direct,
    "escaping Program fused",
  );
  const disabled = setup(source, false);
  assert(
    !disabled.transform.skip(disabled.program.body[4]),
    "disabled body fusion skipped a declaration",
  );
});

Deno.test("Oxc terminals remap explicit terminal runner type parameters", () => {
  const { transform, calls } = setup(
    imports +
      `const value = run(run_state<Effects, State, Value>(effect, initial));`,
  );
  const lowered = transform.lower(calls[0]);
  assert(lowered !== undefined, "terminal lift not lowered");
  const expression = lowered.expression as CallExpression;
  assert(
    expression.typeArguments?.params.length === 2,
    "terminal type arguments not remapped",
  );
});

Deno.test("Oxc terminals lower static interpreter chains", () => {
  const { program, transform } = setup(
    imports +
      `const value = Effect.interpret(effect).handle(x => run_reader(x, 1)).run(run);`,
  );
  const statement = program.body[4];
  assert(statement.type === "VariableDeclaration", "missing test statement");
  const expression = statement.declarations[0].init as Expression;
  assert(expression.type === "CallExpression", "missing interpreter call");
  const lowered = transform.lower(expression);
  assert(lowered !== undefined, "interpreter not lowered");
  const members = nodes(lowered.expression, "MemberExpression");
  assert(members.length === 0, "interpreter chain survived");
});

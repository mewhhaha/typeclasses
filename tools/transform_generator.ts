import type {
  BindingPattern,
  BlockStatement,
  CallExpression,
  Expression,
  FunctionBody,
  IdentifierReference,
  Node,
  ParamPattern,
  Statement,
  TSType,
  YieldExpression,
} from "oxc-parser";
import {
  arrow,
  block,
  call,
  id,
  literal,
  member,
  node,
  parameter,
  ret,
  type_ref,
  unwrap,
  variable,
} from "./transform_ast.ts";
import type { TransformKind, TransformServices } from "./transform_context.ts";

type State = {
  services: TransformServices;
  kind: TransformKind;
  dictionary?: Expression;
  continuation_type?: TSType;
  used_contexts: Set<Expression>;
};
type Result = { block: BlockStatement; yielded: boolean };
type Options = {
  continue_expression?: Expression;
  break_expression?: Expression;
};
type Yield = {
  expression: Expression;
  name?: BindingPattern;
  terminal: boolean;
};
class UnsupportedGenerator extends Error {}

function children(value: Node): Node[] {
  const result: Node[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (
      key === "parent" || key === "typeAnnotation" || key === "typeArguments" ||
      key === "returnType" || key === "typeParameters"
    ) continue;
    if (Array.isArray(item)) {
      for (const child of item) {
        if (child && typeof child === "object" && "type" in child) {
          result.push(child as Node);
        }
      }
    } else if (item && typeof item === "object" && "type" in item) {
      result.push(item as Node);
    }
  }
  return result;
}
function function_like(value: Node): boolean {
  return value.type === "FunctionDeclaration" ||
    value.type === "FunctionExpression" ||
    value.type === "ArrowFunctionExpression";
}
function visit(value: Node, callback: (value: Node) => boolean | void): void {
  if (callback(value) === false) return;
  for (const child of children(value)) visit(child, callback);
}
function contains(value: Node, breaks = false): boolean {
  let found = false;
  visit(value, (part) => {
    if (function_like(part)) return false;
    if (
      part.type === "YieldExpression" || part.type === "ReturnStatement" ||
      breaks &&
        (part.type === "BreakStatement" || part.type === "ContinueStatement")
    ) found = true;
    if (found) return false;
  });
  return found;
}
function fail(state: State, value: Node, message: string): never {
  state.services.diagnose(value, "Skipped " + state.kind + ": " + message);
  throw new UnsupportedGenerator();
}
function void_zero(): Expression {
  return node({
    type: "UnaryExpression",
    operator: "void",
    prefix: true,
    argument: literal(0),
  });
}
function method(
  target: Expression,
  name: string,
  args: Expression[],
  types?: TSType[],
): CallExpression {
  const result = call(member(target, name), args);
  if (types) {
    result.typeArguments = node({
      type: "TSTypeParameterInstantiation",
      params: types,
    });
  }
  return result;
}
function expr(value: BlockStatement): Expression {
  if (value.body.length === 1) {
    const first = value.body[0];
    if (first.type === "ReturnStatement" && first.argument) {
      return first.argument;
    }
  }
  return call(arrow([], value), []);
}
function body_of(value: Statement): Statement[] {
  if (value.type === "BlockStatement") return value.body;
  return [value];
}
function yield_star(
  value: Expression | null | undefined,
): value is YieldExpression & { argument: Expression } {
  return value?.type === "YieldExpression" && value.delegate &&
    value.argument !== null;
}
function read_yield(value: Statement): Yield | undefined {
  if (value.type === "VariableDeclaration" && value.declarations.length === 1) {
    const declaration = value.declarations[0];
    if (yield_star(declaration.init)) {
      return {
        expression: declaration.init.argument,
        name: declaration.id,
        terminal: false,
      };
    }
  }
  if (value.type === "ExpressionStatement" && yield_star(value.expression)) {
    return { expression: value.expression.argument, terminal: false };
  }
  if (value.type === "ReturnStatement" && yield_star(value.argument)) {
    return { expression: value.argument.argument, terminal: true };
  }
}
function pure(
  value: Expression,
  context: Expression | undefined,
  state: State,
): Expression {
  if (state.kind === "program") {
    return method(state.services.effect(), "pure", [value]);
  }
  const dictionary = state.dictionary ?? context;
  if (!dictionary) {
    state.services.diagnose(
      value,
      "Skipped Do: Do requires a yielded value before returning.",
    );
    throw new UnsupportedGenerator();
  }
  if (!state.dictionary && context) state.used_contexts.add(context);
  return method(dictionary, "pure", [value]);
}
function same(left: Expression, right: Expression): boolean {
  return left === right ||
    left.type === "Identifier" && right.type === "Identifier" &&
      left.name === right.name;
}
function pure_value(
  expression: Expression | null,
  target: Expression,
): Expression | undefined {
  if (
    expression?.type !== "CallExpression" ||
    expression.callee.type !== "MemberExpression"
  ) return;
  const callee = expression.callee;
  if (
    callee.computed || callee.property.type !== "Identifier" ||
    callee.property.name !== "pure" || !same(callee.object, target)
  ) return;
  const argument = expression.arguments[0];
  if (argument && argument.type !== "SpreadElement") return argument;
}
function continuation(
  params: ParamPattern[],
  body: BlockStatement,
  state: State,
  map = false,
): Expression {
  let return_type = state.continuation_type;
  if (!map && return_type && state.dictionary?.type === "Identifier") {
    return_type = type_ref("ReturnType", [node({
      type: "TSTypeQuery",
      exprName: node({
        type: "TSQualifiedName",
        left: state.dictionary,
        right: id("pure"),
      }),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from([return_type]),
      }),
    })]);
  }
  const result = arrow(params, body);
  if (return_type) {
    result.returnType = node({
      type: "TSTypeAnnotation",
      typeAnnotation: return_type,
    });
  }
  return result;
}
function final_map(
  expression: Expression,
  target: Expression,
  params: ParamPattern[],
  body: BlockStatement,
  state: State,
): Expression | undefined {
  const last = body.body.at(-1);
  if (
    last?.type !== "ReturnStatement" ||
    body.body.slice(0, -1).some((part) => contains(part))
  ) return;
  const value = pure_value(last.argument, target);
  if (!value) return;
  const callback = continuation(
    params,
    block([...body.body.slice(0, -1), ret(value)]),
    state,
    true,
  );
  if (state.kind === "program") {
    return method(state.services.effect(), "map_from", [expression, callback]);
  }
  return method(expression, "map", [callback]);
}
function bind(
  expression: Expression,
  params: ParamPattern[],
  body: BlockStatement,
  state: State,
): Expression {
  let target = state.dictionary ?? expression;
  if (state.kind === "program") target = state.services.effect();
  const mapped = final_map(expression, target, params, body, state);
  if (mapped) return mapped;
  const callback = continuation(params, body, state);
  if (state.kind === "program") {
    return method(state.services.effect(), "bind_from", [expression, callback]);
  }
  return method(expression, "bind", [callback]);
}

function statements(
  values: readonly Statement[],
  context: Expression | undefined,
  state: State,
  options: Options,
): Result {
  const prefix: Statement[] = [];
  const finish = (result: Result): Result => ({
    block: block([...prefix, ...result.block.body]),
    yielded: result.yielded,
  });
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const yielded = read_yield(value);
    if (yielded) {
      if (yielded.terminal) {
        let result = yielded.expression;
        if (state.kind === "program") {
          result = method(state.services.effect(), "from", [result]);
        }
        return finish({ block: block([ret(result)]), yielded: true });
      }
      const params: ParamPattern[] = [];
      if (yielded.name) params.push(yielded.name);
      const rest = values.slice(index + 1);
      if (state.kind === "program") {
        const next = statements(rest, yielded.expression, state, options);
        return finish({
          block: block([
            ret(bind(yielded.expression, params, next.block, state)),
          ]),
          yielded: true,
        });
      }
      const local = state.services.fresh("context");
      const next = statements(rest, local, state, options);
      const mapped = final_map(
        yielded.expression,
        state.dictionary ?? local,
        params,
        next.block,
        state,
      );
      if (mapped) return finish({ block: block([ret(mapped)]), yielded: true });
      if (!state.used_contexts.has(local)) {
        return finish({
          block: block([
            ret(bind(yielded.expression, params, next.block, state)),
          ]),
          yielded: true,
        });
      }
      return finish({
        block: block([
          variable("const", local, yielded.expression),
          ret(bind(local, params, next.block, state)),
        ]),
        yielded: true,
      });
    }
    switch (value.type) {
      case "ReturnStatement":
        return finish({
          block: block([
            ret(pure(value.argument ?? void_zero(), context, state)),
          ]),
          yielded: context !== undefined,
        });
      case "ContinueStatement":
      case "BreakStatement": {
        let result = options.break_expression;
        let label = "break";
        if (value.type === "ContinueStatement") {
          result = options.continue_expression;
          label = "continue";
        }
        if (value.label) {
          fail(state, value, "labeled " + label + "s are not supported.");
        }
        if (!result) {
          fail(
            state,
            value,
            label + " is only supported inside transformed loops.",
          );
        }
        return finish({ block: block([ret(result)]), yielded: true });
      }
      case "IfStatement": {
        if (!contains(value, true)) break;
        const rest = values.slice(index + 1);
        const yes = statements(
          [...body_of(value.consequent), ...rest],
          context,
          state,
          options,
        );
        if (!value.alternate) {
          const no = statements(rest, context, state, options);
          return finish({
            block: block([
              node({ ...value, consequent: yes.block, alternate: null }),
              ...no.block.body,
            ]),
            yielded: yes.yielded || no.yielded,
          });
        }
        const alternate = statements(
          [...body_of(value.alternate), ...rest],
          context,
          state,
          options,
        );
        return finish({
          block: block([
            node({
              ...value,
              consequent: yes.block,
              alternate: alternate.block,
            }),
          ]),
          yielded: yes.yielded || alternate.yielded,
        });
      }
      case "SwitchStatement": {
        if (!contains(value, true)) break;
        const rest = values.slice(index + 1);
        let did_yield = false;
        const cases = value.cases.map((clause, position) => {
          let parts = clause.consequent;
          if (parts.length === 1 && parts[0].type === "BlockStatement") {
            parts = parts[0].body;
          }
          const last = parts.at(-1);
          if (last?.type === "BreakStatement") {
            if (last.label) {
              fail(state, last, "labeled switch breaks are not supported.");
            }
            parts = [...parts.slice(0, -1), ...rest];
          } else if (
            last?.type !== "ReturnStatement" &&
            last?.type !== "ThrowStatement" &&
            last?.type !== "ContinueStatement"
          ) {
            if (position !== value.cases.length - 1) {
              fail(
                state,
                last ?? clause,
                "switch fallthrough is not supported.",
              );
            }
            parts = [...parts, ...rest];
          }
          const result = statements(parts, context, state, options);
          did_yield ||= result.yielded;
          return node({ ...clause, consequent: Array.from([result.block]) });
        });
        const next = statements(rest, context, state, options);
        return finish({
          block: block([node({ ...value, cases }), ...next.block.body]),
          yielded: did_yield || next.yielded,
        });
      }
      case "ForStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
        if (contains(value)) {
          return finish(
            lower_loop(value, values.slice(index + 1), context, state, options),
          );
        }
        break;
      case "TryStatement":
        if (contains(value)) {
          fail(
            state,
            value,
            "try statements containing yield* or return are not supported by the source transformer.",
          );
        }
        break;
      case "LabeledStatement":
        if (contains(value, true)) {
          fail(state, value, "labeled control flow is not supported.");
        }
    }
    if (contains(value)) {
      fail(
        state,
        value,
        "yield* and return are only transformed at the top level of the generator body.",
      );
    }
    prefix.push(value);
  }
  return finish({
    block: block([ret(pure(void_zero(), context, state))]),
    yielded: context !== undefined,
  });
}

type Loop = {
  variable?: IdentifierReference;
  type?: TSType;
  initial: Expression;
  condition: Expression;
  next: Expression;
  body: Statement[];
  do_first: boolean;
  prefix: Statement[];
};
function binary(
  operator: "+" | "-" | "<",
  left: Expression,
  right: Expression,
): Expression {
  return node({ type: "BinaryExpression", operator, left, right });
}
function unsupported_loop(state: State, value: Node, part: string): never {
  return fail(state, value, "unsupported for-loop " + part + ".");
}
function read_loop(
  value: Extract<
    Statement,
    {
      type:
        | "ForStatement"
        | "ForOfStatement"
        | "WhileStatement"
        | "DoWhileStatement";
    }
  >,
  state: State,
): Loop {
  const result: Loop = {
    initial: void_zero(),
    condition: literal(true),
    next: void_zero(),
    body: body_of(value.body),
    do_first: false,
    prefix: [],
  };
  if (value.type === "WhileStatement" || value.type === "DoWhileStatement") {
    result.condition = value.test;
    if (value.type === "DoWhileStatement") {
      result.do_first = true;
      result.initial = literal(true);
      result.next = literal(false);
    }
    return result;
  }
  let declaration;
  if (value.type === "ForStatement") {
    if (
      value.init?.type !== "VariableDeclaration" ||
      value.init.declarations.length !== 1
    ) unsupported_loop(state, value, "initializer");
    declaration = value.init.declarations[0];
    if (declaration.id.type !== "Identifier" || !declaration.init) {
      unsupported_loop(state, value, "initializer");
    }
    if (!value.test) unsupported_loop(state, value, "condition");
    result.variable = id(declaration.id.name);
    result.type = declaration.id.typeAnnotation?.typeAnnotation;
    result.initial = declaration.init;
    result.condition = value.test;
    const update = value.update;
    if (
      update?.type === "UpdateExpression" &&
      update.argument.type === "Identifier" &&
      update.argument.name === result.variable.name
    ) {
      let operator: "+" | "-" = "+";
      if (update.operator === "--") operator = "-";
      result.next = binary(operator, result.variable, literal(1));
    } else if (
      update?.type === "AssignmentExpression" &&
      update.left.type === "Identifier" &&
      update.left.name === result.variable.name
    ) {
      switch (update.operator) {
        case "=":
          result.next = update.right;
          break;
        case "+=":
          result.next = binary("+", result.variable, update.right);
          break;
        case "-=":
          result.next = binary("-", result.variable, update.right);
          break;
        default:
          unsupported_loop(state, update, "incrementor");
      }
    } else unsupported_loop(state, update ?? value, "incrementor");
    return result;
  }
  if (
    value.await || value.left.type !== "VariableDeclaration" ||
    value.left.declarations.length !== 1
  ) unsupported_loop(state, value, "of-loop initializer");
  declaration = value.left.declarations[0];
  if (declaration.id.type !== "Identifier") {
    unsupported_loop(state, value, "of-loop initializer");
  }
  if (value.left.kind === "var") {
    unsupported_loop(state, value, "var-scoped of-loop initializer");
  }
  const array = unwrap(value.right);
  if (
    array.type !== "ArrayExpression" || !array.elements.every((item) => {
      if (!item || item.type === "SpreadElement") return false;
      const primitive = unwrap(item);
      if (primitive.type === "Literal") return !("regex" in primitive);
      return primitive.type === "UnaryExpression" &&
        (primitive.operator === "+" || primitive.operator === "-") &&
        primitive.argument.type === "Literal" &&
        typeof primitive.argument.value === "number";
    })
  ) {
    fail(
      state,
      value.right,
      "for...of requires a literal array of primitive values; arbitrary iterables must preserve lazy iteration and iterator closing.",
    );
  }
  const items = state.services.fresh("items");
  const index = state.services.fresh("index");
  result.variable = index;
  result.type = node({ type: "TSNumberKeyword" });
  result.initial = literal(0);
  result.condition = binary("<", index, member(items, "length"));
  result.next = binary("+", index, literal(1));
  let kind: "let" | "const" = "const";
  if (value.left.kind === "let") kind = "let";
  result.body.unshift(
    variable(
      kind,
      declaration.id,
      node({
        type: "MemberExpression",
        object: items,
        property: index,
        computed: true,
        optional: false,
      }),
    ),
  );
  result.prefix.push(variable("const", items, value.right));
  return result;
}
function lower_loop(
  value: Extract<
    Statement,
    {
      type:
        | "ForStatement"
        | "ForOfStatement"
        | "WhileStatement"
        | "DoWhileStatement";
    }
  >,
  rest: readonly Statement[],
  context: Expression | undefined,
  state: State,
  options: Options,
): Result {
  const loop = read_loop(value, state);
  const safe = stack_safe_loop(loop, rest, context, state, options);
  if (safe) {
    return { ...safe, block: block([...loop.prefix, ...safe.block.body]) };
  }
  const name = state.services.fresh("loop");
  const exit = statements(rest, context, state, options);
  const exit_expression = expr(exit.block);
  const args: Expression[] = [];
  if (loop.variable) args.push(loop.next);
  let next: Expression = call(name, args);
  if (loop.do_first) {
    next = expr(
      block([
        node({
          type: "IfStatement",
          test: loop.condition,
          consequent: ret(next),
          alternate: null,
        }),
        ret(exit_expression),
      ]),
    );
  }
  const body = statements(
    [...loop.body, node({ type: "ContinueStatement", label: null })],
    context,
    state,
    {
      ...options,
      continue_expression: next,
      break_expression: exit_expression,
    },
  );
  const params: ParamPattern[] = [];
  if (loop.variable) params.push(parameter(loop.variable, loop.type));
  let entry: Statement = body.block;
  if (!loop.do_first) {
    entry = node({
      type: "IfStatement",
      test: loop.condition,
      consequent: entry,
      alternate: null,
    });
  }
  const initial: Expression[] = [];
  if (loop.variable) initial.push(loop.initial);
  state.services.report(
    value,
    "loop",
    "preserved",
    "Recursive loop fallback retains arbitrary dictionaries and early return values; stack-safe lowering requires a known MonadRec dictionary and no early returns.",
  );
  return {
    yielded: true,
    block: block([
      ...loop.prefix,
      node({
        type: "FunctionDeclaration",
        id: name,
        generator: false,
        async: false,
        params,
        expression: false,
        body: block([entry, ...exit.block.body]),
      }),
      ret(call(name, initial)),
    ]),
  };
}
function query(name: IdentifierReference): TSType {
  return node({ type: "TSTypeQuery", exprName: name, typeArguments: null });
}
function property_type(name: string, type: TSType) {
  return node({
    type: "TSPropertySignature",
    computed: false,
    optional: false,
    readonly: false,
    key: id(name),
    typeAnnotation: node({ type: "TSTypeAnnotation", typeAnnotation: type }),
    accessibility: null,
    static: false,
  });
}
function state_value(first: boolean, value: Expression): Expression {
  return node({
    type: "ObjectExpression",
    properties: [
      node({
        type: "Property",
        kind: "init",
        key: id("first"),
        value: literal(first),
        method: false,
        shorthand: false,
        computed: false,
      }),
      node({
        type: "Property",
        kind: "init",
        key: id("value"),
        value,
        method: false,
        shorthand: false,
        computed: false,
      }),
    ],
  });
}
function stack_safe_loop(
  loop: Loop,
  rest: readonly Statement[],
  context: Expression | undefined,
  state: State,
  options: Options,
): Result | undefined {
  if (
    state.kind !== "do" ||
    state.services.config.optimizations?.loop === false ||
    state.dictionary?.type !== "Identifier" ||
    !state.services.recursive_dictionaries.has(state.dictionary.name)
  ) return;
  let early_return = false;
  for (const part of loop.body) {
    visit(part, (item) => {
      if (function_like(item)) return false;
      if (item.type === "ReturnStatement") early_return = true;
    });
  }
  if (early_return) return;
  const runtime = state.services.loop();
  if (!runtime) return;
  const initial = state.services.fresh("initial_state");
  const instruction = state.services.fresh("LoopInstruction");
  const step_type = type_ref(instruction.name);
  let value_type = query(initial);
  if (loop.do_first) value_type = node({ type: "TSBooleanKeyword" });
  const state_type: TSType = node({
    type: "TSTypeLiteral",
    members: [
      property_type("first", node({ type: "TSBooleanKeyword" })),
      property_type("value", value_type),
    ],
  });
  const alias: Statement = node({
    type: "TSTypeAliasDeclaration",
    id: instruction,
    typeParameters: null,
    declare: false,
    typeAnnotation: node({
      type: "TSTypeReference",
      typeName: node({
        type: "TSQualifiedName",
        left: runtime,
        right: id("LoopStep"),
      }),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from([state_type, node({ type: "TSVoidKeyword" })]),
      }),
    }),
  });
  const lift = (value: Expression) =>
    method(state.dictionary!, "pure", [value], [step_type]);
  const exit = statements(rest, context, state, options);
  const done = lift(method(runtime, "done", [void_zero()]));
  const next = lift(method(runtime, "rec", [state_value(false, loop.next)]));
  const body = statements(
    [...loop.body, node({ type: "ContinueStatement", label: null })],
    context,
    { ...state, continuation_type: step_type },
    { continue_expression: next, break_expression: done },
  );
  const params: ParamPattern[] = [];
  let guard = loop.condition;
  if (loop.variable) {
    params.push(parameter(loop.variable, loop.type ?? query(initial)));
  }
  if (loop.do_first) {
    const first = state.services.fresh("first_iteration");
    params.push(parameter(first, node({ type: "TSBooleanKeyword" })));
    guard = node({
      type: "LogicalExpression",
      operator: "||",
      left: first,
      right: guard,
    });
  }
  if (params.length === 0) {
    params.push(
      parameter(
        state.services.fresh("unused"),
        node({ type: "TSUndefinedKeyword" }),
      ),
    );
  }
  const step = state.services.fresh("loop_step");
  const first_step = state.services.fresh("first_step");
  const cursor = state.services.fresh("loop_state");
  const recursion = method(state.dictionary, "tail_rec_m", [
    state_value(true, initial),
    arrow(
      [parameter(cursor)],
      block([
        node({
          type: "IfStatement",
          test: member(cursor, "first"),
          consequent: ret(first_step),
          alternate: null,
        }),
        ret(call(step, [member(cursor, "value")])),
      ]),
    ),
  ]);
  state.services.report(
    loop.body[0] ?? state.services.program,
    "loop",
    "transformed",
    "Lowered loop control through MonadRec with typed next-state and break instructions.",
  );
  return {
    yielded: true,
    block: block([
      variable("let", initial, loop.initial),
      alias,
      variable(
        "const",
        step,
        arrow(
          params,
          block([
            node({
              type: "IfStatement",
              test: guard,
              consequent: body.block,
              alternate: null,
            }),
            ret(done),
          ]),
        ),
      ),
      variable("const", first_step, call(step, [initial])),
      ret(method(recursion, "bind", [arrow([], exit.block)])),
    ]),
  };
}

function flat(
  body: BlockStatement | FunctionBody,
  state: State,
): Result | undefined {
  if (
    state.kind !== "do" ||
    state.services.config.optimizations?.flatten === false ||
    body.body.length < 128
  ) return;
  const terminal = body.body.at(-1);
  if (terminal?.type !== "ReturnStatement" || yield_star(terminal.argument)) {
    return;
  }
  const yields: Yield[] = [];
  const locals = new Set<string>();
  for (const part of body.body.slice(0, -1)) {
    const yielded = read_yield(part);
    if (
      !yielded || yielded.terminal ||
      yielded.name && yielded.name.type !== "Identifier"
    ) return;
    if (yielded.name?.type === "Identifier") locals.add(yielded.name.name);
    yields.push(yielded);
  }
  if (!yields.length) return;
  function mentions(value: Node, permitted?: string): boolean {
    let found = false;
    visit(value, (part) => {
      if (
        part.type === "Identifier" && locals.has(part.name) &&
        part.name !== permitted
      ) found = true;
    });
    return found;
  }
  if (yields.some((yielded) => mentions(yielded.expression))) return;
  const last = yields.at(-1)!;
  let permitted: string | undefined;
  if (last.name?.type === "Identifier") permitted = last.name.name;
  if (terminal.argument && mentions(terminal.argument, permitted)) return;
  let dictionary = state.dictionary;
  if (
    dictionary &&
    (dictionary.type !== "Identifier" ||
      !state.services.recursive_dictionaries.has(dictionary.name))
  ) return;
  dictionary ??= state.services.flat_dictionary(yields[0].expression);
  if (!dictionary) return;
  const runtime = state.services.loop();
  if (!runtime) return;
  const index = state.services.fresh("instruction");
  const first = state.services.fresh("first_context");
  const cases = yields.map((yielded, position) => {
    let result: Expression = method(runtime, "rec", [literal(position + 1)]);
    if (position === yields.length - 1) {
      result = method(runtime, "done", [terminal.argument ?? void_zero()]);
    }
    let expression = yielded.expression;
    if (position === 0) expression = first;
    const params: ParamPattern[] = [];
    if (yielded.name) params.push(yielded.name);
    return node({
      type: "SwitchCase",
      test: literal(position),
      consequent: Array.from([
        ret(method(expression, "map", [arrow(params, block([ret(result)]))])),
      ]),
    });
  });
  state.services.report(
    body,
    "flatten",
    "transformed",
    "Flattened independent yields into a MonadRec instruction switch; generator-local captures remain isolated.",
  );
  return {
    yielded: true,
    block: block([
      variable("const", first, yields[0].expression),
      ret(
        method(dictionary, "tail_rec_m", [
          literal(0),
          arrow(
            [parameter(index, node({ type: "TSNumberKeyword" }))],
            block([
              node({ type: "SwitchStatement", discriminant: index, cases }),
              node({
                type: "ThrowStatement",
                argument: node({
                  type: "NewExpression",
                  callee: id("Error"),
                  arguments: [literal("Invalid generated instruction")],
                }),
              }),
            ]),
          ),
        ]),
      ),
    ]),
  };
}

const mutating_methods = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);
type Capture = {
  declaration: Node;
  allocated: boolean;
  end: number;
  references: number[];
  writes: number[];
  closure_write: boolean;
};
function allocation(value: Expression): boolean {
  value = unwrap(value);
  if (value.type === "ConditionalExpression") {
    return allocation(value.consequent) || allocation(value.alternate);
  }
  return value.type === "ArrayExpression" ||
    value.type === "ObjectExpression" || value.type === "NewExpression" ||
    value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression";
}
function binding_names(
  pattern: BindingPattern,
  add: (name: string) => void,
): void {
  switch (pattern.type) {
    case "Identifier":
      add(pattern.name);
      break;
    case "AssignmentPattern":
      binding_names(pattern.left, add);
      break;
    case "ArrayPattern":
      for (const item of pattern.elements) {
        if (!item) continue;
        if (item.type === "RestElement") binding_names(item.argument, add);
        else binding_names(item, add);
      }
      break;
    case "ObjectPattern":
      for (const item of pattern.properties) {
        if (item.type === "RestElement") binding_names(item.argument, add);
        else binding_names(item.value, add);
      }
  }
}
function unsafe_capture(body: FunctionBody): Node | undefined {
  const scopes: Map<string, Capture | undefined>[] = [];
  const ends: number[] = [];
  const captures: Capture[] = [];
  const yields: number[] = [];
  function lookup(name: string): Capture | undefined {
    for (let index = scopes.length - 1; index >= 0; index -= 1) {
      if (scopes[index].has(name)) return scopes[index].get(name);
    }
  }
  function declare(
    pattern: BindingPattern,
    declaration: Node | undefined,
    allocated: boolean,
    nested: boolean,
  ): void {
    binding_names(pattern, (name) => {
      let binding: Capture | undefined;
      if (declaration && !nested) {
        binding = {
          declaration,
          allocated,
          end: ends.at(-1)!,
          references: [],
          writes: [],
          closure_write: false,
        };
        captures.push(binding);
      }
      scopes.at(-1)!.set(name, binding);
    });
  }
  function write(value: Node, nested: boolean): void {
    if (value.type === "Identifier") {
      const binding = lookup(value.name);
      if (binding) {
        binding.writes.push(value.start);
        binding.closure_write ||= nested;
      }
    } else if (value.type === "MemberExpression") write(value.object, nested);
    else if (
      value.type === "ArrayExpression" || value.type === "ArrayPattern"
    ) {
      for (const item of value.elements) if (item) write(item, nested);
    } else if (
      value.type === "ObjectExpression" || value.type === "ObjectPattern"
    ) {
      for (const item of value.properties) {
        if (item.type === "SpreadElement" || item.type === "RestElement") {
          write(item.argument, nested);
        } else write(item.value, nested);
      }
    } else if (value.type === "SpreadElement" || value.type === "RestElement") {
      write(value.argument, nested);
    }
  }
  function scan(value: Node, nested = false, parent?: Node): void {
    if (function_like(value)) {
      scopes.push(new Map());
      ends.push(value.end);
      if (
        value.type === "FunctionDeclaration" ||
        value.type === "FunctionExpression" ||
        value.type === "ArrowFunctionExpression"
      ) {
        for (const param of value.params) {
          if (param.type === "RestElement") {
            declare(param.argument, undefined, false, true);
          } else if (param.type !== "TSParameterProperty") {
            declare(param, undefined, false, true);
          }
        }
      }
      for (const child of children(value)) scan(child, true, value);
      scopes.pop();
      ends.pop();
      return;
    }
    if (value.type === "BlockStatement") {
      scopes.push(new Map());
      ends.push(value.end);
      for (const part of value.body) {
        if (part.type === "VariableDeclaration") {
          for (const declaration of part.declarations) {
            declare(
              declaration.id,
              declaration,
              !!declaration.init && allocation(declaration.init),
              nested,
            );
          }
        } else if (
          (part.type === "FunctionDeclaration" ||
            part.type === "ClassDeclaration") && part.id
        ) declare(part.id, part, true, nested);
      }
      for (const child of children(value)) scan(child, nested, value);
      scopes.pop();
      ends.pop();
      return;
    }
    if (
      value.type === "ForStatement" || value.type === "ForOfStatement" ||
      value.type === "ForInStatement"
    ) {
      scopes.push(new Map());
      ends.push(value.end);
      let initializer: Node | null;
      if (value.type === "ForStatement") initializer = value.init;
      else initializer = value.left;
      if (initializer?.type === "VariableDeclaration") {
        for (const declaration of initializer.declarations) {
          declare(
            declaration.id,
            declaration,
            !!declaration.init && allocation(declaration.init),
            nested,
          );
        }
      }
      if (value.type === "ForStatement") {
        if (value.init) scan(value.init, nested, value);
        if (value.test) scan(value.test, nested, value);
        scan(value.body, nested, value);
      } else {
        scan(value.right, nested, value);
        scan(value.body, nested, value);
      }
      scopes.pop();
      ends.pop();
      return;
    }
    if (value.type === "VariableDeclarator") {
      if (value.init) scan(value.init, nested, value);
      return;
    }
    if (value.type === "YieldExpression" && !nested) yields.push(value.start);
    if (value.type === "AssignmentExpression") write(value.left, nested);
    if (
      value.type === "UpdateExpression" ||
      value.type === "UnaryExpression" && value.operator === "delete"
    ) write(value.argument, nested);
    if (
      value.type === "CallExpression" &&
      value.callee.type === "MemberExpression" && !value.callee.computed &&
      value.callee.property.type === "Identifier" &&
      mutating_methods.has(value.callee.property.name)
    ) write(value.callee.object, nested);
    if (
      value.type === "Identifier" &&
      !(parent &&
        (parent.type === "MemberExpression" && parent.property === value &&
            !parent.computed ||
          parent.type === "Property" && parent.key === value &&
            !parent.computed))
    ) lookup(value.name)?.references.push(value.start);
    for (const child of children(value)) scan(child, nested, value);
  }
  scan(body);
  return captures.find((capture) => {
    let low = 0;
    let high = yields.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (yields[middle] < capture.declaration.end) low = middle + 1;
      else high = middle;
    }
    const yielded = yields[low];
    if (yielded === undefined || yielded >= capture.end) return false;
    return capture.closure_write || capture.writes.some((write) =>
      write > yielded
    ) || capture.allocated && capture.references.some((reference) =>
          reference > yielded
        );
  })?.declaration;
}
function unsafe_prefix(body: FunctionBody): Node | undefined {
  const scopes: Set<string>[] = [];
  const yields: number[] = [];
  const effects: { node: Node; loop: boolean }[] = [];
  function local(value: Node): boolean {
    return value.type === "Identifier" &&
      scopes.some((scope) => scope.has(value.name));
  }
  function declare(pattern: BindingPattern): void {
    binding_names(pattern, (name) => scopes.at(-1)!.add(name));
  }
  function scan(value: Node, loop = false): void {
    if (function_like(value)) return;
    if (value.type === "BlockStatement") {
      scopes.push(new Set());
      for (const part of value.body) {
        if (part.type === "VariableDeclaration") {
          for (const declaration of part.declarations) {
            declare(declaration.id);
          }
        }
      }
      for (const child of children(value)) scan(child, loop);
      scopes.pop();
      return;
    }
    if (value.type === "YieldExpression") {
      yields.push(value.start);
      return;
    }
    const in_loop = loop ||
      (value.type === "ForStatement" || value.type === "ForOfStatement" ||
          value.type === "WhileStatement" ||
          value.type === "DoWhileStatement") && contains(value);
    if (
      value.type === "ForStatement" || value.type === "ForOfStatement" ||
      value.type === "ForInStatement"
    ) {
      scopes.push(new Set());
      let initializer: Node | null;
      if (value.type === "ForStatement") initializer = value.init;
      else initializer = value.left;
      if (initializer?.type === "VariableDeclaration") {
        for (const declaration of initializer.declarations) {
          declare(declaration.id);
        }
      }
      if (value.type === "ForOfStatement") scan(value.body, in_loop);
      else for (const child of children(value)) scan(child, in_loop);
      scopes.pop();
      return;
    }
    if (
      value.type === "CallExpression" || value.type === "NewExpression" ||
      value.type === "AssignmentExpression" && !local(value.left) ||
      value.type === "UpdateExpression" && !local(value.argument) ||
      value.type === "UnaryExpression" && value.operator === "delete"
    ) effects.push({ node: value, loop: in_loop });
    for (const child of children(value)) scan(child, in_loop);
  }
  scan(body);
  return effects.find(({ node, loop }) =>
    yields.some((yielded) => loop || node.end < yielded)
  )?.node;
}

/** Lower generator syntax directly into native Oxc expressions. */
export function lower_generator(
  value: CallExpression,
  services: TransformServices,
): Expression | undefined {
  const kind = services.kind(value);
  if (!kind) return;
  let explicit: Expression | undefined;
  if (
    kind === "do" && value.arguments.length === 2 &&
    value.arguments[0].type !== "SpreadElement"
  ) explicit = value.arguments[0];
  let run = value.arguments[0];
  if (explicit) run = value.arguments[1];
  const state: State = {
    kind,
    services,
    dictionary: explicit,
    used_contexts: new Set(),
  };
  try {
    if (kind === "program" && services.imports.effect_helper_shadowed) {
      fail(
        state,
        value,
        "local Effect binding conflicts with generated helpers.",
      );
    }
    if (
      !run || run.type !== "FunctionExpression" || !run.generator || !run.body
    ) fail(state, value, "expected a function* argument.");
    let hazard: Node | undefined;
    let var_binding: Node | undefined;
    let first_yield: YieldExpression | undefined;
    const lexical = (part: Node, parent?: Node): void => {
      const property =
        parent?.type === "MemberExpression" && !parent.computed &&
          parent.property === part ||
        parent?.type === "Property" && !parent.computed && parent.key === part;
      if (
        part.type === "ThisExpression" || part.type === "Super" ||
        part.type === "MetaProperty" ||
        part.type === "Identifier" && part.name === "arguments" && !property ||
        part.type === "CallExpression" && !part.optional &&
          part.callee.type === "Identifier" && part.callee.name === "eval"
      ) hazard = part;
      for (const child of children(part)) lexical(child, part);
    };
    lexical(run.body);
    visit(run.body, (part) => {
      if (function_like(part)) return false;
      if (part.type === "VariableDeclaration" && part.kind === "var") {
        var_binding = part;
      }
      if (part.type === "YieldExpression" && !first_yield) first_yield = part;
    });
    if (hazard) {
      fail(
        state,
        hazard,
        "generator lexical this, arguments, new.target, super, and direct eval are not supported.",
      );
    }
    if (var_binding) {
      fail(
        state,
        var_binding,
        "var-scoped generator locals are not supported; use let or const.",
      );
    }
    const capture = unsafe_capture(run.body);
    if (capture) {
      fail(
        state,
        capture,
        "generator-local state captured across yield* cannot preserve branching or repeated execution.",
      );
    }
    const prefix = unsafe_prefix(run.body);
    if (prefix) {
      fail(
        state,
        prefix,
        "observable generator statements before yield* cannot preserve replay or repeated execution; lift the work into a yielded context.",
      );
    }
    if (
      explicit?.type === "Identifier" &&
      services.task_dictionaries.has(explicit.name) && first_yield?.argument
    ) {
      const expression = unwrap(first_yield.argument);
      let repeatable = expression.type === "Identifier";
      if (
        expression.type === "CallExpression" &&
        expression.callee.type === "Identifier" &&
        expression.callee.name === explicit.name &&
        expression.arguments.length === 1
      ) {
        const callback = expression.arguments[0];
        if (callback.type !== "SpreadElement") {
          const target = unwrap(callback);
          repeatable = target.type === "Identifier" ||
            target.type === "ArrowFunctionExpression" ||
            target.type === "FunctionExpression";
        }
      }
      if (!repeatable) {
        services.diagnose(
          first_yield,
          "Skipped Do: arbitrary Task first-yield construction may be observed again when the generator replays.",
        );
        return;
      }
    }
    if (explicit && explicit.type !== "Identifier") {
      state.dictionary = services.fresh("dictionary");
    }
    let result = flat(run.body, state);
    if (
      !result && run.body.body.filter((part) => read_yield(part)).length > 256
    ) {
      fail(
        state,
        value,
        "long dependent continuations require liveness threading; preserving the generator avoids compiler printer stack overflow.",
      );
    }
    result ??= statements(run.body.body, undefined, state, {});
    if (kind === "do" && !result.yielded && !state.dictionary) {
      services.diagnose(
        value,
        "Skipped Do: Do requires at least one top-level yield*.",
      );
      return;
    }
    if (explicit && state.dictionary !== explicit) {
      return expr(
        block([
          variable("const", state.dictionary as IdentifierReference, explicit),
          ...result.block.body,
        ]),
      );
    }
    return expr(result.block);
  } catch (error) {
    if (error instanceof UnsupportedGenerator) return;
    throw error;
  }
}

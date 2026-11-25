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
  TSTypeName,
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
  value_visitor_keys,
  variable,
  walk_values,
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

function function_like(value: Node): boolean {
  return value.type === "FunctionDeclaration" ||
    value.type === "FunctionExpression" ||
    value.type === "ArrowFunctionExpression";
}
function visit(value: Node, callback: (value: Node) => false | void): void {
  walk_values(value, callback);
}
function contains(value: Node, breaks = false): boolean {
  let found = false;
  walk_values(value, (part) => {
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
  const length = body.body.length;
  if (length === 0) return;
  const last = body.body[length - 1];
  if (last.type !== "ReturnStatement") return;
  for (let index = 0; index < length - 1; index += 1) {
    if (contains(body.body[index])) return;
  }
  const value = pure_value(last.argument, target);
  if (!value) return;
  const mapped_body = length === 1
    ? [ret(value)]
    : [...body.body.slice(0, -1), ret(value)];
  const callback = continuation(
    params,
    block(mapped_body),
    state,
    true,
  );
  if (state.kind === "program") {
    return method(state.services.effect(), "map_from", [expression, callback]);
  }
  return method(expression, "map", [callback]);
}
function is_effect_pure_call(
  expression: Expression | null | undefined,
  effect_expr: Expression,
): boolean {
  return pure_value(expression ?? null, effect_expr) !== undefined;
}

function count_non_pure_effect_returns(
  body: BlockStatement,
  effect_expr: Expression,
): number {
  let count = 0;
  function scan(stmt: Statement): void {
    switch (stmt.type) {
      case "ReturnStatement":
        if (!is_effect_pure_call(stmt.argument, effect_expr)) count += 1;
        return;
      case "BlockStatement":
        for (const s of stmt.body) scan(s as Statement);
        return;
      case "IfStatement":
        scan(stmt.consequent);
        if (stmt.alternate !== null) scan(stmt.alternate);
        return;
      case "SwitchStatement":
        for (const c of stmt.cases) {
          for (const s of c.consequent) scan(s as Statement);
        }
        return;
      default:
        return;
    }
  }
  for (const s of body.body) scan(s as Statement);
  return count;
}

function effect_type_name(
  effect_expr: Expression,
): TSTypeName | undefined {
  if (effect_expr.type === "Identifier") return effect_expr;
  if (
    effect_expr.type === "MemberExpression" && !effect_expr.computed &&
    !effect_expr.optional && effect_expr.property.type === "Identifier"
  ) {
    const left = effect_type_name(effect_expr.object);
    if (left !== undefined) {
      return node({
        type: "TSQualifiedName",
        left,
        right: effect_expr.property,
      });
    }
  }
  return undefined;
}

function unify_multi_branch_effect_body(
  body: BlockStatement,
  state: State,
): BlockStatement {
  const effect_expr = state.services.effect();
  if (count_non_pure_effect_returns(body, effect_expr) < 2) return body;
  const eff_name = effect_type_name(effect_expr);
  if (eff_name === undefined) return body;
  const res_id = state.services.fresh("effect_branch");
  const req_param = id("R");
  const item_param = id("T");
  const typeof_res: TSType = node({
    type: "TSTypeQuery",
    exprName: res_id,
    typeArguments: null,
  });
  const infer_req: TSType = node({
    type: "TSConditionalType",
    checkType: typeof_res,
    extendsType: node({
      type: "TSTypeReference",
      typeName: eff_name,
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from<TSType>([
          node({
            type: "TSInferType",
            typeParameter: node({
              type: "TSTypeParameter",
              name: req_param,
              constraint: null,
              default: null,
              in: false,
              out: false,
              const: false,
            }),
          }),
          node({ type: "TSUnknownKeyword" }),
        ]),
      }),
    }),
    trueType: node({
      type: "TSTypeReference",
      typeName: req_param,
      typeArguments: null,
    }),
    falseType: node({ type: "TSNeverKeyword" }),
  });
  const infer_item: TSType = node({
    type: "TSConditionalType",
    checkType: typeof_res,
    extendsType: node({
      type: "TSTypeReference",
      typeName: eff_name,
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from<TSType>([
          node({ type: "TSUnknownKeyword" }),
          node({
            type: "TSInferType",
            typeParameter: node({
              type: "TSTypeParameter",
              name: item_param,
              constraint: null,
              default: null,
              in: false,
              out: false,
              const: false,
            }),
          }),
        ]),
      }),
    }),
    trueType: node({
      type: "TSTypeReference",
      typeName: item_param,
      typeArguments: null,
    }),
    falseType: node({ type: "TSNeverKeyword" }),
  });
  const unified_type: TSType = node({
    type: "TSTypeReference",
    typeName: eff_name,
    typeArguments: node({
      type: "TSTypeParameterInstantiation",
      params: Array.from<TSType>([infer_req, infer_item]),
    }),
  });
  return block([
    variable("const", res_id, call(arrow([], body), [])),
    ret(
      node({
        type: "TSAsExpression",
        expression: res_id,
        typeAnnotation: unified_type,
      }),
    ),
  ]);
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
  const effective_body = state.kind === "program"
    ? unify_multi_branch_effect_body(body, state)
    : body;
  const callback = continuation(params, effective_body, state);
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
  start = 0,
): Result {
  const prefix: Statement[] = [];
  const finish = (result: Result): Result => {
    if (prefix.length === 0) return result;
    return {
      block: block([...prefix, ...result.block.body]),
      yielded: result.yielded,
    };
  };
  for (let index = start; index < values.length; index += 1) {
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
      if (state.kind === "program") {
        const next = statements(
          values,
          yielded.expression,
          state,
          options,
          index + 1,
        );
        return finish({
          block: block([
            ret(bind(yielded.expression, params, next.block, state)),
          ]),
          yielded: true,
        });
      }
      const local = state.services.fresh("context");
      const next = statements(values, local, state, options, index + 1);
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
        let all_cases_terminate = value.cases.length > 0;
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
            all_cases_terminate = false;
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
            all_cases_terminate = false;
            parts = [...parts, ...rest];
          }
          const result = statements(parts, context, state, options);
          did_yield ||= result.yielded;
          return node({ ...clause, consequent: Array.from([result.block]) });
        });
        if (rest.length === 0 && all_cases_terminate) {
          return finish({
            block: block([node({ ...value, cases })]),
            yielded: did_yield,
          });
        }
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

function is_primitive_array_literal(expression: Expression): boolean {
  const array = unwrap(expression);
  return array.type === "ArrayExpression" && array.elements.every((item) => {
    if (!item || item.type === "SpreadElement") return false;
    const primitive = unwrap(item);
    if (primitive.type === "Literal") return !("regex" in primitive);
    return primitive.type === "UnaryExpression" &&
      (primitive.operator === "+" || primitive.operator === "-") &&
      primitive.argument.type === "Literal" &&
      typeof primitive.argument.value === "number";
  });
}

function contains_yield_or_await(value: Node): boolean {
  let found = false;
  walk_values(value, (part) => {
    if (function_like(part)) return false;
    if (part.type === "YieldExpression" || part.type === "AwaitExpression") {
      found = true;
      return false;
    }
  });
  return found;
}

function is_trivial_pure_expr(expression: Expression): boolean {
  const value = unwrap(expression);
  if (value.type === "Literal") return true;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return true;
  }
  if (
    value.type === "UnaryExpression" &&
    (value.operator === "void" || value.operator === "-" ||
      value.operator === "+" || value.operator === "!" ||
      value.operator === "~")
  ) return is_trivial_pure_expr(value.argument);
  return false;
}

type DirectSingleShotMode = "maybe" | "either" | "identity";
type DirectSingleShotSpec = {
  readonly mode: DirectSingleShotMode;
  readonly inferred: boolean;
  readonly explicit_left_type?: TSType;
  readonly get_dictionary: () => IdentifierReference | undefined;
};

function first_unshadowed(
  names: ReadonlySet<string> | undefined,
  services: TransformServices,
): string | undefined {
  if (names === undefined || names.size === 0) return undefined;
  const shadowed = services.imports.shadowed_names;
  for (const name of names) {
    if (shadowed === undefined || !shadowed.has(name)) return name;
  }
  return undefined;
}

function direct_single_shot_spec(
  explicit: Expression | undefined,
  first_yield: YieldExpression | undefined,
  services: TransformServices,
): DirectSingleShotSpec | undefined {
  const imp = services.imports;
  if (explicit !== undefined) {
    const ex = unwrap(explicit);
    if (ex.type === "Identifier") {
      if (!services.bindings.imported(ex)) return undefined;
      if (imp.direct_maybe_dictionaries?.has(ex.name)) {
        return { mode: "maybe", inferred: false, get_dictionary: () => ex };
      }
      if (imp.direct_either_dictionaries?.has(ex.name)) {
        return { mode: "either", inferred: false, get_dictionary: () => ex };
      }
      if (imp.direct_identity_dictionaries?.has(ex.name)) {
        return { mode: "identity", inferred: false, get_dictionary: () => ex };
      }
      return undefined;
    }
    // Either.with_left<E>()
    if (
      ex.type === "CallExpression" && !ex.optional &&
      ex.arguments.length === 0 &&
      ex.callee.type === "MemberExpression" && !ex.callee.computed &&
      !ex.callee.optional &&
      ex.callee.object.type === "Identifier" &&
      ex.callee.property.type === "Identifier" &&
      ex.callee.property.name === "with_left" &&
      imp.direct_either_dictionaries?.has(ex.callee.object.name) &&
      services.bindings.imported(ex.callee.object)
    ) {
      const left_type = ex.typeArguments?.params.length === 1
        ? ex.typeArguments.params[0]
        : undefined;
      const either_id = ex.callee.object;
      return {
        mode: "either",
        inferred: false,
        explicit_left_type: left_type,
        get_dictionary: () => either_id,
      };
    }
    return undefined;
  }
  if (!first_yield?.delegate || first_yield.argument === null) return undefined;

  const make_spec = (
    mode: DirectSingleShotMode,
    anchor: string,
  ): DirectSingleShotSpec => {
    if (mode === "maybe") {
      return {
        mode: "maybe",
        inferred: true,
        get_dictionary() {
          const existing = first_unshadowed(
            imp.direct_maybe_dictionaries,
            services,
          );
          if (existing !== undefined) return id(existing);
          return services.import_from_module?.(anchor, "maybe", "Maybe");
        },
      };
    }
    if (mode === "either") {
      return {
        mode: "either",
        inferred: true,
        get_dictionary() {
          const existing = first_unshadowed(
            imp.direct_either_dictionaries,
            services,
          );
          if (existing !== undefined) return id(existing);
          return services.import_from_module?.(anchor, "either", "Either");
        },
      };
    }
    return {
      mode: "identity",
      inferred: true,
      get_dictionary() {
        const existing = first_unshadowed(
          imp.direct_identity_dictionaries,
          services,
        );
        if (existing !== undefined) return id(existing);
        return services.import_from_module?.(anchor, "identity", "Identity");
      },
    };
  };

  const is_imported_ident = (
    ident: IdentifierReference,
    param_names?: ReadonlySet<string>,
  ): boolean => {
    if (param_names?.has(ident.name)) return false;
    if (services.bindings.imported(ident)) return true;
    // Skipped top-level helper bodies don't have scopes recorded in minimal mode;
    // check unshadowed module-level imports safely.
    return services.bindings.resolve(ident) === null &&
      !(imp.shadowed_names?.has(ident.name));
  };

  const infer_from_expr = (
    expression: Expression,
    seen_fns: Set<Node>,
    param_names?: ReadonlySet<string>,
  ): DirectSingleShotSpec | undefined => {
    const arg = unwrap(expression);
    if (arg.type === "ConditionalExpression") {
      const left = infer_from_expr(arg.consequent, seen_fns, param_names);
      const right = infer_from_expr(arg.alternate, seen_fns, param_names);
      if (left !== undefined && right !== undefined) {
        return left.mode === right.mode ? left : undefined;
      }
      return left ?? right;
    }
    if (arg.type !== "CallExpression" || arg.optional) return undefined;
    const callee = unwrap(arg.callee);
    // Namespaced calls: Maybe.Just, Maybe.Nothing, Maybe.pure, Either.Right, Either.Left, Identity.pure
    if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      is_imported_ident(callee.object, param_names)
    ) {
      const obj = callee.object.name;
      const prop = callee.property.name;
      if (
        imp.direct_maybe_dictionaries?.has(obj) &&
        (prop === "Just" || prop === "Nothing" || prop === "pure" ||
          prop === "empty")
      ) {
        return make_spec("maybe", obj);
      }
      if (
        imp.direct_either_dictionaries?.has(obj) &&
        (prop === "Right" || prop === "Left" || prop === "pure")
      ) {
        return make_spec("either", obj);
      }
      if (
        imp.direct_identity_dictionaries?.has(obj) && prop === "pure"
      ) {
        return make_spec("identity", obj);
      }
      return undefined;
    }
    if (callee.type !== "Identifier") return undefined;
    const name = callee.name;
    if (is_imported_ident(callee, param_names)) {
      if (
        imp.just_constructors?.has(name) ||
        imp.nothing_constructors?.has(name) ||
        imp.from_nullable_functions?.has(name) ||
        imp.either_hush_functions?.has(name) ||
        imp.maybe_filter_functions?.has(name)
      ) {
        return make_spec("maybe", name);
      }
      if (
        imp.right_constructors?.has(name) ||
        imp.left_constructors?.has(name) ||
        imp.either_from_number_functions?.has(name) ||
        imp.either_try_catch_functions?.has(name) ||
        imp.either_note_functions?.has(name) ||
        imp.maybe_to_either_functions?.has(name) ||
        imp.either_map_left_functions?.has(name) ||
        imp.either_bind_widen_functions?.has(name) ||
        imp.validation_to_either_functions?.has(name)
      ) {
        return make_spec("either", name);
      }
      if (imp.identity_constructors?.has(name)) {
        return make_spec("identity", name);
      }
    }
    // Local helper function return-type inference (e.g. `function parse_x() { return Right(...); }`)
    const decl = services.bindings.resolve(callee);
    if (
      decl !== null && decl.type === "FunctionDeclaration" &&
      decl.body !== null && !decl.async && !decl.generator &&
      !seen_fns.has(decl)
    ) {
      seen_fns.add(decl);
      const inner_params = new Set<string>();
      for (const p of decl.params) {
        if (p.type === "RestElement") {
          binding_names(p.argument, (n) => inner_params.add(n));
        } else if (p.type !== "TSParameterProperty") {
          binding_names(p, (n) => inner_params.add(n));
        }
      }
      let inferred: DirectSingleShotSpec | undefined;
      let mismatch = false;
      walk_values(decl.body, (part) => {
        if (mismatch) return false;
        if (function_like(part)) return false;
        if (part.type === "ReturnStatement") {
          if (part.argument === null) {
            mismatch = true;
            return false;
          }
          const sub = infer_from_expr(part.argument, seen_fns, inner_params);
          if (sub === undefined) {
            mismatch = true;
            return false;
          }
          if (inferred === undefined) inferred = sub;
          else if (inferred.mode !== sub.mode) {
            mismatch = true;
            return false;
          }
        }
      });
      if (!mismatch && inferred !== undefined) return inferred;
    }
    return undefined;
  };
  return infer_from_expr(first_yield.argument, new Set());
}

function direct_typed_const(
  name: IdentifierReference,
  init: Expression,
  type: TSType,
): Statement {
  return node({
    type: "VariableDeclaration",
    kind: "const",
    declarations: [
      node({
        type: "VariableDeclarator",
        id: {
          ...name,
          typeAnnotation: node({
            type: "TSTypeAnnotation",
            typeAnnotation: type,
          }),
        },
        init,
      }),
    ],
  });
}

function direct_negate_cond(expression: Expression): Expression {
  const inner = unwrap(expression);
  if (
    inner.type === "UnaryExpression" && inner.operator === "!" && inner.prefix
  ) {
    return inner.argument;
  }
  return node({
    type: "UnaryExpression",
    operator: "!",
    prefix: true,
    argument: expression,
  });
}

function direct_single_shot(
  body: BlockStatement | FunctionBody,
  state: State,
  spec: DirectSingleShotSpec,
  force_direct: boolean,
): Result | undefined {
  if (
    state.kind !== "do" ||
    body.body.length >= 128
  ) return undefined;
  const mode = spec.mode;
  const just_name = first_unshadowed(
    state.services.imports.just_constructors,
    state.services,
  );
  const left_name = first_unshadowed(
    state.services.imports.left_constructors,
    state.services,
  );
  const right_name = first_unshadowed(
    state.services.imports.right_constructors,
    state.services,
  );
  const identity_name = first_unshadowed(
    state.services.imports.identity_constructors,
    state.services,
  );
  let cached_dict: IdentifierReference | undefined;
  const get_dict = (): IdentifierReference | undefined =>
    cached_dict ??= spec.get_dictionary();
  const left_callee = (): Expression =>
    left_name !== undefined ? id(left_name) : member(get_dict()!, "Left");
  const right_callee = (): Expression =>
    right_name !== undefined ? id(right_name) : member(get_dict()!, "Right");
  const wrap_maybe = (value: Expression): Expression =>
    just_name !== undefined
      ? call(id(just_name), [value])
      : method(get_dict()!, "pure", [value]);
  const wrap_identity = (value: Expression): Expression =>
    identity_name !== undefined
      ? call(id(identity_name), [value])
      : call(get_dict()!, [value]);
  const typed_const = direct_typed_const;
  const negate_cond = direct_negate_cond;

  type SingleCtorMatch = {
    readonly ok: boolean;
    readonly arg?: Expression;
    readonly ok_type?: TSType;
    readonly err_type?: TSType;
  };

  const match_single_ctor = (
    expression: Expression,
  ): SingleCtorMatch | undefined => {
    const val = unwrap(expression);
    if (val.type !== "CallExpression" || val.optional) return undefined;
    const tparams = val.typeArguments?.params;
    const callee = unwrap(val.callee);
    if (
      callee.type === "Identifier" && state.services.bindings.imported(callee)
    ) {
      const name = callee.name;
      if (mode === "maybe") {
        if (
          state.services.imports.just_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement" &&
          (tparams === undefined || tparams.length === 1)
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
        if (
          state.services.imports.nothing_constructors?.has(name) &&
          val.arguments.length === 0 &&
          (tparams === undefined || tparams.length === 1)
        ) {
          return { ok: false, ok_type: tparams?.[0] };
        }
      } else if (mode === "either") {
        if (
          state.services.imports.right_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement" &&
          (tparams === undefined || tparams.length === 1 ||
            tparams.length === 2)
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams !== undefined
              ? (tparams.length === 2 ? tparams[1] : tparams[0])
              : undefined,
            err_type: tparams !== undefined && tparams.length === 2
              ? tparams[0]
              : undefined,
          };
        }
        if (
          state.services.imports.left_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement" &&
          (tparams === undefined || tparams.length === 1 ||
            tparams.length === 2)
        ) {
          return {
            ok: false,
            arg: val.arguments[0] as Expression,
            err_type: tparams?.[0],
            ok_type: tparams !== undefined && tparams.length === 2
              ? tparams[1]
              : undefined,
          };
        }
      } else if (
        state.services.imports.identity_constructors?.has(name) &&
        val.arguments.length === 1 &&
        val.arguments[0].type !== "SpreadElement" &&
        (tparams === undefined || tparams.length === 1)
      ) {
        return {
          ok: true,
          arg: val.arguments[0] as Expression,
          ok_type: tparams?.[0],
        };
      }
    } else if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      state.services.bindings.imported(callee.object)
    ) {
      const obj = callee.object.name;
      const prop = callee.property.name;
      if (
        mode === "maybe" &&
        state.services.imports.direct_maybe_dictionaries?.has(obj)
      ) {
        if (
          (prop === "Just" || prop === "pure") && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement" &&
          (tparams === undefined || tparams.length === 1)
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
        if (
          (prop === "Nothing" || prop === "empty") &&
          val.arguments.length === 0 &&
          (tparams === undefined || tparams.length === 1)
        ) {
          return { ok: false, ok_type: tparams?.[0] };
        }
      } else if (
        mode === "either" &&
        state.services.imports.direct_either_dictionaries?.has(obj)
      ) {
        if (
          (prop === "Right" || prop === "pure") && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement" &&
          (tparams === undefined || tparams.length === 1 ||
            tparams.length === 2)
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams !== undefined
              ? (tparams.length === 2 ? tparams[1] : tparams[0])
              : undefined,
            err_type: tparams !== undefined && tparams.length === 2
              ? tparams[0]
              : undefined,
          };
        }
        if (
          prop === "Left" && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement" &&
          (tparams === undefined || tparams.length === 1 ||
            tparams.length === 2)
        ) {
          return {
            ok: false,
            arg: val.arguments[0] as Expression,
            err_type: tparams?.[0],
            ok_type: tparams !== undefined && tparams.length === 2
              ? tparams[1]
              : undefined,
          };
        }
      } else if (
        mode === "identity" &&
        state.services.imports.direct_identity_dictionaries?.has(obj) &&
        prop === "pure" && val.arguments.length === 1 &&
        val.arguments[0].type !== "SpreadElement" &&
        (tparams === undefined || tparams.length === 1)
      ) {
        return {
          ok: true,
          arg: val.arguments[0] as Expression,
          ok_type: tparams?.[0],
        };
      }
    }
    return undefined;
  };

  type ElidedYield =
    | {
      readonly kind: "ok";
      readonly expr: Expression;
      readonly ok_type?: TSType;
    }
    | { readonly kind: "nullable"; readonly expr: Expression }
    | {
      readonly kind: "cond";
      readonly test: Expression;
      readonly ok_expr: Expression;
      readonly ok_type?: TSType;
      readonly err_expr?: Expression;
      readonly err_type?: TSType;
    };

  const match_elided_yield = (
    expression: Expression,
  ): ElidedYield | undefined => {
    const inner_expr = unwrap(expression);
    const single = match_single_ctor(inner_expr);
    if (single !== undefined && single.ok && single.arg !== undefined) {
      if (mode === "either" && single.err_type !== undefined) return undefined;
      return { kind: "ok", expr: single.arg, ok_type: single.ok_type };
    }
    if (
      mode === "maybe" &&
      inner_expr.type === "CallExpression" &&
      !inner_expr.optional &&
      inner_expr.typeArguments == null &&
      inner_expr.callee.type === "Identifier" &&
      state.services.imports.from_nullable_functions?.has(
        inner_expr.callee.name,
      ) &&
      state.services.bindings.imported(inner_expr.callee) &&
      inner_expr.arguments.length === 1 &&
      inner_expr.arguments[0].type !== "SpreadElement"
    ) {
      return {
        kind: "nullable",
        expr: inner_expr.arguments[0] as Expression,
      };
    }
    if (
      (mode === "maybe" || mode === "either") &&
      inner_expr.type === "ConditionalExpression" &&
      !contains_yield_or_await(inner_expr.consequent) &&
      !contains_yield_or_await(inner_expr.alternate)
    ) {
      const cons = match_single_ctor(inner_expr.consequent);
      const alt = match_single_ctor(inner_expr.alternate);
      if (cons !== undefined && alt !== undefined && cons.ok !== alt.ok) {
        const ok_branch = cons.ok ? cons : alt;
        const err_branch = cons.ok ? alt : cons;
        if (
          ok_branch.ok_type !== undefined && err_branch.ok_type !== undefined
        ) return undefined;
        if (
          ok_branch.err_type !== undefined && err_branch.err_type !== undefined
        ) return undefined;
        return {
          kind: "cond",
          test: cons.ok ? inner_expr.test : negate_cond(inner_expr.test),
          ok_expr: ok_branch.arg!,
          ok_type: ok_branch.ok_type ?? err_branch.ok_type,
          err_expr: err_branch.arg,
          err_type: err_branch.err_type ?? ok_branch.err_type,
        };
      }
    }
    return undefined;
  };

  // Phase 1: Validate body structure and detect control flow / loops / elisions.
  let yield_count = 0;
  let checked_yield_count = 0;
  let has_elision = false;
  let has_elided_fail = false;
  let has_control_flow = false;
  let has_nested_yield = false;
  let first_loop_node: Node | undefined;

  const record_yield = (arg: Expression): void => {
    const elided = match_elided_yield(arg);
    if (elided !== undefined) {
      has_elision = true;
      if (elided.kind !== "ok") has_elided_fail = true;
    } else {
      checked_yield_count += 1;
    }
  };

  function validate_expr(expression: Expression, nested: boolean): boolean {
    if (!contains_yield_or_await(expression)) return true;
    const target = unwrap(expression);
    if (target.type === "AwaitExpression") return false;
    if (target.type === "YieldExpression") {
      if (!target.delegate || target.argument === null) return false;
      if (!validate_expr(target.argument, true)) return false;
      yield_count += 1;
      if (nested) has_nested_yield = true;
      record_yield(target.argument);
      return true;
    }
    switch (target.type) {
      case "BinaryExpression":
        return (target.left.type === "PrivateIdentifier" ||
          validate_expr(target.left, true)) &&
          validate_expr(target.right, true);
      case "UnaryExpression":
        return validate_expr(target.argument, true);
      case "SequenceExpression":
        return target.expressions.every((item) => validate_expr(item, true));
      case "TemplateLiteral":
        return target.expressions.every((item) => validate_expr(item, true));
      case "ArrayExpression":
        return target.elements.every((item) =>
          item === null
            ? true
            : item.type === "SpreadElement"
            ? validate_expr(item.argument, true)
            : validate_expr(item, true)
        );
      case "ObjectExpression":
        return target.properties.every((prop) =>
          prop.type === "SpreadElement"
            ? validate_expr(prop.argument, true)
            : (!prop.computed || validate_expr(prop.key as Expression, true)) &&
              validate_expr(prop.value as Expression, true)
        );
      case "MemberExpression":
        return !target.optional &&
          validate_expr(target.object, true) &&
          (!target.computed ||
            validate_expr(target.property as Expression, true));
      case "CallExpression":
      case "NewExpression":
        if (target.type === "CallExpression" && target.optional) return false;
        return validate_expr(target.callee as Expression, true) &&
          target.arguments.every((arg) =>
            arg.type === "SpreadElement"
              ? validate_expr(arg.argument, true)
              : validate_expr(arg, true)
          );
      case "AssignmentExpression":
        return target.left.type === "Identifier" &&
          validate_expr(target.right, true);
      case "ConditionalExpression":
        return validate_expr(target.test, true) &&
          validate_expr(target.consequent, true) &&
          validate_expr(target.alternate, true);
      case "LogicalExpression":
        return validate_expr(target.left, true) &&
          validate_expr(target.right, true);
      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
        return validate_expr(target.expression, true);
      default:
        return false;
    }
  }

  function validate_stmt(
    statement: Statement,
    in_loop: boolean,
    in_switch: boolean,
    in_control: boolean,
    is_last_top: boolean,
  ): boolean {
    if (
      statement.type === "ExpressionStatement" && "directive" in statement &&
      statement.directive != null
    ) return true;
    switch (statement.type) {
      case "EmptyStatement":
        return true;
      case "ThrowStatement":
        if (mode === "either") return false;
        return !contains_yield_or_await(statement.argument);
      case "TryStatement":
      case "LabeledStatement":
      case "WithStatement":
        return false;
      case "BreakStatement":
        return statement.label === null && (in_loop || in_switch);
      case "ContinueStatement":
        return statement.label === null && in_loop;
      case "ReturnStatement": {
        if (!is_last_top) has_control_flow = true;
        if (statement.argument === null) return true;
        if (yield_star(statement.argument)) {
          if (!validate_expr(statement.argument.argument, true)) return false;
          yield_count += 1;
          if (in_control) has_control_flow = true;
          record_yield(statement.argument.argument);
          return true;
        }
        if (in_control) has_control_flow = true;
        return validate_expr(statement.argument, true);
      }
      case "VariableDeclaration":
        if (statement.kind === "var") return false;
        if (
          statement.declarations.length === 1 &&
          yield_star(statement.declarations[0].init)
        ) {
          const inner = statement.declarations[0].init.argument;
          if (!validate_expr(inner, true)) return false;
          yield_count += 1;
          if (in_control) has_control_flow = true;
          record_yield(inner);
          return true;
        }
        for (const decl of statement.declarations) {
          if (
            decl.init !== null && !validate_expr(decl.init, true)
          ) return false;
        }
        return true;
      case "ExpressionStatement":
        if (yield_star(statement.expression)) {
          const inner = statement.expression.argument;
          if (!validate_expr(inner, true)) return false;
          yield_count += 1;
          if (in_control) has_control_flow = true;
          record_yield(inner);
          return true;
        }
        return validate_expr(statement.expression, true);
      case "BlockStatement":
        for (const inner of statement.body) {
          if (
            !validate_stmt(
              inner as Statement,
              in_loop,
              in_switch,
              true,
              false,
            )
          ) return false;
        }
        return true;
      case "IfStatement": {
        if (!validate_expr(statement.test, true)) return false;
        const before = yield_count;
        if (
          !validate_stmt(statement.consequent, in_loop, in_switch, true, false)
        ) {
          return false;
        }
        if (
          statement.alternate !== null &&
          !validate_stmt(statement.alternate, in_loop, in_switch, true, false)
        ) return false;
        if (yield_count > before || contains(statement, true)) {
          has_control_flow = true;
        }
        return true;
      }
      case "ForStatement": {
        if (
          statement.init !== null &&
          ((statement.init.type === "VariableDeclaration" &&
            statement.init.kind === "var") ||
            contains_yield_or_await(statement.init))
        ) return false;
        if (
          statement.update !== null && contains_yield_or_await(statement.update)
        ) {
          return false;
        }
        if (statement.test !== null && !validate_expr(statement.test, true)) {
          return false;
        }
        const before = yield_count;
        if (!validate_stmt(statement.body, true, in_switch, true, false)) {
          return false;
        }
        if (
          yield_count > before ||
          (statement.test !== null && contains_yield_or_await(statement.test))
        ) {
          has_control_flow = true;
          first_loop_node ??= statement;
        }
        return true;
      }
      case "WhileStatement": {
        if (!validate_expr(statement.test, true)) return false;
        const before = yield_count;
        if (!validate_stmt(statement.body, true, in_switch, true, false)) {
          return false;
        }
        if (yield_count > before || contains_yield_or_await(statement.test)) {
          has_control_flow = true;
          first_loop_node ??= statement;
        }
        return true;
      }
      case "DoWhileStatement": {
        if (contains_yield_or_await(statement.test)) return false;
        const before = yield_count;
        if (!validate_stmt(statement.body, true, in_switch, true, false)) {
          return false;
        }
        if (yield_count > before) {
          has_control_flow = true;
          first_loop_node ??= statement;
        }
        return true;
      }
      case "ForOfStatement": {
        if (
          statement.await ||
          (statement.left.type === "VariableDeclaration" &&
            statement.left.kind === "var") ||
          contains_yield_or_await(statement.left) ||
          contains_yield_or_await(statement.right)
        ) return false;
        // Preserve lazy iterable diagnostics for non-literal for...of iterables.
        if (
          contains(statement.body, true) &&
          !is_primitive_array_literal(statement.right)
        ) return false;
        const before = yield_count;
        if (!validate_stmt(statement.body, true, in_switch, true, false)) {
          return false;
        }
        if (yield_count > before) {
          has_control_flow = true;
          first_loop_node ??= statement;
        }
        return true;
      }
      case "ForInStatement": {
        if (
          (statement.left.type === "VariableDeclaration" &&
            statement.left.kind === "var") ||
          contains_yield_or_await(statement.left) ||
          contains_yield_or_await(statement.right)
        ) return false;
        const before = yield_count;
        if (!validate_stmt(statement.body, true, in_switch, true, false)) {
          return false;
        }
        if (yield_count > before) {
          has_control_flow = true;
          first_loop_node ??= statement;
        }
        return true;
      }
      case "SwitchStatement": {
        if (!validate_expr(statement.discriminant, true)) return false;
        const before = yield_count;
        for (const item of statement.cases) {
          if (item.test !== null && contains_yield_or_await(item.test)) {
            return false;
          }
          for (const inner of item.consequent) {
            if (
              !validate_stmt(inner as Statement, in_loop, true, true, false)
            ) {
              return false;
            }
          }
        }
        if (
          yield_count > before ||
          contains_yield_or_await(statement.discriminant)
        ) has_control_flow = true;
        return true;
      }
      default:
        return !contains(statement, true);
    }
  }

  for (let index = 0; index < body.body.length; index += 1) {
    if (
      !validate_stmt(
        body.body[index] as Statement,
        false,
        false,
        false,
        index === body.body.length - 1,
      )
    ) return undefined;
  }
  if (yield_count === 0) return undefined;
  if (
    !force_direct && !has_control_flow && !has_nested_yield &&
    yield_count === 1 && (!has_elision || spec.inferred) &&
    spec.explicit_left_type === undefined
  ) return undefined;

  // Phase 2: Emit lowered statements.
  const use_either_wrapper = mode === "either" &&
    (has_elided_fail || (has_control_flow && checked_yield_count > 0));
  const needs_either_err_var = use_either_wrapper && checked_yield_count > 0;
  const needs_dict = (mode === "maybe" &&
    (checked_yield_count > 0 || has_elided_fail || just_name === undefined)) ||
    (mode === "either" &&
      (use_either_wrapper || right_name === undefined ||
        (has_elided_fail && left_name === undefined))) ||
    (mode === "identity" && identity_name === undefined);
  const dictionary = needs_dict ? get_dict() : undefined;
  if (needs_dict && dictionary === undefined) return undefined;
  const either_err_var = needs_either_err_var
    ? state.services.fresh("either_err")
    : undefined;
  const checked_vars: IdentifierReference[] = [];

  const return_value_type_of = (target: IdentifierReference): TSType =>
    node({
      type: "TSTypeReference",
      typeName: id("ReturnType"),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from([
          node({
            type: "TSIndexedAccessType",
            objectType: node({
              type: "TSTypeQuery",
              exprName: target,
              typeArguments: null,
            }),
            indexType: node({
              type: "TSLiteralType",
              literal: node({
                type: "Literal",
                value: "value",
                raw: '"value"',
              }),
            }),
          }) as TSType,
        ]),
      }),
    });

  const make_typed_right_return = (value_expr: Expression): Statement[] => {
    if (spec.explicit_left_type !== undefined) {
      const out_var = state.services.fresh("either_out");
      const right_type: TSType = node({
        type: "TSTypeQuery",
        exprName: out_var,
        typeArguments: null,
      });
      const right_call = call(right_callee(), [out_var]);
      right_call.typeArguments = node({
        type: "TSTypeParameterInstantiation",
        params: Array.from([spec.explicit_left_type, right_type]),
      });
      return [variable("const", out_var, value_expr), ret(right_call)];
    }
    if (checked_vars.length === 0) {
      return [ret(call(right_callee(), [value_expr]))];
    }
    const out_var = state.services.fresh("either_out");
    const raw_types = checked_vars.map(return_value_type_of);
    const raw_union: TSType = raw_types.length === 1
      ? raw_types[0]
      : node({ type: "TSUnionType", types: raw_types });
    const left_tuple_type: TSType = node({
      type: "TSTypeOperator",
      operator: "readonly",
      typeAnnotation: node({
        type: "TSTupleType",
        elementTypes: [
          node({
            type: "TSLiteralType",
            literal: node({ type: "Literal", value: "Left", raw: '"Left"' }),
          }),
          node({ type: "TSUnknownKeyword" }),
        ],
      }),
    });
    const left_type: TSType = node({
      type: "TSIndexedAccessType",
      objectType: node({
        type: "TSTypeReference",
        typeName: id("Extract"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from([raw_union, left_tuple_type]),
        }),
      }),
      indexType: node({
        type: "TSLiteralType",
        literal: node({ type: "Literal", value: 1, raw: "1" }),
      }),
    });
    const right_type: TSType = node({
      type: "TSTypeQuery",
      exprName: out_var,
      typeArguments: null,
    });
    const right_call = call(right_callee(), [out_var]);
    right_call.typeArguments = node({
      type: "TSTypeParameterInstantiation",
      params: Array.from([left_type, right_type]),
    });
    return [variable("const", out_var, value_expr), ret(right_call)];
  };

  const make_as_const_tuple = (
    tag: string,
    value_expr: Expression,
  ): Expression =>
    node({
      type: "TSAsExpression",
      expression: node({
        type: "ArrayExpression",
        elements: [literal(tag), value_expr],
      }),
      typeAnnotation: type_ref("const"),
    });

  const emit_return_value = (value_expr: Expression): Statement[] => {
    if (mode === "maybe") return [ret(wrap_maybe(value_expr))];
    if (mode === "identity") return [ret(wrap_identity(value_expr))];
    if (use_either_wrapper) {
      return [ret(make_as_const_tuple("Right", value_expr))];
    }
    return make_typed_right_return(value_expr);
  };

  const emit_yield_value = (
    raw_arg: Expression,
    target_stmts: Statement[],
  ): Expression => {
    const arg = lower_expr(raw_arg, target_stmts);
    const elided = match_elided_yield(arg);
    if (elided !== undefined) {
      const wrap_ok_typed = (
        expr: Expression,
        ok_type: TSType | undefined,
      ): Expression => {
        if (ok_type === undefined) return expr;
        const ok_tmp = state.services.fresh(
          mode === "maybe"
            ? "maybe_ok"
            : mode === "either"
            ? "either_ok"
            : "id_ok",
        );
        target_stmts.push(typed_const(ok_tmp, expr, ok_type));
        return ok_tmp;
      };
      if (elided.kind === "ok") {
        return wrap_ok_typed(elided.expr, elided.ok_type);
      }
      if (elided.kind === "nullable") {
        const val = state.services.fresh("maybe_val");
        target_stmts.push(variable("const", val, elided.expr));
        target_stmts.push(
          node({
            type: "IfStatement",
            test: node({
              type: "LogicalExpression",
              operator: "||",
              left: node({
                type: "BinaryExpression",
                operator: "===",
                left: val,
                right: literal(null),
              }),
              right: node({
                type: "BinaryExpression",
                operator: "===",
                left: val,
                right: void_zero(),
              }),
            }),
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: method(dictionary!, "empty", []),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
        );
        return val;
      }
      // elided.kind === "cond"
      if (mode === "maybe") {
        target_stmts.push(
          node({
            type: "IfStatement",
            test: negate_cond(elided.test),
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: method(dictionary!, "empty", []),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
        );
        return wrap_ok_typed(elided.ok_expr, elided.ok_type);
      }
      // mode === "either" (use_either_wrapper is guaranteed true)
      const fail_stmts: Statement[] = [];
      let err_expr = elided.err_expr!;
      if (elided.err_type !== undefined) {
        const err_tmp = state.services.fresh("either_left");
        fail_stmts.push(typed_const(err_tmp, err_expr, elided.err_type));
        err_expr = err_tmp;
      }
      fail_stmts.push(ret(make_as_const_tuple("Left", err_expr)));
      target_stmts.push(
        node({
          type: "IfStatement",
          test: negate_cond(elided.test),
          consequent: fail_stmts.length === 1
            ? fail_stmts[0]
            : block(fail_stmts),
          alternate: null,
        }),
      );
      return wrap_ok_typed(elided.ok_expr, elided.ok_type);
    }
    if (mode === "identity") {
      return method(arg, "value", []);
    }
    if (mode === "maybe") {
      const raw = state.services.fresh("maybe_raw");
      target_stmts.push(variable("const", raw, method(arg, "value", [])));
      target_stmts.push(
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: "===",
            left: node({
              type: "MemberExpression",
              object: raw,
              property: literal(0),
              computed: true,
              optional: false,
            }),
            right: literal("Nothing"),
          }),
          consequent: ret(
            node({
              type: "TSAsExpression",
              expression: method(dictionary!, "empty", []),
              typeAnnotation: node({ type: "TSNeverKeyword" }),
            }),
          ),
          alternate: null,
        }),
      );
      return node({
        type: "MemberExpression",
        object: raw,
        property: literal(1),
        computed: true,
        optional: false,
      });
    }
    // mode === "either"
    const val = state.services.fresh("either_val");
    const raw = state.services.fresh("either_raw");
    if (!use_either_wrapper) checked_vars.push(val);
    target_stmts.push(variable("const", val, arg));
    target_stmts.push(variable("const", raw, method(val, "value", [])));
    const left_test = node({
      type: "BinaryExpression",
      operator: "===",
      left: node({
        type: "MemberExpression",
        object: raw,
        property: literal(0),
        computed: true,
        optional: false,
      }),
      right: literal("Left"),
    });
    if (use_either_wrapper) {
      target_stmts.push(
        node({
          type: "IfStatement",
          test: left_test,
          consequent: block([
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: either_err_var!,
                right: val,
              }),
            }),
            ret(raw),
          ]),
          alternate: null,
        }),
      );
    } else {
      target_stmts.push(
        node({
          type: "IfStatement",
          test: left_test,
          consequent: ret(
            node({
              type: "TSAsExpression",
              expression: val,
              typeAnnotation: node({ type: "TSNeverKeyword" }),
            }),
          ),
          alternate: null,
        }),
      );
    }
    return node({
      type: "MemberExpression",
      object: raw,
      property: literal(1),
      computed: true,
      optional: false,
    });
  };

  function lower_ordered_list<T extends Expression | null>(
    items: readonly T[],
    target_stmts: Statement[],
  ): T[] {
    let last_yield = -1;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item !== null && contains_yield_or_await(item)) last_yield = index;
    }
    if (last_yield < 0) return [...items];
    const out: T[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === null) {
        out.push(item);
        continue;
      }
      if (index < last_yield) {
        if (contains_yield_or_await(item)) {
          const lowered = lower_expr(item, target_stmts);
          const tmp = state.services.fresh("arg");
          target_stmts.push(variable("const", tmp, lowered));
          out.push(tmp as T);
        } else if (!is_trivial_pure_expr(item)) {
          const tmp = state.services.fresh("arg");
          target_stmts.push(variable("const", tmp, item));
          out.push(tmp as T);
        } else {
          out.push(item);
        }
      } else if (index === last_yield) {
        out.push(lower_expr(item, target_stmts) as T);
      } else {
        out.push(item);
      }
    }
    return out;
  }

  function lower_expr(
    expression: Expression,
    target_stmts: Statement[],
  ): Expression {
    if (!contains_yield_or_await(expression)) return expression;
    if (expression.type === "ParenthesizedExpression") {
      return lower_expr(expression.expression, target_stmts);
    }
    if (
      expression.type === "YieldExpression" && expression.delegate &&
      expression.argument !== null
    ) {
      return emit_yield_value(expression.argument, target_stmts);
    }
    switch (expression.type) {
      case "BinaryExpression": {
        if (expression.left.type === "PrivateIdentifier") {
          return {
            ...expression,
            right: lower_expr(expression.right, target_stmts),
          };
        }
        const [left, right] = lower_ordered_list(
          [expression.left, expression.right],
          target_stmts,
        );
        return { ...expression, left: left!, right: right! };
      }
      case "UnaryExpression":
        return {
          ...expression,
          argument: lower_expr(expression.argument, target_stmts),
        };
      case "SequenceExpression":
        return {
          ...expression,
          expressions: lower_ordered_list(expression.expressions, target_stmts),
        };
      case "TemplateLiteral":
        return {
          ...expression,
          expressions: lower_ordered_list(expression.expressions, target_stmts),
        };
      case "ArrayExpression": {
        let last_yield = -1;
        for (let i = 0; i < expression.elements.length; i += 1) {
          const el = expression.elements[i];
          if (el !== null && contains_yield_or_await(el)) last_yield = i;
        }
        const elements = expression.elements.map((el, i) => {
          if (el === null || i > last_yield) return el;
          if (el.type === "SpreadElement") {
            const lowered = lower_expr(el.argument, target_stmts);
            if (i < last_yield && !is_trivial_pure_expr(lowered)) {
              const tmp = state.services.fresh("arg");
              target_stmts.push(variable("const", tmp, lowered));
              return { ...el, argument: tmp };
            }
            return { ...el, argument: lowered };
          }
          const lowered = lower_expr(el, target_stmts);
          if (i < last_yield && !is_trivial_pure_expr(lowered)) {
            const tmp = state.services.fresh("arg");
            target_stmts.push(variable("const", tmp, lowered));
            return tmp;
          }
          return lowered;
        });
        return { ...expression, elements };
      }
      case "ObjectExpression": {
        let last_yield = -1;
        for (let i = 0; i < expression.properties.length; i += 1) {
          if (contains_yield_or_await(expression.properties[i])) last_yield = i;
        }
        const properties = expression.properties.map((prop, i) => {
          if (i > last_yield) return prop;
          if (prop.type === "SpreadElement") {
            const lowered = lower_expr(prop.argument, target_stmts);
            if (i < last_yield && !is_trivial_pure_expr(lowered)) {
              const tmp = state.services.fresh("arg");
              target_stmts.push(variable("const", tmp, lowered));
              return { ...prop, argument: tmp };
            }
            return { ...prop, argument: lowered };
          }
          let key = prop.key;
          if (prop.computed) {
            const lk = lower_expr(prop.key as Expression, target_stmts);
            if (
              contains_yield_or_await(prop.value) ||
              (i < last_yield && !is_trivial_pure_expr(lk))
            ) {
              const tmp = state.services.fresh("key");
              target_stmts.push(variable("const", tmp, lk));
              key = tmp;
            } else {
              key = lk;
            }
          }
          const lv = lower_expr(prop.value as Expression, target_stmts);
          if (i < last_yield && !is_trivial_pure_expr(lv)) {
            const tmp = state.services.fresh("val");
            target_stmts.push(variable("const", tmp, lv));
            return { ...prop, key, value: tmp, shorthand: false };
          }
          return { ...prop, key, value: lv, shorthand: false };
        });
        return { ...expression, properties };
      }
      case "MemberExpression": {
        if (!expression.computed) {
          return {
            ...expression,
            object: lower_expr(expression.object, target_stmts),
          };
        }
        const [object, property] = lower_ordered_list(
          [expression.object, expression.property as Expression],
          target_stmts,
        );
        return { ...expression, object, property };
      }
      case "CallExpression":
      case "NewExpression": {
        const callee_has = contains_yield_or_await(expression.callee);
        let last_arg = -1;
        for (let i = 0; i < expression.arguments.length; i += 1) {
          if (contains_yield_or_await(expression.arguments[i])) last_arg = i;
        }
        let callee = expression.callee;
        if (last_arg >= 0) {
          if (
            expression.type === "CallExpression" &&
            callee.type === "MemberExpression" && !callee.optional
          ) {
            const obj = lower_expr(callee.object, target_stmts);
            const obj_tmp = state.services.fresh("recv");
            target_stmts.push(variable("const", obj_tmp, obj));
            if (callee.computed) {
              const lp = lower_expr(
                callee.property as Expression,
                target_stmts,
              );
              const prop_tmp = state.services.fresh("prop");
              target_stmts.push(variable("const", prop_tmp, lp));
              callee = { ...callee, object: obj_tmp, property: prop_tmp };
            } else {
              callee = { ...callee, object: obj_tmp };
            }
          } else if (
            callee_has || !is_trivial_pure_expr(callee as Expression)
          ) {
            const lc = lower_expr(callee as Expression, target_stmts);
            const tmp = state.services.fresh("callee");
            target_stmts.push(variable("const", tmp, lc));
            callee = tmp;
          }
        } else {
          callee = lower_expr(callee as Expression, target_stmts);
        }
        const args = expression.arguments.map((arg, i) => {
          if (i > last_arg) return arg;
          if (arg.type === "SpreadElement") {
            const la = lower_expr(arg.argument, target_stmts);
            if (i < last_arg && !is_trivial_pure_expr(la)) {
              const tmp = state.services.fresh("arg");
              target_stmts.push(variable("const", tmp, la));
              return { ...arg, argument: tmp };
            }
            return { ...arg, argument: la };
          }
          const la = lower_expr(arg, target_stmts);
          if (i < last_arg && !is_trivial_pure_expr(la)) {
            const tmp = state.services.fresh("arg");
            target_stmts.push(variable("const", tmp, la));
            return tmp;
          }
          return la;
        });
        return { ...expression, callee, arguments: args };
      }
      case "AssignmentExpression":
        return {
          ...expression,
          right: lower_expr(expression.right, target_stmts),
        };
      case "ConditionalExpression": {
        const test = lower_expr(expression.test, target_stmts);
        if (
          !contains_yield_or_await(expression.consequent) &&
          !contains_yield_or_await(expression.alternate)
        ) return { ...expression, test };
        const out = state.services.fresh("cond");
        const cons_stmts: Statement[] = [];
        const cons_val = lower_expr(expression.consequent, cons_stmts);
        cons_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "=",
              left: out,
              right: cons_val,
            }),
          }),
        );
        const alt_stmts: Statement[] = [];
        const alt_val = lower_expr(expression.alternate, alt_stmts);
        alt_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "=",
              left: out,
              right: alt_val,
            }),
          }),
        );
        target_stmts.push(
          node({
            type: "VariableDeclaration",
            kind: "let",
            declarations: [
              node({ type: "VariableDeclarator", id: out, init: null }),
            ],
          }),
        );
        target_stmts.push(
          node({
            type: "IfStatement",
            test,
            consequent: block(cons_stmts),
            alternate: block(alt_stmts),
          }),
        );
        return out;
      }
      case "LogicalExpression": {
        const left = lower_expr(expression.left, target_stmts);
        if (!contains_yield_or_await(expression.right)) {
          return { ...expression, left };
        }
        const out = state.services.fresh("logic");
        target_stmts.push(variable("let", out, left));
        const right_stmts: Statement[] = [];
        const right_val = lower_expr(expression.right, right_stmts);
        right_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "=",
              left: out,
              right: right_val,
            }),
          }),
        );
        const guard: Expression = expression.operator === "&&"
          ? out
          : expression.operator === "||"
          ? node({
            type: "UnaryExpression",
            operator: "!",
            prefix: true,
            argument: out,
          })
          : node({
            type: "BinaryExpression",
            operator: "==",
            left: out,
            right: literal(null),
          });
        target_stmts.push(
          node({
            type: "IfStatement",
            test: guard,
            consequent: block(right_stmts),
            alternate: null,
          }),
        );
        return out;
      }
      case "TSAsExpression":
      case "TSTypeAssertion":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
        return {
          ...expression,
          expression: lower_expr(expression.expression, target_stmts),
        };
      default:
        return expression;
    }
  }

  function lower_stmt(statement: Statement): Statement[] {
    if (
      statement.type === "ExpressionStatement" && "directive" in statement &&
      statement.directive != null
    ) return [statement];
    switch (statement.type) {
      case "VariableDeclaration": {
        if (statement.declarations.length === 1) {
          const decl = statement.declarations[0];
          const init = decl.init;
          if (yield_star(init)) {
            const stmts: Statement[] = [];
            const val = emit_yield_value(init.argument, stmts);
            stmts.push({
              ...statement,
              declarations: [{ ...decl, init: val }],
            });
            return stmts;
          }
        }
        const stmts: Statement[] = [];
        const declarations = statement.declarations.map((decl) =>
          decl.init !== null && contains_yield_or_await(decl.init)
            ? { ...decl, init: lower_expr(decl.init, stmts) }
            : decl
        );
        stmts.push({ ...statement, declarations });
        return stmts;
      }
      case "ExpressionStatement": {
        if (yield_star(statement.expression)) {
          const stmts: Statement[] = [];
          const elided = match_elided_yield(statement.expression.argument);
          const val = emit_yield_value(statement.expression.argument, stmts);
          if (elided !== undefined && elided.kind !== "nullable") {
            stmts.push(node({ type: "ExpressionStatement", expression: val }));
          }
          return stmts;
        }
        if (!contains_yield_or_await(statement.expression)) return [statement];
        const stmts: Statement[] = [];
        const expr_out = lower_expr(statement.expression, stmts);
        stmts.push({ ...statement, expression: expr_out });
        return stmts;
      }
      case "ReturnStatement": {
        if (statement.argument !== null && yield_star(statement.argument)) {
          const stmts: Statement[] = [];
          if (mode === "maybe" || mode === "identity") {
            const arg = lower_expr(statement.argument.argument, stmts);
            stmts.push(ret(arg));
            return stmts;
          }
          if (!use_either_wrapper && checked_vars.length === 0) {
            const arg = lower_expr(statement.argument.argument, stmts);
            stmts.push(ret(arg));
            return stmts;
          }
          const val = emit_yield_value(statement.argument.argument, stmts);
          stmts.push(...emit_return_value(val));
          return stmts;
        }
        const stmts: Statement[] = [];
        const arg = statement.argument !== null
          ? lower_expr(statement.argument, stmts)
          : void_zero();
        stmts.push(...emit_return_value(arg));
        return stmts;
      }
      case "BlockStatement":
        return [block(lower_list(statement.body as Statement[]))];
      case "IfStatement": {
        const stmts: Statement[] = [];
        const test = lower_expr(statement.test, stmts);
        const consequent = lower_single(statement.consequent);
        const alternate = statement.alternate !== null
          ? lower_single(statement.alternate)
          : null;
        stmts.push({ ...statement, test, consequent, alternate });
        return stmts;
      }
      case "ForStatement": {
        const lowered_body = lower_single(statement.body);
        if (
          statement.test !== null && contains_yield_or_await(statement.test)
        ) {
          const test_stmts: Statement[] = [];
          const test_val = lower_expr(statement.test, test_stmts);
          test_stmts.push(
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: test_val,
              }),
              consequent: node({ type: "BreakStatement", label: null }),
              alternate: null,
            }),
          );
          const body_stmts = lowered_body.type === "BlockStatement"
            ? lowered_body.body
            : [lowered_body];
          return [{
            ...statement,
            test: null,
            body: block([...test_stmts, ...(body_stmts as Statement[])]),
          }];
        }
        return [{ ...statement, body: lowered_body }];
      }
      case "WhileStatement": {
        const lowered_body = lower_single(statement.body);
        if (contains_yield_or_await(statement.test)) {
          const test_stmts: Statement[] = [];
          const test_val = lower_expr(statement.test, test_stmts);
          test_stmts.push(
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: test_val,
              }),
              consequent: node({ type: "BreakStatement", label: null }),
              alternate: null,
            }),
          );
          const body_stmts = lowered_body.type === "BlockStatement"
            ? lowered_body.body
            : [lowered_body];
          return [{
            ...statement,
            test: literal(true),
            body: block([...test_stmts, ...(body_stmts as Statement[])]),
          }];
        }
        return [{ ...statement, body: lowered_body }];
      }
      case "DoWhileStatement":
      case "ForOfStatement":
      case "ForInStatement":
        return [{ ...statement, body: lower_single(statement.body) }];
      case "SwitchStatement": {
        const stmts: Statement[] = [];
        const discriminant = lower_expr(statement.discriminant, stmts);
        const cases = statement.cases.map((item) => ({
          ...item,
          consequent: lower_list(item.consequent as Statement[]),
        }));
        stmts.push({ ...statement, discriminant, cases });
        return stmts;
      }
      default:
        return [statement];
    }
  }
  function lower_list(list: readonly Statement[]): Statement[] {
    const out: Statement[] = [];
    for (const item of list) out.push(...lower_stmt(item));
    return out;
  }
  function lower_single(statement: Statement): Statement {
    const list = lower_stmt(statement);
    return list.length === 1 ? list[0] : block(list);
  }

  const emitted = lower_list(body.body as Statement[]);
  const last = emitted[emitted.length - 1];
  if (last?.type !== "ReturnStatement") {
    emitted.push(...emit_return_value(void_zero()));
  }

  if (first_loop_node !== undefined) {
    state.services.report(
      first_loop_node,
      "loop",
      "transformed",
      "Lowered single-shot monad loop directly into native control flow.",
    );
  }

  if (use_either_wrapper) {
    const out_raw = state.services.fresh("either_out");
    const out_raw_query: TSType = node({
      type: "TSTypeQuery",
      exprName: out_raw,
      typeArguments: null,
    });
    const raw_param: TSType = spec.explicit_left_type !== undefined
      ? node({
        type: "TSUnionType",
        types: [
          node({
            type: "TSTypeOperator",
            operator: "readonly",
            typeAnnotation: node({
              type: "TSTupleType",
              elementTypes: [
                node({
                  type: "TSLiteralType",
                  literal: node({
                    type: "Literal",
                    value: "Left",
                    raw: '"Left"',
                  }),
                }),
                spec.explicit_left_type,
              ],
            }),
          }),
          out_raw_query,
        ],
      })
      : out_raw_query;
    const either_type: TSType = type_ref("ReturnType", [
      node({
        type: "TSTypeQuery",
        exprName: dictionary!,
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from([raw_param]),
        }),
      }) as TSType,
    ]);
    const left_expr: Expression = call(left_callee(), [
      node({
        type: "MemberExpression",
        object: out_raw,
        property: literal(1),
        computed: true,
        optional: false,
      }),
    ]);
    const left_result: Expression = needs_either_err_var
      ? (has_elided_fail
        ? node({
          type: "ConditionalExpression",
          test: node({
            type: "BinaryExpression",
            operator: "!==",
            left: either_err_var!,
            right: void_zero(),
          }),
          consequent: either_err_var!,
          alternate: left_expr,
        })
        : either_err_var!)
      : left_expr;
    const final_expr: Expression = node({
      type: "TSAsExpression",
      expression: node({
        type: "ConditionalExpression",
        test: node({
          type: "BinaryExpression",
          operator: "===",
          left: node({
            type: "MemberExpression",
            object: out_raw,
            property: literal(0),
            computed: true,
            optional: false,
          }),
          right: literal("Left"),
        }),
        consequent: left_result,
        alternate: call(right_callee(), [
          node({
            type: "MemberExpression",
            object: out_raw,
            property: literal(1),
            computed: true,
            optional: false,
          }),
        ]),
      }),
      typeAnnotation: either_type,
    });
    const wrapper_stmts: Statement[] = [];
    if (needs_either_err_var) {
      wrapper_stmts.push(
        node({
          type: "VariableDeclaration",
          kind: "let",
          declarations: [
            node({
              type: "VariableDeclarator",
              id: {
                ...either_err_var!,
                typeAnnotation: node({
                  type: "TSTypeAnnotation",
                  typeAnnotation: node({ type: "TSUnknownKeyword" }),
                }),
              },
              init: null,
            }),
          ],
        }),
      );
    }
    wrapper_stmts.push(
      variable("const", out_raw, call(arrow([], block(emitted)), [])),
      ret(final_expr),
    );
    return {
      block: block(wrapper_stmts),
      yielded: true,
    };
  }

  return { block: block(emitted), yielded: true };
}

function direct_array_dictionary(
  explicit: Expression | undefined,
  first_yield: YieldExpression | undefined,
  services: TransformServices,
): IdentifierReference | undefined {
  const ctors = services.imports.array_constructors;
  if (ctors === undefined || ctors.size === 0) return undefined;
  if (explicit !== undefined) {
    return explicit.type === "Identifier" && ctors.has(explicit.name) &&
        services.bindings.imported(explicit)
      ? explicit
      : undefined;
  }
  if (!first_yield?.delegate || first_yield.argument === null) return undefined;
  const arg = unwrap(first_yield.argument);
  if (arg.type !== "CallExpression" || arg.optional) return undefined;
  if (
    arg.callee.type === "Identifier" && ctors.has(arg.callee.name) &&
    services.bindings.imported(arg.callee)
  ) {
    return arg.callee;
  }
  if (
    arg.callee.type === "MemberExpression" && !arg.callee.computed &&
    !arg.callee.optional && arg.callee.object.type === "Identifier" &&
    ctors.has(arg.callee.object.name) &&
    services.bindings.imported(arg.callee.object) &&
    arg.callee.property.type === "Identifier" &&
    (arg.callee.property.name === "empty" ||
      arg.callee.property.name === "pure")
  ) {
    return arg.callee.object;
  }
  return undefined;
}

function direct_array_comprehension(
  body: BlockStatement | FunctionBody,
  array_dict: IdentifierReference,
  services: TransformServices,
): Result | undefined {
  if (body.body.length >= 128) return undefined;
  const ctors = services.imports.array_constructors;
  if (ctors === undefined || ctors.size === 0) return undefined;

  type ArrayLiteralMatch =
    | { readonly kind: "empty" }
    | { readonly kind: "elements"; readonly elements: readonly Expression[] };

  const match_array_literal = (
    expression: Expression,
  ): ArrayLiteralMatch | undefined => {
    const inner = unwrap(expression);
    if (inner.type !== "CallExpression" || inner.optional) return undefined;
    if (
      inner.callee.type === "Identifier" && ctors.has(inner.callee.name) &&
      inner.typeArguments == null && inner.arguments.length === 1 &&
      inner.arguments[0].type !== "SpreadElement"
    ) {
      const arg = unwrap(inner.arguments[0] as Expression);
      if (
        arg.type === "ArrayExpression" &&
        arg.elements.every((el) => el !== null && el.type !== "SpreadElement")
      ) {
        if (arg.elements.length === 0) return { kind: "empty" };
        return { kind: "elements", elements: arg.elements as Expression[] };
      }
    }
    if (
      inner.callee.type === "MemberExpression" && !inner.callee.computed &&
      !inner.callee.optional && inner.callee.object.type === "Identifier" &&
      ctors.has(inner.callee.object.name) &&
      inner.callee.property.type === "Identifier"
    ) {
      if (
        inner.callee.property.name === "empty" && inner.arguments.length === 0
      ) {
        return { kind: "empty" };
      }
      if (
        inner.callee.property.name === "pure" && inner.typeArguments == null &&
        inner.arguments.length === 1 &&
        inner.arguments[0].type !== "SpreadElement"
      ) {
        return {
          kind: "elements",
          elements: [inner.arguments[0] as Expression],
        };
      }
    }
    return undefined;
  };

  const always_terminates = (list: readonly Statement[]): boolean => {
    for (let i = 0; i < list.length; i += 1) {
      const stmt = list[i];
      if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") {
        return true;
      }
      if (
        stmt.type === "BlockStatement" &&
        always_terminates(stmt.body as Statement[])
      ) return true;
      if (
        stmt.type === "IfStatement" && stmt.alternate !== null &&
        always_terminates(body_of(stmt.consequent)) &&
        always_terminates(body_of(stmt.alternate))
      ) return true;
    }
    return false;
  };

  const out_id = services.fresh("array_out");
  let yield_count = 0;
  let push_count = 0;
  let branch_copies = 0;
  let aborted = false;

  const emit_list = (list: readonly Statement[]): Statement[] => {
    if (aborted) return [];
    const emitted: Statement[] = [];
    for (let index = 0; index < list.length; index += 1) {
      if (aborted) return [];
      const stmt = list[index];
      if (
        stmt.type === "ExpressionStatement" && "directive" in stmt &&
        stmt.directive != null
      ) {
        emitted.push(stmt);
        continue;
      }
      const yielded = read_yield(stmt);
      if (yielded !== undefined) {
        if (contains_yield_or_await(yielded.expression)) {
          aborted = true;
          return [];
        }
        yield_count += 1;
        const lit = match_array_literal(yielded.expression);
        if (yielded.terminal) {
          if (lit?.kind === "empty") return emitted;
          if (lit?.kind === "elements") {
            push_count += lit.elements.length;
            emitted.push(
              node({
                type: "ExpressionStatement",
                expression: call(member(out_id, "push"), [...lit.elements]),
              }),
            );
            return emitted;
          }
          push_count += 1;
          const raw_id = services.fresh("array_raw");
          const idx_id = services.fresh("array_i");
          emitted.push(
            variable("const", raw_id, method(yielded.expression, "value", [])),
          );
          emitted.push(
            node({
              type: "ForStatement",
              init: variable("let", idx_id, literal(0)),
              test: binary("<", idx_id, member(raw_id, "length")),
              update: node({
                type: "AssignmentExpression",
                operator: "+=",
                left: idx_id,
                right: literal(1),
              }),
              body: block([
                node({
                  type: "ExpressionStatement",
                  expression: call(member(out_id, "push"), [
                    node({
                      type: "MemberExpression",
                      object: raw_id,
                      property: idx_id,
                      computed: true,
                      optional: false,
                    }),
                  ]),
                }),
              ]),
            }),
          );
          return emitted;
        }
        const rest = list.slice(index + 1);
        if (lit?.kind === "empty") return emitted;
        if (lit?.kind === "elements" && lit.elements.length === 1) {
          if (yielded.name !== undefined) {
            const decl_kind = stmt.type === "VariableDeclaration" &&
                stmt.kind === "let"
              ? "let"
              : "const";
            emitted.push(variable(decl_kind, yielded.name, lit.elements[0]));
          } else if (!is_trivial_pure_expr(lit.elements[0])) {
            emitted.push(
              node({
                type: "ExpressionStatement",
                expression: lit.elements[0],
              }),
            );
          }
          emitted.push(...emit_list(rest));
          return emitted;
        }
        const raw_id = services.fresh("array_raw");
        const idx_id = services.fresh("array_i");
        const raw_init: Expression = lit?.kind === "elements"
          ? node({ type: "ArrayExpression", elements: [...lit.elements] })
          : method(yielded.expression, "value", []);
        emitted.push(variable("const", raw_id, raw_init));
        const loop_body: Statement[] = [];
        if (yielded.name !== undefined) {
          const decl_kind = stmt.type === "VariableDeclaration" &&
              stmt.kind === "let"
            ? "let"
            : "const";
          loop_body.push(
            variable(
              decl_kind,
              yielded.name,
              node({
                type: "MemberExpression",
                object: raw_id,
                property: idx_id,
                computed: true,
                optional: false,
              }),
            ),
          );
        }
        loop_body.push(...emit_list(rest));
        emitted.push(
          node({
            type: "ForStatement",
            init: variable("let", idx_id, literal(0)),
            test: binary("<", idx_id, member(raw_id, "length")),
            update: node({
              type: "AssignmentExpression",
              operator: "+=",
              left: idx_id,
              right: literal(1),
            }),
            body: block(loop_body),
          }),
        );
        return emitted;
      }
      if (stmt.type === "ReturnStatement") {
        if (stmt.argument !== null && contains_yield_or_await(stmt.argument)) {
          aborted = true;
          return [];
        }
        push_count += 1;
        emitted.push(
          node({
            type: "ExpressionStatement",
            expression: call(member(out_id, "push"), [
              stmt.argument ?? void_zero(),
            ]),
          }),
        );
        return emitted;
      }
      if (stmt.type === "ThrowStatement") {
        if (contains_yield_or_await(stmt.argument)) {
          aborted = true;
          return [];
        }
        emitted.push(stmt);
        return emitted;
      }
      if (stmt.type === "IfStatement") {
        if (contains_yield_or_await(stmt.test)) {
          aborted = true;
          return [];
        }
        if (!contains(stmt, true)) {
          emitted.push(stmt);
          continue;
        }
        const rest = list.slice(index + 1);
        const cons_list = body_of(stmt.consequent);
        const cons_term = always_terminates(cons_list);
        if (stmt.alternate === null) {
          if (cons_term) {
            const cons_emitted = emit_list(cons_list);
            const rem_emitted = emit_list(rest);
            if (cons_emitted.length === 0) {
              if (rem_emitted.length > 0) {
                emitted.push(
                  node({
                    type: "IfStatement",
                    test: node({
                      type: "UnaryExpression",
                      operator: "!",
                      prefix: true,
                      argument: stmt.test,
                    }),
                    consequent: block(rem_emitted),
                    alternate: null,
                  }),
                );
              } else if (!is_trivial_pure_expr(stmt.test)) {
                emitted.push(
                  node({ type: "ExpressionStatement", expression: stmt.test }),
                );
              }
            } else {
              emitted.push(
                node({
                  type: "IfStatement",
                  test: stmt.test,
                  consequent: block(cons_emitted),
                  alternate: rem_emitted.length > 0 ? block(rem_emitted) : null,
                }),
              );
            }
            return emitted;
          }
          if (rest.length > 0 && (branch_copies += 1) > 4) {
            aborted = true;
            return [];
          }
          const yes = emit_list([...cons_list, ...rest]);
          const no = emit_list(rest);
          emitted.push(
            node({
              type: "IfStatement",
              test: stmt.test,
              consequent: block(yes),
              alternate: no.length > 0 ? block(no) : null,
            }),
          );
          return emitted;
        }
        const alt_list = body_of(stmt.alternate);
        const alt_term = always_terminates(alt_list);
        if (
          !cons_term && !alt_term && rest.length > 0 && (branch_copies += 1) > 4
        ) {
          aborted = true;
          return [];
        }
        const yes = emit_list(cons_term ? cons_list : [...cons_list, ...rest]);
        const no = emit_list(alt_term ? alt_list : [...alt_list, ...rest]);
        if (yes.length === 0 && no.length > 0) {
          emitted.push(
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: stmt.test,
              }),
              consequent: block(no),
              alternate: null,
            }),
          );
        } else {
          emitted.push(
            node({
              type: "IfStatement",
              test: stmt.test,
              consequent: block(yes),
              alternate: no.length > 0 ? block(no) : null,
            }),
          );
        }
        return emitted;
      }
      if (contains(stmt, true)) {
        aborted = true;
        return [];
      }
      emitted.push(stmt);
    }
    push_count += 1;
    emitted.push(
      node({
        type: "ExpressionStatement",
        expression: call(member(out_id, "push"), [void_zero()]),
      }),
    );
    return emitted;
  };

  const lowered = emit_list(body.body as Statement[]);
  if (aborted || yield_count === 0 || push_count === 0) return undefined;
  return {
    block: block([
      variable(
        "const",
        out_id,
        node({ type: "ArrayExpression", elements: Array.from<Expression>([]) }),
      ),
      ...lowered,
      ret(call(array_dict, [out_id])),
    ]),
    yielded: true,
  };
}

function direct_list_dictionary(
  explicit: Expression | undefined,
  first_yield: YieldExpression | undefined,
  services: TransformServices,
): IdentifierReference | undefined {
  const ctors = services.imports.list_constructors;
  const from_arrays = services.imports.list_from_array_functions;
  const list_ns = services.imports.list_namespaces;
  const has_ctors = ctors !== undefined && ctors.size > 0;
  const has_from_array = from_arrays !== undefined && from_arrays.size > 0;
  const has_list_ns = list_ns !== undefined && list_ns.size > 0;
  if (!has_ctors && !has_from_array && !has_list_ns) return undefined;
  if (explicit !== undefined) {
    return has_ctors && explicit.type === "Identifier" &&
        ctors.has(explicit.name) && services.bindings.imported(explicit)
      ? explicit
      : undefined;
  }
  if (!first_yield?.delegate || first_yield.argument === null) return undefined;
  const arg = unwrap(first_yield.argument);
  if (arg.type !== "CallExpression" || arg.optional) return undefined;
  if (
    arg.callee.type === "Identifier" && services.bindings.imported(arg.callee)
  ) {
    if (has_ctors && ctors.has(arg.callee.name)) return arg.callee;
    if (has_from_array && from_arrays.has(arg.callee.name)) return arg.callee;
    if (
      has_ctors &&
      (services.imports.nil_constructors?.has(arg.callee.name) ||
        services.imports.cons_constructors?.has(arg.callee.name))
    ) {
      const existing = first_unshadowed(ctors, services);
      return existing !== undefined ? id(existing) : arg.callee;
    }
  }
  if (
    arg.callee.type === "MemberExpression" && !arg.callee.computed &&
    !arg.callee.optional && arg.callee.object.type === "Identifier" &&
    arg.callee.property.type === "Identifier" &&
    services.bindings.imported(arg.callee.object)
  ) {
    if (
      has_ctors && ctors.has(arg.callee.object.name) &&
      (arg.callee.property.name === "empty" ||
        arg.callee.property.name === "pure" ||
        arg.callee.property.name === "Nil" ||
        arg.callee.property.name === "Cons")
    ) {
      return arg.callee.object;
    }
    if (
      has_list_ns && list_ns.has(arg.callee.object.name) &&
      arg.callee.property.name === "from_array"
    ) {
      return arg.callee.object;
    }
  }
  return undefined;
}

function direct_list_comprehension(
  body: BlockStatement | FunctionBody,
  list_dict: IdentifierReference,
  services: TransformServices,
): Result | undefined {
  if (body.body.length >= 128) return undefined;
  const ctors = services.imports.list_constructors;
  const from_arrays = services.imports.list_from_array_functions;
  const list_ns = services.imports.list_namespaces;
  const existing_from_array = first_unshadowed(from_arrays, services);
  const from_array_id: IdentifierReference | undefined =
    existing_from_array !== undefined
      ? id(existing_from_array)
      : services.import_from_module?.(
        list_dict.name,
        "list",
        "from_array",
      );
  if (from_array_id === undefined) return undefined;

  const unwrap_list_from_array = (
    expression: Expression,
  ): Expression | undefined => {
    const inner = unwrap(expression);
    if (
      inner.type !== "CallExpression" || inner.optional ||
      inner.typeArguments != null || inner.arguments.length !== 1 ||
      inner.arguments[0].type === "SpreadElement"
    ) return undefined;
    const callee = unwrap(inner.callee);
    if (
      callee.type === "Identifier" &&
      from_arrays?.has(callee.name) && services.bindings.imported(callee)
    ) return inner.arguments[0] as Expression;
    if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "from_array" &&
      list_ns?.has(callee.object.name) &&
      services.bindings.imported(callee.object)
    ) return inner.arguments[0] as Expression;
    return undefined;
  };

  type ListLiteralMatch =
    | { readonly kind: "empty" }
    | { readonly kind: "single"; readonly element: Expression };

  const match_list_literal = (
    expression: Expression,
  ): ListLiteralMatch | undefined => {
    const inner = unwrap(expression);
    if (inner.type !== "CallExpression" || inner.optional) return undefined;
    if (
      inner.callee.type === "Identifier" &&
      services.imports.nil_constructors?.has(inner.callee.name) &&
      inner.arguments.length === 0
    ) return { kind: "empty" };
    if (
      ctors !== undefined &&
      inner.callee.type === "MemberExpression" && !inner.callee.computed &&
      !inner.callee.optional && inner.callee.object.type === "Identifier" &&
      ctors.has(inner.callee.object.name) &&
      inner.callee.property.type === "Identifier"
    ) {
      if (
        (inner.callee.property.name === "empty" ||
          inner.callee.property.name === "Nil") &&
        inner.arguments.length === 0
      ) return { kind: "empty" };
      if (
        inner.callee.property.name === "pure" && inner.typeArguments == null &&
        inner.arguments.length === 1 &&
        inner.arguments[0].type !== "SpreadElement"
      ) return { kind: "single", element: inner.arguments[0] as Expression };
    }
    return undefined;
  };

  const always_terminates = (list: readonly Statement[]): boolean => {
    for (let i = 0; i < list.length; i += 1) {
      const stmt = list[i];
      if (stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement") {
        return true;
      }
      if (
        stmt.type === "BlockStatement" &&
        always_terminates(stmt.body as Statement[])
      ) return true;
      if (
        stmt.type === "IfStatement" && stmt.alternate !== null &&
        always_terminates(body_of(stmt.consequent)) &&
        always_terminates(body_of(stmt.alternate))
      ) return true;
    }
    return false;
  };

  const out_id = services.fresh("list_out");
  let yield_count = 0;
  let push_count = 0;
  let branch_copies = 0;
  let aborted = false;

  const cons_loop = (
    source_expr: Expression,
    binding_stmt: Statement | undefined,
    binding_name: BindingPattern | undefined,
    body_stmts: Statement[],
  ): Statement => {
    const raw_arr = unwrap_list_from_array(source_expr);
    if (raw_arr !== undefined) {
      const arr_id = services.fresh("list_arr");
      const idx_id = services.fresh("list_i");
      const loop_body: Statement[] = [];
      if (binding_name !== undefined) {
        const decl_kind = binding_stmt?.type === "VariableDeclaration" &&
            binding_stmt.kind === "let"
          ? "let"
          : "const";
        loop_body.push(
          variable(
            decl_kind,
            binding_name,
            node({
              type: "MemberExpression",
              object: arr_id,
              property: idx_id,
              computed: true,
              optional: false,
            }),
          ),
        );
      }
      loop_body.push(...body_stmts);
      let body_may_mutate = false;
      if (unwrap(raw_arr).type !== "ArrayExpression") {
        for (const stmt of body_stmts) {
          walk_values(stmt, (child) => {
            if (body_may_mutate) return false;
            if (
              child.type === "CallExpression" &&
              !(child.callee.type === "MemberExpression" &&
                !child.callee.computed &&
                child.callee.object.type === "Identifier" &&
                child.callee.object.name === out_id.name &&
                child.callee.property.type === "Identifier" &&
                child.callee.property.name === "push")
            ) {
              body_may_mutate = true;
              return false;
            }
            if (
              child.type === "AssignmentExpression" ||
              child.type === "UpdateExpression" ||
              (child.type === "UnaryExpression" && child.operator === "delete")
            ) {
              if (
                child.type === "AssignmentExpression" &&
                child.left.type === "Identifier" &&
                child.left.name.startsWith("list_")
              ) return;
              if (
                child.type === "UpdateExpression" &&
                child.argument.type === "Identifier" &&
                child.argument.name.startsWith("list_")
              ) return;
              body_may_mutate = true;
              return false;
            }
          });
        }
      }
      const arr_init = body_may_mutate
        ? call(member(raw_arr, "slice"), [])
        : raw_arr;
      return block([
        variable("const", arr_id, arr_init),
        node({
          type: "ForStatement",
          init: variable("let", idx_id, literal(0)),
          test: node({
            type: "BinaryExpression",
            operator: "<",
            left: idx_id,
            right: member(arr_id, "length"),
          }),
          update: node({
            type: "AssignmentExpression",
            operator: "+=",
            left: idx_id,
            right: literal(1),
          }),
          body: block(loop_body),
        }),
      ]);
    }
    const cur_id = services.fresh("list_c");
    const loop_body: Statement[] = [];
    if (binding_name !== undefined) {
      const decl_kind = binding_stmt?.type === "VariableDeclaration" &&
          binding_stmt.kind === "let"
        ? "let"
        : "const";
      loop_body.push(
        variable(
          decl_kind,
          binding_name,
          node({
            type: "MemberExpression",
            object: cur_id,
            property: literal(1),
            computed: true,
            optional: false,
          }),
        ),
      );
    }
    loop_body.push(...body_stmts);
    return node({
      type: "ForStatement",
      init: variable("let", cur_id, method(source_expr, "value", [])),
      test: node({
        type: "BinaryExpression",
        operator: "===",
        left: node({
          type: "MemberExpression",
          object: cur_id,
          property: literal(0),
          computed: true,
          optional: false,
        }),
        right: literal("Cons"),
      }),
      update: node({
        type: "AssignmentExpression",
        operator: "=",
        left: cur_id,
        right: node({
          type: "MemberExpression",
          object: cur_id,
          property: literal(2),
          computed: true,
          optional: false,
        }),
      }),
      body: block(loop_body),
    });
  };

  const emit_list = (list: readonly Statement[]): Statement[] => {
    if (aborted) return [];
    const emitted: Statement[] = [];
    for (let index = 0; index < list.length; index += 1) {
      if (aborted) return [];
      const stmt = list[index];
      if (
        stmt.type === "ExpressionStatement" && "directive" in stmt &&
        stmt.directive != null
      ) {
        emitted.push(stmt);
        continue;
      }
      const yielded = read_yield(stmt);
      if (yielded !== undefined) {
        if (contains_yield_or_await(yielded.expression)) {
          aborted = true;
          return [];
        }
        yield_count += 1;
        const lit = match_list_literal(yielded.expression);
        if (yielded.terminal) {
          if (lit?.kind === "empty") return emitted;
          if (lit?.kind === "single") {
            push_count += 1;
            emitted.push(
              node({
                type: "ExpressionStatement",
                expression: call(member(out_id, "push"), [lit.element]),
              }),
            );
            return emitted;
          }
          push_count += 1;
          const tail_item = services.fresh("list_v");
          emitted.push(
            cons_loop(yielded.expression, undefined, tail_item, [
              node({
                type: "ExpressionStatement",
                expression: call(member(out_id, "push"), [tail_item]),
              }),
            ]),
          );
          return emitted;
        }
        const rest = list.slice(index + 1);
        if (lit?.kind === "empty") return emitted;
        if (lit?.kind === "single") {
          if (yielded.name !== undefined) {
            const decl_kind = stmt.type === "VariableDeclaration" &&
                stmt.kind === "let"
              ? "let"
              : "const";
            emitted.push(variable(decl_kind, yielded.name, lit.element));
          } else if (!is_trivial_pure_expr(lit.element)) {
            emitted.push(
              node({ type: "ExpressionStatement", expression: lit.element }),
            );
          }
          emitted.push(...emit_list(rest));
          return emitted;
        }
        emitted.push(
          cons_loop(yielded.expression, stmt, yielded.name, emit_list(rest)),
        );
        return emitted;
      }
      if (stmt.type === "ReturnStatement") {
        if (stmt.argument !== null && contains_yield_or_await(stmt.argument)) {
          aborted = true;
          return [];
        }
        push_count += 1;
        emitted.push(
          node({
            type: "ExpressionStatement",
            expression: call(member(out_id, "push"), [
              stmt.argument ?? void_zero(),
            ]),
          }),
        );
        return emitted;
      }
      if (stmt.type === "ThrowStatement") {
        if (contains_yield_or_await(stmt.argument)) {
          aborted = true;
          return [];
        }
        emitted.push(stmt);
        return emitted;
      }
      if (stmt.type === "IfStatement") {
        if (contains_yield_or_await(stmt.test)) {
          aborted = true;
          return [];
        }
        if (!contains(stmt, true)) {
          emitted.push(stmt);
          continue;
        }
        const rest = list.slice(index + 1);
        const cons_list = body_of(stmt.consequent);
        const cons_term = always_terminates(cons_list);
        if (stmt.alternate === null) {
          if (cons_term) {
            const cons_emitted = emit_list(cons_list);
            const rem_emitted = emit_list(rest);
            if (cons_emitted.length === 0) {
              if (rem_emitted.length > 0) {
                emitted.push(
                  node({
                    type: "IfStatement",
                    test: node({
                      type: "UnaryExpression",
                      operator: "!",
                      prefix: true,
                      argument: stmt.test,
                    }),
                    consequent: block(rem_emitted),
                    alternate: null,
                  }),
                );
              } else if (!is_trivial_pure_expr(stmt.test)) {
                emitted.push(
                  node({ type: "ExpressionStatement", expression: stmt.test }),
                );
              }
            } else {
              emitted.push(
                node({
                  type: "IfStatement",
                  test: stmt.test,
                  consequent: block(cons_emitted),
                  alternate: rem_emitted.length > 0 ? block(rem_emitted) : null,
                }),
              );
            }
            return emitted;
          }
          if (rest.length > 0 && (branch_copies += 1) > 4) {
            aborted = true;
            return [];
          }
          const yes = emit_list([...cons_list, ...rest]);
          const no = emit_list(rest);
          emitted.push(
            node({
              type: "IfStatement",
              test: stmt.test,
              consequent: block(yes),
              alternate: no.length > 0 ? block(no) : null,
            }),
          );
          return emitted;
        }
        const alt_list = body_of(stmt.alternate);
        const alt_term = always_terminates(alt_list);
        if (
          !cons_term && !alt_term && rest.length > 0 && (branch_copies += 1) > 4
        ) {
          aborted = true;
          return [];
        }
        const yes = emit_list(cons_term ? cons_list : [...cons_list, ...rest]);
        const no = emit_list(alt_term ? alt_list : [...alt_list, ...rest]);
        if (yes.length === 0 && no.length > 0) {
          emitted.push(
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: stmt.test,
              }),
              consequent: block(no),
              alternate: null,
            }),
          );
        } else {
          emitted.push(
            node({
              type: "IfStatement",
              test: stmt.test,
              consequent: block(yes),
              alternate: no.length > 0 ? block(no) : null,
            }),
          );
        }
        return emitted;
      }
      if (contains(stmt, true)) {
        aborted = true;
        return [];
      }
      emitted.push(stmt);
    }
    push_count += 1;
    emitted.push(
      node({
        type: "ExpressionStatement",
        expression: call(member(out_id, "push"), [void_zero()]),
      }),
    );
    return emitted;
  };

  const lowered = emit_list(body.body as Statement[]);
  if (aborted || yield_count === 0 || push_count === 0) return undefined;
  return {
    block: block([
      variable(
        "const",
        out_id,
        node({ type: "ArrayExpression", elements: Array.from<Expression>([]) }),
      ),
      ...lowered,
      ret(call(from_array_id, [out_id])),
    ]),
    yielded: true,
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
  const last_index = body.body.length - 1;
  for (let index = 0; index < last_index; index += 1) {
    const yielded = read_yield(body.body[index]);
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
    walk_values(value, (part) => {
      if (
        part.type === "Identifier" && locals.has(part.name) &&
        part.name !== permitted
      ) {
        found = true;
        return false;
      }
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
const pure_number_methods = new Set([
  "isSafeInteger",
  "isFinite",
  "isInteger",
  "isNaN",
]);
const pure_object_methods = new Set(["is", "hasOwn"]);
const pure_math_methods = new Set([
  "abs",
  "acos",
  "acosh",
  "asin",
  "asinh",
  "atan",
  "atan2",
  "atanh",
  "cbrt",
  "ceil",
  "clz32",
  "cos",
  "cosh",
  "exp",
  "expm1",
  "floor",
  "fround",
  "hypot",
  "imul",
  "log",
  "log10",
  "log1p",
  "log2",
  "max",
  "min",
  "pow",
  "round",
  "sign",
  "sin",
  "sinh",
  "sqrt",
  "tan",
  "tanh",
  "trunc",
]);

const immutable_collection_cache = new WeakMap<Node, Map<Node, boolean>>();

function is_immutable_const_collection(
  ident: IdentifierReference,
  services: TransformServices,
): boolean {
  const decl = services.bindings.resolve(ident);
  if (decl === null || decl.type !== "VariableDeclarator") return false;
  let cache = immutable_collection_cache.get(services.program);
  if (cache === undefined) {
    cache = new Map();
    immutable_collection_cache.set(services.program, cache);
  }
  const cached = cache.get(decl);
  if (cached !== undefined) return cached;
  let result = false;
  if (
    decl.id.type === "Identifier" && decl.init !== null
  ) {
    const init = unwrap(decl.init);
    if (
      init.type === "NewExpression" && init.callee.type === "Identifier" &&
      (init.callee.name === "Set" || init.callee.name === "Map") &&
      services.bindings.resolve(init.callee) === null
    ) {
      // Must be a non-exported top-level const declaration.
      const target_name = decl.id.name;
      let is_top_const = false;
      for (let i = 0; i < services.program.body.length; i += 1) {
        const stmt = services.program.body[i];
        if (
          stmt.type === "VariableDeclaration" && stmt.kind === "const" &&
          stmt.declarations.includes(decl)
        ) {
          is_top_const = true;
          break;
        }
      }
      if (is_top_const) {
        result = true;
        const src = services.source;
        // Verify it is neither re-exported nor mutated/escaped anywhere in the module.
        for (let i = 0; i < services.program.body.length && result; i += 1) {
          const stmt = services.program.body[i];
          if (
            stmt.type === "ExportNamedDeclaration" && stmt.declaration === null
          ) {
            for (const spec of stmt.specifiers) {
              if (
                spec.local.type === "Identifier" &&
                spec.local.name === target_name
              ) {
                result = false;
                break;
              }
            }
            continue;
          }
          if (stmt.type === "ExportDefaultDeclaration") {
            const pos = src.indexOf(target_name, stmt.start);
            if (pos >= 0 && pos < stmt.end) {
              result = false;
              break;
            }
          }
          const pos = src.indexOf(target_name, stmt.start);
          if (pos < 0 || pos >= stmt.end) continue;
          const check_node = (current: Node, parent?: Node): void => {
            if (!result) return;
            if (current === decl.id) return;
            if (current.type === "Identifier" && current.name === target_name) {
              if (
                parent !== undefined &&
                ((parent.type === "MemberExpression" && !parent.computed &&
                  parent.property === current) ||
                  (parent.type === "Property" && !parent.computed &&
                    parent.key === current))
              ) return;
              // Allow only pure `.has(...)`, `.get(...)`, `.size` accesses on this identifier.
              if (
                parent !== undefined && parent.type === "MemberExpression" &&
                parent.object === current && !parent.computed &&
                parent.property.type === "Identifier" &&
                (parent.property.name === "has" ||
                  parent.property.name === "get" ||
                  parent.property.name === "size")
              ) return;
              const res = services.bindings.resolve(current);
              if (res !== null && res !== decl) return;
              result = false;
              return;
            }
            const keys = value_visitor_keys[current.type];
            if (keys === undefined || keys.length === 0) return;
            const rec = current as unknown as Record<string, unknown>;
            for (let k = 0; k < keys.length; k += 1) {
              const child = rec[keys[k]];
              if (child === null || typeof child !== "object") continue;
              if (Array.isArray(child)) {
                for (let j = 0; j < child.length; j += 1) {
                  const item = child[j];
                  if (
                    item !== null && typeof item === "object" &&
                    typeof (item as { type?: unknown }).type === "string"
                  ) check_node(item as Node, current);
                }
              } else if (
                typeof (child as { type?: unknown }).type === "string"
              ) {
                check_node(child as Node, current);
              }
            }
          };
          check_node(stmt);
        }
      }
    }
  }
  cache.set(decl, result);
  return result;
}

function is_statically_pure_call(
  value: CallExpression,
  services: TransformServices,
): boolean {
  if (value.optional) return false;
  const callee = value.callee;
  if (
    callee.type !== "MemberExpression" || callee.computed || callee.optional ||
    callee.property.type !== "Identifier"
  ) return false;
  const prop = callee.property.name;
  // Data.prototype.value()
  if (prop === "value" && value.arguments.length === 0) return true;
  const imp = services.imports;
  // Constructor `.is(...)` guards (Left.is, Right.is, Just.is, Nothing.is, Valid.is, Invalid.is, Nil.is, Cons.is)
  if (prop === "is" && value.arguments.length === 1) {
    if (
      callee.object.type === "Identifier" &&
      services.bindings.imported(callee.object)
    ) {
      const obj = callee.object.name;
      if (
        imp.left_constructors?.has(obj) ||
        imp.right_constructors?.has(obj) ||
        imp.just_constructors?.has(obj) ||
        imp.nothing_constructors?.has(obj) ||
        imp.valid_constructors?.has(obj) ||
        imp.invalid_constructors?.has(obj) ||
        imp.nil_constructors?.has(obj) ||
        imp.cons_constructors?.has(obj)
      ) return true;
    }
    if (
      callee.object.type === "MemberExpression" && !callee.object.computed &&
      !callee.object.optional && callee.object.object.type === "Identifier" &&
      callee.object.property.type === "Identifier" &&
      services.bindings.imported(callee.object.object)
    ) {
      const ns = callee.object.object.name;
      const ctor = callee.object.property.name;
      if (
        (imp.direct_either_dictionaries?.has(ns) &&
          (ctor === "Left" || ctor === "Right")) ||
        (imp.direct_maybe_dictionaries?.has(ns) &&
          (ctor === "Just" || ctor === "Nothing")) ||
        (imp.direct_validation_dictionaries?.has(ns) &&
          (ctor === "Valid" || ctor === "Invalid")) ||
        (imp.list_constructors?.has(ns) &&
          (ctor === "Nil" || ctor === "Cons"))
      ) return true;
    }
  }
  if (callee.object.type === "Identifier") {
    const obj_name = callee.object.name;
    // Unshadowed global pure static predicates & math functions
    if (services.bindings.resolve(callee.object) === null) {
      if (obj_name === "Array" && prop === "isArray") return true;
      if (obj_name === "Number" && pure_number_methods.has(prop)) return true;
      if (obj_name === "Object" && pure_object_methods.has(prop)) return true;
      if (obj_name === "Math" && pure_math_methods.has(prop)) return true;
    }
    // Non-mutated, non-escaping module-const Set/Map `.has(...)` / `.get(...)`
    if (
      (prop === "has" || prop === "get") && value.arguments.length === 1 &&
      is_immutable_const_collection(callee.object, services)
    ) return true;
  }
  return false;
}

function contains_non_nested_yield(value: Node): boolean {
  let found = false;
  walk_values(value, (part) => {
    if (function_like(part)) return false;
    if (part.type === "YieldExpression") {
      found = true;
      return false;
    }
  });
  return found;
}

function max_non_nested_yield_pos(value: Node): number {
  let max_pos = -1;
  walk_values(value, (part) => {
    if (function_like(part)) return false;
    if (part.type === "YieldExpression" && part.start > max_pos) {
      max_pos = part.start;
    }
  });
  return max_pos;
}

type BodyAnalysis = {
  hazard?: Node;
  var_binding?: Node;
  first_yield?: YieldExpression;
  capture?: Node;
  prefix?: Node;
  unconditional_first_yield_end: number;
  pre_first_yield_capture?: Node;
  pre_first_yield_prefix?: Node;
};

/** Single-pass analysis for lexical hazards, var locals, unsafe captures, and eager prefixes. */
function analyze_body(
  body: FunctionBody,
  services: TransformServices,
): BodyAnalysis {
  let hazard: Node | undefined;
  let var_binding: Node | undefined;
  let first_yield: YieldExpression | undefined;
  const capture_scopes: Map<string, Capture | undefined>[] = [];
  const prefix_scopes: Set<string>[] = [];
  const ends: number[] = [];
  const captures: Capture[] = [];
  const yields: number[] = [];
  const prefix_effects: { node: Node; reaches: boolean }[] = [];

  // Backward CFG reachability: for each node, compute whether a yield* is reachable after it.
  const after_yield_map = new WeakMap<Node, boolean>();
  function compute_reach_stmt(
    stmt: Statement,
    after: boolean,
    break_r: boolean,
    continue_r: boolean,
    throw_r: boolean,
  ): boolean {
    switch (stmt.type) {
      case "ReturnStatement":
        after_yield_map.set(stmt, false);
        return stmt.argument !== null &&
          contains_non_nested_yield(stmt.argument);
      case "ThrowStatement":
        after_yield_map.set(stmt, throw_r);
        return throw_r || contains_non_nested_yield(stmt.argument);
      case "BreakStatement":
        return break_r;
      case "ContinueStatement":
        return continue_r;
      case "BlockStatement": {
        let next = after;
        for (let i = stmt.body.length - 1; i >= 0; i -= 1) {
          next = compute_reach_stmt(
            stmt.body[i] as Statement,
            next,
            break_r,
            continue_r,
            throw_r,
          );
        }
        return next;
      }
      case "IfStatement": {
        const cons_r = compute_reach_stmt(
          stmt.consequent,
          after,
          break_r,
          continue_r,
          throw_r,
        );
        const alt_r = stmt.alternate !== null
          ? compute_reach_stmt(
            stmt.alternate,
            after,
            break_r,
            continue_r,
            throw_r,
          )
          : after;
        const test_after = cons_r || alt_r;
        after_yield_map.set(stmt.test, test_after);
        return test_after || contains_non_nested_yield(stmt.test);
      }
      case "SwitchStatement": {
        let has_default = false;
        let fall = after;
        let any_case = false;
        for (let i = stmt.cases.length - 1; i >= 0; i -= 1) {
          const clause = stmt.cases[i];
          if (clause.test === null) has_default = true;
          let cur = fall;
          for (let j = clause.consequent.length - 1; j >= 0; j -= 1) {
            cur = compute_reach_stmt(
              clause.consequent[j] as Statement,
              cur,
              after,
              continue_r,
              throw_r,
            );
          }
          if (clause.test !== null) {
            after_yield_map.set(clause.test, cur || fall);
          }
          if (cur) any_case = true;
          fall = cur;
        }
        const disc_after = any_case || (!has_default && after);
        after_yield_map.set(stmt.discriminant, disc_after);
        return disc_after || contains_non_nested_yield(stmt.discriminant);
      }
      case "ForStatement":
      case "ForOfStatement":
      case "ForInStatement":
      case "WhileStatement":
      case "DoWhileStatement": {
        const self_yield = contains_non_nested_yield(stmt);
        const iter_r = self_yield || after;
        const body_r = compute_reach_stmt(
          stmt.body,
          iter_r,
          after,
          iter_r,
          throw_r,
        );
        const loop_r = body_r || iter_r;
        if (stmt.type === "ForStatement") {
          if (stmt.init !== null) after_yield_map.set(stmt.init, loop_r);
          if (stmt.test !== null) after_yield_map.set(stmt.test, loop_r);
          if (stmt.update !== null) after_yield_map.set(stmt.update, loop_r);
        } else if (
          stmt.type === "WhileStatement" || stmt.type === "DoWhileStatement"
        ) {
          after_yield_map.set(stmt.test, loop_r);
        } else {
          after_yield_map.set(stmt.right, loop_r);
        }
        return loop_r;
      }
      case "TryStatement": {
        const fin_r = stmt.finalizer !== null
          ? compute_reach_stmt(
            stmt.finalizer,
            after,
            break_r,
            continue_r,
            throw_r,
          )
          : after;
        const catch_r = stmt.handler !== null
          ? compute_reach_stmt(
            stmt.handler.body,
            fin_r,
            break_r,
            continue_r,
            throw_r,
          )
          : throw_r;
        const block_r = compute_reach_stmt(
          stmt.block,
          fin_r,
          break_r,
          continue_r,
          catch_r || fin_r,
        );
        return block_r || catch_r || fin_r;
      }
      case "LabeledStatement":
        return compute_reach_stmt(
          stmt.body,
          after,
          after,
          continue_r,
          throw_r,
        );
      default: {
        after_yield_map.set(stmt, after);
        return after || contains_non_nested_yield(stmt);
      }
    }
  }
  {
    let next = false;
    for (let i = body.body.length - 1; i >= 0; i -= 1) {
      next = compute_reach_stmt(
        body.body[i] as Statement,
        next,
        false,
        false,
        false,
      );
    }
  }

  // Detect unconditional top-level first yield* (for post-first-yield linear monad rules).
  let unconditional_first_yield_end = -1;
  for (let i = 0; i < body.body.length; i += 1) {
    const stmt = body.body[i] as Statement;
    if (read_yield(stmt) !== undefined) {
      unconditional_first_yield_end = stmt.end;
      break;
    }
    if (
      stmt.type !== "VariableDeclaration" &&
      stmt.type !== "ExpressionStatement" &&
      stmt.type !== "EmptyStatement"
    ) break;
    if (contains_non_nested_yield(stmt)) break;
  }

  function lookup_capture(name: string): Capture | undefined {
    for (let index = capture_scopes.length - 1; index >= 0; index -= 1) {
      const scope = capture_scopes[index];
      if (scope.has(name)) return scope.get(name);
    }
  }
  function is_prefix_local(value: Node): boolean {
    if (value.type !== "Identifier") return false;
    for (let index = prefix_scopes.length - 1; index >= 0; index -= 1) {
      if (prefix_scopes[index].has(value.name)) return true;
    }
    return false;
  }
  function declare_capture(
    pattern: BindingPattern,
    declaration: Node | undefined,
    allocated: boolean,
    nested: boolean,
  ): void {
    const scope = capture_scopes[capture_scopes.length - 1];
    const end = ends[ends.length - 1];
    binding_names(pattern, (name) => {
      let binding: Capture | undefined;
      if (declaration && !nested) {
        binding = {
          declaration,
          allocated,
          end,
          references: [],
          writes: [],
          closure_write: false,
        };
        captures.push(binding);
      }
      scope.set(name, binding);
    });
  }
  function declare_prefix(pattern: BindingPattern): void {
    const scope = prefix_scopes[prefix_scopes.length - 1];
    binding_names(pattern, (name) => scope.add(name));
  }
  function write(value: Node, nested: boolean): void {
    if (value.type === "Identifier") {
      const binding = lookup_capture(value.name);
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
  function check_hazard(value: Node, parent?: Node): void {
    const property = parent?.type === "MemberExpression" && !parent.computed &&
        parent.property === value ||
      parent?.type === "Property" && !parent.computed && parent.key === value;
    if (
      value.type === "ThisExpression" || value.type === "Super" ||
      value.type === "MetaProperty" ||
      value.type === "Identifier" && value.name === "arguments" && !property ||
      value.type === "CallExpression" && !value.optional &&
        value.callee.type === "Identifier" && value.callee.name === "eval"
    ) hazard = value;
  }
  function scan_children(
    value: Node,
    nested: boolean,
    in_yield_arg: boolean,
    reaches_yield: boolean,
    local_max_yield: number,
  ): void {
    const keys = value_visitor_keys[value.type];
    if (keys === undefined || keys.length === 0) return;
    const record = value as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const item = record[keys[index]];
      if (item === null || typeof item !== "object") continue;
      if (Array.isArray(item)) {
        for (let child_index = 0; child_index < item.length; child_index += 1) {
          const child = item[child_index];
          if (
            child !== null && typeof child === "object" &&
            typeof (child as { type?: unknown }).type === "string"
          ) {
            scan(
              child as Node,
              nested,
              in_yield_arg,
              reaches_yield,
              local_max_yield,
              value,
            );
          }
        }
      } else if (typeof (item as { type?: unknown }).type === "string") {
        scan(
          item as Node,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
      }
    }
  }
  function scan_update_children(
    value: Node,
    nested: boolean,
    in_yield_arg: boolean,
    reaches_yield: boolean,
    local_max_yield: number,
  ): void {
    const keys = value_visitor_keys[value.type];
    if (keys === undefined || keys.length === 0) return;
    const record = value as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const item = record[keys[index]];
      if (item === null || typeof item !== "object") continue;
      if (Array.isArray(item)) {
        for (let child_index = 0; child_index < item.length; child_index += 1) {
          const child = item[child_index];
          if (
            child !== null && typeof child === "object" &&
            typeof (child as { type?: unknown }).type === "string"
          ) {
            scan_update(
              child as Node,
              nested,
              in_yield_arg,
              reaches_yield,
              local_max_yield,
              value,
            );
          }
        }
      } else if (typeof (item as { type?: unknown }).type === "string") {
        scan_update(
          item as Node,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
      }
    }
  }
  function scan_pattern_children(
    value: Node,
    nested: boolean,
    in_yield_arg: boolean,
    reaches_yield: boolean,
    local_max_yield: number,
  ): void {
    const keys = value_visitor_keys[value.type];
    if (keys === undefined || keys.length === 0) return;
    const record = value as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const item = record[keys[index]];
      if (item === null || typeof item !== "object") continue;
      if (Array.isArray(item)) {
        for (let child_index = 0; child_index < item.length; child_index += 1) {
          const child = item[child_index];
          if (
            child !== null && typeof child === "object" &&
            typeof (child as { type?: unknown }).type === "string"
          ) {
            scan_pattern_hazards(
              child as Node,
              nested,
              in_yield_arg,
              reaches_yield,
              local_max_yield,
              value,
            );
          }
        }
      } else if (typeof (item as { type?: unknown }).type === "string") {
        scan_pattern_hazards(
          item as Node,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
      }
    }
  }
  function record_prefix_effect(
    effect_node: Node,
    reaches_yield: boolean,
    local_max_yield: number,
  ): void {
    if (reaches_yield || effect_node.end < local_max_yield) {
      prefix_effects.push({ node: effect_node, reaches: true });
    }
  }
  function scan(
    value: Node,
    nested: boolean,
    in_yield_arg: boolean,
    reaches_yield: boolean,
    local_max_yield: number,
    parent?: Node,
  ): void {
    const type = value.type;
    // Fast-path leaf nodes before running any checks or megamorphic key lookups.
    if (
      type === "Literal" || type === "TemplateElement" ||
      type === "EmptyStatement" || type === "BreakStatement" ||
      type === "ContinueStatement" || type === "PrivateIdentifier" ||
      type === "DebuggerStatement"
    ) return;
    if (type === "Identifier") {
      if (value.name === "arguments") {
        const property = parent !== undefined &&
          ((parent.type === "MemberExpression" && !parent.computed &&
            parent.property === value) ||
            (parent.type === "Property" && !parent.computed &&
              parent.key === value));
        if (!property) hazard = value;
      }
      if (
        captures.length > 0 &&
        !(parent !== undefined &&
          ((parent.type === "MemberExpression" && parent.property === value &&
            !parent.computed) ||
            (parent.type === "Property" && parent.key === value &&
              !parent.computed)))
      ) {
        lookup_capture(value.name)?.references.push(value.start);
      }
      return;
    }
    if (
      type === "ThisExpression" || type === "Super" || type === "MetaProperty"
    ) {
      hazard = value;
      return;
    }
    const mapped_reach = !nested && !in_yield_arg
      ? after_yield_map.get(value)
      : undefined;
    if (mapped_reach !== undefined) {
      reaches_yield = mapped_reach;
      local_max_yield = mapped_reach ? -1 : max_non_nested_yield_pos(value);
    }
    switch (type) {
      case "BlockStatement": {
        capture_scopes.push(new Map());
        ends.push(value.end);
        if (!nested && !in_yield_arg) prefix_scopes.push(new Set());
        const body_list = value.body;
        for (let i = 0; i < body_list.length; i += 1) {
          const part = body_list[i];
          if (part.type === "VariableDeclaration") {
            for (const declaration of part.declarations) {
              declare_capture(
                declaration.id,
                declaration,
                !!declaration.init && allocation(declaration.init),
                nested,
              );
              if (!nested && !in_yield_arg) declare_prefix(declaration.id);
            }
          } else if (
            (part.type === "FunctionDeclaration" ||
              part.type === "ClassDeclaration") && part.id
          ) declare_capture(part.id, part, true, nested);
        }
        for (let i = 0; i < body_list.length; i += 1) {
          scan(
            body_list[i],
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        capture_scopes.pop();
        ends.pop();
        if (!nested && !in_yield_arg) prefix_scopes.pop();
        return;
      }
      case "VariableDeclaration": {
        if (!nested && !in_yield_arg && value.kind === "var") {
          var_binding = value;
        }
        const decls = value.declarations;
        for (let i = 0; i < decls.length; i += 1) {
          scan(
            decls[i],
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      }
      case "VariableDeclarator":
        scan_pattern_hazards(
          value.id,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        if (value.init !== null) {
          scan(
            value.init,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      case "ReturnStatement":
        if (value.argument !== null) {
          scan(
            value.argument,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      case "ExpressionStatement":
        scan(
          value.expression,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "YieldExpression":
        if (!nested) {
          if (!in_yield_arg && !first_yield) first_yield = value;
          yields.push(value.start);
        }
        if (value.argument !== null) {
          scan(value.argument, nested, true, false, -1, value);
        }
        return;
      case "CallExpression": {
        if (
          !value.optional && value.callee.type === "Identifier" &&
          value.callee.name === "eval"
        ) hazard = value;
        if (
          !nested && !in_yield_arg && !is_statically_pure_call(value, services)
        ) {
          record_prefix_effect(value, reaches_yield, local_max_yield);
        }
        if (
          value.callee.type === "MemberExpression" && !value.callee.computed &&
          value.callee.property.type === "Identifier" &&
          mutating_methods.has(value.callee.property.name)
        ) write(value.callee.object, nested);
        scan(
          value.callee,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        const args = value.arguments;
        for (let i = 0; i < args.length; i += 1) {
          scan(
            args[i],
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      }
      case "MemberExpression":
        scan(
          value.object,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        if (value.computed) {
          scan(
            value.property,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      case "BinaryExpression":
        if (value.left.type !== "PrivateIdentifier") {
          scan(
            value.left,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        scan(
          value.right,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "LogicalExpression":
        scan(
          value.left,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        scan(
          value.right,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "UnaryExpression":
        if (value.operator === "delete") {
          if (!nested && !in_yield_arg) {
            record_prefix_effect(value, reaches_yield, local_max_yield);
          }
          write(value.argument, nested);
        }
        scan(
          value.argument,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "IfStatement":
        scan(
          value.test,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        scan(
          value.consequent,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        if (value.alternate !== null) {
          scan(
            value.alternate,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      case "ConditionalExpression":
        scan(
          value.test,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        scan(
          value.consequent,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        scan(
          value.alternate,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "ArrayExpression": {
        const els = value.elements;
        for (let i = 0; i < els.length; i += 1) {
          const el = els[i];
          if (el !== null) {
            scan(
              el,
              nested,
              in_yield_arg,
              reaches_yield,
              local_max_yield,
              value,
            );
          }
        }
        return;
      }
      case "ObjectExpression": {
        const props = value.properties;
        for (let i = 0; i < props.length; i += 1) {
          const prop = props[i];
          if (prop.type === "SpreadElement") {
            scan(
              prop.argument,
              nested,
              in_yield_arg,
              reaches_yield,
              local_max_yield,
              prop,
            );
          } else {
            if (prop.computed) {
              scan(
                prop.key,
                nested,
                in_yield_arg,
                reaches_yield,
                local_max_yield,
                prop,
              );
            }
            scan(
              prop.value,
              nested,
              in_yield_arg,
              reaches_yield,
              local_max_yield,
              prop,
            );
          }
        }
        return;
      }
      case "AssignmentExpression":
        if (!nested && !in_yield_arg && !is_prefix_local(value.left)) {
          record_prefix_effect(value, reaches_yield, local_max_yield);
        }
        write(value.left, nested);
        scan(
          value.left,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        scan(
          value.right,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "UpdateExpression":
        if (!nested && !in_yield_arg && !is_prefix_local(value.argument)) {
          record_prefix_effect(value, reaches_yield, local_max_yield);
        }
        write(value.argument, nested);
        scan(
          value.argument,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        return;
      case "NewExpression": {
        if (!nested && !in_yield_arg) {
          record_prefix_effect(value, reaches_yield, local_max_yield);
        }
        scan(
          value.callee,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
        const args = value.arguments;
        for (let i = 0; i < args.length; i += 1) {
          scan(
            args[i],
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        return;
      }
    }
    check_hazard(value, parent);
    if (function_like(value)) {
      capture_scopes.push(new Map());
      ends.push(value.end);
      if (
        type === "FunctionDeclaration" ||
        type === "FunctionExpression" ||
        type === "ArrowFunctionExpression"
      ) {
        for (const param of value.params) {
          if (param.type === "RestElement") {
            declare_capture(param.argument, undefined, false, true);
          } else if (param.type !== "TSParameterProperty") {
            declare_capture(param, undefined, false, true);
          }
        }
      }
      scan_children(value, true, true, false, -1);
      capture_scopes.pop();
      ends.pop();
      return;
    }
    if (
      type === "ForStatement" || type === "ForOfStatement" ||
      type === "ForInStatement"
    ) {
      capture_scopes.push(new Map());
      ends.push(value.end);
      if (!nested && !in_yield_arg) prefix_scopes.push(new Set());
      let initializer: Node | null;
      if (type === "ForStatement") initializer = value.init;
      else initializer = value.left;
      if (initializer?.type === "VariableDeclaration") {
        for (const declaration of initializer.declarations) {
          declare_capture(
            declaration.id,
            declaration,
            !!declaration.init && allocation(declaration.init),
            nested,
          );
          if (!nested && !in_yield_arg) declare_prefix(declaration.id);
        }
      }
      if (type === "ForStatement") {
        if (value.init) {
          scan(
            value.init,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        if (value.test) {
          scan(
            value.test,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        if (value.update) {
          const upd_r = !nested && !in_yield_arg
            ? (after_yield_map.get(value.update) ?? reaches_yield)
            : false;
          // Capture scan intentionally visits init/test/body; hazard/prefix visit update too.
          scan_update(
            value.update,
            nested,
            in_yield_arg,
            upd_r,
            upd_r ? -1 : max_non_nested_yield_pos(value.update),
            value,
          );
        }
        scan(
          value.body,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
      } else {
        if (type === "ForOfStatement") {
          // ForOfStatement right is skipped by unsafe_prefix, scanned by capture/hazard.
          scan(value.right, nested, true, false, -1, value);
        } else {
          scan(
            value.right,
            nested,
            in_yield_arg,
            reaches_yield,
            local_max_yield,
            value,
          );
        }
        scan(
          value.body,
          nested,
          in_yield_arg,
          reaches_yield,
          local_max_yield,
          value,
        );
      }
      capture_scopes.pop();
      ends.pop();
      if (!nested && !in_yield_arg) prefix_scopes.pop();
      return;
    }
    if (
      (type === "WhileStatement" || type === "DoWhileStatement") &&
      !nested && !in_yield_arg
    ) {
      scan_children(
        value,
        nested,
        in_yield_arg,
        reaches_yield,
        local_max_yield,
      );
      return;
    }
    scan_children(value, nested, in_yield_arg, reaches_yield, local_max_yield);
  }
  function scan_update(
    value: Node,
    nested: boolean,
    in_yield_arg: boolean,
    reaches_yield: boolean,
    local_max_yield: number,
    parent?: Node,
  ): void {
    check_hazard(value, parent);
    if (function_like(value)) {
      scan_update_children(value, true, true, false, -1);
      return;
    }
    if (!nested && !in_yield_arg) {
      if (value.type === "YieldExpression") {
        if (!first_yield) first_yield = value;
        scan_update_children(value, nested, true, false, -1);
        return;
      }
      if (
        (value.type === "CallExpression" &&
          !is_statically_pure_call(value, services)) ||
        value.type === "NewExpression" ||
        value.type === "AssignmentExpression" && !is_prefix_local(value.left) ||
        value.type === "UpdateExpression" && !is_prefix_local(value.argument) ||
        value.type === "UnaryExpression" && value.operator === "delete"
      ) record_prefix_effect(value, reaches_yield, local_max_yield);
    }
    scan_update_children(
      value,
      nested,
      in_yield_arg,
      reaches_yield,
      local_max_yield,
    );
  }
  function scan_pattern_hazards(
    pattern: Node,
    nested: boolean,
    in_yield_arg: boolean,
    reaches_yield: boolean,
    local_max_yield: number,
    parent?: Node,
  ): void {
    if (pattern.type === "Identifier") {
      check_hazard(pattern, parent);
      return;
    }
    if (pattern.type === "AssignmentPattern") {
      scan_pattern_hazards(
        pattern.left,
        nested,
        in_yield_arg,
        reaches_yield,
        local_max_yield,
        pattern,
      );
      scan(
        pattern.right,
        nested,
        in_yield_arg,
        reaches_yield,
        local_max_yield,
        pattern,
      );
      return;
    }
    scan_pattern_children(
      pattern,
      nested,
      in_yield_arg,
      reaches_yield,
      local_max_yield,
    );
  }

  scan(body, false, false, false, -1);

  let capture: Node | undefined;
  let pre_first_yield_capture: Node | undefined;
  if (yields.length > 0) {
    for (let index = 0; index < captures.length; index += 1) {
      const item = captures[index];
      let low = 0;
      let high = yields.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (yields[middle] < item.declaration.end) low = middle + 1;
        else high = middle;
      }
      const yielded = yields[low];
      if (yielded === undefined || yielded >= item.end) continue;
      if (
        item.closure_write ||
        item.writes.some((position) => position > yielded) ||
        (item.allocated &&
          item.references.some((reference) => reference > yielded))
      ) {
        capture ??= item.declaration;
        if (
          unconditional_first_yield_end >= 0 &&
          item.declaration.start < unconditional_first_yield_end
        ) {
          pre_first_yield_capture ??= item.declaration;
        }
      }
    }
  }

  let prefix: Node | undefined;
  let pre_first_yield_prefix: Node | undefined;
  for (let index = 0; index < prefix_effects.length; index += 1) {
    const effect = prefix_effects[index];
    if (effect.reaches) {
      prefix ??= effect.node;
      if (
        unconditional_first_yield_end >= 0 &&
        effect.node.start < unconditional_first_yield_end
      ) {
        pre_first_yield_prefix ??= effect.node;
      }
    }
  }

  return {
    hazard,
    var_binding,
    first_yield,
    capture,
    prefix,
    unconditional_first_yield_end,
    pre_first_yield_capture,
    pre_first_yield_prefix,
  };
}

function is_linear_do_monad(
  explicit: Expression | undefined,
  first_yield: YieldExpression | undefined,
  services: TransformServices,
): boolean {
  const imp = services.imports;
  if (explicit !== undefined) {
    const ex = unwrap(explicit);
    if (ex.type !== "Identifier" || !services.bindings.imported(ex)) {
      return false;
    }
    const name = ex.name;
    return services.task_dictionaries.has(name) ||
      (imp.direct_reader_dictionaries?.has(name) ?? false) ||
      (imp.direct_state_dictionaries?.has(name) ?? false) ||
      (imp.direct_writer_dictionaries?.has(name) ?? false) ||
      (imp.stm_dictionaries?.has(name) ?? false);
  }
  if (!first_yield?.delegate || first_yield.argument === null) return false;
  const arg = unwrap(first_yield.argument);
  if (arg.type !== "CallExpression" || arg.optional) return false;
  const callee = unwrap(arg.callee);
  if (callee.type === "Identifier" && services.bindings.imported(callee)) {
    const name = callee.name;
    return services.task_dictionaries.has(name) ||
      (imp.task_from_fn_functions?.has(name) ?? false) ||
      (imp.task_from_promise_functions?.has(name) ?? false) ||
      (imp.task_succeed_functions?.has(name) ?? false) ||
      (imp.task_sequential_functions?.has(name) ?? false) ||
      (imp.direct_reader_dictionaries?.has(name) ?? false) ||
      (imp.direct_state_dictionaries?.has(name) ?? false) ||
      (imp.direct_writer_dictionaries?.has(name) ?? false) ||
      imp.primitive_functions.has(name) ||
      (imp.stm_dictionaries?.has(name) ?? false) ||
      (imp.stm_primitive_functions?.has(name) ?? false);
  }
  if (
    callee.type === "MemberExpression" && !callee.computed &&
    !callee.optional && callee.object.type === "Identifier" &&
    callee.property.type === "Identifier" &&
    services.bindings.imported(callee.object)
  ) {
    const obj = callee.object.name;
    const prop = callee.property.name;
    if (
      services.task_dictionaries.has(obj) ||
      (imp.task_namespaces?.has(obj) ?? false) ||
      (imp.direct_reader_dictionaries?.has(obj) ?? false) ||
      (imp.direct_state_dictionaries?.has(obj) ?? false) ||
      (imp.direct_writer_dictionaries?.has(obj) ?? false) ||
      imp.primitive_namespaces.has(obj) ||
      (imp.stm_dictionaries?.has(obj) ?? false) ||
      (imp.stm_namespaces?.has(obj) ?? false)
    ) return true;
    if (
      (imp.monad_error_objects?.has(obj) ?? false) &&
      prop === "catch_error" && arg.arguments.length >= 1 &&
      arg.arguments[0].type !== "SpreadElement"
    ) {
      return is_linear_do_monad(
        undefined,
        { ...first_yield, argument: arg.arguments[0] as Expression },
        services,
      );
    }
  }
  return false;
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
    const analysis = analyze_body(run.body, services);
    if (analysis.hazard) {
      fail(
        state,
        analysis.hazard,
        "generator lexical this, arguments, new.target, super, and direct eval are not supported.",
      );
    }
    if (analysis.var_binding) {
      fail(
        state,
        analysis.var_binding,
        "var-scoped generator locals are not supported; use let or const.",
      );
    }
    const direct_spec = kind === "do"
      ? direct_single_shot_spec(explicit, analysis.first_yield, services)
      : undefined;
    if (direct_spec !== undefined && (analysis.capture || analysis.prefix)) {
      const direct = direct_single_shot(run.body, state, direct_spec, true);
      if (direct !== undefined) return expr(direct.block);
    }
    const linear_post_first = kind === "do" &&
      analysis.unconditional_first_yield_end >= 0 &&
      is_linear_do_monad(explicit, analysis.first_yield, services);
    const effective_capture = linear_post_first
      ? analysis.pre_first_yield_capture
      : analysis.capture;
    const effective_prefix = linear_post_first
      ? analysis.pre_first_yield_prefix
      : analysis.prefix;
    if (effective_capture) {
      fail(
        state,
        effective_capture,
        "generator-local state captured across yield* cannot preserve branching or repeated execution.",
      );
    }
    if (effective_prefix) {
      fail(
        state,
        effective_prefix,
        "observable generator statements before yield* cannot preserve replay or repeated execution; lift the work into a yielded context.",
      );
    }
    const first_yield = analysis.first_yield;
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
    const array_dict = kind === "do"
      ? direct_array_dictionary(explicit, first_yield, services)
      : undefined;
    const list_dict = kind === "do" && array_dict === undefined
      ? direct_list_dictionary(explicit, first_yield, services)
      : undefined;
    const direct_result = direct_spec !== undefined
      ? direct_single_shot(run.body, state, direct_spec, false)
      : undefined;
    let result = flat(run.body, state) ??
      direct_result ??
      (array_dict !== undefined
        ? direct_array_comprehension(run.body, array_dict, services)
        : undefined) ??
      (list_dict !== undefined
        ? direct_list_comprehension(run.body, list_dict, services)
        : undefined);
    if (!result) {
      let yield_count = 0;
      for (let index = 0; index < run.body.body.length; index += 1) {
        if (read_yield(run.body.body[index])) {
          yield_count += 1;
          if (yield_count > 256) {
            fail(
              state,
              value,
              "long dependent continuations require liveness threading; preserving the generator avoids compiler printer stack overflow.",
            );
          }
        }
      }
    }
    result ??= statements(run.body.body, undefined, state, {});
    if (kind === "do" && !result.yielded && !state.dictionary) {
      services.diagnose(
        value,
        "Skipped Do: Do requires at least one top-level yield*.",
      );
      return;
    }
    if (
      explicit && state.dictionary !== explicit &&
      result !== direct_result
    ) {
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

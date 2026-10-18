import type {
  Argument,
  BindingPattern,
  BlockStatement,
  CallExpression,
  Expression,
  Function as FunctionNode,
  IdentifierReference,
  Node,
  Statement,
  TSType,
  VariableDeclaration,
  VariableDeclarator,
} from "oxc-parser";
import {
  arrow,
  block,
  call,
  id,
  member,
  node,
  ret,
  walk,
} from "./transform_ast.ts";
import type {
  PrimitiveFunctionName,
  TerminalFunctionName,
  TransformServices,
} from "./transform_context.ts";

type TerminalKind = "reader" | "state" | "writer";
type Target = {
  readonly imported: TerminalFunctionName;
  readonly local: string;
  readonly namespace?: IdentifierReference;
};
type Primitive = {
  readonly name: PrimitiveFunctionName;
  readonly arguments: Expression[];
  readonly types?: TSType[];
};
type YieldPart = {
  readonly kind: "yield";
  readonly expression: Expression;
  readonly binding?: {
    readonly statement: VariableDeclaration;
    readonly declaration: VariableDeclarator;
  };
  readonly returns: boolean;
};
type Body = {
  readonly parts: (YieldPart | {
    readonly kind: "statement";
    readonly statement: Statement;
  })[];
  readonly result?: Expression;
};

/** Terminal dispatch, primitive fusion, and static Effect interpreter lowering. */
export function create_terminal_transform(services: TransformServices) {
  const removed = new Set<Node>();
  const named = collect_named();

  function imported(
    expression: Expression,
    names: ReadonlySet<string>,
  ): boolean {
    return expression.type === "Identifier" && names.has(expression.name) &&
      services.bindings.imported(expression);
  }
  function target(expression: Expression): Target | undefined {
    if (
      expression.type === "Identifier" && services.bindings.imported(expression)
    ) {
      const found = services.imports.terminal_functions.get(expression.name);
      if (found !== undefined) {
        return { imported: found.imported, local: expression.name };
      }
    }
    if (
      expression.type !== "MemberExpression" || expression.computed ||
      expression.optional ||
      expression.object.type !== "Identifier" ||
      expression.property.type !== "Identifier" ||
      !services.bindings.imported(expression.object)
    ) return undefined;
    const name = expression.property.name as TerminalFunctionName;
    if (
      !services.imports.terminal_namespaces.get(expression.object.name)?.has(
        name,
      )
    ) return undefined;
    return {
      imported: name,
      namespace: expression.object,
      local: expression.object.name,
    };
  }
  function primitive(expression: Expression): Primitive | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || value.optional ||
      value.arguments.some((argument) => argument.type === "SpreadElement")
    ) return undefined;
    let name: PrimitiveFunctionName | undefined;
    if (
      value.callee.type === "Identifier" &&
      services.bindings.imported(value.callee)
    ) {
      name = services.imports.primitive_functions.get(value.callee.name);
    } else if (
      value.callee.type === "MemberExpression" && !value.callee.optional &&
      !value.callee.computed &&
      value.callee.object.type === "Identifier" &&
      value.callee.property.type === "Identifier" &&
      services.bindings.imported(value.callee.object)
    ) {
      const candidate = value.callee.property.name as PrimitiveFunctionName;
      if (
        services.imports.primitive_namespaces.get(value.callee.object.name)
          ?.has(candidate)
      ) name = candidate;
    }
    if (name === undefined || !primitive_arity(name, value.arguments.length)) {
      return undefined;
    }
    const types = value.typeArguments?.params;
    if (types === undefined) {
      if (name === "ask" || name === "get" || name === "put") return undefined;
      if (
        (name === "asks" || name === "gets" || name === "modify") &&
        !self_typed(value.arguments[0] as Expression)
      ) return undefined;
    } else {
      switch (name) {
        case "ask":
        case "get":
        case "put":
        case "modify":
          if (types.length !== 1) return undefined;
          break;
        case "asks":
        case "gets":
          if (types.length !== 2) return undefined;
          break;
        default:
          return undefined;
      }
    }
    return { name, arguments: value.arguments as Expression[], types };
  }
  function input_type(body: Body, kind: TerminalKind): TSType | undefined {
    for (const part of body.parts) {
      if (part.kind !== "yield") continue;
      const operation = primitive(part.expression);
      if (operation === undefined || primitive_kind(operation.name) !== kind) {
        continue;
      }
      if (operation.types !== undefined) return operation.types[0];
      if (
        operation.name === "asks" || operation.name === "gets" ||
        operation.name === "modify"
      ) {
        const callable = parentheses(operation.arguments[0]);
        if (
          callable.type === "ArrowFunctionExpression" ||
          callable.type === "FunctionExpression"
        ) {
          const parameter = callable.params[0];
          if (
            parameter !== undefined && parameter.type !== "TSParameterProperty"
          ) return parameter.typeAnnotation?.typeAnnotation;
        }
      }
    }
    return undefined;
  }
  function runner(target_: Target): Expression {
    const name = target_.imported + "_terminal";
    if (target_.namespace !== undefined) return member(target_.namespace, name);
    return services.terminal(name, target_.local);
  }
  function terminal_program(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (!plain_call(outer, 1) || target(outer.callee)?.imported !== "run") {
      return undefined;
    }
    const handled = parentheses(outer.arguments[0] as Expression);
    if (handled.type !== "CallExpression" || !plain_call(handled, 2)) {
      return undefined;
    }
    const handler = target(handled.callee);
    if (handler === undefined || handler.imported === "run") return undefined;
    const kind = terminal_kind(handler.imported);
    const argument = parentheses(handled.arguments[0] as Expression);
    let program = argument;
    let candidate:
      | { program: CallExpression; statement: VariableDeclaration }
      | undefined;
    if (argument.type === "Identifier") {
      candidate = named.get(services.bindings.resolve(argument));
      if (candidate !== undefined) program = candidate.program;
    }
    if (
      program.type !== "CallExpression" || !plain_call(program, 1) ||
      services.kind(program) !== "program"
    ) return undefined;
    const run = program.arguments[0];
    if (
      run.type !== "FunctionExpression" || !valid_generator(run) ||
      lexical_hazard(run.body!) ||
      lexical_hazard(handled.arguments[1]) ||
      contains_await_yield(handled.arguments[1])
    ) return undefined;
    const body = read_body(run.body!);
    if (body === undefined) return undefined;
    const can_fuse = services.config.optimizations?.terminal_body !== false &&
      body.parts.every((part) => {
        if (part.kind !== "yield") return true;
        const operation = primitive(part.expression);
        return operation !== undefined &&
          primitive_kind(operation.name) === kind;
      }) && (kind === "writer" || input_type(body, kind) !== undefined);
    if (!can_fuse) {
      return {
        expression: { ...handled, callee: runner(handler) },
        direct: false,
      };
    }
    if (candidate !== undefined) removed.add(candidate.statement);
    return {
      expression: emit(body, handled.arguments[1] as Expression, kind),
      direct: true,
    };
  }
  function terminal_lift(outer: CallExpression): Expression | undefined {
    if (!plain_call(outer, 1) || target(outer.callee)?.imported !== "run") {
      return undefined;
    }
    const handled = parentheses(outer.arguments[0] as Expression);
    if (
      handled.type !== "CallExpression" || handled.optional ||
      (handled.arguments.length !== 2 && handled.arguments.length !== 3)
    ) return undefined;
    const handler = target(handled.callee);
    if (
      handler === undefined || handler.imported === "run" ||
      handled.arguments.some((argument) => argument.type === "SpreadElement")
    ) return undefined;
    const types = handled.typeArguments?.params;
    if (types === undefined) return { ...handled, callee: runner(handler) };
    if (handled.arguments.length === 3) return undefined;
    let params: TSType[];
    switch (handler.imported) {
      case "run_reader":
      case "run_state":
        if (types.length !== 3) return undefined;
        params = [types[1], types[2]];
        break;
      case "run_writer":
        if (types.length !== 4) return undefined;
        params = [types[0], types[1], types[3]];
        break;
    }
    return {
      ...handled,
      callee: runner(handler),
      typeArguments: node({ type: "TSTypeParameterInstantiation", params }),
    };
  }
  function effect_method(expression: Expression, name: string): boolean {
    if (
      expression.type !== "MemberExpression" || expression.computed ||
      expression.optional || expression.property.type !== "Identifier" ||
      expression.property.name !== name
    ) return false;
    const object = expression.object;
    if (imported(object, services.imports.effect_names)) return true;
    return object.type === "MemberExpression" && !object.computed &&
      !object.optional && object.property.type === "Identifier" &&
      object.property.name === "Effect" &&
      imported(object.object, services.imports.namespaces);
  }
  function handler_apply(
    handler: Expression,
    argument: Expression,
  ): Expression {
    const value = parentheses(handler);
    if (
      value.type === "ArrowFunctionExpression" && !value.async &&
      value.params.length === 1 && value.params[0].type === "Identifier" &&
      !value.params[0].typeAnnotation && value.body.type === "CallExpression"
    ) {
      const name = value.params[0].name;
      const body = value.body;
      let count = 0;
      let unsafe = false;
      walk(body, (child, parent) => {
        if (child.type !== "Identifier" || child.name !== name) return;
        if (parent === body && body.arguments.includes(child as Argument)) {
          count += 1;
        } else unsafe = true;
      });
      if (count === 1 && !unsafe) {
        return {
          ...value.body,
          arguments: value.body.arguments.map((item) => {
            if (item.type === "Identifier" && item.name === name) {
              return argument;
            }
            return item;
          }),
        };
      }
    }
    return call(handler, [argument]);
  }
  function interpreter_effect(expression: Expression): Expression | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || value.optional ||
      value.typeArguments != null || value.arguments.length !== 1 ||
      value.arguments[0].type === "SpreadElement"
    ) return undefined;
    if (effect_method(value.callee, "interpret")) return value.arguments[0];
    if (
      value.callee.type !== "MemberExpression" || value.callee.computed ||
      value.callee.optional || value.callee.property.type !== "Identifier" ||
      value.callee.property.name !== "handle" ||
      !static_handler(value.arguments[0])
    ) return undefined;
    const effect = interpreter_effect(value.callee.object);
    if (effect === undefined) return undefined;
    return handler_apply(value.arguments[0], effect);
  }
  function effect_lower(value: CallExpression): Expression | undefined {
    if (
      value.optional || value.typeArguments != null ||
      value.arguments.some((argument) => argument.type === "SpreadElement")
    ) return undefined;
    if (effect_method(value.callee, "handle_with")) {
      if (value.arguments.length !== 2) return undefined;
      const handlers = value.arguments[1];
      if (
        handlers.type !== "ArrayExpression" ||
        handlers.elements.some((element) =>
          element === null || element.type === "SpreadElement" ||
          !static_handler(element)
        )
      ) return undefined;
      let effect = value.arguments[0] as Expression;
      for (const handler of handlers.elements) {
        effect = handler_apply(handler as Expression, effect);
      }
      return effect;
    }
    if (
      value.callee.type !== "MemberExpression" || value.callee.computed ||
      value.callee.optional || value.callee.property.type !== "Identifier"
    ) return undefined;
    const name = value.callee.property.name;
    if (name !== "run" && name !== "value") return undefined;
    const effect = interpreter_effect(value.callee.object);
    if (effect === undefined) return undefined;
    if (name === "value" && value.arguments.length === 0) return effect;
    if (
      name === "run" && value.arguments.length === 1 &&
      static_handler(value.arguments[0] as Expression)
    ) return handler_apply(value.arguments[0] as Expression, effect);
    return undefined;
  }
  function emit(body: Body, input: Expression, kind: TerminalKind): Expression {
    const input_thunk = services.fresh(kind + "_input");
    let current_name = "output";
    if (kind === "reader") current_name = "environment";
    if (kind === "state") current_name = "state";
    const current = services.fresh(current_name);
    const statements: Statement[] = [];
    let initialized = false;
    let returned = false;
    for (const part of body.parts) {
      if (part.kind === "statement") {
        statements.push(part.statement);
        continue;
      }
      const operation = primitive(part.expression)!;
      const arguments_ = operation.arguments.map((argument, index) => {
        const temporary = services.fresh(operation.name + "_argument_" + index);
        let type: TSType | undefined;
        if (index === 0 && operation.types !== undefined) {
          switch (operation.name) {
            case "asks":
            case "gets":
              type = function_type(operation.types[0], operation.types[1]);
              break;
            case "modify":
              type = function_type(operation.types[0], operation.types[0]);
              break;
            case "put":
              type = operation.types[0];
              break;
          }
        }
        statements.push(
          variable(
            temporary,
            node({
              type: "SequenceExpression",
              expressions: [void_zero(), argument],
            }),
            "const",
            type,
          ),
        );
        return temporary;
      });
      if (!initialized) {
        let declaration_kind: "const" | "let" = "let";
        if (kind === "reader") declaration_kind = "const";
        statements.push(
          variable(
            current,
            call(input_thunk, []),
            declaration_kind,
            input_type(body, kind),
          ),
        );
        initialized = true;
      }
      let value: Expression;
      switch (operation.name) {
        case "ask":
        case "get":
          value = current;
          break;
        case "asks":
        case "gets":
          value = call(arguments_[0], [current]);
          break;
        case "put":
          statements.push(assign(current, arguments_[0]));
          value = void_zero();
          break;
        case "modify":
          statements.push(assign(current, call(arguments_[0], [current])));
          value = void_zero();
          break;
        case "writer":
          statements.push(
            assign(current, call(member(current, "concat"), [arguments_[1]])),
          );
          value = arguments_[0];
          break;
        case "tell":
          statements.push(
            assign(current, call(member(current, "concat"), [arguments_[0]])),
          );
          value = void_zero();
          break;
      }
      if (
        operation.types !== undefined &&
        (operation.name === "ask" || operation.name === "get")
      ) {
        const typed = services.fresh(operation.name + "_value");
        statements.push(variable(typed, value, "const", operation.types[0]));
        value = typed;
      }
      if (part.returns) {
        statements.push(ret(output(value, current, kind)));
        returned = true;
      } else if (part.binding !== undefined) {
        statements.push({
          ...part.binding.statement,
          declarations: [{ ...part.binding.declaration, init: value }],
        });
      } else if (operation.name === "asks" || operation.name === "gets") {
        statements.push(
          node({ type: "ExpressionStatement", expression: value }),
        );
      }
    }
    if (!returned) {
      statements.push(ret(output(body.result ?? void_zero(), current, kind)));
    }
    return call(arrow([input_thunk], block(statements)), [arrow([], input)]);
  }
  function collect_named() {
    const candidates = new Map<
      Node | null,
      {
        program: CallExpression;
        statement: VariableDeclaration;
        owner: Node;
        name: Node;
        kind: TerminalKind;
      }
    >();
    if (
      services.config.optimizations?.terminal === false ||
      services.config.optimizations?.terminal_body === false
    ) return candidates;
    const nodes: { statement: Statement; owner: Node }[] = [];
    walk(services.program, (parent) => {
      if (parent.type !== "Program" && parent.type !== "BlockStatement") return;
      for (const statement of parent.body) {
        if (
          statement.type !== "ExpressionStatement" ||
          !("directive" in statement && statement.directive != null)
        ) nodes.push({ statement: statement as Statement, owner: parent });
      }
    });
    for (const { statement, owner } of nodes) {
      if (
        statement.type !== "VariableDeclaration" ||
        statement.kind !== "const" || statement.declare ||
        statement.declarations.length !== 1
      ) continue;
      const declaration = statement.declarations[0];
      if (
        declaration.id.type !== "Identifier" || declaration.id.typeAnnotation ||
        declaration.init === null
      ) continue;
      const program = parentheses(declaration.init);
      if (
        program.type !== "CallExpression" || !plain_call(program, 1) ||
        services.kind(program) !== "program"
      ) continue;
      const run = program.arguments[0];
      if (
        run.type !== "FunctionExpression" || !valid_generator(run) ||
        lexical_hazard(run.body!)
      ) continue;
      const body = read_body(run.body!);
      const first = body?.parts[0];
      if (body === undefined || first?.kind !== "yield") continue;
      const operation = primitive(first.expression);
      if (
        operation === undefined ||
        (operation.name !== "ask" && operation.name !== "get")
      ) continue;
      const kind = primitive_kind(operation.name);
      if (
        input_type(body, kind) === undefined || !body.parts.every((part) => {
          if (part.kind !== "yield") return true;
          const operation = primitive(part.expression);
          return operation !== undefined &&
            primitive_kind(operation.name) === kind;
        })
      ) continue;
      candidates.set(services.bindings.resolve(declaration.id), {
        program,
        statement,
        owner,
        name: declaration.id,
        kind,
      });
    }
    const allowed = new Set<Node>();
    const used = new Set<Node | null>();
    for (const { statement, owner } of nodes) {
      let expression: Expression | null | undefined;
      if (statement.type === "ExpressionStatement") {
        expression = statement.expression;
      }
      if (statement.type === "ReturnStatement") expression = statement.argument;
      if (
        statement.type === "VariableDeclaration" &&
        statement.declarations.length === 1
      ) expression = statement.declarations[0].init;
      if (
        expression == null || expression.type !== "CallExpression" ||
        !plain_call(expression, 1) ||
        target(expression.callee)?.imported !== "run"
      ) continue;
      const handled = expression.arguments[0];
      if (
        handled.type !== "CallExpression" || !plain_call(handled, 2) ||
        lexical_hazard(handled.arguments[1]) ||
        contains_await_yield(handled.arguments[1])
      ) continue;
      const handler = target(handled.callee);
      const name = handled.arguments[0];
      if (
        handler === undefined || handler.imported === "run" ||
        name.type !== "Identifier"
      ) continue;
      const key = services.bindings.resolve(name);
      const candidate = candidates.get(key);
      if (
        candidate === undefined || candidate.owner !== owner ||
        candidate.program.end >= name.start ||
        terminal_kind(handler.imported) !== candidate.kind
      ) continue;
      allowed.add(name);
      used.add(key);
    }
    walk(services.program, (child) => {
      if (child.type !== "Identifier") return;
      const key = services.bindings.resolve(child);
      const candidate = candidates.get(key);
      if (
        candidate !== undefined && candidate.name !== child &&
        !allowed.has(child)
      ) candidates.delete(key);
    });
    for (const key of candidates.keys()) {
      if (!used.has(key)) candidates.delete(key);
    }
    return candidates;
  }
  return {
    lower(
      value: CallExpression,
      phase: "before" | "after" = "after",
    ): { expression: Expression; direct: boolean } | undefined {
      if (services.config.optimizations?.terminal !== false) {
        const fused = terminal_program(value);
        if (fused !== undefined) return fused;
        if (phase === "before") return undefined;
        const lift = terminal_lift(value);
        if (lift !== undefined) return { expression: lift, direct: false };
      }
      if (
        phase === "after" &&
        services.config.optimizations?.interpreter !== false
      ) {
        const expression = effect_lower(value);
        if (expression !== undefined) return { expression, direct: false };
      }
      return undefined;
    },
    remove(statement: Node): boolean {
      return removed.has(statement);
    },
    skip(statement: Node): boolean {
      for (const candidate of named.values()) {
        if (candidate.statement === statement) return true;
      }
      return false;
    },
  };
}

function parentheses(expression: Expression): Expression {
  // Primitive fusion deliberately does not erase TS assertions or non-null checks.
  let value = expression;
  while (value.type === "ParenthesizedExpression") value = value.expression;
  return value;
}
function plain_call(value: CallExpression, arity: number): boolean {
  return !value.optional && value.typeArguments == null &&
    value.arguments.length === arity &&
    value.arguments.every((argument) => argument.type !== "SpreadElement");
}
function valid_generator(value: FunctionNode): boolean {
  return value.type === "FunctionExpression" && value.generator &&
    !value.async && value.id === null && value.params.length === 0 &&
    value.typeParameters == null && value.returnType == null &&
    value.body !== null;
}
function primitive_arity(name: PrimitiveFunctionName, arity: number): boolean {
  switch (name) {
    case "ask":
    case "get":
      return arity === 0;
    case "writer":
      return arity === 2;
    default:
      return arity === 1;
  }
}
function primitive_kind(name: PrimitiveFunctionName): TerminalKind {
  switch (name) {
    case "ask":
    case "asks":
      return "reader";
    case "get":
    case "gets":
    case "put":
    case "modify":
      return "state";
    case "writer":
    case "tell":
      return "writer";
  }
}
function terminal_kind(
  name: Exclude<TerminalFunctionName, "run">,
): TerminalKind {
  switch (name) {
    case "run_reader":
      return "reader";
    case "run_state":
      return "state";
    case "run_writer":
      return "writer";
  }
}
function self_typed(expression: Expression): boolean {
  let valid = true;
  let found = false;
  walk(expression, (child) => {
    if (
      child.type !== "ArrowFunctionExpression" &&
      child.type !== "FunctionExpression"
    ) return;
    found = true;
    valid &&= child.typeParameters == null && child.params.length > 0 &&
      child.params.every((parameter) =>
        parameter.type !== "RestElement" &&
        parameter.type !== "TSParameterProperty" &&
        parameter.typeAnnotation != null &&
        !(parameter.type === "Identifier" && parameter.name === "this")
      );
    return false;
  });
  return valid && found;
}
function lexical_hazard(root: Node): boolean {
  let found = false;
  walk(root, (child, parent) => {
    if (
      child.type === "ThisExpression" || child.type === "Super" ||
      child.type === "MetaProperty" ||
      (child.type === "CallExpression" && !child.optional &&
        child.callee.type === "Identifier" && child.callee.name === "eval")
    ) found = true;
    if (child.type === "Identifier" && child.name === "arguments") {
      if (
        parent?.type === "MemberExpression" && !parent.computed &&
        parent.property === child
      ) return;
      if (
        parent?.type === "Property" && !parent.computed &&
        parent.key === child && !parent.shorthand
      ) return;
      found = true;
    }
  });
  return found;
}
function contains_await_yield(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (function_like(child)) return false;
    if (child.type === "AwaitExpression" || child.type === "YieldExpression") {
      found = true;
    }
  });
  return found;
}
function function_like(value: Node): boolean {
  return value.type === "FunctionDeclaration" ||
    value.type === "FunctionExpression" ||
    value.type === "ArrowFunctionExpression";
}
function control_hazard(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (function_like(child)) return false;
    if (
      child.type === "YieldExpression" || child.type === "ReturnStatement" ||
      child.type === "BreakStatement" || child.type === "ContinueStatement"
    ) found = true;
  });
  return found;
}
function yielded(value: Expression | null): Expression | undefined {
  if (
    value?.type === "YieldExpression" && value.delegate &&
    value.argument !== null && !contains_await_yield(value.argument)
  ) return value.argument;
  return undefined;
}
function read_body(body: BlockStatement): Body | undefined {
  const parts: Body["parts"] = [];
  let has_yield = false;
  for (let index = 0; index < body.body.length; index += 1) {
    const statement = body.body[index];
    if (
      statement.type === "ExpressionStatement" && "directive" in statement &&
      statement.directive != null
    ) {
      parts.push({ kind: "statement", statement });
      continue;
    }
    let part: YieldPart | undefined;
    if (
      statement.type === "VariableDeclaration" &&
      statement.declarations.length === 1
    ) {
      const declaration = statement.declarations[0];
      const expression = yielded(declaration.init);
      if (expression !== undefined) {
        part = {
          kind: "yield",
          expression,
          binding: { statement, declaration },
          returns: false,
        };
      }
    }
    if (statement.type === "ExpressionStatement") {
      const expression = yielded(statement.expression);
      if (expression !== undefined) {
        part = { kind: "yield", expression, returns: false };
      }
    }
    if (statement.type === "ReturnStatement") {
      const expression = yielded(statement.argument);
      if (expression !== undefined) {
        part = { kind: "yield", expression, returns: true };
      }
    }
    if (part !== undefined) {
      if (part.returns && index !== body.body.length - 1) return undefined;
      has_yield = true;
      parts.push(part);
      continue;
    }
    if (statement.type === "ReturnStatement") {
      if (
        !has_yield || index !== body.body.length - 1 ||
        (statement.argument !== null && control_hazard(statement.argument))
      ) return undefined;
      let result: Expression | undefined;
      if (statement.argument !== null) result = statement.argument;
      return { parts, result };
    }
    if (control_hazard(statement)) return undefined;
    parts.push({ kind: "statement", statement: statement as Statement });
  }
  if (!has_yield) return undefined;
  return { parts };
}
function static_handler(expression: Expression): boolean {
  const value = parentheses(expression);
  return value.type === "Identifier" || value.type === "MemberExpression" ||
    value.type === "ArrowFunctionExpression" ||
    value.type === "FunctionExpression";
}
function void_zero(): Expression {
  return node({
    type: "UnaryExpression",
    operator: "void",
    prefix: true,
    argument: node({ type: "Literal", value: 0, raw: "0" }),
  });
}
function variable(
  name: BindingPattern,
  init: Expression,
  kind: "const" | "let",
  type?: TSType,
): VariableDeclaration {
  let binding = name;
  if (type !== undefined) {
    binding = {
      ...name,
      typeAnnotation: node({ type: "TSTypeAnnotation", typeAnnotation: type }),
    } as BindingPattern;
  }
  return node({
    type: "VariableDeclaration",
    kind,
    declarations: [node({ type: "VariableDeclarator", id: binding, init })],
  });
}
function function_type(input: TSType, output: TSType): TSType {
  return node({
    type: "TSFunctionType",
    typeParameters: null,
    params: [{
      ...id("value"),
      typeAnnotation: node({ type: "TSTypeAnnotation", typeAnnotation: input }),
    }],
    returnType: node({ type: "TSTypeAnnotation", typeAnnotation: output }),
  });
}
function assign(left: IdentifierReference, right: Expression): Statement {
  return node({
    type: "ExpressionStatement",
    expression: node({
      type: "AssignmentExpression",
      operator: "=",
      left,
      right,
    }),
  });
}
function output(
  value: Expression,
  current: Expression,
  kind: TerminalKind,
): Expression {
  if (kind === "reader") return value;
  return node({
    type: "TSAsExpression",
    expression: node({ type: "ArrayExpression", elements: [value, current] }),
    typeAnnotation: node({
      type: "TSTypeReference",
      typeName: id("const"),
      typeArguments: null,
    }),
  });
}

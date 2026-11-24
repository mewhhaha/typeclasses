import type {
  Argument,
  BindingPattern,
  BlockStatement,
  CallExpression,
  ExportNamedDeclaration,
  Expression,
  Function as FunctionNode,
  IdentifierReference,
  Node,
  ObjectExpression,
  ObjectProperty,
  Statement,
  SwitchCase,
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
  CellRunnerName,
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
type YieldMatch = {
  readonly slot: number;
  readonly operation: Primitive;
};
type ControlAnalysis = {
  readonly yield_count: number;
  readonly has_control_flow: boolean;
  readonly has_prefix_before_first_yield: boolean;
};
type EmitSlot = {
  readonly kind: TerminalKind;
  readonly current: IdentifierReference;
  readonly input_expr: Expression;
  readonly input_thunk?: IdentifierReference;
  readonly ready?: IdentifierReference;
  readonly type?: TSType;
  readonly prop_name?: string;
  readonly prop_is_ident?: boolean;
};
type ParsedCellBinding = {
  readonly prop_name: string;
  readonly prop_is_ident: boolean;
  readonly family: TerminalKind;
  readonly cell_id: IdentifierReference;
  readonly cell_decl: Node;
  readonly init_expr: Expression;
  readonly writer_default: boolean;
  readonly prop_node: ObjectProperty;
  readonly provider_call: CallExpression;
};
type PreparedCellEntry = {
  readonly statement: Statement;
  readonly declaration: VariableDeclarator;
  readonly var_decl: VariableDeclaration;
  readonly exported: ExportNamedDeclaration | undefined;
  readonly obj: ObjectExpression;
  readonly bindings: readonly ParsedCellBinding[];
  hoisted_vars?: IdentifierReference[];
};
type NamedProgramCandidate = {
  readonly program: CallExpression;
  readonly statement: VariableDeclaration;
  readonly owner: Node;
  readonly name: Node;
};

/** Terminal dispatch, primitive fusion, multi-cell fusion, and static Effect interpreter lowering. */
export function create_terminal_transform(
  services: TransformServices,
  skip_statement?: (statement: Statement) => boolean,
) {
  const removed = new Set<Node>();
  const hoisted_statements = new Map<Node, Statement[]>();
  const prepared_cells = collect_prepared_cells();
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
  function cell_runner_target(
    expression: Expression,
  ): CellRunnerName | undefined {
    if (
      expression.type === "Identifier" && services.bindings.imported(expression)
    ) {
      return services.imports.cell_runners?.get(expression.name);
    }
    if (
      expression.type !== "MemberExpression" || expression.computed ||
      expression.optional ||
      expression.object.type !== "Identifier" ||
      expression.property.type !== "Identifier" ||
      !services.bindings.imported(expression.object)
    ) return undefined;
    const name = expression.property.name as CellRunnerName;
    if (
      services.imports.cell_runner_namespaces?.get(expression.object.name)?.has(
        name,
      )
    ) return name;
    return undefined;
  }
  function cell_provider_target(
    expression: Expression,
  ): TerminalKind | undefined {
    if (
      expression.type === "Identifier" && services.bindings.imported(expression)
    ) {
      return services.imports.cell_providers?.get(expression.name);
    }
    if (
      expression.type !== "MemberExpression" || expression.computed ||
      expression.optional ||
      expression.object.type !== "Identifier" ||
      expression.property.type !== "Identifier" ||
      !services.bindings.imported(expression.object)
    ) return undefined;
    const allowed = services.imports.cell_provider_namespaces?.get(
      expression.object.name,
    );
    if (allowed === undefined) return undefined;
    switch (expression.property.name) {
      case "provide_reader":
        return allowed.has("reader") ? "reader" : undefined;
      case "provide_state":
        return allowed.has("state") ? "state" : undefined;
      case "provide_writer":
        return allowed.has("writer") ? "writer" : undefined;
    }
    return undefined;
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
  function input_type_from_primitive(
    operation: Primitive,
  ): TSType | undefined {
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
    return undefined;
  }
  function input_type(body: Body, kind: TerminalKind): TSType | undefined {
    for (const part of body.parts) {
      if (part.kind !== "yield") continue;
      const operation = primitive(part.expression);
      if (operation === undefined || primitive_kind(operation.name) !== kind) {
        continue;
      }
      const found = input_type_from_primitive(operation);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  function input_type_in_block(
    body: BlockStatement,
    kind: TerminalKind,
  ): TSType | undefined {
    let found: TSType | undefined;
    walk(body, (child) => {
      if (found !== undefined || function_like(child)) return false;
      if (
        child.type === "YieldExpression" && child.delegate &&
        child.argument !== null
      ) {
        const operation = primitive(child.argument);
        if (
          operation !== undefined && primitive_kind(operation.name) === kind
        ) {
          found = input_type_from_primitive(operation);
          if (found !== undefined) return false;
        }
      }
    });
    return found;
  }
  function is_cell_factory_call(
    expression: Expression,
    kind: TerminalKind,
  ): boolean {
    const value = parentheses(expression);
    if (value.type !== "CallExpression" || value.optional) return false;
    const check_callee = (callee: Expression): boolean => {
      if (callee.type === "Identifier" && services.bindings.imported(callee)) {
        return services.imports.cell_factories?.get(callee.name) === kind;
      }
      if (
        callee.type === "MemberExpression" && !callee.computed &&
        !callee.optional && callee.object.type === "Identifier" &&
        callee.property.type === "Identifier" &&
        services.bindings.imported(callee.object)
      ) {
        const allowed = services.imports.cell_namespaces?.get(
          callee.object.name,
        );
        if (allowed === undefined || !allowed.has(kind)) return false;
        switch (kind) {
          case "reader":
            return callee.property.name === "reader";
          case "state":
            return callee.property.name === "state";
          case "writer":
            return callee.property.name === "writer_cell";
        }
      }
      return false;
    };
    if (check_callee(value.callee)) return true;
    // Curried cell factories: `reader<Config>()("config")`, `state<number>()("count")`
    const inner = parentheses(value.callee);
    return (kind === "reader" || kind === "state") &&
      inner.type === "CallExpression" && !inner.optional &&
      inner.arguments.length === 0 && check_callee(inner.callee);
  }
  function resolve_cell(
    expression: Expression,
    kind: TerminalKind,
  ):
    | { readonly identifier: IdentifierReference; readonly declaration: Node }
    | undefined {
    const value = parentheses(expression);
    if (value.type !== "Identifier") return undefined;
    const declaration = services.bindings.resolve(value);
    if (
      declaration === null || declaration.type !== "VariableDeclarator" ||
      declaration.init === null
    ) return undefined;
    const owner = services.bindings.parent(declaration);
    if (
      owner === null || owner.type !== "VariableDeclaration" ||
      owner.kind !== "const"
    ) return undefined;
    if (!is_cell_factory_call(declaration.init, kind)) return undefined;
    return { identifier: value, declaration };
  }
  function resolve_any_cell(
    expression: Expression,
  ):
    | {
      readonly identifier: IdentifierReference;
      readonly declaration: Node;
      readonly kind: TerminalKind;
    }
    | undefined {
    for (const kind of ["reader", "state", "writer"] as const) {
      const found = resolve_cell(expression, kind);
      if (found !== undefined) return { ...found, kind };
    }
    return undefined;
  }
  function cell_primitive(
    expression: Expression,
    cell_declaration: Node,
    kind: TerminalKind,
  ): Primitive | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || value.optional ||
      value.typeArguments != null ||
      value.arguments.some((argument) => argument.type === "SpreadElement")
    ) return undefined;
    if (
      value.callee.type !== "MemberExpression" || value.callee.computed ||
      value.callee.optional || value.callee.object.type !== "Identifier" ||
      value.callee.property.type !== "Identifier" ||
      services.bindings.resolve(value.callee.object) !== cell_declaration
    ) return undefined;
    let name: PrimitiveFunctionName | undefined;
    switch (kind) {
      case "reader":
        if (value.callee.property.name === "ask") name = "ask";
        else if (value.callee.property.name === "asks") name = "asks";
        break;
      case "state":
        switch (value.callee.property.name) {
          case "get":
          case "gets":
          case "put":
          case "modify":
            name = value.callee.property.name;
            break;
        }
        break;
      case "writer":
        if (value.callee.property.name === "tell") name = "tell";
        else if (value.callee.property.name === "write") name = "writer";
        break;
    }
    if (name === undefined || !primitive_arity(name, value.arguments.length)) {
      return undefined;
    }
    return { name, arguments: value.arguments as Expression[] };
  }
  function cell_input_type(
    cell_id: IdentifierReference,
    kind: TerminalKind,
  ): TSType | undefined {
    if (kind === "writer") return undefined;
    const method_name = kind === "reader" ? "ask" : "get";
    const ask_value_type: TSType = node({
      type: "TSIndexedAccessType",
      objectType: node({
        type: "TSTypeReference",
        typeName: id("ReturnType"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from([
            node({
              type: "TSTypeQuery",
              exprName: node({
                type: "TSQualifiedName",
                left: id(cell_id.name),
                right: id(method_name),
              }),
              typeArguments: null,
            }) as TSType,
          ]),
        }),
      }),
      indexType: node({
        type: "TSLiteralType",
        literal: node({ type: "Literal", value: "value", raw: '"value"' }),
      }),
    });
    const raw_fn_type: TSType = node({
      type: "TSTypeReference",
      typeName: id("ReturnType"),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from([ask_value_type]),
      }),
    });
    const params_tuple: TSType = node({
      type: "TSTypeReference",
      typeName: id("Parameters"),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from([raw_fn_type]),
      }),
    });
    return node({
      type: "TSIndexedAccessType",
      objectType: params_tuple,
      indexType: node({
        type: "TSLiteralType",
        literal: node({ type: "Literal", value: 0, raw: "0" }),
      }),
    });
  }
  function writer_default_empty_expr(
    cell_id: IdentifierReference,
  ): Expression {
    return node({
      type: "MemberExpression",
      object: call(
        member(
          call(member(id(cell_id.name), "pure"), [void_zero()]),
          "value",
        ),
        [],
      ),
      property: node({ type: "Literal", value: 1, raw: "1" }),
      computed: true,
      optional: false,
    });
  }
  function parse_cell_bindings_object(
    expression: Expression,
  ): ParsedCellBinding[] | undefined {
    const obj = parentheses(expression);
    if (obj.type !== "ObjectExpression" || obj.properties.length === 0) {
      return undefined;
    }
    const seen_names = new Set<string>();
    const parsed: ParsedCellBinding[] = [];
    for (const property of obj.properties) {
      if (
        property.type !== "Property" || property.kind !== "init" ||
        property.computed || property.method
      ) return undefined;
      let prop_name: string;
      let prop_is_ident = false;
      if (property.key.type === "Identifier") {
        prop_name = property.key.name;
        prop_is_ident = true;
      } else if (
        property.key.type === "Literal" &&
        typeof property.key.value === "string"
      ) {
        prop_name = property.key.value;
      } else {
        return undefined;
      }
      if (prop_name === "__proto__" || seen_names.has(prop_name)) {
        return undefined;
      }
      seen_names.add(prop_name);
      const val = parentheses(property.value as Expression);
      if (
        val.type !== "CallExpression" || val.optional ||
        val.typeArguments != null ||
        val.arguments.some((argument) => argument.type === "SpreadElement")
      ) return undefined;
      const family = cell_provider_target(val.callee);
      if (family === undefined) return undefined;
      if (
        (family === "reader" || family === "state") &&
        val.arguments.length !== 2
      ) return undefined;
      if (
        family === "writer" &&
        val.arguments.length !== 1 && val.arguments.length !== 2
      ) return undefined;
      const resolved = resolve_cell(val.arguments[0] as Expression, family);
      if (resolved === undefined) return undefined;
      const writer_default = family === "writer" && val.arguments.length === 1;
      const init_expr = writer_default
        ? writer_default_empty_expr(resolved.identifier)
        : val.arguments[1] as Expression;
      if (
        !writer_default &&
        (lexical_hazard(init_expr) || contains_await_yield(init_expr))
      ) return undefined;
      parsed.push({
        prop_name,
        prop_is_ident,
        family,
        cell_id: resolved.identifier,
        cell_decl: resolved.declaration,
        init_expr,
        writer_default,
        prop_node: property,
        provider_call: val,
      });
    }
    return parsed;
  }
  function collect_prepared_cells(): Map<Node, PreparedCellEntry> {
    const entries = new Map<Node, PreparedCellEntry>();
    if (
      services.config.optimizations?.terminal === false ||
      services.config.optimizations?.terminal_body === false ||
      ((services.imports.cell_runners?.size ?? 0) === 0 &&
        (services.imports.cell_runner_namespaces?.size ?? 0) === 0)
    ) return entries;
    const visit_block = (statements: readonly Statement[]) => {
      for (const raw of statements) {
        let statement = raw;
        let exported: ExportNamedDeclaration | undefined;
        if (
          statement.type === "ExportNamedDeclaration" &&
          statement.declaration !== null
        ) {
          exported = statement;
          statement = statement.declaration as Statement;
        }
        if (
          statement.type === "VariableDeclaration" &&
          statement.kind === "const" && !statement.declare &&
          statement.declarations.length === 1
        ) {
          const declaration = statement.declarations[0];
          if (
            declaration.id.type === "Identifier" &&
            !declaration.id.typeAnnotation && declaration.init !== null
          ) {
            const init = parentheses(declaration.init);
            if (
              init.type === "CallExpression" && plain_call(init, 1) &&
              cell_runner_target(init.callee) === "prepare_cells"
            ) {
              const bindings = parse_cell_bindings_object(
                init.arguments[0] as Expression,
              );
              if (bindings !== undefined) {
                const key = services.bindings.resolve(declaration.id);
                if (key !== null) {
                  entries.set(key, {
                    statement: raw,
                    declaration,
                    var_decl: statement,
                    exported,
                    obj: parentheses(
                      init.arguments[0] as Expression,
                    ) as ObjectExpression,
                    bindings,
                  });
                }
              }
            }
          }
        }
      }
    };
    const prep_tokens = [
      "prepare_cells",
      ...(services.imports.cell_runners !== undefined
        ? [...services.imports.cell_runners.keys()]
        : []),
    ];
    const has_prep = create_span_scanner(services.source, prep_tokens);
    for (const stmt of services.program.body) {
      if (stmt.type === "ImportDeclaration") continue;
      if (skip_statement?.(stmt as Statement)) continue;
      if (!has_prep(stmt.start, stmt.end)) continue;
      visit_block([stmt as Statement]);
      walk(stmt, (child) => {
        if (child.type === "BlockStatement") {
          visit_block(child.body as Statement[]);
        }
      });
    }
    return entries;
  }
  function ensure_prepared_hoists(
    entry: PreparedCellEntry,
  ): IdentifierReference[] {
    if (entry.hoisted_vars !== undefined) return entry.hoisted_vars;
    const hoisted_vars: IdentifierReference[] = [];
    const prefix_decls: Statement[] = [];
    const new_props = entry.bindings.map((binding, index) => {
      const temp = services.fresh("prepared_cell_" + index);
      hoisted_vars.push(temp);
      prefix_decls.push(variable(temp, binding.init_expr, "const"));
      const new_call: CallExpression = {
        ...binding.provider_call,
        arguments: binding.writer_default
          ? [binding.provider_call.arguments[0], temp]
          : [binding.provider_call.arguments[0], temp],
      };
      return {
        ...binding.prop_node,
        value: new_call,
      };
    });
    const new_obj: ObjectExpression = {
      ...entry.obj,
      properties: new_props,
    };
    const orig_call = parentheses(
      entry.declaration.init as Expression,
    ) as CallExpression;
    const new_var_decl: VariableDeclaration = {
      ...entry.var_decl,
      declarations: [{
        ...entry.declaration,
        init: { ...orig_call, arguments: [new_obj] },
      }],
    };
    const rewritten: Statement = entry.exported !== undefined
      ? { ...entry.exported, declaration: new_var_decl }
      : new_var_decl;
    entry.hoisted_vars = hoisted_vars;
    hoisted_statements.set(entry.statement, [...prefix_decls, rewritten]);
    return hoisted_vars;
  }
  function runner(target_: Target): Expression {
    const name = target_.imported + "_terminal";
    if (target_.namespace !== undefined) return member(target_.namespace, name);
    return services.terminal(name, target_.local);
  }
  function resolve_program_arg(argument: Expression): {
    program: CallExpression;
    candidate?: NamedProgramCandidate;
  } | undefined {
    const expr = parentheses(argument);
    let program = expr;
    let candidate: NamedProgramCandidate | undefined;
    if (expr.type === "Identifier") {
      candidate = named.get(services.bindings.resolve(expr));
      if (candidate !== undefined) program = candidate.program;
    }
    if (
      program.type !== "CallExpression" || !plain_call(program, 1) ||
      services.kind(program) !== "program"
    ) return undefined;
    return { program, candidate };
  }
  function analyze_control_body(
    body: BlockStatement,
    match_yield: (expression: Expression) => YieldMatch | undefined,
  ): ControlAnalysis | undefined {
    let yield_count = 0;
    let has_control_flow = false;
    let has_prefix_before_first_yield = false;
    let saw_any_non_directive = false;

    function visit_stmt(
      statement: Statement,
      in_loop: boolean,
      in_switch: boolean,
      in_control: boolean,
    ): boolean {
      if (
        statement.type === "ExpressionStatement" && "directive" in statement &&
        statement.directive != null
      ) return true;
      if (
        statement.type === "VariableDeclaration" &&
        statement.declarations.length === 1
      ) {
        const expr = yielded(statement.declarations[0].init);
        if (expr !== undefined) {
          if (match_yield(expr) === undefined) return false;
          if (yield_count === 0 && saw_any_non_directive) {
            has_prefix_before_first_yield = true;
          }
          if (in_control) has_control_flow = true;
          yield_count += 1;
          return true;
        }
      }
      if (statement.type === "ExpressionStatement") {
        const expr = yielded(statement.expression);
        if (expr !== undefined) {
          if (match_yield(expr) === undefined) return false;
          if (yield_count === 0 && saw_any_non_directive) {
            has_prefix_before_first_yield = true;
          }
          if (in_control) has_control_flow = true;
          yield_count += 1;
          return true;
        }
      }
      if (statement.type === "ReturnStatement") {
        const expr = yielded(statement.argument);
        if (expr !== undefined) {
          if (match_yield(expr) === undefined) return false;
          if (yield_count === 0 && saw_any_non_directive) {
            has_prefix_before_first_yield = true;
          }
          if (in_control) has_control_flow = true;
          yield_count += 1;
          return true;
        }
        if (statement.argument !== null && control_hazard(statement.argument)) {
          return false;
        }
        if (in_control) has_control_flow = true;
        return true;
      }
      if (statement.type === "EmptyStatement") return true;
      if (statement.type === "BreakStatement") {
        return statement.label === null && (in_loop || in_switch);
      }
      if (statement.type === "ContinueStatement") {
        return statement.label === null && in_loop;
      }
      if (statement.type === "BlockStatement") {
        if (!in_control && yield_count === 0 && saw_any_non_directive) {
          // Keep prefix tracking accurate inside nested blocks.
        }
        for (const inner of statement.body) {
          if (!visit_stmt(inner as Statement, in_loop, in_switch, true)) {
            return false;
          }
        }
        return true;
      }
      if (statement.type === "IfStatement") {
        if (control_hazard(statement.test)) return false;
        const before = yield_count;
        if (!visit_stmt(statement.consequent, in_loop, in_switch, true)) {
          return false;
        }
        if (
          statement.alternate !== null &&
          !visit_stmt(statement.alternate, in_loop, in_switch, true)
        ) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (statement.type === "ForStatement") {
        if (
          (statement.init !== null && control_hazard(statement.init)) ||
          (statement.test !== null && control_hazard(statement.test)) ||
          (statement.update !== null && control_hazard(statement.update))
        ) return false;
        const before = yield_count;
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (
        statement.type === "WhileStatement" ||
        statement.type === "DoWhileStatement"
      ) {
        if (control_hazard(statement.test)) return false;
        const before = yield_count;
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (
        statement.type === "ForOfStatement" ||
        statement.type === "ForInStatement"
      ) {
        if (
          (statement.type === "ForOfStatement" && statement.await) ||
          control_hazard(statement.left) || control_hazard(statement.right)
        ) return false;
        const before = yield_count;
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (statement.type === "SwitchStatement") {
        if (control_hazard(statement.discriminant)) return false;
        const before = yield_count;
        for (const item of statement.cases) {
          if (item.test !== null && control_hazard(item.test)) return false;
          for (const inner of item.consequent) {
            if (!visit_stmt(inner as Statement, in_loop, true, true)) {
              return false;
            }
          }
        }
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (control_hazard(statement)) return false;
      if (yield_count === 0) saw_any_non_directive = true;
      return true;
    }

    for (let index = 0; index < body.body.length; index += 1) {
      const stmt = body.body[index] as Statement;
      if (
        stmt.type === "ReturnStatement" && index < body.body.length - 1
      ) has_control_flow = true;
      if (!visit_stmt(stmt, false, false, false)) return undefined;
    }
    if (yield_count === 0) return undefined;
    return {
      yield_count,
      has_control_flow,
      has_prefix_before_first_yield,
    };
  }
  function emit_multi_control(
    body: BlockStatement,
    slots: readonly EmitSlot[],
    match_yield: (expression: Expression) => YieldMatch | undefined,
    build_return: (value: Expression) => Expression,
    options: {
      readonly eager_init: boolean;
      readonly direct_params?: readonly {
        readonly param: IdentifierReference;
        readonly type?: TSType;
        readonly init: Expression;
      }[];
      readonly wrap_dictionary?: Expression;
    },
  ): Expression {
    const out_statements: Statement[] = [];
    const eager = options.eager_init;

    const emit_slot_ensure = (slot: EmitSlot, target_stmts: Statement[]) => {
      if (eager || slot.ready === undefined || slot.input_thunk === undefined) {
        return;
      }
      target_stmts.push(
        node({
          type: "IfStatement",
          test: node({
            type: "UnaryExpression",
            operator: "!",
            prefix: true,
            argument: slot.ready,
          }),
          consequent: block([
            assign(slot.current, call(slot.input_thunk, [])),
            assign(
              slot.ready,
              node({ type: "Literal", value: true, raw: "true" }),
            ),
          ]),
          alternate: null,
        }),
      );
    };
    const emit_all_ensure = (target_stmts: Statement[]) => {
      if (eager) return;
      for (const slot of slots) emit_slot_ensure(slot, target_stmts);
    };

    // Declare slots at the top of the fused block.
    for (const slot of slots) {
      const decl_kind: "const" | "let" = slot.kind === "reader" && eager
        ? "const"
        : "let";
      if (eager) {
        const init_val = slot.input_thunk !== undefined
          ? call(slot.input_thunk, [])
          : slot.input_expr;
        out_statements.push(
          variable(slot.current, init_val, decl_kind, slot.type),
        );
      } else {
        out_statements.push(
          variable(
            slot.current,
            node({
              type: "TSAsExpression",
              expression: void_zero(),
              typeAnnotation: node({ type: "TSNeverKeyword" }),
            }),
            "let",
            slot.type,
          ),
        );
        out_statements.push(
          variable(
            slot.ready!,
            node({ type: "Literal", value: false, raw: "false" }),
            "let",
          ),
        );
      }
    }

    function emit_yield_op(
      matched: YieldMatch,
      target_stmts: Statement[],
    ): Expression {
      const slot = slots[matched.slot];
      const operation = matched.operation;
      const arguments_ = operation.arguments.map((argument, index) => {
        const temporary = services.fresh(operation.name + "_argument_" + index);
        let typed_arg = argument;
        let type: TSType | undefined;
        if (index === 0) {
          if (operation.types !== undefined) {
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
          } else if (slot.type !== undefined) {
            if (
              operation.name === "asks" || operation.name === "gets" ||
              operation.name === "modify"
            ) {
              typed_arg = annotate_callback(argument, slot.type);
            } else if (operation.name === "put") {
              type = slot.type;
            }
          }
        }
        target_stmts.push(
          variable(
            temporary,
            node({
              type: "SequenceExpression",
              expressions: [void_zero(), typed_arg],
            }),
            "const",
            type,
          ),
        );
        return temporary;
      });
      emit_slot_ensure(slot, target_stmts);
      let value: Expression;
      switch (operation.name) {
        case "ask":
        case "get":
          value = slot.current;
          break;
        case "asks":
        case "gets":
          value = call(arguments_[0], [slot.current]);
          break;
        case "put":
          target_stmts.push(assign(slot.current, arguments_[0]));
          value = void_zero();
          break;
        case "modify":
          target_stmts.push(
            assign(slot.current, call(arguments_[0], [slot.current])),
          );
          value = void_zero();
          break;
        case "writer":
          target_stmts.push(
            assign(
              slot.current,
              call(member(slot.current, "concat"), [arguments_[1]]),
            ),
          );
          value = arguments_[0];
          break;
        case "tell":
          target_stmts.push(
            assign(
              slot.current,
              call(member(slot.current, "concat"), [arguments_[0]]),
            ),
          );
          value = void_zero();
          break;
      }
      if (
        operation.types !== undefined &&
        (operation.name === "ask" || operation.name === "get")
      ) {
        const typed = services.fresh(operation.name + "_value");
        target_stmts.push(variable(typed, value, "const", operation.types[0]));
        value = typed;
      }
      return value;
    }

    function lower_stmt(statement: Statement): Statement[] {
      if (
        statement.type === "ExpressionStatement" && "directive" in statement &&
        statement.directive != null
      ) return [statement];
      if (
        statement.type === "VariableDeclaration" &&
        statement.declarations.length === 1
      ) {
        const decl = statement.declarations[0];
        const expr = yielded(decl.init);
        if (expr !== undefined) {
          const stmts: Statement[] = [];
          const val = emit_yield_op(match_yield(expr)!, stmts);
          stmts.push({
            ...statement,
            declarations: [{ ...decl, init: val }],
          });
          return stmts;
        }
      }
      if (statement.type === "ExpressionStatement") {
        const expr = yielded(statement.expression);
        if (expr !== undefined) {
          const stmts: Statement[] = [];
          const matched = match_yield(expr)!;
          const val = emit_yield_op(matched, stmts);
          if (
            matched.operation.name === "asks" ||
            matched.operation.name === "gets"
          ) {
            stmts.push(
              node({ type: "ExpressionStatement", expression: val }),
            );
          }
          return stmts;
        }
      }
      if (statement.type === "ReturnStatement") {
        const stmts: Statement[] = [];
        const expr = yielded(statement.argument);
        if (expr !== undefined) {
          const val = emit_yield_op(match_yield(expr)!, stmts);
          emit_all_ensure(stmts);
          stmts.push(ret(build_return(val)));
          return stmts;
        }
        const raw = statement.argument ?? void_zero();
        if (!eager && !is_pure_input(raw)) {
          const ret_tmp = services.fresh("return_value");
          stmts.push(variable(ret_tmp, raw, "const"));
          emit_all_ensure(stmts);
          stmts.push(ret(build_return(ret_tmp)));
          return stmts;
        }
        emit_all_ensure(stmts);
        stmts.push(ret(build_return(raw)));
        return stmts;
      }
      if (statement.type === "BlockStatement") {
        return [block(lower_list(statement.body as Statement[]))];
      }
      if (statement.type === "IfStatement") {
        const cons = lower_single(statement.consequent);
        const alt = statement.alternate !== null
          ? lower_single(statement.alternate)
          : null;
        return [{ ...statement, consequent: cons, alternate: alt }];
      }
      if (
        statement.type === "ForStatement" ||
        statement.type === "WhileStatement" ||
        statement.type === "DoWhileStatement" ||
        statement.type === "ForOfStatement" ||
        statement.type === "ForInStatement"
      ) {
        return [{ ...statement, body: lower_single(statement.body) }];
      }
      if (statement.type === "SwitchStatement") {
        const cases: SwitchCase[] = statement.cases.map((item) => ({
          ...item,
          consequent: lower_list(item.consequent as Statement[]),
        }));
        return [{ ...statement, cases }];
      }
      return [statement];
    }
    function lower_list(list: readonly Statement[]): Statement[] {
      const result: Statement[] = [];
      for (const item of list) result.push(...lower_stmt(item));
      return result;
    }
    function lower_single(statement: Statement): Statement {
      const list = lower_stmt(statement);
      if (list.length === 1) return list[0];
      return block(list);
    }

    const lowered_body = lower_list(body.body as Statement[]);
    out_statements.push(...lowered_body);
    const last = out_statements[out_statements.length - 1];
    if (last?.type !== "ReturnStatement") {
      emit_all_ensure(out_statements);
      out_statements.push(ret(build_return(void_zero())));
    }

    if (options.wrap_dictionary !== undefined) {
      const param_entry = options.direct_params![0];
      const typed_param = param_entry.type !== undefined
        ? {
          ...param_entry.param,
          typeAnnotation: node({
            type: "TSTypeAnnotation",
            typeAnnotation: param_entry.type,
          }),
        }
        : param_entry.param;
      return call(options.wrap_dictionary, [
        arrow([typed_param], block(out_statements)),
      ]);
    }

    const thunk_params: IdentifierReference[] = [];
    const thunk_args: Expression[] = [];
    for (const slot of slots) {
      if (slot.input_thunk !== undefined) {
        thunk_params.push(slot.input_thunk);
        thunk_args.push(arrow([], slot.input_expr));
      }
    }
    return call(arrow(thunk_params, block(out_statements)), thunk_args);
  }
  function build_cells_return(
    value: Expression,
    slots: readonly EmitSlot[],
  ): Expression {
    const state_props: ObjectProperty[] = [];
    const log_props: ObjectProperty[] = [];
    for (const slot of slots) {
      if (slot.kind === "reader" || slot.prop_name === undefined) continue;
      const key = slot.prop_is_ident ? id(slot.prop_name) : node({
        type: "Literal",
        value: slot.prop_name,
        raw: JSON.stringify(slot.prop_name),
      });
      const prop = node({
        type: "Property",
        kind: "init",
        key,
        value: slot.current,
        method: false,
        shorthand: false,
        computed: false,
      }) as ObjectProperty;
      if (slot.kind === "state") state_props.push(prop);
      else log_props.push(prop);
    }
    return node({
      type: "ObjectExpression",
      properties: [
        node({
          type: "Property",
          kind: "init",
          key: id("result"),
          value,
          method: false,
          shorthand: false,
          computed: false,
        }),
        node({
          type: "Property",
          kind: "init",
          key: id("states"),
          value: node({ type: "ObjectExpression", properties: state_props }),
          method: false,
          shorthand: false,
          computed: false,
        }),
        node({
          type: "Property",
          kind: "init",
          key: id("logs"),
          value: node({ type: "ObjectExpression", properties: log_props }),
          method: false,
          shorthand: false,
          computed: false,
        }),
      ],
    });
  }
  function fuse_cells_program(
    program_arg: Expression,
    bindings: readonly ParsedCellBinding[],
    get_hoisted_vars?: () => readonly IdentifierReference[],
  ): { expression: Expression; direct: boolean } | undefined {
    if (services.config.optimizations?.terminal_body === false) {
      return undefined;
    }
    const resolved_prog = resolve_program_arg(program_arg);
    if (resolved_prog === undefined) return undefined;
    const run = resolved_prog.program.arguments[0];
    if (
      run.type !== "FunctionExpression" || !valid_generator(run) ||
      lexical_hazard(run.body!)
    ) return undefined;
    const cell_to_slot = new Map<Node, number>();
    for (let index = 0; index < bindings.length; index += 1) {
      const decl = bindings[index].cell_decl;
      if (!cell_to_slot.has(decl)) cell_to_slot.set(decl, index);
    }
    const match_yield = (expression: Expression): YieldMatch | undefined => {
      for (const [cell_decl, slot_index] of cell_to_slot) {
        const op = cell_primitive(
          expression,
          cell_decl,
          bindings[slot_index].family,
        );
        if (op !== undefined) return { slot: slot_index, operation: op };
      }
      return undefined;
    };
    const analysis = analyze_control_body(run.body!, match_yield);
    if (analysis === undefined) return undefined;
    const hoisted_vars = get_hoisted_vars?.();
    const all_inputs_pure = hoisted_vars !== undefined ||
      bindings.every((b) => !b.writer_default && is_pure_input(b.init_expr));
    const eager_init = hoisted_vars !== undefined ||
      (!analysis.has_prefix_before_first_yield && all_inputs_pure);
    const slots: EmitSlot[] = bindings.map((binding, index) => {
      const base_name = binding.family === "reader"
        ? "environment"
        : binding.family === "state"
        ? "state"
        : "output";
      const current = services.fresh(base_name);
      const type = cell_input_type(binding.cell_id, binding.family);
      const input_expr = hoisted_vars !== undefined
        ? hoisted_vars[index]
        : binding.init_expr;
      if (eager_init) {
        return {
          kind: binding.family,
          current,
          input_expr,
          type,
          prop_name: binding.prop_name,
          prop_is_ident: binding.prop_is_ident,
        };
      }
      return {
        kind: binding.family,
        current,
        input_expr,
        input_thunk: services.fresh(binding.family + "_input"),
        ready: services.fresh(binding.family + "_ready"),
        type,
        prop_name: binding.prop_name,
        prop_is_ident: binding.prop_is_ident,
      };
    });
    if (resolved_prog.candidate !== undefined) {
      removed.add(resolved_prog.candidate.statement);
    }
    return {
      expression: emit_multi_control(
        run.body!,
        slots,
        match_yield,
        (value) => build_cells_return(value, slots),
        { eager_init },
      ),
      direct: true,
    };
  }
  function cells_terminal(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (services.config.optimizations?.terminal_body === false) {
      return undefined;
    }
    if (
      plain_call(outer, 2) && cell_runner_target(outer.callee) === "run_cells"
    ) {
      const bindings = parse_cell_bindings_object(
        outer.arguments[1] as Expression,
      );
      if (bindings === undefined) return undefined;
      return fuse_cells_program(outer.arguments[0] as Expression, bindings);
    }
    if (plain_call(outer, 1) && outer.callee.type === "Identifier") {
      const resolved = services.bindings.resolve(outer.callee);
      const entry = resolved !== null
        ? prepared_cells.get(resolved)
        : undefined;
      if (entry === undefined) return undefined;
      const fused = fuse_cells_program(
        outer.arguments[0] as Expression,
        entry.bindings,
        () => ensure_prepared_hoists(entry),
      );
      if (fused !== undefined) return fused;
    }
    return undefined;
  }
  function stacked_terminal_program(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      !plain_call(outer, 1) || target(outer.callee)?.imported !== "run" ||
      services.config.optimizations?.terminal_body === false
    ) return undefined;
    type Layer = {
      readonly kind: TerminalKind;
      readonly input_expr: Expression;
      readonly cell?: {
        readonly identifier: IdentifierReference;
        readonly declaration: Node;
      };
      readonly writer_default: boolean;
    };
    const layers_outer_to_inner: Layer[] = [];
    let cursor = parentheses(outer.arguments[0] as Expression);
    while (
      cursor.type === "CallExpression" && !cursor.optional &&
      cursor.typeArguments == null &&
      !cursor.arguments.some((a) => a.type === "SpreadElement") &&
      (cursor.arguments.length === 2 || cursor.arguments.length === 3)
    ) {
      const handler = target(cursor.callee);
      if (handler === undefined || handler.imported === "run") break;
      const kind = terminal_kind(handler.imported);
      const keyed = cursor.arguments.length === 3 ||
        (kind === "writer" &&
          resolve_cell(cursor.arguments[0] as Expression, "writer") !==
            undefined);
      if (keyed) {
        const resolved = resolve_cell(cursor.arguments[0] as Expression, kind);
        if (resolved === undefined) return undefined;
        const writer_default = cursor.arguments.length === 2;
        const input_expr = writer_default
          ? writer_default_empty_expr(resolved.identifier)
          : cursor.arguments[2] as Expression;
        if (
          !writer_default &&
          (lexical_hazard(input_expr) || contains_await_yield(input_expr))
        ) return undefined;
        layers_outer_to_inner.push({
          kind,
          input_expr,
          cell: resolved,
          writer_default,
        });
        cursor = parentheses(cursor.arguments[1] as Expression);
      } else {
        const input_expr = cursor.arguments[1] as Expression;
        if (lexical_hazard(input_expr) || contains_await_yield(input_expr)) {
          return undefined;
        }
        layers_outer_to_inner.push({
          kind,
          input_expr,
          writer_default: false,
        });
        cursor = parentheses(cursor.arguments[0] as Expression);
      }
    }
    if (layers_outer_to_inner.length < 2) return undefined;
    const resolved_prog = resolve_program_arg(cursor);
    if (resolved_prog === undefined) return undefined;
    const run = resolved_prog.program.arguments[0];
    if (
      run.type !== "FunctionExpression" || !valid_generator(run) ||
      lexical_hazard(run.body!)
    ) return undefined;

    // Innermost layer first so inner handlers own duplicates and wrap results first.
    const layers = layers_outer_to_inner.reverse();
    const cell_to_slot = new Map<Node, number>();
    const unkeyed_to_slot = new Map<TerminalKind, number>();
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer.cell !== undefined) {
        if (!cell_to_slot.has(layer.cell.declaration)) {
          cell_to_slot.set(layer.cell.declaration, index);
        }
      } else if (!unkeyed_to_slot.has(layer.kind)) {
        unkeyed_to_slot.set(layer.kind, index);
      }
    }
    const match_yield = (expression: Expression): YieldMatch | undefined => {
      for (const [cell_decl, slot_index] of cell_to_slot) {
        const op = cell_primitive(
          expression,
          cell_decl,
          layers[slot_index].kind,
        );
        if (op !== undefined) return { slot: slot_index, operation: op };
      }
      const op = primitive(expression);
      if (op !== undefined) {
        const slot_index = unkeyed_to_slot.get(primitive_kind(op.name));
        if (slot_index !== undefined) {
          return { slot: slot_index, operation: op };
        }
      }
      return undefined;
    };
    const analysis = analyze_control_body(run.body!, match_yield);
    if (analysis === undefined) return undefined;
    // Unkeyed reader/state layers need a known input type for strict TS.
    for (const [kind, slot_index] of unkeyed_to_slot) {
      if (
        kind !== "writer" &&
        input_type_in_block(run.body!, kind) === undefined
      ) return undefined;
      void slot_index;
    }
    const all_inputs_pure = layers.every((l) =>
      !l.writer_default && is_pure_input(l.input_expr)
    );
    const eager_init = !analysis.has_prefix_before_first_yield &&
      all_inputs_pure;
    const slots: EmitSlot[] = layers.map((layer) => {
      const base_name = layer.kind === "reader"
        ? "environment"
        : layer.kind === "state"
        ? "state"
        : "output";
      const current = services.fresh(base_name);
      const type = layer.cell !== undefined
        ? cell_input_type(layer.cell.identifier, layer.kind)
        : input_type_in_block(run.body!, layer.kind);
      if (eager_init) {
        return {
          kind: layer.kind,
          current,
          input_expr: layer.input_expr,
          type,
        };
      }
      return {
        kind: layer.kind,
        current,
        input_expr: layer.input_expr,
        input_thunk: services.fresh(layer.kind + "_input"),
        ready: services.fresh(layer.kind + "_ready"),
        type,
      };
    });
    if (resolved_prog.candidate !== undefined) {
      removed.add(resolved_prog.candidate.statement);
    }
    return {
      expression: emit_multi_control(
        run.body!,
        slots,
        match_yield,
        (value) => {
          let acc = value;
          for (const slot of slots) {
            acc = output(acc, slot.current, slot.kind);
          }
          return acc;
        },
        { eager_init },
      ),
      direct: true,
    };
  }
  function do_reader_state_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.generator === false ||
      services.config.optimizations?.terminal_body === false
    ) return undefined;

    // Case A: Do(...).run(input)
    let do_call: CallExpression | undefined;
    let run_input: Expression | undefined;
    if (
      plain_call(outer, 1) && outer.callee.type === "MemberExpression" &&
      !outer.callee.computed && !outer.callee.optional &&
      outer.callee.property.type === "Identifier" &&
      outer.callee.property.name === "run"
    ) {
      const target_expr = parentheses(outer.callee.object);
      if (
        target_expr.type === "CallExpression" &&
        services.kind(target_expr) === "do"
      ) {
        do_call = target_expr;
        run_input = outer.arguments[0] as Expression;
        if (lexical_hazard(run_input) || contains_await_yield(run_input)) {
          return undefined;
        }
      }
    } else if (services.kind(outer) === "do") {
      do_call = outer;
    }
    if (do_call === undefined) return undefined;
    if (
      do_call.optional || do_call.typeArguments != null ||
      do_call.arguments.some((a) => a.type === "SpreadElement") ||
      (do_call.arguments.length !== 1 && do_call.arguments.length !== 2)
    ) return undefined;

    const explicit = do_call.arguments.length === 2
      ? parentheses(do_call.arguments[0] as Expression)
      : undefined;
    const run = do_call.arguments[do_call.arguments.length - 1];
    if (
      run.type !== "FunctionExpression" || !valid_generator(run) ||
      lexical_hazard(run.body!)
    ) return undefined;

    let kind: "reader" | "state" | undefined;
    let cell:
      | { readonly identifier: IdentifierReference; readonly declaration: Node }
      | undefined;
    let wrap_dictionary: Expression | undefined;

    if (explicit !== undefined) {
      if (explicit.type !== "Identifier") return undefined;
      if (services.imports.direct_reader_dictionaries?.has(explicit.name)) {
        kind = "reader";
        wrap_dictionary = explicit;
      } else if (
        services.imports.direct_state_dictionaries?.has(explicit.name)
      ) {
        kind = "state";
        wrap_dictionary = explicit;
      } else {
        const resolved = resolve_any_cell(explicit);
        if (
          resolved !== undefined &&
          (resolved.kind === "reader" || resolved.kind === "state")
        ) {
          kind = resolved.kind;
          cell = resolved;
          wrap_dictionary = explicit;
        } else {
          return undefined;
        }
      }
    } else {
      // Infer from first top-level or nested yield*.
      let first_expr: Expression | undefined;
      walk(run.body!, (child) => {
        if (first_expr !== undefined || function_like(child)) return false;
        if (
          child.type === "YieldExpression" && child.delegate &&
          child.argument !== null
        ) {
          first_expr = child.argument;
          return false;
        }
      });
      if (first_expr === undefined) return undefined;
      const op = primitive(first_expr);
      if (op !== undefined) {
        const pk = primitive_kind(op.name);
        if (pk !== "reader" && pk !== "state") return undefined;
        kind = pk;
        if (run_input === undefined) {
          const dict_set = kind === "reader"
            ? services.imports.direct_reader_dictionaries
            : services.imports.direct_state_dictionaries;
          const dict_name = dict_set !== undefined && dict_set.size > 0
            ? dict_set.values().next().value
            : undefined;
          if (dict_name === undefined) return undefined;
          wrap_dictionary = id(dict_name);
        }
      } else {
        const unwrapped = parentheses(first_expr);
        if (
          unwrapped.type !== "CallExpression" ||
          unwrapped.callee.type !== "MemberExpression"
        ) return undefined;
        const resolved = resolve_any_cell(unwrapped.callee.object);
        if (
          resolved === undefined ||
          (resolved.kind !== "reader" && resolved.kind !== "state")
        ) return undefined;
        kind = resolved.kind;
        cell = resolved;
        wrap_dictionary = resolved.identifier;
      }
    }

    const match_yield = (expression: Expression): YieldMatch | undefined => {
      if (cell !== undefined) {
        const op = cell_primitive(expression, cell.declaration, kind!);
        return op !== undefined ? { slot: 0, operation: op } : undefined;
      }
      const op = primitive(expression);
      if (op !== undefined && primitive_kind(op.name) === kind) {
        return { slot: 0, operation: op };
      }
      return undefined;
    };

    const analysis = analyze_control_body(run.body!, match_yield);
    if (analysis === undefined) return undefined;
    const resolved_type = cell !== undefined
      ? cell_input_type(cell.identifier, kind)
      : input_type_in_block(run.body!, kind);
    if (resolved_type === undefined) return undefined;

    const current = services.fresh(kind === "reader" ? "environment" : "state");
    if (run_input !== undefined) {
      const eager_init = !analysis.has_prefix_before_first_yield;
      const slot: EmitSlot = eager_init
        ? { kind, current, input_expr: run_input, type: resolved_type }
        : {
          kind,
          current,
          input_expr: run_input,
          input_thunk: services.fresh(kind + "_input"),
          ready: services.fresh(kind + "_ready"),
          type: resolved_type,
        };
      return {
        expression: emit_multi_control(
          run.body!,
          [slot],
          match_yield,
          (value) => output(value, current, kind!),
          { eager_init },
        ),
        direct: true,
      };
    }

    // Standalone Do(...) without .run(...): require zero eager prefix before first yield.
    if (
      analysis.has_prefix_before_first_yield || wrap_dictionary === undefined
    ) {
      return undefined;
    }
    const param = services.fresh(
      kind === "reader" ? "reader_arg" : "state_arg",
    );
    const slot: EmitSlot = {
      kind,
      current,
      input_expr: param,
      type: resolved_type,
    };
    return {
      expression: emit_multi_control(
        run.body!,
        [slot],
        match_yield,
        (value) => output(value, current, kind!),
        {
          eager_init: true,
          direct_params: [{ param, type: resolved_type, init: param }],
          wrap_dictionary,
        },
      ),
      direct: true,
    };
  }
  function terminal_program(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    const cells_fused = cells_terminal(outer);
    if (cells_fused !== undefined) return cells_fused;
    const stacked_fused = stacked_terminal_program(outer);
    if (stacked_fused !== undefined) return stacked_fused;
    const do_fused = do_reader_state_fusion(outer);
    if (do_fused !== undefined) return do_fused;
    if (!plain_call(outer, 1) || target(outer.callee)?.imported !== "run") {
      return undefined;
    }
    const handled = parentheses(outer.arguments[0] as Expression);
    if (
      handled.type !== "CallExpression" || handled.optional ||
      handled.typeArguments != null ||
      handled.arguments.some((argument) => argument.type === "SpreadElement") ||
      (handled.arguments.length !== 2 && handled.arguments.length !== 3)
    ) {
      return undefined;
    }
    const handler = target(handled.callee);
    if (handler === undefined || handler.imported === "run") return undefined;
    const kind = terminal_kind(handler.imported);

    // Keyed cell terminal fusion:
    //   run(run_reader(cell, Program(...), env))
    //   run(run_state(cell, Program(...), init))
    //   run(run_writer(cell, Program(...), empty))
    //   run(run_writer(cell, Program(...)))
    const keyed = handled.arguments.length === 3 ||
      (kind === "writer" &&
        resolve_cell(handled.arguments[0] as Expression, "writer") !==
          undefined);
    if (keyed) {
      const resolved_cell = resolve_cell(
        handled.arguments[0] as Expression,
        kind,
      );
      if (resolved_cell === undefined) return undefined;
      const resolved_prog = resolve_program_arg(
        handled.arguments[1] as Expression,
      );
      if (resolved_prog === undefined) return undefined;
      const writer_default = handled.arguments.length === 2;
      const input_expr: Expression = writer_default
        ? writer_default_empty_expr(resolved_cell.identifier)
        : handled.arguments[2] as Expression;
      const run = resolved_prog.program.arguments[0];
      if (
        run.type !== "FunctionExpression" || !valid_generator(run) ||
        lexical_hazard(run.body!) ||
        (!writer_default &&
          (lexical_hazard(input_expr) || contains_await_yield(input_expr)))
      ) return undefined;
      const body = read_body(run.body!);
      if (body !== undefined) {
        const can_fuse =
          services.config.optimizations?.terminal_body !== false &&
          body.parts.every((part) => {
            if (part.kind !== "yield") return true;
            return cell_primitive(
              part.expression,
              resolved_cell.declaration,
              kind,
            ) !== undefined;
          });
        if (!can_fuse) {
          return {
            expression: { ...handled, callee: runner(handler) },
            direct: false,
          };
        }
        if (resolved_prog.candidate !== undefined) {
          removed.add(resolved_prog.candidate.statement);
        }
        return {
          expression: emit_keyed(
            body,
            input_expr,
            kind,
            resolved_cell.identifier,
            resolved_cell.declaration,
          ),
          direct: true,
        };
      }
      if (services.config.optimizations?.terminal_body !== false) {
        const match_yield = (
          expression: Expression,
        ): YieldMatch | undefined => {
          const op = cell_primitive(
            expression,
            resolved_cell.declaration,
            kind,
          );
          return op !== undefined ? { slot: 0, operation: op } : undefined;
        };
        const analysis = analyze_control_body(run.body!, match_yield);
        if (analysis !== undefined) {
          const eager_init = !analysis.has_prefix_before_first_yield &&
            !writer_default && is_pure_input(input_expr);
          const current = services.fresh(
            kind === "reader"
              ? "environment"
              : kind === "state"
              ? "state"
              : "output",
          );
          const type = cell_input_type(resolved_cell.identifier, kind);
          const slot: EmitSlot = eager_init
            ? { kind, current, input_expr, type }
            : {
              kind,
              current,
              input_expr,
              input_thunk: services.fresh(kind + "_input"),
              ready: services.fresh(kind + "_ready"),
              type,
            };
          if (resolved_prog.candidate !== undefined) {
            removed.add(resolved_prog.candidate.statement);
          }
          return {
            expression: emit_multi_control(
              run.body!,
              [slot],
              match_yield,
              (value) => output(value, current, kind),
              { eager_init },
            ),
            direct: true,
          };
        }
      }
      return {
        expression: { ...handled, callee: runner(handler) },
        direct: false,
      };
    }

    const resolved_prog = resolve_program_arg(
      handled.arguments[0] as Expression,
    );
    if (resolved_prog === undefined) return undefined;
    const run = resolved_prog.program.arguments[0];
    if (
      run.type !== "FunctionExpression" || !valid_generator(run) ||
      lexical_hazard(run.body!) ||
      lexical_hazard(handled.arguments[1]) ||
      contains_await_yield(handled.arguments[1])
    ) return undefined;
    const body = read_body(run.body!);
    if (body !== undefined) {
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
      if (resolved_prog.candidate !== undefined) {
        removed.add(resolved_prog.candidate.statement);
      }
      return {
        expression: emit(body, handled.arguments[1] as Expression, kind),
        direct: true,
      };
    }
    if (services.config.optimizations?.terminal_body !== false) {
      const match_yield = (expression: Expression): YieldMatch | undefined => {
        const op = primitive(expression);
        if (op !== undefined && primitive_kind(op.name) === kind) {
          return { slot: 0, operation: op };
        }
        return undefined;
      };
      const analysis = analyze_control_body(run.body!, match_yield);
      const resolved_type = input_type_in_block(run.body!, kind);
      if (
        analysis !== undefined &&
        (kind === "writer" || resolved_type !== undefined)
      ) {
        const input_expr = handled.arguments[1] as Expression;
        const eager_init = !analysis.has_prefix_before_first_yield &&
          is_pure_input(input_expr);
        const current = services.fresh(
          kind === "reader"
            ? "environment"
            : kind === "state"
            ? "state"
            : "output",
        );
        const slot: EmitSlot = eager_init
          ? { kind, current, input_expr, type: resolved_type }
          : {
            kind,
            current,
            input_expr,
            input_thunk: services.fresh(kind + "_input"),
            ready: services.fresh(kind + "_ready"),
            type: resolved_type,
          };
        if (resolved_prog.candidate !== undefined) {
          removed.add(resolved_prog.candidate.statement);
        }
        return {
          expression: emit_multi_control(
            run.body!,
            [slot],
            match_yield,
            (value) => output(value, current, kind),
            { eager_init },
          ),
          direct: true,
        };
      }
    }
    return {
      expression: { ...handled, callee: runner(handler) },
      direct: false,
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
  function annotate_callback(
    expression: Expression,
    param_type: TSType | undefined,
  ): Expression {
    if (param_type === undefined) return expression;
    const value = parentheses(expression);
    if (
      (value.type !== "ArrowFunctionExpression" &&
        value.type !== "FunctionExpression") ||
      value.params.length === 0
    ) return expression;
    const first = value.params[0];
    if (first.type !== "Identifier" || first.typeAnnotation != null) {
      return expression;
    }
    return {
      ...value,
      params: [
        {
          ...first,
          typeAnnotation: node({
            type: "TSTypeAnnotation",
            typeAnnotation: param_type,
          }),
        },
        ...value.params.slice(1),
      ],
    };
  }
  function emit_keyed(
    body: Body,
    input: Expression,
    kind: TerminalKind,
    cell_id: IdentifierReference,
    cell_declaration: Node,
  ): Expression {
    const input_thunk = services.fresh(kind + "_input");
    let current_name = "output";
    if (kind === "reader") current_name = "environment";
    if (kind === "state") current_name = "state";
    const current = services.fresh(current_name);
    const resolved_type = cell_input_type(cell_id, kind);
    const statements: Statement[] = [];
    let initialized = false;
    let returned = false;
    for (const part of body.parts) {
      if (part.kind === "statement") {
        statements.push(part.statement);
        continue;
      }
      const operation = cell_primitive(
        part.expression,
        cell_declaration,
        kind,
      )!;
      const arguments_ = operation.arguments.map((argument, index) => {
        const temporary = services.fresh(operation.name + "_argument_" + index);
        const typed_arg = index === 0 &&
            (operation.name === "asks" || operation.name === "gets" ||
              operation.name === "modify")
          ? annotate_callback(argument, resolved_type)
          : argument;
        const type = index === 0 && operation.name === "put"
          ? resolved_type
          : undefined;
        statements.push(
          variable(
            temporary,
            node({
              type: "SequenceExpression",
              expressions: [void_zero(), typed_arg],
            }),
            "const",
            type,
          ),
        );
        return temporary;
      });
      if (!initialized) {
        const declaration_kind: "const" | "let" = kind === "reader"
          ? "const"
          : "let";
        statements.push(
          variable(
            current,
            call(input_thunk, []),
            declaration_kind,
            resolved_type,
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
  function collect_named(): Map<Node | null, NamedProgramCandidate> {
    const candidates = new Map<Node | null, NamedProgramCandidate>();
    const has_runners = services.imports.terminal_functions.size > 0 ||
      services.imports.terminal_namespaces.size > 0 ||
      (services.imports.cell_runners?.size ?? 0) > 0 ||
      (services.imports.cell_runner_namespaces?.size ?? 0) > 0;
    if (
      services.config.optimizations?.terminal === false ||
      services.config.optimizations?.terminal_body === false ||
      !has_runners
    ) return candidates;

    const prog_tokens = [
      "Program",
      ...services.imports.program_names,
      ...services.imports.namespaces,
    ];
    const has_prog = create_span_scanner(services.source, prog_tokens);
    const nodes: { statement: Statement; owner: Node }[] = [];
    for (const stmt of services.program.body) {
      if (stmt.type === "ImportDeclaration") continue;
      if (skip_statement?.(stmt as Statement)) continue;
      const s = stmt as Statement;
      if (
        !(s.type === "ExpressionStatement" && "directive" in s &&
          s.directive != null)
      ) nodes.push({ statement: s, owner: services.program });
      if (!has_prog(s.start, s.end)) continue;
      walk(s, (parent) => {
        if (parent.type !== "BlockStatement") return;
        for (const inner of parent.body) {
          if (
            inner.type !== "ExpressionStatement" ||
            !("directive" in inner && inner.directive != null)
          ) nodes.push({ statement: inner as Statement, owner: parent });
        }
      });
    }

    const candidate_names: string[] = [];
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
        lexical_hazard(run.body!) || !first_statement_is_yield(run.body!)
      ) continue;
      const key = services.bindings.resolve(declaration.id);
      if (key === null) continue;
      candidates.set(key, {
        program,
        statement,
        owner,
        name: declaration.id,
      });
      candidate_names.push(declaration.id.name);
    }
    if (candidates.size === 0) return candidates;

    const allowed = new Set<Node>();
    const used = new Set<Node | null>();
    const match_program_use = (
      expression: Expression | null | undefined,
      owner: Node,
    ) => {
      if (expression == null || expression.type !== "CallExpression") return;
      // 1. run(run_*(p, input)) or run(run_*(cell, p, input?)) or stacked run(...)
      if (
        plain_call(expression, 1) &&
        target(expression.callee)?.imported === "run"
      ) {
        let cursor = parentheses(expression.arguments[0] as Expression);
        let steps = 0;
        while (
          cursor.type === "CallExpression" && !cursor.optional &&
          cursor.typeArguments == null &&
          !cursor.arguments.some((a) => a.type === "SpreadElement") &&
          (cursor.arguments.length === 2 || cursor.arguments.length === 3)
        ) {
          const handler = target(cursor.callee);
          if (handler === undefined || handler.imported === "run") break;
          const kind = terminal_kind(handler.imported);
          const keyed = cursor.arguments.length === 3 ||
            (kind === "writer" &&
              resolve_cell(cursor.arguments[0] as Expression, "writer") !==
                undefined);
          const arg_index = keyed ? 1 : 0;
          const input_arg = keyed ? cursor.arguments[2] : cursor.arguments[1];
          if (
            input_arg !== undefined &&
            (lexical_hazard(input_arg) || contains_await_yield(input_arg))
          ) return;
          cursor = parentheses(cursor.arguments[arg_index] as Expression);
          steps += 1;
        }
        if (steps > 0 && cursor.type === "Identifier") {
          const key = services.bindings.resolve(cursor);
          const candidate = candidates.get(key);
          if (
            candidate !== undefined && candidate.owner === owner &&
            candidate.program.end < cursor.start
          ) {
            // For single unkeyed calls, validate same-kind compatibility eagerly so
            // mismatched named Programs never get marked skip().
            if (steps === 1) {
              const handled = parentheses(
                expression.arguments[0] as Expression,
              ) as CallExpression;
              const handler = target(handled.callee);
              if (handler === undefined || handler.imported === "run") return;
              const kind = terminal_kind(handler.imported);
              const is_keyed = handled.arguments.length === 3 ||
                (kind === "writer" &&
                  resolve_cell(handled.arguments[0] as Expression, "writer") !==
                    undefined);
              if (!is_keyed) {
                const run_fn = candidate.program.arguments[0] as FunctionNode;
                const match_op = (expr: Expression): YieldMatch | undefined => {
                  const op = primitive(expr);
                  return op !== undefined && primitive_kind(op.name) === kind
                    ? { slot: 0, operation: op }
                    : undefined;
                };
                if (
                  analyze_control_body(run_fn.body!, match_op) === undefined ||
                  (kind !== "writer" &&
                    input_type_in_block(run_fn.body!, kind) === undefined)
                ) return;
              }
            }
            allowed.add(cursor);
            used.add(key);
          }
        }
        return;
      }
      // 2. run_cells(p, { ... })
      if (
        plain_call(expression, 2) &&
        cell_runner_target(expression.callee) === "run_cells"
      ) {
        const name = parentheses(expression.arguments[0] as Expression);
        if (name.type === "Identifier") {
          const key = services.bindings.resolve(name);
          const candidate = candidates.get(key);
          if (
            candidate !== undefined && candidate.owner === owner &&
            candidate.program.end < name.start &&
            parse_cell_bindings_object(
                expression.arguments[1] as Expression,
              ) !==
              undefined
          ) {
            allowed.add(name);
            used.add(key);
          }
        }
        return;
      }
      // 3. prepared_runner(p)
      if (
        plain_call(expression, 1) && expression.callee.type === "Identifier"
      ) {
        const resolved = services.bindings.resolve(expression.callee);
        if (resolved !== null && prepared_cells.has(resolved)) {
          const name = parentheses(expression.arguments[0] as Expression);
          if (name.type === "Identifier") {
            const key = services.bindings.resolve(name);
            const candidate = candidates.get(key);
            if (
              candidate !== undefined && candidate.owner === owner &&
              candidate.program.end < name.start
            ) {
              allowed.add(name);
              used.add(key);
            }
          }
        }
      }
    };

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
      match_program_use(expression, owner);
    }
    if (used.size === 0) {
      candidates.clear();
      return candidates;
    }
    // Check escaping references, skipping untouched top-level statements that do not
    // contain any candidate identifier name in their source span (O(N) monotonic scan).
    const has_cand = create_span_scanner(services.source, candidate_names);
    for (const stmt of services.program.body) {
      if (stmt.type === "ImportDeclaration") continue;
      if (!has_cand(stmt.start, stmt.end)) continue;
      walk(stmt, (child) => {
        if (child.type !== "Identifier") return;
        const key = services.bindings.resolve(child);
        const candidate = candidates.get(key);
        if (
          candidate !== undefined && candidate.name !== child &&
          !allowed.has(child)
        ) candidates.delete(key);
      });
    }
    for (const key of candidates.keys()) {
      if (!used.has(key)) candidates.delete(key);
    }
    return candidates;
  }
  const named_statements = new Set<Node>();
  for (const candidate of named.values()) {
    named_statements.add(candidate.statement);
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
    hoist(statement: Node): Statement[] | undefined {
      return hoisted_statements.get(statement);
    },
    has_removals(): boolean {
      return removed.size > 0 || hoisted_statements.size > 0;
    },
    skip(statement: Node): boolean {
      return named_statements.size > 0 && named_statements.has(statement);
    },
  };
}

function first_statement_is_yield(body: BlockStatement): boolean {
  for (const statement of body.body) {
    if (
      statement.type === "ExpressionStatement" && "directive" in statement &&
      statement.directive != null
    ) continue;
    if (
      statement.type === "VariableDeclaration" &&
      statement.declarations.length === 1
    ) return yielded(statement.declarations[0].init) !== undefined;
    if (statement.type === "ExpressionStatement") {
      return yielded(statement.expression) !== undefined;
    }
    if (statement.type === "ReturnStatement") {
      return yielded(statement.argument) !== undefined;
    }
    return false;
  }
  return false;
}
function create_span_scanner(
  source: string,
  tokens: readonly string[],
): (start: number, end: number) => boolean {
  const unique = [...new Set(tokens)];
  const next = unique.map((token) => source.indexOf(token, 0));
  return (start: number, end: number): boolean => {
    let hit = false;
    for (let index = 0; index < unique.length; index += 1) {
      let pos = next[index];
      if (pos >= 0 && pos < start) {
        pos = source.indexOf(unique[index], start);
        next[index] = pos;
      }
      if (pos >= 0 && pos < end) hit = true;
    }
    return hit;
  };
}
function is_pure_input(expression: Expression): boolean {
  const value = parentheses(expression);
  if (value.type === "Identifier" || value.type === "Literal") return true;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return true;
  }
  if (
    value.type === "UnaryExpression" &&
    (value.operator === "void" || value.operator === "-" ||
      value.operator === "+" || value.operator === "!" ||
      value.operator === "~")
  ) return is_pure_input(value.argument);
  return false;
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

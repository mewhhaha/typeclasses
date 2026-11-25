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
  literal,
  member,
  node,
  ret,
  value_visitor_keys,
  walk,
} from "./transform_ast.ts";
import type {
  CellRunnerName,
  ExceptPrimitiveName,
  OperationRunnerName,
  PrimitiveFunctionName,
  StateEvalName,
  TerminalFunctionName,
  TransformServices,
} from "./transform_context.ts";
import { create_span_scanner } from "./transform_imports.ts";
import { create_round5_fusions } from "./transform_fusions.ts";

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
type ExceptPrimitive = {
  readonly name: ExceptPrimitiveName;
  readonly arguments: Expression[];
  readonly types?: TSType[];
};
type OperationSend = {
  readonly tag: string;
  readonly payload?: Expression;
  readonly has_payload: boolean;
};
type ArrayBufferSpec = {
  readonly array_ctor: IdentifierReference;
  readonly init_elements: readonly Expression[];
  readonly element_type?: TSType;
};
type PureOpInline = {
  readonly kind: "pure_inline";
  readonly param?: BindingPattern;
  readonly payload_only_param?: IdentifierReference;
  readonly param_key?: Node | null;
  readonly body_stmts: readonly Statement[];
  readonly result_expr: Expression;
  readonly free_names: ReadonlySet<string>;
};
type DynamicOpHandler = {
  readonly kind: "dynamic";
  readonly expr: Expression;
  readonly hoisted?: IdentifierReference;
};
type ParsedOpHandler = PureOpInline | DynamicOpHandler;
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
type YieldMatch =
  | {
    readonly kind: "cell";
    readonly slot: number;
    readonly operation: Primitive;
  }
  | {
    readonly kind: "except";
    readonly slot: number;
    readonly operation: ExceptPrimitive;
  }
  | {
    readonly kind: "operation";
    readonly slot: number;
    readonly send: OperationSend;
  }
  | {
    readonly kind: "task";
    readonly task_kind: "pure" | "from_fn" | "task_ctor" | "arbitrary";
    readonly expr: Expression;
  };
type ControlAnalysis = {
  readonly yield_count: number;
  readonly has_control_flow: boolean;
  readonly has_prefix_before_first_yield: boolean;
  readonly has_expr_yield: boolean;
};
type EmitSlot = {
  readonly kind: TerminalKind | "except" | "operations";
  readonly current: IdentifierReference;
  readonly input_expr: Expression;
  readonly input_thunk?: IdentifierReference;
  readonly ready?: IdentifierReference;
  readonly type?: TSType;
  readonly prop_name?: string;
  readonly prop_is_ident?: boolean;
  readonly array_buffer?: ArrayBufferSpec;
  readonly op_handlers?: ReadonlyMap<string, ParsedOpHandler>;
  readonly op_handler_vars?: ReadonlyMap<string, IdentifierReference>;
  readonly is_effect_id?: IdentifierReference;
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
  readonly runner_kind: "run" | "handle";
  readonly statement: Statement;
  readonly declaration: VariableDeclarator;
  readonly var_decl: VariableDeclaration;
  readonly exported: ExportNamedDeclaration | undefined;
  readonly obj: ObjectExpression;
  readonly bindings: readonly ParsedCellBinding[];
  hoisted_vars?: IdentifierReference[];
};
type ParsedOpEntry = {
  readonly tag: string;
  readonly prop_node: ObjectProperty;
  readonly handler: ParsedOpHandler;
};
type PreparedOpsEntry = {
  readonly statement: Statement;
  readonly declaration: VariableDeclarator;
  readonly var_decl: VariableDeclaration;
  readonly exported: ExportNamedDeclaration | undefined;
  readonly obj: ObjectExpression;
  readonly entries: readonly ParsedOpEntry[];
  readonly anchor_local: string;
  hoisted_vars?: Map<string, IdentifierReference>;
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
  const has_r5_task = services.task_dictionaries.size > 0 ||
    (services.imports.task_run_functions?.size ?? 0) > 0 ||
    (services.imports.task_namespaces?.size ?? 0) > 0 ||
    services.imports.namespaces.size > 0;
  const has_r5_traverse = services.source.includes("traverse") && (
    (services.imports.traversable_objects?.size ?? 0) > 0 ||
    (services.imports.traversable_namespaces?.size ?? 0) > 0 ||
    (services.imports.traverse_sequential_functions?.size ?? 0) > 0 ||
    (services.imports.traverse_sequential_namespaces?.size ?? 0) > 0 ||
    (services.imports.array_constructors?.size ?? 0) > 0
  );
  const has_r5_match = services.source.includes("match") && (
    (services.imports.match_functions?.size ?? 0) > 0 ||
    (services.imports.match_namespaces?.size ?? 0) > 0 ||
    (services.imports.tagged_type_names?.size ?? 0) > 0 ||
    (services.imports.just_constructors?.size ?? 0) > 0 ||
    (services.imports.nothing_constructors?.size ?? 0) > 0 ||
    (services.imports.left_constructors?.size ?? 0) > 0 ||
    (services.imports.right_constructors?.size ?? 0) > 0 ||
    (services.imports.validation_constructors?.size ?? 0) > 0 ||
    (services.imports.list_constructors?.size ?? 0) > 0 ||
    (services.imports.nil_constructors?.size ?? 0) > 0 ||
    (services.imports.cons_constructors?.size ?? 0) > 0
  );
  const has_r5_stm = (services.imports.stm_dictionaries?.size ?? 0) > 0 ||
    (services.imports.stm_namespaces?.size ?? 0) > 0;
  const has_r5_chain = (
    services.source.includes(".map(") || services.source.includes(".bind(") ||
    services.source.includes("from_maybe") ||
    services.source.includes("to_nullable")
  ) && (
    (services.imports.just_constructors?.size ?? 0) > 0 ||
    (services.imports.nothing_constructors?.size ?? 0) > 0 ||
    (services.imports.from_nullable_functions?.size ?? 0) > 0 ||
    (services.imports.from_maybe_functions?.size ?? 0) > 0 ||
    (services.imports.to_nullable_functions?.size ?? 0) > 0 ||
    (services.imports.left_constructors?.size ?? 0) > 0 ||
    (services.imports.right_constructors?.size ?? 0) > 0 ||
    (services.imports.direct_maybe_dictionaries?.size ?? 0) > 0 ||
    (services.imports.direct_either_dictionaries?.size ?? 0) > 0 ||
    (services.imports.tagged_type_names?.size ?? 0) > 0
  );
  const has_r5_array = (
    (services.imports.array_constructors?.size ?? 0) > 0 ||
    (services.imports.array_view_functions?.size ?? 0) > 0
  ) && (
    services.source.includes(".map(") || services.source.includes(".fold(") ||
    services.source.includes("Foldable") || services.source.includes("to_array")
  );
  const round5 = (
      has_r5_task || has_r5_traverse || has_r5_match || has_r5_stm ||
      has_r5_chain || has_r5_array
    )
    ? create_round5_fusions(services)
    : undefined;
  const prepared_cells = collect_prepared_cells();
  const prepared_ops = collect_prepared_operations();
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
            if (init.type === "CallExpression" && plain_call(init, 1)) {
              const runner_name = cell_runner_target(init.callee);
              if (
                runner_name === "prepare_cells" ||
                runner_name === "prepare_handle_cells"
              ) {
                const bindings = parse_cell_bindings_object(
                  init.arguments[0] as Expression,
                );
                if (bindings !== undefined) {
                  const key = services.bindings.resolve(declaration.id);
                  if (key !== null) {
                    entries.set(key, {
                      runner_kind: runner_name === "prepare_cells"
                        ? "run"
                        : "handle",
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
      }
    };
    const prep_tokens = [
      "prepare_cells",
      "prepare_handle_cells",
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
  function state_eval_target(
    expression: Expression,
  ): StateEvalName | undefined {
    if (
      expression.type === "Identifier" && services.bindings.imported(expression)
    ) {
      return services.imports.state_eval_functions?.get(expression.name);
    }
    if (
      expression.type !== "MemberExpression" || expression.computed ||
      expression.optional || expression.object.type !== "Identifier" ||
      expression.property.type !== "Identifier" ||
      !services.bindings.imported(expression.object)
    ) return undefined;
    const name = expression.property.name as StateEvalName;
    if (
      services.imports.state_eval_namespaces?.get(expression.object.name)?.has(
        name,
      )
    ) return name;
    return undefined;
  }
  function except_primitive(
    expression: Expression,
  ): ExceptPrimitive | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || value.optional ||
      value.arguments.some((argument) => argument.type === "SpreadElement")
    ) return undefined;
    let name: ExceptPrimitiveName | undefined;
    if (
      value.callee.type === "Identifier" &&
      services.bindings.imported(value.callee)
    ) {
      name = services.imports.except_primitives?.get(value.callee.name);
    } else if (
      value.callee.type === "MemberExpression" && !value.callee.optional &&
      !value.callee.computed && value.callee.object.type === "Identifier" &&
      value.callee.property.type === "Identifier" &&
      services.bindings.imported(value.callee.object)
    ) {
      const candidate = value.callee.property.name as ExceptPrimitiveName;
      if (
        services.imports.except_namespaces?.get(value.callee.object.name)?.has(
          candidate,
        )
      ) name = candidate;
    }
    if (name === undefined) return undefined;
    const arity = value.arguments.length;
    switch (name) {
      case "fail":
      case "from_either":
      case "from_validation":
        if (arity !== 1) return undefined;
        break;
      case "from_maybe":
      case "from_nullable":
        if (arity !== 2) return undefined;
        break;
    }
    const types = value.typeArguments?.params;
    if (types !== undefined && name !== "fail") return undefined;
    if (types !== undefined && types.length !== 1) return undefined;
    return { name, arguments: value.arguments as Expression[], types };
  }
  function resolve_either_identifier(
    anchor_local: string,
  ): IdentifierReference | undefined {
    const existing = services.imports.direct_either_dictionaries;
    if (existing !== undefined && existing.size > 0) {
      return id(existing.values().next().value!);
    }
    return services.import_from_module?.(anchor_local, "either", "Either");
  }
  function operation_runner_target(
    expression: Expression,
  ):
    | { readonly name: OperationRunnerName; readonly local: string }
    | undefined {
    if (
      expression.type === "Identifier" && services.bindings.imported(expression)
    ) {
      const name = services.imports.operation_runners?.get(expression.name);
      if (name !== undefined) return { name, local: expression.name };
    }
    if (
      expression.type !== "MemberExpression" || expression.computed ||
      expression.optional || expression.object.type !== "Identifier" ||
      expression.property.type !== "Identifier" ||
      !services.bindings.imported(expression.object)
    ) return undefined;
    const name = expression.property.name as OperationRunnerName;
    if (
      services.imports.operation_runner_namespaces?.get(expression.object.name)
        ?.has(name)
    ) return { name, local: expression.object.name };
    return undefined;
  }
  function is_operation_helper(
    expression: Expression,
    helper: "operation" | "send" | "pure",
  ): boolean {
    if (
      expression.type === "Identifier" && services.bindings.imported(expression)
    ) {
      return services.imports.operation_helpers?.get(expression.name) ===
        helper;
    }
    return effect_method(expression, helper);
  }
  function extract_effect_pure(expression: Expression): Expression | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || !plain_call(value, 1) ||
      !is_operation_helper(value.callee, "pure")
    ) return undefined;
    return value.arguments[0] as Expression;
  }
  function parse_op_handler(
    expression: Expression,
  ): ParsedOpHandler | undefined {
    const value = parentheses(expression);
    if (lexical_hazard(value) || contains_await_yield(value)) return undefined;
    if (
      (value.type === "ArrowFunctionExpression" ||
        value.type === "FunctionExpression") &&
      !value.async && !value.generator && value.typeParameters == null &&
      value.returnType == null && value.params.length <= 1
    ) {
      let param: BindingPattern | undefined;
      let payload_only_param: IdentifierReference | undefined;
      let param_key: Node | null | undefined;
      let param_ok = true;
      if (value.params.length === 1) {
        const first = value.params[0];
        if (
          first.type === "Identifier"
        ) {
          param = first;
          param_key = services.bindings.resolve(first);
        } else if (
          first.type === "ArrayPattern" &&
          first.elements.length >= 1 && first.elements.length <= 2 &&
          first.elements.every((el) => el === null || el.type === "Identifier")
        ) {
          param = first;
          if (
            first.elements.length === 2 && first.elements[0] === null &&
            first.elements[1]?.type === "Identifier"
          ) {
            payload_only_param = first
              .elements[1] as unknown as IdentifierReference;
            param_key = services.bindings.resolve(first.elements[1]);
          }
        } else {
          param_ok = false;
        }
      }
      if (param_ok) {
        let body_stmts: Statement[] | undefined;
        let result_expr: Expression | undefined;
        if (value.type === "ArrowFunctionExpression" && value.expression) {
          const pure_arg = extract_effect_pure(value.body as Expression);
          if (pure_arg !== undefined) {
            body_stmts = [];
            result_expr = pure_arg;
          }
        } else if (
          value.body !== null && value.body.type === "BlockStatement"
        ) {
          const stmts = value.body.body as Statement[];
          const last = stmts[stmts.length - 1];
          if (last?.type === "ReturnStatement" && last.argument !== null) {
            const pure_arg = extract_effect_pure(last.argument);
            if (pure_arg !== undefined) {
              let has_other_return = false;
              for (let i = 0; i < stmts.length - 1; i += 1) {
                walk(stmts[i], (child) => {
                  if (function_like(child)) return false;
                  if (child.type === "ReturnStatement") has_other_return = true;
                });
              }
              if (!has_other_return) {
                body_stmts = stmts.slice(0, -1);
                result_expr = pure_arg;
              }
            }
          }
        }
        if (body_stmts !== undefined && result_expr !== undefined) {
          const free_names = new Set<string>();
          walk(value.body!, (child, parent) => {
            if (child.type !== "Identifier") return;
            if (
              parent?.type === "MemberExpression" && !parent.computed &&
              parent.property === child
            ) return;
            if (
              parent?.type === "Property" && !parent.computed &&
              parent.key === child && !parent.shorthand
            ) return;
            const resolved = services.bindings.resolve(child);
            if (
              resolved === null ||
              resolved.start < value.start || resolved.end > value.end
            ) {
              free_names.add(child.name);
            }
          });
          return {
            kind: "pure_inline",
            param,
            payload_only_param,
            param_key,
            body_stmts,
            result_expr,
            free_names,
          };
        }
      }
    }
    return { kind: "dynamic", expr: expression };
  }
  function parse_op_handlers_object(
    expression: Expression,
  ): ParsedOpEntry[] | undefined {
    const obj = parentheses(expression);
    if (obj.type !== "ObjectExpression" || obj.properties.length === 0) {
      return undefined;
    }
    const seen = new Set<string>();
    const entries: ParsedOpEntry[] = [];
    for (const property of obj.properties) {
      if (
        property.type !== "Property" || property.kind !== "init" ||
        property.computed || property.method
      ) return undefined;
      let tag: string;
      if (property.key.type === "Identifier") tag = property.key.name;
      else if (
        property.key.type === "Literal" &&
        typeof property.key.value === "string"
      ) tag = property.key.value;
      else return undefined;
      if (tag === "__proto__" || seen.has(tag)) return undefined;
      seen.add(tag);
      const handler = parse_op_handler(property.value as Expression);
      if (handler === undefined) return undefined;
      entries.push({ tag, prop_node: property, handler });
    }
    return entries;
  }
  function collect_prepared_operations(): Map<Node, PreparedOpsEntry> {
    const entries = new Map<Node, PreparedOpsEntry>();
    if (
      services.config.optimizations?.terminal === false ||
      services.config.optimizations?.terminal_body === false ||
      ((services.imports.operation_runners?.size ?? 0) === 0 &&
        (services.imports.operation_runner_namespaces?.size ?? 0) === 0)
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
            if (init.type === "CallExpression" && plain_call(init, 1)) {
              const runner_target = operation_runner_target(init.callee);
              if (runner_target?.name === "prepare_operations") {
                const parsed = parse_op_handlers_object(
                  init.arguments[0] as Expression,
                );
                if (parsed !== undefined) {
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
                      entries: parsed,
                      anchor_local: runner_target.local,
                    });
                  }
                }
              }
            }
          }
        }
      }
    };
    const prep_tokens = [
      "prepare_operations",
      ...(services.imports.operation_runners !== undefined
        ? [...services.imports.operation_runners.keys()]
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
  function ensure_prepared_ops_hoists(
    entry: PreparedOpsEntry,
  ): Map<string, IdentifierReference> {
    if (entry.hoisted_vars !== undefined) return entry.hoisted_vars;
    const hoisted_vars = new Map<string, IdentifierReference>();
    const prefix_decls: Statement[] = [];
    const new_props = entry.entries.map((item, index) => {
      if (item.handler.kind !== "dynamic") return item.prop_node;
      const temp = services.fresh("prepared_op_" + index);
      hoisted_vars.set(item.tag, temp);
      prefix_decls.push(variable(temp, item.handler.expr, "const"));
      return { ...item.prop_node, value: temp };
    });
    entry.hoisted_vars = hoisted_vars;
    if (prefix_decls.length > 0) {
      const new_obj: ObjectExpression = { ...entry.obj, properties: new_props };
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
      hoisted_statements.set(entry.statement, [...prefix_decls, rewritten]);
    }
    return hoisted_vars;
  }
  function resolve_operation_ctor_tag(
    expression: Expression,
  ): string | undefined {
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
    const init = parentheses(declaration.init);
    if (
      init.type !== "CallExpression" || init.optional ||
      init.arguments.length !== 1 ||
      init.arguments[0].type !== "Literal" ||
      typeof init.arguments[0].value !== "string"
    ) return undefined;
    const inner = parentheses(init.callee);
    if (
      inner.type !== "CallExpression" || inner.optional ||
      inner.arguments.length !== 0 ||
      !is_operation_helper(inner.callee, "operation")
    ) return undefined;
    return init.arguments[0].value;
  }
  function match_operation_send(
    expression: Expression,
  ): OperationSend | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || value.optional ||
      value.arguments.some((argument) => argument.type === "SpreadElement")
    ) return undefined;
    // Form 1: Op.send() or Op.send(payload)
    if (
      value.callee.type === "MemberExpression" && !value.callee.computed &&
      !value.callee.optional && value.callee.property.type === "Identifier" &&
      value.callee.property.name === "send" && value.arguments.length <= 1
    ) {
      const tag = resolve_operation_ctor_tag(value.callee.object);
      if (tag !== undefined) {
        return {
          tag,
          payload: value.arguments[0] as Expression | undefined,
          has_payload: value.arguments.length === 1,
        };
      }
    }
    // Form 2: Effect.send(...) or send(...)
    if (
      value.arguments.length === 1 &&
      is_operation_helper(value.callee, "send")
    ) {
      let arg = parentheses(value.arguments[0] as Expression);
      while (
        arg.type === "TSAsExpression" || arg.type === "TSSatisfiesExpression"
      ) arg = parentheses(arg.expression);
      // Unwrap Effect.operation<...>()(["tag", payload])
      if (
        arg.type === "CallExpression" && !arg.optional &&
        arg.arguments.length === 1 &&
        arg.arguments[0].type !== "SpreadElement"
      ) {
        const inner = parentheses(arg.callee);
        if (
          inner.type === "CallExpression" && !inner.optional &&
          inner.arguments.length === 0 &&
          is_operation_helper(inner.callee, "operation")
        ) {
          arg = parentheses(arg.arguments[0] as Expression);
          while (
            arg.type === "TSAsExpression" ||
            arg.type === "TSSatisfiesExpression"
          ) arg = parentheses(arg.expression);
        }
      }
      // Effect.send(Op()) or Effect.send(Op(payload))
      if (
        arg.type === "CallExpression" && !arg.optional &&
        arg.arguments.length <= 1 &&
        !arg.arguments.some((a) => a.type === "SpreadElement")
      ) {
        const tag = resolve_operation_ctor_tag(arg.callee);
        if (tag !== undefined) {
          return {
            tag,
            payload: arg.arguments[0] as Expression | undefined,
            has_payload: arg.arguments.length === 1,
          };
        }
      }
      // Effect.send(["tag"]) or Effect.send(["tag", payload])
      if (
        arg.type === "ArrayExpression" &&
        (arg.elements.length === 1 || arg.elements.length === 2) &&
        arg.elements[0] !== null && arg.elements[0].type === "Literal" &&
        typeof arg.elements[0].value === "string" &&
        (arg.elements.length === 1 ||
          (arg.elements[1] !== null &&
            arg.elements[1].type !== "SpreadElement"))
      ) {
        return {
          tag: arg.elements[0].value,
          payload: arg.elements[1] as Expression | undefined,
          has_payload: arg.elements.length === 2,
        };
      }
    }
    return undefined;
  }
  function extract_array_t_literal(
    expression: Expression,
  ): ArrayBufferSpec | undefined {
    const value = parentheses(expression);
    if (
      value.type !== "CallExpression" || value.optional ||
      value.arguments.length !== 1 ||
      value.callee.type !== "Identifier" ||
      !services.imports.array_constructors?.has(value.callee.name) ||
      !services.bindings.imported(value.callee)
    ) return undefined;
    const type_params = value.typeArguments?.params;
    if (type_params !== undefined && type_params.length !== 1) return undefined;
    const arg = parentheses(value.arguments[0] as Expression);
    if (arg.type !== "ArrayExpression") return undefined;
    const elements: Expression[] = [];
    for (const el of arg.elements) {
      if (el === null || el.type === "SpreadElement") return undefined;
      elements.push(el);
    }
    return {
      array_ctor: value.callee,
      init_elements: elements,
      element_type: type_params?.[0],
    };
  }
  function writer_cell_array_init(
    cell_declaration: Node,
  ): ArrayBufferSpec | undefined {
    if (
      cell_declaration.type !== "VariableDeclarator" ||
      cell_declaration.init === null
    ) return undefined;
    const init = parentheses(cell_declaration.init);
    if (
      init.type !== "CallExpression" || init.optional ||
      init.arguments.length !== 2 ||
      init.arguments[1].type === "SpreadElement"
    ) return undefined;
    const spec = extract_array_t_literal(init.arguments[1] as Expression);
    if (
      spec === undefined ||
      (spec.init_elements.length === 0 && spec.element_type === undefined)
    ) return undefined;
    return spec;
  }
  function check_writer_slot_array_buffer(
    body: BlockStatement,
    match_yield: (expression: Expression) => YieldMatch | undefined,
    slot_index: number,
    init_spec: ArrayBufferSpec | undefined,
  ): ArrayBufferSpec | undefined {
    if (init_spec === undefined) return undefined;
    if (
      init_spec.init_elements.length === 0 &&
      init_spec.element_type === undefined
    ) return undefined;
    let valid = true;
    let saw_write = false;
    walk(body, (child) => {
      if (!valid || function_like(child)) return false;
      if (
        child.type === "YieldExpression" && child.delegate &&
        child.argument !== null
      ) {
        const matched = match_yield(child.argument);
        if (
          matched !== undefined && matched.kind === "cell" &&
          matched.slot === slot_index
        ) {
          saw_write = true;
          const op = matched.operation;
          if (op.name !== "tell" && op.name !== "writer") {
            valid = false;
            return false;
          }
          const log_arg = op.name === "tell"
            ? op.arguments[0]
            : op.arguments[1];
          const lit = extract_array_t_literal(log_arg);
          if (lit === undefined) {
            valid = false;
            return false;
          }
        }
      }
    });
    return valid && saw_write ? init_spec : undefined;
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
    let has_expr_yield = false;
    let saw_any_non_directive = false;

    function validate_expr(
      expr: Expression,
      in_control: boolean,
      nested_in_expr: boolean,
    ): boolean {
      if (!contains_await_yield(expr)) {
        if (
          yield_count === 0 && !is_pure_literal(expr) && !function_like(expr)
        ) {
          saw_any_non_directive = true;
        }
        return true;
      }
      if (nested_in_expr) has_expr_yield = true;
      switch (expr.type) {
        case "ParenthesizedExpression":
        case "TSAsExpression":
        case "TSSatisfiesExpression":
        case "TSNonNullExpression":
        case "TSTypeAssertion":
          return validate_expr(expr.expression, in_control, nested_in_expr);
        case "YieldExpression": {
          if (!expr.delegate || expr.argument === null) return false;
          const matched = match_yield(expr.argument);
          if (matched === undefined) return false;
          // Validate inner yield* arguments in exact JS left-to-right order first.
          if (matched.kind === "cell" || matched.kind === "except") {
            for (const arg of matched.operation.arguments) {
              if (!validate_expr(arg, in_control, true)) return false;
            }
          } else if (matched.kind === "task") {
            if (!validate_expr(matched.expr, in_control, true)) return false;
          } else if (matched.send.payload !== undefined) {
            if (!validate_expr(matched.send.payload, in_control, true)) {
              return false;
            }
          }
          if (yield_count === 0 && saw_any_non_directive) {
            has_prefix_before_first_yield = true;
          }
          if (in_control) has_control_flow = true;
          yield_count += 1;
          return true;
        }
        case "UnaryExpression":
          if (expr.operator === "delete") return false;
          return validate_expr(expr.argument, in_control, true);
        case "BinaryExpression":
          if (expr.left.type === "PrivateIdentifier") {
            return validate_expr(expr.right, in_control, true);
          }
          if (!validate_expr(expr.left, in_control, true)) return false;
          return validate_expr(expr.right, in_control, true);
        case "LogicalExpression":
          if (!validate_expr(expr.left, in_control, true)) return false;
          return validate_expr(expr.right, in_control, true);
        case "ConditionalExpression":
          return validate_expr(expr.test, in_control, true) &&
            validate_expr(expr.consequent, true, true) &&
            validate_expr(expr.alternate, true, true);
        case "SequenceExpression":
          return expr.expressions.every((item) =>
            validate_expr(item, in_control, true)
          );
        case "ArrayExpression":
          for (const el of expr.elements) {
            if (el === null) continue;
            const target_el = el.type === "SpreadElement" ? el.argument : el;
            if (!validate_expr(target_el, in_control, true)) return false;
          }
          return true;
        case "ObjectExpression":
          for (const prop of expr.properties) {
            if (prop.type === "SpreadElement") {
              if (!validate_expr(prop.argument, in_control, true)) return false;
            } else if (prop.type === "Property" && prop.kind === "init") {
              if (
                prop.computed &&
                !validate_expr(prop.key as Expression, in_control, true)
              ) return false;
              if (!validate_expr(prop.value as Expression, in_control, true)) {
                return false;
              }
            } else {
              return false;
            }
          }
          return true;
        case "TemplateLiteral":
          return expr.expressions.every((item) =>
            validate_expr(item, in_control, true)
          );
        case "CallExpression": {
          if (expr.optional) return false;
          if (expr.callee.type === "MemberExpression") {
            if (expr.callee.optional) return false;
            if (!validate_expr(expr.callee.object, in_control, true)) {
              return false;
            }
            if (
              expr.callee.computed &&
              !validate_expr(expr.callee.property, in_control, true)
            ) return false;
          } else if (!validate_expr(expr.callee, in_control, true)) {
            return false;
          }
          for (const arg of expr.arguments) {
            const target_arg = arg.type === "SpreadElement"
              ? arg.argument
              : arg;
            if (!validate_expr(target_arg, in_control, true)) return false;
          }
          return true;
        }
        case "NewExpression":
          if (!validate_expr(expr.callee, in_control, true)) return false;
          for (const arg of expr.arguments) {
            const target_arg = arg.type === "SpreadElement"
              ? arg.argument
              : arg;
            if (!validate_expr(target_arg, in_control, true)) return false;
          }
          return true;
        case "MemberExpression":
          if (expr.optional) return false;
          if (!validate_expr(expr.object, in_control, true)) return false;
          if (
            expr.computed && !validate_expr(expr.property, in_control, true)
          ) return false;
          return true;
        case "AssignmentExpression":
          if (expr.left.type !== "Identifier") return false;
          if (
            expr.operator === "&&=" || expr.operator === "||=" ||
            expr.operator === "??="
          ) return false;
          return validate_expr(expr.right, in_control, true);
        default:
          return false;
      }
    }

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
      if (statement.type === "VariableDeclaration") {
        const before = yield_count;
        for (const decl of statement.declarations) {
          if (decl.init === null) continue;
          const direct_yield = statement.declarations.length === 1 &&
            decl.init.type === "YieldExpression";
          if (!validate_expr(decl.init, in_control, !direct_yield)) {
            return false;
          }
        }
        if (yield_count === before && yield_count === 0) {
          saw_any_non_directive = true;
        }
        return true;
      }
      if (statement.type === "ExpressionStatement") {
        const before = yield_count;
        const direct_yield = statement.expression.type === "YieldExpression";
        if (!validate_expr(statement.expression, in_control, !direct_yield)) {
          return false;
        }
        if (yield_count === before && yield_count === 0) {
          saw_any_non_directive = true;
        }
        return true;
      }
      if (statement.type === "ReturnStatement") {
        if (statement.argument !== null) {
          const direct_yield = statement.argument.type === "YieldExpression";
          if (!validate_expr(statement.argument, in_control, !direct_yield)) {
            return false;
          }
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
        for (const inner of statement.body) {
          if (!visit_stmt(inner as Statement, in_loop, in_switch, true)) {
            return false;
          }
        }
        return true;
      }
      if (statement.type === "IfStatement") {
        const before = yield_count;
        if (!validate_expr(statement.test, true, true)) return false;
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
        const before = yield_count;
        if (statement.init !== null) {
          if (statement.init.type === "VariableDeclaration") {
            if (!visit_stmt(statement.init, in_loop, in_switch, true)) {
              return false;
            }
          } else if (!validate_expr(statement.init, true, true)) {
            return false;
          }
        }
        if (
          statement.test !== null && !validate_expr(statement.test, true, true)
        ) return false;
        if (statement.update !== null) {
          if (
            contains_await_yield(statement.update) &&
            contains_continue(statement.body)
          ) return false;
          if (!validate_expr(statement.update, true, true)) return false;
        }
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (statement.type === "WhileStatement") {
        const before = yield_count;
        if (!validate_expr(statement.test, true, true)) return false;
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (statement.type === "DoWhileStatement") {
        const before = yield_count;
        if (
          contains_await_yield(statement.test) &&
          contains_continue(statement.body)
        ) return false;
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (!validate_expr(statement.test, true, true)) return false;
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
          control_hazard(statement.left)
        ) return false;
        const before = yield_count;
        if (!validate_expr(statement.right, true, true)) return false;
        if (!visit_stmt(statement.body, true, in_switch, true)) return false;
        if (yield_count > before) has_control_flow = true;
        else if (yield_count === 0) saw_any_non_directive = true;
        return true;
      }
      if (statement.type === "SwitchStatement") {
        const before = yield_count;
        if (!validate_expr(statement.discriminant, true, true)) return false;
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
      has_expr_yield,
    };
  }
  function slot_output_expr(slot: EmitSlot): Expression {
    if (slot.array_buffer !== undefined) {
      const wrapped = call(slot.array_buffer.array_ctor, [slot.current]);
      if (slot.array_buffer.element_type !== undefined) {
        wrapped.typeArguments = node({
          type: "TSTypeParameterInstantiation",
          params: Array.from([slot.array_buffer.element_type]),
        });
      }
      return wrapped;
    }
    return slot.current;
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
      readonly async_task?: boolean;
      readonly except?: {
        readonly slot_index: number;
        readonly either_id: IdentifierReference;
        readonly inner_return?: (value: Expression) => Expression;
        readonly outer_return?: (value: Expression) => Expression;
      };
    },
  ): Expression {
    const eager = options.eager_init;
    const is_async_task = options.async_task === true;
    const except_info = options.except;
    const except_idx = except_info?.slot_index ?? -1;

    const emit_slot_decl = (slot: EmitSlot, target_stmts: Statement[]) => {
      if (slot.kind === "except") return;
      if (slot.kind === "operations") {
        if (
          slot.op_handlers !== undefined && slot.op_handler_vars !== undefined
        ) {
          for (const [tag, handler] of slot.op_handlers) {
            if (handler.kind === "dynamic" && handler.hoisted === undefined) {
              const hv = slot.op_handler_vars.get(tag);
              if (hv !== undefined) {
                target_stmts.push(variable(hv, handler.expr, "const"));
              }
            }
          }
        }
        return;
      }
      if (slot.array_buffer !== undefined) {
        const arr_type: TSType | undefined =
          slot.array_buffer.element_type !== undefined
            ? node({
              type: "TSArrayType",
              elementType: slot.array_buffer.element_type,
            })
            : undefined;
        if (eager) {
          target_stmts.push(
            variable(
              slot.current,
              node({
                type: "ArrayExpression",
                elements: [...slot.array_buffer.init_elements],
              }),
              "const",
              arr_type,
            ),
          );
        } else {
          target_stmts.push(
            variable(
              slot.current,
              node({
                type: "TSAsExpression",
                expression: void_zero(),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
              "let",
              arr_type,
            ),
          );
          target_stmts.push(
            variable(
              slot.ready!,
              node({ type: "Literal", value: false, raw: "false" }),
              "let",
            ),
          );
        }
        return;
      }
      const decl_kind: "const" | "let" = slot.kind === "reader" && eager
        ? "const"
        : "let";
      if (eager) {
        const init_val = slot.input_thunk !== undefined
          ? call(slot.input_thunk, [])
          : slot.input_expr;
        target_stmts.push(
          variable(slot.current, init_val, decl_kind, slot.type),
        );
      } else {
        target_stmts.push(
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
        target_stmts.push(
          variable(
            slot.ready!,
            node({ type: "Literal", value: false, raw: "false" }),
            "let",
          ),
        );
      }
    };

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
    const emit_range_ensure = (
      from: number,
      to: number,
      target_stmts: Statement[],
    ) => {
      if (eager) return;
      for (let i = from; i < to; i += 1) {
        emit_slot_ensure(slots[i], target_stmts);
      }
    };
    const emit_all_ensure = (target_stmts: Statement[]) => {
      emit_range_ensure(0, slots.length, target_stmts);
    };

    const emit_fail_return = (
      err_expr: Expression,
      target_stmts: Statement[],
    ) => {
      if (except_idx > 0) emit_range_ensure(0, except_idx, target_stmts);
      target_stmts.push(
        ret(as_const(node({
          type: "ArrayExpression",
          elements: [literal("Left"), err_expr],
        }))),
      );
    };

    const emit_inner_return_expr = (val: Expression): Expression => {
      if (except_info === undefined) return build_return(val);
      let acc: Expression;
      if (except_info.inner_return !== undefined) {
        acc = except_info.inner_return(val);
      } else {
        acc = val;
        for (let i = 0; i < except_idx; i += 1) {
          const s = slots[i];
          if (
            s.kind === "reader" || s.kind === "state" || s.kind === "writer"
          ) {
            acc = output(acc, slot_output_expr(s), s.kind);
          }
        }
      }
      return as_const(node({
        type: "ArrayExpression",
        elements: [literal("Right"), acc],
      }));
    };

    function hoist_if_needed(
      expr: Expression,
      target_stmts: Statement[],
      prefix: string,
    ): Expression {
      const lowered = lower_expr(expr, target_stmts);
      if (is_pure_literal(lowered)) return lowered;
      const tmp = services.fresh(prefix);
      target_stmts.push(variable(tmp, lowered, "const"));
      return tmp;
    }

    function lower_expr(
      expr: Expression,
      target_stmts: Statement[],
    ): Expression {
      if (!contains_await_yield(expr)) return expr;
      switch (expr.type) {
        case "ParenthesizedExpression":
          return lower_expr(expr.expression, target_stmts);
        case "TSAsExpression":
        case "TSSatisfiesExpression":
        case "TSNonNullExpression":
        case "TSTypeAssertion":
          return {
            ...expr,
            expression: lower_expr(expr.expression, target_stmts),
          };
        case "YieldExpression": {
          const matched = match_yield(expr.argument!)!;
          return emit_yield_op(matched, target_stmts, false);
        }
        case "UnaryExpression":
          return {
            ...expr,
            argument: lower_expr(expr.argument, target_stmts),
          };
        case "BinaryExpression": {
          if (expr.left.type === "PrivateIdentifier") {
            return { ...expr, right: lower_expr(expr.right, target_stmts) };
          }
          const right_has = contains_await_yield(expr.right);
          const left = right_has
            ? hoist_if_needed(expr.left, target_stmts, "lhs")
            : lower_expr(expr.left, target_stmts);
          const right = right_has
            ? lower_expr(expr.right, target_stmts)
            : expr.right;
          return { ...expr, left, right };
        }
        case "LogicalExpression": {
          const left = hoist_if_needed(expr.left, target_stmts, "log_lhs");
          if (!contains_await_yield(expr.right)) {
            return { ...expr, left };
          }
          const right_stmts: Statement[] = [];
          const right_val = lower_expr(expr.right, right_stmts);
          if (except_info === undefined && !is_async_task) {
            const rhs_iife = call(
              arrow([], block([...right_stmts, ret(right_val)])),
              [],
            );
            return { ...expr, left, right: rhs_iife };
          }
          const res = services.fresh("log_res");
          target_stmts.push(
            node({
              type: "VariableDeclaration",
              kind: "let",
              declarations: [
                node({ type: "VariableDeclarator", id: res, init: null }),
              ],
            }),
          );
          let test: Expression;
          if (expr.operator === "&&") test = left;
          else if (expr.operator === "||") {
            test = node({
              type: "UnaryExpression",
              operator: "!",
              prefix: true,
              argument: left,
            });
          } else {
            test = node({
              type: "LogicalExpression",
              operator: "||",
              left: node({
                type: "BinaryExpression",
                operator: "===",
                left,
                right: node({ type: "Literal", value: null, raw: "null" }),
              }),
              right: node({
                type: "BinaryExpression",
                operator: "===",
                left,
                right: void_zero(),
              }),
            });
          }
          target_stmts.push(
            node({
              type: "IfStatement",
              test,
              consequent: block([...right_stmts, assign(res, right_val)]),
              alternate: block([assign(res, left)]),
            }),
          );
          return res;
        }
        case "ConditionalExpression": {
          const test = lower_expr(expr.test, target_stmts);
          if (
            !contains_await_yield(expr.consequent) &&
            !contains_await_yield(expr.alternate)
          ) {
            return { ...expr, test };
          }
          const cons_stmts: Statement[] = [];
          const cons_val = lower_expr(expr.consequent, cons_stmts);
          const alt_stmts: Statement[] = [];
          const alt_val = lower_expr(expr.alternate, alt_stmts);
          if (except_info === undefined && !is_async_task) {
            const cons_expr = cons_stmts.length > 0
              ? call(arrow([], block([...cons_stmts, ret(cons_val)])), [])
              : cons_val;
            const alt_expr = alt_stmts.length > 0
              ? call(arrow([], block([...alt_stmts, ret(alt_val)])), [])
              : alt_val;
            return {
              ...expr,
              test,
              consequent: cons_expr,
              alternate: alt_expr,
            };
          }
          const res = services.fresh("cond_res");
          target_stmts.push(
            node({
              type: "VariableDeclaration",
              kind: "let",
              declarations: [
                node({ type: "VariableDeclarator", id: res, init: null }),
              ],
            }),
          );
          target_stmts.push(
            node({
              type: "IfStatement",
              test,
              consequent: block([...cons_stmts, assign(res, cons_val)]),
              alternate: block([...alt_stmts, assign(res, alt_val)]),
            }),
          );
          return res;
        }
        case "SequenceExpression": {
          let last_expr: Expression = void_zero();
          for (let i = 0; i < expr.expressions.length; i += 1) {
            const item = expr.expressions[i];
            if (i < expr.expressions.length - 1) {
              const lowered = lower_expr(item, target_stmts);
              target_stmts.push(
                node({ type: "ExpressionStatement", expression: lowered }),
              );
            } else {
              last_expr = lower_expr(item, target_stmts);
            }
          }
          return last_expr;
        }
        case "ArrayExpression": {
          let last_yield_idx = -1;
          for (let i = 0; i < expr.elements.length; i += 1) {
            const el = expr.elements[i];
            if (el !== null && contains_await_yield(el)) last_yield_idx = i;
          }
          const elements = expr.elements.map((el, i) => {
            if (el === null) return null;
            if (el.type === "SpreadElement") {
              return {
                ...el,
                argument: i < last_yield_idx
                  ? hoist_if_needed(el.argument, target_stmts, "elem")
                  : lower_expr(el.argument, target_stmts),
              };
            }
            return i < last_yield_idx
              ? hoist_if_needed(el, target_stmts, "elem")
              : lower_expr(el, target_stmts);
          });
          return { ...expr, elements };
        }
        case "ObjectExpression": {
          let last_yield_idx = -1;
          for (let i = 0; i < expr.properties.length; i += 1) {
            if (contains_await_yield(expr.properties[i])) last_yield_idx = i;
          }
          const properties = expr.properties.map((prop, i) => {
            if (prop.type === "SpreadElement") {
              return {
                ...prop,
                argument: i < last_yield_idx
                  ? hoist_if_needed(prop.argument, target_stmts, "prop")
                  : lower_expr(prop.argument, target_stmts),
              };
            }
            const p = prop as ObjectProperty;
            const key = p.computed
              ? (i <= last_yield_idx
                ? hoist_if_needed(p.key as Expression, target_stmts, "key")
                : p.key)
              : p.key;
            const value = i < last_yield_idx
              ? hoist_if_needed(p.value as Expression, target_stmts, "prop")
              : lower_expr(p.value as Expression, target_stmts);
            return { ...p, key, value, shorthand: false };
          });
          return { ...expr, properties };
        }
        case "TemplateLiteral": {
          let last_yield_idx = -1;
          for (let i = 0; i < expr.expressions.length; i += 1) {
            if (contains_await_yield(expr.expressions[i])) last_yield_idx = i;
          }
          const expressions = expr.expressions.map((item, i) =>
            i < last_yield_idx
              ? hoist_if_needed(item, target_stmts, "tpl")
              : lower_expr(item, target_stmts)
          );
          return { ...expr, expressions };
        }
        case "CallExpression": {
          let last_arg_yield = -1;
          for (let i = 0; i < expr.arguments.length; i += 1) {
            if (contains_await_yield(expr.arguments[i])) last_arg_yield = i;
          }
          let callee = expr.callee;
          if (callee.type === "MemberExpression") {
            const prop_has = callee.computed &&
              contains_await_yield(callee.property);
            const obj = prop_has || last_arg_yield >= 0
              ? hoist_if_needed(callee.object, target_stmts, "recv")
              : lower_expr(callee.object, target_stmts);
            if (callee.computed) {
              const prop = last_arg_yield >= 0
                ? hoist_if_needed(callee.property, target_stmts, "key")
                : lower_expr(callee.property, target_stmts);
              callee = { ...callee, object: obj, property: prop };
            } else {
              callee = { ...callee, object: obj };
            }
          } else {
            callee = last_arg_yield >= 0 && callee.type !== "Identifier"
              ? hoist_if_needed(callee, target_stmts, "callee")
              : lower_expr(callee, target_stmts);
          }
          const args = expr.arguments.map((arg, i) => {
            if (arg.type === "SpreadElement") {
              return {
                ...arg,
                argument: i < last_arg_yield
                  ? hoist_if_needed(arg.argument, target_stmts, "arg")
                  : lower_expr(arg.argument, target_stmts),
              };
            }
            return i < last_arg_yield
              ? hoist_if_needed(arg, target_stmts, "arg")
              : lower_expr(arg, target_stmts);
          });
          return { ...expr, callee, arguments: args };
        }
        case "NewExpression": {
          let last_arg_yield = -1;
          for (let i = 0; i < expr.arguments.length; i += 1) {
            if (contains_await_yield(expr.arguments[i])) last_arg_yield = i;
          }
          const callee =
            last_arg_yield >= 0 && expr.callee.type !== "Identifier"
              ? hoist_if_needed(expr.callee, target_stmts, "ctor")
              : lower_expr(expr.callee, target_stmts);
          const args = expr.arguments.map((arg, i) => {
            if (arg.type === "SpreadElement") {
              return {
                ...arg,
                argument: i < last_arg_yield
                  ? hoist_if_needed(arg.argument, target_stmts, "arg")
                  : lower_expr(arg.argument, target_stmts),
              };
            }
            return i < last_arg_yield
              ? hoist_if_needed(arg, target_stmts, "arg")
              : lower_expr(arg, target_stmts);
          });
          return { ...expr, callee, arguments: args };
        }
        case "MemberExpression": {
          const prop_has = expr.computed && contains_await_yield(expr.property);
          const obj = prop_has
            ? hoist_if_needed(expr.object, target_stmts, "obj")
            : lower_expr(expr.object, target_stmts);
          if (expr.computed) {
            return {
              ...expr,
              object: obj,
              property: lower_expr(expr.property, target_stmts),
            };
          }
          return { ...expr, object: obj };
        }
        case "AssignmentExpression": {
          const left_id = expr.left as IdentifierReference;
          if (expr.operator === "=") {
            const rhs = lower_expr(expr.right, target_stmts);
            return { ...expr, right: rhs };
          }
          const prev = services.fresh("assign_lhs");
          target_stmts.push(variable(prev, left_id, "const"));
          const rhs = lower_expr(expr.right, target_stmts);
          const bin_op = expr.operator.slice(0, -1) as
            | "+"
            | "-"
            | "*"
            | "/"
            | "%"
            | "**"
            | "<<"
            | ">>"
            | ">>>"
            | "&"
            | "^"
            | "|";
          return node({
            type: "AssignmentExpression",
            operator: "=",
            left: left_id,
            right: node({
              type: "BinaryExpression",
              operator: bin_op,
              left: prev,
              right: rhs,
            }),
          });
        }
        default:
          return expr;
      }
    }

    function emit_yield_op(
      matched: YieldMatch,
      target_stmts: Statement[],
      discard_result: boolean,
    ): Expression {
      if (matched.kind === "task") {
        const lowered = lower_expr(matched.expr, target_stmts);
        switch (matched.task_kind) {
          case "pure":
            return lowered;
          case "from_fn": {
            const cb = parentheses(lowered);
            if (
              cb.type === "ArrowFunctionExpression" && !cb.generator &&
              cb.typeParameters == null && cb.returnType == null &&
              cb.params.length === 0 && cb.body.type !== "BlockStatement"
            ) {
              const inner = cb.body as Expression;
              if (!cb.async && is_sync_non_thenable_expr(inner)) return inner;
              return node({ type: "AwaitExpression", argument: inner });
            }
            if (
              cb.type === "ArrowFunctionExpression" && !cb.generator &&
              cb.params.length === 0
            ) {
              return node({
                type: "AwaitExpression",
                argument: call(cb, []),
              });
            }
            return node({
              type: "AwaitExpression",
              argument: call(lowered, [void_zero()]),
            });
          }
          case "task_ctor": {
            const cb = parentheses(lowered);
            if (
              cb.type === "ArrowFunctionExpression" && !cb.generator &&
              cb.typeParameters == null && cb.returnType == null &&
              cb.params.length === 0 && cb.body.type !== "BlockStatement"
            ) {
              return node({
                type: "AwaitExpression",
                argument: cb.body as Expression,
              });
            }
            return node({
              type: "AwaitExpression",
              argument: call(lowered, [void_zero()]),
            });
          }
          case "arbitrary":
            return node({
              type: "AwaitExpression",
              argument: call(call(member(lowered, "value"), []), []),
            });
        }
      }
      const slot = slots[matched.slot];
      if (matched.kind === "except") {
        const op = matched.operation;
        const lowered_args = op.arguments.map((arg, index) => {
          const lowered = lower_expr(arg, target_stmts);
          const temp = services.fresh(op.name + "_arg_" + index);
          const type = index === 0 && op.name === "fail"
            ? op.types?.[0]
            : undefined;
          target_stmts.push(
            variable(
              temp,
              node({
                type: "SequenceExpression",
                expressions: [void_zero(), lowered],
              }),
              "const",
              type,
            ),
          );
          return temp;
        });
        switch (op.name) {
          case "fail":
            emit_fail_return(lowered_args[0], target_stmts);
            return node({
              type: "TSAsExpression",
              expression: void_zero(),
              typeAnnotation: node({ type: "TSNeverKeyword" }),
            });
          case "from_either": {
            const raw = services.fresh("except_raw");
            target_stmts.push(
              variable(
                raw,
                call(member(lowered_args[0], "value"), []),
                "const",
              ),
            );
            const fail_stmts: Statement[] = [];
            emit_fail_return(
              node({
                type: "MemberExpression",
                object: raw,
                property: literal(1),
                computed: true,
                optional: false,
              }),
              fail_stmts,
            );
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
                  right: literal("Left"),
                }),
                consequent: block(fail_stmts),
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
          case "from_maybe": {
            const raw = services.fresh("except_raw");
            target_stmts.push(
              variable(
                raw,
                call(member(lowered_args[0], "value"), []),
                "const",
              ),
            );
            const fail_stmts: Statement[] = [];
            emit_fail_return(call(lowered_args[1], []), fail_stmts);
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
                consequent: block(fail_stmts),
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
          case "from_nullable": {
            const fail_stmts: Statement[] = [];
            emit_fail_return(call(lowered_args[1], []), fail_stmts);
            target_stmts.push(
              node({
                type: "IfStatement",
                test: node({
                  type: "LogicalExpression",
                  operator: "||",
                  left: node({
                    type: "BinaryExpression",
                    operator: "===",
                    left: lowered_args[0],
                    right: node({ type: "Literal", value: null, raw: "null" }),
                  }),
                  right: node({
                    type: "BinaryExpression",
                    operator: "===",
                    left: lowered_args[0],
                    right: void_zero(),
                  }),
                }),
                consequent: block(fail_stmts),
                alternate: null,
              }),
            );
            return lowered_args[0];
          }
          case "from_validation": {
            const raw = services.fresh("except_raw");
            target_stmts.push(
              variable(
                raw,
                call(member(lowered_args[0], "value"), []),
                "const",
              ),
            );
            const fail_stmts: Statement[] = [];
            emit_fail_return(
              node({
                type: "MemberExpression",
                object: raw,
                property: literal(1),
                computed: true,
                optional: false,
              }),
              fail_stmts,
            );
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
                  right: literal("invalid"),
                }),
                consequent: block(fail_stmts),
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
        }
      }

      if (matched.kind === "operation") {
        const send = matched.send;
        const handler = slot.op_handlers!.get(send.tag)!;
        let payload_temp: IdentifierReference | undefined;
        if (send.has_payload && send.payload !== undefined) {
          const lowered = lower_expr(send.payload, target_stmts);
          payload_temp = services.fresh("op_arg");
          target_stmts.push(
            variable(
              payload_temp,
              node({
                type: "SequenceExpression",
                expressions: [void_zero(), lowered],
              }),
              "const",
            ),
          );
        }
        if (handler.kind === "pure_inline") {
          if (handler.body_stmts.length === 0) {
            if (handler.param === undefined) {
              return handler.result_expr;
            }
            if (
              handler.payload_only_param !== undefined &&
              handler.param_key !== undefined && handler.param_key !== null
            ) {
              const replacement = payload_temp ?? void_zero();
              return substitute_ident(
                handler.result_expr,
                handler.param_key,
                replacement,
                services,
              );
            }
            if (
              handler.param.type === "Identifier" &&
              handler.param_key !== undefined && handler.param_key !== null
            ) {
              const tuple_var = services.fresh("op_tuple");
              const tuple_elems = payload_temp !== undefined
                ? [literal(send.tag), payload_temp]
                : [literal(send.tag)];
              target_stmts.push(
                variable(
                  tuple_var,
                  as_const(node({
                    type: "ArrayExpression",
                    elements: tuple_elems,
                  })),
                  "const",
                ),
              );
              return substitute_ident(
                handler.result_expr,
                handler.param_key,
                tuple_var,
                services,
              );
            }
          }
          // Block body or destructuring pattern: wrap in zero-arg IIFE (or bare block if result unused).
          const inline_stmts: Statement[] = [];
          if (handler.payload_only_param !== undefined) {
            inline_stmts.push(
              variable(
                handler.payload_only_param,
                payload_temp ?? void_zero(),
                "const",
              ),
            );
          } else if (handler.param !== undefined) {
            const tuple_elems = payload_temp !== undefined
              ? [literal(send.tag), payload_temp]
              : [literal(send.tag)];
            inline_stmts.push(
              variable(
                handler.param,
                as_const(node({
                  type: "ArrayExpression",
                  elements: tuple_elems,
                })),
                "const",
              ),
            );
          }
          inline_stmts.push(...handler.body_stmts);
          if (discard_result) {
            inline_stmts.push(
              node({
                type: "ExpressionStatement",
                expression: handler.result_expr,
              }),
            );
            target_stmts.push(block(inline_stmts));
            return void_zero();
          }
          inline_stmts.push(ret(handler.result_expr));
          const res_var = services.fresh("op_res");
          target_stmts.push(
            variable(
              res_var,
              call(arrow([], block(inline_stmts)), []),
              "const",
            ),
          );
          return res_var;
        }
        // Dynamic handler function call with runtime pure-effect validation.
        const handler_var = handler.hoisted ??
          slot.op_handler_vars!.get(send.tag)!;
        const tuple_elems = payload_temp !== undefined
          ? [literal(send.tag), payload_temp]
          : [literal(send.tag)];
        const eff_var = services.fresh("op_eff");
        target_stmts.push(
          variable(
            eff_var,
            call(handler_var, [
              as_const(node({
                type: "ArrayExpression",
                elements: tuple_elems,
              })),
            ]),
            "const",
          ),
        );
        target_stmts.push(
          node({
            type: "IfStatement",
            test: node({
              type: "UnaryExpression",
              operator: "!",
              prefix: true,
              argument: call(slot.is_effect_id!, [eff_var]),
            }),
            consequent: node({
              type: "ThrowStatement",
              argument: node({
                type: "NewExpression",
                callee: id("TypeError"),
                arguments: [
                  literal("Operation handler returned an invalid effect"),
                ],
              }),
            }),
            alternate: null,
          }),
        );
        target_stmts.push(
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "!==",
              left: node({
                type: "MemberExpression",
                object: eff_var,
                property: literal(0),
                computed: true,
                optional: false,
              }),
              right: literal("pure"),
            }),
            consequent: node({
              type: "ThrowStatement",
              argument: node({
                type: "NewExpression",
                callee: id("TypeError"),
                arguments: [
                  node({
                    type: "BinaryExpression",
                    operator: "+",
                    left: literal("Unhandled effect operation: "),
                    right: call(id("String"), [
                      node({
                        type: "MemberExpression",
                        object: node({
                          type: "TSAsExpression",
                          expression: node({
                            type: "MemberExpression",
                            object: eff_var,
                            property: literal(1),
                            computed: true,
                            optional: false,
                          }),
                          typeAnnotation: node({
                            type: "TSTypeReference",
                            typeName: id("Array"),
                            typeArguments: node({
                              type: "TSTypeParameterInstantiation",
                              params: Array.from<TSType>([
                                node({ type: "TSUnknownKeyword" }),
                              ]),
                            }),
                          }),
                        }),
                        property: literal(0),
                        computed: true,
                        optional: false,
                      }),
                    ]),
                  }),
                ],
              }),
            }),
            alternate: null,
          }),
        );
        return node({
          type: "MemberExpression",
          object: eff_var,
          property: literal(1),
          computed: true,
          optional: false,
        });
      }

      // Cell / Reader / State / Writer primitive
      const operation = matched.operation;
      if (
        slot.array_buffer !== undefined &&
        (operation.name === "tell" || operation.name === "writer")
      ) {
        let value: Expression = void_zero();
        if (operation.name === "writer") {
          const lowered_val = lower_expr(operation.arguments[0], target_stmts);
          const val_tmp = services.fresh("writer_argument_0");
          target_stmts.push(
            variable(
              val_tmp,
              node({
                type: "SequenceExpression",
                expressions: [void_zero(), lowered_val],
              }),
              "const",
            ),
          );
          value = val_tmp;
        }
        const log_arg = operation.name === "tell"
          ? operation.arguments[0]
          : operation.arguments[1];
        const lit = extract_array_t_literal(log_arg)!;
        const elem_temps = lit.init_elements.map((el, idx) => {
          const lowered_el = lower_expr(el, target_stmts);
          const tmp = services.fresh(operation.name + "_item_" + idx);
          target_stmts.push(
            variable(
              tmp,
              node({
                type: "SequenceExpression",
                expressions: [void_zero(), lowered_el],
              }),
              "const",
            ),
          );
          return tmp;
        });
        emit_slot_ensure(slot, target_stmts);
        if (elem_temps.length > 0) {
          target_stmts.push(
            node({
              type: "ExpressionStatement",
              expression: call(member(slot.current, "push"), elem_temps),
            }),
          );
        }
        return value;
      }

      const arguments_ = operation.arguments.map((argument, index) => {
        const lowered_arg = lower_expr(argument, target_stmts);
        const temporary = services.fresh(operation.name + "_argument_" + index);
        let typed_arg = lowered_arg;
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
              typed_arg = annotate_callback(lowered_arg, slot.type);
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
      if (statement.type === "VariableDeclaration") {
        if (statement.declarations.length === 1) {
          const decl = statement.declarations[0];
          const init = decl.init;
          if (init?.type === "YieldExpression") {
            const stmts: Statement[] = [];
            const val = emit_yield_op(
              match_yield(init.argument!)!,
              stmts,
              false,
            );
            stmts.push({
              ...statement,
              declarations: [{ ...decl, init: val }],
            });
            return stmts;
          }
        }
        if (contains_await_yield(statement)) {
          const stmts: Statement[] = [];
          for (const decl of statement.declarations) {
            if (decl.init !== null && contains_await_yield(decl.init)) {
              const val = lower_expr(decl.init, stmts);
              stmts.push({
                ...statement,
                declarations: [{ ...decl, init: val }],
              });
            } else {
              stmts.push({ ...statement, declarations: [decl] });
            }
          }
          return stmts;
        }
        return [statement];
      }
      if (statement.type === "ExpressionStatement") {
        if (statement.expression.type === "YieldExpression") {
          const stmts: Statement[] = [];
          const matched = match_yield(statement.expression.argument!)!;
          const val = emit_yield_op(matched, stmts, true);
          if (
            (matched.kind === "cell" &&
              (matched.operation.name === "asks" ||
                matched.operation.name === "gets")) ||
            (matched.kind === "operation" && !is_void_zero(val))
          ) {
            stmts.push(
              node({ type: "ExpressionStatement", expression: val }),
            );
          }
          return stmts;
        }
        if (contains_await_yield(statement.expression)) {
          const stmts: Statement[] = [];
          const val = lower_expr(statement.expression, stmts);
          if (!is_void_zero(val)) {
            stmts.push(
              node({ type: "ExpressionStatement", expression: val }),
            );
          }
          return stmts;
        }
        return [statement];
      }
      if (statement.type === "ReturnStatement") {
        const stmts: Statement[] = [];
        const ensure_end = () => {
          if (except_info !== undefined) {
            emit_range_ensure(0, except_idx, stmts);
          } else emit_all_ensure(stmts);
        };
        if (statement.argument?.type === "YieldExpression") {
          const val = emit_yield_op(
            match_yield(statement.argument.argument!)!,
            stmts,
            false,
          );
          ensure_end();
          stmts.push(ret(emit_inner_return_expr(val)));
          return stmts;
        }
        const raw = statement.argument !== null
          ? lower_expr(statement.argument, stmts)
          : void_zero();
        if (!eager && !is_pure_input(raw)) {
          const ret_tmp = services.fresh("return_value");
          stmts.push(variable(ret_tmp, raw, "const"));
          ensure_end();
          stmts.push(ret(emit_inner_return_expr(ret_tmp)));
          return stmts;
        }
        ensure_end();
        stmts.push(ret(emit_inner_return_expr(raw)));
        return stmts;
      }
      if (statement.type === "BlockStatement") {
        return [block(lower_list(statement.body as Statement[]))];
      }
      if (statement.type === "IfStatement") {
        const stmts: Statement[] = [];
        const test = lower_expr(statement.test, stmts);
        const cons = lower_single(statement.consequent);
        const alt = statement.alternate !== null
          ? lower_single(statement.alternate)
          : null;
        stmts.push({ ...statement, test, consequent: cons, alternate: alt });
        return stmts;
      }
      if (statement.type === "WhileStatement") {
        if (!contains_await_yield(statement.test)) {
          return [{ ...statement, body: lower_single(statement.body) }];
        }
        const test_stmts: Statement[] = [];
        const test_val = lower_expr(statement.test, test_stmts);
        const loop_body = [
          ...test_stmts,
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
          ...lower_stmt(statement.body),
        ];
        return [
          node({
            type: "WhileStatement",
            test: node({ type: "Literal", value: true, raw: "true" }),
            body: block(loop_body),
          }),
        ];
      }
      if (statement.type === "DoWhileStatement") {
        if (!contains_await_yield(statement.test)) {
          return [{ ...statement, body: lower_single(statement.body) }];
        }
        const test_stmts: Statement[] = [];
        const test_val = lower_expr(statement.test, test_stmts);
        const loop_body = [
          ...lower_stmt(statement.body),
          ...test_stmts,
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
        ];
        return [
          node({
            type: "WhileStatement",
            test: node({ type: "Literal", value: true, raw: "true" }),
            body: block(loop_body),
          }),
        ];
      }
      if (statement.type === "ForStatement") {
        const init_has = statement.init !== null &&
          contains_await_yield(statement.init);
        const test_has = statement.test !== null &&
          contains_await_yield(statement.test);
        const update_has = statement.update !== null &&
          contains_await_yield(statement.update);
        if (!init_has && !test_has && !update_has) {
          return [{ ...statement, body: lower_single(statement.body) }];
        }
        const prefix_stmts: Statement[] = [];
        let next_init = statement.init;
        if (init_has && statement.init !== null) {
          if (statement.init.type === "VariableDeclaration") {
            prefix_stmts.push(...lower_stmt(statement.init));
          } else {
            const val = lower_expr(statement.init, prefix_stmts);
            if (!is_void_zero(val)) {
              prefix_stmts.push(
                node({ type: "ExpressionStatement", expression: val }),
              );
            }
          }
          next_init = null;
        }
        const body_stmts: Statement[] = [];
        let next_test = statement.test;
        if (test_has && statement.test !== null) {
          const test_val = lower_expr(statement.test, body_stmts);
          body_stmts.push(
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
          next_test = null;
        }
        body_stmts.push(...lower_stmt(statement.body));
        let next_update = statement.update;
        if (update_has && statement.update !== null) {
          const upd_val = lower_expr(statement.update, body_stmts);
          if (!is_void_zero(upd_val)) {
            body_stmts.push(
              node({ type: "ExpressionStatement", expression: upd_val }),
            );
          }
          next_update = null;
        }
        const for_node: Statement = {
          ...statement,
          init: next_init,
          test: next_test,
          update: next_update,
          body: block(body_stmts),
        };
        if (prefix_stmts.length > 0) {
          return [block([...prefix_stmts, for_node])];
        }
        return [for_node];
      }
      if (
        statement.type === "ForOfStatement" ||
        statement.type === "ForInStatement"
      ) {
        const stmts: Statement[] = [];
        const right = lower_expr(statement.right, stmts);
        stmts.push({
          ...statement,
          right,
          body: lower_single(statement.body),
        });
        return stmts;
      }
      if (statement.type === "SwitchStatement") {
        const stmts: Statement[] = [];
        const discriminant = lower_expr(statement.discriminant, stmts);
        const cases: SwitchCase[] = statement.cases.map((item) => ({
          ...item,
          consequent: lower_list(item.consequent as Statement[]),
        }));
        stmts.push({ ...statement, discriminant, cases });
        return stmts;
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

    const out_statements: Statement[] = [];
    if (except_info !== undefined) {
      // Declare outer slots (> except_idx) outside the inner except IIFE so mutations survive failure.
      for (let i = except_idx + 1; i < slots.length; i += 1) {
        emit_slot_decl(slots[i], out_statements);
      }
      const inner_stmts: Statement[] = [];
      for (let i = 0; i < except_idx; i += 1) {
        emit_slot_decl(slots[i], inner_stmts);
      }
      inner_stmts.push(...lower_list(body.body as Statement[]));
      const last_inner = inner_stmts[inner_stmts.length - 1];
      if (last_inner?.type !== "ReturnStatement") {
        emit_range_ensure(0, except_idx, inner_stmts);
        inner_stmts.push(ret(emit_inner_return_expr(void_zero())));
      }
      const except_out = services.fresh("except_out");
      out_statements.push(
        variable(
          except_out,
          is_async_task
            ? node({
              type: "AwaitExpression",
              argument: call(
                node({
                  type: "ArrowFunctionExpression",
                  id: null,
                  expression: false,
                  generator: false,
                  async: true,
                  params: [],
                  body: block(inner_stmts),
                  typeParameters: null,
                  returnType: null,
                }),
                [],
              ),
            })
            : call(arrow([], block(inner_stmts)), []),
          "const",
        ),
      );
      emit_range_ensure(except_idx + 1, slots.length, out_statements);
      const either_id = except_info.either_id;
      const either_expr = node({
        type: "TSAsExpression",
        expression: node({
          type: "ConditionalExpression",
          test: node({
            type: "BinaryExpression",
            operator: "===",
            left: node({
              type: "MemberExpression",
              object: except_out,
              property: literal(0),
              computed: true,
              optional: false,
            }),
            right: literal("Left"),
          }),
          consequent: call(member(either_id, "Left"), [
            node({
              type: "MemberExpression",
              object: except_out,
              property: literal(1),
              computed: true,
              optional: false,
            }),
          ]),
          alternate: call(member(either_id, "Right"), [
            node({
              type: "MemberExpression",
              object: except_out,
              property: literal(1),
              computed: true,
              optional: false,
            }),
          ]),
        }),
        typeAnnotation: node({
          type: "TSTypeReference",
          typeName: id("ReturnType"),
          typeArguments: node({
            type: "TSTypeParameterInstantiation",
            params: Array.from<TSType>([
              node({
                type: "TSTypeQuery",
                exprName: either_id,
                typeArguments: node({
                  type: "TSTypeParameterInstantiation",
                  params: Array.from<TSType>([
                    node({
                      type: "TSTypeQuery",
                      exprName: except_out,
                      typeArguments: null,
                    }),
                  ]),
                }),
              }),
            ]),
          }),
        }),
      });
      let acc: Expression;
      if (except_info.outer_return !== undefined) {
        acc = except_info.outer_return(either_expr);
      } else {
        acc = either_expr;
        for (let i = except_idx + 1; i < slots.length; i += 1) {
          const s = slots[i];
          if (
            s.kind === "reader" || s.kind === "state" || s.kind === "writer"
          ) {
            acc = output(acc, slot_output_expr(s), s.kind);
          }
        }
      }
      out_statements.push(ret(acc));
    } else {
      for (const slot of slots) emit_slot_decl(slot, out_statements);
      const lowered_body = lower_list(body.body as Statement[]);
      out_statements.push(...lowered_body);
      const last = out_statements[out_statements.length - 1];
      if (last?.type !== "ReturnStatement") {
        emit_all_ensure(out_statements);
        out_statements.push(ret(build_return(void_zero())));
      }
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
        thunk_args.push(
          arrow(
            [],
            slot.array_buffer !== undefined
              ? node({
                type: "ArrayExpression",
                elements: [...slot.array_buffer.init_elements],
              })
              : slot.input_expr,
          ),
        );
      }
    }
    if (is_async_task) {
      return call(
        node({
          type: "ArrowFunctionExpression",
          id: null,
          expression: false,
          generator: false,
          async: true,
          params: thunk_params,
          body: block(out_statements),
          typeParameters: null,
          returnType: null,
        }),
        thunk_args,
      );
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
      if (
        (slot.kind !== "state" && slot.kind !== "writer") ||
        slot.prop_name === undefined
      ) continue;
      const key = slot.prop_is_ident ? id(slot.prop_name) : node({
        type: "Literal",
        value: slot.prop_name,
        raw: JSON.stringify(slot.prop_name),
      });
      const prop = node({
        type: "Property",
        kind: "init",
        key,
        value: slot_output_expr(slot),
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
        if (op !== undefined) {
          return { kind: "cell", slot: slot_index, operation: op };
        }
      }
      return undefined;
    };
    const analysis = analyze_control_body(run.body!, match_yield);
    if (analysis === undefined) return undefined;
    const array_buffers = bindings.map((binding, index) => {
      if (binding.family !== "writer" || get_hoisted_vars !== undefined) {
        return undefined;
      }
      const init_spec = binding.writer_default
        ? writer_cell_array_init(binding.cell_decl)
        : extract_array_t_literal(binding.init_expr);
      return check_writer_slot_array_buffer(
        run.body!,
        match_yield,
        index,
        init_spec,
      );
    });
    const hoisted_vars = get_hoisted_vars?.();
    const all_inputs_literal = hoisted_vars !== undefined ||
      bindings.every((b, idx) =>
        (array_buffers[idx] !== undefined &&
          array_buffers[idx]!.init_elements.every(is_pure_literal)) ||
        (!b.writer_default && is_pure_literal(b.init_expr))
      );
    const all_inputs_pure = all_inputs_literal ||
      bindings.every((b, idx) =>
        (array_buffers[idx] !== undefined &&
          array_buffers[idx]!.init_elements.every(is_pure_input)) ||
        (!b.writer_default && is_pure_input(b.init_expr))
      );
    const eager_init = all_inputs_literal ||
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
      const array_buffer = array_buffers[index];
      if (eager_init) {
        return {
          kind: binding.family,
          current,
          input_expr,
          type,
          prop_name: binding.prop_name,
          prop_is_ident: binding.prop_is_ident,
          array_buffer,
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
        array_buffer,
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
      if (entry === undefined || entry.runner_kind !== "run") return undefined;
      const fused = fuse_cells_program(
        outer.arguments[0] as Expression,
        entry.bindings,
        () => ensure_prepared_hoists(entry),
      );
      if (fused !== undefined) return fused;
    }
    return undefined;
  }
  function is_run_task_callee(expression: Expression): boolean {
    if (
      expression.type === "Identifier" &&
      services.imports.task_run_functions?.has(expression.name) &&
      services.bindings.imported(expression)
    ) return true;
    return expression.type === "MemberExpression" && !expression.computed &&
      !expression.optional && expression.object.type === "Identifier" &&
      expression.property.type === "Identifier" &&
      expression.property.name === "run_task" &&
      services.bindings.imported(expression.object) &&
      ((services.imports.task_namespaces?.has(expression.object.name) ??
        false) ||
        services.imports.namespaces.has(expression.object.name));
  }
  function is_task_dict_expr(expression: Expression): boolean {
    return expression.type === "Identifier" &&
      services.task_dictionaries.has(expression.name) &&
      services.bindings.imported(expression);
  }
  function is_task_fn_expr(
    expression: Expression,
    set: ReadonlySet<string> | undefined,
    prop: string,
  ): boolean {
    if (
      set !== undefined && expression.type === "Identifier" &&
      set.has(expression.name) && services.bindings.imported(expression)
    ) return true;
    return expression.type === "MemberExpression" && !expression.computed &&
      !expression.optional && expression.object.type === "Identifier" &&
      expression.property.type === "Identifier" &&
      expression.property.name === prop &&
      services.bindings.imported(expression.object) &&
      ((services.imports.task_namespaces?.has(expression.object.name) ??
        false) ||
        services.imports.namespaces.has(expression.object.name));
  }
  function match_task_yield(expression: Expression): YieldMatch | undefined {
    let val = parentheses(expression);
    let lifted = false;
    if (
      val.type === "CallExpression" && !val.optional &&
      val.typeArguments == null && val.arguments.length === 1 &&
      val.arguments[0].type !== "SpreadElement"
    ) {
      if (effect_method(val.callee, "pure")) {
        return {
          kind: "task",
          task_kind: "pure",
          expr: val.arguments[0] as Expression,
        };
      }
      if (effect_method(val.callee, "lift")) {
        val = parentheses(val.arguments[0] as Expression);
        lifted = true;
      }
    }
    if (
      val.type === "CallExpression" && !val.optional &&
      val.typeArguments == null && val.arguments.length === 1 &&
      val.arguments[0].type !== "SpreadElement"
    ) {
      const arg = val.arguments[0] as Expression;
      if (
        is_task_fn_expr(
          val.callee,
          services.imports.task_succeed_functions,
          "succeed",
        ) ||
        (val.callee.type === "MemberExpression" && !val.callee.computed &&
          !val.callee.optional && val.callee.property.type === "Identifier" &&
          val.callee.property.name === "pure" &&
          is_task_dict_expr(val.callee.object))
      ) {
        return { kind: "task", task_kind: "pure", expr: arg };
      }
      if (
        is_task_fn_expr(
          val.callee,
          services.imports.task_from_fn_functions,
          "from_fn",
        )
      ) {
        return { kind: "task", task_kind: "from_fn", expr: arg };
      }
      if (is_task_dict_expr(val.callee)) {
        return { kind: "task", task_kind: "task_ctor", expr: arg };
      }
    }
    if (lifted) {
      return { kind: "task", task_kind: "arbitrary", expr: val };
    }
    return undefined;
  }
  function stacked_terminal_program(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      !plain_call(outer, 1) ||
      services.config.optimizations?.terminal_body === false
    ) return undefined;
    const is_run = target(outer.callee)?.imported === "run";
    const is_async_task = !is_run && is_run_task_callee(outer.callee);
    if (!is_run && !is_async_task) return undefined;
    type RawLayer =
      | {
        readonly kind: TerminalKind;
        readonly input_expr: Expression;
        readonly cell?: {
          readonly identifier: IdentifierReference;
          readonly declaration: Node;
        };
        readonly writer_default: boolean;
      }
      | {
        readonly kind: "except";
        readonly anchor_local: string;
      }
      | {
        readonly kind: "operations";
        readonly entries: readonly ParsedOpEntry[];
        readonly prepared?: PreparedOpsEntry;
        readonly anchor_local: string;
      }
      | {
        readonly kind: "cells";
        readonly bindings: readonly ParsedCellBinding[];
        readonly prepared?: PreparedCellEntry;
      };
    const layers_outer_to_inner: RawLayer[] = [];
    let cursor = parentheses(outer.arguments[0] as Expression);
    while (
      cursor.type === "CallExpression" && !cursor.optional &&
      cursor.typeArguments == null &&
      !cursor.arguments.some((a) => a.type === "SpreadElement")
    ) {
      // Check run_except(effect), preparedOps(effect), preparedHandleCells(effect)
      if (cursor.arguments.length === 1) {
        const handler = target(cursor.callee);
        if (handler !== undefined && handler.imported === "run_except") {
          layers_outer_to_inner.push({
            kind: "except",
            anchor_local: handler.local,
          });
          cursor = parentheses(cursor.arguments[0] as Expression);
          continue;
        }
        if (cursor.callee.type === "Identifier") {
          const resolved = services.bindings.resolve(cursor.callee);
          const prep = resolved !== null
            ? prepared_ops.get(resolved)
            : undefined;
          if (prep !== undefined) {
            layers_outer_to_inner.push({
              kind: "operations",
              entries: prep.entries,
              prepared: prep,
              anchor_local: prep.anchor_local,
            });
            cursor = parentheses(cursor.arguments[0] as Expression);
            continue;
          }
          const prep_cells = resolved !== null
            ? prepared_cells.get(resolved)
            : undefined;
          if (prep_cells !== undefined && prep_cells.runner_kind === "handle") {
            layers_outer_to_inner.push({
              kind: "cells",
              bindings: prep_cells.bindings,
              prepared: prep_cells,
            });
            cursor = parentheses(cursor.arguments[0] as Expression);
            continue;
          }
        }
        break;
      }
      // Check handle_operations(effect, { ... }) and handle_cells(effect, { ... })
      if (cursor.arguments.length === 2) {
        const op_runner = operation_runner_target(cursor.callee);
        if (op_runner?.name === "handle_operations") {
          const parsed = parse_op_handlers_object(
            cursor.arguments[1] as Expression,
          );
          if (parsed === undefined) return undefined;
          layers_outer_to_inner.push({
            kind: "operations",
            entries: parsed,
            anchor_local: op_runner.local,
          });
          cursor = parentheses(cursor.arguments[0] as Expression);
          continue;
        }
        if (cell_runner_target(cursor.callee) === "handle_cells") {
          const parsed = parse_cell_bindings_object(
            cursor.arguments[1] as Expression,
          );
          if (parsed === undefined) return undefined;
          layers_outer_to_inner.push({
            kind: "cells",
            bindings: parsed,
          });
          cursor = parentheses(cursor.arguments[0] as Expression);
          continue;
        }
      }
      if (cursor.arguments.length !== 2 && cursor.arguments.length !== 3) break;
      const handler = target(cursor.callee);
      if (
        handler === undefined || handler.imported === "run" ||
        handler.imported === "run_except" ||
        is_direct_terminal(handler.imported)
      ) break;
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
    const has_special_layer = layers_outer_to_inner.some((l) =>
      l.kind === "except" || l.kind === "operations" || l.kind === "cells"
    );
    if (layers_outer_to_inner.length === 0) return undefined;
    if (
      layers_outer_to_inner.length === 1 && !has_special_layer &&
      !is_async_task
    ) {
      return undefined;
    }
    const resolved_prog = resolve_program_arg(cursor);
    if (resolved_prog === undefined) return undefined;
    const run = resolved_prog.program.arguments[0];
    if (
      run.type !== "FunctionExpression" || !valid_generator(run) ||
      lexical_hazard(run.body!)
    ) return undefined;

    // Expand RawLayers (innermost first) into flat slot descriptors + return wrap steps.
    type FlatLayer =
      | {
        readonly kind: TerminalKind;
        readonly input_expr: Expression;
        readonly cell?: {
          readonly identifier: IdentifierReference;
          readonly declaration: Node;
        };
        readonly writer_default: boolean;
        readonly prop_name?: string;
        readonly prop_is_ident?: boolean;
        readonly prepared_cells?: PreparedCellEntry;
        readonly prepared_binding_index?: number;
      }
      | {
        readonly kind: "except";
        readonly anchor_local: string;
      }
      | {
        readonly kind: "operations";
        readonly entries: readonly ParsedOpEntry[];
        readonly prepared?: PreparedOpsEntry;
        readonly anchor_local: string;
      };
    type WrapStep =
      | { readonly kind: "single"; readonly slot: number }
      | {
        readonly kind: "cells";
        readonly start: number;
        readonly end: number;
      };

    const layers: FlatLayer[] = [];
    const wrap_steps: WrapStep[] = [];
    const raw_inner_to_outer = layers_outer_to_inner.reverse();
    for (const raw of raw_inner_to_outer) {
      if (raw.kind === "cells") {
        const start = layers.length;
        for (let bi = 0; bi < raw.bindings.length; bi += 1) {
          const b = raw.bindings[bi];
          layers.push({
            kind: b.family,
            input_expr: b.init_expr,
            cell: { identifier: b.cell_id, declaration: b.cell_decl },
            writer_default: b.writer_default,
            prop_name: b.prop_name,
            prop_is_ident: b.prop_is_ident,
            prepared_cells: raw.prepared,
            prepared_binding_index: bi,
          });
        }
        wrap_steps.push({ kind: "cells", start, end: layers.length });
      } else {
        const slot = layers.length;
        layers.push(raw);
        if (
          raw.kind === "reader" || raw.kind === "state" || raw.kind === "writer"
        ) {
          wrap_steps.push({ kind: "single", slot });
        }
      }
    }

    let except_slot_index = -1;
    let except_anchor_local = "";
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer.kind === "except") {
        // At most one run_except layer in a fused stack.
        if (except_slot_index >= 0) return undefined;
        except_slot_index = index;
        except_anchor_local = layer.anchor_local;
      }
    }

    const gen_locals = layers.some((l) => l.kind === "operations")
      ? collect_declared_names(run.body!)
      : undefined;

    const cell_to_slot = new Map<Node, number>();
    const unkeyed_to_slot = new Map<TerminalKind, number>();
    const op_tag_to_slot = new Map<
      string,
      { readonly slot: number; readonly handler: ParsedOpHandler }
    >();
    const slot_op_maps = new Map<number, Map<string, ParsedOpHandler>>();
    const needs_dynamic_op_effect_check = new Set<number>();

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      if (layer.kind === "except") continue;
      if (layer.kind === "operations") {
        const op_map = new Map<string, ParsedOpHandler>();
        for (const item of layer.entries) {
          let effective: ParsedOpHandler = item.handler;
          if (effective.kind === "pure_inline" && gen_locals !== undefined) {
            for (const name of effective.free_names) {
              if (gen_locals.has(name)) {
                effective = {
                  kind: "dynamic",
                  expr: item.prop_node.value as Expression,
                };
                break;
              }
            }
          }
          if (effective.kind === "dynamic") {
            // Dynamic handlers might emit effects caught by outer layers, so only allow
            // them when this operations layer is the outermost layer (index === layers.length - 1).
            if (index !== layers.length - 1) return undefined;
            const raw_h = parentheses(effective.expr);
            if (
              (raw_h.type === "ArrowFunctionExpression" ||
                raw_h.type === "FunctionExpression") &&
              raw_h.params.length > 0 && !self_typed(raw_h)
            ) return undefined;
            needs_dynamic_op_effect_check.add(index);
          }
          op_map.set(item.tag, effective);
          if (!op_tag_to_slot.has(item.tag)) {
            op_tag_to_slot.set(item.tag, { slot: index, handler: effective });
          }
        }
        slot_op_maps.set(index, op_map);
        continue;
      }
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
        const layer = layers[slot_index];
        if (layer.kind === "except" || layer.kind === "operations") continue;
        const op = cell_primitive(expression, cell_decl, layer.kind);
        if (op !== undefined) {
          return { kind: "cell", slot: slot_index, operation: op };
        }
      }
      const op = primitive(expression);
      if (op !== undefined) {
        const slot_index = unkeyed_to_slot.get(primitive_kind(op.name));
        if (slot_index !== undefined) {
          return { kind: "cell", slot: slot_index, operation: op };
        }
      }
      if (except_slot_index >= 0) {
        const ex = except_primitive(expression);
        if (ex !== undefined) {
          return { kind: "except", slot: except_slot_index, operation: ex };
        }
      }
      if (op_tag_to_slot.size > 0) {
        const send = match_operation_send(expression);
        if (send !== undefined && op_tag_to_slot.has(send.tag)) {
          return {
            kind: "operation",
            slot: op_tag_to_slot.get(send.tag)!.slot,
            send,
          };
        }
      }
      if (is_async_task) {
        return match_task_yield(expression);
      }
      return undefined;
    };

    const analysis = analyze_control_body(run.body!, match_yield);
    if (analysis === undefined) return undefined;

    // Unkeyed reader/state layers need a known input type for strict TS.
    for (const [kind] of unkeyed_to_slot) {
      if (
        kind !== "writer" &&
        input_type_in_block(run.body!, kind) === undefined
      ) return undefined;
    }

    let either_id: IdentifierReference | undefined;
    if (except_slot_index >= 0) {
      either_id = resolve_either_identifier(except_anchor_local);
      if (either_id === undefined) return undefined;
    }

    const is_effect_ids = new Map<number, IdentifierReference>();
    for (const op_slot_idx of needs_dynamic_op_effect_check) {
      const layer = layers[op_slot_idx];
      if (layer.kind !== "operations") continue;
      const helper = services.import_from_module?.(
        layer.anchor_local,
        "effects",
        "is_effect",
      );
      if (helper === undefined) return undefined;
      is_effect_ids.set(op_slot_idx, helper);
    }

    const array_buffers = layers.map((layer, index) => {
      if (layer.kind !== "writer" || layer.prepared_cells !== undefined) {
        return undefined;
      }
      const init_spec = layer.writer_default && layer.cell !== undefined
        ? writer_cell_array_init(layer.cell.declaration)
        : extract_array_t_literal(layer.input_expr);
      return check_writer_slot_array_buffer(
        run.body!,
        match_yield,
        index,
        init_spec,
      );
    });

    const all_inputs_literal = layers.every((l, idx) => {
      if (l.kind === "except") return true;
      if (l.kind === "operations") {
        const op_map = slot_op_maps.get(idx)!;
        for (const h of op_map.values()) {
          if (h.kind === "dynamic" && l.prepared === undefined) return false;
        }
        return true;
      }
      if (l.prepared_cells !== undefined) return true;
      if (array_buffers[idx] !== undefined) {
        return array_buffers[idx]!.init_elements.every(is_pure_literal);
      }
      return !l.writer_default && is_pure_literal(l.input_expr);
    });
    const all_inputs_pure = all_inputs_literal || layers.every((l, idx) => {
      if (l.kind === "except") return true;
      if (l.kind === "operations") {
        const op_map = slot_op_maps.get(idx)!;
        for (const h of op_map.values()) {
          if (
            h.kind === "dynamic" && l.prepared === undefined &&
            !is_pure_input(h.expr)
          ) {
            return false;
          }
        }
        return true;
      }
      if (l.prepared_cells !== undefined) return true;
      if (array_buffers[idx] !== undefined) {
        return array_buffers[idx]!.init_elements.every(is_pure_input);
      }
      return !l.writer_default && is_pure_input(l.input_expr);
    });
    const eager_init = all_inputs_literal ||
      (!analysis.has_prefix_before_first_yield && all_inputs_pure);

    // Hoist prepared_operations and prepared_handle_cells only once we commit to fusing!
    const hoisted_cell_entries = new Map<
      PreparedCellEntry,
      IdentifierReference[]
    >();
    const slots: EmitSlot[] = layers.map((layer, index) => {
      if (layer.kind === "except") {
        return {
          kind: "except",
          current: services.fresh("except_slot"),
          input_expr: void_zero(),
        };
      }
      if (layer.kind === "operations") {
        const op_map = slot_op_maps.get(index)!;
        const hoisted = layer.prepared !== undefined
          ? ensure_prepared_ops_hoists(layer.prepared)
          : undefined;
        const resolved_handlers = new Map<string, ParsedOpHandler>();
        const op_handler_vars = new Map<string, IdentifierReference>();
        for (const [tag, h] of op_map) {
          if (h.kind === "dynamic") {
            const hoisted_id = hoisted?.get(tag);
            if (hoisted_id !== undefined) {
              resolved_handlers.set(tag, { ...h, hoisted: hoisted_id });
            } else {
              resolved_handlers.set(tag, h);
              op_handler_vars.set(tag, services.fresh("op_handler_" + tag));
            }
          } else {
            resolved_handlers.set(tag, h);
          }
        }
        return {
          kind: "operations",
          current: services.fresh("ops_slot"),
          input_expr: void_zero(),
          op_handlers: resolved_handlers,
          op_handler_vars,
          is_effect_id: is_effect_ids.get(index),
        };
      }
      const base_name = layer.kind === "reader"
        ? "environment"
        : layer.kind === "state"
        ? "state"
        : "output";
      const current = services.fresh(base_name);
      const type = layer.cell !== undefined
        ? cell_input_type(layer.cell.identifier, layer.kind)
        : input_type_in_block(run.body!, layer.kind);
      let input_expr = layer.input_expr;
      if (layer.prepared_cells !== undefined) {
        let vars = hoisted_cell_entries.get(layer.prepared_cells);
        if (vars === undefined) {
          vars = ensure_prepared_hoists(layer.prepared_cells);
          hoisted_cell_entries.set(layer.prepared_cells, vars);
        }
        input_expr = vars[layer.prepared_binding_index!];
      }
      const array_buffer = array_buffers[index];
      if (eager_init) {
        return {
          kind: layer.kind,
          current,
          input_expr,
          type,
          prop_name: layer.prop_name,
          prop_is_ident: layer.prop_is_ident,
          array_buffer,
        };
      }
      return {
        kind: layer.kind,
        current,
        input_expr,
        input_thunk: services.fresh(layer.kind + "_input"),
        ready: services.fresh(layer.kind + "_ready"),
        type,
        prop_name: layer.prop_name,
        prop_is_ident: layer.prop_is_ident,
        array_buffer,
      };
    });
    if (resolved_prog.candidate !== undefined) {
      removed.add(resolved_prog.candidate.statement);
    }
    const wrap_range = (
      val: Expression,
      from_slot: number,
      to_slot: number,
    ): Expression => {
      let acc = val;
      for (const step of wrap_steps) {
        if (step.kind === "single") {
          if (step.slot >= from_slot && step.slot < to_slot) {
            const s = slots[step.slot];
            if (
              s.kind === "reader" || s.kind === "state" || s.kind === "writer"
            ) {
              acc = output(acc, slot_output_expr(s), s.kind);
            }
          }
        } else {
          if (step.start >= from_slot && step.end <= to_slot) {
            acc = build_cells_return(acc, slots.slice(step.start, step.end));
          }
        }
      }
      return acc;
    };
    return {
      expression: emit_multi_control(
        run.body!,
        slots,
        match_yield,
        (value) => wrap_range(value, 0, slots.length),
        {
          eager_init,
          async_task: is_async_task,
          except: except_slot_index >= 0
            ? {
              slot_index: except_slot_index,
              either_id: either_id!,
              inner_return: (value) => wrap_range(value, 0, except_slot_index),
              outer_return: (value) =>
                wrap_range(value, except_slot_index + 1, slots.length),
            }
            : undefined,
        },
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

    // Case A: Do(...).run(input), eval_state(Do(...), input), exec_state(Do(...), input),
    //         run_reader_terminal(Do(...), env), run_state_terminal(Do(...), init)
    let do_call: CallExpression | undefined;
    let run_input: Expression | undefined;
    let state_eval_mode: StateEvalName | undefined;
    let expected_terminal_kind: "reader" | "state" | undefined;
    if (plain_call(outer, 2)) {
      const eval_kind = state_eval_target(outer.callee);
      if (eval_kind !== undefined) {
        const target_expr = parentheses(outer.arguments[0] as Expression);
        if (
          target_expr.type === "CallExpression" &&
          services.kind(target_expr) === "do"
        ) {
          do_call = target_expr;
          run_input = outer.arguments[1] as Expression;
          state_eval_mode = eval_kind;
          if (lexical_hazard(run_input) || contains_await_yield(run_input)) {
            return undefined;
          }
        }
      } else {
        const direct_handler = target(outer.callee);
        if (
          direct_handler !== undefined &&
          (direct_handler.imported === "run_reader_terminal" ||
            direct_handler.imported === "run_state_terminal")
        ) {
          const target_expr = parentheses(outer.arguments[0] as Expression);
          if (
            target_expr.type === "CallExpression" &&
            services.kind(target_expr) === "do"
          ) {
            do_call = target_expr;
            run_input = outer.arguments[1] as Expression;
            expected_terminal_kind =
              direct_handler.imported === "run_reader_terminal"
                ? "reader"
                : "state";
            if (lexical_hazard(run_input) || contains_await_yield(run_input)) {
              return undefined;
            }
          }
        }
      }
    }
    if (
      do_call === undefined &&
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
    } else if (do_call === undefined && services.kind(outer) === "do") {
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
    if (state_eval_mode !== undefined && kind !== "state") return undefined;
    if (
      expected_terminal_kind !== undefined && kind !== expected_terminal_kind
    ) return undefined;

    const match_yield = (expression: Expression): YieldMatch | undefined => {
      if (cell !== undefined) {
        const op = cell_primitive(expression, cell.declaration, kind!);
        return op !== undefined
          ? { kind: "cell", slot: 0, operation: op }
          : undefined;
      }
      const op = primitive(expression);
      if (op !== undefined && primitive_kind(op.name) === kind) {
        return { kind: "cell", slot: 0, operation: op };
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
      const eager_init = is_pure_literal(run_input) ||
        !analysis.has_prefix_before_first_yield;
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
      const build_ret = (value: Expression): Expression => {
        if (state_eval_mode === "eval_state") return value;
        if (state_eval_mode === "exec_state") {
          return is_pure_input(value) ? current : node({
            type: "SequenceExpression",
            expressions: [value, current],
          });
        }
        return output(value, current, kind!);
      };
      return {
        expression: emit_multi_control(
          run.body!,
          [slot],
          match_yield,
          build_ret,
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
  function collect_lift_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    type DirectMode = "maybe" | "either" | "identity";
    type CtorMatch =
      | {
        readonly mode: DirectMode;
        readonly ok: true;
        readonly inner: Expression;
        readonly anchor: string;
      }
      | {
        readonly mode: DirectMode;
        readonly ok: false;
        readonly anchor: string;
      };

    const match_direct_ctor = (
      expression: Expression,
    ): CtorMatch | undefined => {
      const val = parentheses(expression);
      if (
        val.type !== "CallExpression" || val.optional ||
        val.typeArguments != null ||
        val.callee.type !== "Identifier" ||
        !services.bindings.imported(val.callee)
      ) return undefined;
      const name = val.callee.name;
      if (
        services.imports.just_constructors?.has(name) &&
        val.arguments.length === 1 && val.arguments[0].type !== "SpreadElement"
      ) {
        return {
          mode: "maybe",
          ok: true,
          inner: val.arguments[0] as Expression,
          anchor: name,
        };
      }
      if (
        services.imports.nothing_constructors?.has(name) &&
        val.arguments.length === 0
      ) return { mode: "maybe", ok: false, anchor: name };
      if (
        services.imports.right_constructors?.has(name) &&
        val.arguments.length === 1 && val.arguments[0].type !== "SpreadElement"
      ) {
        return {
          mode: "either",
          ok: true,
          inner: val.arguments[0] as Expression,
          anchor: name,
        };
      }
      if (
        services.imports.left_constructors?.has(name) &&
        val.arguments.length === 1 && val.arguments[0].type !== "SpreadElement"
      ) return { mode: "either", ok: false, anchor: name };
      if (
        services.imports.identity_constructors?.has(name) &&
        val.arguments.length === 1 && val.arguments[0].type !== "SpreadElement"
      ) {
        return {
          mode: "identity",
          ok: true,
          inner: val.arguments[0] as Expression,
          anchor: name,
        };
      }
      return undefined;
    };

    const build_direct_combine = (
      mode: DirectMode,
      explicit_dict: IdentifierReference | undefined,
      anchor_name: string,
      items: readonly Expression[],
      build_result: (unwrapped_vars: readonly Expression[]) => Expression,
    ): Expression | undefined => {
      if (items.some((e) => lexical_hazard(e) || contains_await_yield(e))) {
        return undefined;
      }
      const just_name = services.imports.just_constructors?.values().next()
        .value;
      const right_name = services.imports.right_constructors?.values().next()
        .value;
      const identity_name = services.imports.identity_constructors?.values()
        .next().value;
      const wrap_ok = (value: Expression): Expression | undefined => {
        if (mode === "maybe") {
          if (just_name !== undefined) return call(id(just_name), [value]);
          if (explicit_dict !== undefined) {
            return call(member(explicit_dict, "pure"), [value]);
          }
          const imported_just = services.import_from_module?.(
            anchor_name,
            "maybe",
            "Just",
          );
          return imported_just !== undefined
            ? call(imported_just, [value])
            : undefined;
        }
        if (mode === "identity") {
          if (identity_name !== undefined) {
            return call(id(identity_name), [value]);
          }
          if (explicit_dict !== undefined) return call(explicit_dict, [value]);
          const imported_id = services.import_from_module?.(
            anchor_name,
            "identity",
            "identity",
          );
          return imported_id !== undefined
            ? call(imported_id, [value])
            : undefined;
        }
        // mode === "either"
        if (right_name !== undefined) return call(id(right_name), [value]);
        if (explicit_dict !== undefined) {
          return call(member(explicit_dict, "Right"), [value]);
        }
        const imported_right = services.import_from_module?.(
          anchor_name,
          "either",
          "Right",
        );
        return imported_right !== undefined
          ? call(imported_right, [value])
          : undefined;
      };

      if (items.length === 0) {
        const wrapped = wrap_ok(build_result([]));
        return wrapped;
      }

      const stmts: Statement[] = [];
      const fail_checks: Statement[] = [];
      const value_exprs: Expression[] = [];
      const either_checked_vars: IdentifierReference[] = [];

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const ctor = match_direct_ctor(item);
        if (ctor !== undefined && ctor.mode === mode && ctor.ok) {
          const val_id = services.fresh("collect_v");
          stmts.push(variable(val_id, ctor.inner, "const"));
          value_exprs.push(val_id);
          continue;
        }
        if (mode === "identity") {
          const val_id = services.fresh("collect_v");
          stmts.push(
            variable(val_id, call(member(item, "value"), []), "const"),
          );
          value_exprs.push(val_id);
          continue;
        }
        const box_id = services.fresh("collect_b");
        const raw_id = services.fresh("collect_r");
        stmts.push(variable(box_id, item, "const"));
        stmts.push(
          variable(raw_id, call(member(box_id, "value"), []), "const"),
        );
        if (mode === "either") either_checked_vars.push(box_id);
        fail_checks.push(
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "===",
              left: node({
                type: "MemberExpression",
                object: raw_id,
                property: literal(0),
                computed: true,
                optional: false,
              }),
              right: literal(mode === "maybe" ? "Nothing" : "Left"),
            }),
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: box_id,
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
        );
        value_exprs.push(
          node({
            type: "MemberExpression",
            object: raw_id,
            property: literal(1),
            computed: true,
            optional: false,
          }),
        );
      }

      stmts.push(...fail_checks);
      const final_val = build_result(value_exprs);
      if (mode === "either" && either_checked_vars.length > 0) {
        const out_id = services.fresh("collect_out");
        stmts.push(variable(out_id, final_val, "const"));
        const wrapped = wrap_ok(out_id);
        if (wrapped === undefined || wrapped.type !== "CallExpression") {
          return undefined;
        }
        const raw_types: TSType[] = either_checked_vars.map((target) =>
          node({
            type: "TSTypeReference",
            typeName: id("ReturnType"),
            typeArguments: node({
              type: "TSTypeParameterInstantiation",
              params: Array.from<TSType>([
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
                }),
              ]),
            }),
          })
        );
        const raw_union: TSType = raw_types.length === 1
          ? raw_types[0]
          : node({ type: "TSUnionType", types: raw_types });
        const left_tuple: TSType = node({
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
              params: Array.from<TSType>([raw_union, left_tuple]),
            }),
          }),
          indexType: node({
            type: "TSLiteralType",
            literal: node({ type: "Literal", value: 1, raw: "1" }),
          }),
        });
        const right_type: TSType = node({
          type: "TSTypeQuery",
          exprName: out_id,
          typeArguments: null,
        });
        wrapped.typeArguments = node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([left_type, right_type]),
        });
        stmts.push(ret(wrapped));
      } else {
        const wrapped = wrap_ok(final_val);
        if (wrapped === undefined) return undefined;
        stmts.push(ret(wrapped));
      }
      return call(arrow([], block(stmts)), []);
    };

    const callee = parentheses(outer.callee);
    // 1. collect(shape) or collect(Dict, shape)
    const is_collect = (callee.type === "Identifier" &&
      services.imports.collect_functions?.has(callee.name) &&
      services.bindings.imported(callee)) ||
      (callee.type === "MemberExpression" && !callee.computed &&
        !callee.optional && callee.object.type === "Identifier" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "collect" &&
        services.imports.collect_namespaces?.has(callee.object.name) &&
        services.bindings.imported(callee.object));

    if (
      is_collect &&
      (outer.arguments.length === 1 || outer.arguments.length === 2)
    ) {
      let mode: DirectMode | undefined;
      let explicit_dict: IdentifierReference | undefined;
      let shape_arg: Expression;
      let anchor = "";
      if (outer.arguments.length === 2) {
        const d = parentheses(outer.arguments[0] as Expression);
        if (d.type !== "Identifier") return undefined;
        if (services.imports.direct_maybe_dictionaries?.has(d.name)) {
          mode = "maybe";
        } else if (services.imports.direct_either_dictionaries?.has(d.name)) {
          mode = "either";
        } else if (services.imports.direct_identity_dictionaries?.has(d.name)) {
          mode = "identity";
        } else {
          return undefined;
        }
        explicit_dict = d;
        anchor = d.name;
        shape_arg = parentheses(outer.arguments[1] as Expression);
      } else {
        shape_arg = parentheses(outer.arguments[0] as Expression);
      }

      if (shape_arg.type === "ArrayExpression") {
        if (
          shape_arg.elements.some((el) =>
            el === null || el.type === "SpreadElement"
          )
        ) return undefined;
        const items = shape_arg.elements as Expression[];
        if (mode === undefined) {
          if (items.length === 0) return undefined;
          for (const item of items) {
            const m = match_direct_ctor(item);
            if (m === undefined) return undefined;
            if (mode === undefined) {
              mode = m.mode;
              anchor = m.anchor;
            } else if (mode !== m.mode) return undefined;
          }
        }
        const expression = build_direct_combine(
          mode!,
          explicit_dict,
          anchor,
          items,
          (vals) =>
            as_const(node({ type: "ArrayExpression", elements: [...vals] })),
        );
        if (expression !== undefined) return { expression, direct: true };
        return undefined;
      }

      if (shape_arg.type === "ObjectExpression") {
        const entries: {
          readonly key: string;
          readonly is_ident: boolean;
          readonly value: Expression;
        }[] = [];
        const seen = new Set<string>();
        for (const prop of shape_arg.properties) {
          if (
            prop.type !== "Property" || prop.kind !== "init" || prop.computed ||
            prop.method
          ) return undefined;
          let key: string;
          let is_ident = false;
          if (prop.key.type === "Identifier") {
            key = prop.key.name;
            is_ident = true;
          } else if (
            prop.key.type === "Literal" && typeof prop.key.value === "string"
          ) {
            key = prop.key.value;
          } else return undefined;
          if (key === "__proto__" || seen.has(key)) return undefined;
          seen.add(key);
          entries.push({ key, is_ident, value: prop.value as Expression });
        }
        const items = entries.map((e) => e.value);
        if (mode === undefined) {
          if (items.length === 0) return undefined;
          for (const item of items) {
            const m = match_direct_ctor(item);
            if (m === undefined) return undefined;
            if (mode === undefined) {
              mode = m.mode;
              anchor = m.anchor;
            } else if (mode !== m.mode) return undefined;
          }
        }
        const expression = build_direct_combine(
          mode!,
          explicit_dict,
          anchor,
          items,
          (vals) =>
            node({
              type: "ObjectExpression",
              properties: entries.map((entry, idx) =>
                node({
                  type: "Property",
                  kind: "init",
                  key: entry.is_ident ? id(entry.key) : node({
                    type: "Literal",
                    value: entry.key,
                    raw: JSON.stringify(entry.key),
                  }),
                  value: vals[idx],
                  method: false,
                  shorthand: false,
                  computed: false,
                }) as ObjectProperty
              ),
            }),
        );
        if (expression !== undefined) return { expression, direct: true };
        return undefined;
      }
      return undefined;
    }

    // 2. Applicative.lift(fn, e1, e2, ...) when all values are known same-family constructors
    const is_lift = callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "lift" &&
      ((callee.object.type === "Identifier" &&
        services.imports.applicative_objects?.has(callee.object.name) &&
        services.bindings.imported(callee.object)) ||
        (callee.object.type === "MemberExpression" && !callee.object.computed &&
          !callee.object.optional &&
          callee.object.object.type === "Identifier" &&
          callee.object.property.type === "Identifier" &&
          callee.object.property.name === "Applicative" &&
          services.imports.applicative_namespaces?.has(
            callee.object.object.name,
          ) && services.bindings.imported(callee.object.object)));

    if (is_lift && outer.arguments.length >= 2) {
      const fn_expr = outer.arguments[0] as Expression;
      if (lexical_hazard(fn_expr) || contains_await_yield(fn_expr)) {
        return undefined;
      }
      const items = outer.arguments.slice(1) as Expression[];
      let mode: DirectMode | undefined;
      let anchor = "";
      for (const item of items) {
        const m = match_direct_ctor(item);
        if (m === undefined) return undefined;
        if (mode === undefined) {
          mode = m.mode;
          anchor = m.anchor;
        } else if (mode !== m.mode) return undefined;
      }
      const fn_id = services.fresh("lift_fn");
      const expression = build_direct_combine(
        mode!,
        undefined,
        anchor,
        items,
        (vals) => call(fn_id, [...vals]),
      );
      if (expression === undefined) return undefined;
      return {
        expression: call(arrow([fn_id], expression), [fn_expr]),
        direct: true,
      };
    }

    return undefined;
  }
  function terminal_program(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    const collect_fused = collect_lift_fusion(outer);
    if (collect_fused !== undefined) return collect_fused;
    const cells_fused = cells_terminal(outer);
    if (cells_fused !== undefined) return cells_fused;
    const stacked_fused = stacked_terminal_program(outer);
    if (stacked_fused !== undefined) return stacked_fused;
    const do_fused = do_reader_state_fusion(outer);
    if (do_fused !== undefined) return do_fused;
    let handled: CallExpression;
    let handler: Target | undefined;
    let is_direct = false;
    if (plain_call(outer, 1) && target(outer.callee)?.imported === "run") {
      const inner = parentheses(outer.arguments[0] as Expression);
      if (
        inner.type !== "CallExpression" || inner.optional ||
        inner.typeArguments != null ||
        inner.arguments.some((argument) => argument.type === "SpreadElement") ||
        (inner.arguments.length !== 2 && inner.arguments.length !== 3)
      ) {
        return undefined;
      }
      handled = inner;
      handler = target(handled.callee);
      if (
        handler === undefined || handler.imported === "run" ||
        handler.imported === "run_except" ||
        is_direct_terminal(handler.imported)
      ) return undefined;
    } else if (
      !outer.optional && outer.typeArguments == null &&
      !outer.arguments.some((argument) => argument.type === "SpreadElement") &&
      (outer.arguments.length === 2 || outer.arguments.length === 3)
    ) {
      handler = target(outer.callee);
      if (handler === undefined || !is_direct_terminal(handler.imported)) {
        return undefined;
      }
      handled = outer;
      is_direct = true;
    } else {
      return undefined;
    }
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
      const match_yield = (
        expression: Expression,
      ): YieldMatch | undefined => {
        const op = cell_primitive(
          expression,
          resolved_cell.declaration,
          kind,
        );
        return op !== undefined
          ? { kind: "cell", slot: 0, operation: op }
          : undefined;
      };
      const array_buffer = kind === "writer"
        ? check_writer_slot_array_buffer(
          run.body!,
          match_yield,
          0,
          writer_default
            ? writer_cell_array_init(resolved_cell.declaration)
            : extract_array_t_literal(input_expr),
        )
        : undefined;
      const body = array_buffer === undefined
        ? read_body(run.body!)
        : undefined;
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
          return is_direct ? undefined : {
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
        const analysis = analyze_control_body(run.body!, match_yield);
        if (analysis !== undefined) {
          const input_is_literal = array_buffer !== undefined
            ? array_buffer.init_elements.every(is_pure_literal)
            : (!writer_default && is_pure_literal(input_expr));
          const input_is_pure = input_is_literal ||
            (array_buffer !== undefined
              ? array_buffer.init_elements.every(is_pure_input)
              : (!writer_default && is_pure_input(input_expr)));
          const eager_init = input_is_literal ||
            (!analysis.has_prefix_before_first_yield && input_is_pure);
          const current = services.fresh(
            kind === "reader"
              ? "environment"
              : kind === "state"
              ? "state"
              : "output",
          );
          const type = cell_input_type(resolved_cell.identifier, kind);
          const slot: EmitSlot = eager_init
            ? { kind, current, input_expr, type, array_buffer }
            : {
              kind,
              current,
              input_expr,
              input_thunk: services.fresh(kind + "_input"),
              ready: services.fresh(kind + "_ready"),
              type,
              array_buffer,
            };
          if (resolved_prog.candidate !== undefined) {
            removed.add(resolved_prog.candidate.statement);
          }
          return {
            expression: emit_multi_control(
              run.body!,
              [slot],
              match_yield,
              (value) => output(value, slot_output_expr(slot), kind),
              { eager_init },
            ),
            direct: true,
          };
        }
      }
      return is_direct ? undefined : {
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
    const match_yield = (expression: Expression): YieldMatch | undefined => {
      const op = primitive(expression);
      if (op !== undefined && primitive_kind(op.name) === kind) {
        return { kind: "cell", slot: 0, operation: op };
      }
      return undefined;
    };
    const input_expr = handled.arguments[1] as Expression;
    const array_buffer = kind === "writer"
      ? check_writer_slot_array_buffer(
        run.body!,
        match_yield,
        0,
        extract_array_t_literal(input_expr),
      )
      : undefined;
    const body = array_buffer === undefined ? read_body(run.body!) : undefined;
    if (body !== undefined) {
      const can_fuse = services.config.optimizations?.terminal_body !== false &&
        body.parts.every((part) => {
          if (part.kind !== "yield") return true;
          const operation = primitive(part.expression);
          return operation !== undefined &&
            primitive_kind(operation.name) === kind;
        }) && (kind === "writer" || input_type(body, kind) !== undefined);
      if (!can_fuse) {
        return is_direct ? undefined : {
          expression: { ...handled, callee: runner(handler) },
          direct: false,
        };
      }
      if (resolved_prog.candidate !== undefined) {
        removed.add(resolved_prog.candidate.statement);
      }
      return {
        expression: emit(body, input_expr, kind),
        direct: true,
      };
    }
    if (services.config.optimizations?.terminal_body !== false) {
      const analysis = analyze_control_body(run.body!, match_yield);
      const resolved_type = input_type_in_block(run.body!, kind);
      if (
        analysis !== undefined &&
        (kind === "writer" || resolved_type !== undefined)
      ) {
        const input_is_literal = array_buffer !== undefined
          ? array_buffer.init_elements.every(is_pure_literal)
          : is_pure_literal(input_expr);
        const input_is_pure = input_is_literal ||
          (array_buffer !== undefined
            ? array_buffer.init_elements.every(is_pure_input)
            : is_pure_input(input_expr));
        const eager_init = input_is_literal ||
          (!analysis.has_prefix_before_first_yield && input_is_pure);
        const current = services.fresh(
          kind === "reader"
            ? "environment"
            : kind === "state"
            ? "state"
            : "output",
        );
        const slot: EmitSlot = eager_init
          ? { kind, current, input_expr, type: resolved_type, array_buffer }
          : {
            kind,
            current,
            input_expr,
            input_thunk: services.fresh(kind + "_input"),
            ready: services.fresh(kind + "_ready"),
            type: resolved_type,
            array_buffer,
          };
        if (resolved_prog.candidate !== undefined) {
          removed.add(resolved_prog.candidate.statement);
        }
        return {
          expression: emit_multi_control(
            run.body!,
            [slot],
            match_yield,
            (value) => output(value, slot_output_expr(slot), kind),
            { eager_init },
          ),
          direct: true,
        };
      }
    }
    return is_direct ? undefined : {
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
      handler.imported === "run_except" ||
      is_direct_terminal(handler.imported) ||
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
      default:
        return undefined;
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
      (services.imports.cell_runner_namespaces?.size ?? 0) > 0 ||
      (services.imports.operation_runners?.size ?? 0) > 0 ||
      (services.imports.operation_runner_namespaces?.size ?? 0) > 0;
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
      // 1. run(run_*(p, input)), run_task(run_*(p, input)), run(run_except(p)), ...
      if (
        plain_call(expression, 1) &&
        (target(expression.callee)?.imported === "run" ||
          is_run_task_callee(expression.callee))
      ) {
        const is_async_outer = is_run_task_callee(expression.callee);
        let cursor = parentheses(expression.arguments[0] as Expression);
        let steps = 0;
        let saw_special = is_async_outer;
        while (
          cursor.type === "CallExpression" && !cursor.optional &&
          cursor.typeArguments == null &&
          !cursor.arguments.some((a) => a.type === "SpreadElement")
        ) {
          if (cursor.arguments.length === 1) {
            const handler = target(cursor.callee);
            if (handler !== undefined && handler.imported === "run_except") {
              cursor = parentheses(cursor.arguments[0] as Expression);
              steps += 1;
              saw_special = true;
              continue;
            }
            if (cursor.callee.type === "Identifier") {
              const resolved = services.bindings.resolve(cursor.callee);
              if (resolved !== null && prepared_ops.has(resolved)) {
                cursor = parentheses(cursor.arguments[0] as Expression);
                steps += 1;
                saw_special = true;
                continue;
              }
              const prep_cells = resolved !== null
                ? prepared_cells.get(resolved)
                : undefined;
              if (
                prep_cells !== undefined && prep_cells.runner_kind === "handle"
              ) {
                cursor = parentheses(cursor.arguments[0] as Expression);
                steps += 1;
                saw_special = true;
                continue;
              }
            }
            break;
          }
          if (
            cursor.arguments.length === 2 &&
            operation_runner_target(cursor.callee)?.name === "handle_operations"
          ) {
            if (
              parse_op_handlers_object(cursor.arguments[1] as Expression) ===
                undefined
            ) return;
            cursor = parentheses(cursor.arguments[0] as Expression);
            steps += 1;
            saw_special = true;
            continue;
          }
          if (
            cursor.arguments.length === 2 &&
            cell_runner_target(cursor.callee) === "handle_cells"
          ) {
            if (
              parse_cell_bindings_object(cursor.arguments[1] as Expression) ===
                undefined
            ) return;
            cursor = parentheses(cursor.arguments[0] as Expression);
            steps += 1;
            saw_special = true;
            continue;
          }
          if (cursor.arguments.length !== 2 && cursor.arguments.length !== 3) {
            break;
          }
          const handler = target(cursor.callee);
          if (
            handler === undefined || handler.imported === "run" ||
            handler.imported === "run_except" ||
            is_direct_terminal(handler.imported)
          ) break;
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
            // For single unkeyed reader/state/writer calls, validate same-kind compatibility eagerly so
            // mismatched named Programs never get marked skip().
            if (steps === 1 && !saw_special) {
              const handled = parentheses(
                expression.arguments[0] as Expression,
              ) as CallExpression;
              const handler = target(handled.callee);
              if (
                handler === undefined || handler.imported === "run" ||
                handler.imported === "run_except" ||
                is_direct_terminal(handler.imported)
              ) return;
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
                    ? { kind: "cell", slot: 0, operation: op }
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
      // 1b. Direct run_reader_terminal / run_state_terminal / run_writer_terminal
      if (
        !expression.optional && expression.typeArguments == null &&
        !expression.arguments.some((a) => a.type === "SpreadElement") &&
        (expression.arguments.length === 2 ||
          expression.arguments.length === 3)
      ) {
        const direct_handler = target(expression.callee);
        if (
          direct_handler !== undefined &&
          is_direct_terminal(direct_handler.imported)
        ) {
          const kind = terminal_kind(direct_handler.imported);
          const keyed = expression.arguments.length === 3 ||
            (kind === "writer" &&
              resolve_cell(expression.arguments[0] as Expression, "writer") !==
                undefined);
          const arg_index = keyed ? 1 : 0;
          const input_arg = keyed
            ? expression.arguments[2]
            : expression.arguments[1];
          if (
            input_arg !== undefined &&
            (lexical_hazard(input_arg) || contains_await_yield(input_arg))
          ) return;
          const name = parentheses(
            expression.arguments[arg_index] as Expression,
          );
          if (name.type === "Identifier") {
            const key = services.bindings.resolve(name);
            const candidate = candidates.get(key);
            if (
              candidate !== undefined && candidate.owner === owner &&
              candidate.program.end < name.start
            ) {
              if (!keyed) {
                const run_fn = candidate.program.arguments[0] as FunctionNode;
                const match_op = (expr: Expression): YieldMatch | undefined => {
                  const op = primitive(expr);
                  return op !== undefined && primitive_kind(op.name) === kind
                    ? { kind: "cell", slot: 0, operation: op }
                    : undefined;
                };
                if (
                  analyze_control_body(run_fn.body!, match_op) === undefined ||
                  (kind !== "writer" &&
                    input_type_in_block(run_fn.body!, kind) === undefined)
                ) return;
              } else {
                const resolved_cell = resolve_cell(
                  expression.arguments[0] as Expression,
                  kind,
                );
                if (resolved_cell === undefined) return;
                const run_fn = candidate.program.arguments[0] as FunctionNode;
                const match_op = (expr: Expression): YieldMatch | undefined => {
                  const op = cell_primitive(
                    expr,
                    resolved_cell.declaration,
                    kind,
                  );
                  return op !== undefined
                    ? { kind: "cell", slot: 0, operation: op }
                    : undefined;
                };
                if (
                  analyze_control_body(run_fn.body!, match_op) === undefined
                ) {
                  return;
                }
              }
              allowed.add(name);
              used.add(key);
            }
          }
          return;
        }
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
        const prep_entry = resolved !== null
          ? prepared_cells.get(resolved)
          : undefined;
        if (prep_entry !== undefined && prep_entry.runner_kind === "run") {
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
    const cand_keys_by_name = new Map<string, (Node | null)[]>();
    for (const [key, candidate] of candidates) {
      const name = (candidate.name as IdentifierReference).name;
      const list = cand_keys_by_name.get(name);
      if (list !== undefined) list.push(key);
      else cand_keys_by_name.set(name, [key]);
    }
    const has_cand = create_span_scanner(services.source, candidate_names);
    for (const stmt of services.program.body) {
      if (stmt.type === "ImportDeclaration") continue;
      if (!has_cand(stmt.start, stmt.end)) continue;
      const was_skipped = skip_statement?.(stmt as Statement) ?? false;
      walk(stmt, (child) => {
        if (child.type !== "Identifier") return;
        if (was_skipped) {
          const matching = cand_keys_by_name.get(child.name);
          if (matching !== undefined) {
            for (const key of matching) candidates.delete(key);
          }
          return;
        }
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
        if (
          phase === "before" && round5 !== undefined &&
          (has_r5_task || has_r5_stm || has_r5_chain || has_r5_array)
        ) {
          const r5_before = round5.lower_before(value);
          if (r5_before !== undefined) return r5_before;
        }
        const fused = terminal_program(value);
        if (fused !== undefined) return fused;
        if (
          phase === "before" &&
          services.config.optimizations?.interpreter !== false
        ) {
          const eff = effect_lower(value);
          if (eff !== undefined && eff.type === "CallExpression") {
            const eff_fused = terminal_program(eff);
            if (eff_fused !== undefined) return eff_fused;
          }
        }
        if (phase === "before") return undefined;
        const lift = terminal_lift(value);
        if (lift !== undefined) return { expression: lift, direct: false };
        if (round5 !== undefined && (has_r5_traverse || has_r5_match)) {
          const r5_after = round5.lower_after(value);
          if (r5_after !== undefined) return r5_after;
        }
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
function collect_declared_names(root: Node): Set<string> {
  const names = new Set<string>();
  const add_pattern = (pattern: Node | null | undefined): void => {
    if (pattern == null) return;
    switch (pattern.type) {
      case "Identifier":
        names.add(pattern.name);
        break;
      case "ArrayPattern":
        for (const el of pattern.elements) add_pattern(el);
        break;
      case "ObjectPattern":
        for (const prop of pattern.properties) {
          if (prop.type === "RestElement") add_pattern(prop.argument);
          else add_pattern(prop.value);
        }
        break;
      case "AssignmentPattern":
        add_pattern(pattern.left);
        break;
      case "RestElement":
        add_pattern(pattern.argument);
        break;
    }
  };
  walk(root, (child) => {
    if (child.type === "VariableDeclarator") add_pattern(child.id);
    else if (
      (child.type === "FunctionDeclaration" ||
        child.type === "ClassDeclaration") && child.id !== null
    ) names.add(child.id.name);
    else if (child.type === "CatchClause" && child.param !== null) {
      add_pattern(child.param);
    }
  });
  return names;
}
function substitute_ident(
  expr: Expression,
  target_key: Node,
  replacement: Expression,
  services: TransformServices,
): Expression {
  function clone(current: Node): Node {
    if (current.type === "Identifier") {
      return services.bindings.resolve(current) === target_key
        ? replacement
        : current;
    }
    const keys = value_visitor_keys[current.type];
    if (keys === undefined || keys.length === 0) return current;
    if (current.type === "Property" && current.shorthand) {
      const next_val = clone(current.value) as Expression;
      if (next_val !== current.value) {
        return {
          ...(current as ObjectProperty),
          value: next_val,
          shorthand: false,
        };
      }
      return current;
    }
    let result = current;
    const record = current as unknown as Record<string, unknown>;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      if (
        current.type === "MemberExpression" && !current.computed &&
        key === "property"
      ) continue;
      if (
        current.type === "Property" && !current.computed && key === "key"
      ) continue;
      const val = record[key];
      if (val === null || typeof val !== "object") continue;
      if (Array.isArray(val)) {
        let next_arr: unknown[] | undefined;
        for (let j = 0; j < val.length; j += 1) {
          const item = val[j];
          if (
            item !== null && typeof item === "object" &&
            typeof (item as { type?: unknown }).type === "string"
          ) {
            const next_item = clone(item as Node);
            if (next_item !== item) {
              next_arr ??= val.slice(0, j);
              next_arr.push(next_item);
            } else if (next_arr !== undefined) next_arr.push(item);
          } else if (next_arr !== undefined) next_arr.push(item);
        }
        if (next_arr !== undefined) result = { ...result, [key]: next_arr };
      } else if (typeof (val as { type?: unknown }).type === "string") {
        const next_val = clone(val as Node);
        if (next_val !== val) result = { ...result, [key]: next_val };
      }
    }
    return result;
  }
  return clone(expr) as Expression;
}
function is_pure_literal(expression: Expression): boolean {
  const value = parentheses(expression);
  if (value.type === "Literal") return true;
  if (value.type === "TemplateLiteral" && value.expressions.length === 0) {
    return true;
  }
  if (
    value.type === "UnaryExpression" &&
    (value.operator === "void" || value.operator === "-" ||
      value.operator === "+" || value.operator === "!" ||
      value.operator === "~")
  ) return is_pure_literal(value.argument);
  if (value.type === "ArrayExpression") {
    return value.elements.every((el) =>
      el === null || (el.type !== "SpreadElement" && is_pure_literal(el))
    );
  }
  if (value.type === "ObjectExpression") {
    return value.properties.every((prop) =>
      prop.type === "Property" && prop.kind === "init" && !prop.computed &&
      !prop.method && is_pure_literal(prop.value as Expression)
    );
  }
  return false;
}
function is_void_zero(expression: Expression): boolean {
  return expression.type === "UnaryExpression" &&
    expression.operator === "void" &&
    expression.argument.type === "Literal" && expression.argument.value === 0;
}
function contains_continue(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (
      function_like(child) || child.type === "ForStatement" ||
      child.type === "WhileStatement" || child.type === "DoWhileStatement" ||
      child.type === "ForOfStatement" || child.type === "ForInStatement"
    ) return false;
    if (child.type === "ContinueStatement") found = true;
  });
  return found;
}
function as_const(expression: Expression): Expression {
  return node({
    type: "TSAsExpression",
    expression,
    typeAnnotation: node({
      type: "TSTypeReference",
      typeName: id("const"),
      typeArguments: null,
    }),
  });
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
function is_sync_non_thenable_expr(expression: Expression): boolean {
  const val = parentheses(expression);
  switch (val.type) {
    case "Literal":
    case "TemplateLiteral":
    case "BinaryExpression":
    case "UnaryExpression":
    case "UpdateExpression":
    case "ArrayExpression":
      return true;
    case "ObjectExpression":
      return val.properties.every((prop) =>
        prop.type === "Property" && !prop.computed &&
        !(prop.key.type === "Identifier" && prop.key.name === "then") &&
        !(prop.key.type === "Literal" && prop.key.value === "then")
      );
    case "ConditionalExpression":
      return is_sync_non_thenable_expr(val.consequent) &&
        is_sync_non_thenable_expr(val.alternate);
    default:
      return false;
  }
}
function is_direct_terminal(
  name: TerminalFunctionName,
): name is
  | "run_reader_terminal"
  | "run_state_terminal"
  | "run_writer_terminal" {
  return name === "run_reader_terminal" || name === "run_state_terminal" ||
    name === "run_writer_terminal";
}
function terminal_kind(
  name: Exclude<TerminalFunctionName, "run" | "run_except">,
): TerminalKind {
  switch (name) {
    case "run_reader":
    case "run_reader_terminal":
      return "reader";
    case "run_state":
    case "run_state_terminal":
      return "state";
    case "run_writer":
    case "run_writer_terminal":
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

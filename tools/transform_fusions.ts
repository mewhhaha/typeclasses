import type {
  ArrowFunctionExpression,
  BindingIdentifier,
  BindingPattern,
  BlockStatement,
  CallExpression,
  Expression,
  Function as FunctionNode,
  IdentifierReference,
  Node,
  Statement,
  SwitchCase,
  TSType,
  VariableDeclaration,
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
  unwrap,
  walk,
} from "./transform_ast.ts";
import type { TransformServices } from "./transform_context.ts";

function parentheses(expression: Expression): Expression {
  let value = expression;
  while (value.type === "ParenthesizedExpression") value = value.expression;
  return value;
}

function function_like(value: Node): boolean {
  return value.type === "FunctionDeclaration" ||
    value.type === "FunctionExpression" ||
    value.type === "ArrowFunctionExpression";
}

function lexical_hazard(root: Node): boolean {
  let found = false;
  walk(root, (child, parent) => {
    if (found) return false;
    if (
      child.type === "ThisExpression" || child.type === "Super" ||
      child.type === "MetaProperty" ||
      (child.type === "CallExpression" && !child.optional &&
        child.callee.type === "Identifier" && child.callee.name === "eval")
    ) {
      found = true;
      return false;
    }
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
      return false;
    }
  });
  return found;
}

function contains_await_yield(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (found) return false;
    if (function_like(child)) return false;
    if (child.type === "AwaitExpression" || child.type === "YieldExpression") {
      found = true;
      return false;
    }
  });
  return found;
}

function contains_yield(root: Node): boolean {
  let found = false;
  walk(root, (child) => {
    if (found) return false;
    if (function_like(child)) return false;
    if (child.type === "YieldExpression") {
      found = true;
      return false;
    }
  });
  return found;
}

function is_pure_no_call(root: Node): boolean {
  let pure = true;
  walk(root, (child) => {
    if (!pure) return false;
    if (function_like(child)) return false;
    if (
      child.type === "CallExpression" || child.type === "NewExpression" ||
      child.type === "AssignmentExpression" ||
      child.type === "UpdateExpression" ||
      child.type === "AwaitExpression" || child.type === "YieldExpression" ||
      (child.type === "UnaryExpression" && child.operator === "delete")
    ) {
      pure = false;
      return false;
    }
  });
  return pure;
}

function is_sync_non_thenable(expression: Expression): boolean {
  const val = unwrap(expression);
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
      return is_sync_non_thenable(val.consequent) &&
        is_sync_non_thenable(val.alternate);
    default:
      return false;
  }
}

function is_trivial_pure(expression: Expression): boolean {
  const val = unwrap(expression);
  return val.type === "Identifier" || val.type === "Literal" ||
    (val.type === "UnaryExpression" &&
      (val.operator === "-" || val.operator === "+" || val.operator === "!" ||
        val.operator === "void") &&
      val.argument.type === "Literal");
}

function negate_expr(expression: Expression): Expression {
  const val = parentheses(expression);
  if (val.type === "UnaryExpression" && val.operator === "!" && val.prefix) {
    return val.argument;
  }
  return node({
    type: "UnaryExpression",
    operator: "!",
    prefix: true,
    argument: expression,
  });
}

export function await_if_thenable_expr(
  raw_id: IdentifierReference,
): Expression {
  const typeof_raw: Expression = node({
    type: "UnaryExpression",
    operator: "typeof",
    prefix: true,
    argument: raw_id,
  });
  const is_obj_non_null: Expression = node({
    type: "LogicalExpression",
    operator: "&&",
    left: node({
      type: "BinaryExpression",
      operator: "===",
      left: typeof_raw,
      right: literal("object"),
    }),
    right: node({
      type: "BinaryExpression",
      operator: "!==",
      left: raw_id,
      right: literal(null),
    }),
  });
  const is_obj_or_fn: Expression = node({
    type: "LogicalExpression",
    operator: "||",
    left: is_obj_non_null,
    right: node({
      type: "BinaryExpression",
      operator: "===",
      left: typeof_raw,
      right: literal("function"),
    }),
  });
  const then_type: TSType = node({
    type: "TSTypeLiteral",
    members: Array.from([
      node({
        type: "TSPropertySignature",
        key: id("then"),
        computed: false,
        optional: true,
        readonly: true,
        accessibility: null,
        static: false,
        typeAnnotation: node({
          type: "TSTypeAnnotation",
          typeAnnotation: node({ type: "TSUnknownKeyword" }),
        }),
      }),
    ]),
  });
  const cast_thenable: Expression = node({
    type: "TSAsExpression",
    expression: node({
      type: "TSAsExpression",
      expression: raw_id,
      typeAnnotation: node({ type: "TSUnknownKeyword" }),
    }),
    typeAnnotation: then_type,
  });
  const has_then_fn: Expression = node({
    type: "BinaryExpression",
    operator: "===",
    left: node({
      type: "UnaryExpression",
      operator: "typeof",
      prefix: true,
      argument: member(cast_thenable, "then"),
    }),
    right: literal("function"),
  });
  const awaited_type: TSType = node({
    type: "TSTypeReference",
    typeName: id("Awaited"),
    typeArguments: node({
      type: "TSTypeParameterInstantiation",
      params: Array.from<TSType>([
        node({
          type: "TSTypeQuery",
          exprName: raw_id,
          typeArguments: null,
        }),
      ]),
    }),
  });
  return node({
    type: "ConditionalExpression",
    test: node({
      type: "LogicalExpression",
      operator: "&&",
      left: is_obj_or_fn,
      right: has_then_fn,
    }),
    consequent: node({ type: "AwaitExpression", argument: raw_id }),
    alternate: node({
      type: "TSAsExpression",
      expression: node({
        type: "TSAsExpression",
        expression: raw_id,
        typeAnnotation: node({ type: "TSUnknownKeyword" }),
      }),
      typeAnnotation: awaited_type,
    }),
  });
}

function void_zero(): Expression {
  return node({
    type: "UnaryExpression",
    operator: "void",
    prefix: true,
    argument: literal(0),
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

function yield_star(
  value: Expression | null | undefined,
): value is Extract<Expression, { type: "YieldExpression" }> & {
  argument: Expression;
} {
  return value?.type === "YieldExpression" && value.delegate &&
    value.argument !== null;
}

function valid_generator(value: FunctionNode): boolean {
  return value.type === "FunctionExpression" && value.generator &&
    !value.async && value.id === null && value.params.length === 0 &&
    value.typeParameters == null && value.returnType == null &&
    value.body !== null;
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
    if (current.type === "Property" && current.shorthand) {
      const next_val = clone(current.value) as Expression;
      if (next_val !== current.value) {
        return { ...current, value: next_val, shorthand: false };
      }
      return current;
    }
    let result = current;
    const record = current as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "type" || key === "start" || key === "end") continue;
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

/** Round 5 post-plugin fusions: immediate Task Do/Program, Traversable.traverse, and tagged match. */
export type Round5Flags = {
  readonly task: boolean;
  readonly stm: boolean;
  readonly chain: boolean;
  readonly array: boolean;
  readonly traverse: boolean;
  readonly match: boolean;
};

export function create_round5_fusions(
  services: TransformServices,
  flags?: Round5Flags,
) {
  function find_scope_anchor(root: Node): Node | undefined {
    let anchor: Node | undefined;
    walk(root, (child) => {
      if (anchor !== undefined) return false;
      if (child.type === "Identifier") {
        anchor = child;
        return false;
      }
    });
    return anchor;
  }

  function intrinsics_unshadowed(
    at: Node,
    names: readonly string[],
  ): boolean {
    const anchor = find_scope_anchor(at);
    if (anchor === undefined) return false;
    for (let i = 0; i < names.length; i += 1) {
      if (services.bindings.resolve_name_at(names[i], anchor) !== null) {
        return false;
      }
    }
    return true;
  }

  function is_inline_fn_expr(expr: Expression): boolean {
    const e = unwrap(expr);
    return e.type === "ArrowFunctionExpression" ||
      e.type === "FunctionExpression";
  }

  function is_const_literal_expr(expr: Expression): boolean {
    const e = unwrap(expr);
    if (e.type === "Literal") {
      return !("regex" in e && e.regex != null);
    }
    return e.type === "UnaryExpression" &&
      (e.operator === "-" || e.operator === "+" || e.operator === "!" ||
        e.operator === "void") &&
      e.argument.type === "Literal" &&
      !("regex" in e.argument && e.argument.regex != null);
  }

  function is_pure_first_yield_expr(
    expr: Expression,
    strict_literals_only: boolean,
  ): boolean {
    const e = unwrap(expr);
    if (e.type !== "YieldExpression" || !e.delegate || e.argument === null) {
      return false;
    }
    const cls = classify_task_yield(e.argument, false);
    if (cls === undefined) return false;
    switch (cls.kind) {
      case "from_fn":
      case "task_ctor":
        return is_inline_fn_expr(cls.fn);
      case "pure":
        return strict_literals_only
          ? is_const_literal_expr(cls.value)
          : is_pure_no_call(cls.value);
      default:
        return false;
    }
  }

  function hoist_task_kind_eager(
    tk: TaskYieldKind,
    eager_stmts: Statement[],
    prefix: string,
  ): TaskYieldKind {
    const hoist_expr = (expr: Expression): Expression => {
      if (is_const_literal_expr(expr)) return expr;
      const eid = services.fresh(prefix);
      eager_stmts.push(variable(eid, expr, "const"));
      return eid;
    };
    switch (tk.kind) {
      case "pure":
        return { ...tk, value: hoist_expr(tk.value) };
      case "from_fn":
      case "task_ctor":
        if (is_inline_fn_expr(tk.fn)) return tk;
        return { ...tk, fn: hoist_expr(tk.fn) };
      case "from_promise":
        return { ...tk, promise: hoist_expr(tk.promise) };
      case "throw_error":
        return { ...tk, error: hoist_expr(tk.error) };
      case "catch_error": {
        const inner = classify_task_yield(tk.task, false);
        const task_expr = inner !== undefined &&
            (inner.kind === "from_fn" || inner.kind === "task_ctor") &&
            is_inline_fn_expr(inner.fn)
          ? tk.task
          : hoist_expr(tk.task);
        const handler_expr = is_inline_fn_expr(tk.handler)
          ? tk.handler
          : hoist_expr(tk.handler);
        return { ...tk, task: task_expr, handler: handler_expr };
      }
      case "arbitrary":
        return { ...tk, expr: hoist_expr(tk.expr) };
    }
  }

  function invoke_task_cb(
    fn_expr: Expression,
    cb: Expression,
    sig_arg: Expression,
    target_stmts: Statement[],
  ): Expression {
    if (
      cb.type === "ArrowFunctionExpression" ||
      cb.type === "FunctionExpression"
    ) {
      return call(fn_expr, [sig_arg]);
    }
    let fn_ref: IdentifierReference;
    if (fn_expr.type === "Identifier") {
      fn_ref = fn_expr;
    } else {
      fn_ref = services.fresh("task_cb");
      target_stmts.push(variable(fn_ref, fn_expr, "const"));
    }
    const fn_cast: Expression = node({
      type: "TSAsExpression",
      expression: fn_ref,
      typeAnnotation: node({
        type: "TSFunctionType",
        typeParameters: null,
        params: [
          {
            ...id("signal"),
            typeAnnotation: node({
              type: "TSTypeAnnotation",
              typeAnnotation: node({
                type: "TSUnionType",
                types: Array.from<TSType>([
                  node({
                    type: "TSTypeReference",
                    typeName: id("AbortSignal"),
                    typeArguments: null,
                  }),
                  node({ type: "TSUndefinedKeyword" }),
                ]),
              }),
            }),
          } as BindingPattern,
        ],
        returnType: node({
          type: "TSTypeAnnotation",
          typeAnnotation: node({
            type: "TSTypeReference",
            typeName: id("ReturnType"),
            typeArguments: node({
              type: "TSTypeParameterInstantiation",
              params: Array.from<TSType>([
                node({
                  type: "TSTypeQuery",
                  exprName: fn_ref,
                  typeArguments: null,
                }),
              ]),
            }),
          }),
        }),
      }),
    });
    return call(
      node({ type: "ParenthesizedExpression", expression: fn_cast }),
      [sig_arg],
    );
  }

  function is_imported_from_set(
    expr: Expression,
    set: ReadonlySet<string> | undefined,
  ): boolean {
    return set !== undefined && expr.type === "Identifier" &&
      set.has(expr.name) && services.bindings.imported(expr);
  }

  function is_ns_member(
    expr: Expression,
    ns_set: ReadonlySet<string> | undefined,
    prop: string,
  ): boolean {
    return ns_set !== undefined && expr.type === "MemberExpression" &&
      !expr.computed && !expr.optional &&
      expr.object.type === "Identifier" &&
      expr.property.type === "Identifier" &&
      expr.property.name === prop &&
      ns_set.has(expr.object.name) &&
      services.bindings.imported(expr.object);
  }

  function is_run_task_callee(expr: Expression): boolean {
    return is_imported_from_set(expr, services.imports.task_run_functions) ||
      is_ns_member(expr, services.imports.task_namespaces, "run_task") ||
      is_ns_member(expr, services.imports.namespaces, "run_task");
  }

  function run_task_exit_anchor(expr: Expression): string | undefined {
    if (is_imported_from_set(expr, services.imports.task_run_exit_functions)) {
      return (expr as IdentifierReference).name;
    }
    if (
      is_ns_member(expr, services.imports.task_namespaces, "run_task_exit") ||
      is_ns_member(expr, services.imports.namespaces, "run_task_exit")
    ) {
      return ((expr as Extract<Expression, { type: "MemberExpression" }>)
        .object as IdentifierReference).name;
    }
    return undefined;
  }

  function first_unshadowed(
    set: ReadonlySet<string> | undefined,
  ): string | undefined {
    if (set === undefined) return undefined;
    const shadowed = services.imports.shadowed_names;
    for (const name of set) {
      if (shadowed === undefined || !shadowed.has(name)) return name;
    }
    return undefined;
  }

  function first_imported_any(
    ...sets: readonly (ReadonlySet<string> | undefined)[]
  ): string | undefined {
    for (const s of sets) {
      if (s !== undefined && s.size > 0) return s.values().next().value;
    }
    return undefined;
  }

  function find_task_anchor(): string | undefined {
    return first_imported_any(
      services.task_dictionaries,
      services.imports.task_from_fn_functions,
      services.imports.task_from_promise_functions,
      services.imports.task_succeed_functions,
      services.imports.task_parallel_functions,
      services.imports.task_sequential_functions,
      services.imports.task_run_functions,
      services.imports.task_run_exit_functions,
      services.imports.task_traverse_functions,
      services.imports.parallel_task_dictionaries,
      services.imports.task_namespaces,
      services.imports.namespaces,
    );
  }

  function resolve_is_task_cancellation(
    anchor_local: string,
  ): IdentifierReference | undefined {
    const existing = first_unshadowed(
      services.imports.task_is_cancellation_functions,
    );
    if (existing !== undefined) return id(existing);
    return services.import_from_module?.(
      anchor_local,
      "task",
      "is_task_cancellation",
    );
  }

  function task_succeeded_expr(value: Expression): Expression {
    return node({
      type: "ObjectExpression",
      properties: [
        node({
          type: "Property",
          kind: "init",
          key: id("status"),
          value: as_const(literal("succeeded")),
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

  function wrap_task_exit_stmts(
    stmts: readonly Statement[],
    is_cancel_id: IdentifierReference,
  ): Statement[] {
    function rewrite_stmt(stmt: Statement): Statement {
      switch (stmt.type) {
        case "ReturnStatement":
          return ret(task_succeeded_expr(stmt.argument ?? void_zero()));
        case "BlockStatement":
          return block(stmt.body.map((s) => rewrite_stmt(s as Statement)));
        case "IfStatement":
          return {
            ...stmt,
            consequent: rewrite_stmt(stmt.consequent),
            alternate: stmt.alternate !== null
              ? rewrite_stmt(stmt.alternate)
              : null,
          };
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement":
        case "ForOfStatement":
        case "ForInStatement":
        case "LabeledStatement":
          return { ...stmt, body: rewrite_stmt(stmt.body) };
        case "SwitchStatement":
          return {
            ...stmt,
            cases: stmt.cases.map((c) => ({
              ...c,
              consequent: c.consequent.map((s) => rewrite_stmt(s as Statement)),
            })),
          };
        case "TryStatement":
          return {
            ...stmt,
            block: block(
              stmt.block.body.map((s) => rewrite_stmt(s as Statement)),
            ),
            handler: stmt.handler !== null
              ? {
                ...stmt.handler,
                body: block(
                  stmt.handler.body.body.map((s) =>
                    rewrite_stmt(s as Statement)
                  ),
                ),
              }
              : null,
            finalizer: stmt.finalizer !== null
              ? block(
                stmt.finalizer.body.map((s) => rewrite_stmt(s as Statement)),
              )
              : null,
          };
        default:
          return stmt;
      }
    }
    const rewritten = stmts.map(rewrite_stmt);
    const last = rewritten[rewritten.length - 1];
    if (last?.type !== "ReturnStatement") {
      rewritten.push(ret(task_succeeded_expr(void_zero())));
    }
    const err_id = services.fresh("task_err");
    return [
      node({
        type: "TryStatement",
        block: block(rewritten),
        handler: node({
          type: "CatchClause",
          param: err_id,
          body: block([
            node({
              type: "IfStatement",
              test: call(is_cancel_id, [err_id]),
              consequent: ret(
                node({
                  type: "ObjectExpression",
                  properties: Array.from([
                    node({
                      type: "Property",
                      kind: "init",
                      key: id("status"),
                      value: as_const(literal("cancelled")),
                      method: false,
                      shorthand: false,
                      computed: false,
                    }),
                    node({
                      type: "Property",
                      kind: "init",
                      key: id("error"),
                      value: err_id,
                      method: false,
                      shorthand: false,
                      computed: false,
                    }),
                    node({
                      type: "Property",
                      kind: "init",
                      key: id("reason"),
                      value: member(err_id, "cause"),
                      method: false,
                      shorthand: false,
                      computed: false,
                    }),
                  ]),
                }),
              ),
              alternate: null,
            }),
            ret(
              node({
                type: "ObjectExpression",
                properties: Array.from([
                  node({
                    type: "Property",
                    kind: "init",
                    key: id("status"),
                    value: as_const(literal("failed")),
                    method: false,
                    shorthand: false,
                    computed: false,
                  }),
                  node({
                    type: "Property",
                    kind: "init",
                    key: id("error"),
                    value: err_id,
                    method: false,
                    shorthand: false,
                    computed: false,
                  }),
                ]),
              }),
            ),
          ]),
        }),
        finalizer: null,
      }),
    ];
  }

  function is_task_dict(expr: Expression): boolean {
    return (expr.type === "Identifier" &&
      services.task_dictionaries.has(expr.name) &&
      services.bindings.imported(expr)) ||
      is_ns_member(expr, services.imports.task_namespaces, "Task") ||
      is_ns_member(expr, services.imports.namespaces, "Task");
  }

  function is_parallel_task_dict(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.parallel_task_dictionaries,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "ParallelTask") ||
      is_ns_member(expr, services.imports.namespaces, "ParallelTask");
  }

  function is_parallel_fn(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_parallel_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "parallel") ||
      is_ns_member(expr, services.imports.namespaces, "parallel");
  }

  function is_sequential_fn(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_sequential_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "sequential") ||
      is_ns_member(expr, services.imports.namespaces, "sequential");
  }

  function is_collect_fn(expr: Expression): boolean {
    return is_imported_from_set(expr, services.imports.collect_functions) ||
      is_ns_member(expr, services.imports.collect_namespaces, "collect") ||
      is_ns_member(expr, services.imports.namespaces, "collect");
  }

  function is_applicative_lift_fn(expr: Expression): boolean {
    if (
      is_imported_from_set(expr, services.imports.prelude_lift_functions) ||
      is_ns_member(expr, services.imports.prelude_namespaces, "lift")
    ) return true;
    return expr.type === "MemberExpression" && !expr.computed &&
      !expr.optional && expr.property.type === "Identifier" &&
      expr.property.name === "lift" &&
      (is_imported_from_set(
        expr.object,
        services.imports.applicative_objects,
      ) ||
        is_ns_member(
          expr.object,
          services.imports.applicative_namespaces,
          "Applicative",
        ) ||
        is_ns_member(expr.object, services.imports.namespaces, "Applicative"));
  }

  function is_from_fn_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_from_fn_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "from_fn") ||
      is_ns_member(expr, services.imports.namespaces, "from_fn");
  }

  function is_from_promise_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_from_promise_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "from_promise") ||
      is_ns_member(expr, services.imports.namespaces, "from_promise");
  }

  function is_traverse_task_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_traverse_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "traverse_task") ||
      is_ns_member(expr, services.imports.namespaces, "traverse_task");
  }

  function is_monad_error_obj(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.monad_error_objects,
    ) ||
      is_ns_member(
        expr,
        services.imports.monad_error_namespaces,
        "MonadError",
      ) ||
      is_ns_member(expr, services.imports.namespaces, "MonadError");
  }

  function is_alternative_obj(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.alternative_objects,
    ) ||
      is_ns_member(
        expr,
        services.imports.alternative_namespaces,
        "Alternative",
      ) ||
      is_ns_member(expr, services.imports.namespaces, "Alternative");
  }

  function is_bifunctor_obj(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.bifunctor_objects,
    ) ||
      is_ns_member(
        expr,
        services.imports.bifunctor_namespaces,
        "Bifunctor",
      ) ||
      is_ns_member(expr, services.imports.namespaces, "Bifunctor");
  }

  function is_succeed_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_succeed_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "succeed") ||
      is_ns_member(expr, services.imports.namespaces, "succeed");
  }

  function is_list_dict(expr: Expression): boolean {
    return is_imported_from_set(expr, services.imports.list_constructors) ||
      is_ns_member(expr, services.imports.list_namespaces, "List") ||
      is_ns_member(expr, services.imports.namespaces, "List");
  }

  function is_list_from_array_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.list_from_array_functions,
    ) ||
      is_ns_member(expr, services.imports.list_namespaces, "from_array");
  }

  function is_list_to_array_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.list_to_array_functions,
    ) ||
      is_ns_member(expr, services.imports.list_namespaces, "to_array") ||
      is_imported_from_set(
        expr,
        services.imports.prelude_to_array_functions,
      ) ||
      is_ns_member(expr, services.imports.prelude_namespaces, "to_array");
  }

  function run_task_anchor(expr: Expression): string | undefined {
    if (is_imported_from_set(expr, services.imports.task_run_functions)) {
      return (expr as IdentifierReference).name;
    }
    if (
      is_ns_member(expr, services.imports.task_namespaces, "run_task") ||
      is_ns_member(expr, services.imports.namespaces, "run_task")
    ) {
      return ((expr as Extract<Expression, { type: "MemberExpression" }>)
        .object as IdentifierReference).name;
    }
    return undefined;
  }

  type ParallelBranchSpec =
    | {
      readonly kind: "direct";
      readonly expr: Expression;
      readonly uses_signal: false;
    }
    | {
      readonly kind: "task";
      readonly task_kind: TaskYieldKind;
      readonly uses_signal: boolean;
    };

  function wrap_async_arrow_with_return(
    cb: ArrowFunctionExpression,
    type_arg?: TSType,
  ): Expression {
    if (type_arg === undefined) return call(cb, []);
    const annotated: ArrowFunctionExpression = {
      ...cb,
      returnType: node({
        type: "TSTypeAnnotation",
        typeAnnotation: node({
          type: "TSTypeReference",
          typeName: id("Promise"),
          typeArguments: node({
            type: "TSTypeParameterInstantiation",
            params: Array.from<TSType>([type_arg]),
          }),
        }),
      }),
    };
    return call(annotated, []);
  }

  /** Extract a zero-signal Task expression (doesn't observe AbortSignal). */
  function extract_no_signal_task_expr(
    raw: Expression,
    unwrap_parallel: boolean,
  ): { readonly expr: Expression; readonly eager: boolean } | undefined {
    let cur = parentheses(raw);
    if (unwrap_parallel) {
      if (
        cur.type === "CallExpression" && !cur.optional &&
        cur.typeArguments == null && cur.arguments.length === 1 &&
        cur.arguments[0].type !== "SpreadElement"
      ) {
        if (
          cur.callee.type === "MemberExpression" && !cur.callee.computed &&
          !cur.callee.optional && cur.callee.property.type === "Identifier" &&
          cur.callee.property.name === "pure" &&
          is_parallel_task_dict(cur.callee.object)
        ) {
          const v = cur.arguments[0] as Expression;
          return lexical_hazard(v) || contains_await_yield(v)
            ? undefined
            : { expr: v, eager: true };
        }
        if (is_parallel_fn(cur.callee)) {
          cur = parentheses(cur.arguments[0] as Expression);
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    const kind = classify_task_yield(cur, false);
    if (
      kind === undefined || kind.kind === "arbitrary" ||
      kind.kind === "from_promise" || kind.kind === "catch_error" ||
      kind.kind === "throw_error"
    ) return undefined;
    if (kind.kind === "pure") {
      if (kind.type_arg !== undefined) return undefined;
      return lexical_hazard(kind.value) || contains_await_yield(kind.value)
        ? undefined
        : { expr: kind.value, eager: true };
    }
    if (kind.type_arg !== undefined) return undefined;
    const cb = unwrap(kind.fn);
    if (
      cb.type !== "ArrowFunctionExpression" || cb.generator ||
      cb.typeParameters != null || cb.returnType != null ||
      cb.params.length !== 0
    ) return undefined;
    if (lexical_hazard(cb) || contains_await_yield(cb.body)) return undefined;
    if (cb.body.type !== "BlockStatement") {
      return { expr: cb.body as Expression, eager: false };
    }
    return { expr: call(cb, []), eager: false };
  }

  /** Extract any ParallelTask branch, including arbitrary parallel(task) & catch_error. */
  function extract_parallel_branch(
    raw: Expression,
    explicit_pt: boolean,
  ): ParallelBranchSpec | undefined {
    const fast = extract_no_signal_task_expr(raw, true);
    if (fast !== undefined) {
      if (fast.eager) {
        return {
          kind: "task",
          task_kind: { kind: "pure", value: fast.expr },
          uses_signal: false,
        };
      }
      return { kind: "direct", expr: fast.expr, uses_signal: false };
    }
    let cur = parentheses(raw);
    let saw_parallel = false;
    if (
      cur.type === "CallExpression" && !cur.optional &&
      cur.arguments.length === 1 && cur.arguments[0].type !== "SpreadElement"
    ) {
      if (
        cur.callee.type === "MemberExpression" && !cur.callee.computed &&
        !cur.callee.optional && cur.callee.property.type === "Identifier" &&
        cur.callee.property.name === "pure" &&
        is_parallel_task_dict(cur.callee.object)
      ) {
        const v = cur.arguments[0] as Expression;
        if (lexical_hazard(v) || contains_await_yield(v)) return undefined;
        const type_arg = cur.typeArguments?.params.length === 1
          ? cur.typeArguments.params[0]
          : undefined;
        return {
          kind: "task",
          task_kind: { kind: "pure", value: v, type_arg },
          uses_signal: false,
        };
      }
      if (cur.typeArguments == null && is_parallel_fn(cur.callee)) {
        cur = parentheses(cur.arguments[0] as Expression);
        saw_parallel = true;
      }
    }
    if (!saw_parallel && !explicit_pt) return undefined;
    if (lexical_hazard(cur) || contains_await_yield(cur)) return undefined;
    const cls = classify_task_yield(cur, false);
    if (cls === undefined) return undefined;
    let uses_signal = true;
    if (cls.kind === "pure") uses_signal = false;
    else if (cls.kind === "from_fn") {
      const cb = unwrap(cls.fn);
      if (
        cb.type === "ArrowFunctionExpression" && !cb.generator &&
        cb.params.length === 0
      ) uses_signal = false;
    }
    return { kind: "task", task_kind: cls, uses_signal };
  }

  function is_statically_non_thenable(expr: Expression): boolean {
    const e = parentheses(expr);
    switch (e.type) {
      case "Literal":
      case "TemplateLiteral":
      case "BinaryExpression":
      case "UnaryExpression":
      case "UpdateExpression":
      case "ArrayExpression":
        return true;
      case "ObjectExpression":
        return e.properties.every((p) =>
          p.type === "Property" && !p.computed &&
          ((p.key.type === "Identifier" && p.key.name !== "then") ||
            (p.key.type === "Literal" && p.key.value !== "then"))
        );
      case "ConditionalExpression":
        return is_statically_non_thenable(e.consequent) &&
          is_statically_non_thenable(e.alternate);
      case "LogicalExpression":
        return is_statically_non_thenable(e.left) &&
          is_statically_non_thenable(e.right);
      case "SequenceExpression":
        return e.expressions.length > 0 &&
          is_statically_non_thenable(e.expressions[e.expressions.length - 1]);
      default:
        return false;
    }
  }

  function is_thenable_expr(target: IdentifierReference): Expression {
    const typeof_target: Expression = node({
      type: "UnaryExpression",
      operator: "typeof",
      prefix: true,
      argument: target,
    });
    const is_obj_or_fn: Expression = node({
      type: "LogicalExpression",
      operator: "||",
      left: node({
        type: "BinaryExpression",
        operator: "===",
        left: typeof_target,
        right: literal("object"),
      }),
      right: node({
        type: "BinaryExpression",
        operator: "===",
        left: typeof_target,
        right: literal("function"),
      }),
    });
    const not_null: Expression = node({
      type: "BinaryExpression",
      operator: "!==",
      left: target,
      right: node({ type: "Literal", value: null, raw: "null" }),
    });
    const as_thenable: Expression = node({
      type: "TSAsExpression",
      expression: node({
        type: "TSAsExpression",
        expression: target,
        typeAnnotation: node({ type: "TSUnknownKeyword" }),
      }),
      typeAnnotation: node({
        type: "TSTypeReference",
        typeName: id("PromiseLike"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([node({ type: "TSUnknownKeyword" })]),
        }),
      }),
    });
    const then_is_fn: Expression = node({
      type: "BinaryExpression",
      operator: "===",
      left: node({
        type: "UnaryExpression",
        operator: "typeof",
        prefix: true,
        argument: member(as_thenable, "then"),
      }),
      right: literal("function"),
    });
    return node({
      type: "LogicalExpression",
      operator: "&&",
      left: node({
        type: "LogicalExpression",
        operator: "&&",
        left: not_null,
        right: is_obj_or_fn,
      }),
      right: then_is_fn,
    });
  }

  function awaited_type_of(target: IdentifierReference): TSType {
    return node({
      type: "TSTypeReference",
      typeName: id("Awaited"),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from<TSType>([
          node({
            type: "TSTypeQuery",
            exprName: target,
            typeArguments: null,
          }),
        ]),
      }),
    });
  }

  function cast_as_awaited(target: IdentifierReference): Expression {
    return node({
      type: "TSAsExpression",
      expression: node({
        type: "TSAsExpression",
        expression: target,
        typeAnnotation: node({ type: "TSUnknownKeyword" }),
      }),
      typeAnnotation: awaited_type_of(target),
    });
  }

  function is_non_throwing_branch(expr: Expression): boolean {
    const e = parentheses(expr);
    if (is_pure_no_call(e)) return true;
    if (
      e.type === "CallExpression" && !e.optional &&
      e.callee.type === "MemberExpression" && !e.callee.computed &&
      !e.callee.optional && e.callee.object.type === "Identifier" &&
      e.callee.object.name === "Promise" &&
      !services.bindings.resolve(e.callee.object) &&
      e.callee.property.type === "Identifier" &&
      e.callee.property.name === "resolve" &&
      e.arguments.length <= 1 &&
      (e.arguments.length === 0 ||
        (e.arguments[0].type !== "SpreadElement" &&
          is_pure_no_call(e.arguments[0] as Expression)))
    ) return true;
    return false;
  }

  function wrap_catch_to_rejected(expr: Expression): Expression {
    const err_id = services.fresh("pt_err");
    const rej_call: Expression = node({
      type: "TSAsExpression",
      expression: call(member(id("Promise"), "reject"), [err_id]),
      typeAnnotation: node({
        type: "TSTypeReference",
        typeName: id("Promise"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([node({ type: "TSNeverKeyword" })]),
        }),
      }),
    });
    const try_stmt: Statement = node({
      type: "TryStatement",
      block: block([ret(expr)]),
      handler: node({
        type: "CatchClause",
        param: err_id,
        body: block([ret(rej_call)]),
      }),
      finalizer: null,
    });
    return call(arrow([], block([try_stmt])), []);
  }

  function has_pure_prefix_before_yield(
    stmts: readonly Statement[],
    check_task_first_yield = false,
  ): boolean {
    for (let i = 0; i < stmts.length; i += 1) {
      const s = stmts[i];
      if (
        s.type === "ExpressionStatement" && "directive" in s &&
        s.directive != null
      ) continue;
      if (s.type === "EmptyStatement") continue;
      if (s.type === "VariableDeclaration") {
        for (const decl of s.declarations) {
          if (decl.init === null) continue;
          if (contains_yield(decl.init)) {
            if (check_task_first_yield) {
              return is_pure_first_yield_expr(decl.init, true);
            }
            const e = unwrap(decl.init);
            return e.type === "YieldExpression" && e.delegate;
          }
          if (!is_pure_no_call(decl.init)) return false;
        }
        continue;
      }
      if (s.type === "ExpressionStatement") {
        if (contains_yield(s.expression)) {
          if (check_task_first_yield) {
            return is_pure_first_yield_expr(s.expression, true);
          }
          const e = unwrap(s.expression);
          return e.type === "YieldExpression" && e.delegate;
        }
        if (!is_pure_no_call(s.expression)) return false;
        continue;
      }
      if (s.type === "ForStatement") {
        if (s.init !== null) {
          if (s.init.type === "VariableDeclaration") {
            for (const d of s.init.declarations) {
              if (d.init !== null && !is_pure_no_call(d.init)) return false;
            }
          } else if (!is_pure_no_call(s.init)) return false;
        }
        if (s.test !== null && !is_pure_no_call(s.test)) return false;
        if (contains_yield(s.body)) {
          const inner = s.body.type === "BlockStatement"
            ? s.body.body as Statement[]
            : [s.body];
          return has_pure_prefix_before_yield(inner, check_task_first_yield);
        }
        return false;
      }
      if (s.type === "BlockStatement") {
        if (contains_yield(s)) {
          return has_pure_prefix_before_yield(
            s.body as Statement[],
            check_task_first_yield,
          );
        }
        return false;
      }
      if (s.type === "IfStatement") {
        if (!is_pure_no_call(s.test)) return false;
        if (contains_yield(s.consequent)) {
          const cons = s.consequent.type === "BlockStatement"
            ? s.consequent.body as Statement[]
            : [s.consequent];
          if (!has_pure_prefix_before_yield(cons, check_task_first_yield)) {
            return false;
          }
        }
        if (s.alternate !== null && contains_yield(s.alternate)) {
          const alt = s.alternate.type === "BlockStatement"
            ? s.alternate.body as Statement[]
            : [s.alternate];
          if (!has_pure_prefix_before_yield(alt, check_task_first_yield)) {
            return false;
          }
        }
        return true;
      }
      if (s.type === "ReturnStatement") {
        if (s.argument === null) return true;
        if (contains_yield(s.argument)) {
          if (check_task_first_yield) {
            return is_pure_first_yield_expr(s.argument, true);
          }
          const e = unwrap(s.argument);
          return e.type === "YieldExpression" && e.delegate;
        }
        return is_pure_no_call(s.argument);
      }
      return false;
    }
    return true;
  }

  function reaches_unconditional_yield(stmts: readonly Statement[]): boolean {
    for (let i = 0; i < stmts.length; i += 1) {
      const s = stmts[i];
      if (
        s.type === "ExpressionStatement" && "directive" in s &&
        s.directive != null
      ) continue;
      if (s.type === "EmptyStatement") continue;
      if (s.type === "ReturnStatement") {
        return s.argument !== null && contains_yield(s.argument);
      }
      if (s.type === "ThrowStatement") return false;
      if (s.type === "VariableDeclaration") {
        for (const decl of s.declarations) {
          if (decl.init !== null && contains_yield(decl.init)) return true;
        }
        continue;
      }
      if (s.type === "ExpressionStatement") {
        if (contains_yield(s.expression)) return true;
        continue;
      }
      if (s.type === "BlockStatement") {
        if (reaches_unconditional_yield(s.body as Statement[])) return true;
        continue;
      }
      if (s.type === "ForStatement") {
        if (
          s.init !== null && s.init.type === "VariableDeclaration" &&
          s.init.declarations.length === 1 &&
          s.init.declarations[0].id.type === "Identifier" &&
          s.init.declarations[0].init?.type === "Literal" &&
          typeof s.init.declarations[0].init.value === "number" &&
          s.test !== null && s.test.type === "BinaryExpression" &&
          (s.test.operator === "<" || s.test.operator === "<=") &&
          s.test.left.type === "Identifier" &&
          s.test.left.name === s.init.declarations[0].id.name &&
          s.test.right.type === "Literal" &&
          typeof s.test.right.value === "number" &&
          (s.test.operator === "<"
            ? s.init.declarations[0].init.value < s.test.right.value
            : s.init.declarations[0].init.value <= s.test.right.value)
        ) {
          const inner = s.body.type === "BlockStatement"
            ? s.body.body as Statement[]
            : [s.body];
          if (reaches_unconditional_yield(inner)) return true;
        }
        return false;
      }
      return false;
    }
    return false;
  }

  function contains_loop_with_yield(stmts: readonly Statement[]): boolean {
    let found = false;
    function scan(s: Statement, in_loop: boolean): void {
      if (found) return;
      switch (s.type) {
        case "BlockStatement":
          for (const child of s.body) scan(child as Statement, in_loop);
          return;
        case "IfStatement":
          if (in_loop && contains_yield(s.test)) {
            found = true;
            return;
          }
          scan(s.consequent, in_loop);
          if (s.alternate !== null) scan(s.alternate, in_loop);
          return;
        case "ForStatement":
        case "WhileStatement":
        case "DoWhileStatement":
        case "ForOfStatement":
        case "ForInStatement":
          if (contains_yield(s)) {
            found = true;
            return;
          }
          return;
        case "SwitchStatement":
          if (in_loop && contains_yield(s.discriminant)) {
            found = true;
            return;
          }
          for (const c of s.cases) {
            for (const child of c.consequent) {
              scan(child as Statement, in_loop);
            }
          }
          return;
        case "TryStatement":
          scan(s.block, in_loop);
          if (s.handler !== null) scan(s.handler.body, in_loop);
          if (s.finalizer !== null) scan(s.finalizer, in_loop);
          return;
        default:
          if (in_loop && contains_yield(s)) found = true;
      }
    }
    for (const s of stmts) scan(s, false);
    return found;
  }

  function is_non_allocating_pure(root: Node): boolean {
    let ok = true;
    walk(root, (child) => {
      if (!ok) return false;
      if (
        function_like(child) ||
        child.type === "ObjectExpression" ||
        child.type === "ArrayExpression" ||
        child.type === "NewExpression" ||
        child.type === "CallExpression" ||
        child.type === "AssignmentExpression" ||
        child.type === "UpdateExpression" ||
        child.type === "AwaitExpression" ||
        child.type === "YieldExpression" ||
        (child.type === "UnaryExpression" && child.operator === "delete")
      ) {
        ok = false;
        return false;
      }
    });
    return ok;
  }

  function has_safe_standalone_prefix_before_yield(
    stmts: readonly Statement[],
  ): boolean {
    for (let i = 0; i < stmts.length; i += 1) {
      const s = stmts[i];
      if (
        s.type === "ExpressionStatement" && "directive" in s &&
        s.directive != null
      ) continue;
      if (s.type === "EmptyStatement") continue;
      if (s.type === "VariableDeclaration") {
        if (s.kind !== "const") return false;
        for (const decl of s.declarations) {
          if (decl.init === null) continue;
          if (contains_yield(decl.init)) {
            return is_pure_first_yield_expr(decl.init, true);
          }
          if (!is_non_allocating_pure(decl.init)) return false;
        }
        continue;
      }
      if (s.type === "ExpressionStatement") {
        if (contains_yield(s.expression)) {
          return is_pure_first_yield_expr(s.expression, true);
        }
        if (!is_non_allocating_pure(s.expression)) return false;
        continue;
      }
      if (s.type === "ReturnStatement") {
        if (s.argument === null) return true;
        if (contains_yield(s.argument)) {
          return is_pure_first_yield_expr(s.argument, true);
        }
        return is_non_allocating_pure(s.argument);
      }
      if (s.type === "IfStatement") {
        if (!is_non_allocating_pure(s.test)) return false;
        if (contains_yield(s.consequent)) {
          const cons = s.consequent.type === "BlockStatement"
            ? s.consequent.body as Statement[]
            : [s.consequent];
          if (!has_safe_standalone_prefix_before_yield(cons)) return false;
        }
        if (s.alternate !== null && contains_yield(s.alternate)) {
          const alt = s.alternate.type === "BlockStatement"
            ? s.alternate.body as Statement[]
            : [s.alternate];
          if (!has_safe_standalone_prefix_before_yield(alt)) return false;
        }
        return true;
      }
      return false;
    }
    return true;
  }

  function resolve_task_dict(anchor: string): IdentifierReference | undefined {
    const existing = first_unshadowed(services.task_dictionaries);
    if (existing !== undefined) return id(existing);
    return services.import_from_module?.(anchor, "task", "Task");
  }

  function resolve_parallel_task_dict(
    anchor: string,
  ): IdentifierReference | undefined {
    const existing = first_unshadowed(
      services.imports.parallel_task_dictionaries,
    );
    if (existing !== undefined) return id(existing);
    return services.import_from_module?.(anchor, "task", "ParallelTask");
  }

  type LiftBuilder = {
    readonly hoist_fn?: {
      readonly id: IdentifierReference;
      readonly expr: Expression;
    };
    readonly emit_return: (vals: readonly Expression[]) => Statement;
  };

  function make_lift_builder(
    fn_expr: Expression,
    arity: number,
  ): LiftBuilder | undefined {
    const fn_unwrapped = parentheses(fn_expr);
    if (
      fn_unwrapped.type === "ArrowFunctionExpression" &&
      !fn_unwrapped.async && !fn_unwrapped.generator &&
      fn_unwrapped.typeParameters == null &&
      fn_unwrapped.returnType == null &&
      fn_unwrapped.body.type !== "BlockStatement" &&
      fn_unwrapped.params.length === arity
    ) {
      if (
        fn_unwrapped.params.every((p) =>
          p.type === "Identifier" && !p.optional &&
          (p.decorators === undefined || p.decorators.length === 0)
        )
      ) {
        const decls: Node[] = [];
        let ok = true;
        for (const p of fn_unwrapped.params) {
          const d = services.bindings.resolve(p as IdentifierReference);
          if (d === null) {
            ok = false;
            break;
          }
          decls.push(d);
        }
        if (ok) {
          return {
            emit_return: (vals) => {
              let result = fn_unwrapped.body as Expression;
              for (let k = 0; k < vals.length; k += 1) {
                result = substitute_ident(result, decls[k], vals[k], services);
              }
              return ret(result);
            },
          };
        }
      }
      if (
        fn_unwrapped.params.every((p) =>
          (p.type === "Identifier" || p.type === "ObjectPattern" ||
            p.type === "ArrayPattern" || p.type === "AssignmentPattern") &&
          !p.optional &&
          (p.decorators === undefined || p.decorators.length === 0)
        )
      ) {
        return {
          emit_return: (vals) => {
            const stmts: Statement[] = [];
            for (let k = 0; k < fn_unwrapped.params.length; k += 1) {
              stmts.push(
                variable(
                  fn_unwrapped.params[k] as BindingPattern,
                  vals[k],
                  "const",
                ),
              );
            }
            stmts.push(ret(fn_unwrapped.body as Expression));
            return block(stmts);
          },
        };
      }
    }
    if (
      (fn_unwrapped.type === "ArrowFunctionExpression" ||
        fn_unwrapped.type === "FunctionExpression") &&
      fn_unwrapped.params.some((p) =>
        p.type !== "TSParameterProperty" && p.typeAnnotation == null
      )
    ) return undefined;
    const fn_id = services.fresh("pt_fn");
    return {
      hoist_fn: { id: fn_id, expr: fn_expr },
      emit_return: (vals) => ret(call(fn_id, [...vals])),
    };
  }

  function emit_task_kind_expr(
    classified: TaskYieldKind,
    target_stmts: Statement[],
    sig_id: IdentifierReference | undefined,
    check_sig_id: IdentifierReference | undefined,
    await_sig_id: IdentifierReference | undefined,
    task_anchor: string | undefined,
    lower_sub_expr?: (e: Expression, s: Statement[]) => Expression,
  ): Expression | undefined {
    const emit_sig = (stmts: Statement[], op_name: string): void => {
      if (sig_id === undefined || check_sig_id === undefined) return;
      stmts.push(
        node({
          type: "ExpressionStatement",
          expression: call(check_sig_id, [sig_id, literal(op_name)]),
        }),
      );
    };
    const typed_bind = (
      val: Expression,
      type_arg: TSType | undefined,
      stmts: Statement[],
    ): Expression => {
      if (type_arg === undefined) return val;
      const v_id = services.fresh("task_v");
      stmts.push(variable(v_id, val, "const", type_arg));
      return v_id;
    };
    switch (classified.kind) {
      case "pure":
        emit_sig(target_stmts, "run_task");
        return typed_bind(classified.value, classified.type_arg, target_stmts);
      case "from_fn": {
        emit_sig(target_stmts, "Task.from_fn");
        const cb = unwrap(classified.fn);
        if (
          cb.type === "ArrowFunctionExpression" && !cb.generator &&
          cb.typeParameters == null && cb.returnType == null &&
          cb.params.length === 0 && cb.body.type !== "BlockStatement"
        ) {
          const inner = cb.body as Expression;
          if (!cb.async && is_sync_non_thenable(inner)) {
            if (sig_id !== undefined) {
              const raw_id = services.fresh("task_raw");
              target_stmts.push(
                variable(raw_id, inner, "const", classified.type_arg),
              );
              emit_sig(target_stmts, "Task.from_fn");
              return raw_id;
            }
            return typed_bind(inner, classified.type_arg, target_stmts);
          }
          if (!cb.async) {
            const raw_id = services.fresh("task_raw");
            target_stmts.push(variable(raw_id, inner, "const"));
            if (
              sig_id !== undefined && await_sig_id !== undefined &&
              check_sig_id !== undefined
            ) {
              const res: Expression = node({
                type: "ConditionalExpression",
                test: is_thenable_expr(raw_id),
                consequent: node({
                  type: "AwaitExpression",
                  argument: call(await_sig_id, [
                    raw_id,
                    sig_id,
                    literal("Task.from_fn"),
                  ]),
                }),
                alternate: node({
                  type: "SequenceExpression",
                  expressions: [
                    call(check_sig_id, [sig_id, literal("Task.from_fn")]),
                    cast_as_awaited(raw_id),
                  ],
                }),
              });
              return typed_bind(res, classified.type_arg, target_stmts);
            }
            return typed_bind(
              await_if_thenable_expr(raw_id),
              classified.type_arg,
              target_stmts,
            );
          }
          // cb.async === true
          if (contains_await_yield(inner)) {
            if (sig_id !== undefined && await_sig_id !== undefined) {
              return node({
                type: "AwaitExpression",
                argument: call(await_sig_id, [
                  wrap_async_arrow_with_return(cb, classified.type_arg),
                  sig_id,
                  literal("Task.from_fn"),
                ]),
              });
            }
            return typed_bind(inner, classified.type_arg, target_stmts);
          }
          if (sig_id !== undefined && await_sig_id !== undefined) {
            const res: Expression = node({
              type: "AwaitExpression",
              argument: call(await_sig_id, [
                inner,
                sig_id,
                literal("Task.from_fn"),
              ]),
            });
            return typed_bind(res, classified.type_arg, target_stmts);
          }
          return typed_bind(
            node({ type: "AwaitExpression", argument: inner }),
            classified.type_arg,
            target_stmts,
          );
        }
        if (
          cb.type === "ArrowFunctionExpression" && !cb.generator &&
          cb.params.length === 0
        ) {
          const invoke = cb.async
            ? wrap_async_arrow_with_return(cb, classified.type_arg)
            : call(cb, []);
          if (sig_id !== undefined && await_sig_id !== undefined) {
            return node({
              type: "AwaitExpression",
              argument: call(await_sig_id, [
                invoke,
                sig_id,
                literal("Task.from_fn"),
              ]),
            });
          }
          return node({ type: "AwaitExpression", argument: invoke });
        }
        const invoke = invoke_task_cb(
          classified.fn,
          cb,
          sig_id ?? void_zero(),
          target_stmts,
        );
        if (sig_id !== undefined && await_sig_id !== undefined) {
          return node({
            type: "AwaitExpression",
            argument: call(await_sig_id, [
              invoke,
              sig_id,
              literal("Task.from_fn"),
            ]),
          });
        }
        return node({ type: "AwaitExpression", argument: invoke });
      }
      case "from_promise": {
        emit_sig(target_stmts, "Task.from_promise");
        const p_expr = sig_id !== undefined && await_sig_id !== undefined
          ? call(await_sig_id, [
            classified.promise,
            sig_id,
            literal("Task.from_promise"),
          ])
          : classified.promise;
        return typed_bind(
          node({ type: "AwaitExpression", argument: p_expr }),
          classified.type_arg,
          target_stmts,
        );
      }
      case "task_ctor": {
        emit_sig(target_stmts, "run_task");
        const cb = unwrap(classified.fn);
        if (
          cb.type === "ArrowFunctionExpression" && !cb.generator &&
          cb.typeParameters == null && cb.returnType == null &&
          cb.params.length === 0 && cb.body.type !== "BlockStatement"
        ) {
          const inner = cb.body as Expression;
          if (sig_id !== undefined && await_sig_id !== undefined) {
            return node({
              type: "AwaitExpression",
              argument: call(await_sig_id, [
                inner,
                sig_id,
                literal("run_task"),
              ]),
            });
          }
          return node({ type: "AwaitExpression", argument: inner });
        }
        const invoke = invoke_task_cb(
          classified.fn,
          cb,
          sig_id ?? void_zero(),
          target_stmts,
        );
        if (sig_id !== undefined && await_sig_id !== undefined) {
          return node({
            type: "AwaitExpression",
            argument: call(await_sig_id, [
              invoke,
              sig_id,
              literal("run_task"),
            ]),
          });
        }
        return node({ type: "AwaitExpression", argument: invoke });
      }
      case "throw_error": {
        emit_sig(target_stmts, "Task.throw_error");
        const throw_iife: Expression = call(
          arrow(
            [],
            block([
              node({ type: "ThrowStatement", argument: classified.error }),
            ]),
          ),
          [],
        );
        return classified.type_arg !== undefined
          ? node({
            type: "TSAsExpression",
            expression: throw_iife,
            typeAnnotation: classified.type_arg,
          })
          : throw_iife;
      }
      case "catch_error": {
        const anchor = task_anchor ?? find_task_anchor();
        if (anchor === undefined) return undefined;
        const cancel_id = resolve_is_task_cancellation(anchor);
        if (cancel_id === undefined) return undefined;
        const inner_cls = classify_task_yield(classified.task, false);
        if (inner_cls === undefined) return undefined;
        const try_stmts: Statement[] = [];
        const try_val = emit_task_kind_expr(
          inner_cls,
          try_stmts,
          sig_id,
          check_sig_id,
          await_sig_id,
          anchor,
          lower_sub_expr,
        );
        if (try_val === undefined) return undefined;
        try_stmts.push(ret(try_val));
        const err_id = services.fresh("task_ce_err");
        const catch_stmts: Statement[] = [
          node({
            type: "IfStatement",
            test: call(cancel_id, [err_id]),
            consequent: node({ type: "ThrowStatement", argument: err_id }),
            alternate: null,
          }),
        ];
        const h_arrow = extract_unary_arrow(classified.handler);
        let rec_val: Expression | undefined;
        if (h_arrow !== undefined && h_arrow.call_ref === undefined) {
          const rec_body = h_arrow.param_decl !== null
            ? substitute_ident(
              h_arrow.body,
              h_arrow.param_decl,
              err_id,
              services,
            )
            : h_arrow.body;
          const rec_cls = classify_task_yield(rec_body, false);
          if (rec_cls !== undefined) {
            rec_val = emit_task_kind_expr(
              rec_cls,
              catch_stmts,
              sig_id,
              check_sig_id,
              await_sig_id,
              anchor,
              lower_sub_expr,
            );
          }
        }
        if (rec_val === undefined) {
          let h_ref: IdentifierReference;
          if (classified.handler.type === "Identifier") {
            h_ref = classified.handler;
          } else {
            h_ref = services.fresh("task_ce_h");
            catch_stmts.push(variable(h_ref, classified.handler, "const"));
          }
          const h_cast: Expression = node({
            type: "TSAsExpression",
            expression: h_ref,
            typeAnnotation: node({
              type: "TSFunctionType",
              typeParameters: null,
              params: [
                {
                  ...id("error"),
                  typeAnnotation: node({
                    type: "TSTypeAnnotation",
                    typeAnnotation: node({ type: "TSUnknownKeyword" }),
                  }),
                } as BindingPattern,
              ],
              returnType: node({
                type: "TSTypeAnnotation",
                typeAnnotation: node({
                  type: "TSTypeReference",
                  typeName: id("ReturnType"),
                  typeArguments: node({
                    type: "TSTypeParameterInstantiation",
                    params: Array.from<TSType>([
                      node({
                        type: "TSTypeQuery",
                        exprName: h_ref,
                        typeArguments: null,
                      }),
                    ]),
                  }),
                }),
              }),
            }),
          });
          const handler_call = call(
            node({ type: "ParenthesizedExpression", expression: h_cast }),
            [err_id],
          );
          rec_val = node({
            type: "AwaitExpression",
            argument: call(
              call(member(handler_call, "value"), []),
              sig_id !== undefined ? [sig_id] : [],
            ),
          });
        }
        catch_stmts.push(ret(rec_val));
        const ce_fn: ArrowFunctionExpression = node({
          type: "ArrowFunctionExpression",
          id: null,
          expression: false,
          generator: false,
          async: true,
          params: [],
          body: block([
            node({
              type: "TryStatement",
              block: block(try_stmts),
              handler: node({
                type: "CatchClause",
                param: err_id,
                body: block(catch_stmts),
              }),
              finalizer: null,
            }),
          ]),
          typeParameters: null,
          returnType: null,
        });
        return node({ type: "AwaitExpression", argument: call(ce_fn, []) });
      }
      case "arbitrary": {
        emit_sig(target_stmts, "run_task");
        const target_expr = lower_sub_expr !== undefined
          ? lower_sub_expr(classified.expr, target_stmts)
          : classified.expr;
        return node({
          type: "AwaitExpression",
          argument: call(
            call(member(target_expr, "value"), []),
            sig_id !== undefined ? [sig_id] : [],
          ),
        });
      }
    }
  }

  function parallel_task_fusion(
    raw_inner: Expression,
    exit_cancel_id: IdentifierReference | undefined,
    standalone_mode: "none" | "task" | "parallel" = "none",
    signal_expr?: Expression,
    signal_anchor?: string,
  ): { expression: Expression; direct: boolean } | undefined {
    let inner = parentheses(raw_inner);
    let unwrapped_seq = false;
    if (
      inner.type === "CallExpression" && !inner.optional &&
      inner.typeArguments == null && inner.arguments.length === 1 &&
      inner.arguments[0].type !== "SpreadElement" &&
      is_sequential_fn(parentheses(inner.callee))
    ) {
      inner = parentheses(inner.arguments[0] as Expression);
      unwrapped_seq = true;
    }
    if (standalone_mode === "task" && !unwrapped_seq) return undefined;
    if (
      inner.type !== "CallExpression" || inner.optional ||
      inner.typeArguments != null ||
      inner.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    const callee = parentheses(inner.callee);

    // 1. ParallelTask traverse: Traversable.traverse(ArrayT(xs), ParallelTask, fn)
    //    or ArrayT(xs).traverse(ParallelTask, fn)
    let trav_items: Expression | undefined;
    let trav_array_ctor: IdentifierReference | undefined;
    let trav_fn: Expression | undefined;
    if (
      standalone_mode === "none" && signal_expr === undefined &&
      inner.arguments.length === 3 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "traverse" &&
      is_traversable_obj(parentheses(callee.object)) &&
      is_parallel_task_dict(parentheses(inner.arguments[1] as Expression))
    ) {
      const arr = unwrap_array_t(inner.arguments[0] as Expression);
      if (arr !== undefined) {
        trav_items = arr.items;
        trav_array_ctor = arr.array_ctor;
        trav_fn = inner.arguments[2] as Expression;
      }
    } else if (
      standalone_mode === "none" && signal_expr === undefined &&
      inner.arguments.length === 2 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "traverse" &&
      is_parallel_task_dict(parentheses(inner.arguments[0] as Expression))
    ) {
      const arr = unwrap_array_t(callee.object);
      if (arr !== undefined) {
        trav_items = arr.items;
        trav_array_ctor = arr.array_ctor;
        trav_fn = inner.arguments[1] as Expression;
      }
    }
    if (trav_items !== undefined && trav_fn !== undefined) {
      if (
        lexical_hazard(trav_items) || contains_await_yield(trav_items) ||
        lexical_hazard(trav_fn) || contains_await_yield(trav_fn)
      ) return undefined;
      const fn_unwrapped = unwrap(trav_fn);
      if (
        fn_unwrapped.type !== "ArrowFunctionExpression" ||
        fn_unwrapped.async || fn_unwrapped.generator ||
        fn_unwrapped.typeParameters != null ||
        fn_unwrapped.returnType != null ||
        fn_unwrapped.body.type === "BlockStatement" ||
        fn_unwrapped.params.length !== 1 ||
        fn_unwrapped.params[0].type !== "Identifier" ||
        fn_unwrapped.params[0].optional ||
        fn_unwrapped.params[0].typeAnnotation != null ||
        (fn_unwrapped.params[0].decorators !== undefined &&
          fn_unwrapped.params[0].decorators.length > 0)
      ) return undefined;
      const param_decl = services.bindings.resolve(fn_unwrapped.params[0]);
      if (param_decl === null) return undefined;
      const item_id = services.fresh("pt_x");
      const inlined_body = substitute_ident(
        fn_unwrapped.body as Expression,
        param_decl,
        item_id,
        services,
      );
      const step_info = extract_no_signal_task_expr(inlined_body, true);
      if (step_info === undefined) return undefined;
      if (step_info.eager && !is_pure_no_call(step_info.expr)) return undefined;
      if (!intrinsics_unshadowed(inner, ["Array", "Promise"])) return undefined;
      const step_expr = step_info.expr;
      const src_id = services.fresh("pt_src");
      const len_id = services.fresh("pt_len");
      const idx_id = services.fresh("pt_i");
      const p0_id = services.fresh("pt_p0");
      const ps_id = services.fresh("pt_ps");
      const elem_access: Expression = node({
        type: "MemberExpression",
        object: src_id,
        property: idx_id,
        computed: true,
        optional: false,
      });
      const ps_set = (index_expr: Expression, val: Expression): Statement =>
        node({
          type: "ExpressionStatement",
          expression: node({
            type: "AssignmentExpression",
            operator: "=",
            left: node({
              type: "MemberExpression",
              object: ps_id,
              property: index_expr,
              computed: true,
              optional: false,
            }),
            right: val,
          }),
        });
      const wrap_col = (arr_expr: Expression): Expression =>
        trav_array_ctor !== undefined
          ? call(trav_array_ctor, [arr_expr])
          : arr_expr;
      const zero_idx = literal(0);
      const new_arr: Expression = node({
        type: "NewExpression",
        callee: id("Array"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([
            node({
              type: "TSTypeQuery",
              exprName: p0_id,
              typeArguments: null,
            }),
          ]),
        }),
        arguments: [len_id],
      });
      const pass_src_as_param = exit_cancel_id !== undefined &&
        !is_pure_no_call(trav_items);
      const eager_stmts: Statement[] = [];
      const body_stmts: Statement[] = [];
      if (pass_src_as_param) {
        eager_stmts.push(variable(src_id, trav_items, "const"));
      } else {
        body_stmts.push(variable(src_id, trav_items, "const"));
      }
      const sync_step = is_statically_non_thenable(step_expr) &&
        is_non_throwing_branch(step_expr);
      if (sync_step) {
        body_stmts.push(
          variable(len_id, member(src_id, "length"), "const"),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "===",
              left: len_id,
              right: zero_idx,
            }),
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: wrap_col(
                  node({ type: "ArrayExpression", elements: Array.from([]) }),
                ),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
          variable(idx_id, zero_idx, "let"),
          variable(item_id, elem_access, "const"),
          variable(p0_id, step_expr, "const"),
          variable(ps_id, new_arr, "const"),
          ps_set(zero_idx, p0_id),
          node({
            type: "ForStatement",
            init: node({
              type: "AssignmentExpression",
              operator: "=",
              left: idx_id,
              right: literal(1),
            }),
            test: node({
              type: "BinaryExpression",
              operator: "<",
              left: idx_id,
              right: len_id,
            }),
            update: node({
              type: "AssignmentExpression",
              operator: "+=",
              left: idx_id,
              right: literal(1),
            }),
            body: block([
              variable(item_id, elem_access, "const"),
              ps_set(idx_id, step_expr),
            ]),
          }),
          ret(wrap_col(ps_id)),
        );
      } else {
        const safe_step = is_non_throwing_branch(step_expr)
          ? step_expr
          : wrap_catch_to_rejected(step_expr);
        const async_flag_id = services.fresh("pt_async");
        const step_val_id = services.fresh("pt_v");
        const set_async_true: Statement = node({
          type: "ExpressionStatement",
          expression: node({
            type: "AssignmentExpression",
            operator: "=",
            left: async_flag_id,
            right: literal(true),
          }),
        });
        const awaited_arr_cast: Expression = node({
          type: "TSAsExpression",
          expression: node({
            type: "TSAsExpression",
            expression: ps_id,
            typeAnnotation: node({ type: "TSUnknownKeyword" }),
          }),
          typeAnnotation: node({
            type: "TSArrayType",
            elementType: awaited_type_of(p0_id),
          }),
        });
        body_stmts.push(
          variable(len_id, member(src_id, "length"), "const"),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "===",
              left: len_id,
              right: zero_idx,
            }),
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: wrap_col(
                  node({ type: "ArrayExpression", elements: Array.from([]) }),
                ),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
          variable(async_flag_id, literal(false), "let"),
          variable(idx_id, zero_idx, "let"),
          variable(item_id, elem_access, "const"),
          variable(p0_id, safe_step, "const"),
          node({
            type: "IfStatement",
            test: is_thenable_expr(p0_id),
            consequent: set_async_true,
            alternate: null,
          }),
          variable(ps_id, new_arr, "const"),
          ps_set(zero_idx, p0_id),
          node({
            type: "ForStatement",
            init: node({
              type: "AssignmentExpression",
              operator: "=",
              left: idx_id,
              right: literal(1),
            }),
            test: node({
              type: "BinaryExpression",
              operator: "<",
              left: idx_id,
              right: len_id,
            }),
            update: node({
              type: "AssignmentExpression",
              operator: "+=",
              left: idx_id,
              right: literal(1),
            }),
            body: block([
              variable(item_id, elem_access, "const"),
              variable(step_val_id, safe_step, "const"),
              node({
                type: "IfStatement",
                test: node({
                  type: "LogicalExpression",
                  operator: "&&",
                  left: node({
                    type: "UnaryExpression",
                    operator: "!",
                    prefix: true,
                    argument: async_flag_id,
                  }),
                  right: is_thenable_expr(step_val_id),
                }),
                consequent: set_async_true,
                alternate: null,
              }),
              ps_set(idx_id, step_val_id),
            ]),
          }),
          ret(
            wrap_col(
              node({
                type: "ConditionalExpression",
                test: async_flag_id,
                consequent: node({
                  type: "AwaitExpression",
                  argument: call(member(id("Promise"), "all"), [ps_id]),
                }),
                alternate: awaited_arr_cast,
              }),
            ),
          ),
        );
      }
      const final_body = exit_cancel_id !== undefined
        ? wrap_task_exit_stmts(body_stmts, exit_cancel_id)
        : body_stmts;
      const async_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [],
        body: block(final_body),
        typeParameters: null,
        returnType: null,
      });
      const async_call = call(async_fn, []);
      return {
        expression: eager_stmts.length > 0
          ? call(arrow([], block([...eager_stmts, ret(async_call)])), [])
          : async_call,
        direct: true,
      };
    }

    // 2. ParallelTask Applicative.lift(fn, parallel(t1), ...) or
    //    collect(ParallelTask, [t1, ...]) / collect([parallel(t1), ...]) /
    //    collect(ParallelTask, { a: t1, ... }) / collect({ a: parallel(t1), ... })
    let branch_specs: ParallelBranchSpec[] | undefined;
    let lift_builder: LiftBuilder | undefined;

    if (is_applicative_lift_fn(callee) && inner.arguments.length >= 2) {
      const fn_expr = inner.arguments[0] as Expression;
      if (lexical_hazard(fn_expr) || contains_await_yield(fn_expr)) {
        return undefined;
      }
      const raw_items = inner.arguments.slice(1) as Expression[];
      const extracted: ParallelBranchSpec[] = [];
      for (const item of raw_items) {
        const ex = extract_parallel_branch(item, false);
        if (ex === undefined) return undefined;
        extracted.push(ex);
      }
      const builder = make_lift_builder(fn_expr, extracted.length);
      if (builder === undefined) return undefined;
      branch_specs = extracted;
      lift_builder = builder;
    } else if (
      is_collect_fn(callee) &&
      (inner.arguments.length === 1 || inner.arguments.length === 2)
    ) {
      let explicit_pt = false;
      let shape_arg: Expression;
      if (inner.arguments.length === 2) {
        if (
          !is_parallel_task_dict(parentheses(inner.arguments[0] as Expression))
        ) {
          return undefined;
        }
        explicit_pt = true;
        shape_arg = parentheses(inner.arguments[1] as Expression);
      } else {
        shape_arg = parentheses(inner.arguments[0] as Expression);
      }
      if (shape_arg.type === "ArrayExpression") {
        if (
          shape_arg.elements.length === 0 ||
          shape_arg.elements.some((el) =>
            el === null || el.type === "SpreadElement"
          )
        ) return undefined;
        const extracted: ParallelBranchSpec[] = [];
        for (const el of shape_arg.elements) {
          const ex = extract_parallel_branch(el as Expression, explicit_pt);
          if (ex === undefined) return undefined;
          extracted.push(ex);
        }
        branch_specs = extracted;
        lift_builder = {
          emit_return: (vals) =>
            ret(
              as_const(
                node({ type: "ArrayExpression", elements: [...vals] }),
              ),
            ),
        };
      } else if (shape_arg.type === "ObjectExpression") {
        if (shape_arg.properties.length === 0 && !explicit_pt) return undefined;
        const entries: {
          readonly key: string;
          readonly is_ident: boolean;
        }[] = [];
        const extracted: ParallelBranchSpec[] = [];
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
          const ex = extract_parallel_branch(
            prop.value as Expression,
            explicit_pt,
          );
          if (ex === undefined) return undefined;
          entries.push({ key, is_ident });
          extracted.push(ex);
        }
        branch_specs = extracted;
        lift_builder = {
          emit_return: (vals) =>
            ret(
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
                  })
                ),
              }),
            ),
        };
      }
    }

    if (branch_specs === undefined || lift_builder === undefined) {
      return undefined;
    }
    if (!intrinsics_unshadowed(inner, ["Promise", "AbortController"])) {
      return undefined;
    }

    // Fast path: immediate run with no AbortSignal and all direct zero-signal branches
    const all_direct = branch_specs.every((b) => b.kind === "direct");
    if (
      standalone_mode === "none" && signal_expr === undefined && all_direct
    ) {
      const branch_exprs = branch_specs.map((b) =>
        (b as Extract<ParallelBranchSpec, { kind: "direct" }>).expr
      );
      const body_stmts: Statement[] = [];
      const eager_stmts: Statement[] = [];
      if (lift_builder.hoist_fn !== undefined) {
        if (!is_inline_fn_expr(lift_builder.hoist_fn.expr)) {
          eager_stmts.push(
            variable(
              lift_builder.hoist_fn.id,
              lift_builder.hoist_fn.expr,
              "const",
            ),
          );
        } else {
          body_stmts.push(
            variable(
              lift_builder.hoist_fn.id,
              lift_builder.hoist_fn.expr,
              "const",
            ),
          );
        }
      }
      if (branch_exprs.length === 0) {
        body_stmts.push(lift_builder.emit_return([]));
      } else {
        const raw_ids: IdentifierReference[] = [];
        const maybe_async_indices: number[] = [];
        for (let i = 0; i < branch_exprs.length; i += 1) {
          const r_id = services.fresh("pt_r");
          const needs_catch = branch_exprs.length > 1 &&
            i < branch_exprs.length - 1 &&
            !is_non_throwing_branch(branch_exprs[i]);
          const init_expr = needs_catch
            ? wrap_catch_to_rejected(branch_exprs[i])
            : branch_exprs[i];
          body_stmts.push(variable(r_id, init_expr, "const"));
          raw_ids.push(r_id);
          if (needs_catch || !is_statically_non_thenable(branch_exprs[i])) {
            maybe_async_indices.push(i);
          }
        }
        if (maybe_async_indices.length === 0) {
          body_stmts.push(lift_builder.emit_return(raw_ids));
        } else {
          let any_thenable: Expression = is_thenable_expr(
            raw_ids[maybe_async_indices[0]],
          );
          for (let k = 1; k < maybe_async_indices.length; k += 1) {
            any_thenable = node({
              type: "LogicalExpression",
              operator: "||",
              left: any_thenable,
              right: is_thenable_expr(raw_ids[maybe_async_indices[k]]),
            });
          }
          const res_id = services.fresh("pt_res");
          const async_branch: Statement[] = [
            variable(
              res_id,
              node({
                type: "AwaitExpression",
                argument: call(member(id("Promise"), "all"), [
                  as_const(
                    node({
                      type: "ArrayExpression",
                      elements: raw_ids,
                    }),
                  ),
                ]),
              }),
              "const",
            ),
          ];
          const async_vals: IdentifierReference[] = [];
          for (let i = 0; i < raw_ids.length; i += 1) {
            const v_id = services.fresh("pt_v");
            async_branch.push(
              variable(
                v_id,
                node({
                  type: "MemberExpression",
                  object: res_id,
                  property: literal(i),
                  computed: true,
                  optional: false,
                }),
                "const",
              ),
            );
            async_vals.push(v_id);
          }
          async_branch.push(lift_builder.emit_return(async_vals));
          body_stmts.push(
            node({
              type: "IfStatement",
              test: any_thenable,
              consequent: block(async_branch),
              alternate: null,
            }),
          );
          const sync_vals: IdentifierReference[] = [];
          const maybe_set = new Set(maybe_async_indices);
          for (let i = 0; i < raw_ids.length; i += 1) {
            if (maybe_set.has(i)) {
              const sv_id = services.fresh("pt_sv");
              body_stmts.push(
                variable(sv_id, cast_as_awaited(raw_ids[i]), "const"),
              );
              sync_vals.push(sv_id);
            } else {
              sync_vals.push(raw_ids[i]);
            }
          }
          body_stmts.push(lift_builder.emit_return(sync_vals));
        }
      }
      const final_body = exit_cancel_id !== undefined
        ? wrap_task_exit_stmts(body_stmts, exit_cancel_id)
        : body_stmts;
      const async_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [],
        body: block(final_body),
        typeParameters: null,
        returnType: null,
      });
      const async_call = call(async_fn, []);
      return {
        expression: eager_stmts.length > 0
          ? call(arrow([], block([...eager_stmts, ret(async_call)])), [])
          : async_call,
        direct: true,
      };
    }

    // General path: standalone Task/ParallelTask, { signal }, or arbitrary/catch_error branches
    const anchor = signal_anchor ?? find_task_anchor();
    if (anchor === undefined) return undefined;
    const check_sig_id = services.import_from_module?.(
      anchor,
      "task",
      "task_check_signal",
    );
    const await_sig_id = services.import_from_module?.(
      anchor,
      "task",
      "task_await_signal",
    );
    if (check_sig_id === undefined || await_sig_id === undefined) {
      return undefined;
    }
    let wrapper_ctor: IdentifierReference | undefined;
    if (standalone_mode === "task") {
      wrapper_ctor = resolve_task_dict(anchor);
      if (wrapper_ctor === undefined) return undefined;
    } else if (standalone_mode === "parallel") {
      wrapper_ctor = resolve_parallel_task_dict(anchor);
      if (wrapper_ctor === undefined) return undefined;
    }

    const parent_sig_id: IdentifierReference | undefined =
      standalone_mode !== "none" || signal_expr !== undefined
        ? services.fresh("task_sig")
        : undefined;
    const any_uses_signal = branch_specs.some((b) => b.uses_signal);
    const use_linked_ctrl = branch_specs.length > 1 &&
      (parent_sig_id !== undefined || any_uses_signal);
    const ctrl_id = use_linked_ctrl ? services.fresh("pt_ctrl") : undefined;
    const child_sig_id = use_linked_ctrl
      ? services.fresh("pt_sig")
      : parent_sig_id;

    const eager_stmts: Statement[] = [];
    const body_stmts: Statement[] = [];
    // Evaluate combiner fn and eager branch constructor arguments left-to-right
    // BEFORE creating the deferred task or evaluating options.signal.
    if (lift_builder.hoist_fn !== undefined) {
      if (!is_inline_fn_expr(lift_builder.hoist_fn.expr)) {
        eager_stmts.push(
          variable(
            lift_builder.hoist_fn.id,
            lift_builder.hoist_fn.expr,
            "const",
          ),
        );
      } else {
        body_stmts.push(
          variable(
            lift_builder.hoist_fn.id,
            lift_builder.hoist_fn.expr,
            "const",
          ),
        );
      }
    }
    const hoisted_specs: ParallelBranchSpec[] = branch_specs.map((spec) =>
      spec.kind === "direct" ? spec : {
        ...spec,
        task_kind: hoist_task_kind_eager(
          spec.task_kind,
          eager_stmts,
          "pt_e",
        ),
      }
    );

    // Build concurrent starter expression for each branch
    const started_exprs: Expression[] = [];
    for (const spec of hoisted_specs) {
      if (spec.kind === "direct") {
        started_exprs.push(spec.expr);
        continue;
      }
      const tk = spec.task_kind;
      if (tk.kind === "pure") {
        started_exprs.push(
          tk.type_arg !== undefined
            ? node({
              type: "TSAsExpression",
              expression: tk.value,
              typeAnnotation: tk.type_arg,
            })
            : tk.value,
        );
      } else if (tk.kind === "arbitrary") {
        started_exprs.push(
          call(
            call(member(tk.expr, "value"), []),
            child_sig_id !== undefined ? [child_sig_id] : [],
          ),
        );
      } else if (tk.kind === "from_promise") {
        started_exprs.push(
          child_sig_id !== undefined
            ? call(await_sig_id, [
              tk.promise,
              child_sig_id,
              literal("Task.from_promise"),
            ])
            : tk.promise,
        );
      } else {
        // from_fn / task_ctor / catch_error / throw_error: run concurrently via async IIFE
        const b_stmts: Statement[] = [];
        const b_val = emit_task_kind_expr(
          tk,
          b_stmts,
          child_sig_id,
          check_sig_id,
          await_sig_id,
          anchor,
        );
        if (b_val === undefined) return undefined;
        b_stmts.push(ret(b_val));
        const b_fn: ArrowFunctionExpression = node({
          type: "ArrowFunctionExpression",
          id: null,
          expression: false,
          generator: false,
          async: true,
          params: [],
          body: block(b_stmts),
          typeParameters: null,
          returnType: null,
        });
        started_exprs.push(call(b_fn, []));
      }
    }

    if (standalone_mode === "none" && signal_expr !== undefined) {
      if (eager_stmts.length > 0 || !is_const_literal_expr(signal_expr)) {
        eager_stmts.push(variable(parent_sig_id!, signal_expr, "const"));
      } else {
        body_stmts.push(variable(parent_sig_id!, signal_expr, "const"));
      }
    }
    if (parent_sig_id !== undefined) {
      body_stmts.push(
        node({
          type: "ExpressionStatement",
          expression: call(check_sig_id, [
            parent_sig_id,
            literal("ParallelTask"),
          ]),
        }),
      );
    }

    const work_stmts: Statement[] = [];
    if (started_exprs.length === 0) {
      work_stmts.push(lift_builder.emit_return([]));
    } else {
      const raw_ids: IdentifierReference[] = [];
      for (let i = 0; i < started_exprs.length; i += 1) {
        const r_id = services.fresh("pt_r");
        const needs_catch = started_exprs.length > 1 &&
          i < started_exprs.length - 1 &&
          !is_non_throwing_branch(started_exprs[i]);
        const init_expr = needs_catch
          ? wrap_catch_to_rejected(started_exprs[i])
          : started_exprs[i];
        work_stmts.push(variable(r_id, init_expr, "const"));
        raw_ids.push(r_id);
      }
      const all_call = call(member(id("Promise"), "all"), [
        as_const(node({ type: "ArrayExpression", elements: raw_ids })),
      ]);
      const awaited_all = parent_sig_id !== undefined
        ? node({
          type: "AwaitExpression",
          argument: call(await_sig_id, [
            all_call,
            parent_sig_id,
            literal("ParallelTask"),
          ]),
        })
        : node({ type: "AwaitExpression", argument: all_call });
      const res_id = services.fresh("pt_res");
      work_stmts.push(variable(res_id, awaited_all, "const"));
      if (parent_sig_id !== undefined) {
        work_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: call(check_sig_id, [
              parent_sig_id,
              literal("ParallelTask"),
            ]),
          }),
        );
      }
      const vals: IdentifierReference[] = [];
      for (let i = 0; i < raw_ids.length; i += 1) {
        const v_id = services.fresh("pt_v");
        work_stmts.push(
          variable(
            v_id,
            node({
              type: "MemberExpression",
              object: res_id,
              property: literal(i),
              computed: true,
              optional: false,
            }),
            "const",
          ),
        );
        vals.push(v_id);
      }
      work_stmts.push(lift_builder.emit_return(vals));
    }

    if (
      use_linked_ctrl && ctrl_id !== undefined && child_sig_id !== undefined
    ) {
      const on_abort_id = services.fresh("pt_abort");
      const err_id = services.fresh("pt_err");
      body_stmts.push(
        variable(
          ctrl_id,
          node({
            type: "NewExpression",
            callee: id("AbortController"),
            arguments: [],
          }),
          "const",
        ),
        variable(child_sig_id, member(ctrl_id, "signal"), "const"),
      );
      if (parent_sig_id !== undefined) {
        body_stmts.push(
          variable(
            on_abort_id,
            arrow(
              [],
              call(member(ctrl_id, "abort"), [
                node({
                  type: "ChainExpression",
                  expression: node({
                    type: "MemberExpression",
                    object: parent_sig_id,
                    property: id("reason"),
                    computed: false,
                    optional: true,
                  }),
                }),
              ]),
            ),
            "const",
          ),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "!==",
              left: parent_sig_id,
              right: void_zero(),
            }),
            consequent: node({
              type: "ExpressionStatement",
              expression: call(member(parent_sig_id, "addEventListener"), [
                literal("abort"),
                on_abort_id,
                node({
                  type: "ObjectExpression",
                  properties: [
                    node({
                      type: "Property",
                      kind: "init",
                      key: id("once"),
                      value: literal(true),
                      method: false,
                      shorthand: false,
                      computed: false,
                    }),
                  ],
                }),
              ]),
            }),
            alternate: null,
          }),
        );
      }
      body_stmts.push(
        node({
          type: "TryStatement",
          block: block(work_stmts),
          handler: node({
            type: "CatchClause",
            param: err_id,
            body: block([
              node({
                type: "IfStatement",
                test: negate_expr(member(child_sig_id, "aborted")),
                consequent: node({
                  type: "ExpressionStatement",
                  expression: call(member(ctrl_id, "abort"), [err_id]),
                }),
                alternate: null,
              }),
              node({ type: "ThrowStatement", argument: err_id }),
            ]),
          }),
          finalizer: parent_sig_id !== undefined
            ? block([
              node({
                type: "IfStatement",
                test: node({
                  type: "BinaryExpression",
                  operator: "!==",
                  left: parent_sig_id,
                  right: void_zero(),
                }),
                consequent: node({
                  type: "ExpressionStatement",
                  expression: call(
                    member(parent_sig_id, "removeEventListener"),
                    [literal("abort"), on_abort_id],
                  ),
                }),
                alternate: null,
              }),
            ])
            : null,
        }),
      );
    } else {
      body_stmts.push(...work_stmts);
    }

    if (standalone_mode !== "none" && wrapper_ctor !== undefined) {
      const task_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [parent_sig_id!],
        body: block(body_stmts),
        typeParameters: null,
        returnType: null,
      });
      const wrapped = call(wrapper_ctor, [task_fn]);
      return {
        expression: eager_stmts.length > 0
          ? call(arrow([], block([...eager_stmts, ret(wrapped)])), [])
          : wrapped,
        direct: true,
      };
    }

    const final_body = exit_cancel_id !== undefined
      ? wrap_task_exit_stmts(body_stmts, exit_cancel_id)
      : body_stmts;
    const async_fn: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: [],
      body: block(final_body),
      typeParameters: null,
      returnType: null,
    });
    const async_call = call(async_fn, []);
    return {
      expression: eager_stmts.length > 0
        ? call(arrow([], block([...eager_stmts, ret(async_call)])), [])
        : async_call,
      direct: true,
    };
  }

  function is_effect_method(expr: Expression, prop: string): boolean {
    return expr.type === "MemberExpression" && !expr.computed &&
      !expr.optional && expr.property.type === "Identifier" &&
      expr.property.name === prop &&
      (is_imported_from_set(expr.object, services.imports.effect_names) ||
        is_ns_member(expr.object, services.imports.namespaces, "Effect"));
  }

  type TaskYieldKind =
    | {
      readonly kind: "pure";
      readonly value: Expression;
      readonly type_arg?: TSType;
    }
    | {
      readonly kind: "from_fn";
      readonly fn: Expression;
      readonly type_arg?: TSType;
    }
    | {
      readonly kind: "from_promise";
      readonly promise: Expression;
      readonly type_arg?: TSType;
    }
    | {
      readonly kind: "task_ctor";
      readonly fn: Expression;
      readonly type_arg?: TSType;
    }
    | {
      readonly kind: "throw_error";
      readonly error: Expression;
      readonly type_arg?: TSType;
    }
    | {
      readonly kind: "catch_error";
      readonly task: Expression;
      readonly handler: Expression;
    }
    | { readonly kind: "arbitrary"; readonly expr: Expression };

  function is_known_task_expr(expr: Expression): boolean {
    const val = parentheses(expr);
    if (
      val.type === "CallExpression" && !val.optional &&
      val.arguments.length === 1 && val.arguments[0].type !== "SpreadElement" &&
      is_sequential_fn(parentheses(val.callee))
    ) return true;
    const cls = classify_task_yield(val, false);
    if (cls === undefined || cls.kind === "arbitrary") return false;
    if (cls.kind === "catch_error") return is_known_task_expr(cls.task);
    return true;
  }

  function classify_task_yield(
    expression: Expression,
    program_mode: boolean,
  ): TaskYieldKind | undefined {
    let val = parentheses(expression);
    if (
      program_mode && val.type === "CallExpression" && !val.optional &&
      val.typeArguments == null && val.arguments.length === 1 &&
      val.arguments[0].type !== "SpreadElement"
    ) {
      if (is_effect_method(val.callee, "pure")) {
        return { kind: "pure", value: val.arguments[0] as Expression };
      }
      if (is_effect_method(val.callee, "lift")) {
        val = parentheses(val.arguments[0] as Expression);
      }
    }
    if (val.type === "CallExpression" && !val.optional) {
      const tparams = val.typeArguments?.params;
      const single_type = tparams !== undefined && tparams.length === 1
        ? tparams[0]
        : undefined;
      if (
        (tparams == null || single_type !== undefined) &&
        val.arguments.length === 1 &&
        val.arguments[0].type !== "SpreadElement"
      ) {
        const arg = val.arguments[0] as Expression;
        const c = parentheses(val.callee);
        if (
          is_succeed_callee(c) ||
          (c.type === "MemberExpression" && !c.computed && !c.optional &&
            c.property.type === "Identifier" && c.property.name === "pure" &&
            is_task_dict(c.object))
        ) {
          return { kind: "pure", value: arg, type_arg: single_type };
        }
        if (is_from_fn_callee(c)) {
          return { kind: "from_fn", fn: arg, type_arg: single_type };
        }
        if (is_from_promise_callee(c)) {
          return { kind: "from_promise", promise: arg, type_arg: single_type };
        }
        if (is_task_dict(c)) {
          return { kind: "task_ctor", fn: arg, type_arg: single_type };
        }
        if (
          c.type === "MemberExpression" && !c.computed && !c.optional &&
          c.property.type === "Identifier" &&
          c.property.name === "throw_error" && is_task_dict(c.object)
        ) {
          return { kind: "throw_error", error: arg, type_arg: single_type };
        }
        if (
          !program_mode && val.typeArguments == null &&
          c.type === "MemberExpression" && !c.computed && !c.optional &&
          c.property.type === "Identifier" && c.property.name === "catch_error"
        ) {
          return { kind: "catch_error", task: c.object, handler: arg };
        }
      }
      if (
        val.arguments.length === 2 &&
        val.arguments[0].type !== "SpreadElement" &&
        val.arguments[1].type !== "SpreadElement"
      ) {
        const c = parentheses(val.callee);
        if (
          c.type === "MemberExpression" && !c.computed && !c.optional &&
          c.property.type === "Identifier" && is_monad_error_obj(c.object)
        ) {
          if (
            c.property.name === "throw_error" &&
            (tparams == null || single_type !== undefined) &&
            is_task_dict(parentheses(val.arguments[0] as Expression))
          ) {
            return {
              kind: "throw_error",
              error: val.arguments[1] as Expression,
              type_arg: single_type,
            };
          }
          if (
            !program_mode && val.typeArguments == null &&
            c.property.name === "catch_error"
          ) {
            return {
              kind: "catch_error",
              task: val.arguments[0] as Expression,
              handler: val.arguments[1] as Expression,
            };
          }
        }
      }
    }
    if (program_mode) return undefined;
    return { kind: "arbitrary", expr: val };
  }

  /** PPF-03: Sequential Task Applicative.lift / prelude lift fusion. */
  function sequential_task_lift_fusion(
    inner: CallExpression,
    exit_cancel_id: IdentifierReference | undefined,
    standalone: boolean,
    signal_expr?: Expression,
    signal_anchor?: string,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      inner.optional || inner.typeArguments != null ||
      inner.arguments.length < 2 ||
      inner.arguments.some((a) => a.type === "SpreadElement") ||
      !is_applicative_lift_fn(parentheses(inner.callee))
    ) return undefined;
    const fn_expr = inner.arguments[0] as Expression;
    if (lexical_hazard(fn_expr) || contains_await_yield(fn_expr)) {
      return undefined;
    }
    const raw_args = inner.arguments.slice(1) as Expression[];
    let saw_known_task = false;
    const kinds: TaskYieldKind[] = [];
    for (const arg of raw_args) {
      if (lexical_hazard(arg) || contains_await_yield(arg)) return undefined;
      const p = parentheses(arg);
      if (
        p.type === "CallExpression" && !p.optional &&
        (is_parallel_fn(parentheses(p.callee)) ||
          (p.callee.type === "MemberExpression" && !p.callee.computed &&
            !p.callee.optional && p.callee.property.type === "Identifier" &&
            p.callee.property.name === "pure" &&
            is_parallel_task_dict(p.callee.object)))
      ) return undefined;
      if (is_known_task_expr(p)) saw_known_task = true;
      const cls = classify_task_yield(p, false);
      if (cls === undefined) return undefined;
      kinds.push(cls);
    }
    if (!saw_known_task) return undefined;
    const builder = make_lift_builder(fn_expr, kinds.length);
    if (builder === undefined) return undefined;
    const anchor = signal_anchor ?? find_task_anchor();
    if (anchor === undefined) return undefined;
    let sig_id: IdentifierReference | undefined;
    let check_sig_id: IdentifierReference | undefined;
    let await_sig_id: IdentifierReference | undefined;
    let task_ctor: IdentifierReference | undefined;
    if (standalone || signal_expr !== undefined) {
      check_sig_id = services.import_from_module?.(
        anchor,
        "task",
        "task_check_signal",
      );
      await_sig_id = services.import_from_module?.(
        anchor,
        "task",
        "task_await_signal",
      );
      if (check_sig_id === undefined || await_sig_id === undefined) {
        return undefined;
      }
      sig_id = services.fresh("task_sig");
    }
    if (standalone) {
      task_ctor = resolve_task_dict(anchor);
      if (task_ctor === undefined) return undefined;
    }
    const body_stmts: Statement[] = [];
    const eager_stmts: Statement[] = [];
    if (builder.hoist_fn !== undefined) {
      if (!is_inline_fn_expr(builder.hoist_fn.expr)) {
        eager_stmts.push(
          variable(builder.hoist_fn.id, builder.hoist_fn.expr, "const"),
        );
      } else {
        body_stmts.push(
          variable(builder.hoist_fn.id, builder.hoist_fn.expr, "const"),
        );
      }
    }
    const hoisted_kinds: TaskYieldKind[] = kinds.map((cls) =>
      hoist_task_kind_eager(cls, eager_stmts, "task_e")
    );
    if (!standalone && sig_id !== undefined && signal_expr !== undefined) {
      if (eager_stmts.length > 0 || !is_const_literal_expr(signal_expr)) {
        eager_stmts.push(variable(sig_id, signal_expr, "const"));
      } else {
        body_stmts.push(variable(sig_id, signal_expr, "const"));
      }
    }
    if (sig_id !== undefined && check_sig_id !== undefined) {
      body_stmts.push(
        node({
          type: "ExpressionStatement",
          expression: call(check_sig_id, [
            sig_id,
            literal("Task Applicative.lift"),
          ]),
        }),
      );
    }
    const vals: IdentifierReference[] = [];
    for (const cls of hoisted_kinds) {
      const v_expr = emit_task_kind_expr(
        cls,
        body_stmts,
        sig_id,
        check_sig_id,
        await_sig_id,
        anchor,
      );
      if (v_expr === undefined) return undefined;
      const v_id = services.fresh("task_v");
      body_stmts.push(variable(v_id, v_expr, "const"));
      vals.push(v_id);
    }
    if (sig_id !== undefined && check_sig_id !== undefined) {
      body_stmts.push(
        node({
          type: "ExpressionStatement",
          expression: call(check_sig_id, [
            sig_id,
            literal("Task Applicative.lift"),
          ]),
        }),
      );
    }
    body_stmts.push(builder.emit_return(vals));
    if (standalone && task_ctor !== undefined) {
      const task_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [sig_id!],
        body: block(body_stmts),
        typeParameters: null,
        returnType: null,
      });
      const wrapped = call(task_ctor, [task_fn]);
      return {
        expression: eager_stmts.length > 0
          ? call(arrow([], block([...eager_stmts, ret(wrapped)])), [])
          : wrapped,
        direct: true,
      };
    }
    const final_body = exit_cancel_id !== undefined
      ? wrap_task_exit_stmts(body_stmts, exit_cancel_id)
      : body_stmts;
    const async_fn: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: [],
      body: block(final_body),
      typeParameters: null,
      returnType: null,
    });
    const async_call = call(async_fn, []);
    return {
      expression: eager_stmts.length > 0
        ? call(arrow([], block([...eager_stmts, ret(async_call)])), [])
        : async_call,
      direct: true,
    };
  }

  /** PPF-03: Fluent Task chain fusion (from_fn(...).map(...).bind(...)). */
  function task_fluent_chain_fusion(
    outer: CallExpression,
    exit_cancel_id: IdentifierReference | undefined,
    standalone: boolean,
    signal_expr?: Expression,
    signal_anchor?: string,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;
    type TaskChainStage = {
      readonly kind: "map" | "bind";
      readonly param_decl: Node | null;
      readonly body: Expression;
    };
    const stages_rev: TaskChainStage[] = [];
    let cursor: Expression = outer;
    while (true) {
      const cur = parentheses(cursor);
      if (
        cur.type === "CallExpression" && !cur.optional &&
        cur.typeArguments == null && cur.arguments.length === 1 &&
        cur.arguments[0].type !== "SpreadElement" &&
        cur.callee.type === "MemberExpression" && !cur.callee.computed &&
        !cur.callee.optional && cur.callee.property.type === "Identifier" &&
        (cur.callee.property.name === "map" ||
          cur.callee.property.name === "bind")
      ) {
        const parsed = extract_unary_arrow(cur.arguments[0] as Expression);
        if (parsed === undefined || parsed.call_ref !== undefined) {
          return undefined;
        }
        stages_rev.push({
          kind: cur.callee.property.name,
          param_decl: parsed.param_decl,
          body: parsed.body,
        });
        cursor = cur.callee.object;
        continue;
      }
      break;
    }
    if (stages_rev.length === 0) return undefined;
    const root_expr = parentheses(cursor);
    if (
      lexical_hazard(root_expr) || contains_await_yield(root_expr) ||
      !is_known_task_expr(root_expr)
    ) return undefined;
    const root_cls = classify_task_yield(root_expr, false);
    if (root_cls === undefined) return undefined;
    const anchor = signal_anchor ?? find_task_anchor();
    if (anchor === undefined) return undefined;
    let sig_id: IdentifierReference | undefined;
    let check_sig_id: IdentifierReference | undefined;
    let await_sig_id: IdentifierReference | undefined;
    let task_ctor: IdentifierReference | undefined;
    if (standalone || signal_expr !== undefined) {
      check_sig_id = services.import_from_module?.(
        anchor,
        "task",
        "task_check_signal",
      );
      await_sig_id = services.import_from_module?.(
        anchor,
        "task",
        "task_await_signal",
      );
      if (check_sig_id === undefined || await_sig_id === undefined) {
        return undefined;
      }
      sig_id = services.fresh("task_sig");
    }
    if (standalone) {
      task_ctor = resolve_task_dict(anchor);
      if (task_ctor === undefined) return undefined;
    }
    const body_stmts: Statement[] = [];
    const eager_stmts: Statement[] = [];
    const hoisted_root = hoist_task_kind_eager(root_cls, eager_stmts, "task_e");
    if (!standalone && sig_id !== undefined && signal_expr !== undefined) {
      if (eager_stmts.length > 0 || !is_const_literal_expr(signal_expr)) {
        eager_stmts.push(variable(sig_id, signal_expr, "const"));
      } else {
        body_stmts.push(variable(sig_id, signal_expr, "const"));
      }
    }
    const first_val = emit_task_kind_expr(
      hoisted_root,
      body_stmts,
      sig_id,
      check_sig_id,
      await_sig_id,
      anchor,
    );
    if (first_val === undefined) return undefined;
    let cur_var = services.fresh("task_v");
    body_stmts.push(variable(cur_var, first_val, "const"));
    const stages = stages_rev.reverse();
    for (const st of stages) {
      const inlined = st.param_decl !== null
        ? substitute_ident(st.body, st.param_decl, cur_var, services)
        : st.body;
      if (st.kind === "map") {
        if (sig_id !== undefined && check_sig_id !== undefined) {
          body_stmts.push(
            node({
              type: "ExpressionStatement",
              expression: call(check_sig_id, [sig_id, literal("Task.map")]),
            }),
          );
        }
        const next_var = services.fresh("task_v");
        body_stmts.push(variable(next_var, inlined, "const"));
        cur_var = next_var;
      } else {
        const next_cls = classify_task_yield(inlined, false);
        if (next_cls === undefined) return undefined;
        const next_val = emit_task_kind_expr(
          next_cls,
          body_stmts,
          sig_id,
          check_sig_id,
          await_sig_id,
          anchor,
        );
        if (next_val === undefined) return undefined;
        const next_var = services.fresh("task_v");
        body_stmts.push(variable(next_var, next_val, "const"));
        cur_var = next_var;
      }
    }
    body_stmts.push(ret(cur_var));
    if (standalone && task_ctor !== undefined) {
      const task_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [sig_id!],
        body: block(body_stmts),
        typeParameters: null,
        returnType: null,
      });
      const wrapped = call(task_ctor, [task_fn]);
      return {
        expression: eager_stmts.length > 0
          ? call(arrow([], block([...eager_stmts, ret(wrapped)])), [])
          : wrapped,
        direct: true,
      };
    }
    const final_body = exit_cancel_id !== undefined
      ? wrap_task_exit_stmts(body_stmts, exit_cancel_id)
      : body_stmts;
    const async_fn: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: [],
      body: block(final_body),
      typeParameters: null,
      returnType: null,
    });
    const async_call = call(async_fn, []);
    return {
      expression: eager_stmts.length > 0
        ? call(arrow([], block([...eager_stmts, ret(async_call)])), [])
        : async_call,
      direct: true,
    };
  }

  /** PPF-03: Bounded-concurrency traverse_task(inputs, concurrency, fn) fusion. */
  function task_traverse_task_fusion(
    inner: CallExpression,
    exit_cancel_id: IdentifierReference | undefined,
    signal_expr?: Expression,
    signal_anchor?: string,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      inner.optional || inner.typeArguments != null ||
      inner.arguments.length !== 3 ||
      inner.arguments.some((a) => a.type === "SpreadElement") ||
      !is_traverse_task_callee(parentheses(inner.callee))
    ) return undefined;
    const inputs_expr = inner.arguments[0] as Expression;
    const conc_expr = inner.arguments[1] as Expression;
    const fn_expr = inner.arguments[2] as Expression;
    if (
      lexical_hazard(inputs_expr) || contains_await_yield(inputs_expr) ||
      lexical_hazard(conc_expr) || contains_await_yield(conc_expr) ||
      lexical_hazard(fn_expr) || contains_await_yield(fn_expr)
    ) return undefined;
    const fn_unwrapped = unwrap(fn_expr);
    if (
      fn_unwrapped.type !== "ArrowFunctionExpression" ||
      fn_unwrapped.async || fn_unwrapped.generator ||
      fn_unwrapped.typeParameters != null ||
      fn_unwrapped.returnType != null ||
      fn_unwrapped.body.type === "BlockStatement" ||
      (fn_unwrapped.params.length !== 1 && fn_unwrapped.params.length !== 2)
    ) return undefined;
    const p0 = fn_unwrapped.params[0];
    if (
      p0.type !== "Identifier" || p0.optional || p0.typeAnnotation != null ||
      (p0.decorators !== undefined && p0.decorators.length > 0)
    ) return undefined;
    const p0_decl = services.bindings.resolve(p0);
    if (p0_decl === null) return undefined;
    let p1_decl: Node | null = null;
    if (fn_unwrapped.params.length === 2) {
      const p1 = fn_unwrapped.params[1];
      if (
        p1.type !== "Identifier" || p1.optional || p1.typeAnnotation != null ||
        (p1.decorators !== undefined && p1.decorators.length > 0)
      ) return undefined;
      p1_decl = services.bindings.resolve(p1);
      if (p1_decl === null) return undefined;
    }

    const item_id = services.fresh("tt_x");
    const idx_id = services.fresh("tt_i");
    let inlined_body = substitute_ident(
      fn_unwrapped.body as Expression,
      p0_decl,
      item_id,
      services,
    );
    if (p1_decl !== null) {
      inlined_body = substitute_ident(inlined_body, p1_decl, idx_id, services);
    }
    const cls = classify_task_yield(inlined_body, false);
    if (cls === undefined || (cls.kind !== "pure" && cls.kind !== "from_fn")) {
      return undefined;
    }
    if (cls.kind === "from_fn") {
      const cb = unwrap(cls.fn);
      if (
        cb.type !== "ArrowFunctionExpression" || cb.generator ||
        cb.params.length > 1
      ) return undefined;
    }
    if (
      !intrinsics_unshadowed(
        inner,
        cls.kind === "pure" ? ["Array", "Number", "RangeError"] : [
          "Array",
          "Number",
          "RangeError",
          "AbortController",
          "Promise",
          "AggregateError",
          "Symbol",
        ],
      )
    ) return undefined;

    const anchor = signal_anchor ?? find_task_anchor();
    if (anchor === undefined) return undefined;
    const check_sig_id = services.import_from_module?.(
      anchor,
      "task",
      "task_check_signal",
    );
    const await_sig_id = services.import_from_module?.(
      anchor,
      "task",
      "task_await_signal",
    );
    if (check_sig_id === undefined || await_sig_id === undefined) {
      return undefined;
    }

    const conc_id = services.fresh("tt_conc");
    const src_id = services.fresh("tt_src");
    const out_id = services.fresh("tt_out");
    const parent_sig_id = signal_expr !== undefined
      ? services.fresh("tt_psig")
      : undefined;

    // Validate concurrency synchronously before returning Promise (matches runtime traverse_task)
    const validate_conc: Statement = node({
      type: "IfStatement",
      test: node({
        type: "LogicalExpression",
        operator: "||",
        left: negate_expr(call(member(id("Number"), "isInteger"), [conc_id])),
        right: node({
          type: "BinaryExpression",
          operator: "<",
          left: conc_id,
          right: literal(1),
        }),
      }),
      consequent: node({
        type: "ThrowStatement",
        argument: node({
          type: "NewExpression",
          callee: id("RangeError"),
          arguments: [
            literal("Task traversal concurrency must be a positive integer"),
          ],
        }),
      }),
      alternate: null,
    });

    const async_body: Statement[] = [];
    if (parent_sig_id !== undefined) {
      async_body.push(
        node({
          type: "ExpressionStatement",
          expression: call(check_sig_id, [
            parent_sig_id,
            literal("Task.traverse"),
          ]),
        }),
      );
    }

    const elem_alias_id = services.fresh("TTItem");
    const elem_alias_decl: Statement = node({
      type: "TSTypeAliasDeclaration",
      id: elem_alias_id,
      typeParameters: null,
      declare: false,
      typeAnnotation: node({
        type: "TSConditionalType",
        checkType: node({
          type: "TSTypeQuery",
          exprName: src_id,
          typeArguments: null,
        }),
        extendsType: node({
          type: "TSTypeReference",
          typeName: id("Iterable"),
          typeArguments: node({
            type: "TSTypeParameterInstantiation",
            params: Array.from<TSType>([
              node({
                type: "TSInferType",
                typeParameter: node({
                  type: "TSTypeParameter",
                  name: id("T"),
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
          typeName: id("T"),
          typeArguments: null,
        }),
        falseType: node({ type: "TSNeverKeyword" }),
      }),
    });
    const elem_var_type: TSType = node({
      type: "TSTypeReference",
      typeName: elem_alias_id,
      typeArguments: null,
    });
    const iterable_src_expr: Expression = node({
      type: "TSAsExpression",
      expression: src_id,
      typeAnnotation: node({
        type: "TSTypeReference",
        typeName: id("Iterable"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([elem_var_type]),
        }),
      }),
    });

    if (cls.kind === "pure") {
      const step_stmts: Statement[] = [];
      const val_expr = emit_task_kind_expr(
        cls,
        step_stmts,
        parent_sig_id,
        check_sig_id,
        await_sig_id,
        anchor,
      );
      if (val_expr === undefined) return undefined;
      const arr_loop: Statement[] = [
        variable(idx_id, literal(0), "let"),
        node({
          type: "ForStatement",
          init: null,
          test: node({
            type: "BinaryExpression",
            operator: "<",
            left: idx_id,
            right: member(src_id, "length"),
          }),
          update: node({
            type: "AssignmentExpression",
            operator: "+=",
            left: idx_id,
            right: literal(1),
          }),
          body: block([
            variable(
              item_id,
              node({
                type: "MemberExpression",
                object: src_id,
                property: idx_id,
                computed: true,
                optional: false,
              }),
              "const",
            ),
            ...step_stmts,
            node({
              type: "ExpressionStatement",
              expression: call(member(out_id, "push"), [val_expr]),
            }),
          ]),
        }),
      ];
      const iter_loop: Statement[] = [
        variable(idx_id, literal(0), "let"),
        node({
          type: "ForOfStatement",
          await: false,
          left: node({
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              node({ type: "VariableDeclarator", id: item_id, init: null }),
            ],
          }),
          right: iterable_src_expr,
          body: block([
            ...step_stmts,
            node({
              type: "ExpressionStatement",
              expression: call(member(out_id, "push"), [val_expr]),
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "+=",
                left: idx_id,
                right: literal(1),
              }),
            }),
          ]),
        }),
      ];
      async_body.push(
        variable(
          out_id,
          node({ type: "ArrayExpression", elements: Array.from([]) }),
          "const",
        ),
        node({
          type: "IfStatement",
          test: call(member(id("Array"), "isArray"), [src_id]),
          consequent: block(arr_loop),
          alternate: block(iter_loop),
        }),
        ret(out_id),
      );
    } else {
      // Bounded worker pool for from_fn
      const ctrl_id = services.fresh("tt_ctrl");
      const sig_id = services.fresh("tt_sig");
      const next_id = services.fresh("tt_next");
      const failed_id = services.fresh("tt_failed");
      const failure_id = services.fresh("tt_fail");
      const done_id = services.fresh("tt_done");
      const is_arr_id = services.fresh("tt_is_arr");
      const it_id = services.fresh("tt_it");
      const step_id = services.fresh("tt_step");
      const worker_id = services.fresh("tt_worker");
      const workers_id = services.fresh("tt_ws");
      const wi_id = services.fresh("tt_wi");
      const err_id = services.fresh("tt_err");
      const on_abort_id = services.fresh("tt_abort");

      const step_stmts: Statement[] = [];
      const val_expr = emit_task_kind_expr(
        cls,
        step_stmts,
        sig_id,
        check_sig_id,
        await_sig_id,
        anchor,
      );
      if (val_expr === undefined) return undefined;

      const val_tmp = services.fresh("tt_v");
      const out_param_id = services.fresh("tt_buf");
      const run_item_stmts: Statement[] = [
        ...step_stmts,
        variable(val_tmp, val_expr, "const"),
        node({
          type: "ExpressionStatement",
          expression: node({
            type: "AssignmentExpression",
            operator: "=",
            left: node({
              type: "MemberExpression",
              object: out_param_id,
              property: idx_id,
              computed: true,
              optional: false,
            }),
            right: val_tmp,
          }),
        }),
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: "<",
            left: next_id,
            right: literal(0),
          }),
          consequent: ret(
            as_const(
              node({ type: "ArrayExpression", elements: [val_tmp] }),
            ),
          ),
          alternate: null,
        }),
      ];

      const worker_loop_body: Statement[] = [
        node({
          type: "IfStatement",
          test: node({
            type: "LogicalExpression",
            operator: "||",
            left: failed_id,
            right: member(sig_id, "aborted"),
          }),
          consequent: ret(void_zero()),
          alternate: null,
        }),
        node({
          type: "VariableDeclaration",
          kind: "let",
          declarations: [
            node({
              type: "VariableDeclarator",
              id: {
                ...item_id,
                typeAnnotation: node({
                  type: "TSTypeAnnotation",
                  typeAnnotation: elem_var_type,
                }),
              } as BindingPattern,
              init: null,
            }),
          ],
        }),
        node({
          type: "VariableDeclaration",
          kind: "let",
          declarations: [
            node({
              type: "VariableDeclarator",
              id: {
                ...idx_id,
                typeAnnotation: node({
                  type: "TSTypeAnnotation",
                  typeAnnotation: node({ type: "TSNumberKeyword" }),
                }),
              } as BindingPattern,
              init: null,
            }),
          ],
        }),
        node({
          type: "IfStatement",
          test: is_arr_id,
          consequent: block([
            node({
              type: "IfStatement",
              test: node({
                type: "BinaryExpression",
                operator: ">=",
                left: next_id,
                right: member(
                  node({
                    type: "TSAsExpression",
                    expression: src_id,
                    typeAnnotation: node({
                      type: "TSArrayType",
                      elementType: elem_var_type,
                    }),
                  }),
                  "length",
                ),
              }),
              consequent: block([
                node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "AssignmentExpression",
                    operator: "=",
                    left: done_id,
                    right: literal(true),
                  }),
                }),
                ret(void_zero()),
              ]),
              alternate: null,
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: idx_id,
                right: node({
                  type: "UpdateExpression",
                  operator: "++",
                  prefix: false,
                  argument: next_id,
                }),
              }),
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: item_id,
                right: node({
                  type: "MemberExpression",
                  object: node({
                    type: "TSAsExpression",
                    expression: src_id,
                    typeAnnotation: node({
                      type: "TSArrayType",
                      elementType: elem_var_type,
                    }),
                  }),
                  property: idx_id,
                  computed: true,
                  optional: false,
                }),
              }),
            }),
          ]),
          alternate: block([
            variable(
              step_id,
              call(
                member(
                  node({ type: "TSNonNullExpression", expression: it_id }),
                  "next",
                ),
                [],
              ),
              "const",
            ),
            node({
              type: "IfStatement",
              test: member(step_id, "done"),
              consequent: block([
                node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "AssignmentExpression",
                    operator: "=",
                    left: done_id,
                    right: literal(true),
                  }),
                }),
                ret(void_zero()),
              ]),
              alternate: null,
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: idx_id,
                right: node({
                  type: "UpdateExpression",
                  operator: "++",
                  prefix: false,
                  argument: next_id,
                }),
              }),
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: item_id,
                right: member(step_id, "value"),
              }),
            }),
          ]),
        }),
        ...run_item_stmts,
      ];

      const worker_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [
          {
            ...out_param_id,
            typeAnnotation: node({
              type: "TSTypeAnnotation",
              typeAnnotation: node({
                type: "TSArrayType",
                elementType: node({ type: "TSUnknownKeyword" }),
              }),
            }),
          } as BindingPattern,
        ],
        body: block([
          node({
            type: "WhileStatement",
            test: literal(true),
            body: block([
              node({
                type: "TryStatement",
                block: block(worker_loop_body),
                handler: node({
                  type: "CatchClause",
                  param: err_id,
                  body: block([
                    node({
                      type: "IfStatement",
                      test: negate_expr(failed_id),
                      consequent: block([
                        node({
                          type: "ExpressionStatement",
                          expression: node({
                            type: "AssignmentExpression",
                            operator: "=",
                            left: failed_id,
                            right: literal(true),
                          }),
                        }),
                        node({
                          type: "ExpressionStatement",
                          expression: node({
                            type: "AssignmentExpression",
                            operator: "=",
                            left: failure_id,
                            right: err_id,
                          }),
                        }),
                        node({
                          type: "ExpressionStatement",
                          expression: call(member(ctrl_id, "abort"), [err_id]),
                        }),
                      ]),
                      alternate: null,
                    }),
                    ret(void_zero()),
                  ]),
                }),
                finalizer: null,
              }),
            ]),
          }),
        ]),
        typeParameters: null,
        returnType: null,
      });

      const catch_err = services.fresh("tt_ce");
      const clean_err = services.fresh("tt_cl");
      const sym_iter: Expression = node({
        type: "MemberExpression",
        object: iterable_src_expr,
        property: member(id("Symbol"), "iterator"),
        computed: true,
        optional: false,
      });
      const infer_r = services.fresh("TTR");
      const infer_v = services.fresh("TTV");
      const out_arr_type: TSType = node({
        type: "TSArrayType",
        elementType: node({
          type: "TSParenthesizedType",
          typeAnnotation: node({
            type: "TSConditionalType",
            checkType: node({
              type: "TSTypeQuery",
              exprName: worker_id,
              typeArguments: null,
            }),
            extendsType: node({
              type: "TSFunctionType",
              typeParameters: null,
              params: [
                node({
                  type: "RestElement",
                  argument: id("args"),
                  typeAnnotation: node({
                    type: "TSTypeAnnotation",
                    typeAnnotation: node({
                      type: "TSArrayType",
                      elementType: node({ type: "TSNeverKeyword" }),
                    }),
                  }),
                }) as unknown as BindingPattern,
              ],
              returnType: node({
                type: "TSTypeAnnotation",
                typeAnnotation: node({
                  type: "TSTypeLiteral",
                  members: Array.from([
                    node({
                      type: "TSMethodSignature",
                      key: id("then"),
                      computed: false,
                      optional: false,
                      readonly: false,
                      static: false,
                      accessibility: null,
                      kind: "method",
                      params: [
                        {
                          ...id("onfulfilled"),
                          typeAnnotation: node({
                            type: "TSTypeAnnotation",
                            typeAnnotation: node({
                              type: "TSFunctionType",
                              typeParameters: null,
                              params: Array.from<BindingPattern>([
                                {
                                  ...id("value"),
                                  typeAnnotation: node({
                                    type: "TSTypeAnnotation",
                                    typeAnnotation: node({
                                      type: "TSInferType",
                                      typeParameter: node({
                                        type: "TSTypeParameter",
                                        name: infer_r,
                                        constraint: null,
                                        default: null,
                                        in: false,
                                        out: false,
                                        const: false,
                                      }),
                                    }),
                                  }),
                                } as BindingPattern,
                              ]),
                              returnType: node({
                                type: "TSTypeAnnotation",
                                typeAnnotation: node({
                                  type: "TSUnknownKeyword",
                                }),
                              }),
                            }),
                          }),
                        } as BindingPattern,
                      ],
                      typeParameters: null,
                      returnType: node({
                        type: "TSTypeAnnotation",
                        typeAnnotation: node({ type: "TSUnknownKeyword" }),
                      }),
                    }),
                  ]),
                }),
              }),
            }),
            trueType: node({
              type: "TSConditionalType",
              checkType: node({
                type: "TSTypeReference",
                typeName: infer_r,
                typeArguments: null,
              }),
              extendsType: node({
                type: "TSTypeOperator",
                operator: "readonly",
                typeAnnotation: node({
                  type: "TSTupleType",
                  elementTypes: Array.from<TSType>([
                    node({
                      type: "TSInferType",
                      typeParameter: node({
                        type: "TSTypeParameter",
                        name: infer_v,
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
                typeName: infer_v,
                typeArguments: null,
              }),
              falseType: node({ type: "TSNeverKeyword" }),
            }),
            falseType: node({ type: "TSNeverKeyword" }),
          }),
        }),
      });
      const out_arr_init: Expression = node({
        type: "ConditionalExpression",
        test: is_arr_id,
        consequent: node({
          type: "NewExpression",
          callee: id("Array"),
          arguments: [
            member(
              node({
                type: "TSAsExpression",
                expression: src_id,
                typeAnnotation: node({
                  type: "TSArrayType",
                  elementType: elem_var_type,
                }),
              }),
              "length",
            ),
          ],
        }),
        alternate: node({ type: "ArrayExpression", elements: Array.from([]) }),
      });

      async_body.push(
        variable(
          ctrl_id,
          node({
            type: "NewExpression",
            callee: id("AbortController"),
            arguments: [],
          }),
          "const",
        ),
        variable(sig_id, member(ctrl_id, "signal"), "const"),
        variable(
          is_arr_id,
          call(member(id("Array"), "isArray"), [src_id]),
          "const",
        ),
        variable(
          it_id,
          node({
            type: "ConditionalExpression",
            test: is_arr_id,
            consequent: void_zero(),
            alternate: call(sym_iter, []),
          }),
          "const",
        ),
        variable(next_id, literal(0), "let"),
        variable(failed_id, literal(false), "let"),
        variable(
          failure_id,
          void_zero(),
          "let",
          node({ type: "TSUnknownKeyword" }),
        ),
        variable(done_id, literal(false), "let"),
      );
      if (parent_sig_id !== undefined) {
        async_body.push(
          variable(
            on_abort_id,
            arrow(
              [],
              call(member(ctrl_id, "abort"), [
                node({
                  type: "ChainExpression",
                  expression: node({
                    type: "MemberExpression",
                    object: parent_sig_id,
                    property: id("reason"),
                    computed: false,
                    optional: true,
                  }),
                }),
              ]),
            ),
            "const",
          ),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "!==",
              left: parent_sig_id,
              right: void_zero(),
            }),
            consequent: node({
              type: "ExpressionStatement",
              expression: call(member(parent_sig_id, "addEventListener"), [
                literal("abort"),
                on_abort_id,
                node({
                  type: "ObjectExpression",
                  properties: [
                    node({
                      type: "Property",
                      kind: "init",
                      key: id("once"),
                      value: literal(true),
                      method: false,
                      shorthand: false,
                      computed: false,
                    }),
                  ],
                }),
              ]),
            }),
            alternate: null,
          }),
        );
      }
      async_body.push(
        variable(worker_id, worker_fn, "const"),
        variable(out_id, out_arr_init, "const", out_arr_type),
        node({
          type: "TryStatement",
          block: block([
            variable(
              workers_id,
              node({ type: "ArrayExpression", elements: Array.from([]) }),
              "const",
            ),
            node({
              type: "ForStatement",
              init: variable(wi_id, literal(0), "let"),
              test: node({
                type: "LogicalExpression",
                operator: "&&",
                left: node({
                  type: "LogicalExpression",
                  operator: "&&",
                  left: node({
                    type: "BinaryExpression",
                    operator: "<",
                    left: wi_id,
                    right: conc_id,
                  }),
                  right: negate_expr(done_id),
                }),
                right: negate_expr(failed_id),
              }),
              update: node({
                type: "AssignmentExpression",
                operator: "+=",
                left: wi_id,
                right: literal(1),
              }),
              body: node({
                type: "ExpressionStatement",
                expression: call(member(workers_id, "push"), [
                  call(worker_id, [out_id]),
                ]),
              }),
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AwaitExpression",
                argument: call(member(id("Promise"), "all"), [workers_id]),
              }),
            }),
            node({
              type: "IfStatement",
              test: failed_id,
              consequent: node({
                type: "ThrowStatement",
                argument: failure_id,
              }),
              alternate: null,
            }),
            node({
              type: "IfStatement",
              test: member(sig_id, "aborted"),
              consequent: node({
                type: "ExpressionStatement",
                expression: call(check_sig_id, [
                  sig_id,
                  literal("Task.traverse"),
                ]),
              }),
              alternate: null,
            }),
            node({
              type: "IfStatement",
              test: node({
                type: "BinaryExpression",
                operator: "!==",
                left: member(out_id, "length"),
                right: next_id,
              }),
              consequent: node({
                type: "ExpressionStatement",
                expression: node({
                  type: "AssignmentExpression",
                  operator: "=",
                  left: member(out_id, "length"),
                  right: next_id,
                }),
              }),
              alternate: null,
            }),
            ret(out_id),
          ]),
          handler: node({
            type: "CatchClause",
            param: catch_err,
            body: block([
              node({
                type: "IfStatement",
                test: node({
                  type: "LogicalExpression",
                  operator: "&&",
                  left: negate_expr(done_id),
                  right: node({
                    type: "BinaryExpression",
                    operator: "!==",
                    left: it_id,
                    right: void_zero(),
                  }),
                }),
                consequent: block([
                  node({
                    type: "ExpressionStatement",
                    expression: node({
                      type: "AssignmentExpression",
                      operator: "=",
                      left: done_id,
                      right: literal(true),
                    }),
                  }),
                  node({
                    type: "TryStatement",
                    block: block([
                      node({
                        type: "ExpressionStatement",
                        expression: node({
                          type: "ChainExpression",
                          expression: node({
                            type: "CallExpression",
                            callee: member(it_id, "return"),
                            arguments: [],
                            optional: true,
                          }),
                        }),
                      }),
                    ]),
                    handler: node({
                      type: "CatchClause",
                      param: clean_err,
                      body: block([
                        node({
                          type: "ThrowStatement",
                          argument: node({
                            type: "NewExpression",
                            callee: id("AggregateError"),
                            arguments: [
                              node({
                                type: "ArrayExpression",
                                elements: [catch_err, clean_err],
                              }),
                              literal(
                                "Task traversal and iterator cleanup both failed",
                              ),
                            ],
                          }),
                        }),
                      ]),
                    }),
                    finalizer: null,
                  }),
                ]),
                alternate: null,
              }),
              node({ type: "ThrowStatement", argument: catch_err }),
            ]),
          }),
          finalizer: block([
            ...(parent_sig_id !== undefined
              ? [
                node({
                  type: "IfStatement",
                  test: node({
                    type: "BinaryExpression",
                    operator: "!==",
                    left: parent_sig_id,
                    right: void_zero(),
                  }),
                  consequent: node({
                    type: "ExpressionStatement",
                    expression: call(
                      member(parent_sig_id, "removeEventListener"),
                      [literal("abort"), on_abort_id],
                    ),
                  }),
                  alternate: null,
                }),
              ]
              : []),
            node({
              type: "IfStatement",
              test: node({
                type: "LogicalExpression",
                operator: "&&",
                left: negate_expr(done_id),
                right: node({
                  type: "BinaryExpression",
                  operator: "!==",
                  left: it_id,
                  right: void_zero(),
                }),
              }),
              consequent: block([
                node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "AssignmentExpression",
                    operator: "=",
                    left: done_id,
                    right: literal(true),
                  }),
                }),
                node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "ChainExpression",
                    expression: node({
                      type: "CallExpression",
                      callee: member(it_id, "return"),
                      arguments: [],
                      optional: true,
                    }),
                  }),
                }),
              ]),
              alternate: null,
            }),
          ]),
        }),
      );
    }

    const final_async_body = exit_cancel_id !== undefined
      ? wrap_task_exit_stmts(async_body, exit_cancel_id)
      : async_body;
    const inner_async: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: [],
      body: block(final_async_body),
      typeParameters: null,
      returnType: null,
    });
    const outer_stmts: Statement[] = [
      variable(src_id, inputs_expr, "const"),
      elem_alias_decl,
      variable(conc_id, conc_expr, "const"),
      validate_conc,
      ...(parent_sig_id !== undefined && signal_expr !== undefined
        ? [variable(parent_sig_id, signal_expr, "const")]
        : []),
      ret(call(inner_async, [])),
    ];
    return {
      expression: call(arrow([], block(outer_stmts)), []),
      direct: true,
    };
  }

  // =========================================================================
  // P1 + Q2b + Q3: Direct async lowering for immediate Task runs:
  //   run_task / run_task_exit (Do(Task, ...))
  //   Do(Task, ...).run()
  //   run_task / run_task_exit (Program(...)) (known Task lifts/primitives)
  //   run_task / run_task_exit (Traversable.traverse(ArrayT(xs), Task, fn))
  //   run_task / run_task_exit (ArrayT(xs).traverse(Task, fn))
  //   run_task / run_task_exit (traverse_sequential(xs, Task, fn))
  // =========================================================================
  function task_traverse_fusion(
    inner: CallExpression,
    exit_cancel_id: IdentifierReference | undefined,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      inner.optional || inner.typeArguments != null ||
      inner.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    const inner_callee = parentheses(inner.callee);
    let items_expr: Expression | undefined;
    let array_ctor: IdentifierReference | undefined;
    let fn_expr: Expression | undefined;
    let is_sequential = false;

    if (
      inner.arguments.length === 3 &&
      inner_callee.type === "MemberExpression" && !inner_callee.computed &&
      !inner_callee.optional && inner_callee.property.type === "Identifier" &&
      inner_callee.property.name === "traverse" &&
      is_traversable_obj(parentheses(inner_callee.object))
    ) {
      const arr = unwrap_array_t(inner.arguments[0] as Expression);
      if (
        arr !== undefined &&
        is_task_dict(parentheses(inner.arguments[1] as Expression))
      ) {
        items_expr = arr.items;
        array_ctor = arr.array_ctor;
        fn_expr = inner.arguments[2] as Expression;
      }
    } else if (
      inner.arguments.length === 2 &&
      inner_callee.type === "MemberExpression" && !inner_callee.computed &&
      !inner_callee.optional && inner_callee.property.type === "Identifier" &&
      inner_callee.property.name === "traverse"
    ) {
      const arr = unwrap_array_t(inner_callee.object);
      if (
        arr !== undefined &&
        is_task_dict(parentheses(inner.arguments[0] as Expression))
      ) {
        items_expr = arr.items;
        array_ctor = arr.array_ctor;
        fn_expr = inner.arguments[1] as Expression;
      }
    } else if (
      inner.arguments.length === 3 && is_traverse_seq_callee(inner_callee)
    ) {
      if (is_task_dict(parentheses(inner.arguments[1] as Expression))) {
        items_expr = inner.arguments[0] as Expression;
        fn_expr = inner.arguments[2] as Expression;
        is_sequential = true;
      }
    }

    if (items_expr === undefined || fn_expr === undefined) return undefined;
    if (!intrinsics_unshadowed(inner, ["Array"])) return undefined;
    if (
      lexical_hazard(items_expr) || contains_await_yield(items_expr) ||
      lexical_hazard(fn_expr) || contains_await_yield(fn_expr)
    ) return undefined;

    const src_id = services.fresh("trav_src");
    const len_id = services.fresh("trav_len");
    const idx_id = services.fresh("trav_i");
    const item_id = services.fresh("trav_x");
    const first_val_id = services.fresh("trav_v0");
    const out_id = services.fresh("trav_out");

    const fn_unwrapped = unwrap(fn_expr);
    let inlined_body: Expression | undefined;
    let classified: TaskYieldKind | undefined;
    if (
      fn_unwrapped.type === "ArrowFunctionExpression" &&
      !fn_unwrapped.async && !fn_unwrapped.generator &&
      fn_unwrapped.typeParameters == null && fn_unwrapped.returnType == null &&
      fn_unwrapped.body.type !== "BlockStatement" &&
      fn_unwrapped.params.length === 1 &&
      fn_unwrapped.params[0].type === "Identifier" &&
      !fn_unwrapped.params[0].optional &&
      fn_unwrapped.params[0].typeAnnotation == null &&
      (fn_unwrapped.params[0].decorators === undefined ||
        fn_unwrapped.params[0].decorators.length === 0)
    ) {
      const param_decl = services.bindings.resolve(fn_unwrapped.params[0]);
      if (param_decl !== null) {
        inlined_body = substitute_ident(
          fn_unwrapped.body as Expression,
          param_decl,
          item_id,
          services,
        );
        classified = classify_task_yield(inlined_body, false);
      }
    }

    // For Traversable.traverse (eager task construction), only inline deferred task
    // constructors (`from_fn`, `Task`) with inline functions or pure `succeed`/`Task.pure`
    // so no side-effects in fn(item) are reordered relative to task execution.
    if (!is_sequential) {
      if (
        classified === undefined ||
        classified.kind === "arbitrary" ||
        classified.kind === "from_promise" ||
        classified.kind === "throw_error" ||
        classified.kind === "catch_error" ||
        (classified.kind === "pure" && !is_pure_no_call(classified.value)) ||
        ((classified.kind === "from_fn" || classified.kind === "task_ctor") &&
          !is_inline_fn_expr(classified.fn))
      ) return undefined;
    } else if (
      classified !== undefined &&
      (classified.kind === "from_promise" ||
        classified.kind === "throw_error" ||
        classified.kind === "catch_error")
    ) {
      classified = { kind: "arbitrary", expr: inlined_body! };
    }

    let fn_id: IdentifierReference | undefined;
    let hoisted_fn_expr: Expression | undefined;
    if (inlined_body === undefined) {
      let annotated_fn = fn_expr;
      if (
        (fn_unwrapped.type === "ArrowFunctionExpression" ||
          fn_unwrapped.type === "FunctionExpression") &&
        fn_unwrapped.params.length >= 1
      ) {
        const p0 = fn_unwrapped.params[0];
        if (p0.type === "Identifier" && p0.typeAnnotation == null) {
          annotated_fn = {
            ...fn_unwrapped,
            params: [
              {
                ...p0,
                typeAnnotation: node({
                  type: "TSTypeAnnotation",
                  typeAnnotation: node({
                    type: "TSIndexedAccessType",
                    objectType: node({
                      type: "TSTypeQuery",
                      exprName: src_id,
                      typeArguments: null,
                    }),
                    indexType: node({ type: "TSNumberKeyword" }),
                  }),
                }),
              },
              ...fn_unwrapped.params.slice(1),
            ],
          };
        } else if (
          p0.type !== "Identifier" && p0.type !== "TSParameterProperty" &&
          p0.typeAnnotation == null
        ) {
          return undefined;
        }
      }
      fn_id = services.fresh("trav_fn");
      hoisted_fn_expr = annotated_fn;
    }

    const emit_task_step = (
      emit_value: (val: Expression) => Statement,
    ): Statement[] => {
      const step_stmts: Statement[] = [];
      let val_expr: Expression;
      if (classified !== undefined) {
        switch (classified.kind) {
          case "pure":
            val_expr = classified.value;
            break;
          case "from_fn": {
            const cb = unwrap(classified.fn);
            if (
              cb.type === "ArrowFunctionExpression" && !cb.generator &&
              cb.typeParameters == null && cb.returnType == null &&
              cb.params.length === 0 && cb.body.type !== "BlockStatement"
            ) {
              const inner_body = cb.body as Expression;
              if (!cb.async && is_sync_non_thenable(inner_body)) {
                val_expr = inner_body;
              } else if (!cb.async) {
                const raw_id = services.fresh("task_raw");
                step_stmts.push(variable(raw_id, inner_body, "const"));
                val_expr = await_if_thenable_expr(raw_id);
              } else {
                val_expr = node({
                  type: "AwaitExpression",
                  argument: inner_body,
                });
              }
            } else if (
              cb.type === "ArrowFunctionExpression" && !cb.generator &&
              cb.params.length === 0
            ) {
              val_expr = node({
                type: "AwaitExpression",
                argument: call(cb, []),
              });
            } else {
              val_expr = node({
                type: "AwaitExpression",
                argument: call(classified.fn, [void_zero()]),
              });
            }
            break;
          }
          case "task_ctor": {
            const cb = unwrap(classified.fn);
            if (
              cb.type === "ArrowFunctionExpression" && !cb.generator &&
              cb.typeParameters == null && cb.returnType == null &&
              cb.params.length === 0 && cb.body.type !== "BlockStatement"
            ) {
              val_expr = node({
                type: "AwaitExpression",
                argument: cb.body as Expression,
              });
            } else {
              val_expr = node({
                type: "AwaitExpression",
                argument: call(classified.fn, [void_zero()]),
              });
            }
            break;
          }
          case "arbitrary":
          default:
            val_expr = node({
              type: "AwaitExpression",
              argument: call(
                call(
                  member(
                    classified.kind === "arbitrary"
                      ? classified.expr
                      : inlined_body!,
                    "value",
                  ),
                  [],
                ),
                [],
              ),
            });
            break;
        }
      } else {
        val_expr = node({
          type: "AwaitExpression",
          argument: call(
            call(member(call(fn_id!, [item_id]), "value"), []),
            [],
          ),
        });
      }
      step_stmts.push(emit_value(val_expr));
      return step_stmts;
    };

    const wrap_collection = (arr_expr: Expression): Expression =>
      array_ctor !== undefined ? call(array_ctor, [arr_expr]) : arr_expr;
    const elem_access: Expression = node({
      type: "MemberExpression",
      object: src_id,
      property: idx_id,
      computed: true,
      optional: false,
    });
    const out_set = (index_expr: Expression, val: Expression): Statement =>
      node({
        type: "ExpressionStatement",
        expression: node({
          type: "AssignmentExpression",
          operator: "=",
          left: node({
            type: "MemberExpression",
            object: out_id,
            property: index_expr,
            computed: true,
            optional: false,
          }),
          right: val,
        }),
      });
    const zero_idx = literal(0);
    const first_stmts = emit_task_step((val) =>
      variable(first_val_id, val, "const")
    );
    const loop_stmts = emit_task_step((val) => out_set(idx_id, val));
    const new_arr: Expression = node({
      type: "NewExpression",
      callee: id("Array"),
      typeArguments: node({
        type: "TSTypeParameterInstantiation",
        params: Array.from<TSType>([
          node({
            type: "TSTypeQuery",
            exprName: first_val_id,
            typeArguments: null,
          }),
        ]),
      }),
      arguments: [len_id],
    });

    // Preserve sync throw semantics for run_task_exit argument evaluation:
    // pass non-pure items_expr as an eager parameter to the outer async IIFE.
    const pass_src_as_param = exit_cancel_id !== undefined &&
      !is_pure_no_call(items_expr);
    const iife_params: IdentifierReference[] = [];
    const iife_args: Expression[] = [];
    const body_stmts: Statement[] = [];
    if (pass_src_as_param) {
      iife_params.push(src_id);
      iife_args.push(items_expr);
    } else {
      body_stmts.push(variable(src_id, items_expr, "const"));
    }
    if (fn_id !== undefined && hoisted_fn_expr !== undefined) {
      if (exit_cancel_id !== undefined && !is_pure_no_call(hoisted_fn_expr)) {
        iife_params.push(fn_id);
        iife_args.push(hoisted_fn_expr);
      } else {
        body_stmts.push(variable(fn_id, hoisted_fn_expr, "const"));
      }
    }
    body_stmts.push(
      variable(len_id, member(src_id, "length"), "const"),
      node({
        type: "IfStatement",
        test: node({
          type: "BinaryExpression",
          operator: "===",
          left: len_id,
          right: zero_idx,
        }),
        consequent: ret(
          node({
            type: "TSAsExpression",
            expression: wrap_collection(
              node({ type: "ArrayExpression", elements: Array.from([]) }),
            ),
            typeAnnotation: node({ type: "TSNeverKeyword" }),
          }),
        ),
        alternate: null,
      }),
      variable(idx_id, zero_idx, "let"),
      variable(item_id, elem_access, "const"),
      ...first_stmts,
      variable(out_id, new_arr, "const"),
      out_set(zero_idx, first_val_id),
      node({
        type: "ForStatement",
        init: node({
          type: "AssignmentExpression",
          operator: "=",
          left: idx_id,
          right: literal(1),
        }),
        test: node({
          type: "BinaryExpression",
          operator: "<",
          left: idx_id,
          right: len_id,
        }),
        update: node({
          type: "AssignmentExpression",
          operator: "+=",
          left: idx_id,
          right: literal(1),
        }),
        body: block([
          variable(item_id, elem_access, "const"),
          ...loop_stmts,
        ]),
      }),
      ret(wrap_collection(out_id)),
    );

    const final_body = exit_cancel_id !== undefined
      ? wrap_task_exit_stmts(body_stmts, exit_cancel_id)
      : body_stmts;
    const async_fn: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: iife_params,
      body: block(final_body),
      typeParameters: null,
      returnType: null,
    });
    return { expression: call(async_fn, iife_args), direct: true };
  }

  function task_terminal_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    let gen_call: CallExpression | undefined;
    let program_mode = false;
    let exit_cancel_id: IdentifierReference | undefined;
    let signal_expr: Expression | undefined;
    let signal_anchor: string | undefined;
    const callee = parentheses(outer.callee);
    const arg_len = outer.arguments.length;
    const is_run_t = is_run_task_callee(callee);
    const exit_anchor = (arg_len === 1 || arg_len === 2)
      ? run_task_exit_anchor(callee)
      : undefined;
    if (
      (arg_len === 1 || arg_len === 2) &&
      (is_run_t || exit_anchor !== undefined)
    ) {
      if (arg_len === 2) {
        const opts = parentheses(outer.arguments[1] as Expression);
        if (
          opts.type !== "ObjectExpression" || opts.properties.length !== 1 ||
          opts.properties[0].type !== "Property" ||
          opts.properties[0].kind !== "init" || opts.properties[0].computed ||
          opts.properties[0].method
        ) return undefined;
        const prop = opts.properties[0];
        const key_name = prop.key.type === "Identifier"
          ? prop.key.name
          : prop.key.type === "Literal" && typeof prop.key.value === "string"
          ? prop.key.value
          : undefined;
        if (key_name !== "signal") return undefined;
        const sig_val = prop.value as Expression;
        if (lexical_hazard(sig_val) || contains_await_yield(sig_val)) {
          return undefined;
        }
        signal_expr = sig_val;
        signal_anchor = exit_anchor ?? run_task_anchor(callee);
        if (signal_anchor === undefined) return undefined;
      }
      if (exit_anchor !== undefined) {
        exit_cancel_id = resolve_is_task_cancellation(exit_anchor);
        if (exit_cancel_id === undefined) return undefined;
      }
      const inner = parentheses(outer.arguments[0] as Expression);
      if (
        inner.type === "CallExpression" && !inner.optional &&
        inner.typeArguments == null
      ) {
        const par = parallel_task_fusion(
          inner,
          exit_cancel_id,
          "none",
          signal_expr,
          signal_anchor,
        );
        if (par !== undefined) return par;
        const tt = task_traverse_task_fusion(
          inner,
          exit_cancel_id,
          signal_expr,
          signal_anchor,
        );
        if (tt !== undefined) return tt;
        if (signal_expr === undefined) {
          const trav = task_traverse_fusion(inner, exit_cancel_id);
          if (trav !== undefined) return trav;
        }
        const seq_lift = sequential_task_lift_fusion(
          inner,
          exit_cancel_id,
          false,
          signal_expr,
          signal_anchor,
        );
        if (seq_lift !== undefined) return seq_lift;
        const fluent = task_fluent_chain_fusion(
          inner,
          exit_cancel_id,
          false,
          signal_expr,
          signal_anchor,
        );
        if (fluent !== undefined) return fluent;
        const k = services.kind(inner);
        if (
          k === "do" && inner.arguments.length === 2 &&
          inner.arguments[0].type !== "SpreadElement" &&
          is_task_dict(parentheses(inner.arguments[0] as Expression))
        ) {
          gen_call = inner;
        } else if (k === "do" && inner.arguments.length === 1) {
          const run_candidate = inner.arguments[0];
          if (
            run_candidate.type === "FunctionExpression" &&
            valid_generator(run_candidate)
          ) {
            let first_yield: Expression | undefined;
            walk(run_candidate.body!, (child) => {
              if (first_yield !== undefined || function_like(child)) {
                return false;
              }
              if (
                child.type === "YieldExpression" && child.delegate &&
                child.argument !== null
              ) {
                first_yield = child.argument;
                return false;
              }
            });
            if (first_yield !== undefined && is_known_task_expr(first_yield)) {
              gen_call = inner;
            }
          }
        } else if (k === "program" && inner.arguments.length === 1) {
          gen_call = inner;
          program_mode = true;
        }
      }
    } else if (
      arg_len === 0 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "run"
    ) {
      const recv = parentheses(callee.object);
      if (
        recv.type === "CallExpression" && !recv.optional &&
        recv.typeArguments == null
      ) {
        const par = parallel_task_fusion(recv, undefined, "none");
        if (par !== undefined) return par;
        const tt = task_traverse_task_fusion(recv, undefined);
        if (tt !== undefined) return tt;
        const trav = task_traverse_fusion(recv, undefined);
        if (trav !== undefined) return trav;
        const seq_lift = sequential_task_lift_fusion(recv, undefined, false);
        if (seq_lift !== undefined) return seq_lift;
        const fluent = task_fluent_chain_fusion(recv, undefined, false);
        if (fluent !== undefined) return fluent;
        if (services.kind(recv) === "do") {
          if (
            recv.arguments.length === 2 &&
            recv.arguments[0].type !== "SpreadElement" &&
            is_task_dict(parentheses(recv.arguments[0] as Expression))
          ) {
            gen_call = recv;
          } else if (recv.arguments.length === 1) {
            const run_candidate = recv.arguments[0];
            if (
              run_candidate.type === "FunctionExpression" &&
              valid_generator(run_candidate)
            ) {
              let first_yield: Expression | undefined;
              walk(run_candidate.body!, (child) => {
                if (first_yield !== undefined || function_like(child)) {
                  return false;
                }
                if (
                  child.type === "YieldExpression" && child.delegate &&
                  child.argument !== null
                ) {
                  first_yield = child.argument;
                  return false;
                }
              });
              if (
                first_yield !== undefined && is_known_task_expr(first_yield)
              ) {
                gen_call = recv;
              }
            }
          }
        }
      }
    } else {
      // PPF-03: Standalone Task / ParallelTask fusions (not inside run_task / .run())
      if (
        arg_len === 1 && is_sequential_fn(callee)
      ) {
        const par_task = parallel_task_fusion(outer, undefined, "task");
        if (par_task !== undefined) return par_task;
      }
      if (
        (is_applicative_lift_fn(callee) && arg_len >= 2) ||
        (is_collect_fn(callee) && (arg_len === 1 || arg_len === 2))
      ) {
        const par_standalone = parallel_task_fusion(
          outer,
          undefined,
          "parallel",
        );
        if (par_standalone !== undefined) return par_standalone;
        const seq_standalone = sequential_task_lift_fusion(
          outer,
          undefined,
          true,
        );
        if (seq_standalone !== undefined) return seq_standalone;
      }
      if (
        arg_len === 1 &&
        callee.type === "MemberExpression" && !callee.computed &&
        !callee.optional && callee.property.type === "Identifier" &&
        (callee.property.name === "map" || callee.property.name === "bind")
      ) {
        const fluent_standalone = task_fluent_chain_fusion(
          outer,
          undefined,
          true,
        );
        if (fluent_standalone !== undefined) return fluent_standalone;
      }
      if (
        services.config.optimizations?.generator !== false &&
        services.kind(outer) === "do" &&
        (arg_len === 1 || arg_len === 2)
      ) {
        if (
          arg_len === 2 &&
          outer.arguments[0].type !== "SpreadElement" &&
          is_task_dict(parentheses(outer.arguments[0] as Expression))
        ) {
          gen_call = outer;
        } else if (arg_len === 1) {
          const run_candidate = outer.arguments[0];
          if (
            run_candidate.type === "FunctionExpression" &&
            valid_generator(run_candidate)
          ) {
            let first_yield: Expression | undefined;
            walk(run_candidate.body!, (child) => {
              if (first_yield !== undefined || function_like(child)) {
                return false;
              }
              if (
                child.type === "YieldExpression" && child.delegate &&
                child.argument !== null
              ) {
                first_yield = child.argument;
                return false;
              }
            });
            if (first_yield !== undefined && is_known_task_expr(first_yield)) {
              gen_call = outer;
            }
          }
        }
      }
    }

    const is_standalone_do = gen_call === outer;
    if (gen_call === undefined) return undefined;
    const run_arg = gen_call.arguments[gen_call.arguments.length - 1];
    if (
      run_arg === undefined || run_arg.type !== "FunctionExpression" ||
      !valid_generator(run_arg) || lexical_hazard(run_arg.body!)
    ) return undefined;

    const body = run_arg.body!;
    // Preserve MonadRec tail_rec_m loop lowering & replay diagnostics for standalone Do(Task) with loops
    if (
      is_standalone_do && contains_loop_with_yield(body.body as Statement[])
    ) {
      return undefined;
    }
    if (
      is_standalone_do &&
      !has_safe_standalone_prefix_before_yield(body.body as Statement[])
    ) return undefined;
    let yield_count = 0;

    function validate_expr(expr: Expression): boolean {
      if (!contains_await_yield(expr)) return true;
      const target = unwrap(expr);
      if (target.type === "AwaitExpression") return false;
      if (target.type === "YieldExpression") {
        if (!target.delegate || target.argument === null) return false;
        if (!validate_expr(target.argument)) return false;
        if (
          classify_task_yield(target.argument, program_mode) === undefined
        ) return false;
        yield_count += 1;
        return true;
      }
      switch (target.type) {
        case "BinaryExpression":
          return (target.left.type === "PrivateIdentifier" ||
            validate_expr(target.left)) && validate_expr(target.right);
        case "UnaryExpression":
          return validate_expr(target.argument);
        case "SequenceExpression":
          return target.expressions.every(validate_expr);
        case "TemplateLiteral":
          return target.expressions.every(validate_expr);
        case "ArrayExpression":
          return target.elements.every((el) =>
            el === null
              ? true
              : el.type === "SpreadElement"
              ? validate_expr(el.argument)
              : validate_expr(el)
          );
        case "ObjectExpression":
          return target.properties.every((prop) =>
            prop.type === "SpreadElement"
              ? validate_expr(prop.argument)
              : (!prop.computed || validate_expr(prop.key as Expression)) &&
                validate_expr(prop.value as Expression)
          );
        case "MemberExpression":
          return !target.optional && validate_expr(target.object) &&
            (!target.computed || validate_expr(target.property as Expression));
        case "CallExpression":
        case "NewExpression":
          if (target.type === "CallExpression" && target.optional) return false;
          return validate_expr(target.callee as Expression) &&
            target.arguments.every((arg) =>
              arg.type === "SpreadElement"
                ? validate_expr(arg.argument)
                : validate_expr(arg)
            );
        case "AssignmentExpression":
          return target.left.type === "Identifier" &&
            validate_expr(target.right);
        case "ConditionalExpression":
          return validate_expr(target.test) &&
            validate_expr(target.consequent) &&
            validate_expr(target.alternate);
        case "LogicalExpression":
          return validate_expr(target.left) && validate_expr(target.right);
        case "TSAsExpression":
        case "TSTypeAssertion":
        case "TSNonNullExpression":
        case "TSSatisfiesExpression":
          return validate_expr(target.expression);
        default:
          return false;
      }
    }

    function validate_stmt(
      stmt: Statement,
      in_loop: boolean,
      in_switch: boolean,
    ): boolean {
      if (
        stmt.type === "ExpressionStatement" && "directive" in stmt &&
        stmt.directive != null
      ) return true;
      switch (stmt.type) {
        case "EmptyStatement":
          return true;
        case "ThrowStatement":
          return !contains_await_yield(stmt.argument);
        case "TryStatement":
          return !contains_await_yield(stmt);
        case "LabeledStatement":
        case "WithStatement":
          return false;
        case "BreakStatement":
          return stmt.label === null && (in_loop || in_switch);
        case "ContinueStatement":
          return stmt.label === null && in_loop;
        case "ReturnStatement":
          if (stmt.argument === null) return true;
          return validate_expr(stmt.argument);
        case "VariableDeclaration":
          if (stmt.kind === "var") return false;
          return stmt.declarations.every((d) =>
            d.init === null || validate_expr(d.init)
          );
        case "ExpressionStatement":
          return validate_expr(stmt.expression);
        case "BlockStatement":
          return stmt.body.every((s) =>
            validate_stmt(s as Statement, in_loop, in_switch)
          );
        case "IfStatement":
          return validate_expr(stmt.test) &&
            validate_stmt(stmt.consequent, in_loop, in_switch) &&
            (stmt.alternate === null ||
              validate_stmt(stmt.alternate, in_loop, in_switch));
        case "ForStatement":
          if (
            stmt.init !== null &&
            ((stmt.init.type === "VariableDeclaration" &&
              stmt.init.kind === "var") ||
              contains_await_yield(stmt.init))
          ) return false;
          if (stmt.update !== null && contains_await_yield(stmt.update)) {
            return false;
          }
          if (stmt.test !== null && !validate_expr(stmt.test)) return false;
          return validate_stmt(stmt.body, true, in_switch);
        case "WhileStatement":
          return validate_expr(stmt.test) &&
            validate_stmt(stmt.body, true, in_switch);
        case "DoWhileStatement":
          return !contains_await_yield(stmt.test) &&
            validate_stmt(stmt.body, true, in_switch);
        case "ForOfStatement":
          if (
            stmt.await ||
            (stmt.left.type === "VariableDeclaration" &&
              stmt.left.kind === "var") ||
            contains_await_yield(stmt.left) ||
            contains_await_yield(stmt.right)
          ) return false;
          return validate_stmt(stmt.body, true, in_switch);
        case "ForInStatement":
          if (
            (stmt.left.type === "VariableDeclaration" &&
              stmt.left.kind === "var") ||
            contains_await_yield(stmt.left) ||
            contains_await_yield(stmt.right)
          ) return false;
          return validate_stmt(stmt.body, true, in_switch);
        case "SwitchStatement":
          if (!validate_expr(stmt.discriminant)) return false;
          return stmt.cases.every((c) =>
            (c.test === null || !contains_await_yield(c.test)) &&
            c.consequent.every((inner) =>
              validate_stmt(inner as Statement, in_loop, true)
            )
          );
        default:
          return !contains_await_yield(stmt);
      }
    }

    for (const stmt of body.body) {
      if (!validate_stmt(stmt as Statement, false, false)) return undefined;
    }
    if (program_mode && yield_count === 0) return undefined;
    if (
      !program_mode && gen_call.arguments.length === 1 &&
      !reaches_unconditional_yield(body.body as Statement[])
    ) return undefined;
    if (
      !program_mode && signal_expr !== undefined &&
      !has_pure_prefix_before_yield(body.body as Statement[], true)
    ) return undefined;

    let sig_id: IdentifierReference | undefined;
    let check_sig_id: IdentifierReference | undefined;
    let await_sig_id: IdentifierReference | undefined;
    let standalone_task_ctor: IdentifierReference | undefined;
    const resolved_anchor = signal_anchor ?? find_task_anchor();
    if (is_standalone_do) {
      if (resolved_anchor === undefined) return undefined;
      standalone_task_ctor = resolve_task_dict(resolved_anchor);
      check_sig_id = services.import_from_module?.(
        resolved_anchor,
        "task",
        "task_check_signal",
      );
      await_sig_id = services.import_from_module?.(
        resolved_anchor,
        "task",
        "task_await_signal",
      );
      if (
        standalone_task_ctor === undefined || check_sig_id === undefined ||
        await_sig_id === undefined
      ) return undefined;
      sig_id = services.fresh("task_sig");
    } else if (signal_expr !== undefined) {
      check_sig_id = services.import_from_module?.(
        signal_anchor!,
        "task",
        "task_check_signal",
      );
      await_sig_id = services.import_from_module?.(
        signal_anchor!,
        "task",
        "task_await_signal",
      );
      if (check_sig_id === undefined || await_sig_id === undefined) {
        return undefined;
      }
      sig_id = services.fresh("task_sig");
    }

    function emit_sig_check(target_stmts: Statement[], op_name: string): void {
      if (sig_id === undefined || check_sig_id === undefined) return;
      target_stmts.push(
        node({
          type: "ExpressionStatement",
          expression: call(check_sig_id, [sig_id, literal(op_name)]),
        }),
      );
    }

    function try_lower_nested_task_call(expr: Expression): Expression {
      const p = parentheses(expr);
      if (p.type !== "CallExpression" || p.optional) return expr;
      const c = parentheses(p.callee);
      if (p.arguments.length === 1 && is_sequential_fn(c)) {
        const res = parallel_task_fusion(p, undefined, "task");
        if (res !== undefined) return res.expression;
      }
      if (
        (is_applicative_lift_fn(c) && p.arguments.length >= 2) ||
        (is_collect_fn(c) &&
          (p.arguments.length === 1 || p.arguments.length === 2))
      ) {
        const par = parallel_task_fusion(p, undefined, "parallel");
        if (par !== undefined) return par.expression;
        const seq = sequential_task_lift_fusion(p, undefined, true);
        if (seq !== undefined) return seq.expression;
      }
      return expr;
    }

    let emit_failed = false;

    function emit_yield_expr(
      raw_arg: Expression,
      target_stmts: Statement[],
    ): Expression {
      const lowered_arg = lower_expr(raw_arg, target_stmts);
      const classified = classify_task_yield(lowered_arg, program_mode)!;
      const emitted_expr = emit_task_kind_expr(
        classified,
        target_stmts,
        sig_id,
        check_sig_id,
        await_sig_id,
        resolved_anchor,
        (sub) => try_lower_nested_task_call(sub),
      );
      if (emitted_expr === undefined) {
        emit_failed = true;
        return lowered_arg;
      }
      return emitted_expr;
    }

    function lower_ordered<T extends Expression | null>(
      items: readonly T[],
      target_stmts: Statement[],
    ): T[] {
      let last_yield = -1;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item !== null && contains_yield(item)) last_yield = i;
      }
      if (last_yield < 0) return [...items];
      const out: T[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item === null) {
          out.push(item);
          continue;
        }
        if (i < last_yield) {
          const lowered = contains_yield(item)
            ? lower_expr(item, target_stmts)
            : item;
          if (!is_trivial_pure(lowered)) {
            const tmp = services.fresh("task_arg");
            target_stmts.push(variable(tmp, lowered, "const"));
            out.push(tmp as T);
          } else out.push(lowered as T);
        } else if (i === last_yield) {
          out.push(lower_expr(item, target_stmts) as T);
        } else {
          out.push(item);
        }
      }
      return out;
    }

    function lower_expr(
      expr: Expression,
      target_stmts: Statement[],
    ): Expression {
      if (!contains_yield(expr)) return expr;
      if (expr.type === "ParenthesizedExpression") {
        return lower_expr(expr.expression, target_stmts);
      }
      if (yield_star(expr)) {
        return emit_yield_expr(expr.argument, target_stmts);
      }
      switch (expr.type) {
        case "BinaryExpression": {
          if (expr.left.type === "PrivateIdentifier") {
            return { ...expr, right: lower_expr(expr.right, target_stmts) };
          }
          const [left, right] = lower_ordered(
            [expr.left, expr.right],
            target_stmts,
          );
          return { ...expr, left: left!, right: right! };
        }
        case "UnaryExpression":
          return { ...expr, argument: lower_expr(expr.argument, target_stmts) };
        case "SequenceExpression":
          return {
            ...expr,
            expressions: lower_ordered(expr.expressions, target_stmts),
          };
        case "TemplateLiteral":
          return {
            ...expr,
            expressions: lower_ordered(expr.expressions, target_stmts),
          };
        case "ArrayExpression": {
          let last_yield = -1;
          for (let i = 0; i < expr.elements.length; i += 1) {
            const el = expr.elements[i];
            if (el !== null && contains_yield(el)) last_yield = i;
          }
          const elements = expr.elements.map((el, i) => {
            if (el === null || i > last_yield) return el;
            if (el.type === "SpreadElement") {
              const lowered = lower_expr(el.argument, target_stmts);
              if (i < last_yield && !is_trivial_pure(lowered)) {
                const tmp = services.fresh("task_arg");
                target_stmts.push(variable(tmp, lowered, "const"));
                return { ...el, argument: tmp };
              }
              return { ...el, argument: lowered };
            }
            const lowered = lower_expr(el, target_stmts);
            if (i < last_yield && !is_trivial_pure(lowered)) {
              const tmp = services.fresh("task_arg");
              target_stmts.push(variable(tmp, lowered, "const"));
              return tmp;
            }
            return lowered;
          });
          return { ...expr, elements };
        }
        case "ObjectExpression": {
          let last_yield = -1;
          for (let i = 0; i < expr.properties.length; i += 1) {
            if (contains_yield(expr.properties[i])) last_yield = i;
          }
          const properties = expr.properties.map((prop, i) => {
            if (i > last_yield) return prop;
            if (prop.type === "SpreadElement") {
              const lowered = lower_expr(prop.argument, target_stmts);
              if (i < last_yield && !is_trivial_pure(lowered)) {
                const tmp = services.fresh("task_arg");
                target_stmts.push(variable(tmp, lowered, "const"));
                return { ...prop, argument: tmp };
              }
              return { ...prop, argument: lowered };
            }
            let key = prop.key;
            if (prop.computed) {
              const lk = lower_expr(prop.key as Expression, target_stmts);
              if (
                contains_yield(prop.value) ||
                (i < last_yield && !is_trivial_pure(lk))
              ) {
                const tmp = services.fresh("task_key");
                target_stmts.push(variable(tmp, lk, "const"));
                key = tmp;
              } else key = lk;
            }
            const lv = lower_expr(prop.value as Expression, target_stmts);
            if (i < last_yield && !is_trivial_pure(lv)) {
              const tmp = services.fresh("task_val");
              target_stmts.push(variable(tmp, lv, "const"));
              return { ...prop, key, value: tmp, shorthand: false };
            }
            return { ...prop, key, value: lv, shorthand: false };
          });
          return { ...expr, properties };
        }
        case "MemberExpression": {
          if (!expr.computed) {
            return { ...expr, object: lower_expr(expr.object, target_stmts) };
          }
          const [object, property] = lower_ordered(
            [expr.object, expr.property as Expression],
            target_stmts,
          );
          return { ...expr, object, property };
        }
        case "CallExpression":
        case "NewExpression": {
          let last_arg = -1;
          for (let i = 0; i < expr.arguments.length; i += 1) {
            if (contains_yield(expr.arguments[i])) last_arg = i;
          }
          let inner_callee = expr.callee;
          if (last_arg >= 0) {
            if (
              expr.type === "CallExpression" &&
              inner_callee.type === "MemberExpression" && !inner_callee.optional
            ) {
              const obj = lower_expr(inner_callee.object, target_stmts);
              const obj_tmp = services.fresh("task_recv");
              target_stmts.push(variable(obj_tmp, obj, "const"));
              if (inner_callee.computed) {
                const lp = lower_expr(
                  inner_callee.property as Expression,
                  target_stmts,
                );
                const prop_tmp = services.fresh("task_prop");
                target_stmts.push(variable(prop_tmp, lp, "const"));
                inner_callee = {
                  ...inner_callee,
                  object: obj_tmp,
                  property: prop_tmp,
                };
              } else inner_callee = { ...inner_callee, object: obj_tmp };
            } else if (
              contains_yield(inner_callee) ||
              !is_trivial_pure(inner_callee as Expression)
            ) {
              const lc = lower_expr(inner_callee as Expression, target_stmts);
              const tmp = services.fresh("task_fn");
              target_stmts.push(variable(tmp, lc, "const"));
              inner_callee = tmp;
            }
          } else {
            inner_callee = lower_expr(inner_callee as Expression, target_stmts);
          }
          const args = expr.arguments.map((arg, i) => {
            if (i > last_arg) return arg;
            if (arg.type === "SpreadElement") {
              const la = lower_expr(arg.argument, target_stmts);
              if (i < last_arg && !is_trivial_pure(la)) {
                const tmp = services.fresh("task_arg");
                target_stmts.push(variable(tmp, la, "const"));
                return { ...arg, argument: tmp };
              }
              return { ...arg, argument: la };
            }
            const la = lower_expr(arg, target_stmts);
            if (i < last_arg && !is_trivial_pure(la)) {
              const tmp = services.fresh("task_arg");
              target_stmts.push(variable(tmp, la, "const"));
              return tmp;
            }
            return la;
          });
          return { ...expr, callee: inner_callee, arguments: args };
        }
        case "AssignmentExpression":
          return { ...expr, right: lower_expr(expr.right, target_stmts) };
        case "ConditionalExpression": {
          const test = lower_expr(expr.test, target_stmts);
          if (
            !contains_yield(expr.consequent) && !contains_yield(expr.alternate)
          ) return { ...expr, test };
          const out = services.fresh("task_cond");
          const cons_stmts: Statement[] = [];
          const cons_val = lower_expr(expr.consequent, cons_stmts);
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
          const alt_val = lower_expr(expr.alternate, alt_stmts);
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
          const left = lower_expr(expr.left, target_stmts);
          if (!contains_yield(expr.right)) return { ...expr, left };
          const out = services.fresh("task_logic");
          target_stmts.push(variable(out, left, "let"));
          const right_stmts: Statement[] = [];
          const right_val = lower_expr(expr.right, right_stmts);
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
          const guard: Expression = expr.operator === "&&"
            ? out
            : expr.operator === "||"
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
            ...expr,
            expression: lower_expr(expr.expression, target_stmts),
          };
        default:
          return expr;
      }
    }

    function lower_stmt(stmt: Statement): Statement[] {
      if (
        stmt.type === "ExpressionStatement" && "directive" in stmt &&
        stmt.directive != null
      ) return [stmt];
      switch (stmt.type) {
        case "VariableDeclaration": {
          const stmts: Statement[] = [];
          const declarations = stmt.declarations.map((decl) => {
            if (decl.init === null) return decl;
            if (contains_yield(decl.init)) {
              return { ...decl, init: lower_expr(decl.init, stmts) };
            }
            const nested = try_lower_nested_task_call(decl.init);
            return nested !== decl.init ? { ...decl, init: nested } : decl;
          });
          stmts.push({ ...stmt, declarations });
          return stmts;
        }
        case "ExpressionStatement": {
          if (!contains_yield(stmt.expression)) return [stmt];
          const stmts: Statement[] = [];
          const lowered = lower_expr(stmt.expression, stmts);
          stmts.push({ ...stmt, expression: lowered });
          return stmts;
        }
        case "ReturnStatement": {
          if (stmt.argument === null) return [stmt];
          if (!contains_yield(stmt.argument)) return [stmt];
          const stmts: Statement[] = [];
          const lowered = lower_expr(stmt.argument, stmts);
          stmts.push(ret(lowered));
          return stmts;
        }
        case "BlockStatement":
          return [block(lower_list(stmt.body as Statement[]))];
        case "IfStatement": {
          const stmts: Statement[] = [];
          const test = lower_expr(stmt.test, stmts);
          const consequent = lower_single(stmt.consequent);
          const alternate = stmt.alternate !== null
            ? lower_single(stmt.alternate)
            : null;
          stmts.push({ ...stmt, test, consequent, alternate });
          return stmts;
        }
        case "ForStatement": {
          const lowered_body = lower_single(stmt.body);
          if (stmt.test !== null && contains_yield(stmt.test)) {
            const test_stmts: Statement[] = [];
            const test_val = lower_expr(stmt.test, test_stmts);
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
              ...stmt,
              test: null,
              body: block([...test_stmts, ...(body_stmts as Statement[])]),
            }];
          }
          return [{ ...stmt, body: lowered_body }];
        }
        case "WhileStatement": {
          const lowered_body = lower_single(stmt.body);
          if (contains_yield(stmt.test)) {
            const test_stmts: Statement[] = [];
            const test_val = lower_expr(stmt.test, test_stmts);
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
              ...stmt,
              test: literal(true),
              body: block([...test_stmts, ...(body_stmts as Statement[])]),
            }];
          }
          return [{ ...stmt, body: lowered_body }];
        }
        case "DoWhileStatement":
        case "ForOfStatement":
        case "ForInStatement":
          return [{ ...stmt, body: lower_single(stmt.body) }];
        case "SwitchStatement": {
          const stmts: Statement[] = [];
          const discriminant = lower_expr(stmt.discriminant, stmts);
          const cases = stmt.cases.map((c) => ({
            ...c,
            consequent: lower_list(c.consequent as Statement[]),
          }));
          stmts.push({ ...stmt, discriminant, cases });
          return stmts;
        }
        default:
          return [stmt];
      }
    }

    function lower_list(list: readonly Statement[]): Statement[] {
      const out: Statement[] = [];
      for (const item of list) out.push(...lower_stmt(item));
      return out;
    }

    function lower_single(stmt: Statement): Statement {
      const list = lower_stmt(stmt);
      return list.length === 1 ? list[0] : block(list);
    }

    const emitted: Statement[] = [];
    const iife_params: IdentifierReference[] = [];
    const iife_args: Expression[] = [];
    if (is_standalone_do && sig_id !== undefined) {
      emit_sig_check(emitted, "run_task");
    } else if (sig_id !== undefined && signal_expr !== undefined) {
      if (exit_cancel_id !== undefined && !is_pure_no_call(signal_expr)) {
        iife_params.push(sig_id);
        iife_args.push(signal_expr);
      } else {
        emitted.push(variable(sig_id, signal_expr, "const"));
      }
      emit_sig_check(emitted, "run_task");
    }
    emitted.push(...lower_list(body.body as Statement[]));
    if (emit_failed) return undefined;
    if (is_standalone_do && standalone_task_ctor !== undefined) {
      const task_fn: ArrowFunctionExpression = node({
        type: "ArrowFunctionExpression",
        id: null,
        expression: false,
        generator: false,
        async: true,
        params: [sig_id!],
        body: block(emitted),
        typeParameters: null,
        returnType: null,
      });
      return {
        expression: call(standalone_task_ctor, [task_fn]),
        direct: true,
      };
    }
    const final_emitted = exit_cancel_id !== undefined
      ? wrap_task_exit_stmts(emitted, exit_cancel_id)
      : emitted;
    const async_fn: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: iife_params,
      body: block(final_emitted),
      typeParameters: null,
      returnType: null,
    });
    return { expression: call(async_fn, iife_args), direct: true };
  }

  // =========================================================================
  // P4 + Q2a: Traversable.traverse / ArrayT(xs).traverse / traverse_sequential fusion
  // =========================================================================
  type TraverseDict = {
    readonly mode: "maybe" | "either" | "identity" | "validation";
    readonly dict_id: IdentifierReference;
    readonly left_type?: TSType;
  };

  function match_traverse_dict(expr: Expression): TraverseDict | undefined {
    const val = parentheses(expr);
    if (
      val.type === "CallExpression" && !val.optional &&
      val.arguments.length === 0 &&
      val.callee.type === "MemberExpression" && !val.callee.computed &&
      !val.callee.optional && val.callee.object.type === "Identifier" &&
      val.callee.property.type === "Identifier" &&
      services.bindings.imported(val.callee.object)
    ) {
      if (
        val.callee.property.name === "with_error" &&
        services.imports.direct_validation_dictionaries?.has(
          val.callee.object.name,
        )
      ) {
        return { mode: "validation", dict_id: val.callee.object };
      }
      if (
        val.callee.property.name === "with_left" &&
        services.imports.direct_either_dictionaries?.has(
          val.callee.object.name,
        )
      ) {
        const left_type = val.typeArguments?.params.length === 1
          ? val.typeArguments.params[0]
          : undefined;
        return { mode: "either", dict_id: val.callee.object, left_type };
      }
    }
    if (val.type !== "Identifier" || !services.bindings.imported(val)) {
      return undefined;
    }
    if (services.imports.direct_maybe_dictionaries?.has(val.name)) {
      return { mode: "maybe", dict_id: val };
    }
    if (services.imports.direct_either_dictionaries?.has(val.name)) {
      return { mode: "either", dict_id: val };
    }
    if (services.imports.direct_identity_dictionaries?.has(val.name)) {
      return { mode: "identity", dict_id: val };
    }
    if (services.imports.direct_validation_dictionaries?.has(val.name)) {
      return { mode: "validation", dict_id: val };
    }
    return undefined;
  }

  function unwrap_array_t(
    expr: Expression,
  ):
    | {
      readonly array_ctor?: IdentifierReference;
      readonly items: Expression;
      readonly needs_snapshot?: boolean;
    }
    | undefined {
    const val = parentheses(expr);
    if (
      val.type !== "CallExpression" || val.optional ||
      val.typeArguments != null || val.arguments.length !== 1 ||
      val.arguments[0].type === "SpreadElement"
    ) return undefined;
    const c = parentheses(val.callee);
    const items = val.arguments[0] as Expression;
    if (c.type === "Identifier" && services.bindings.imported(c)) {
      if (services.imports.array_constructors?.has(c.name)) {
        return { array_ctor: c, items, needs_snapshot: false };
      }
      if (
        services.imports.array_view_functions?.has(c.name) ||
        services.imports.array_from_array_functions?.has(c.name)
      ) {
        const is_view = services.imports.array_view_functions?.has(c.name) ===
          true;
        const ctor_name = first_unshadowed(services.imports.array_constructors);
        const ctor = ctor_name !== undefined
          ? id(ctor_name)
          : services.import_from_module?.(c.name, "array", "ArrayT");
        if (ctor === undefined) return undefined;
        return { array_ctor: ctor, items, needs_snapshot: !is_view };
      }
    } else if (
      c.type === "MemberExpression" && !c.computed && !c.optional &&
      c.object.type === "Identifier" && c.property.type === "Identifier" &&
      services.bindings.imported(c.object) &&
      services.imports.array_namespaces?.has(c.object.name) &&
      (c.property.name === "ArrayT" || c.property.name === "from_array" ||
        c.property.name === "from_array_view")
    ) {
      const is_view = c.property.name !== "from_array";
      const ctor_name = first_unshadowed(services.imports.array_constructors);
      const ctor = ctor_name !== undefined
        ? id(ctor_name)
        : services.import_from_module?.(c.object.name, "array", "ArrayT");
      if (ctor === undefined) return undefined;
      return { array_ctor: ctor, items, needs_snapshot: !is_view };
    }
    return undefined;
  }

  function is_traversable_obj(expr: Expression): boolean {
    return is_imported_from_set(expr, services.imports.traversable_objects) ||
      is_ns_member(
        expr,
        services.imports.traversable_namespaces,
        "Traversable",
      );
  }

  function is_traverse_seq_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.traverse_sequential_functions,
    ) ||
      is_ns_member(
        expr,
        services.imports.traverse_sequential_namespaces,
        "traverse_sequential",
      );
  }

  type ElidedBranch =
    | {
      readonly kind: "ok";
      readonly expr: Expression;
      readonly ok_type?: TSType;
    }
    | {
      readonly kind: "cond";
      readonly test: Expression;
      readonly ok_expr: Expression;
      readonly ok_type?: TSType;
      readonly err_expr?: Expression;
      readonly err_type?: TSType;
      readonly err_sg?: Expression;
      readonly invalid_messages?: {
        readonly callee: IdentifierReference;
        readonly args: readonly Expression[];
      };
    };

  function match_ctor_call(
    expr: Expression,
    mode: "maybe" | "either" | "identity" | "validation",
  ):
    | {
      readonly ok: boolean;
      readonly arg?: Expression;
      readonly ok_type?: TSType;
      readonly err_type?: TSType;
      readonly err_sg?: Expression;
      readonly invalid_messages?: {
        readonly callee: IdentifierReference;
        readonly args: readonly Expression[];
      };
    }
    | undefined {
    const val = parentheses(expr);
    if (val.type !== "CallExpression" || val.optional) return undefined;
    const tparams = val.typeArguments?.params;
    const callee = parentheses(val.callee);
    if (callee.type === "Identifier" && services.bindings.imported(callee)) {
      const name = callee.name;
      if (mode === "maybe") {
        if (
          services.imports.just_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
        if (
          services.imports.nothing_constructors?.has(name) &&
          val.arguments.length === 0
        ) return { ok: false };
      } else if (mode === "either") {
        if (
          services.imports.right_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams !== undefined
              ? (tparams.length >= 2 ? tparams[1] : tparams[0])
              : undefined,
          };
        }
        if (
          services.imports.left_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: false,
            arg: val.arguments[0] as Expression,
            err_type: tparams?.[0],
          };
        }
      } else if (mode === "validation") {
        if (
          services.imports.valid_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
        if (
          services.imports.invalid_messages_constructors?.has(name) &&
          val.arguments.length >= 1 &&
          val.arguments.every((a) => a.type !== "SpreadElement")
        ) {
          return {
            ok: false,
            ok_type: tparams?.[0],
            invalid_messages: {
              callee,
              args: val.arguments as Expression[],
            },
          };
        }
        if (
          services.imports.invalid_constructors?.has(name) &&
          val.arguments.length === 2 &&
          val.arguments[0].type !== "SpreadElement" &&
          val.arguments[1].type !== "SpreadElement"
        ) {
          return {
            ok: false,
            arg: val.arguments[0] as Expression,
            err_sg: val.arguments[1] as Expression,
            err_type: tparams?.[0],
            ok_type: tparams?.[1],
          };
        }
      } else {
        if (
          services.imports.identity_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
      }
    } else if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      services.bindings.imported(callee.object)
    ) {
      const obj = callee.object.name;
      const prop = callee.property.name;
      if (
        mode === "maybe" && services.imports.direct_maybe_dictionaries?.has(obj)
      ) {
        if (
          (prop === "Just" || prop === "pure") && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
        if (
          (prop === "Nothing" || prop === "empty") && val.arguments.length === 0
        ) {
          return { ok: false };
        }
      } else if (
        mode === "either" &&
        services.imports.direct_either_dictionaries?.has(obj)
      ) {
        if (
          (prop === "Right" || prop === "pure") && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams !== undefined
              ? (tparams.length >= 2 ? tparams[1] : tparams[0])
              : undefined,
          };
        }
        if (
          prop === "Left" && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: false,
            arg: val.arguments[0] as Expression,
            err_type: tparams?.[0],
          };
        }
      } else if (
        mode === "validation" &&
        services.imports.direct_validation_dictionaries?.has(obj)
      ) {
        if (
          (prop === "Valid" || prop === "pure") && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
        if (
          prop === "Invalid" && val.arguments.length === 2 &&
          val.arguments[0].type !== "SpreadElement" &&
          val.arguments[1].type !== "SpreadElement"
        ) {
          return {
            ok: false,
            arg: val.arguments[0] as Expression,
            err_sg: val.arguments[1] as Expression,
            err_type: tparams?.[0],
            ok_type: tparams?.[1],
          };
        }
      } else if (
        mode === "identity" &&
        services.imports.direct_identity_dictionaries?.has(obj)
      ) {
        if (
          prop === "pure" && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) {
          return {
            ok: true,
            arg: val.arguments[0] as Expression,
            ok_type: tparams?.[0],
          };
        }
      }
    }
    return undefined;
  }

  function match_elided_body(
    expr: Expression,
    mode: "maybe" | "either" | "identity" | "validation",
  ): ElidedBranch | undefined {
    const direct = match_ctor_call(expr, mode);
    if (direct !== undefined && direct.ok && direct.arg !== undefined) {
      return { kind: "ok", expr: direct.arg, ok_type: direct.ok_type };
    }
    const val = parentheses(expr);
    if (mode !== "identity" && val.type === "ConditionalExpression") {
      const cons = match_ctor_call(val.consequent, mode);
      const alt = match_ctor_call(val.alternate, mode);
      if (cons !== undefined && alt !== undefined && cons.ok !== alt.ok) {
        if (cons.ok) {
          return {
            kind: "cond",
            test: val.test,
            ok_expr: cons.arg!,
            ok_type: cons.ok_type ?? alt.ok_type,
            err_expr: alt.arg,
            err_type: alt.err_type,
            err_sg: alt.err_sg,
            invalid_messages: alt.invalid_messages,
          };
        }
        return {
          kind: "cond",
          test: negate_expr(val.test),
          ok_expr: alt.arg!,
          ok_type: alt.ok_type ?? cons.ok_type,
          err_expr: cons.arg,
          err_type: cons.err_type,
          err_sg: cons.err_sg,
          invalid_messages: cons.invalid_messages,
        };
      }
    }
    return undefined;
  }

  function traverse_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    const callee = parentheses(outer.callee);
    let items_expr: Expression | undefined;
    let items_needs_snapshot = false;
    let array_ctor: IdentifierReference | undefined;
    let dict: TraverseDict | undefined;
    let fn_expr: Expression | undefined;
    let is_sequential = false;
    let is_sequence = false;

    if (
      outer.arguments.length === 3 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "traverse" &&
      is_traversable_obj(parentheses(callee.object))
    ) {
      const arr = unwrap_array_t(outer.arguments[0] as Expression);
      dict = match_traverse_dict(outer.arguments[1] as Expression);
      if (arr !== undefined && dict !== undefined) {
        items_expr = arr.items;
        items_needs_snapshot = arr.needs_snapshot === true;
        array_ctor = arr.array_ctor;
        fn_expr = outer.arguments[2] as Expression;
      }
    } else if (
      outer.arguments.length === 3 &&
      (is_imported_from_set(
        callee,
        services.imports.prelude_traverse_functions,
      ) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "traverse"))
    ) {
      // prelude.traverse(fn, applicative, value)
      dict = match_traverse_dict(outer.arguments[1] as Expression);
      const arr = unwrap_array_t(outer.arguments[2] as Expression);
      if (arr !== undefined && dict !== undefined) {
        items_expr = arr.items;
        items_needs_snapshot = arr.needs_snapshot === true;
        array_ctor = arr.array_ctor;
        fn_expr = outer.arguments[0] as Expression;
      }
    } else if (
      outer.arguments.length === 2 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "traverse"
    ) {
      const arr = unwrap_array_t(callee.object);
      dict = match_traverse_dict(outer.arguments[0] as Expression);
      if (arr !== undefined && dict !== undefined) {
        items_expr = arr.items;
        items_needs_snapshot = arr.needs_snapshot === true;
        array_ctor = arr.array_ctor;
        fn_expr = outer.arguments[1] as Expression;
      }
    } else if (
      outer.arguments.length === 2 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "sequence" &&
      is_traversable_obj(parentheses(callee.object))
    ) {
      const arr = unwrap_array_t(outer.arguments[0] as Expression);
      dict = match_traverse_dict(outer.arguments[1] as Expression);
      if (arr !== undefined && dict !== undefined) {
        items_expr = arr.items;
        items_needs_snapshot = arr.needs_snapshot === true;
        array_ctor = arr.array_ctor;
        is_sequence = true;
      }
    } else if (
      outer.arguments.length === 2 &&
      (is_imported_from_set(
        callee,
        services.imports.prelude_sequence_functions,
      ) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "sequence"))
    ) {
      // prelude.sequence(applicative, value)
      dict = match_traverse_dict(outer.arguments[0] as Expression);
      const arr = unwrap_array_t(outer.arguments[1] as Expression);
      if (arr !== undefined && dict !== undefined) {
        items_expr = arr.items;
        items_needs_snapshot = arr.needs_snapshot === true;
        array_ctor = arr.array_ctor;
        is_sequence = true;
      }
    } else if (
      outer.arguments.length === 1 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "sequence"
    ) {
      const arr = unwrap_array_t(callee.object);
      dict = match_traverse_dict(outer.arguments[0] as Expression);
      if (arr !== undefined && dict !== undefined) {
        items_expr = arr.items;
        items_needs_snapshot = arr.needs_snapshot === true;
        array_ctor = arr.array_ctor;
        is_sequence = true;
      }
    } else if (
      outer.arguments.length === 3 && is_traverse_seq_callee(callee)
    ) {
      dict = match_traverse_dict(outer.arguments[1] as Expression);
      if (dict !== undefined) {
        items_expr = outer.arguments[0] as Expression;
        fn_expr = outer.arguments[2] as Expression;
        is_sequential = true;
      }
    }

    if (
      items_expr === undefined || dict === undefined ||
      (!is_sequence && fn_expr === undefined)
    ) return undefined;
    if (
      lexical_hazard(items_expr) || contains_await_yield(items_expr) ||
      (fn_expr !== undefined &&
        (lexical_hazard(fn_expr) || contains_await_yield(fn_expr)))
    ) return undefined;

    const mode = dict.mode;
    const dict_id = dict.dict_id;
    const src_id = services.fresh("trav_src");
    const out_id = services.fresh("trav_out");
    const idx_id = services.fresh("trav_i");
    const item_id = services.fresh("trav_x");

    const fn_unwrapped = fn_expr !== undefined ? unwrap(fn_expr) : undefined;
    let inlined_body: Expression | undefined = is_sequence
      ? item_id
      : undefined;
    let elided: ElidedBranch | undefined;
    if (
      fn_unwrapped !== undefined &&
      fn_unwrapped.type === "ArrowFunctionExpression" &&
      !fn_unwrapped.async && !fn_unwrapped.generator &&
      fn_unwrapped.typeParameters == null && fn_unwrapped.returnType == null &&
      fn_unwrapped.body.type !== "BlockStatement" &&
      fn_unwrapped.params.length === 1 &&
      fn_unwrapped.params[0].type === "Identifier" &&
      !fn_unwrapped.params[0].optional &&
      (fn_unwrapped.params[0].decorators === undefined ||
        fn_unwrapped.params[0].decorators.length === 0)
    ) {
      const param_decl = services.bindings.resolve(fn_unwrapped.params[0]);
      if (param_decl !== null) {
        inlined_body = substitute_ident(
          fn_unwrapped.body as Expression,
          param_decl,
          item_id,
          services,
        );
        elided = match_elided_body(inlined_body, mode);
      }
    }

    const src_init_expr: Expression = items_needs_snapshot &&
        parentheses(items_expr).type !== "ArrayExpression" &&
        (inlined_body === undefined || !is_pure_no_call(inlined_body))
      ? call(member(items_expr, "slice"), [])
      : items_expr;
    items_expr = src_init_expr;

    const wrap_collection = (arr_expr: Expression): Expression =>
      array_ctor !== undefined ? call(array_ctor, [arr_expr]) : arr_expr;

    const wrap_ok = (val_expr: Expression): Expression => {
      if (mode === "maybe") {
        const just_name = first_unshadowed(services.imports.just_constructors);
        return just_name !== undefined
          ? call(id(just_name), [val_expr])
          : call(member(dict_id, "pure"), [val_expr]);
      }
      if (mode === "identity") {
        const id_name = first_unshadowed(
          services.imports.identity_constructors,
        );
        return id_name !== undefined
          ? call(id(id_name), [val_expr])
          : call(dict_id, [val_expr]);
      }
      if (mode === "validation") {
        const valid_name = first_unshadowed(
          services.imports.valid_constructors,
        );
        return valid_name !== undefined
          ? call(id(valid_name), [val_expr])
          : call(member(dict_id, "pure"), [val_expr]);
      }
      return call(dict_id, [
        as_const(
          node({
            type: "ArrayExpression",
            elements: [literal("Right"), val_expr],
          }),
        ),
      ]);
    };

    const fail_nothing = (): Expression => {
      const nothing_name = first_unshadowed(
        services.imports.nothing_constructors,
      );
      return nothing_name !== undefined
        ? call(id(nothing_name), [])
        : call(member(dict_id, "empty"), []);
    };

    const make_loop = (loop_body: Statement[]): Statement =>
      node({
        type: "ForStatement",
        init: variable(idx_id, literal(0), "let"),
        test: node({
          type: "BinaryExpression",
          operator: "<",
          left: idx_id,
          right: member(src_id, "length"),
        }),
        update: node({
          type: "AssignmentExpression",
          operator: "+=",
          left: idx_id,
          right: literal(1),
        }),
        body: block(loop_body),
      });

    const elem_access: Expression = node({
      type: "MemberExpression",
      object: src_id,
      property: idx_id,
      computed: true,
      optional: false,
    });

    const empty_array = (): Expression =>
      node({ type: "ArrayExpression", elements: Array.from([]) });

    const make_prealloc_stmts = (
      setup_before_loop: readonly Statement[],
      build_step: (
        emit_value: (val: Expression) => Statement,
      ) => Statement[],
      empty_return: Expression,
      final_return: Expression,
    ): Statement[] => {
      const len_id = services.fresh("trav_len");
      const first_val_id = services.fresh("trav_v0");
      const zero_idx = literal(0);
      const out_set = (index_expr: Expression, val: Expression): Statement =>
        node({
          type: "ExpressionStatement",
          expression: node({
            type: "AssignmentExpression",
            operator: "=",
            left: node({
              type: "MemberExpression",
              object: out_id,
              property: index_expr,
              computed: true,
              optional: false,
            }),
            right: val,
          }),
        });
      const first_stmts = build_step((val) =>
        variable(first_val_id, val, "const")
      );
      const loop_stmts = build_step((val) => out_set(idx_id, val));
      const new_arr: Expression = node({
        type: "NewExpression",
        callee: id("Array"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([
            node({
              type: "TSTypeQuery",
              exprName: first_val_id,
              typeArguments: null,
            }),
          ]),
        }),
        arguments: [len_id],
      });
      return [
        variable(src_id, items_expr, "const"),
        ...setup_before_loop,
        variable(len_id, member(src_id, "length"), "const"),
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: "===",
            left: len_id,
            right: zero_idx,
          }),
          consequent: ret(
            node({
              type: "TSAsExpression",
              expression: empty_return,
              typeAnnotation: node({ type: "TSNeverKeyword" }),
            }),
          ),
          alternate: null,
        }),
        variable(idx_id, zero_idx, "let"),
        variable(item_id, elem_access, "const"),
        ...first_stmts,
        variable(out_id, new_arr, "const"),
        out_set(zero_idx, first_val_id),
        node({
          type: "ForStatement",
          init: node({
            type: "AssignmentExpression",
            operator: "=",
            left: idx_id,
            right: literal(1),
          }),
          test: node({
            type: "BinaryExpression",
            operator: "<",
            left: idx_id,
            right: len_id,
          }),
          update: node({
            type: "AssignmentExpression",
            operator: "+=",
            left: idx_id,
            right: literal(1),
          }),
          body: block([
            variable(item_id, elem_access, "const"),
            ...loop_stmts,
          ]),
        }),
        ret(final_return),
      ];
    };

    // Fast path 1: Elided constructor / ternary body (zero per-item Just/Right/Identity allocations!)
    if (elided !== undefined) {
      if (elided.kind === "ok") {
        const stmts = make_prealloc_stmts(
          [],
          (emit_value) => [emit_value(elided.expr)],
          wrap_ok(wrap_collection(empty_array())),
          wrap_ok(wrap_collection(out_id)),
        );
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }

      // elided.kind === "cond" (Maybe or Either)
      const can_short_circuit = is_sequential ||
        (is_pure_no_call(elided.test) && is_pure_no_call(elided.ok_expr) &&
          (elided.err_expr === undefined || is_pure_no_call(elided.err_expr)));

      if (mode === "maybe") {
        if (can_short_circuit) {
          const stmts = make_prealloc_stmts(
            [],
            (emit_value) => [
              node({
                type: "IfStatement",
                test: node({
                  type: "UnaryExpression",
                  operator: "!",
                  prefix: true,
                  argument: elided.test,
                }),
                consequent: ret(
                  node({
                    type: "TSAsExpression",
                    expression: fail_nothing(),
                    typeAnnotation: node({ type: "TSNeverKeyword" }),
                  }),
                ),
                alternate: null,
              }),
              emit_value(elided.ok_expr),
            ],
            wrap_ok(wrap_collection(empty_array())),
            wrap_ok(wrap_collection(out_id)),
          );
          return {
            expression: call(arrow([], block(stmts)), []),
            direct: true,
          };
        }
        // Preserve full applicative evaluation order while still avoiding Just/Nothing allocations.
        const failed_id = services.fresh("trav_failed");
        const val_id = services.fresh("trav_v");
        const loop_body: Statement[] = [
          variable(item_id, elem_access, "const"),
          node({
            type: "IfStatement",
            test: elided.test,
            consequent: block([
              variable(val_id, elided.ok_expr, "const"),
              node({
                type: "IfStatement",
                test: node({
                  type: "UnaryExpression",
                  operator: "!",
                  prefix: true,
                  argument: failed_id,
                }),
                consequent: node({
                  type: "ExpressionStatement",
                  expression: call(member(out_id, "push"), [val_id]),
                }),
                alternate: null,
              }),
            ]),
            alternate: node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: failed_id,
                right: literal(true),
              }),
            }),
          }),
        ];
        const stmts: Statement[] = [
          variable(src_id, items_expr, "const"),
          variable(out_id, empty_array(), "const"),
          variable(failed_id, literal(false), "let"),
          make_loop(loop_body),
          node({
            type: "IfStatement",
            test: failed_id,
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: fail_nothing(),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
          ret(wrap_ok(wrap_collection(out_id))),
        ];
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }

      if (mode === "validation") {
        const errs_id = services.fresh("trav_errs");
        const ok_v = services.fresh("trav_v");
        const errs_empty = node({
          type: "BinaryExpression",
          operator: "===",
          left: member(errs_id, "length"),
          right: literal(0),
        });
        if (elided.invalid_messages !== undefined) {
          const msg_info = elided.invalid_messages;
          const string_arr_type: TSType = node({
            type: "TSArrayType",
            elementType: node({ type: "TSStringKeyword" }),
          });
          const readonly_str_arr: TSType = node({
            type: "TSTypeOperator",
            operator: "readonly",
            typeAnnotation: string_arr_type,
          });
          const loop_body: Statement[] = [
            variable(item_id, elem_access, "const"),
            node({
              type: "IfStatement",
              test: elided.test,
              consequent: block([
                variable(ok_v, elided.ok_expr, "const", elided.ok_type),
                node({
                  type: "IfStatement",
                  test: errs_empty,
                  consequent: node({
                    type: "ExpressionStatement",
                    expression: call(member(out_id, "push"), [ok_v]),
                  }),
                  alternate: null,
                }),
              ]),
              alternate: node({
                type: "ExpressionStatement",
                expression: call(member(errs_id, "push"), [...msg_info.args]),
              }),
            }),
          ];
          const sg_expr: Expression = node({
            type: "TSNonNullExpression",
            expression: node({
              type: "MemberExpression",
              object: call(
                member(call(msg_info.callee, [literal("")]), "value"),
                [],
              ),
              property: literal(2),
              computed: true,
              optional: false,
            }),
          });
          const inner_stmts: Statement[] = [
            variable(src_id, items_expr, "const"),
            variable(out_id, empty_array(), "const"),
            variable(errs_id, empty_array(), "const", string_arr_type),
            make_loop(loop_body),
            node({
              type: "IfStatement",
              test: node({
                type: "BinaryExpression",
                operator: ">",
                left: member(errs_id, "length"),
                right: literal(0),
              }),
              consequent: ret(
                as_const(
                  node({
                    type: "ArrayExpression",
                    elements: [
                      literal("invalid"),
                      node({
                        type: "TSAsExpression",
                        expression: errs_id,
                        typeAnnotation: readonly_str_arr,
                      }),
                      sg_expr,
                    ],
                  }),
                ),
              ),
              alternate: null,
            }),
            ret(
              as_const(
                node({
                  type: "ArrayExpression",
                  elements: [literal("valid"), wrap_collection(out_id)],
                }),
              ),
            ),
          ];
          return {
            expression: call(dict_id, [
              call(arrow([], block(inner_stmts)), []),
            ]),
            direct: true,
          };
        }
        // Explicit Invalid(err, sg): collect inside loop for exact TS inference, combine after loop.
        const sgs_id = services.fresh("trav_sgs");
        const err_v = services.fresh("trav_e");
        const sg_v = services.fresh("trav_sg");
        const acc_err_id = services.fresh("trav_acc_err");
        const base_sg_id = services.fresh("trav_base_sg");
        const err_idx = services.fresh("trav_k");
        const loop_body: Statement[] = [
          variable(item_id, elem_access, "const"),
          node({
            type: "IfStatement",
            test: elided.test,
            consequent: block([
              variable(ok_v, elided.ok_expr, "const", elided.ok_type),
              node({
                type: "IfStatement",
                test: errs_empty,
                consequent: node({
                  type: "ExpressionStatement",
                  expression: call(member(out_id, "push"), [ok_v]),
                }),
                alternate: null,
              }),
            ]),
            alternate: block([
              variable(err_v, elided.err_expr!, "const", elided.err_type),
              variable(sg_v, elided.err_sg!, "const"),
              node({
                type: "ExpressionStatement",
                expression: call(member(errs_id, "push"), [err_v]),
              }),
              node({
                type: "ExpressionStatement",
                expression: call(member(sgs_id, "push"), [sg_v]),
              }),
            ]),
          }),
        ];
        const inner_stmts: Statement[] = [
          variable(src_id, items_expr, "const"),
          variable(out_id, empty_array(), "const"),
          variable(errs_id, empty_array(), "const"),
          variable(sgs_id, empty_array(), "const"),
          make_loop(loop_body),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: ">",
              left: member(errs_id, "length"),
              right: literal(0),
            }),
            consequent: block([
              variable(
                base_sg_id,
                node({
                  type: "MemberExpression",
                  object: sgs_id,
                  property: literal(0),
                  computed: true,
                  optional: false,
                }),
                "const",
              ),
              variable(
                acc_err_id,
                node({
                  type: "MemberExpression",
                  object: errs_id,
                  property: literal(0),
                  computed: true,
                  optional: false,
                }),
                "let",
              ),
              node({
                type: "ForStatement",
                init: variable(err_idx, literal(1), "let"),
                test: node({
                  type: "BinaryExpression",
                  operator: "<",
                  left: err_idx,
                  right: member(errs_id, "length"),
                }),
                update: node({
                  type: "AssignmentExpression",
                  operator: "+=",
                  left: err_idx,
                  right: literal(1),
                }),
                body: block([
                  node({
                    type: "IfStatement",
                    test: node({
                      type: "BinaryExpression",
                      operator: "!==",
                      left: base_sg_id,
                      right: node({
                        type: "MemberExpression",
                        object: sgs_id,
                        property: err_idx,
                        computed: true,
                        optional: false,
                      }),
                    }),
                    consequent: node({
                      type: "ThrowStatement",
                      argument: node({
                        type: "NewExpression",
                        callee: id("TypeError"),
                        arguments: [
                          literal(
                            "Cannot combine Validation errors created with different semigroups",
                          ),
                        ],
                      }),
                    }),
                    alternate: null,
                  }),
                  node({
                    type: "ExpressionStatement",
                    expression: node({
                      type: "AssignmentExpression",
                      operator: "=",
                      left: acc_err_id,
                      right: call(member(base_sg_id, "concat"), [
                        acc_err_id,
                        node({
                          type: "MemberExpression",
                          object: errs_id,
                          property: err_idx,
                          computed: true,
                          optional: false,
                        }),
                      ]),
                    }),
                  }),
                ]),
              }),
              ret(
                as_const(
                  node({
                    type: "ArrayExpression",
                    elements: [literal("invalid"), acc_err_id, base_sg_id],
                  }),
                ),
              ),
            ]),
            alternate: null,
          }),
          ret(
            as_const(
              node({
                type: "ArrayExpression",
                elements: [literal("valid"), wrap_collection(out_id)],
              }),
            ),
          ),
        ];
        return {
          expression: call(dict_id, [call(arrow([], block(inner_stmts)), [])]),
          direct: true,
        };
      }

      // mode === "either": return raw ["Left", err] / ["Right", out] and wrap once with Either(...)
      if (can_short_circuit) {
        const inner_stmts = make_prealloc_stmts(
          [],
          (emit_value) => [
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: elided.test,
              }),
              consequent: ret(
                as_const(
                  node({
                    type: "ArrayExpression",
                    elements: [literal("Left"), elided.err_expr!],
                  }),
                ),
              ),
              alternate: null,
            }),
            emit_value(elided.ok_expr),
          ],
          as_const(
            node({
              type: "ArrayExpression",
              elements: [literal("Right"), wrap_collection(empty_array())],
            }),
          ),
          as_const(
            node({
              type: "ArrayExpression",
              elements: [literal("Right"), wrap_collection(out_id)],
            }),
          ),
        );
        return {
          expression: call(dict_id, [call(arrow([], block(inner_stmts)), [])]),
          direct: true,
        };
      }

      // Applicative Either elided cond: evaluate all elements, keep first Left error.
      const errs_id = services.fresh("trav_errs");
      const ok_v = services.fresh("trav_v");
      const err_v = services.fresh("trav_e");
      const errs_empty = node({
        type: "BinaryExpression",
        operator: "===",
        left: member(errs_id, "length"),
        right: literal(0),
      });
      const loop_body: Statement[] = [
        variable(item_id, elem_access, "const"),
        node({
          type: "IfStatement",
          test: elided.test,
          consequent: block([
            variable(ok_v, elided.ok_expr, "const"),
            node({
              type: "IfStatement",
              test: errs_empty,
              consequent: node({
                type: "ExpressionStatement",
                expression: call(member(out_id, "push"), [ok_v]),
              }),
              alternate: null,
            }),
          ]),
          alternate: block([
            variable(err_v, elided.err_expr!, "const"),
            node({
              type: "IfStatement",
              test: errs_empty,
              consequent: node({
                type: "ExpressionStatement",
                expression: call(member(errs_id, "push"), [err_v]),
              }),
              alternate: null,
            }),
          ]),
        }),
      ];
      const inner_stmts: Statement[] = [
        variable(src_id, items_expr, "const"),
        variable(
          out_id,
          node({ type: "ArrayExpression", elements: Array.from([]) }),
          "const",
        ),
        variable(
          errs_id,
          node({ type: "ArrayExpression", elements: Array.from([]) }),
          "const",
        ),
        make_loop(loop_body),
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: ">",
            left: member(errs_id, "length"),
            right: literal(0),
          }),
          consequent: ret(
            as_const(
              node({
                type: "ArrayExpression",
                elements: [
                  literal("Left"),
                  node({
                    type: "MemberExpression",
                    object: errs_id,
                    property: literal(0),
                    computed: true,
                    optional: false,
                  }),
                ],
              }),
            ),
          ),
          alternate: null,
        }),
        ret(
          as_const(
            node({
              type: "ArrayExpression",
              elements: [literal("Right"), wrap_collection(out_id)],
            }),
          ),
        ),
      ];
      return {
        expression: call(dict_id, [call(arrow([], block(inner_stmts)), [])]),
        direct: true,
      };
    }

    // General path (arbitrary callback or non-elided inline body):
    // Leave opaque Validation callbacks to runtime traverse_validation, which has direct access
    // to the module-private array_validation_semigroup fast path.
    if (mode === "validation") return undefined;
    // Skip for non-inline unannotated arrows where parameter type would be implicit any.
    let fn_id: IdentifierReference | undefined;
    if (
      inlined_body === undefined && fn_expr !== undefined &&
      fn_unwrapped !== undefined
    ) {
      let annotated_fn = fn_expr;
      if (
        (fn_unwrapped.type === "ArrowFunctionExpression" ||
          fn_unwrapped.type === "FunctionExpression") &&
        fn_unwrapped.params.length >= 1
      ) {
        const p0 = fn_unwrapped.params[0];
        if (p0.type === "Identifier" && p0.typeAnnotation == null) {
          annotated_fn = {
            ...fn_unwrapped,
            params: [
              {
                ...p0,
                typeAnnotation: node({
                  type: "TSTypeAnnotation",
                  typeAnnotation: node({
                    type: "TSIndexedAccessType",
                    objectType: node({
                      type: "TSTypeQuery",
                      exprName: src_id,
                      typeArguments: null,
                    }),
                    indexType: node({ type: "TSNumberKeyword" }),
                  }),
                }),
              },
              ...fn_unwrapped.params.slice(1),
            ],
          };
        } else if (
          p0.type !== "Identifier" && p0.type !== "TSParameterProperty" &&
          p0.typeAnnotation == null
        ) {
          return undefined;
        }
      }
      fn_id = services.fresh("trav_fn");
      fn_expr = annotated_fn;
    }

    const call_step = (): Expression =>
      inlined_body !== undefined ? inlined_body : call(fn_id!, [item_id]);

    if (mode === "identity") {
      const pre = fn_id !== undefined
        ? [variable(fn_id, fn_expr!, "const")]
        : [];
      const setup = make_prealloc_stmts(
        pre,
        (emit_value) => [emit_value(call(member(call_step(), "value"), []))],
        wrap_ok(wrap_collection(empty_array())),
        wrap_ok(wrap_collection(out_id)),
      );
      return { expression: call(arrow([], block(setup)), []), direct: true };
    }

    if (mode === "maybe") {
      const cur_id = services.fresh("trav_raw");
      if (is_sequential) {
        const pre = fn_id !== undefined
          ? [variable(fn_id, fn_expr!, "const")]
          : [];
        const setup = make_prealloc_stmts(
          pre,
          (emit_value) => [
            variable(cur_id, call(member(call_step(), "value"), []), "const"),
            node({
              type: "IfStatement",
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
                right: literal("Nothing"),
              }),
              consequent: ret(
                node({
                  type: "TSAsExpression",
                  expression: fail_nothing(),
                  typeAnnotation: node({ type: "TSNeverKeyword" }),
                }),
              ),
              alternate: null,
            }),
            emit_value(
              node({
                type: "MemberExpression",
                object: cur_id,
                property: literal(1),
                computed: true,
                optional: false,
              }),
            ),
          ],
          wrap_ok(wrap_collection(empty_array())),
          wrap_ok(wrap_collection(out_id)),
        );
        return { expression: call(arrow([], block(setup)), []), direct: true };
      }
      const setup: Statement[] = [variable(src_id, items_expr, "const")];
      if (fn_id !== undefined) setup.push(variable(fn_id, fn_expr!, "const"));
      setup.push(
        variable(out_id, empty_array(), "const"),
      );
      {
        const failed_id = services.fresh("trav_failed");
        setup.push(
          variable(failed_id, literal(false), "let"),
          make_loop([
            variable(item_id, elem_access, "const"),
            variable(cur_id, call(member(call_step(), "value"), []), "const"),
            node({
              type: "IfStatement",
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
                right: literal("Nothing"),
              }),
              consequent: node({
                type: "ExpressionStatement",
                expression: node({
                  type: "AssignmentExpression",
                  operator: "=",
                  left: failed_id,
                  right: literal(true),
                }),
              }),
              alternate: node({
                type: "IfStatement",
                test: node({
                  type: "UnaryExpression",
                  operator: "!",
                  prefix: true,
                  argument: failed_id,
                }),
                consequent: node({
                  type: "ExpressionStatement",
                  expression: call(member(out_id, "push"), [
                    node({
                      type: "MemberExpression",
                      object: cur_id,
                      property: literal(1),
                      computed: true,
                      optional: false,
                    }),
                  ]),
                }),
                alternate: null,
              }),
            }),
          ]),
          node({
            type: "IfStatement",
            test: failed_id,
            consequent: ret(
              node({
                type: "TSAsExpression",
                expression: fail_nothing(),
                typeAnnotation: node({ type: "TSNeverKeyword" }),
              }),
            ),
            alternate: null,
          }),
          ret(wrap_ok(wrap_collection(out_id))),
        );
      }
      return { expression: call(arrow([], block(setup)), []), direct: true };
    }

    // mode === "either" general path: return raw tuple from inner IIFE and wrap once with Either(...)
    if (is_sequential) {
      const cur_id = services.fresh("trav_raw");
      const pre = fn_id !== undefined
        ? [variable(fn_id, fn_expr!, "const")]
        : [];
      const setup = make_prealloc_stmts(
        pre,
        (emit_value) => [
          variable(cur_id, call(member(call_step(), "value"), []), "const"),
          node({
            type: "IfStatement",
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
              right: literal("Left"),
            }),
            consequent: ret(cur_id),
            alternate: null,
          }),
          emit_value(
            node({
              type: "MemberExpression",
              object: cur_id,
              property: literal(1),
              computed: true,
              optional: false,
            }),
          ),
        ],
        as_const(
          node({
            type: "ArrayExpression",
            elements: [literal("Right"), wrap_collection(empty_array())],
          }),
        ),
        as_const(
          node({
            type: "ArrayExpression",
            elements: [literal("Right"), wrap_collection(out_id)],
          }),
        ),
      );
      return {
        expression: call(dict_id, [call(arrow([], block(setup)), [])]),
        direct: true,
      };
    }

    // mode === "either" applicative general path: evaluate all items, keep first Left.
    // PPF-07: Zero error-array allocation when left type is known via Either.with_left<E>() or fn_id.
    const cur_id = services.fresh("trav_raw");
    const setup: Statement[] = [variable(src_id, items_expr, "const")];
    if (fn_id !== undefined) setup.push(variable(fn_id, fn_expr!, "const"));
    if (dict.left_type !== undefined) {
      const err_id = services.fresh("trav_err");
      const left_tuple_type: TSType = node({
        type: "TSTypeOperator",
        operator: "readonly",
        typeAnnotation: node({
          type: "TSTupleType",
          elementTypes: Array.from<TSType>([
            node({
              type: "TSLiteralType",
              literal: node({ type: "Literal", value: "Left", raw: '"Left"' }),
            }),
            dict.left_type,
          ]),
        }),
      });
      const err_type: TSType = node({
        type: "TSUnionType",
        types: Array.from<TSType>([
          left_tuple_type,
          node({ type: "TSUndefinedKeyword" }),
        ]),
      });
      const no_err = node({
        type: "BinaryExpression",
        operator: "===",
        left: err_id,
        right: void_zero(),
      });
      setup.push(
        variable(out_id, empty_array(), "const"),
        variable(err_id, void_zero(), "let", err_type),
        make_loop([
          variable(item_id, elem_access, "const"),
          variable(cur_id, call(member(call_step(), "value"), []), "const"),
          node({
            type: "IfStatement",
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
              right: literal("Left"),
            }),
            consequent: node({
              type: "IfStatement",
              test: no_err,
              consequent: node({
                type: "ExpressionStatement",
                expression: node({
                  type: "AssignmentExpression",
                  operator: "=",
                  left: err_id,
                  right: cur_id,
                }),
              }),
              alternate: null,
            }),
            alternate: node({
              type: "IfStatement",
              test: no_err,
              consequent: node({
                type: "ExpressionStatement",
                expression: call(member(out_id, "push"), [
                  node({
                    type: "MemberExpression",
                    object: cur_id,
                    property: literal(1),
                    computed: true,
                    optional: false,
                  }),
                ]),
              }),
              alternate: null,
            }),
          }),
        ]),
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: "!==",
            left: err_id,
            right: void_zero(),
          }),
          consequent: ret(err_id),
          alternate: null,
        }),
        ret(
          as_const(
            node({
              type: "ArrayExpression",
              elements: [literal("Right"), wrap_collection(out_id)],
            }),
          ),
        ),
      );
      return {
        expression: call(dict_id, [call(arrow([], block(setup)), [])]),
        direct: true,
      };
    }
    const errs_id = services.fresh("trav_errs");
    const errs_empty = node({
      type: "BinaryExpression",
      operator: "===",
      left: member(errs_id, "length"),
      right: literal(0),
    });
    setup.push(
      variable(
        out_id,
        node({ type: "ArrayExpression", elements: Array.from([]) }),
        "const",
      ),
      variable(
        errs_id,
        node({ type: "ArrayExpression", elements: Array.from([]) }),
        "const",
      ),
      make_loop([
        variable(item_id, elem_access, "const"),
        variable(cur_id, call(member(call_step(), "value"), []), "const"),
        node({
          type: "IfStatement",
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
            right: literal("Left"),
          }),
          consequent: node({
            type: "IfStatement",
            test: errs_empty,
            consequent: node({
              type: "ExpressionStatement",
              expression: call(member(errs_id, "push"), [cur_id]),
            }),
            alternate: null,
          }),
          alternate: node({
            type: "IfStatement",
            test: errs_empty,
            consequent: node({
              type: "ExpressionStatement",
              expression: call(member(out_id, "push"), [
                node({
                  type: "MemberExpression",
                  object: cur_id,
                  property: literal(1),
                  computed: true,
                  optional: false,
                }),
              ]),
            }),
            alternate: null,
          }),
        }),
      ]),
      node({
        type: "IfStatement",
        test: node({
          type: "BinaryExpression",
          operator: ">",
          left: member(errs_id, "length"),
          right: literal(0),
        }),
        consequent: ret(
          node({
            type: "MemberExpression",
            object: errs_id,
            property: literal(0),
            computed: true,
            optional: false,
          }),
        ),
        alternate: null,
      }),
      ret(
        as_const(
          node({
            type: "ArrayExpression",
            elements: [literal("Right"), wrap_collection(out_id)],
          }),
        ),
      ),
    );
    return {
      expression: call(dict_id, [call(arrow([], block(setup)), [])]),
      direct: true,
    };
  }

  // =========================================================================
  // P5a: Direct match(val, { ... }) & val.match({ ... }) fusion
  // =========================================================================
  type TaggedKind = "maybe" | "either" | "validation" | "list";

  function lookup_type_alias(name: string): TSType | undefined {
    for (const stmt of services.program.body) {
      if (
        stmt.type === "TSTypeAliasDeclaration" && stmt.id.name === name
      ) return stmt.typeAnnotation;
      if (
        stmt.type === "ExportNamedDeclaration" &&
        stmt.declaration?.type === "TSTypeAliasDeclaration" &&
        stmt.declaration.id.name === name
      ) return stmt.declaration.typeAnnotation;
    }
    return undefined;
  }

  function is_raw_tagged_tuple_type(
    ts_type: TSType | null | undefined,
    seen?: Set<string>,
  ): boolean {
    if (ts_type == null) return false;
    if (ts_type.type === "TSParenthesizedType") {
      return is_raw_tagged_tuple_type(ts_type.typeAnnotation, seen);
    }
    if (
      ts_type.type === "TSTypeOperator" && ts_type.operator === "readonly"
    ) {
      return is_raw_tagged_tuple_type(ts_type.typeAnnotation, seen);
    }
    if (ts_type.type === "TSTupleType") {
      if (ts_type.elementTypes.length === 0) return false;
      const first = ts_type.elementTypes[0];
      const elem = first.type === "TSNamedTupleMember"
        ? first.elementType
        : first;
      return elem.type === "TSLiteralType" &&
        elem.literal.type === "Literal" &&
        typeof elem.literal.value === "string";
    }
    if (ts_type.type === "TSUnionType") {
      return ts_type.types.length > 0 &&
        ts_type.types.every((t) => is_raw_tagged_tuple_type(t, seen));
    }
    if (
      ts_type.type === "TSTypeReference" &&
      ts_type.typeName.type === "Identifier" &&
      ts_type.typeArguments == null
    ) {
      const name = ts_type.typeName.name;
      if (services.imports.tagged_type_names?.has(name)) return false;
      const next_seen = seen ?? new Set<string>();
      if (next_seen.has(name)) return false;
      next_seen.add(name);
      const aliased = lookup_type_alias(name);
      if (aliased !== undefined) {
        return is_raw_tagged_tuple_type(aliased, next_seen);
      }
    }
    return false;
  }

  function expr_is_raw_tagged_tuple(expr: Expression): boolean {
    const val = parentheses(expr);
    if (val.type === "ArrayExpression") return true;
    if (val.type === "Identifier") {
      const decl = services.bindings.resolve(val);
      if (decl === null) return false;
      if (decl.type === "Identifier") {
        return is_raw_tagged_tuple_type(decl.typeAnnotation?.typeAnnotation);
      }
      if (decl.type === "VariableDeclarator") {
        if (decl.id.type === "Identifier" && decl.id.typeAnnotation != null) {
          if (is_raw_tagged_tuple_type(decl.id.typeAnnotation.typeAnnotation)) {
            return true;
          }
        }
        if (decl.init !== null) {
          return expr_is_raw_tagged_tuple(decl.init);
        }
      }
    }
    return false;
  }

  function type_annotation_tagged_kind(
    ts_type: TSType | null | undefined,
    element_mode: boolean,
  ): TaggedKind | undefined {
    if (ts_type == null) return undefined;
    if (ts_type.type === "TSParenthesizedType") {
      return type_annotation_tagged_kind(ts_type.typeAnnotation, element_mode);
    }
    if (element_mode) {
      if (ts_type.type === "TSArrayType") {
        return type_annotation_tagged_kind(ts_type.elementType, false);
      }
      if (
        ts_type.type === "TSTypeOperator" && ts_type.operator === "readonly"
      ) {
        return type_annotation_tagged_kind(ts_type.typeAnnotation, true);
      }
      if (
        ts_type.type === "TSTypeReference" &&
        ts_type.typeName.type === "Identifier" &&
        (ts_type.typeName.name === "Array" ||
          ts_type.typeName.name === "ReadonlyArray") &&
        ts_type.typeArguments != null &&
        ts_type.typeArguments.params.length === 1
      ) {
        return type_annotation_tagged_kind(
          ts_type.typeArguments.params[0],
          false,
        );
      }
      return undefined;
    }
    if (
      ts_type.type === "TSTypeReference" &&
      ts_type.typeName.type === "Identifier"
    ) {
      return services.imports.tagged_type_names?.get(ts_type.typeName.name);
    }
    return undefined;
  }

  function identifier_tagged_kind(
    ident: IdentifierReference,
    element_mode: boolean,
  ): TaggedKind | undefined {
    const decl = services.bindings.resolve(ident);
    if (decl === null) return undefined;
    if (decl.type === "Identifier") {
      return type_annotation_tagged_kind(
        decl.typeAnnotation?.typeAnnotation,
        element_mode,
      );
    }
    if (decl.type === "VariableDeclarator") {
      if (decl.id.type === "Identifier" && decl.id.typeAnnotation != null) {
        const from_ann = type_annotation_tagged_kind(
          decl.id.typeAnnotation.typeAnnotation,
          element_mode,
        );
        if (from_ann !== undefined) return from_ann;
      }
      if (!element_mode && decl.init !== null) {
        return expr_wrapped_tagged_kind(decl.init);
      }
    }
    return undefined;
  }

  function expr_wrapped_tagged_kind(expr: Expression): TaggedKind | undefined {
    const val = parentheses(expr);
    if (val.type === "Identifier") {
      return identifier_tagged_kind(val, false);
    }
    if (
      val.type === "MemberExpression" && val.computed && !val.optional &&
      val.object.type === "Identifier"
    ) {
      return identifier_tagged_kind(val.object, true);
    }
    if (val.type === "CallExpression" && !val.optional) {
      const c = parentheses(val.callee);
      if (c.type === "Identifier" && services.bindings.imported(c)) {
        if (
          services.imports.just_constructors?.has(c.name) ||
          services.imports.nothing_constructors?.has(c.name) ||
          services.imports.direct_maybe_dictionaries?.has(c.name) ||
          services.imports.from_nullable_functions?.has(c.name) ||
          services.imports.either_hush_functions?.has(c.name)
        ) return "maybe";
        if (
          services.imports.left_constructors?.has(c.name) ||
          services.imports.right_constructors?.has(c.name) ||
          services.imports.direct_either_dictionaries?.has(c.name) ||
          services.imports.either_from_number_functions?.has(c.name) ||
          services.imports.either_try_catch_functions?.has(c.name) ||
          services.imports.either_note_functions?.has(c.name) ||
          services.imports.maybe_to_either_functions?.has(c.name) ||
          services.imports.validation_to_either_functions?.has(c.name) ||
          services.imports.either_map_left_functions?.has(c.name) ||
          services.imports.either_bind_widen_functions?.has(c.name)
        ) return "either";
        if (
          services.imports.validation_constructors?.has(c.name) ||
          services.imports.direct_validation_dictionaries?.has(c.name) ||
          services.imports.valid_constructors?.has(c.name) ||
          services.imports.invalid_constructors?.has(c.name) ||
          services.imports.invalid_messages_constructors?.has(c.name)
        ) {
          return "validation";
        }
        if (
          services.imports.list_constructors?.has(c.name) ||
          services.imports.list_from_array_functions?.has(c.name) ||
          services.imports.nil_constructors?.has(c.name) ||
          services.imports.cons_constructors?.has(c.name)
        ) return "list";
      } else if (
        c.type === "MemberExpression" && !c.computed && !c.optional &&
        c.object.type === "Identifier" && c.property.type === "Identifier" &&
        services.bindings.imported(c.object)
      ) {
        const obj = c.object.name;
        const prop = c.property.name;
        if (
          services.imports.direct_maybe_dictionaries?.has(obj) &&
          (prop === "Just" || prop === "Nothing" || prop === "pure" ||
            prop === "empty")
        ) return "maybe";
        if (
          services.imports.direct_either_dictionaries?.has(obj) &&
          (prop === "Right" || prop === "Left" || prop === "pure")
        ) return "either";
        if (
          services.imports.direct_validation_dictionaries?.has(obj) &&
          (prop === "Valid" || prop === "Invalid" || prop === "pure")
        ) return "validation";
        if (
          (services.imports.list_constructors?.has(obj) ||
            services.imports.list_namespaces?.has(obj)) &&
          (prop === "Cons" || prop === "Nil" || prop === "pure" ||
            prop === "empty" || prop === "from_array")
        ) return "list";
      }
    }
    return undefined;
  }

  function match_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    const callee = parentheses(outer.callee);
    let subject: Expression | undefined;
    let cases_expr: Expression | undefined;
    let subject_kind: TaggedKind | undefined;
    let is_raw_tuple = false;

    if (
      outer.arguments.length === 2 &&
      (is_imported_from_set(callee, services.imports.match_functions) ||
        is_ns_member(callee, services.imports.match_namespaces, "match"))
    ) {
      subject = outer.arguments[0] as Expression;
      cases_expr = outer.arguments[1] as Expression;
      subject_kind = expr_wrapped_tagged_kind(subject);
      if (subject_kind === undefined) {
        if (expr_is_raw_tagged_tuple(subject)) {
          is_raw_tuple = true;
        } else {
          return undefined;
        }
      }
    } else if (
      outer.arguments.length === 1 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "match"
    ) {
      subject = callee.object;
      cases_expr = outer.arguments[0] as Expression;
      subject_kind = expr_wrapped_tagged_kind(subject);
      if (subject_kind === undefined) return undefined;
    } else {
      return undefined;
    }

    const obj = parentheses(cases_expr);
    if (obj.type !== "ObjectExpression" || obj.properties.length === 0) {
      return undefined;
    }
    if (lexical_hazard(subject) || contains_await_yield(subject)) {
      return undefined;
    }

    type MatchCase = {
      readonly tag: string;
      readonly params: readonly BindingPattern[];
      readonly all_simple_idents: boolean;
      readonly expr_body?: Expression;
      readonly block_body?: BlockStatement;
    };

    const cases: MatchCase[] = [];
    const seen = new Set<string>();
    for (const prop of obj.properties) {
      if (
        prop.type !== "Property" || prop.kind !== "init" || prop.computed
      ) return undefined;
      let tag: string;
      if (prop.key.type === "Identifier") tag = prop.key.name;
      else if (
        prop.key.type === "Literal" && typeof prop.key.value === "string"
      ) tag = prop.key.value;
      else return undefined;
      if (tag === "__proto__" || seen.has(tag)) return undefined;
      seen.add(tag);

      const fn = unwrap(prop.value as Expression);
      if (
        (fn.type !== "ArrowFunctionExpression" &&
          fn.type !== "FunctionExpression") ||
        fn.async || fn.generator || fn.typeParameters != null ||
        fn.returnType != null || fn.body === null
      ) return undefined;
      if (lexical_hazard(fn) || contains_await_yield(fn.body)) return undefined;

      const params: BindingPattern[] = [];
      let all_simple_idents = true;
      for (const param of fn.params) {
        if (
          (param.type !== "Identifier" && param.type !== "ObjectPattern" &&
            param.type !== "ArrayPattern" &&
            param.type !== "AssignmentPattern") ||
          param.optional ||
          (param.decorators !== undefined && param.decorators.length > 0)
        ) return undefined;
        if (param.type !== "Identifier") all_simple_idents = false;
        params.push(param as BindingPattern);
      }

      if (
        fn.type === "ArrowFunctionExpression" &&
        fn.body.type !== "BlockStatement"
      ) {
        cases.push({
          tag,
          params,
          all_simple_idents,
          expr_body: fn.body as Expression,
        });
      } else {
        cases.push({
          tag,
          params,
          all_simple_idents,
          block_body: fn.body as BlockStatement,
        });
      }
    }

    const raw_id = services.fresh("match_raw");
    const raw_init: Expression = is_raw_tuple
      ? subject
      : call(member(subject, "value"), []);

    const payload_access = (param_idx: number): Expression =>
      node({
        type: "MemberExpression",
        object: raw_id,
        property: literal(param_idx + 1),
        computed: true,
        optional: false,
      });

    // Fast path: 2-case exhaustive library tagged union with expression-body arrows -> single ternary!
    const is_known_pair = (a: string, b: string): boolean => {
      if (subject_kind === "maybe") {
        return (a === "Just" && b === "Nothing") ||
          (a === "Nothing" && b === "Just");
      }
      if (subject_kind === "either") {
        return (a === "Right" && b === "Left") ||
          (a === "Left" && b === "Right");
      }
      if (subject_kind === "validation") {
        return (a === "valid" && b === "invalid") ||
          (a === "invalid" && b === "valid");
      }
      if (subject_kind === "list") {
        return (a === "Cons" && b === "Nil") ||
          (a === "Nil" && b === "Cons");
      }
      return false;
    };

    if (
      cases.length === 2 &&
      cases[0].all_simple_idents &&
      cases[1].all_simple_idents &&
      cases[0].expr_body !== undefined &&
      cases[1].expr_body !== undefined &&
      is_known_pair(cases[0].tag, cases[1].tag)
    ) {
      const inline_case_expr = (c: MatchCase): Expression | undefined => {
        let result = c.expr_body!;
        for (let i = 0; i < c.params.length; i += 1) {
          const decl = services.bindings.resolve(
            c.params[i] as BindingIdentifier,
          );
          if (decl === null) return undefined;
          result = substitute_ident(result, decl, payload_access(i), services);
        }
        return result;
      };
      const first_expr = inline_case_expr(cases[0]);
      const second_expr = inline_case_expr(cases[1]);
      if (first_expr !== undefined && second_expr !== undefined) {
        const cond: Expression = node({
          type: "ConditionalExpression",
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
            right: literal(cases[0].tag),
          }),
          consequent: first_expr,
          alternate: second_expr,
        });
        return {
          expression: call(
            arrow([], block([variable(raw_id, raw_init, "const"), ret(cond)])),
            [],
          ),
          direct: true,
        };
      }
    }

    // General path: switch (match_raw[0]) { case "Tag": { ... } ... }
    const switch_cases: SwitchCase[] = cases.map((c) => {
      const case_stmts: Statement[] = [];
      for (let i = 0; i < c.params.length; i += 1) {
        const p = c.params[i];
        case_stmts.push(
          variable(
            p.type === "Identifier" ? id(p.name) : p,
            payload_access(i),
            "const",
          ),
        );
      }
      if (c.expr_body !== undefined) {
        case_stmts.push(ret(c.expr_body));
      } else {
        case_stmts.push(...(c.block_body!.body as Statement[]));
        const last = case_stmts[case_stmts.length - 1];
        if (
          last?.type !== "ReturnStatement" && last?.type !== "ThrowStatement"
        ) {
          case_stmts.push(ret(void_zero()));
        }
      }
      return node({
        type: "SwitchCase",
        test: literal(c.tag),
        consequent: Array.from<Statement>([block(case_stmts)]),
      });
    });

    const tag_access: Expression = node({
      type: "MemberExpression",
      object: raw_id,
      property: literal(0),
      computed: true,
      optional: false,
    });

    switch_cases.push(
      node({
        type: "SwitchCase",
        test: null,
        consequent: Array.from<Statement>([
          node({
            type: "ThrowStatement",
            argument: node({
              type: "NewExpression",
              callee: id("TypeError"),
              arguments: [
                node({
                  type: "BinaryExpression",
                  operator: "+",
                  left: literal("No match handler for tag "),
                  right: call(id("String"), [tag_access]),
                }),
              ],
            }),
          }),
        ]),
      }),
    );

    const body_stmts: Statement[] = [
      variable(raw_id, raw_init, "const"),
      node({
        type: "SwitchStatement",
        discriminant: tag_access,
        cases: switch_cases,
      }),
    ];

    return {
      expression: call(arrow([], block(body_stmts)), []),
      direct: true,
    };
  }

  // =========================================================================
  // Shared helper: avoid swallowing nested generator calls inside chain lambdas
  // =========================================================================
  function contains_generator_or_do(root: Node): boolean {
    let found = false;
    walk(root, (child) => {
      if (found) return false;
      if (
        (child.type === "FunctionExpression" ||
          child.type === "FunctionDeclaration") && child.generator
      ) {
        found = true;
        return false;
      }
      if (
        child.type === "CallExpression" &&
        services.kind(child) !== undefined
      ) {
        found = true;
        return false;
      }
    });
    return found;
  }

  function extract_single_return_body(
    body: BlockStatement,
  ): Expression | undefined {
    if (body.body.length !== 1) return undefined;
    const only = body.body[0];
    if (only.type !== "ReturnStatement" || only.argument === null) {
      return undefined;
    }
    return only.argument;
  }

  function extract_unary_arrow(
    expr: Expression,
  ):
    | {
      readonly param_decl: Node | null;
      readonly body: Expression;
      readonly call_ref?: Expression;
    }
    | undefined {
    const fn = unwrap(expr);
    if (
      fn.type === "ArrowFunctionExpression" && !fn.async && !fn.generator &&
      fn.typeParameters == null && fn.returnType == null &&
      !lexical_hazard(fn) && !contains_await_yield(fn.body) &&
      !contains_generator_or_do(fn.body)
    ) {
      const body_expr = fn.body.type === "BlockStatement"
        ? extract_single_return_body(fn.body)
        : (fn.body as Expression);
      if (body_expr === undefined) return undefined;
      if (fn.params.length === 0) {
        return { param_decl: null, body: body_expr };
      }
      if (fn.params.length !== 1) return undefined;
      const p0 = fn.params[0];
      if (
        p0.type !== "Identifier" || p0.optional ||
        (p0.decorators !== undefined && p0.decorators.length > 0)
      ) return undefined;
      const decl = services.bindings.resolve(p0);
      if (decl === null) return undefined;
      return { param_decl: decl, body: body_expr };
    }
    // Named function / pure callable reference (e.g. `double`, `parse_int`, `Math.abs`)
    if (
      (fn.type === "Identifier" ||
        (fn.type === "MemberExpression" && !fn.computed && !fn.optional &&
          is_pure_no_call(fn))) &&
      !lexical_hazard(fn) && !contains_await_yield(fn) &&
      !contains_generator_or_do(fn)
    ) {
      return { param_decl: null, body: fn, call_ref: fn };
    }
    return undefined;
  }

  function apply_unary(
    parsed: {
      readonly param_decl: Node | null;
      readonly body: Expression;
      readonly call_ref?: Expression;
    },
    arg: Expression,
  ): Expression {
    if (parsed.call_ref !== undefined) {
      return call(parsed.call_ref, [arg]);
    }
    return parsed.param_decl !== null
      ? substitute_ident(parsed.body, parsed.param_decl, arg, services)
      : parsed.body;
  }

  function extract_binary_arrow(
    expr: Expression,
  ):
    | {
      readonly first_decl: Node | null;
      readonly second_decl: Node | null;
      readonly body: Expression;
    }
    | undefined {
    const fn = unwrap(expr);
    if (
      fn.type !== "ArrowFunctionExpression" || fn.async || fn.generator ||
      fn.typeParameters != null || fn.returnType != null ||
      fn.params.length > 2 ||
      lexical_hazard(fn) || contains_await_yield(fn.body) ||
      contains_generator_or_do(fn.body)
    ) return undefined;
    const body_expr = fn.body.type === "BlockStatement"
      ? extract_single_return_body(fn.body)
      : (fn.body as Expression);
    if (body_expr === undefined) return undefined;
    let first_decl: Node | null = null;
    let second_decl: Node | null = null;
    for (let i = 0; i < fn.params.length; i += 1) {
      const p = fn.params[i];
      if (
        p.type !== "Identifier" || p.optional ||
        (p.decorators !== undefined && p.decorators.length > 0)
      ) return undefined;
      const decl = services.bindings.resolve(p);
      if (decl === null) return undefined;
      if (i === 0) first_decl = decl;
      else second_decl = decl;
    }
    return { first_decl, second_decl, body: body_expr };
  }

  // =========================================================================
  // P7 + PPF-06 + PPF-08: Maybe, Either & Validation chain fusion
  // =========================================================================
  type ChainMode = "maybe" | "either" | "validation";
  type UnarySpec = {
    readonly param_decl: Node | null;
    readonly body: Expression;
    readonly call_ref?: Expression;
  };
  type ChainRoot =
    | {
      readonly kind: "just";
      readonly value: Expression;
      readonly value_type?: TSType;
    }
    | { readonly kind: "nothing"; readonly value_type?: TSType }
    | {
      readonly kind: "right";
      readonly value: Expression;
      readonly value_type?: TSType;
    }
    | {
      readonly kind: "left";
      readonly value: Expression;
      readonly err_type?: TSType;
    }
    | {
      readonly kind: "valid";
      readonly value: Expression;
      readonly value_type?: TSType;
    }
    | {
      readonly kind: "from_nullable";
      readonly value: Expression;
    }
    | {
      readonly kind: "from_number";
      readonly value: Expression;
    }
    | {
      readonly kind: "try_catch";
      readonly fn: Expression;
      readonly on_err: Expression;
    }
    | { readonly kind: "wrapped"; readonly expr: Expression };
  type ChainStage =
    | {
      readonly kind: "map" | "bind" | "filter";
      readonly fn: UnarySpec;
    }
    | { readonly kind: "hush" }
    | { readonly kind: "note"; readonly error: Expression }
    | { readonly kind: "validation_to_either" }
    | { readonly kind: "map_left"; readonly fn: UnarySpec }
    | {
      readonly kind: "bimap";
      readonly left_fn: UnarySpec;
      readonly right_fn: UnarySpec;
    }
    | { readonly kind: "catch_error"; readonly fn: UnarySpec }
    | { readonly kind: "alt"; readonly fallback: Expression };
  type ChainTerminal =
    | { readonly kind: "wrap" }
    | { readonly kind: "from_maybe"; readonly fallback: Expression }
    | { readonly kind: "get_or_else"; readonly fallback_fn: Expression }
    | {
      readonly kind: "maybe_fold";
      readonly fallback: Expression;
      readonly ok_fn: UnarySpec;
    }
    | { readonly kind: "to_nullable" }
    | { readonly kind: "from_right"; readonly fallback: Expression }
    | { readonly kind: "from_left"; readonly fallback: Expression }
    | { readonly kind: "is_left" }
    | { readonly kind: "is_right" }
    | {
      readonly kind: "recover_or_else";
      readonly err_fn: UnarySpec;
    }
    | {
      readonly kind: "match";
      readonly ok_fn: UnarySpec;
      readonly err_fn: UnarySpec;
    };

  function match_chain_root(
    expr: Expression,
    expected?: ChainMode,
  ): {
    readonly mode: ChainMode;
    readonly root: ChainRoot;
    readonly anchor?: string;
  } | undefined {
    const val = parentheses(expr);
    if (
      lexical_hazard(val) || contains_await_yield(val) ||
      contains_generator_or_do(val)
    ) return undefined;
    if (
      val.type === "CallExpression" && !val.optional &&
      !val.arguments.some((a) => a.type === "SpreadElement")
    ) {
      const callee = parentheses(val.callee);
      const anchor = callee.type === "Identifier"
        ? callee.name
        : callee.type === "MemberExpression" &&
            callee.object.type === "Identifier"
        ? callee.object.name
        : undefined;
      if (val.arguments.length === 0) {
        if (expected === undefined || expected === "maybe") {
          const mc = match_ctor_call(val, "maybe");
          if (mc !== undefined && !mc.ok) {
            return {
              mode: "maybe",
              root: {
                kind: "nothing",
                value_type: val.typeArguments?.params[0],
              },
              anchor,
            };
          }
        }
      }
      if (val.arguments.length === 1) {
        const arg = val.arguments[0] as Expression;
        if (
          val.typeArguments == null &&
          (expected === undefined || expected === "maybe") &&
          is_imported_from_set(callee, services.imports.from_nullable_functions)
        ) {
          return {
            mode: "maybe",
            root: { kind: "from_nullable", value: arg },
            anchor,
          };
        }
        if (
          val.typeArguments == null &&
          (expected === undefined || expected === "either") &&
          is_imported_from_set(
            callee,
            services.imports.either_from_number_functions,
          )
        ) {
          return {
            mode: "either",
            root: { kind: "from_number", value: arg },
            anchor,
          };
        }
        if (expected === undefined || expected === "maybe") {
          const mc = match_ctor_call(val, "maybe");
          if (mc !== undefined && mc.ok && mc.arg !== undefined) {
            return {
              mode: "maybe",
              root: { kind: "just", value: mc.arg, value_type: mc.ok_type },
              anchor,
            };
          }
        }
        if (expected === undefined || expected === "either") {
          const ec = match_ctor_call(val, "either");
          if (ec !== undefined && ec.arg !== undefined) {
            if (ec.ok) {
              return {
                mode: "either",
                root: { kind: "right", value: ec.arg, value_type: ec.ok_type },
                anchor,
              };
            }
            return {
              mode: "either",
              root: { kind: "left", value: ec.arg, err_type: ec.err_type },
              anchor,
            };
          }
        }
        if (expected === undefined || expected === "validation") {
          const vc = match_ctor_call(val, "validation");
          if (vc !== undefined && vc.ok && vc.arg !== undefined) {
            return {
              mode: "validation",
              root: { kind: "valid", value: vc.arg, value_type: vc.ok_type },
              anchor,
            };
          }
        }
      }
      if (
        val.arguments.length === 2 && val.typeArguments == null &&
        (expected === undefined || expected === "either") &&
        is_imported_from_set(
          callee,
          services.imports.either_try_catch_functions,
        )
      ) {
        return {
          mode: "either",
          root: {
            kind: "try_catch",
            fn: val.arguments[0] as Expression,
            on_err: val.arguments[1] as Expression,
          },
          anchor,
        };
      }
    }
    const kind = expr_wrapped_tagged_kind(val);
    if (kind === "maybe" && (expected === undefined || expected === "maybe")) {
      return { mode: "maybe", root: { kind: "wrapped", expr: val } };
    }
    if (
      kind === "either" && (expected === undefined || expected === "either")
    ) {
      return { mode: "either", root: { kind: "wrapped", expr: val } };
    }
    if (
      kind === "validation" &&
      (expected === undefined || expected === "validation")
    ) {
      return { mode: "validation", root: { kind: "wrapped", expr: val } };
    }
    return undefined;
  }

  function parse_match_pair(
    cases_expr: Expression,
    mode: ChainMode,
  ): { readonly ok_fn: UnarySpec; readonly err_fn: UnarySpec } | undefined {
    const obj = parentheses(cases_expr);
    if (obj.type !== "ObjectExpression" || obj.properties.length !== 2) {
      return undefined;
    }
    const ok_tag = mode === "maybe"
      ? "Just"
      : mode === "either"
      ? "Right"
      : "valid";
    const err_tag = mode === "maybe"
      ? "Nothing"
      : mode === "either"
      ? "Left"
      : "invalid";
    let ok_arrow: UnarySpec | undefined;
    let err_arrow: UnarySpec | undefined;
    for (const prop of obj.properties) {
      if (
        prop.type !== "Property" || prop.kind !== "init" || prop.computed
      ) return undefined;
      const tag = prop.key.type === "Identifier"
        ? prop.key.name
        : prop.key.type === "Literal" && typeof prop.key.value === "string"
        ? prop.key.value
        : undefined;
      if (tag === ok_tag) {
        ok_arrow = extract_unary_arrow(prop.value as Expression);
      } else if (tag === err_tag) {
        err_arrow = extract_unary_arrow(prop.value as Expression);
      } else return undefined;
    }
    if (ok_arrow === undefined || err_arrow === undefined) return undefined;
    return { ok_fn: ok_arrow, err_fn: err_arrow };
  }

  function maybe_either_chain_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    const callee = parentheses(outer.callee);
    let cursor: Expression | undefined;
    let terminal: ChainTerminal | undefined;
    let expected_mode: ChainMode | undefined;
    let match_cases_expr: Expression | undefined;

    if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.from_maybe_functions)
    ) {
      const fb = outer.arguments[0] as Expression;
      if (
        lexical_hazard(fb) || contains_await_yield(fb) ||
        contains_generator_or_do(fb)
      ) return undefined;
      terminal = { kind: "from_maybe", fallback: fb };
      expected_mode = "maybe";
      cursor = outer.arguments[1] as Expression;
    } else if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.maybe_get_or_else_functions)
    ) {
      const fb_fn = outer.arguments[1] as Expression;
      if (
        lexical_hazard(fb_fn) || contains_await_yield(fb_fn) ||
        contains_generator_or_do(fb_fn)
      ) return undefined;
      terminal = { kind: "get_or_else", fallback_fn: fb_fn };
      expected_mode = "maybe";
      cursor = outer.arguments[0] as Expression;
    } else if (
      outer.arguments.length === 3 &&
      is_imported_from_set(callee, services.imports.maybe_fold_functions)
    ) {
      const fb = outer.arguments[0] as Expression;
      if (
        lexical_hazard(fb) || contains_await_yield(fb) ||
        contains_generator_or_do(fb)
      ) return undefined;
      const ok_arrow = extract_unary_arrow(outer.arguments[1] as Expression);
      if (ok_arrow === undefined) return undefined;
      terminal = { kind: "maybe_fold", fallback: fb, ok_fn: ok_arrow };
      expected_mode = "maybe";
      cursor = outer.arguments[2] as Expression;
    } else if (
      outer.arguments.length === 1 &&
      is_imported_from_set(callee, services.imports.to_nullable_functions)
    ) {
      terminal = { kind: "to_nullable" };
      expected_mode = "maybe";
      cursor = outer.arguments[0] as Expression;
    } else if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.either_from_right_functions)
    ) {
      const fb = outer.arguments[0] as Expression;
      if (
        lexical_hazard(fb) || contains_await_yield(fb) ||
        contains_generator_or_do(fb)
      ) return undefined;
      terminal = { kind: "from_right", fallback: fb };
      expected_mode = "either";
      cursor = outer.arguments[1] as Expression;
    } else if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.either_from_left_functions)
    ) {
      const fb = outer.arguments[0] as Expression;
      if (
        lexical_hazard(fb) || contains_await_yield(fb) ||
        contains_generator_or_do(fb)
      ) return undefined;
      terminal = { kind: "from_left", fallback: fb };
      expected_mode = "either";
      cursor = outer.arguments[1] as Expression;
    } else if (
      outer.arguments.length === 3 &&
      is_imported_from_set(callee, services.imports.either_fold_functions)
    ) {
      const err_arrow = extract_unary_arrow(outer.arguments[0] as Expression);
      const ok_arrow = extract_unary_arrow(outer.arguments[1] as Expression);
      if (err_arrow === undefined || ok_arrow === undefined) return undefined;
      terminal = { kind: "match", ok_fn: ok_arrow, err_fn: err_arrow };
      expected_mode = "either";
      cursor = outer.arguments[2] as Expression;
    } else if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.either_recover_functions)
    ) {
      const err_arrow = extract_unary_arrow(outer.arguments[1] as Expression);
      if (err_arrow === undefined) return undefined;
      terminal = { kind: "recover_or_else", err_fn: err_arrow };
      expected_mode = "either";
      cursor = outer.arguments[0] as Expression;
    } else if (
      outer.arguments.length === 1 &&
      (is_imported_from_set(
        callee,
        services.imports.either_is_left_functions,
      ) ||
        is_imported_from_set(
          callee,
          services.imports.either_is_right_functions,
        ))
    ) {
      // Never intercept bare Identifier so TS type-guard narrowing is preserved.
      const arg = parentheses(outer.arguments[0] as Expression);
      if (arg.type === "Identifier") return undefined;
      terminal = is_imported_from_set(
          callee,
          services.imports.either_is_left_functions,
        )
        ? { kind: "is_left" }
        : { kind: "is_right" };
      expected_mode = "either";
      cursor = outer.arguments[0] as Expression;
    } else if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.maybe_filter_functions)
    ) {
      cursor = outer;
      expected_mode = "maybe";
      terminal = { kind: "wrap" };
    } else if (
      (outer.arguments.length === 1 &&
        (is_imported_from_set(callee, services.imports.either_hush_functions) ||
          is_imported_from_set(
            callee,
            services.imports.validation_to_either_functions,
          ))) ||
      (outer.arguments.length === 2 &&
        (is_imported_from_set(callee, services.imports.either_note_functions) ||
          is_imported_from_set(
            callee,
            services.imports.maybe_to_either_functions,
          ) ||
          is_imported_from_set(
            callee,
            services.imports.either_map_left_functions,
          ) ||
          is_imported_from_set(
            callee,
            services.imports.either_bind_widen_functions,
          ) ||
          is_imported_from_set(
            callee,
            services.imports.prelude_fmap_functions,
          ) ||
          is_ns_member(callee, services.imports.prelude_namespaces, "fmap") ||
          is_imported_from_set(
            callee,
            services.imports.prelude_bind_functions,
          ) ||
          is_ns_member(callee, services.imports.prelude_namespaces, "bind") ||
          is_imported_from_set(
            callee,
            services.imports.prelude_alt_functions,
          ) ||
          is_ns_member(callee, services.imports.prelude_namespaces, "alt") ||
          (callee.type === "MemberExpression" && !callee.computed &&
            !callee.optional && callee.property.type === "Identifier" &&
            callee.property.name === "alt" &&
            is_alternative_obj(parentheses(callee.object))) ||
          (callee.type === "MemberExpression" && !callee.computed &&
            !callee.optional && callee.property.type === "Identifier" &&
            callee.property.name === "catch_error" &&
            is_monad_error_obj(parentheses(callee.object))))) ||
      (outer.arguments.length === 3 &&
        callee.type === "MemberExpression" && !callee.computed &&
        !callee.optional && callee.property.type === "Identifier" &&
        callee.property.name === "bimap" &&
        is_bifunctor_obj(parentheses(callee.object)))
    ) {
      cursor = outer;
      terminal = { kind: "wrap" };
    } else if (
      outer.arguments.length === 2 &&
      (is_imported_from_set(callee, services.imports.match_functions) ||
        is_ns_member(callee, services.imports.match_namespaces, "match"))
    ) {
      cursor = outer.arguments[0] as Expression;
      match_cases_expr = outer.arguments[1] as Expression;
    } else if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier"
    ) {
      const mname = callee.property.name;
      if (mname === "match" && outer.arguments.length === 1) {
        cursor = callee.object;
        match_cases_expr = outer.arguments[0] as Expression;
      } else if (
        (mname === "map" || mname === "bind" || mname === "alt" ||
          mname === "catch_error") &&
        outer.arguments.length === 1
      ) {
        cursor = outer;
        terminal = { kind: "wrap" };
      } else if (mname === "bimap" && outer.arguments.length === 2) {
        cursor = outer;
        terminal = { kind: "wrap" };
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    // Peel stages from outermost inward
    const stages_rev: ChainStage[] = [];
    let peel_expected: ChainMode | undefined = expected_mode;
    while (true) {
      const cur = parentheses(cursor!);
      if (
        cur.type === "CallExpression" && !cur.optional &&
        cur.typeArguments == null &&
        !cur.arguments.some((a) => a.type === "SpreadElement")
      ) {
        const cc = parentheses(cur.callee);
        if (
          cur.arguments.length === 1 &&
          cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
          cc.property.type === "Identifier" &&
          (cc.property.name === "map" || cc.property.name === "bind")
        ) {
          if (cc.property.name === "bind" && peel_expected === "validation") {
            return undefined;
          }
          const parsed = extract_unary_arrow(cur.arguments[0] as Expression);
          if (parsed === undefined) return undefined;
          stages_rev.push({ kind: cc.property.name, fn: parsed });
          cursor = cc.object;
          continue;
        }
        if (
          cur.arguments.length === 2 &&
          (is_imported_from_set(cc, services.imports.prelude_fmap_functions) ||
            is_ns_member(cc, services.imports.prelude_namespaces, "fmap"))
        ) {
          // prelude.fmap(fn, value)
          const parsed = extract_unary_arrow(cur.arguments[0] as Expression);
          if (parsed === undefined) return undefined;
          stages_rev.push({ kind: "map", fn: parsed });
          cursor = cur.arguments[1] as Expression;
          continue;
        }
        if (
          cur.arguments.length === 2 && peel_expected !== "validation" &&
          (is_imported_from_set(cc, services.imports.prelude_bind_functions) ||
            is_ns_member(cc, services.imports.prelude_namespaces, "bind") ||
            is_imported_from_set(
              cc,
              services.imports.either_bind_widen_functions,
            ))
        ) {
          const parsed = extract_unary_arrow(cur.arguments[1] as Expression);
          if (parsed === undefined) return undefined;
          stages_rev.push({ kind: "bind", fn: parsed });
          if (
            is_imported_from_set(
              cc,
              services.imports.either_bind_widen_functions,
            )
          ) peel_expected = "either";
          cursor = cur.arguments[0] as Expression;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "maybe") &&
          cur.arguments.length === 2 &&
          is_imported_from_set(cc, services.imports.maybe_filter_functions)
        ) {
          const parsed = extract_unary_arrow(cur.arguments[1] as Expression);
          if (parsed === undefined) return undefined;
          stages_rev.push({ kind: "filter", fn: parsed });
          peel_expected = "maybe";
          cursor = cur.arguments[0] as Expression;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "maybe") &&
          cur.arguments.length === 1 &&
          is_imported_from_set(cc, services.imports.either_hush_functions)
        ) {
          stages_rev.push({ kind: "hush" });
          expected_mode ??= "maybe";
          peel_expected = "either";
          cursor = cur.arguments[0] as Expression;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "either") &&
          cur.arguments.length === 2 &&
          (is_imported_from_set(cc, services.imports.either_note_functions) ||
            is_imported_from_set(
              cc,
              services.imports.maybe_to_either_functions,
            ))
        ) {
          const err_e = cur.arguments[0] as Expression;
          if (
            lexical_hazard(err_e) || contains_await_yield(err_e) ||
            contains_generator_or_do(err_e)
          ) return undefined;
          stages_rev.push({ kind: "note", error: err_e });
          expected_mode ??= "either";
          peel_expected = "maybe";
          cursor = cur.arguments[1] as Expression;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "either") &&
          cur.arguments.length === 1 &&
          is_imported_from_set(
            cc,
            services.imports.validation_to_either_functions,
          )
        ) {
          stages_rev.push({ kind: "validation_to_either" });
          expected_mode ??= "either";
          peel_expected = "validation";
          cursor = cur.arguments[0] as Expression;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "either") &&
          cur.arguments.length === 2 &&
          is_imported_from_set(cc, services.imports.either_map_left_functions)
        ) {
          const parsed = extract_unary_arrow(cur.arguments[1] as Expression);
          if (parsed === undefined) return undefined;
          stages_rev.push({ kind: "map_left", fn: parsed });
          expected_mode ??= "either";
          peel_expected = "either";
          cursor = cur.arguments[0] as Expression;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "either") &&
          ((cur.arguments.length === 2 &&
            cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
            cc.property.type === "Identifier" &&
            cc.property.name === "bimap") ||
            (cur.arguments.length === 3 &&
              cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
              cc.property.type === "Identifier" &&
              cc.property.name === "bimap" &&
              is_bifunctor_obj(parentheses(cc.object))))
        ) {
          const is_static = cur.arguments.length === 3;
          const l_fn = extract_unary_arrow(
            cur.arguments[is_static ? 1 : 0] as Expression,
          );
          const r_fn = extract_unary_arrow(
            cur.arguments[is_static ? 2 : 1] as Expression,
          );
          if (l_fn === undefined || r_fn === undefined) return undefined;
          stages_rev.push({ kind: "bimap", left_fn: l_fn, right_fn: r_fn });
          expected_mode ??= "either";
          peel_expected = "either";
          cursor = is_static ? (cur.arguments[0] as Expression) : cc.object;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "either") &&
          ((cur.arguments.length === 1 &&
            cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
            cc.property.type === "Identifier" &&
            cc.property.name === "catch_error") ||
            (cur.arguments.length === 2 &&
              cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
              cc.property.type === "Identifier" &&
              cc.property.name === "catch_error" &&
              is_monad_error_obj(parentheses(cc.object))))
        ) {
          const is_static = cur.arguments.length === 2;
          const h_fn = extract_unary_arrow(
            cur.arguments[is_static ? 1 : 0] as Expression,
          );
          if (h_fn === undefined) return undefined;
          stages_rev.push({ kind: "catch_error", fn: h_fn });
          expected_mode ??= "either";
          peel_expected = "either";
          cursor = is_static ? (cur.arguments[0] as Expression) : cc.object;
          continue;
        }
        if (
          (peel_expected === undefined || peel_expected === "maybe") &&
          ((cur.arguments.length === 1 &&
            cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
            cc.property.type === "Identifier" && cc.property.name === "alt") ||
            (cur.arguments.length === 2 &&
              ((cc.type === "MemberExpression" && !cc.computed &&
                !cc.optional && cc.property.type === "Identifier" &&
                cc.property.name === "alt" &&
                is_alternative_obj(parentheses(cc.object))) ||
                is_imported_from_set(
                  cc,
                  services.imports.prelude_alt_functions,
                ) ||
                is_ns_member(cc, services.imports.prelude_namespaces, "alt"))))
        ) {
          const is_static = cur.arguments.length === 2;
          const fb = cur.arguments[is_static ? 1 : 0] as Expression;
          if (
            lexical_hazard(fb) || contains_await_yield(fb) ||
            contains_generator_or_do(fb)
          ) return undefined;
          const next_cur = is_static
            ? (cur.arguments[0] as Expression)
            : (cc as Extract<Expression, { type: "MemberExpression" }>).object;
          // Only treat alt as Maybe if cursor isn't an ArrayT/List (array_chain_fusion handles ArrayT alt)
          if (unwrap_array_root(next_cur) !== undefined) return undefined;
          stages_rev.push({ kind: "alt", fallback: fb });
          expected_mode ??= "maybe";
          peel_expected = "maybe";
          cursor = next_cur;
          continue;
        }
      }
      break;
    }

    // For match terminals, require at least 1 stage (0-stage match is handled by match_fusion).
    if (match_cases_expr !== undefined && stages_rev.length === 0) {
      return undefined;
    }
    if (terminal?.kind === "wrap" && stages_rev.length === 0) {
      return undefined;
    }

    const root_info = match_chain_root(cursor!, peel_expected);
    if (root_info === undefined) return undefined;
    const stages = stages_rev.reverse();

    // Compute output mode across mode-switching stages
    let cur_mode: ChainMode = root_info.mode;
    let has_complex_stage = false;
    for (const st of stages) {
      if (st.kind === "hush") {
        if (cur_mode !== "either") return undefined;
        cur_mode = "maybe";
        has_complex_stage = true;
      } else if (st.kind === "note") {
        if (cur_mode !== "maybe") return undefined;
        cur_mode = "either";
        has_complex_stage = true;
      } else if (st.kind === "validation_to_either") {
        if (cur_mode !== "validation") return undefined;
        cur_mode = "either";
        has_complex_stage = true;
      } else if (
        st.kind === "map_left" || st.kind === "bimap" ||
        st.kind === "catch_error"
      ) {
        if (cur_mode !== "either") return undefined;
        has_complex_stage = true;
      } else if (st.kind === "alt") {
        if (cur_mode !== "maybe") return undefined;
        has_complex_stage = true;
      } else if (st.kind === "bind" && cur_mode === "validation") {
        return undefined;
      } else if (st.kind === "filter" && cur_mode !== "maybe") {
        return undefined;
      }
    }
    const out_mode: ChainMode = cur_mode;
    if (expected_mode !== undefined && expected_mode !== out_mode) {
      return undefined;
    }
    const root = root_info.root;

    if (match_cases_expr !== undefined) {
      const pair = parse_match_pair(match_cases_expr, out_mode);
      if (pair === undefined) return undefined;
      terminal = { kind: "match", ...pair };
    }
    if (terminal === undefined) return undefined;

    // Resolve constructor identifiers if wrapping final result (with shadow-safe auto-import fallback).
    const anchor = root_info.anchor ??
      first_imported_any(
        services.imports.just_constructors,
        services.imports.nothing_constructors,
        services.imports.direct_maybe_dictionaries,
        services.imports.right_constructors,
        services.imports.left_constructors,
        services.imports.direct_either_dictionaries,
        services.imports.valid_constructors,
        services.imports.invalid_constructors,
        services.imports.direct_validation_dictionaries,
        services.imports.from_nullable_functions,
        services.imports.either_hush_functions,
        services.imports.either_note_functions,
        services.imports.maybe_to_either_functions,
        services.imports.validation_to_either_functions,
        services.imports.prelude_fmap_functions,
        services.imports.prelude_bind_functions,
        services.imports.prelude_alt_functions,
        services.imports.namespaces,
      );

    let maybe_just_expr: ((v: Expression) => Expression) | undefined;
    let maybe_nothing_expr: (() => Expression) | undefined;
    let either_dict_id: IdentifierReference | undefined;
    let validation_dict_id: IdentifierReference | undefined;
    let valid_ctor_id: IdentifierReference | undefined;

    if (terminal.kind === "wrap") {
      if (out_mode === "maybe") {
        const jn = first_unshadowed(services.imports.just_constructors);
        const nn = first_unshadowed(services.imports.nothing_constructors);
        const md = first_unshadowed(services.imports.direct_maybe_dictionaries);
        if (jn !== undefined) maybe_just_expr = (v) => call(id(jn), [v]);
        else if (md !== undefined) {
          maybe_just_expr = (v) => call(member(id(md), "pure"), [v]);
        } else if (anchor !== undefined) {
          const imp = services.import_from_module?.(anchor, "maybe", "Just");
          if (imp !== undefined) maybe_just_expr = (v) => call(imp, [v]);
        }
        if (nn !== undefined) maybe_nothing_expr = () => call(id(nn), []);
        else if (md !== undefined) {
          maybe_nothing_expr = () => call(member(id(md), "empty"), []);
        } else if (anchor !== undefined) {
          const imp = services.import_from_module?.(anchor, "maybe", "Nothing");
          if (imp !== undefined) maybe_nothing_expr = () => call(imp, []);
        }
        if (maybe_just_expr === undefined || maybe_nothing_expr === undefined) {
          return undefined;
        }
      } else if (out_mode === "either") {
        const ed = first_unshadowed(
          services.imports.direct_either_dictionaries,
        );
        if (ed !== undefined) either_dict_id = id(ed);
        else if (anchor !== undefined) {
          either_dict_id = services.import_from_module?.(
            anchor,
            "either",
            "Either",
          );
        }
        if (either_dict_id === undefined) return undefined;
      } else {
        const vn = first_unshadowed(services.imports.valid_constructors);
        if (vn !== undefined) valid_ctor_id = id(vn);
        const vd = first_unshadowed(
          services.imports.direct_validation_dictionaries,
        );
        if (vd !== undefined) validation_dict_id = id(vd);
        else if (anchor !== undefined) {
          validation_dict_id = services.import_from_module?.(
            anchor,
            "validation",
            "Validation",
          );
        }
        if (validation_dict_id === undefined && valid_ctor_id === undefined) {
          return undefined;
        }
        if (root.kind === "wrapped" && validation_dict_id === undefined) {
          return undefined;
        }
      }
    }

    // Fast specialization for single complex stage at outer edge (e.g. Alternative.alt(Nothing(), Just(42)),
    // hush(either), note(err, maybe), validation_to_either(val), map_left, bimap, catch_error)
    if (has_complex_stage) {
      // Handle simple single-stage cases cleanly with exact evaluation order & strict TS types!
      if (
        stages.length === 1 && stages[0].kind === "alt" &&
        out_mode === "maybe" && terminal.kind === "wrap"
      ) {
        const alt_fb = stages[0].fallback;
        if (root.kind === "nothing") {
          return { expression: alt_fb, direct: true };
        }
        if (root.kind === "just") {
          const v_id = services.fresh("ch_v");
          const s: Statement[] = [
            variable(v_id, root.value, "const", root.value_type),
            ...(is_pure_no_call(alt_fb)
              ? []
              : [node({ type: "ExpressionStatement", expression: alt_fb })]),
            ret(maybe_just_expr!(v_id)),
          ];
          return { expression: call(arrow([], block(s)), []), direct: true };
        }
        if (root.kind === "wrapped") {
          const a_id = services.fresh("ch_alt_a");
          const b_id = services.fresh("ch_alt_b");
          const raw_id = services.fresh("ch_raw");
          const s: Statement[] = [
            variable(a_id, root.expr, "const"),
            variable(b_id, alt_fb, "const"),
            variable(raw_id, call(member(a_id, "value"), []), "const"),
            ret(
              node({
                type: "ConditionalExpression",
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
                  right: literal("Just"),
                }),
                consequent: a_id,
                alternate: b_id,
              }),
            ),
          ];
          return { expression: call(arrow([], block(s)), []), direct: true };
        }
        return undefined;
      }

      // General monotone-prefix + single trailing mode/error stage (hush / note / validation_to_either / map_left / bimap / catch_error):
      // Allow ONLY the last stage to be a complex stage (and earlier stages monotone map/bind/filter).
      for (let i = 0; i < stages.length - 1; i += 1) {
        const k = stages[i].kind;
        if (k !== "map" && k !== "bind" && k !== "filter") return undefined;
      }
      const last_stage = stages[stages.length - 1];
      if (last_stage.kind === "alt") return undefined;
      if (
        last_stage.kind === "catch_error" &&
        (stages.length !== 1 || root.kind === "left")
      ) {
        if (stages.length === 1 && root.kind === "left") {
          const err_id = services.fresh("ch_err");
          const res = apply_unary(last_stage.fn, err_id);
          if (terminal.kind === "wrap") {
            return {
              expression: call(
                arrow(
                  [],
                  block([
                    variable(err_id, root.value, "const", root.err_type),
                    ret(res),
                  ]),
                ),
                [],
              ),
              direct: true,
            };
          }
          return undefined;
        }
      }
      if (last_stage.kind === "catch_error") return undefined;
      // Otherwise last_stage is hush / note / validation_to_either / map_left / bimap — fall through to main builder
      // with mode = root_info.mode and outer error/success transform!
    }

    const outer_stage = has_complex_stage
      ? stages[stages.length - 1]
      : undefined;
    const monotone_stages = has_complex_stage
      ? stages.slice(0, stages.length - 1)
      : stages;
    const mode = root_info.mode;

    const stmts: Statement[] = [];
    let fb_id: IdentifierReference | undefined;
    if (
      terminal.kind === "from_maybe" || terminal.kind === "maybe_fold" ||
      terminal.kind === "from_right" || terminal.kind === "from_left"
    ) {
      fb_id = services.fresh("ch_fb");
      stmts.push(variable(fb_id, terminal.fallback, "const"));
    }
    let note_err_id: IdentifierReference | undefined;
    if (outer_stage?.kind === "note") {
      note_err_id = services.fresh("ch_note");
      stmts.push(variable(note_err_id, outer_stage.error, "const"));
    }

    const fail_return = (err_expr?: Expression): Statement => {
      let effective_err = err_expr;
      if (outer_stage?.kind === "note") {
        effective_err = note_err_id!;
      } else if (
        outer_stage?.kind === "map_left" && effective_err !== undefined
      ) {
        effective_err = apply_unary(outer_stage.fn, effective_err);
      } else if (
        outer_stage?.kind === "bimap" && effective_err !== undefined
      ) {
        effective_err = apply_unary(outer_stage.left_fn, effective_err);
      }
      if (terminal!.kind === "is_left") return ret(literal(true));
      if (terminal!.kind === "is_right") return ret(literal(false));
      if (
        terminal!.kind === "from_maybe" || terminal!.kind === "maybe_fold" ||
        terminal!.kind === "from_right"
      ) return ret(fb_id!);
      if (terminal!.kind === "from_left") return ret(effective_err!);
      if (terminal!.kind === "get_or_else") {
        const fb_fn = parentheses(terminal!.fallback_fn);
        if (
          fb_fn.type === "ArrowFunctionExpression" && !fb_fn.async &&
          !fb_fn.generator && fb_fn.typeParameters == null &&
          fb_fn.returnType == null && fb_fn.params.length === 0 &&
          fb_fn.body.type !== "BlockStatement"
        ) {
          return ret(fb_fn.body as Expression);
        }
        return ret(call(terminal!.fallback_fn, []));
      }
      if (terminal!.kind === "to_nullable") return ret(literal(null));
      if (
        terminal!.kind === "match" || terminal!.kind === "recover_or_else"
      ) {
        const body = effective_err !== undefined
          ? apply_unary(terminal!.err_fn, effective_err)
          : terminal!.err_fn.body;
        return ret(body);
      }
      if (out_mode === "maybe") {
        return ret(
          node({
            type: "TSAsExpression",
            expression: maybe_nothing_expr!(),
            typeAnnotation: node({ type: "TSNeverKeyword" }),
          }),
        );
      }
      if (out_mode === "validation") {
        // Validation invalid raw tuple returned as-is
        return ret(effective_err!);
      }
      return ret(
        as_const(
          node({
            type: "ArrayExpression",
            elements: [literal("Left"), effective_err!],
          }),
        ),
      );
    };

    const fail_return_raw_left = (raw_id: IdentifierReference): Statement => {
      const payload = node({
        type: "MemberExpression",
        object: raw_id,
        property: literal(1),
        computed: true,
        optional: false,
      });
      if (
        outer_stage !== undefined ||
        terminal!.kind === "match" || terminal!.kind === "from_right" ||
        terminal!.kind === "from_left" ||
        terminal!.kind === "recover_or_else" ||
        terminal!.kind === "is_left" || terminal!.kind === "is_right"
      ) return fail_return(payload);
      return ret(raw_id);
    };

    const fail_return_raw_invalid = (
      raw_id: IdentifierReference,
    ): Statement => {
      const payload = node({
        type: "MemberExpression",
        object: raw_id,
        property: literal(1),
        computed: true,
        optional: false,
      });
      if (outer_stage?.kind === "validation_to_either") {
        return fail_return(payload);
      }
      if (terminal!.kind === "match") return fail_return(payload);
      return ret(raw_id);
    };

    let current_var = services.fresh("ch_v");
    switch (root.kind) {
      case "just":
      case "right":
      case "valid":
        stmts.push(variable(current_var, root.value, "const", root.value_type));
        break;
      case "nothing":
        stmts.push(fail_return());
        break;
      case "left": {
        const err_var = services.fresh("ch_err");
        stmts.push(
          variable(err_var, root.value, "const", root.err_type),
          fail_return(err_var),
        );
        break;
      }
      case "from_nullable": {
        const null_id = services.fresh("ch_null");
        stmts.push(
          variable(null_id, root.value, "const"),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "==",
              left: null_id,
              right: literal(null),
            }),
            consequent: fail_return(),
            alternate: null,
          }),
          variable(current_var, null_id, "const"),
        );
        break;
      }
      case "from_number": {
        const num_id = services.fresh("ch_num");
        stmts.push(
          variable(num_id, root.value, "const"),
          node({
            type: "IfStatement",
            test: negate_expr(
              call(member(id("Number"), "isFinite"), [num_id]),
            ),
            consequent: fail_return(literal("Expected a finite number")),
            alternate: null,
          }),
          variable(current_var, num_id, "const"),
        );
        break;
      }
      case "try_catch": {
        const err_id = services.fresh("ch_e");
        const fn_arrow = unwrap(root.fn);
        const invoke_fn =
          fn_arrow.type === "ArrowFunctionExpression" && !fn_arrow.async &&
            !fn_arrow.generator && fn_arrow.params.length === 0 &&
            fn_arrow.body.type !== "BlockStatement"
            ? (fn_arrow.body as Expression)
            : call(root.fn, []);
        const on_err_spec = extract_unary_arrow(root.on_err);
        const err_mapped = on_err_spec !== undefined
          ? apply_unary(on_err_spec, err_id)
          : call(root.on_err, [err_id]);
        const try_val_id = services.fresh("ch_try_v");
        const try_iife = call(
          arrow(
            [],
            block([
              node({
                type: "TryStatement",
                block: block([
                  ret(
                    as_const(
                      node({
                        type: "ArrayExpression",
                        elements: [literal("Right"), invoke_fn],
                      }),
                    ),
                  ),
                ]),
                handler: node({
                  type: "CatchClause",
                  param: err_id,
                  body: block([
                    ret(
                      as_const(
                        node({
                          type: "ArrayExpression",
                          elements: [literal("Left"), err_mapped],
                        }),
                      ),
                    ),
                  ]),
                }),
                finalizer: null,
              }),
            ]),
          ),
          [],
        );
        stmts.push(
          variable(try_val_id, try_iife, "const"),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "===",
              left: node({
                type: "MemberExpression",
                object: try_val_id,
                property: literal(0),
                computed: true,
                optional: false,
              }),
              right: literal("Left"),
            }),
            consequent: fail_return_raw_left(try_val_id),
            alternate: null,
          }),
          variable(
            current_var,
            node({
              type: "MemberExpression",
              object: try_val_id,
              property: literal(1),
              computed: true,
              optional: false,
            }),
            "const",
          ),
        );
        break;
      }
      case "wrapped": {
        const raw_id = services.fresh("ch_raw");
        const fail_tag = mode === "maybe"
          ? "Nothing"
          : mode === "either"
          ? "Left"
          : "invalid";
        stmts.push(
          variable(raw_id, call(member(root.expr, "value"), []), "const"),
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
              right: literal(fail_tag),
            }),
            consequent: mode === "maybe"
              ? fail_return()
              : mode === "either"
              ? fail_return_raw_left(raw_id)
              : fail_return_raw_invalid(raw_id),
            alternate: null,
          }),
          variable(
            current_var,
            node({
              type: "MemberExpression",
              object: raw_id,
              property: literal(1),
              computed: true,
              optional: false,
            }),
            "const",
          ),
        );
        break;
      }
    }

    if (root.kind !== "nothing" && root.kind !== "left") {
      for (const stage of monotone_stages) {
        if (
          stage.kind !== "map" && stage.kind !== "bind" &&
          stage.kind !== "filter"
        ) continue;
        const inlined = apply_unary(stage.fn, current_var);
        const next_var = services.fresh("ch_v");
        if (stage.kind === "map") {
          stmts.push(variable(next_var, inlined, "const"));
          current_var = next_var;
          continue;
        }
        if (stage.kind === "filter") {
          stmts.push(
            node({
              type: "IfStatement",
              test: negate_expr(inlined),
              consequent: fail_return(),
              alternate: null,
            }),
          );
          continue;
        }
        // stage.kind === "bind"
        const elided = match_elided_body(inlined, mode);
        if (elided !== undefined) {
          if (elided.kind === "ok") {
            stmts.push(
              variable(next_var, elided.expr, "const", elided.ok_type),
            );
            current_var = next_var;
            continue;
          }
          const fail_consequent: Statement =
            elided.err_type !== undefined && elided.err_expr !== undefined
              ? (() => {
                const err_var = services.fresh("ch_err");
                return block([
                  variable(err_var, elided.err_expr, "const", elided.err_type),
                  fail_return(err_var),
                ]);
              })()
              : fail_return(elided.err_expr);
          stmts.push(
            node({
              type: "IfStatement",
              test: negate_expr(elided.test),
              consequent: fail_consequent,
              alternate: null,
            }),
            variable(next_var, elided.ok_expr, "const", elided.ok_type),
          );
          current_var = next_var;
          continue;
        }
        // General bind: inspect returned Maybe/Either raw tuple
        const raw_id = services.fresh("ch_raw");
        const fail_tag = mode === "maybe" ? "Nothing" : "Left";
        stmts.push(
          variable(raw_id, call(member(inlined, "value"), []), "const"),
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
              right: literal(fail_tag),
            }),
            consequent: mode === "maybe"
              ? fail_return()
              : fail_return_raw_left(raw_id),
            alternate: null,
          }),
          variable(
            next_var,
            node({
              type: "MemberExpression",
              object: raw_id,
              property: literal(1),
              computed: true,
              optional: false,
            }),
            "const",
          ),
        );
        current_var = next_var;
      }

      if (outer_stage?.kind === "bimap") {
        const mapped_var = services.fresh("ch_v");
        stmts.push(
          variable(
            mapped_var,
            apply_unary(outer_stage.right_fn, current_var),
            "const",
          ),
        );
        current_var = mapped_var;
      }

      if (terminal.kind === "is_left") {
        stmts.push(ret(literal(false)));
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }
      if (terminal.kind === "is_right") {
        stmts.push(ret(literal(true)));
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }
      if (
        terminal.kind === "from_maybe" || terminal.kind === "to_nullable" ||
        terminal.kind === "get_or_else" || terminal.kind === "from_right" ||
        terminal.kind === "recover_or_else"
      ) {
        stmts.push(ret(current_var));
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }
      if (terminal.kind === "from_left") {
        stmts.push(ret(fb_id!));
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }
      if (terminal.kind === "match" || terminal.kind === "maybe_fold") {
        stmts.push(ret(apply_unary(terminal.ok_fn, current_var)));
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }
      if (out_mode === "maybe") {
        stmts.push(ret(maybe_just_expr!(current_var)));
        return { expression: call(arrow([], block(stmts)), []), direct: true };
      }
      if (out_mode === "validation") {
        if (root.kind === "valid" && valid_ctor_id !== undefined) {
          stmts.push(ret(call(valid_ctor_id, [current_var])));
          return {
            expression: call(arrow([], block(stmts)), []),
            direct: true,
          };
        }
        stmts.push(
          ret(
            as_const(
              node({
                type: "ArrayExpression",
                elements: [literal("valid"), current_var],
              }),
            ),
          ),
        );
        return {
          expression: call(validation_dict_id!, [
            call(arrow([], block(stmts)), []),
          ]),
          direct: true,
        };
      }
      stmts.push(
        ret(
          as_const(
            node({
              type: "ArrayExpression",
              elements: [literal("Right"), current_var],
            }),
          ),
        ),
      );
      return {
        expression: call(either_dict_id!, [call(arrow([], block(stmts)), [])]),
        direct: true,
      };
    }

    // root was statically Nothing or Left: `stmts` already ends with `fail_return(...)`!
    if (terminal.kind === "wrap" && out_mode === "either") {
      return {
        expression: call(either_dict_id!, [call(arrow([], block(stmts)), [])]),
        direct: true,
      };
    }
    return { expression: call(arrow([], block(stmts)), []), direct: true };
  }

  // =========================================================================
  // P8: ArrayT fluent .map chain & Foldable.fold/fold_while/some/find fusion
  // =========================================================================
  function is_foldable_obj(expr: Expression): boolean {
    return is_imported_from_set(expr, services.imports.foldable_objects) ||
      is_ns_member(expr, services.imports.foldable_namespaces, "Foldable") ||
      is_ns_member(expr, services.imports.namespaces, "Foldable");
  }

  type CollectionRootKind =
    | "array"
    | "list_array"
    | "typed_array"
    | "set"
    | "map"
    | "record";

  function unwrap_array_root(
    expr: Expression,
  ):
    | {
      readonly kind: CollectionRootKind;
      readonly array_ctor?: IdentifierReference;
      readonly map_ctor?: IdentifierReference;
      readonly record_ctor?: IdentifierReference;
      readonly items: Expression;
      readonly is_view?: boolean;
      readonly needs_snapshot?: boolean;
    }
    | undefined {
    const val = parentheses(expr);
    if (
      val.type !== "CallExpression" || val.optional ||
      val.typeArguments != null || val.arguments.length !== 1 ||
      val.arguments[0].type === "SpreadElement"
    ) return undefined;
    const callee = parentheses(val.callee);
    const items = val.arguments[0] as Expression;
    if (callee.type === "Identifier" && services.bindings.imported(callee)) {
      const name = callee.name;
      if (services.imports.array_constructors?.has(name)) {
        return {
          kind: "array",
          array_ctor: callee,
          items,
          is_view: true,
          needs_snapshot: false,
        };
      }
      if (
        services.imports.array_view_functions?.has(name) ||
        services.imports.array_from_array_functions?.has(name)
      ) {
        const is_view = services.imports.array_view_functions?.has(name) ===
          true;
        const ctor_name = first_unshadowed(services.imports.array_constructors);
        return {
          kind: "array",
          array_ctor: ctor_name !== undefined ? id(ctor_name) : undefined,
          items,
          is_view,
          needs_snapshot: !is_view,
        };
      }
      if (services.imports.list_from_array_functions?.has(name)) {
        return {
          kind: "list_array",
          items,
          is_view: false,
          needs_snapshot: true,
        };
      }
      if (services.imports.typed_array_constructors?.has(name)) {
        return { kind: "typed_array", items, needs_snapshot: true };
      }
      if (services.imports.set_constructors?.has(name)) {
        return { kind: "set", items, needs_snapshot: true };
      }
      if (services.imports.map_constructors?.has(name)) {
        const is_view = name === "from_map_view";
        const m_ctor = first_unshadowed(services.imports.map_constructors);
        return {
          kind: "map",
          map_ctor: m_ctor !== undefined ? id(m_ctor) : callee,
          items,
          is_view,
          needs_snapshot: !is_view,
        };
      }
      if (services.imports.record_constructors?.has(name)) {
        const is_view = name === "from_record_view";
        const r_ctor = first_unshadowed(services.imports.record_constructors);
        return {
          kind: "record",
          record_ctor: r_ctor !== undefined ? id(r_ctor) : callee,
          items,
          is_view,
          needs_snapshot: !is_view,
        };
      }
    } else if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      services.bindings.imported(callee.object)
    ) {
      if (
        services.imports.array_namespaces?.has(callee.object.name) &&
        (callee.property.name === "ArrayT" ||
          callee.property.name === "from_array" ||
          callee.property.name === "from_array_view")
      ) {
        const is_view = callee.property.name !== "from_array";
        const ctor_name = first_unshadowed(services.imports.array_constructors);
        return {
          kind: "array",
          array_ctor: ctor_name !== undefined ? id(ctor_name) : undefined,
          items,
          is_view,
          needs_snapshot: !is_view,
        };
      }
      if (
        services.imports.list_namespaces?.has(callee.object.name) &&
        callee.property.name === "from_array"
      ) {
        return {
          kind: "list_array",
          items,
          is_view: false,
          needs_snapshot: true,
        };
      }
    }
    return undefined;
  }

  type FoldStepTuple = {
    readonly done: boolean;
    readonly value: Expression;
  };

  function match_fold_step(expr: Expression): FoldStepTuple | undefined {
    const val = unwrap(expr);
    if (val.type !== "ArrayExpression" || val.elements.length !== 2) {
      return undefined;
    }
    const tag = val.elements[0];
    const payload = val.elements[1];
    if (
      tag === null || tag.type !== "Literal" ||
      (tag.value !== "Continue" && tag.value !== "Done") ||
      payload === null || payload.type === "SpreadElement"
    ) return undefined;
    return { done: tag.value === "Done", value: payload };
  }

  function array_chain_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    const callee = parentheses(outer.callee);

    // Fast path: ArrayT concat / Alternative.alt(ArrayT(a), ArrayT(b)) / prelude.concat/alt
    if (
      (outer.arguments.length === 2 &&
        ((callee.type === "MemberExpression" && !callee.computed &&
          !callee.optional && callee.property.type === "Identifier" &&
          callee.property.name === "alt" &&
          is_alternative_obj(parentheses(callee.object))) ||
          is_imported_from_set(
            callee,
            services.imports.prelude_alt_functions,
          ) ||
          is_ns_member(callee, services.imports.prelude_namespaces, "alt") ||
          is_imported_from_set(
            callee,
            services.imports.prelude_concat_functions,
          ) ||
          is_ns_member(
            callee,
            services.imports.prelude_namespaces,
            "concat",
          ))) ||
      (outer.arguments.length === 1 &&
        callee.type === "MemberExpression" && !callee.computed &&
        !callee.optional && callee.property.type === "Identifier" &&
        (callee.property.name === "concat" || callee.property.name === "alt"))
    ) {
      const is_static = outer.arguments.length === 2;
      const left_expr = is_static
        ? (outer.arguments[0] as Expression)
        : (callee as Extract<Expression, { type: "MemberExpression" }>).object;
      const right_expr = outer.arguments[is_static ? 1 : 0] as Expression;
      const lr = unwrap_array_root(left_expr);
      const rr = unwrap_array_root(right_expr);
      if (
        lr !== undefined && rr !== undefined && lr.kind === "array" &&
        rr.kind === "array" &&
        !lexical_hazard(lr.items) && !contains_await_yield(lr.items) &&
        !contains_generator_or_do(lr.items) &&
        !lexical_hazard(rr.items) && !contains_await_yield(rr.items) &&
        !contains_generator_or_do(rr.items)
      ) {
        const ctor = lr.array_ctor ?? rr.array_ctor;
        if (ctor !== undefined) {
          const l_src = services.fresh("arr_l");
          const r_src = services.fresh("arr_r");
          const l_init: Expression = lr.needs_snapshot
            ? node({
              type: "ArrayExpression",
              elements: Array.from([
                node({ type: "SpreadElement", argument: lr.items }),
              ]),
            })
            : lr.items;
          const out_arr: Expression = node({
            type: "ArrayExpression",
            elements: Array.from([
              node({ type: "SpreadElement", argument: l_src }),
              node({ type: "SpreadElement", argument: r_src }),
            ]),
          });
          return {
            expression: call(
              arrow(
                [],
                block([
                  variable(l_src, l_init, "const"),
                  variable(r_src, rr.items, "const"),
                  ret(call(ctor, [out_arr])),
                ]),
              ),
              [],
            ),
            direct: true,
          };
        }
      }
    }

    type ArrTerm =
      | { readonly kind: "wrap" }
      | { readonly kind: "raw_array" }
      | { readonly kind: "length" }
      | { readonly kind: "sum" }
      | { readonly kind: "product" }
      | {
        readonly kind: "fold";
        readonly init: Expression;
        readonly step: Expression;
        readonly prelude_order?: boolean;
      }
      | {
        readonly kind: "fold_while";
        readonly init: Expression;
        readonly step: Expression;
      }
      | { readonly kind: "some" | "find"; readonly pred: Expression };

    let cursor: Expression | undefined;
    let term: ArrTerm | undefined;

    if (
      outer.arguments.length === 1 &&
      (is_imported_from_set(
        callee,
        services.imports.array_to_array_functions,
      ) ||
        is_imported_from_set(
          callee,
          services.imports.list_to_array_functions,
        ) ||
        is_ns_member(callee, services.imports.list_namespaces, "to_array") ||
        is_imported_from_set(
          callee,
          services.imports.prelude_to_array_functions,
        ) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "to_array"))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "raw_array" };
    } else if (
      outer.arguments.length === 1 &&
      (is_imported_from_set(
        callee,
        services.imports.prelude_length_functions,
      ) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "length"))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "length" };
    } else if (
      outer.arguments.length === 1 &&
      (is_imported_from_set(callee, services.imports.prelude_sum_functions) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "sum"))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "sum" };
    } else if (
      outer.arguments.length === 1 &&
      (is_imported_from_set(
        callee,
        services.imports.prelude_product_functions,
      ) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "product"))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "product" };
    } else if (
      outer.arguments.length === 3 &&
      (is_imported_from_set(callee, services.imports.prelude_foldl_functions) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "foldl"))
    ) {
      // prelude.foldl(fn, initial, value)
      cursor = outer.arguments[2] as Expression;
      term = {
        kind: "fold",
        init: outer.arguments[1] as Expression,
        step: outer.arguments[0] as Expression,
        prelude_order: true,
      };
    } else if (
      outer.arguments.length === 3 &&
      (is_imported_from_set(
        callee,
        services.imports.prelude_fold_while_functions,
      ) ||
        is_ns_member(
          callee,
          services.imports.prelude_namespaces,
          "fold_while",
        ))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = {
        kind: "fold_while",
        init: outer.arguments[1] as Expression,
        step: outer.arguments[2] as Expression,
      };
    } else if (
      outer.arguments.length === 2 &&
      (is_imported_from_set(callee, services.imports.prelude_some_functions) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "some"))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "some", pred: outer.arguments[1] as Expression };
    } else if (
      outer.arguments.length === 2 &&
      (is_imported_from_set(callee, services.imports.prelude_find_functions) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "find"))
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "find", pred: outer.arguments[1] as Expression };
    } else if (
      outer.arguments.length === 2 &&
      (is_imported_from_set(callee, services.imports.prelude_fmap_functions) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "fmap") ||
        is_imported_from_set(callee, services.imports.prelude_bind_functions) ||
        is_ns_member(callee, services.imports.prelude_namespaces, "bind"))
    ) {
      cursor = outer;
      term = { kind: "wrap" };
    } else if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier"
    ) {
      const mname = callee.property.name;
      if (
        (mname === "fold" || mname === "fold_while") &&
        outer.arguments.length === 3 &&
        is_foldable_obj(parentheses(callee.object))
      ) {
        cursor = outer.arguments[0] as Expression;
        term = {
          kind: mname,
          init: outer.arguments[1] as Expression,
          step: outer.arguments[2] as Expression,
        };
      } else if (
        (mname === "some" || mname === "find") &&
        outer.arguments.length === 2 &&
        is_foldable_obj(parentheses(callee.object))
      ) {
        cursor = outer.arguments[0] as Expression;
        term = { kind: mname, pred: outer.arguments[1] as Expression };
      } else if (mname === "fold" && outer.arguments.length === 2) {
        cursor = callee.object;
        term = {
          kind: "fold",
          init: outer.arguments[0] as Expression,
          step: outer.arguments[1] as Expression,
        };
      } else if (mname === "value" && outer.arguments.length === 0) {
        cursor = callee.object;
        term = { kind: "raw_array" };
      } else if (
        (mname === "map" || mname === "bind") && outer.arguments.length === 1
      ) {
        cursor = outer;
        term = { kind: "wrap" };
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    // Peel .map(...) / .bind(...) / prelude.fmap / prelude.bind stages
    type ArrStage = {
      readonly kind: "map" | "bind";
      readonly fn: UnarySpec;
    };
    const stages_rev: ArrStage[] = [];
    let has_bind = false;
    while (true) {
      const cur = parentheses(cursor!);
      if (
        cur.type === "CallExpression" && !cur.optional &&
        cur.typeArguments == null &&
        !cur.arguments.some((a) => a.type === "SpreadElement")
      ) {
        const cc = parentheses(cur.callee);
        if (
          cur.arguments.length === 1 &&
          cc.type === "MemberExpression" && !cc.computed && !cc.optional &&
          cc.property.type === "Identifier" &&
          (cc.property.name === "map" || cc.property.name === "bind")
        ) {
          const parsed = extract_unary_arrow(cur.arguments[0] as Expression);
          if (parsed === undefined) return undefined;
          if (cc.property.name === "bind") has_bind = true;
          stages_rev.push({ kind: cc.property.name, fn: parsed });
          cursor = cc.object;
          continue;
        }
        if (
          cur.arguments.length === 2 &&
          (is_imported_from_set(cc, services.imports.prelude_fmap_functions) ||
            is_ns_member(cc, services.imports.prelude_namespaces, "fmap"))
        ) {
          const parsed = extract_unary_arrow(cur.arguments[0] as Expression);
          if (parsed === undefined) return undefined;
          stages_rev.push({ kind: "map", fn: parsed });
          cursor = cur.arguments[1] as Expression;
          continue;
        }
        if (
          cur.arguments.length === 2 &&
          (is_imported_from_set(cc, services.imports.prelude_bind_functions) ||
            is_ns_member(cc, services.imports.prelude_namespaces, "bind"))
        ) {
          const parsed = extract_unary_arrow(cur.arguments[1] as Expression);
          if (parsed === undefined) return undefined;
          has_bind = true;
          stages_rev.push({ kind: "bind", fn: parsed });
          cursor = cur.arguments[0] as Expression;
          continue;
        }
      }
      break;
    }

    if (term === undefined) return undefined;
    const resolved_term = term;
    if (
      (resolved_term.kind === "wrap" || resolved_term.kind === "raw_array") &&
      stages_rev.length === 0
    ) return undefined;

    const root = unwrap_array_root(cursor!);
    if (root === undefined) return undefined;
    if (
      lexical_hazard(root.items) || contains_await_yield(root.items) ||
      contains_generator_or_do(root.items)
    ) return undefined;
    if (has_bind && root.kind !== "array") return undefined;

    // PPF-07: MapT / RecordT fused .map chain
    if (
      (root.kind === "map" || root.kind === "record") &&
      resolved_term.kind === "wrap" && stages_rev.length > 0
    ) {
      const stages = stages_rev.reverse();
      const all_pure = stages.every((st) =>
        st.fn.call_ref === undefined && is_pure_no_call(st.fn.body)
      );
      if (root.needs_snapshot && !all_pure) return undefined;
      const src_id = services.fresh(
        root.kind === "map" ? "map_src" : "rec_src",
      );
      const k_id = services.fresh(root.kind === "map" ? "map_k" : "rec_k");
      const v_id = services.fresh(root.kind === "map" ? "map_v" : "rec_v");
      const out_id = services.fresh(
        root.kind === "map" ? "map_out" : "rec_out",
      );
      const loop_stmts: Statement[] = [];
      let cur_expr: Expression = v_id;
      for (const st of stages) {
        const next_v = services.fresh("col_v");
        loop_stmts.push(
          variable(next_v, apply_unary(st.fn, cur_expr), "const"),
        );
        cur_expr = next_v;
      }
      if (root.kind === "map") {
        if (root.map_ctor === undefined) return undefined;
        loop_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: call(member(out_id, "set"), [k_id, cur_expr]),
          }),
        );
        const map_anchor = root.map_ctor.name;
        const view_fn = services.import_from_module?.(
          map_anchor,
          "map",
          "from_map_view",
        );
        const wrap_map = view_fn ?? root.map_ctor;
        const body_stmts: Statement[] = [
          variable(src_id, root.items, "const"),
          variable(
            out_id,
            node({ type: "NewExpression", callee: id("Map"), arguments: [] }),
            "const",
          ),
          node({
            type: "ForOfStatement",
            await: false,
            left: node({
              type: "VariableDeclaration",
              kind: "const",
              declarations: [
                node({
                  type: "VariableDeclarator",
                  id: node({
                    type: "ArrayPattern",
                    elements: [k_id, v_id],
                  }),
                  init: null,
                }),
              ],
            }),
            right: src_id,
            body: block(loop_stmts),
          }),
          ret(call(wrap_map, [out_id])),
        ];
        return {
          expression: call(arrow([], block(body_stmts)), []),
          direct: true,
        };
      }
      // root.kind === "record"
      if (root.record_ctor === undefined) return undefined;
      const rec_anchor = root.record_ctor.name;
      const view_fn = services.import_from_module?.(
        rec_anchor,
        "record",
        "from_record_view",
      );
      const wrap_rec = view_fn ?? root.record_ctor;
      const out_val = services.fresh("rec_val");
      loop_stmts.push(
        variable(out_val, cur_expr, "const"),
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: "===",
            left: k_id,
            right: literal("__proto__"),
          }),
          consequent: node({
            type: "ExpressionStatement",
            expression: call(member(id("Object"), "defineProperty"), [
              out_id,
              k_id,
              node({
                type: "ObjectExpression",
                properties: [
                  node({
                    type: "Property",
                    kind: "init",
                    key: id("value"),
                    value: out_val,
                    method: false,
                    shorthand: false,
                    computed: false,
                  }),
                  node({
                    type: "Property",
                    kind: "init",
                    key: id("enumerable"),
                    value: literal(true),
                    method: false,
                    shorthand: false,
                    computed: false,
                  }),
                  node({
                    type: "Property",
                    kind: "init",
                    key: id("writable"),
                    value: literal(true),
                    method: false,
                    shorthand: false,
                    computed: false,
                  }),
                  node({
                    type: "Property",
                    kind: "init",
                    key: id("configurable"),
                    value: literal(true),
                    method: false,
                    shorthand: false,
                    computed: false,
                  }),
                ],
              }),
            ]),
          }),
          alternate: node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "=",
              left: node({
                type: "MemberExpression",
                object: out_id,
                property: k_id,
                computed: true,
                optional: false,
              }),
              right: out_val,
            }),
          }),
        }),
      );
      const keys_id = services.fresh("rec_keys");
      const ri_id = services.fresh("rec_i");
      const rec_type: TSType = node({
        type: "TSTypeReference",
        typeName: id("Record"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([
            node({ type: "TSStringKeyword" }),
            node({ type: "TSAnyKeyword" }),
          ]),
        }),
      });
      // Avoid `any`: infer value type by leaving `RecordT.map` unfused if multiple incompatible types?
      // Better: compute first entry or only emit typed Record<string, typeof out_val> via helper?
      // Actually `const out_id: Record<string, ReturnType<typeof ...>>` is cleaner if single-stage or keep `RecordT` simple!
      void rec_type;
      void keys_id;
      void ri_id;
      void wrap_rec;
      // Only fuse RecordT.map when we can annotate `Record<string, ...>` without `any` (handled cleanly via `Object.fromEntries`? No, loop with first-item pre-type!).
      // Skip untyped RecordT.map here to guarantee zero `any` and strict TS types.
      return undefined;
    }

    if (root.kind !== "array" && root.kind !== "list_array") {
      // Non-ArrayT collections only fuse direct 0-stage Foldable terminals
      if (
        stages_rev.length > 0 || resolved_term.kind === "wrap" ||
        resolved_term.kind === "raw_array"
      ) return undefined;
    }
    if (root.kind === "list_array" && resolved_term.kind === "wrap") {
      return undefined;
    }
    if (resolved_term.kind === "wrap" && root.array_ctor === undefined) {
      return undefined;
    }

    const stages = stages_rev.reverse();
    const src_id = services.fresh("arr_src");
    const len_id = services.fresh("arr_len");
    const idx_id = services.fresh("arr_i");
    const key_id = root.kind === "record" ? services.fresh("rec_k") : undefined;
    const direct_item_id = root.kind === "set" || root.kind === "map"
      ? services.fresh("col_item")
      : undefined;
    const elem_access: Expression = root.kind === "set" || root.kind === "map"
      ? direct_item_id!
      : root.kind === "record"
      ? node({
        type: "MemberExpression",
        object: src_id,
        property: key_id!,
        computed: true,
        optional: false,
      })
      : node({
        type: "MemberExpression",
        object: src_id,
        property: idx_id,
        computed: true,
        optional: false,
      });

    // PPF-07: ArrayT .bind (and mixed .map/.bind) chain fusion into single output buffer
    if (has_bind && root.kind === "array") {
      if (
        resolved_term.kind !== "wrap" && resolved_term.kind !== "raw_array" &&
        resolved_term.kind !== "fold" && resolved_term.kind !== "sum" &&
        resolved_term.kind !== "product" && resolved_term.kind !== "length"
      ) return undefined;
      if (resolved_term.kind === "fold") return undefined;
      const out_id = services.fresh("arr_out");
      const wrap_arr = (expr: Expression): Expression =>
        resolved_term.kind === "wrap" ? call(root.array_ctor!, [expr]) : expr;
      const emit_nested = (
        stage_idx: number,
        cur_expr: Expression,
      ): Statement[] => {
        if (stage_idx >= stages.length) {
          if (resolved_term.kind === "length") {
            return [
              node({
                type: "ExpressionStatement",
                expression: node({
                  type: "AssignmentExpression",
                  operator: "+=",
                  left: out_id,
                  right: literal(1),
                }),
              }),
            ];
          }
          if (resolved_term.kind === "sum") {
            return [
              node({
                type: "ExpressionStatement",
                expression: node({
                  type: "AssignmentExpression",
                  operator: "+=",
                  left: out_id,
                  right: cur_expr,
                }),
              }),
            ];
          }
          if (resolved_term.kind === "product") {
            return [
              node({
                type: "ExpressionStatement",
                expression: node({
                  type: "AssignmentExpression",
                  operator: "*=",
                  left: out_id,
                  right: cur_expr,
                }),
              }),
            ];
          }
          return [
            node({
              type: "ExpressionStatement",
              expression: call(member(out_id, "push"), [cur_expr]),
            }),
          ];
        }
        const st = stages[stage_idx];
        const v_id = services.fresh("arr_v");
        const applied = apply_unary(st.fn, v_id);
        if (st.kind === "map") {
          return [
            variable(v_id, cur_expr, "const"),
            ...emit_nested(stage_idx + 1, applied),
          ];
        }
        // bind stage: unwrap inner ArrayT([...]) directly if possible!
        const inner_root = unwrap_array_root(applied);
        const sub_src = services.fresh("arr_sub");
        const sub_i = services.fresh("arr_j");
        const sub_len = services.fresh("arr_slen");
        const sub_init: Expression =
          inner_root !== undefined && inner_root.kind === "array"
            ? inner_root.items
            : call(member(applied, "value"), []);
        const sub_elem: Expression = node({
          type: "MemberExpression",
          object: sub_src,
          property: sub_i,
          computed: true,
          optional: false,
        });
        return [
          variable(v_id, cur_expr, "const"),
          variable(sub_src, sub_init, "const"),
          variable(sub_len, member(sub_src, "length"), "const"),
          node({
            type: "ForStatement",
            init: variable(sub_i, literal(0), "let"),
            test: node({
              type: "BinaryExpression",
              operator: "<",
              left: sub_i,
              right: sub_len,
            }),
            update: node({
              type: "AssignmentExpression",
              operator: "+=",
              left: sub_i,
              right: literal(1),
            }),
            body: block(emit_nested(stage_idx + 1, sub_elem)),
          }),
        ];
      };
      const is_fresh = parentheses(root.items).type === "ArrayExpression";
      const all_pure = stages.every((st) =>
        st.fn.call_ref === undefined && is_pure_no_call(st.fn.body)
      );
      const copy_snap = root.needs_snapshot === true && !is_fresh && !all_pure;
      const acc_init: Expression = resolved_term.kind === "length" ||
          resolved_term.kind === "sum"
        ? literal(0)
        : resolved_term.kind === "product"
        ? literal(1)
        : node({ type: "ArrayExpression", elements: Array.from([]) });
      const acc_kind: "const" | "let" = resolved_term.kind === "length" ||
          resolved_term.kind === "sum" || resolved_term.kind === "product"
        ? "let"
        : "const";
      const body_stmts: Statement[] = [
        variable(
          src_id,
          copy_snap ? call(member(root.items, "slice"), []) : root.items,
          "const",
        ),
        variable(out_id, acc_init, acc_kind),
        node({
          type: "ForStatement",
          init: variable(idx_id, literal(0), "let"),
          test: node({
            type: "BinaryExpression",
            operator: "<",
            left: idx_id,
            right: member(src_id, "length"),
          }),
          update: node({
            type: "AssignmentExpression",
            operator: "+=",
            left: idx_id,
            right: literal(1),
          }),
          body: block(emit_nested(0, elem_access)),
        }),
        ret(
          resolved_term.kind === "wrap" || resolved_term.kind === "raw_array"
            ? wrap_arr(out_id)
            : out_id,
        ),
      ];
      return {
        expression: call(arrow([], block(body_stmts)), []),
        direct: true,
      };
    }

    const emit_stages = (
      stmts: Statement[],
      seed_expr: Expression,
    ): Expression => {
      let cur_expr = seed_expr;
      for (const st of stages) {
        const v_id = services.fresh("arr_v");
        stmts.push(variable(v_id, cur_expr, "const"));
        cur_expr = apply_unary(st.fn, v_id);
      }
      return cur_expr;
    };

    const is_fresh_collection_expr = (expr: Expression): boolean => {
      const v = parentheses(expr);
      return v.type === "ArrayExpression" || v.type === "ObjectExpression" ||
        v.type === "NewExpression";
    };

    const is_safe_callable_ref = (expr: Expression): boolean => {
      if (
        lexical_hazard(expr) || contains_await_yield(expr) ||
        contains_generator_or_do(expr)
      ) return false;
      const v = parentheses(expr);
      if (
        v.type === "ArrowFunctionExpression" || v.type === "FunctionExpression"
      ) {
        return !v.async && !v.generator &&
          v.params.every((p) =>
            p.type === "TSParameterProperty" || p.typeAnnotation != null
          );
      }
      return true;
    };

    const build_fold_loop = (loop_body: Statement[]): Statement => {
      if (root.kind === "set") {
        return node({
          type: "ForOfStatement",
          await: false,
          left: node({
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              node({
                type: "VariableDeclarator",
                id: direct_item_id!,
                init: null,
              }),
            ],
          }),
          right: src_id,
          body: block(loop_body),
        });
      }
      if (root.kind === "map") {
        return node({
          type: "ForOfStatement",
          await: false,
          left: node({
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              node({
                type: "VariableDeclarator",
                id: direct_item_id!,
                init: null,
              }),
            ],
          }),
          right: call(member(src_id, "values"), []),
          body: block(loop_body),
        });
      }
      if (root.kind === "record") {
        return node({
          type: "ForInStatement",
          left: node({
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              node({ type: "VariableDeclarator", id: key_id!, init: null }),
            ],
          }),
          right: src_id,
          body: block([
            node({
              type: "IfStatement",
              test: node({
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: call(member(id("Object"), "hasOwn"), [
                  src_id,
                  key_id!,
                ]),
              }),
              consequent: node({ type: "ContinueStatement", label: null }),
              alternate: null,
            }),
            ...loop_body,
          ]),
        });
      }
      const live_array_len = root.kind === "array" && !root.needs_snapshot;
      return node({
        type: "ForStatement",
        init: variable(idx_id, literal(0), "let"),
        test: node({
          type: "BinaryExpression",
          operator: "<",
          left: idx_id,
          right: live_array_len ? member(src_id, "length") : len_id,
        }),
        update: node({
          type: "AssignmentExpression",
          operator: "+=",
          left: idx_id,
          right: literal(1),
        }),
        body: block(loop_body),
      });
    };

    // Case 1: Preallocated mapped array output (ArrayT(xs).map(...)... / .value() / to_array(...))
    if (resolved_term.kind === "wrap" || resolved_term.kind === "raw_array") {
      const out_id = services.fresh("arr_out");
      const first_val = services.fresh("arr_v0");
      const wrap_arr = (expr: Expression): Expression =>
        resolved_term.kind === "wrap" ? call(root.array_ctor!, [expr]) : expr;
      const zero_idx = literal(0);
      const out_set = (index_expr: Expression, val: Expression): Statement =>
        node({
          type: "ExpressionStatement",
          expression: node({
            type: "AssignmentExpression",
            operator: "=",
            left: node({
              type: "MemberExpression",
              object: out_id,
              property: index_expr,
              computed: true,
              optional: false,
            }),
            right: val,
          }),
        });
      const first_stmts: Statement[] = [];
      const first_expr = emit_stages(first_stmts, elem_access);
      first_stmts.push(variable(first_val, first_expr, "const"));

      const loop_stmts: Statement[] = [];
      const loop_expr = emit_stages(loop_stmts, elem_access);
      loop_stmts.push(out_set(idx_id, loop_expr));

      const empty_arr = node({
        type: "ArrayExpression",
        elements: Array.from([]),
      });
      const new_arr: Expression = node({
        type: "NewExpression",
        callee: id("Array"),
        typeArguments: node({
          type: "TSTypeParameterInstantiation",
          params: Array.from<TSType>([
            node({
              type: "TSTypeQuery",
              exprName: first_val,
              typeArguments: null,
            }),
          ]),
        }),
        arguments: [len_id],
      });
      const copy_map_snapshot = root.needs_snapshot === true &&
        !is_fresh_collection_expr(root.items) &&
        !stages.every((st) =>
          st.fn.call_ref === undefined && is_pure_no_call(st.fn.body)
        );
      const body_stmts: Statement[] = [
        variable(
          src_id,
          copy_map_snapshot
            ? call(member(root.items, "slice"), [])
            : root.items,
          "const",
        ),
        variable(len_id, member(src_id, "length"), "const"),
        node({
          type: "IfStatement",
          test: node({
            type: "BinaryExpression",
            operator: "===",
            left: len_id,
            right: zero_idx,
          }),
          consequent: ret(
            node({
              type: "TSAsExpression",
              expression: wrap_arr(empty_arr),
              typeAnnotation: node({ type: "TSNeverKeyword" }),
            }),
          ),
          alternate: null,
        }),
        variable(idx_id, zero_idx, "let"),
        ...first_stmts,
        variable(out_id, new_arr, "const"),
        out_set(zero_idx, first_val),
        node({
          type: "ForStatement",
          init: node({
            type: "AssignmentExpression",
            operator: "=",
            left: idx_id,
            right: literal(1),
          }),
          test: node({
            type: "BinaryExpression",
            operator: "<",
            left: idx_id,
            right: len_id,
          }),
          update: node({
            type: "AssignmentExpression",
            operator: "+=",
            left: idx_id,
            right: literal(1),
          }),
          body: block(loop_stmts),
        }),
        ret(wrap_arr(out_id)),
      ];
      return {
        expression: call(arrow([], block(body_stmts)), []),
        direct: true,
      };
    }

    // Case 2: Zero-array length / sum / product / fold / fold_while / some / find
    const stages_all_pure = stages.every((st) =>
      st.fn.call_ref === undefined && is_pure_no_call(st.fn.body)
    );
    const needs_len = ((root.kind === "array" || root.kind === "list_array") &&
      root.needs_snapshot === true) ||
      root.kind === "typed_array";

    if (
      resolved_term.kind === "length" || resolved_term.kind === "sum" ||
      resolved_term.kind === "product"
    ) {
      if (
        resolved_term.kind === "length" && stages.length === 0 &&
        (root.kind === "array" || root.kind === "list_array" ||
          root.kind === "typed_array")
      ) {
        return {
          expression: member(root.items, "length"),
          direct: true,
        };
      }
      if (
        resolved_term.kind === "length" && stages.length === 0 &&
        (root.kind === "set" || root.kind === "map")
      ) {
        return {
          expression: member(root.items, "size"),
          direct: true,
        };
      }
      const copy_snap = root.needs_snapshot === true &&
        !is_fresh_collection_expr(root.items) && !stages_all_pure;
      if (
        copy_snap && root.kind !== "array" && root.kind !== "list_array"
      ) return undefined;
      const acc_id = services.fresh("arr_acc");
      const loop_stmts: Statement[] = [];
      const item_expr = emit_stages(loop_stmts, elem_access);
      if (resolved_term.kind === "length") {
        if (!stages_all_pure) {
          loop_stmts.push(
            node({ type: "ExpressionStatement", expression: item_expr }),
          );
        }
        loop_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "+=",
              left: acc_id,
              right: literal(1),
            }),
          }),
        );
      } else {
        loop_stmts.push(
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: resolved_term.kind === "sum" ? "+=" : "*=",
              left: acc_id,
              right: item_expr,
            }),
          }),
        );
      }
      const src_init = copy_snap
        ? call(member(root.items, "slice"), [])
        : root.items;
      const stmts: Statement[] = [variable(src_id, src_init, "const")];
      if (needs_len) {
        stmts.push(variable(len_id, member(src_id, "length"), "const"));
      }
      stmts.push(
        variable(
          acc_id,
          literal(resolved_term.kind === "product" ? 1 : 0),
          "let",
        ),
        build_fold_loop(loop_stmts),
        ret(acc_id),
      );
      return { expression: call(arrow([], block(stmts)), []), direct: true };
    }

    if (resolved_term.kind === "some" || resolved_term.kind === "find") {
      const pred_arrow = extract_unary_arrow(resolved_term.pred);
      let pred_fn_id: IdentifierReference | undefined;
      let copy_array_snapshot = false;
      const pred_pure = pred_arrow !== undefined &&
        pred_arrow.call_ref === undefined && is_pure_no_call(pred_arrow.body);
      if (pred_arrow === undefined) {
        if (!is_safe_callable_ref(resolved_term.pred)) return undefined;
        if (
          root.kind !== "array" && root.kind !== "list_array" &&
          !root.is_view && !is_fresh_collection_expr(root.items)
        ) return undefined;
        if (
          (root.kind === "array" || root.kind === "list_array") &&
          root.needs_snapshot && !is_fresh_collection_expr(root.items)
        ) copy_array_snapshot = true;
        pred_fn_id = services.fresh("arr_pred");
      } else if (
        root.needs_snapshot && !is_fresh_collection_expr(root.items) &&
        (!stages_all_pure || !pred_pure)
      ) {
        if (root.kind === "array" || root.kind === "list_array") {
          copy_array_snapshot = true;
        } else return undefined;
      }
      const loop_stmts: Statement[] = [];
      const item_expr = emit_stages(loop_stmts, elem_access);
      const item_var = direct_item_id !== undefined && stages.length === 0
        ? direct_item_id
        : services.fresh("arr_item");
      if (item_var !== direct_item_id) {
        loop_stmts.push(variable(item_var, item_expr, "const"));
      }
      const test_expr = pred_fn_id !== undefined
        ? call(pred_fn_id, [item_var])
        : apply_unary(pred_arrow!, item_var);
      loop_stmts.push(
        node({
          type: "IfStatement",
          test: test_expr,
          consequent: ret(
            resolved_term.kind === "some" ? literal(true) : item_var,
          ),
          alternate: null,
        }),
      );
      const src_init = copy_array_snapshot
        ? call(member(root.items, "slice"), [])
        : root.items;
      const stmts: Statement[] = [variable(src_id, src_init, "const")];
      if (needs_len) {
        stmts.push(variable(len_id, member(src_id, "length"), "const"));
      }
      if (pred_fn_id !== undefined) {
        stmts.push(variable(pred_fn_id, resolved_term.pred, "const"));
      }
      stmts.push(
        build_fold_loop(loop_stmts),
        ret(resolved_term.kind === "some" ? literal(false) : void_zero()),
      );
      return { expression: call(arrow([], block(stmts)), []), direct: true };
    }

    // fold or fold_while
    if (
      resolved_term.kind !== "fold" && resolved_term.kind !== "fold_while"
    ) return undefined;
    if (
      lexical_hazard(resolved_term.init) ||
      contains_await_yield(resolved_term.init) ||
      contains_generator_or_do(resolved_term.init)
    ) return undefined;
    // Skip untyped empty array literal init (`[]`) to preserve strict TS inference.
    const init_unwrapped = parentheses(resolved_term.init);
    if (
      init_unwrapped.type === "ArrayExpression" &&
      init_unwrapped.elements.length === 0
    ) return undefined;
    const step_arrow = extract_binary_arrow(resolved_term.step);
    let step_fn_id: IdentifierReference | undefined;
    let copy_fold_snapshot = false;
    const step_pure = step_arrow !== undefined &&
      is_pure_no_call(step_arrow.body);
    if (step_arrow === undefined) {
      if (!is_safe_callable_ref(resolved_term.step)) return undefined;
      if (
        root.kind !== "array" && root.kind !== "list_array" &&
        !root.is_view && !is_fresh_collection_expr(root.items)
      ) return undefined;
      if (
        (root.kind === "array" || root.kind === "list_array") &&
        root.needs_snapshot && !is_fresh_collection_expr(root.items)
      ) copy_fold_snapshot = true;
      step_fn_id = services.fresh("arr_step_fn");
    } else if (
      root.needs_snapshot && !is_fresh_collection_expr(root.items) &&
      (!stages_all_pure || !step_pure)
    ) {
      if (root.kind === "array" || root.kind === "list_array") {
        copy_fold_snapshot = true;
      } else return undefined;
    }

    const acc_id = services.fresh("arr_acc");
    const loop_stmts: Statement[] = [];
    const item_expr = emit_stages(loop_stmts, elem_access);
    const item_var = direct_item_id !== undefined && stages.length === 0
      ? direct_item_id
      : services.fresh("arr_item");
    if (item_var !== direct_item_id) {
      loop_stmts.push(variable(item_var, item_expr, "const"));
    }
    let step_body: Expression;
    if (step_fn_id !== undefined) {
      step_body = call(step_fn_id, [acc_id, item_var]);
    } else {
      step_body = step_arrow!.body;
      if (step_arrow!.first_decl !== null) {
        step_body = substitute_ident(
          step_body,
          step_arrow!.first_decl,
          acc_id,
          services,
        );
      }
      if (step_arrow!.second_decl !== null) {
        step_body = substitute_ident(
          step_body,
          step_arrow!.second_decl,
          item_var,
          services,
        );
      }
    }

    if (resolved_term.kind === "fold") {
      loop_stmts.push(
        node({
          type: "ExpressionStatement",
          expression: node({
            type: "AssignmentExpression",
            operator: "=",
            left: acc_id,
            right: step_body,
          }),
        }),
      );
    } else {
      // fold_while: try eliding ["Continue", ...] / ["Done", ...] ternary
      const cond = unwrap(step_body);
      let elided_fw = false;
      if (cond.type === "ConditionalExpression") {
        const c_yes = match_fold_step(cond.consequent);
        const c_no = match_fold_step(cond.alternate);
        if (
          c_yes !== undefined && c_no !== undefined && c_yes.done !== c_no.done
        ) {
          const done_test = c_yes.done ? cond.test : node({
            type: "UnaryExpression",
            operator: "!",
            prefix: true,
            argument: cond.test,
          });
          const done_val = c_yes.done ? c_yes.value : c_no.value;
          const cont_val = c_yes.done ? c_no.value : c_yes.value;
          loop_stmts.push(
            node({
              type: "IfStatement",
              test: done_test,
              consequent: block([
                node({
                  type: "ExpressionStatement",
                  expression: node({
                    type: "AssignmentExpression",
                    operator: "=",
                    left: acc_id,
                    right: done_val,
                  }),
                }),
                node({ type: "BreakStatement", label: null }),
              ]),
              alternate: null,
            }),
            node({
              type: "ExpressionStatement",
              expression: node({
                type: "AssignmentExpression",
                operator: "=",
                left: acc_id,
                right: cont_val,
              }),
            }),
          );
          elided_fw = true;
        }
      }
      if (!elided_fw) {
        const step_var = services.fresh("arr_step");
        loop_stmts.push(
          variable(step_var, step_body, "const"),
          node({
            type: "ExpressionStatement",
            expression: node({
              type: "AssignmentExpression",
              operator: "=",
              left: acc_id,
              right: node({
                type: "MemberExpression",
                object: step_var,
                property: literal(1),
                computed: true,
                optional: false,
              }),
            }),
          }),
          node({
            type: "IfStatement",
            test: node({
              type: "BinaryExpression",
              operator: "===",
              left: node({
                type: "MemberExpression",
                object: step_var,
                property: literal(0),
                computed: true,
                optional: false,
              }),
              right: literal("Done"),
            }),
            consequent: node({ type: "BreakStatement", label: null }),
            alternate: null,
          }),
        );
      }
    }

    const fold_src_init = copy_fold_snapshot
      ? call(member(root.items, "slice"), [])
      : root.items;
    const stmts: Statement[] = [];
    if (resolved_term.kind === "fold" && resolved_term.prelude_order) {
      // Preserve left-to-right argument evaluation order: foldl(fn, init, value)
      if (step_fn_id !== undefined) {
        stmts.push(variable(step_fn_id, resolved_term.step, "const"));
      }
      stmts.push(variable(acc_id, resolved_term.init, "let"));
      stmts.push(variable(src_id, fold_src_init, "const"));
      if (needs_len) {
        stmts.push(variable(len_id, member(src_id, "length"), "const"));
      }
    } else {
      stmts.push(variable(src_id, fold_src_init, "const"));
      if (needs_len) {
        stmts.push(variable(len_id, member(src_id, "length"), "const"));
      }
      stmts.push(variable(acc_id, resolved_term.init, "let"));
      if (step_fn_id !== undefined) {
        stmts.push(variable(step_fn_id, resolved_term.step, "const"));
      }
    }
    stmts.push(build_fold_loop(loop_stmts), ret(acc_id));
    return { expression: call(arrow([], block(stmts)), []), direct: true };
  }

  // =========================================================================
  // P9 + R4: Direct Do(Stm, ...) / untagged Do / atomically(Do(...)) journal fusion
  // =========================================================================
  function is_stm_dict(expr: Expression): boolean {
    return is_imported_from_set(expr, services.imports.stm_dictionaries) ||
      is_ns_member(expr, services.imports.stm_namespaces, "Stm") ||
      is_ns_member(expr, services.imports.namespaces, "Stm");
  }

  function stm_dict_anchor(expr: Expression): string | undefined {
    if (is_imported_from_set(expr, services.imports.stm_dictionaries)) {
      return (expr as IdentifierReference).name;
    }
    if (
      is_ns_member(expr, services.imports.stm_namespaces, "Stm") ||
      is_ns_member(expr, services.imports.namespaces, "Stm")
    ) {
      return ((expr as Extract<Expression, { type: "MemberExpression" }>)
        .object as IdentifierReference).name;
    }
    return undefined;
  }

  function stm_atomically_anchor(expr: Expression): string | undefined {
    if (is_imported_from_set(expr, services.imports.stm_atomically_functions)) {
      return (expr as IdentifierReference).name;
    }
    if (
      is_ns_member(expr, services.imports.stm_namespaces, "atomically") ||
      is_ns_member(expr, services.imports.namespaces, "atomically")
    ) {
      return ((expr as Extract<Expression, { type: "MemberExpression" }>)
        .object as IdentifierReference).name;
    }
    return undefined;
  }

  function match_stm_primitive_call(
    expr: Expression,
  ):
    | {
      readonly name:
        | "read_tvar"
        | "write_tvar"
        | "modify_tvar"
        | "retry"
        | "abort"
        | "or_else";
      readonly anchor: string;
      readonly call: CallExpression;
    }
    | undefined {
    const val = parentheses(expr);
    if (
      val.type !== "CallExpression" || val.optional ||
      val.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;
    const callee = parentheses(val.callee);
    if (callee.type === "Identifier" && services.bindings.imported(callee)) {
      const prim = services.imports.stm_primitive_functions?.get(callee.name);
      if (prim !== undefined) {
        return { name: prim, anchor: callee.name, call: val };
      }
    }
    if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      services.bindings.imported(callee.object) &&
      (services.imports.stm_namespaces?.has(callee.object.name) ||
        services.imports.namespaces.has(callee.object.name))
    ) {
      const prop = callee.property.name;
      if (
        prop === "read_tvar" || prop === "write_tvar" ||
        prop === "modify_tvar" || prop === "retry" || prop === "abort" ||
        prop === "or_else"
      ) {
        return { name: prop, anchor: callee.object.name, call: val };
      }
    }
    return undefined;
  }

  function stm_do_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.generator === false ||
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.some((a) => a.type === "SpreadElement")
    ) return undefined;

    let do_call: CallExpression | undefined;
    let is_atomically = false;
    let stm_anchor: string | undefined;
    let stm_dict: Expression | undefined;

    const atom_anchor = outer.arguments.length === 1
      ? stm_atomically_anchor(parentheses(outer.callee))
      : undefined;
    if (atom_anchor !== undefined) {
      const inner = parentheses(outer.arguments[0] as Expression);
      if (
        inner.type === "CallExpression" && !inner.optional &&
        inner.typeArguments == null &&
        !inner.arguments.some((a) => a.type === "SpreadElement") &&
        services.kind(inner) === "do"
      ) {
        do_call = inner;
        is_atomically = true;
        stm_anchor = atom_anchor;
      } else if (
        inner.type === "CallExpression" && !inner.optional &&
        !inner.arguments.some((a) => a.type === "SpreadElement") &&
        !lexical_hazard(inner) && !contains_await_yield(inner)
      ) {
        // PPF-12: Single-primitive atomically(read_tvar/write_tvar/modify_tvar/Stm.pure/retry/abort)
        const direct_id = services.import_from_module?.(
          atom_anchor,
          "stm",
          "stm_atomically_direct",
        );
        if (direct_id !== undefined) {
          const j_id = services.fresh("stm_j");
          const ic = parentheses(inner.callee);
          if (
            inner.typeArguments == null && inner.arguments.length === 1 &&
            ic.type === "MemberExpression" && !ic.computed && !ic.optional &&
            ic.property.type === "Identifier" && ic.property.name === "pure" &&
            is_stm_dict(ic.object) &&
            is_pure_no_call(inner.arguments[0] as Expression)
          ) {
            return {
              expression: call(direct_id, [
                arrow([], inner.arguments[0] as Expression),
              ]),
              direct: true,
            };
          }
          const prim = match_stm_primitive_call(inner);
          if (prim !== undefined) {
            if (
              prim.name === "read_tvar" && prim.call.arguments.length === 1 &&
              is_pure_no_call(prim.call.arguments[0] as Expression)
            ) {
              const r_id = services.import_from_module?.(
                atom_anchor,
                "stm",
                "stm_read_journal",
              );
              if (r_id !== undefined) {
                const c = call(r_id, [
                  j_id,
                  prim.call.arguments[0] as Expression,
                ]);
                if (prim.call.typeArguments != null) {
                  c.typeArguments = prim.call.typeArguments;
                }
                return {
                  expression: call(direct_id, [arrow([j_id], c)]),
                  direct: true,
                };
              }
            } else if (
              prim.name === "write_tvar" && prim.call.arguments.length === 2 &&
              is_pure_no_call(prim.call.arguments[0] as Expression) &&
              is_pure_no_call(prim.call.arguments[1] as Expression)
            ) {
              const w_id = services.import_from_module?.(
                atom_anchor,
                "stm",
                "stm_write_journal",
              );
              if (w_id !== undefined) {
                const c = call(w_id, [
                  j_id,
                  prim.call.arguments[0] as Expression,
                  prim.call.arguments[1] as Expression,
                ]);
                if (prim.call.typeArguments != null) {
                  c.typeArguments = prim.call.typeArguments;
                }
                return {
                  expression: call(direct_id, [arrow([j_id], c)]),
                  direct: true,
                };
              }
            } else if (
              prim.name === "modify_tvar" && prim.call.arguments.length === 2 &&
              is_pure_no_call(prim.call.arguments[0] as Expression)
            ) {
              const parsed_fn = extract_unary_arrow(
                prim.call.arguments[1] as Expression,
              );
              if (parsed_fn !== undefined) {
                const r_id = services.import_from_module?.(
                  atom_anchor,
                  "stm",
                  "stm_read_journal",
                );
                const w_id = services.import_from_module?.(
                  atom_anchor,
                  "stm",
                  "stm_write_journal",
                );
                if (r_id !== undefined && w_id !== undefined) {
                  const cur_id = services.fresh("stm_cur");
                  const next_id = services.fresh("stm_next");
                  const tv_arg = prim.call.arguments[0] as Expression;
                  const read_c = call(r_id, [j_id, tv_arg]);
                  const next_expr = parsed_fn.call_ref !== undefined
                    ? call(parsed_fn.call_ref, [cur_id])
                    : parsed_fn.param_decl !== null
                    ? substitute_ident(
                      parsed_fn.body,
                      parsed_fn.param_decl,
                      cur_id,
                      services,
                    )
                    : parsed_fn.body;
                  const write_c = call(w_id, [j_id, tv_arg, next_id]);
                  if (prim.call.typeArguments != null) {
                    read_c.typeArguments = prim.call.typeArguments;
                    write_c.typeArguments = prim.call.typeArguments;
                  }
                  return {
                    expression: call(direct_id, [
                      arrow(
                        [j_id],
                        block([
                          variable(cur_id, read_c, "const"),
                          variable(next_id, next_expr, "const"),
                          node({
                            type: "ExpressionStatement",
                            expression: write_c,
                          }),
                          ret(next_id),
                        ]),
                      ),
                    ]),
                    direct: true,
                  };
                }
              } else if (
                is_pure_no_call(prim.call.arguments[1] as Expression)
              ) {
                const m_id = services.import_from_module?.(
                  atom_anchor,
                  "stm",
                  "stm_modify_journal",
                );
                if (m_id !== undefined) {
                  const c = call(m_id, [
                    j_id,
                    prim.call.arguments[0] as Expression,
                    prim.call.arguments[1] as Expression,
                  ]);
                  if (prim.call.typeArguments != null) {
                    c.typeArguments = prim.call.typeArguments;
                  }
                  return {
                    expression: call(direct_id, [arrow([j_id], c)]),
                    direct: true,
                  };
                }
              }
            }
          }
        }
      }
    } else if (services.kind(outer) === "do") {
      do_call = outer;
    }
    if (do_call === undefined) return undefined;
    if (do_call.arguments.length !== 1 && do_call.arguments.length !== 2) {
      return undefined;
    }

    const run_arg = do_call.arguments[do_call.arguments.length - 1];
    if (
      run_arg.type !== "FunctionExpression" || !valid_generator(run_arg) ||
      lexical_hazard(run_arg.body!)
    ) return undefined;

    if (do_call.arguments.length === 2) {
      const candidate_dict = parentheses(do_call.arguments[0] as Expression);
      if (!is_stm_dict(candidate_dict)) return undefined;
      stm_dict = candidate_dict;
      stm_anchor ??= stm_dict_anchor(candidate_dict);
    } else {
      // Untagged Do(function* () { ... }): infer Stm from first yield* STM primitive.
      let first_yield: Expression | undefined;
      walk(run_arg.body!, (child) => {
        if (first_yield !== undefined || function_like(child)) return false;
        if (
          child.type === "YieldExpression" && child.delegate &&
          child.argument !== null
        ) {
          first_yield = child.argument;
          return false;
        }
      });
      if (first_yield === undefined) return undefined;
      const prim = match_stm_primitive_call(first_yield);
      if (prim !== undefined) {
        stm_anchor ??= prim.anchor;
      } else {
        const val = parentheses(first_yield);
        if (
          val.type === "CallExpression" && !val.optional &&
          val.callee.type === "MemberExpression" && !val.callee.computed &&
          !val.callee.optional && val.callee.property.type === "Identifier" &&
          val.callee.property.name === "pure" && is_stm_dict(val.callee.object)
        ) {
          stm_anchor ??= stm_dict_anchor(val.callee.object);
        } else {
          return undefined;
        }
      }
    }

    const body = run_arg.body!;
    if (
      do_call.arguments.length === 1 &&
      !reaches_unconditional_yield(body.body as Statement[])
    ) return undefined;
    if (
      (!is_atomically || do_call.arguments.length === 1) &&
      !has_pure_prefix_before_yield(body.body as Statement[])
    ) return undefined;

    function validate_stm_expr(expr: Expression): boolean {
      if (!contains_await_yield(expr)) return true;
      const target = unwrap(expr);
      if (target.type === "AwaitExpression") return false;
      if (target.type === "YieldExpression") {
        if (!target.delegate || target.argument === null) return false;
        return validate_stm_expr(target.argument);
      }
      switch (target.type) {
        case "BinaryExpression":
          return (target.left.type === "PrivateIdentifier" ||
            validate_stm_expr(target.left)) && validate_stm_expr(target.right);
        case "UnaryExpression":
          return validate_stm_expr(target.argument);
        case "SequenceExpression":
        case "TemplateLiteral":
          return target.expressions.every(validate_stm_expr);
        case "ArrayExpression":
          return target.elements.every((el) =>
            el === null
              ? true
              : el.type === "SpreadElement"
              ? validate_stm_expr(el.argument)
              : validate_stm_expr(el)
          );
        case "ObjectExpression":
          return target.properties.every((prop) =>
            prop.type === "SpreadElement"
              ? validate_stm_expr(prop.argument)
              : (!prop.computed || validate_stm_expr(prop.key as Expression)) &&
                validate_stm_expr(prop.value as Expression)
          );
        case "MemberExpression":
          return !target.optional && validate_stm_expr(target.object) &&
            (!target.computed ||
              validate_stm_expr(target.property as Expression));
        case "CallExpression":
        case "NewExpression":
          if (target.type === "CallExpression" && target.optional) return false;
          return validate_stm_expr(target.callee as Expression) &&
            target.arguments.every((arg) =>
              arg.type === "SpreadElement"
                ? validate_stm_expr(arg.argument)
                : validate_stm_expr(arg)
            );
        case "AssignmentExpression":
          return target.left.type === "Identifier" &&
            validate_stm_expr(target.right);
        case "ConditionalExpression":
          return validate_stm_expr(target.test) &&
            validate_stm_expr(target.consequent) &&
            validate_stm_expr(target.alternate);
        case "LogicalExpression":
          return validate_stm_expr(target.left) &&
            validate_stm_expr(target.right);
        case "TSAsExpression":
        case "TSTypeAssertion":
        case "TSNonNullExpression":
        case "TSSatisfiesExpression":
          return validate_stm_expr(target.expression);
        default:
          return false;
      }
    }

    function validate_stm_stmt(
      stmt: Statement,
      in_loop: boolean,
      in_switch: boolean,
    ): boolean {
      if (
        stmt.type === "ExpressionStatement" && "directive" in stmt &&
        stmt.directive != null
      ) return true;
      switch (stmt.type) {
        case "EmptyStatement":
          return true;
        case "ThrowStatement":
          return !contains_await_yield(stmt.argument);
        case "TryStatement":
          return !contains_await_yield(stmt);
        case "LabeledStatement":
        case "WithStatement":
          return false;
        case "BreakStatement":
          return stmt.label === null && (in_loop || in_switch);
        case "ContinueStatement":
          return stmt.label === null && in_loop;
        case "ReturnStatement":
          return stmt.argument === null || validate_stm_expr(stmt.argument);
        case "VariableDeclaration":
          if (stmt.kind === "var") return false;
          return stmt.declarations.every((d) =>
            d.init === null || validate_stm_expr(d.init)
          );
        case "ExpressionStatement":
          return validate_stm_expr(stmt.expression);
        case "BlockStatement":
          return stmt.body.every((s) =>
            validate_stm_stmt(s as Statement, in_loop, in_switch)
          );
        case "IfStatement":
          return validate_stm_expr(stmt.test) &&
            validate_stm_stmt(stmt.consequent, in_loop, in_switch) &&
            (stmt.alternate === null ||
              validate_stm_stmt(stmt.alternate, in_loop, in_switch));
        case "ForStatement":
          if (
            stmt.init !== null &&
            ((stmt.init.type === "VariableDeclaration" &&
              stmt.init.kind === "var") ||
              contains_await_yield(stmt.init))
          ) return false;
          if (stmt.update !== null && contains_await_yield(stmt.update)) {
            return false;
          }
          if (stmt.test !== null && !validate_stm_expr(stmt.test)) return false;
          return validate_stm_stmt(stmt.body, true, in_switch);
        case "WhileStatement":
          return validate_stm_expr(stmt.test) &&
            validate_stm_stmt(stmt.body, true, in_switch);
        case "DoWhileStatement":
          return !contains_await_yield(stmt.test) &&
            validate_stm_stmt(stmt.body, true, in_switch);
        case "ForOfStatement":
          if (
            stmt.await ||
            (stmt.left.type === "VariableDeclaration" &&
              stmt.left.kind === "var") ||
            contains_await_yield(stmt.left) ||
            contains_await_yield(stmt.right)
          ) return false;
          return validate_stm_stmt(stmt.body, true, in_switch);
        case "ForInStatement":
          if (
            (stmt.left.type === "VariableDeclaration" &&
              stmt.left.kind === "var") ||
            contains_await_yield(stmt.left) ||
            contains_await_yield(stmt.right)
          ) return false;
          return validate_stm_stmt(stmt.body, true, in_switch);
        case "SwitchStatement":
          if (!validate_stm_expr(stmt.discriminant)) return false;
          return stmt.cases.every((c) =>
            (c.test === null || !contains_await_yield(c.test)) &&
            c.consequent.every((inner) =>
              validate_stm_stmt(inner as Statement, in_loop, true)
            )
          );
        default:
          return !contains_await_yield(stmt);
      }
    }

    for (const stmt of body.body) {
      if (!validate_stm_stmt(stmt as Statement, false, false)) return undefined;
    }

    const journal_id = services.fresh("stm_j");
    let read_j_id: IdentifierReference | undefined;
    let write_j_id: IdentifierReference | undefined;
    let modify_j_id: IdentifierReference | undefined;
    let stm_retry_id: IdentifierReference | undefined;
    let stm_error_id: IdentifierReference | undefined;
    const import_stm_helper = (
      helper_name: string,
      fallback_anchor?: string,
    ): IdentifierReference | undefined => {
      const anchor = stm_anchor ?? fallback_anchor;
      if (anchor === undefined) return undefined;
      return services.import_from_module?.(anchor, "stm", helper_name);
    };
    const resolve_stm_retry = (
      fallback_anchor?: string,
    ): IdentifierReference | undefined => {
      if (stm_retry_id !== undefined) return stm_retry_id;
      const existing = first_unshadowed(services.imports.stm_retry_classes);
      stm_retry_id = existing !== undefined
        ? id(existing)
        : import_stm_helper("StmRetry", fallback_anchor);
      return stm_retry_id;
    };
    const resolve_stm_error = (
      fallback_anchor?: string,
    ): IdentifierReference | undefined => {
      if (stm_error_id !== undefined) return stm_error_id;
      const existing = first_unshadowed(services.imports.stm_error_classes);
      stm_error_id = existing !== undefined
        ? id(existing)
        : import_stm_helper("StmError", fallback_anchor);
      return stm_error_id;
    };

    function emit_stm_yield(
      raw_arg: Expression,
      target_stmts: Statement[],
      beta_reduce_modify = true,
    ): Expression {
      const lowered = lower_stm_expr(raw_arg, target_stmts);
      const val = parentheses(lowered);
      if (
        val.type === "CallExpression" && !val.optional &&
        val.typeArguments == null && val.arguments.length === 1 &&
        val.arguments[0].type !== "SpreadElement" &&
        val.callee.type === "MemberExpression" && !val.callee.computed &&
        !val.callee.optional && val.callee.property.type === "Identifier" &&
        val.callee.property.name === "pure" && is_stm_dict(val.callee.object)
      ) {
        return val.arguments[0] as Expression;
      }
      const prim = match_stm_primitive_call(val);
      if (prim !== undefined) {
        if (prim.name === "read_tvar" && prim.call.arguments.length === 1) {
          read_j_id ??= import_stm_helper("stm_read_journal", prim.anchor);
          if (read_j_id !== undefined) {
            const c = call(read_j_id, [
              journal_id,
              prim.call.arguments[0] as Expression,
            ]);
            if (prim.call.typeArguments != null) {
              c.typeArguments = prim.call.typeArguments;
            }
            return c;
          }
        } else if (
          prim.name === "write_tvar" && prim.call.arguments.length === 2
        ) {
          write_j_id ??= import_stm_helper("stm_write_journal", prim.anchor);
          if (write_j_id !== undefined) {
            const c = call(write_j_id, [
              journal_id,
              prim.call.arguments[0] as Expression,
              prim.call.arguments[1] as Expression,
            ]);
            if (prim.call.typeArguments != null) {
              c.typeArguments = prim.call.typeArguments;
            }
            return c;
          }
        } else if (
          prim.name === "modify_tvar" && prim.call.arguments.length === 2
        ) {
          if (beta_reduce_modify) {
            const parsed_fn = extract_unary_arrow(
              prim.call.arguments[1] as Expression,
            );
            if (parsed_fn !== undefined) {
              read_j_id ??= import_stm_helper("stm_read_journal", prim.anchor);
              write_j_id ??= import_stm_helper(
                "stm_write_journal",
                prim.anchor,
              );
              if (read_j_id !== undefined && write_j_id !== undefined) {
                const raw_tv = prim.call.arguments[0] as Expression;
                let tv_ref = raw_tv;
                if (!is_trivial_pure(raw_tv)) {
                  const tv_tmp = services.fresh("stm_tv");
                  target_stmts.push(variable(tv_tmp, raw_tv, "const"));
                  tv_ref = tv_tmp;
                }
                const cur_id = services.fresh("stm_cur");
                const next_id = services.fresh("stm_next");
                const read_c = call(read_j_id, [journal_id, tv_ref]);
                const next_expr = parsed_fn.call_ref !== undefined
                  ? call(parsed_fn.call_ref, [cur_id])
                  : parsed_fn.param_decl !== null
                  ? substitute_ident(
                    parsed_fn.body,
                    parsed_fn.param_decl,
                    cur_id,
                    services,
                  )
                  : parsed_fn.body;
                const write_c = call(write_j_id, [journal_id, tv_ref, next_id]);
                if (prim.call.typeArguments != null) {
                  read_c.typeArguments = prim.call.typeArguments;
                  write_c.typeArguments = prim.call.typeArguments;
                }
                target_stmts.push(
                  variable(cur_id, read_c, "const"),
                  variable(next_id, next_expr, "const"),
                  node({
                    type: "ExpressionStatement",
                    expression: write_c,
                  }),
                );
                return next_id;
              }
            }
          }
          modify_j_id ??= import_stm_helper("stm_modify_journal", prim.anchor);
          if (modify_j_id !== undefined) {
            const c = call(modify_j_id, [
              journal_id,
              prim.call.arguments[0] as Expression,
              prim.call.arguments[1] as Expression,
            ]);
            if (prim.call.typeArguments != null) {
              c.typeArguments = prim.call.typeArguments;
            }
            return c;
          }
        } else if (prim.name === "retry" && prim.call.arguments.length === 0) {
          const retry_cls = resolve_stm_retry(prim.anchor);
          if (retry_cls !== undefined) {
            const throw_iife: Expression = call(
              arrow(
                [],
                block([
                  node({
                    type: "ThrowStatement",
                    argument: node({
                      type: "NewExpression",
                      callee: retry_cls,
                      arguments: [],
                    }),
                  }),
                ]),
              ),
              [],
            );
            const t_arg = prim.call.typeArguments?.params.length === 1
              ? prim.call.typeArguments.params[0]
              : undefined;
            return t_arg !== undefined
              ? node({
                type: "TSAsExpression",
                expression: throw_iife,
                typeAnnotation: t_arg,
              })
              : throw_iife;
          }
        } else if (prim.name === "abort" && prim.call.arguments.length === 1) {
          const err_cls = resolve_stm_error(prim.anchor);
          if (err_cls !== undefined) {
            const throw_iife: Expression = call(
              arrow(
                [],
                block([
                  node({
                    type: "ThrowStatement",
                    argument: node({
                      type: "NewExpression",
                      callee: err_cls,
                      arguments: [prim.call.arguments[0] as Expression],
                    }),
                  }),
                ]),
              ),
              [],
            );
            const t_arg = prim.call.typeArguments?.params.length === 1
              ? prim.call.typeArguments.params[0]
              : undefined;
            return t_arg !== undefined
              ? node({
                type: "TSAsExpression",
                expression: throw_iife,
                typeAnnotation: t_arg,
              })
              : throw_iife;
          }
        }
      }
      return call(call(member(lowered, "value"), []), [journal_id]);
    }

    function lower_stm_ordered<T extends Expression | null>(
      items: readonly T[],
      target_stmts: Statement[],
    ): T[] {
      let last_yield = -1;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item !== null && contains_yield(item)) last_yield = i;
      }
      if (last_yield < 0) return [...items];
      const out: T[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item === null) {
          out.push(item);
          continue;
        }
        if (i < last_yield) {
          const lowered = contains_yield(item)
            ? lower_stm_expr(item, target_stmts)
            : item;
          if (!is_trivial_pure(lowered)) {
            const tmp = services.fresh("stm_arg");
            target_stmts.push(variable(tmp, lowered, "const"));
            out.push(tmp as T);
          } else out.push(lowered as T);
        } else if (i === last_yield) {
          out.push(lower_stm_expr(item, target_stmts) as T);
        } else {
          out.push(item);
        }
      }
      return out;
    }

    function lower_stm_expr(
      expr: Expression,
      target_stmts: Statement[],
    ): Expression {
      if (!contains_yield(expr)) return expr;
      if (expr.type === "ParenthesizedExpression") {
        return lower_stm_expr(expr.expression, target_stmts);
      }
      if (yield_star(expr)) {
        return emit_stm_yield(expr.argument, target_stmts);
      }
      switch (expr.type) {
        case "BinaryExpression": {
          if (expr.left.type === "PrivateIdentifier") {
            return { ...expr, right: lower_stm_expr(expr.right, target_stmts) };
          }
          const [left, right] = lower_stm_ordered(
            [expr.left, expr.right],
            target_stmts,
          );
          return { ...expr, left: left!, right: right! };
        }
        case "UnaryExpression":
          return {
            ...expr,
            argument: lower_stm_expr(expr.argument, target_stmts),
          };
        case "SequenceExpression":
          return {
            ...expr,
            expressions: lower_stm_ordered(expr.expressions, target_stmts),
          };
        case "TemplateLiteral":
          return {
            ...expr,
            expressions: lower_stm_ordered(expr.expressions, target_stmts),
          };
        case "ArrayExpression": {
          let last_yield = -1;
          for (let i = 0; i < expr.elements.length; i += 1) {
            const el = expr.elements[i];
            if (el !== null && contains_yield(el)) last_yield = i;
          }
          const elements = expr.elements.map((el, i) => {
            if (el === null || i > last_yield) return el;
            if (el.type === "SpreadElement") {
              const lowered = lower_stm_expr(el.argument, target_stmts);
              if (i < last_yield && !is_trivial_pure(lowered)) {
                const tmp = services.fresh("stm_arg");
                target_stmts.push(variable(tmp, lowered, "const"));
                return { ...el, argument: tmp };
              }
              return { ...el, argument: lowered };
            }
            const lowered = lower_stm_expr(el, target_stmts);
            if (i < last_yield && !is_trivial_pure(lowered)) {
              const tmp = services.fresh("stm_arg");
              target_stmts.push(variable(tmp, lowered, "const"));
              return tmp;
            }
            return lowered;
          });
          return { ...expr, elements };
        }
        case "ObjectExpression": {
          let last_yield = -1;
          for (let i = 0; i < expr.properties.length; i += 1) {
            if (contains_yield(expr.properties[i])) last_yield = i;
          }
          const properties = expr.properties.map((prop, i) => {
            if (i > last_yield) return prop;
            if (prop.type === "SpreadElement") {
              const lowered = lower_stm_expr(prop.argument, target_stmts);
              if (i < last_yield && !is_trivial_pure(lowered)) {
                const tmp = services.fresh("stm_arg");
                target_stmts.push(variable(tmp, lowered, "const"));
                return { ...prop, argument: tmp };
              }
              return { ...prop, argument: lowered };
            }
            let key = prop.key;
            if (prop.computed) {
              const lk = lower_stm_expr(prop.key as Expression, target_stmts);
              if (
                contains_yield(prop.value) ||
                (i < last_yield && !is_trivial_pure(lk))
              ) {
                const tmp = services.fresh("stm_key");
                target_stmts.push(variable(tmp, lk, "const"));
                key = tmp;
              } else key = lk;
            }
            const lv = lower_stm_expr(prop.value as Expression, target_stmts);
            if (i < last_yield && !is_trivial_pure(lv)) {
              const tmp = services.fresh("stm_val");
              target_stmts.push(variable(tmp, lv, "const"));
              return { ...prop, key, value: tmp, shorthand: false };
            }
            return { ...prop, key, value: lv, shorthand: false };
          });
          return { ...expr, properties };
        }
        case "MemberExpression": {
          if (!expr.computed) {
            return {
              ...expr,
              object: lower_stm_expr(expr.object, target_stmts),
            };
          }
          const [object, property] = lower_stm_ordered(
            [expr.object, expr.property as Expression],
            target_stmts,
          );
          return { ...expr, object, property };
        }
        case "CallExpression":
        case "NewExpression": {
          let last_arg = -1;
          for (let i = 0; i < expr.arguments.length; i += 1) {
            if (contains_yield(expr.arguments[i])) last_arg = i;
          }
          let inner_callee = expr.callee;
          if (last_arg >= 0) {
            if (
              expr.type === "CallExpression" &&
              inner_callee.type === "MemberExpression" && !inner_callee.optional
            ) {
              const obj = lower_stm_expr(inner_callee.object, target_stmts);
              const obj_tmp = services.fresh("stm_recv");
              target_stmts.push(variable(obj_tmp, obj, "const"));
              if (inner_callee.computed) {
                const lp = lower_stm_expr(
                  inner_callee.property as Expression,
                  target_stmts,
                );
                const prop_tmp = services.fresh("stm_prop");
                target_stmts.push(variable(prop_tmp, lp, "const"));
                inner_callee = {
                  ...inner_callee,
                  object: obj_tmp,
                  property: prop_tmp,
                };
              } else inner_callee = { ...inner_callee, object: obj_tmp };
            } else if (
              contains_yield(inner_callee) ||
              !is_trivial_pure(inner_callee as Expression)
            ) {
              const lc = lower_stm_expr(
                inner_callee as Expression,
                target_stmts,
              );
              const tmp = services.fresh("stm_fn");
              target_stmts.push(variable(tmp, lc, "const"));
              inner_callee = tmp;
            }
          } else {
            inner_callee = lower_stm_expr(
              inner_callee as Expression,
              target_stmts,
            );
          }
          const args = expr.arguments.map((arg, i) => {
            if (i > last_arg) return arg;
            if (arg.type === "SpreadElement") {
              const la = lower_stm_expr(arg.argument, target_stmts);
              if (i < last_arg && !is_trivial_pure(la)) {
                const tmp = services.fresh("stm_arg");
                target_stmts.push(variable(tmp, la, "const"));
                return { ...arg, argument: tmp };
              }
              return { ...arg, argument: la };
            }
            const la = lower_stm_expr(arg, target_stmts);
            if (i < last_arg && !is_trivial_pure(la)) {
              const tmp = services.fresh("stm_arg");
              target_stmts.push(variable(tmp, la, "const"));
              return tmp;
            }
            return la;
          });
          return { ...expr, callee: inner_callee, arguments: args };
        }
        case "AssignmentExpression":
          return { ...expr, right: lower_stm_expr(expr.right, target_stmts) };
        case "ConditionalExpression": {
          const test = lower_stm_expr(expr.test, target_stmts);
          if (
            !contains_yield(expr.consequent) && !contains_yield(expr.alternate)
          ) return { ...expr, test };
          const out = services.fresh("stm_cond");
          const cons_stmts: Statement[] = [];
          const cons_val = lower_stm_expr(expr.consequent, cons_stmts);
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
          const alt_val = lower_stm_expr(expr.alternate, alt_stmts);
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
          const left = lower_stm_expr(expr.left, target_stmts);
          if (!contains_yield(expr.right)) return { ...expr, left };
          const out = services.fresh("stm_logic");
          target_stmts.push(variable(out, left, "let"));
          const right_stmts: Statement[] = [];
          const right_val = lower_stm_expr(expr.right, right_stmts);
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
          const guard: Expression = expr.operator === "&&"
            ? out
            : expr.operator === "||"
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
            ...expr,
            expression: lower_stm_expr(expr.expression, target_stmts),
          };
        default:
          return expr;
      }
    }

    function lower_stm_stmt(stmt: Statement): Statement[] {
      if (
        stmt.type === "ExpressionStatement" && "directive" in stmt &&
        stmt.directive != null
      ) return [stmt];
      switch (stmt.type) {
        case "VariableDeclaration": {
          const stmts: Statement[] = [];
          const declarations = stmt.declarations.map((decl) =>
            decl.init !== null && contains_yield(decl.init)
              ? { ...decl, init: lower_stm_expr(decl.init, stmts) }
              : decl
          );
          stmts.push({ ...stmt, declarations });
          return stmts;
        }
        case "ExpressionStatement": {
          if (!contains_yield(stmt.expression)) return [stmt];
          const stmts: Statement[] = [];
          const unwrapped = parentheses(stmt.expression);
          if (yield_star(unwrapped)) {
            const prim = match_stm_primitive_call(unwrapped.argument);
            if (
              prim !== undefined && prim.name === "retry" &&
              prim.call.arguments.length === 0
            ) {
              const retry_cls = resolve_stm_retry(prim.anchor);
              if (retry_cls !== undefined) {
                stmts.push(
                  node({
                    type: "ThrowStatement",
                    argument: node({
                      type: "NewExpression",
                      callee: retry_cls,
                      arguments: [],
                    }),
                  }),
                );
                return stmts;
              }
            }
            if (
              prim !== undefined && prim.name === "abort" &&
              prim.call.arguments.length === 1
            ) {
              const err_cls = resolve_stm_error(prim.anchor);
              if (err_cls !== undefined) {
                const msg = lower_stm_expr(
                  prim.call.arguments[0] as Expression,
                  stmts,
                );
                stmts.push(
                  node({
                    type: "ThrowStatement",
                    argument: node({
                      type: "NewExpression",
                      callee: err_cls,
                      arguments: [msg],
                    }),
                  }),
                );
                return stmts;
              }
            }
            const lowered = emit_stm_yield(unwrapped.argument, stmts, false);
            stmts.push({ ...stmt, expression: lowered });
            return stmts;
          }
          const lowered = lower_stm_expr(stmt.expression, stmts);
          stmts.push({ ...stmt, expression: lowered });
          return stmts;
        }
        case "ReturnStatement": {
          if (stmt.argument === null || !contains_yield(stmt.argument)) {
            return [stmt];
          }
          const stmts: Statement[] = [];
          const unwrapped = parentheses(stmt.argument);
          if (yield_star(unwrapped)) {
            const prim = match_stm_primitive_call(unwrapped.argument);
            if (
              prim !== undefined && prim.name === "retry" &&
              prim.call.arguments.length === 0
            ) {
              const retry_cls = resolve_stm_retry(prim.anchor);
              if (retry_cls !== undefined) {
                stmts.push(
                  node({
                    type: "ThrowStatement",
                    argument: node({
                      type: "NewExpression",
                      callee: retry_cls,
                      arguments: [],
                    }),
                  }),
                );
                return stmts;
              }
            }
            if (
              prim !== undefined && prim.name === "abort" &&
              prim.call.arguments.length === 1
            ) {
              const err_cls = resolve_stm_error(prim.anchor);
              if (err_cls !== undefined) {
                const msg = lower_stm_expr(
                  prim.call.arguments[0] as Expression,
                  stmts,
                );
                stmts.push(
                  node({
                    type: "ThrowStatement",
                    argument: node({
                      type: "NewExpression",
                      callee: err_cls,
                      arguments: [msg],
                    }),
                  }),
                );
                return stmts;
              }
            }
          }
          stmts.push(ret(lower_stm_expr(stmt.argument, stmts)));
          return stmts;
        }
        case "BlockStatement":
          return [block(lower_stm_list(stmt.body as Statement[]))];
        case "IfStatement": {
          const stmts: Statement[] = [];
          const test = lower_stm_expr(stmt.test, stmts);
          const consequent = lower_stm_single(stmt.consequent);
          const alternate = stmt.alternate !== null
            ? lower_stm_single(stmt.alternate)
            : null;
          stmts.push({ ...stmt, test, consequent, alternate });
          return stmts;
        }
        case "ForStatement": {
          const lowered_body = lower_stm_single(stmt.body);
          if (stmt.test !== null && contains_yield(stmt.test)) {
            const test_stmts: Statement[] = [];
            const test_val = lower_stm_expr(stmt.test, test_stmts);
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
              ...stmt,
              test: null,
              body: block([...test_stmts, ...(body_stmts as Statement[])]),
            }];
          }
          return [{ ...stmt, body: lowered_body }];
        }
        case "WhileStatement": {
          const lowered_body = lower_stm_single(stmt.body);
          if (contains_yield(stmt.test)) {
            const test_stmts: Statement[] = [];
            const test_val = lower_stm_expr(stmt.test, test_stmts);
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
              ...stmt,
              test: literal(true),
              body: block([...test_stmts, ...(body_stmts as Statement[])]),
            }];
          }
          return [{ ...stmt, body: lowered_body }];
        }
        case "DoWhileStatement":
        case "ForOfStatement":
        case "ForInStatement":
          return [{ ...stmt, body: lower_stm_single(stmt.body) }];
        case "SwitchStatement": {
          const stmts: Statement[] = [];
          const discriminant = lower_stm_expr(stmt.discriminant, stmts);
          const cases = stmt.cases.map((c) => ({
            ...c,
            consequent: lower_stm_list(c.consequent as Statement[]),
          }));
          stmts.push({ ...stmt, discriminant, cases });
          return stmts;
        }
        default:
          return [stmt];
      }
    }

    function lower_stm_list(list: readonly Statement[]): Statement[] {
      const out: Statement[] = [];
      for (const item of list) out.push(...lower_stm_stmt(item));
      return out;
    }

    function lower_stm_single(stmt: Statement): Statement {
      const list = lower_stm_stmt(stmt);
      return list.length === 1 ? list[0] : block(list);
    }

    const emitted = lower_stm_list(body.body as Statement[]);
    if (is_atomically) {
      const direct_id = import_stm_helper("stm_atomically_direct");
      if (direct_id === undefined) return undefined;
      return {
        expression: call(direct_id, [arrow([journal_id], block(emitted))]),
        direct: true,
      };
    }
    const trusted_id = import_stm_helper("stm_trusted");
    if (trusted_id !== undefined) {
      return {
        expression: call(trusted_id, [arrow([journal_id], block(emitted))]),
        direct: true,
      };
    }
    if (stm_dict === undefined) return undefined;
    return {
      expression: call(stm_dict, [arrow([journal_id], block(emitted))]),
      direct: true,
    };
  }

  // =========================================================================
  // Codex Suggestion: Direct-buffer list.to_array(Do(List, ...)) fusion
  // =========================================================================
  type ListSourceKind =
    | { readonly kind: "empty" }
    | { readonly kind: "pure"; readonly value: Expression }
    | {
      readonly kind: "array";
      readonly items: Expression;
      readonly needs_snapshot: boolean;
    }
    | { readonly kind: "list"; readonly expr: Expression };

  function classify_list_source(
    raw: Expression,
    require_known: boolean,
  ): ListSourceKind | undefined {
    const val = parentheses(raw);
    if (
      val.type === "CallExpression" && !val.optional &&
      !val.arguments.some((a) => a.type === "SpreadElement")
    ) {
      const c = parentheses(val.callee);
      if (
        val.arguments.length === 0 &&
        (is_imported_from_set(c, services.imports.nil_constructors) ||
          is_ns_member(c, services.imports.list_namespaces, "Nil") ||
          (c.type === "MemberExpression" && !c.computed && !c.optional &&
            c.property.type === "Identifier" &&
            (c.property.name === "Nil" || c.property.name === "empty") &&
            is_list_dict(c.object)))
      ) {
        return { kind: "empty" };
      }
      if (
        val.arguments.length === 1 &&
        c.type === "MemberExpression" && !c.computed && !c.optional &&
        c.property.type === "Identifier" && c.property.name === "pure" &&
        is_list_dict(c.object)
      ) {
        return { kind: "pure", value: val.arguments[0] as Expression };
      }
      if (
        val.arguments.length === 1 && val.typeArguments == null &&
        is_list_from_array_callee(c)
      ) {
        return {
          kind: "array",
          items: val.arguments[0] as Expression,
          needs_snapshot: true,
        };
      }
      if (
        val.arguments.length === 1 && is_list_dict(c)
      ) {
        return { kind: "list", expr: val };
      }
      if (
        val.arguments.length === 2 &&
        (is_imported_from_set(c, services.imports.cons_constructors) ||
          is_ns_member(c, services.imports.list_namespaces, "Cons") ||
          (c.type === "MemberExpression" && !c.computed && !c.optional &&
            c.property.type === "Identifier" && c.property.name === "Cons" &&
            is_list_dict(c.object)))
      ) {
        return { kind: "list", expr: val };
      }
    }
    if (require_known) return undefined;
    return { kind: "list", expr: val };
  }

  function list_to_array_do_fusion(
    outer: CallExpression,
  ): { expression: Expression; direct: boolean } | undefined {
    if (
      services.config.optimizations?.generator === false ||
      services.config.optimizations?.terminal_body === false ||
      outer.optional || outer.typeArguments != null ||
      outer.arguments.length !== 1 ||
      outer.arguments[0].type === "SpreadElement" ||
      !is_list_to_array_callee(parentheses(outer.callee))
    ) return undefined;

    const do_call = parentheses(outer.arguments[0] as Expression);
    if (
      do_call.type !== "CallExpression" || do_call.optional ||
      do_call.typeArguments != null ||
      do_call.arguments.some((a) => a.type === "SpreadElement") ||
      services.kind(do_call) !== "do" ||
      (do_call.arguments.length !== 1 && do_call.arguments.length !== 2)
    ) return undefined;

    const run_arg = do_call.arguments[do_call.arguments.length - 1];
    if (
      run_arg.type !== "FunctionExpression" || !valid_generator(run_arg) ||
      lexical_hazard(run_arg.body!)
    ) return undefined;

    const body = run_arg.body!;
    if (do_call.arguments.length === 2) {
      if (!is_list_dict(parentheses(do_call.arguments[0] as Expression))) {
        return undefined;
      }
    } else {
      let first_yield: Expression | undefined;
      walk(body, (child) => {
        if (first_yield !== undefined || function_like(child)) return false;
        if (
          child.type === "YieldExpression" && child.delegate &&
          child.argument !== null
        ) {
          first_yield = child.argument;
          return false;
        }
      });
      if (first_yield === undefined) return undefined;
      if (classify_list_source(first_yield, true) === undefined) {
        return undefined;
      }
      if (
        !reaches_unconditional_yield(body.body as Statement[]) ||
        !has_pure_prefix_before_yield(body.body as Statement[])
      ) return undefined;
    }

    // Ensure multi-shot soundness: no var/let, no mutations, no await.
    let unsafe = false;
    walk(body, (child) => {
      if (unsafe) return false;
      if (function_like(child)) return false;
      if (
        child.type === "AwaitExpression" ||
        child.type === "AssignmentExpression" ||
        child.type === "UpdateExpression" ||
        (child.type === "VariableDeclaration" && child.kind !== "const") ||
        (child.type === "UnaryExpression" && child.operator === "delete")
      ) {
        unsafe = true;
        return false;
      }
    });
    if (unsafe) return undefined;

    const out_id = services.fresh("list_out");
    let push_count = 0;

    function is_empty_return(stmt: Statement): boolean {
      const target = stmt.type === "BlockStatement" && stmt.body.length === 1
        ? stmt.body[0] as Statement
        : stmt;
      if (target.type !== "ReturnStatement" || target.argument === null) {
        return false;
      }
      const arg = parentheses(target.argument);
      if (!yield_star(arg)) return false;
      const cls = classify_list_source(arg.argument, true);
      return cls?.kind === "empty";
    }

    function ends_terminating(stmt: Statement): boolean {
      if (
        stmt.type === "ReturnStatement" || stmt.type === "ThrowStatement"
      ) return true;
      if (stmt.type === "BlockStatement" && stmt.body.length > 0) {
        return ends_terminating(stmt.body[stmt.body.length - 1] as Statement);
      }
      if (
        stmt.type === "IfStatement" && stmt.alternate !== null &&
        ends_terminating(stmt.consequent) && ends_terminating(stmt.alternate)
      ) return true;
      return false;
    }

    function stmts_pure_no_call(list: readonly Statement[]): boolean {
      for (const s of list) {
        if (!is_pure_no_call(s)) return false;
      }
      return true;
    }

    function wrap_source_loop(
      src_kind: ListSourceKind,
      binding: BindingPattern | undefined,
      cont_stmts: Statement[],
      cont_has_calls: boolean,
    ): Statement[] {
      if (src_kind.kind === "empty") return [];
      if (src_kind.kind === "pure") {
        if (binding === undefined) {
          return [
            node({ type: "ExpressionStatement", expression: src_kind.value }),
            ...cont_stmts,
          ];
        }
        return [variable(binding, src_kind.value, "const"), ...cont_stmts];
      }
      if (src_kind.kind === "array") {
        const src_id = services.fresh("list_src");
        const len_id = services.fresh("list_len");
        const idx_id = services.fresh("list_i");
        const unwrapped_items = parentheses(src_kind.items);
        const need_copy = src_kind.needs_snapshot &&
          unwrapped_items.type !== "ArrayExpression" && cont_has_calls;
        const elem: Expression = node({
          type: "MemberExpression",
          object: src_id,
          property: idx_id,
          computed: true,
          optional: false,
        });
        const loop_body: Statement[] = binding !== undefined
          ? [variable(binding, elem, "const"), ...cont_stmts]
          : cont_stmts;
        return [
          variable(
            src_id,
            need_copy
              ? call(member(src_kind.items, "slice"), [])
              : src_kind.items,
            "const",
          ),
          variable(len_id, member(src_id, "length"), "const"),
          node({
            type: "ForStatement",
            init: variable(idx_id, literal(0), "let"),
            test: node({
              type: "BinaryExpression",
              operator: "<",
              left: idx_id,
              right: len_id,
            }),
            update: node({
              type: "AssignmentExpression",
              operator: "+=",
              left: idx_id,
              right: literal(1),
            }),
            body: block(loop_body),
          }),
        ];
      }
      // Generic List expression: while (cur[0] === "Cons") { ... cur = cur[2]; }
      const cur_id = services.fresh("list_cur");
      const loop_body: Statement[] = [];
      if (binding !== undefined) {
        loop_body.push(
          variable(
            binding,
            node({
              type: "MemberExpression",
              object: cur_id,
              property: literal(1),
              computed: true,
              optional: false,
            }),
            "const",
          ),
        );
      }
      loop_body.push(
        ...cont_stmts,
        node({
          type: "ExpressionStatement",
          expression: node({
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
        }),
      );
      return [
        variable(cur_id, call(member(src_kind.expr, "value"), []), "let"),
        node({
          type: "WhileStatement",
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
          body: block(loop_body),
        }),
      ];
    }

    function compile_stmts(
      stmts: readonly Statement[],
      idx: number,
    ): Statement[] | undefined {
      if (idx >= stmts.length) return undefined;
      const stmt = stmts[idx];
      if (
        stmt.type === "EmptyStatement" ||
        (stmt.type === "ExpressionStatement" && "directive" in stmt &&
          stmt.directive != null)
      ) {
        return compile_stmts(stmts, idx + 1);
      }
      const rest = stmts.slice(idx + 1);
      const rest_has_yield = rest.some((s) => contains_yield(s));

      if (stmt.type === "VariableDeclaration") {
        if (stmt.declarations.length !== 1) return undefined;
        const decl = stmt.declarations[0];
        if (decl.init === null) return undefined;
        const init = parentheses(decl.init);
        if (yield_star(init)) {
          if (contains_await_yield(init.argument)) return undefined;
          const src_kind = classify_list_source(init.argument, false);
          if (src_kind === undefined) return undefined;
          const cont = compile_stmts(stmts, idx + 1);
          if (cont === undefined) return undefined;
          return wrap_source_loop(
            src_kind,
            decl.id,
            cont,
            !stmts_pure_no_call(rest),
          );
        }
        if (contains_await_yield(decl.init)) return undefined;
        if (rest_has_yield && !is_pure_no_call(decl.init)) return undefined;
        const cont = compile_stmts(stmts, idx + 1);
        if (cont === undefined) return undefined;
        return [stmt, ...cont];
      }

      if (stmt.type === "ExpressionStatement") {
        const expr = parentheses(stmt.expression);
        if (yield_star(expr)) {
          if (contains_await_yield(expr.argument)) return undefined;
          const src_kind = classify_list_source(expr.argument, false);
          if (src_kind === undefined) return undefined;
          const cont = compile_stmts(stmts, idx + 1);
          if (cont === undefined) return undefined;
          return wrap_source_loop(
            src_kind,
            undefined,
            cont,
            !stmts_pure_no_call(rest),
          );
        }
        if (contains_await_yield(stmt.expression)) return undefined;
        if (rest_has_yield && !is_pure_no_call(stmt.expression)) {
          return undefined;
        }
        const cont = compile_stmts(stmts, idx + 1);
        if (cont === undefined) return undefined;
        return [stmt, ...cont];
      }

      if (stmt.type === "IfStatement") {
        if (contains_await_yield(stmt.test)) return undefined;
        if (stmt.alternate === null && is_empty_return(stmt.consequent)) {
          const cont = compile_stmts(stmts, idx + 1);
          if (cont === undefined) return undefined;
          return [
            node({
              type: "IfStatement",
              test: negate_expr(stmt.test),
              consequent: block(cont),
              alternate: null,
            }),
          ];
        }
        if (stmt.alternate === null && ends_terminating(stmt.consequent)) {
          const cons_list = stmt.consequent.type === "BlockStatement"
            ? stmt.consequent.body as Statement[]
            : [stmt.consequent];
          const cons = compile_stmts(cons_list, 0);
          const alt = compile_stmts(stmts, idx + 1);
          if (cons === undefined || alt === undefined) return undefined;
          return [
            node({
              type: "IfStatement",
              test: stmt.test,
              consequent: block(cons),
              alternate: block(alt),
            }),
          ];
        }
        if (
          stmt.alternate !== null && idx === stmts.length - 1 &&
          ends_terminating(stmt.consequent) && ends_terminating(stmt.alternate)
        ) {
          const cons_list = stmt.consequent.type === "BlockStatement"
            ? stmt.consequent.body as Statement[]
            : [stmt.consequent];
          const alt_list = stmt.alternate.type === "BlockStatement"
            ? stmt.alternate.body as Statement[]
            : [stmt.alternate];
          const cons = compile_stmts(cons_list, 0);
          const alt = compile_stmts(alt_list, 0);
          if (cons === undefined || alt === undefined) return undefined;
          return [
            node({
              type: "IfStatement",
              test: stmt.test,
              consequent: block(cons),
              alternate: block(alt),
            }),
          ];
        }
        return undefined;
      }

      if (stmt.type === "ReturnStatement") {
        if (stmt.argument === null) return undefined;
        const arg = parentheses(stmt.argument);
        if (yield_star(arg)) {
          if (contains_await_yield(arg.argument)) return undefined;
          const src_kind = classify_list_source(arg.argument, false);
          if (src_kind === undefined) return undefined;
          if (src_kind.kind === "empty") return [];
          const val_id = services.fresh("list_v");
          push_count += 1;
          return wrap_source_loop(
            src_kind,
            val_id,
            [
              node({
                type: "ExpressionStatement",
                expression: call(member(out_id, "push"), [val_id]),
              }),
            ],
            false,
          );
        }
        if (contains_await_yield(stmt.argument)) return undefined;
        push_count += 1;
        return [
          node({
            type: "ExpressionStatement",
            expression: call(member(out_id, "push"), [stmt.argument]),
          }),
        ];
      }

      if (stmt.type === "ThrowStatement") {
        if (contains_await_yield(stmt.argument)) return undefined;
        return [stmt];
      }

      return undefined;
    }

    const compiled = compile_stmts(body.body as Statement[], 0);
    if (compiled === undefined || push_count === 0) return undefined;
    const final_stmts: Statement[] = [
      variable(
        out_id,
        node({ type: "ArrayExpression", elements: Array.from([]) }),
        "const",
      ),
      ...compiled,
      ret(out_id),
    ];
    return {
      expression: call(arrow([], block(final_stmts)), []),
      direct: true,
    };
  }

  const enable_task = flags?.task !== false;
  const enable_stm = flags?.stm !== false;
  const enable_chain = flags?.chain !== false;
  const enable_array = flags?.array !== false;
  const enable_traverse = flags?.traverse !== false;
  const enable_match = flags?.match !== false;

  return {
    lower_before(
      outer: CallExpression,
    ): { expression: Expression; direct: boolean } | undefined {
      if (enable_task) {
        const r = task_terminal_fusion(outer);
        if (r !== undefined) return r;
      }
      if (enable_stm) {
        const r = stm_do_fusion(outer);
        if (r !== undefined) return r;
      }
      if (enable_chain) {
        const r = maybe_either_chain_fusion(outer);
        if (r !== undefined) return r;
      }
      if (enable_array) {
        const ld = list_to_array_do_fusion(outer);
        if (ld !== undefined) return ld;
        const r = array_chain_fusion(outer);
        if (r !== undefined) return r;
      }
      return undefined;
    },
    lower_after(
      outer: CallExpression,
    ): { expression: Expression; direct: boolean } | undefined {
      if (enable_traverse) {
        const r = traverse_fusion(outer);
        if (r !== undefined) return r;
      }
      if (enable_match) {
        const r = match_fusion(outer);
        if (r !== undefined) return r;
      }
      return undefined;
    },
  };
}

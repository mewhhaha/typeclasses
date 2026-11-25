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

  function resolve_is_task_cancellation(
    anchor_local: string,
  ): IdentifierReference | undefined {
    const existing = services.imports.task_is_cancellation_functions?.values()
      .next().value;
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
    return expr.type === "Identifier" &&
      services.task_dictionaries.has(expr.name) &&
      services.bindings.imported(expr);
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

  function is_succeed_callee(expr: Expression): boolean {
    return is_imported_from_set(
      expr,
      services.imports.task_succeed_functions,
    ) ||
      is_ns_member(expr, services.imports.task_namespaces, "succeed") ||
      is_ns_member(expr, services.imports.namespaces, "succeed");
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

  /** Extract a zero-signal Task expression (doesn't observe AbortSignal). */
  function extract_no_signal_task_expr(
    raw: Expression,
    unwrap_parallel: boolean,
  ): Expression | undefined {
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
          return lexical_hazard(v) || contains_await_yield(v) ? undefined : v;
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
    if (kind === undefined || kind.kind === "arbitrary") return undefined;
    if (kind.kind === "pure") {
      return lexical_hazard(kind.value) || contains_await_yield(kind.value)
        ? undefined
        : kind.value;
    }
    const cb = unwrap(kind.fn);
    if (
      cb.type !== "ArrowFunctionExpression" || cb.generator ||
      cb.typeParameters != null || cb.returnType != null ||
      cb.params.length !== 0
    ) return undefined;
    if (lexical_hazard(cb) || contains_await_yield(cb.body)) return undefined;
    if (cb.body.type !== "BlockStatement") {
      return cb.body as Expression;
    }
    return call(cb, []);
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

  function parallel_task_fusion(
    raw_inner: Expression,
    exit_cancel_id: IdentifierReference | undefined,
  ): { expression: Expression; direct: boolean } | undefined {
    let inner = parentheses(raw_inner);
    if (
      inner.type === "CallExpression" && !inner.optional &&
      inner.typeArguments == null && inner.arguments.length === 1 &&
      inner.arguments[0].type !== "SpreadElement" &&
      is_sequential_fn(parentheses(inner.callee))
    ) {
      inner = parentheses(inner.arguments[0] as Expression);
    }
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
      const step_expr = extract_no_signal_task_expr(inlined_body, true);
      if (step_expr === undefined) return undefined;
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
      const iife_params: IdentifierReference[] = [];
      const iife_args: Expression[] = [];
      const body_stmts: Statement[] = [];
      if (pass_src_as_param) {
        iife_params.push(src_id);
        iife_args.push(trav_items);
      } else {
        body_stmts.push(variable(src_id, trav_items, "const"));
      }
      const sync_step = is_statically_non_thenable(step_expr);
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
          variable(p0_id, step_expr, "const"),
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
              variable(step_val_id, step_expr, "const"),
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
        params: iife_params,
        body: block(final_body),
        typeParameters: null,
        returnType: null,
      });
      return { expression: call(async_fn, iife_args), direct: true };
    }

    // 2. ParallelTask Applicative.lift(fn, parallel(t1), ...) or
    //    collect(ParallelTask, [t1, ...]) / collect([parallel(t1), ...]) /
    //    collect(ParallelTask, { a: t1, ... }) / collect({ a: parallel(t1), ... })
    let branch_exprs: Expression[] | undefined;
    let build_out: ((vals: readonly Expression[]) => Expression) | undefined;
    let hoist_fn:
      | { readonly id: IdentifierReference; readonly expr: Expression }
      | undefined;

    if (is_applicative_lift_fn(callee) && inner.arguments.length >= 2) {
      const fn_expr = inner.arguments[0] as Expression;
      if (lexical_hazard(fn_expr) || contains_await_yield(fn_expr)) {
        return undefined;
      }
      const raw_items = inner.arguments.slice(1) as Expression[];
      const extracted: Expression[] = [];
      for (const item of raw_items) {
        const ex = extract_no_signal_task_expr(item, true);
        if (ex === undefined) return undefined;
        extracted.push(ex);
      }
      branch_exprs = extracted;
      const fn_unwrapped = parentheses(fn_expr);
      if (
        fn_unwrapped.type === "ArrowFunctionExpression" &&
        !fn_unwrapped.async && !fn_unwrapped.generator &&
        fn_unwrapped.typeParameters == null &&
        fn_unwrapped.returnType == null &&
        fn_unwrapped.body.type !== "BlockStatement" &&
        fn_unwrapped.params.length === extracted.length &&
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
          build_out = (vals) => {
            let result = fn_unwrapped.body as Expression;
            for (let k = 0; k < vals.length; k += 1) {
              result = substitute_ident(result, decls[k], vals[k], services);
            }
            return result;
          };
        }
      }
      if (build_out === undefined) {
        if (
          (fn_unwrapped.type === "ArrowFunctionExpression" ||
            fn_unwrapped.type === "FunctionExpression") &&
          fn_unwrapped.params.some((p) =>
            p.type !== "TSParameterProperty" && p.typeAnnotation == null
          )
        ) return undefined;
        const fn_id = services.fresh("pt_fn");
        hoist_fn = { id: fn_id, expr: fn_expr };
        build_out = (vals) => call(fn_id, [...vals]);
      }
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
        const extracted: Expression[] = [];
        for (const el of shape_arg.elements) {
          const ex = extract_no_signal_task_expr(el as Expression, true);
          if (ex === undefined) return undefined;
          extracted.push(ex);
        }
        branch_exprs = extracted;
        build_out = (vals) =>
          as_const(node({ type: "ArrayExpression", elements: [...vals] }));
      } else if (shape_arg.type === "ObjectExpression") {
        if (shape_arg.properties.length === 0 && !explicit_pt) return undefined;
        const entries: {
          readonly key: string;
          readonly is_ident: boolean;
        }[] = [];
        const extracted: Expression[] = [];
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
          const ex = extract_no_signal_task_expr(
            prop.value as Expression,
            true,
          );
          if (ex === undefined) return undefined;
          entries.push({ key, is_ident });
          extracted.push(ex);
        }
        branch_exprs = extracted;
        build_out = (vals) =>
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
          });
      }
    }

    if (branch_exprs === undefined || build_out === undefined) return undefined;
    const body_stmts: Statement[] = [];
    const iife_params: IdentifierReference[] = [];
    const iife_args: Expression[] = [];
    if (hoist_fn !== undefined) {
      if (exit_cancel_id !== undefined && !is_pure_no_call(hoist_fn.expr)) {
        iife_params.push(hoist_fn.id);
        iife_args.push(hoist_fn.expr);
      } else {
        body_stmts.push(variable(hoist_fn.id, hoist_fn.expr, "const"));
      }
    }
    if (branch_exprs.length === 0) {
      body_stmts.push(ret(build_out([])));
    } else {
      const raw_ids: IdentifierReference[] = [];
      const maybe_async_indices: number[] = [];
      for (let i = 0; i < branch_exprs.length; i += 1) {
        const r_id = services.fresh("pt_r");
        body_stmts.push(variable(r_id, branch_exprs[i], "const"));
        raw_ids.push(r_id);
        if (!is_statically_non_thenable(branch_exprs[i])) {
          maybe_async_indices.push(i);
        }
      }
      if (maybe_async_indices.length === 0) {
        body_stmts.push(ret(build_out(raw_ids)));
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
        async_branch.push(ret(build_out(async_vals)));
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
        body_stmts.push(ret(build_out(sync_vals)));
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
      params: iife_params,
      body: block(final_body),
      typeParameters: null,
      returnType: null,
    });
    return { expression: call(async_fn, iife_args), direct: true };
  }

  function is_effect_method(expr: Expression, prop: string): boolean {
    return expr.type === "MemberExpression" && !expr.computed &&
      !expr.optional && expr.property.type === "Identifier" &&
      expr.property.name === prop &&
      (is_imported_from_set(expr.object, services.imports.effect_names) ||
        is_ns_member(expr.object, services.imports.namespaces, "Effect"));
  }

  type TaskYieldKind =
    | { readonly kind: "pure"; readonly value: Expression }
    | { readonly kind: "from_fn"; readonly fn: Expression }
    | { readonly kind: "task_ctor"; readonly fn: Expression }
    | { readonly kind: "arbitrary"; readonly expr: Expression };

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
    if (
      val.type === "CallExpression" && !val.optional &&
      val.typeArguments == null && val.arguments.length === 1 &&
      val.arguments[0].type !== "SpreadElement"
    ) {
      const arg = val.arguments[0] as Expression;
      if (
        is_succeed_callee(val.callee) ||
        (val.callee.type === "MemberExpression" && !val.callee.computed &&
          !val.callee.optional && val.callee.property.type === "Identifier" &&
          val.callee.property.name === "pure" &&
          is_task_dict(val.callee.object))
      ) {
        return { kind: "pure", value: arg };
      }
      if (is_from_fn_callee(val.callee)) {
        return { kind: "from_fn", fn: arg };
      }
      if (is_task_dict(val.callee)) {
        return { kind: "task_ctor", fn: arg };
      }
    }
    if (program_mode) return undefined;
    return { kind: "arbitrary", expr: val };
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
    // constructors (`from_fn`, `Task`) or pure `succeed`/`Task.pure` so no side-effects
    // in fn(item) are reordered relative to task execution.
    if (!is_sequential) {
      if (
        classified === undefined ||
        classified.kind === "arbitrary" ||
        (classified.kind === "pure" && !is_pure_no_call(classified.value))
      ) return undefined;
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
            val_expr = node({
              type: "AwaitExpression",
              argument: call(call(member(classified.expr, "value"), []), []),
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
        if (signal_expr === undefined) {
          const par = parallel_task_fusion(inner, exit_cancel_id);
          if (par !== undefined) return par;
          const trav = task_traverse_fusion(inner, exit_cancel_id);
          if (trav !== undefined) return trav;
        }
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
            if (first_yield !== undefined) {
              const cls = classify_task_yield(first_yield, false);
              if (cls !== undefined && cls.kind !== "arbitrary") {
                gen_call = inner;
              }
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
        recv.typeArguments == null && services.kind(recv) === "do"
      ) {
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
            if (first_yield !== undefined) {
              const cls = classify_task_yield(first_yield, false);
              if (cls !== undefined && cls.kind !== "arbitrary") {
                gen_call = recv;
              }
            }
          }
        }
      }
    }

    if (gen_call === undefined) return undefined;
    const run_arg = gen_call.arguments[gen_call.arguments.length - 1];
    if (
      run_arg === undefined || run_arg.type !== "FunctionExpression" ||
      !valid_generator(run_arg) || lexical_hazard(run_arg.body!)
    ) return undefined;

    const body = run_arg.body!;
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

    let sig_id: IdentifierReference | undefined;
    let check_sig_id: IdentifierReference | undefined;
    let await_sig_id: IdentifierReference | undefined;
    if (signal_expr !== undefined) {
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

    function emit_yield_expr(
      raw_arg: Expression,
      target_stmts: Statement[],
    ): Expression {
      const lowered_arg = lower_expr(raw_arg, target_stmts);
      const classified = classify_task_yield(lowered_arg, program_mode)!;
      switch (classified.kind) {
        case "pure":
          emit_sig_check(target_stmts, "run_task");
          return classified.value;
        case "from_fn": {
          emit_sig_check(target_stmts, "Task.from_fn");
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
                target_stmts.push(variable(raw_id, inner, "const"));
                emit_sig_check(target_stmts, "Task.from_fn");
                return raw_id;
              }
              return inner;
            }
            if (!cb.async) {
              const raw_id = services.fresh("task_raw");
              target_stmts.push(variable(raw_id, inner, "const"));
              if (sig_id !== undefined && await_sig_id !== undefined) {
                return node({
                  type: "AwaitExpression",
                  argument: call(await_sig_id, [
                    raw_id,
                    sig_id,
                    literal("Task.from_fn"),
                  ]),
                });
              }
              return await_if_thenable_expr(raw_id);
            }
            if (sig_id !== undefined && await_sig_id !== undefined) {
              return node({
                type: "AwaitExpression",
                argument: call(await_sig_id, [
                  inner,
                  sig_id,
                  literal("Task.from_fn"),
                ]),
              });
            }
            return node({ type: "AwaitExpression", argument: inner });
          }
          if (
            cb.type === "ArrowFunctionExpression" && !cb.generator &&
            cb.params.length === 0
          ) {
            const invoke = call(cb, []);
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
          const invoke = call(classified.fn, [sig_id ?? void_zero()]);
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
        case "task_ctor": {
          emit_sig_check(target_stmts, "run_task");
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
          const invoke = call(classified.fn, [sig_id ?? void_zero()]);
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
        case "arbitrary":
          emit_sig_check(target_stmts, "run_task");
          return node({
            type: "AwaitExpression",
            argument: call(
              call(member(classified.expr, "value"), []),
              sig_id !== undefined ? [sig_id] : [],
            ),
          });
      }
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
          const declarations = stmt.declarations.map((decl) =>
            decl.init !== null && contains_yield(decl.init)
              ? { ...decl, init: lower_expr(decl.init, stmts) }
              : decl
          );
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
    if (sig_id !== undefined && signal_expr !== undefined) {
      if (exit_cancel_id !== undefined && !is_pure_no_call(signal_expr)) {
        iife_params.push(sig_id);
        iife_args.push(signal_expr);
      } else {
        emitted.push(variable(sig_id, signal_expr, "const"));
      }
      emit_sig_check(emitted, "run_task");
    }
    emitted.push(...lower_list(body.body as Statement[]));
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
  };

  function match_traverse_dict(expr: Expression): TraverseDict | undefined {
    const val = parentheses(expr);
    if (
      val.type === "CallExpression" && !val.optional &&
      val.arguments.length === 0 &&
      val.callee.type === "MemberExpression" && !val.callee.computed &&
      !val.callee.optional && val.callee.object.type === "Identifier" &&
      val.callee.property.type === "Identifier" &&
      val.callee.property.name === "with_error" &&
      services.imports.direct_validation_dictionaries?.has(
        val.callee.object.name,
      ) && services.bindings.imported(val.callee.object)
    ) {
      return { mode: "validation", dict_id: val.callee.object };
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
    | { readonly array_ctor: IdentifierReference; readonly items: Expression }
    | undefined {
    const val = parentheses(expr);
    if (
      val.type !== "CallExpression" || val.optional ||
      val.typeArguments != null || val.arguments.length !== 1 ||
      val.arguments[0].type === "SpreadElement" ||
      val.callee.type !== "Identifier" ||
      !services.imports.array_constructors?.has(val.callee.name) ||
      !services.bindings.imported(val.callee)
    ) return undefined;
    return { array_ctor: val.callee, items: val.arguments[0] as Expression };
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
    let array_ctor: IdentifierReference | undefined;
    let dict: TraverseDict | undefined;
    let fn_expr: Expression | undefined;
    let is_sequential = false;

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
        array_ctor = arr.array_ctor;
        fn_expr = outer.arguments[2] as Expression;
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
        array_ctor = arr.array_ctor;
        fn_expr = outer.arguments[1] as Expression;
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
      items_expr === undefined || dict === undefined || fn_expr === undefined
    ) return undefined;
    if (
      lexical_hazard(items_expr) || contains_await_yield(items_expr) ||
      lexical_hazard(fn_expr) || contains_await_yield(fn_expr)
    ) return undefined;

    const mode = dict.mode;
    const dict_id = dict.dict_id;
    const src_id = services.fresh("trav_src");
    const out_id = services.fresh("trav_out");
    const idx_id = services.fresh("trav_i");
    const item_id = services.fresh("trav_x");

    const fn_unwrapped = unwrap(fn_expr);
    let inlined_body: Expression | undefined;
    let elided: ElidedBranch | undefined;
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
        elided = match_elided_body(inlined_body, mode);
      }
    }

    const wrap_collection = (arr_expr: Expression): Expression =>
      array_ctor !== undefined ? call(array_ctor, [arr_expr]) : arr_expr;

    const wrap_ok = (val_expr: Expression): Expression => {
      if (mode === "maybe") {
        const just_name = services.imports.just_constructors?.values().next()
          .value;
        return just_name !== undefined
          ? call(id(just_name), [val_expr])
          : call(member(dict_id, "pure"), [val_expr]);
      }
      if (mode === "identity") {
        const id_name = services.imports.identity_constructors?.values().next()
          .value;
        return id_name !== undefined
          ? call(id(id_name), [val_expr])
          : call(dict_id, [val_expr]);
      }
      if (mode === "validation") {
        const valid_name = services.imports.valid_constructors?.values().next()
          .value;
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
      const nothing_name = services.imports.nothing_constructors?.values()
        .next().value;
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
      fn_expr = annotated_fn;
    }

    const call_step = (): Expression =>
      inlined_body !== undefined ? inlined_body : call(fn_id!, [item_id]);

    if (mode === "identity") {
      const pre = fn_id !== undefined
        ? [variable(fn_id, fn_expr, "const")]
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
          ? [variable(fn_id, fn_expr, "const")]
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
      if (fn_id !== undefined) setup.push(variable(fn_id, fn_expr, "const"));
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
        ? [variable(fn_id, fn_expr, "const")]
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
    const cur_id = services.fresh("trav_raw");
    const errs_id = services.fresh("trav_errs");
    const errs_empty = node({
      type: "BinaryExpression",
      operator: "===",
      left: member(errs_id, "length"),
      right: literal(0),
    });
    const setup: Statement[] = [variable(src_id, items_expr, "const")];
    if (fn_id !== undefined) setup.push(variable(fn_id, fn_expr, "const"));
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
          services.imports.direct_maybe_dictionaries?.has(c.name)
        ) return "maybe";
        if (
          services.imports.left_constructors?.has(c.name) ||
          services.imports.right_constructors?.has(c.name) ||
          services.imports.direct_either_dictionaries?.has(c.name)
        ) return "either";
        if (services.imports.validation_constructors?.has(c.name)) {
          return "validation";
        }
        if (
          services.imports.list_constructors?.has(c.name) ||
          services.imports.nil_constructors?.has(c.name) ||
          services.imports.cons_constructors?.has(c.name)
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
        const sub_unwrapped = parentheses(subject);
        if (sub_unwrapped.type === "ArrayExpression") {
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
      readonly params: readonly BindingIdentifier[];
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

      const params: BindingIdentifier[] = [];
      for (const param of fn.params) {
        if (
          param.type !== "Identifier" || param.optional ||
          (param.decorators !== undefined && param.decorators.length > 0)
        ) return undefined;
        params.push(param);
      }

      if (
        fn.type === "ArrowFunctionExpression" &&
        fn.body.type !== "BlockStatement"
      ) {
        cases.push({ tag, params, expr_body: fn.body as Expression });
      } else {
        cases.push({ tag, params, block_body: fn.body as BlockStatement });
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
      cases[0].expr_body !== undefined &&
      cases[1].expr_body !== undefined &&
      is_known_pair(cases[0].tag, cases[1].tag)
    ) {
      const inline_case_expr = (c: MatchCase): Expression | undefined => {
        let result = c.expr_body!;
        for (let i = 0; i < c.params.length; i += 1) {
          const decl = services.bindings.resolve(c.params[i]);
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
        case_stmts.push(
          variable(id(c.params[i].name), payload_access(i), "const"),
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

  function extract_unary_arrow(
    expr: Expression,
  ):
    | {
      readonly param_decl: Node | null;
      readonly body: Expression;
    }
    | undefined {
    const fn = unwrap(expr);
    if (
      fn.type !== "ArrowFunctionExpression" || fn.async || fn.generator ||
      fn.typeParameters != null || fn.returnType != null ||
      fn.body.type === "BlockStatement" ||
      lexical_hazard(fn) || contains_await_yield(fn.body) ||
      contains_generator_or_do(fn.body)
    ) return undefined;
    if (fn.params.length === 0) {
      return { param_decl: null, body: fn.body as Expression };
    }
    if (fn.params.length !== 1) return undefined;
    const p0 = fn.params[0];
    if (
      p0.type !== "Identifier" || p0.optional || p0.typeAnnotation != null ||
      (p0.decorators !== undefined && p0.decorators.length > 0)
    ) return undefined;
    const decl = services.bindings.resolve(p0);
    if (decl === null) return undefined;
    return { param_decl: decl, body: fn.body as Expression };
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
      fn.body.type === "BlockStatement" ||
      fn.params.length > 2 ||
      lexical_hazard(fn) || contains_await_yield(fn.body) ||
      contains_generator_or_do(fn.body)
    ) return undefined;
    let first_decl: Node | null = null;
    let second_decl: Node | null = null;
    for (let i = 0; i < fn.params.length; i += 1) {
      const p = fn.params[i];
      if (
        p.type !== "Identifier" || p.optional || p.typeAnnotation != null ||
        (p.decorators !== undefined && p.decorators.length > 0)
      ) return undefined;
      const decl = services.bindings.resolve(p);
      if (decl === null) return undefined;
      if (i === 0) first_decl = decl;
      else second_decl = decl;
    }
    return { first_decl, second_decl, body: fn.body as Expression };
  }

  // =========================================================================
  // P7: Fluent Maybe & Either chain fusion (.map/.bind + match/from_maybe/to_nullable)
  // =========================================================================
  type ChainMode = "maybe" | "either";
  type ChainRoot =
    | {
      readonly kind: "just";
      readonly value: Expression;
      readonly value_type?: TSType;
    }
    | {
      readonly kind: "right";
      readonly value: Expression;
      readonly value_type?: TSType;
    }
    | {
      readonly kind: "from_nullable";
      readonly value: Expression;
    }
    | { readonly kind: "wrapped"; readonly expr: Expression };
  type ChainStage = {
    readonly kind: "map" | "bind" | "filter";
    readonly param_decl: Node | null;
    readonly body: Expression;
  };
  type ChainTerminal =
    | { readonly kind: "wrap" }
    | { readonly kind: "from_maybe"; readonly fallback: Expression }
    | { readonly kind: "get_or_else"; readonly fallback_fn: Expression }
    | {
      readonly kind: "maybe_fold";
      readonly fallback: Expression;
      readonly ok_decl: Node | null;
      readonly ok_body: Expression;
    }
    | { readonly kind: "to_nullable" }
    | { readonly kind: "from_right"; readonly fallback: Expression }
    | { readonly kind: "from_left"; readonly fallback: Expression }
    | {
      readonly kind: "recover_or_else";
      readonly err_decl: Node | null;
      readonly err_body: Expression;
    }
    | {
      readonly kind: "match";
      readonly ok_decl: Node | null;
      readonly ok_body: Expression;
      readonly err_decl: Node | null;
      readonly err_body: Expression;
    };

  function match_chain_root(
    expr: Expression,
    expected?: ChainMode,
  ): { readonly mode: ChainMode; readonly root: ChainRoot } | undefined {
    const val = parentheses(expr);
    if (
      lexical_hazard(val) || contains_await_yield(val) ||
      contains_generator_or_do(val)
    ) return undefined;
    if (
      val.type === "CallExpression" && !val.optional &&
      val.arguments.length === 1 &&
      val.arguments[0].type !== "SpreadElement"
    ) {
      const arg = val.arguments[0] as Expression;
      const callee = parentheses(val.callee);
      if (
        val.typeArguments == null &&
        expected !== "either" &&
        is_imported_from_set(callee, services.imports.from_nullable_functions)
      ) {
        return { mode: "maybe", root: { kind: "from_nullable", value: arg } };
      }
      if (expected !== "either") {
        const mc = match_ctor_call(val, "maybe");
        if (mc !== undefined && mc.ok && mc.arg !== undefined) {
          return {
            mode: "maybe",
            root: { kind: "just", value: mc.arg, value_type: mc.ok_type },
          };
        }
      }
      if (expected !== "maybe") {
        const ec = match_ctor_call(val, "either");
        if (ec !== undefined && ec.ok && ec.arg !== undefined) {
          return {
            mode: "either",
            root: { kind: "right", value: ec.arg, value_type: ec.ok_type },
          };
        }
      }
    }
    const kind = expr_wrapped_tagged_kind(val);
    if (kind === "maybe" && expected !== "either") {
      return { mode: "maybe", root: { kind: "wrapped", expr: val } };
    }
    if (kind === "either" && expected !== "maybe") {
      return { mode: "either", root: { kind: "wrapped", expr: val } };
    }
    return undefined;
  }

  function parse_match_pair(
    cases_expr: Expression,
    mode: ChainMode,
  ):
    | {
      readonly ok_decl: Node | null;
      readonly ok_body: Expression;
      readonly err_decl: Node | null;
      readonly err_body: Expression;
    }
    | undefined {
    const obj = parentheses(cases_expr);
    if (obj.type !== "ObjectExpression" || obj.properties.length !== 2) {
      return undefined;
    }
    const ok_tag = mode === "maybe" ? "Just" : "Right";
    const err_tag = mode === "maybe" ? "Nothing" : "Left";
    let ok_arrow: { param_decl: Node | null; body: Expression } | undefined;
    let err_arrow: { param_decl: Node | null; body: Expression } | undefined;
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
    return {
      ok_decl: ok_arrow.param_decl,
      ok_body: ok_arrow.body,
      err_decl: err_arrow.param_decl,
      err_body: err_arrow.body,
    };
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
      terminal = {
        kind: "maybe_fold",
        fallback: fb,
        ok_decl: ok_arrow.param_decl,
        ok_body: ok_arrow.body,
      };
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
      terminal = {
        kind: "match",
        ok_decl: ok_arrow.param_decl,
        ok_body: ok_arrow.body,
        err_decl: err_arrow.param_decl,
        err_body: err_arrow.body,
      };
      expected_mode = "either";
      cursor = outer.arguments[2] as Expression;
    } else if (
      outer.arguments.length === 2 &&
      is_imported_from_set(callee, services.imports.either_recover_functions)
    ) {
      const err_arrow = extract_unary_arrow(outer.arguments[1] as Expression);
      if (err_arrow === undefined) return undefined;
      terminal = {
        kind: "recover_or_else",
        err_decl: err_arrow.param_decl,
        err_body: err_arrow.body,
      };
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
      outer.arguments.length === 2 &&
      (is_imported_from_set(callee, services.imports.match_functions) ||
        is_ns_member(callee, services.imports.match_namespaces, "match"))
    ) {
      cursor = outer.arguments[0] as Expression;
      match_cases_expr = outer.arguments[1] as Expression;
    } else if (
      outer.arguments.length === 1 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier"
    ) {
      const mname = callee.property.name;
      if (mname === "match") {
        cursor = callee.object;
        match_cases_expr = outer.arguments[0] as Expression;
      } else if (mname === "map" || mname === "bind") {
        cursor = outer;
        terminal = { kind: "wrap" };
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    // Peel .map(...), .bind(...), and maybe filter(prev, pred) stages from outermost inward
    const stages_rev: ChainStage[] = [];
    while (true) {
      const cur = parentheses(cursor!);
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
        if (parsed === undefined) return undefined;
        stages_rev.push({
          kind: cur.callee.property.name,
          param_decl: parsed.param_decl,
          body: parsed.body,
        });
        cursor = cur.callee.object;
        continue;
      }
      if (
        expected_mode !== "either" &&
        cur.type === "CallExpression" && !cur.optional &&
        cur.typeArguments == null && cur.arguments.length === 2 &&
        cur.arguments[0].type !== "SpreadElement" &&
        cur.arguments[1].type !== "SpreadElement" &&
        is_imported_from_set(
          parentheses(cur.callee),
          services.imports.maybe_filter_functions,
        )
      ) {
        const parsed = extract_unary_arrow(cur.arguments[1] as Expression);
        if (parsed === undefined) return undefined;
        stages_rev.push({
          kind: "filter",
          param_decl: parsed.param_decl,
          body: parsed.body,
        });
        expected_mode = "maybe";
        cursor = cur.arguments[0] as Expression;
        continue;
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

    const root_info = match_chain_root(cursor!, expected_mode);
    if (root_info === undefined) return undefined;
    const mode = root_info.mode;
    const root = root_info.root;

    if (match_cases_expr !== undefined) {
      const pair = parse_match_pair(match_cases_expr, mode);
      if (pair === undefined) return undefined;
      terminal = { kind: "match", ...pair };
    }
    if (terminal === undefined) return undefined;

    // Resolve constructor identifiers if wrapping final result.
    let maybe_just_expr: ((v: Expression) => Expression) | undefined;
    let maybe_nothing_expr: (() => Expression) | undefined;
    let either_dict_id: IdentifierReference | undefined;

    if (terminal.kind === "wrap") {
      if (mode === "maybe") {
        const jn = services.imports.just_constructors?.values().next().value;
        const nn = services.imports.nothing_constructors?.values().next().value;
        const md = services.imports.direct_maybe_dictionaries?.values().next()
          .value;
        if (jn !== undefined) maybe_just_expr = (v) => call(id(jn), [v]);
        else if (md !== undefined) {
          maybe_just_expr = (v) => call(member(id(md), "pure"), [v]);
        } else return undefined;
        if (nn !== undefined) maybe_nothing_expr = () => call(id(nn), []);
        else if (md !== undefined) {
          maybe_nothing_expr = () => call(member(id(md), "empty"), []);
        } else return undefined;
      } else {
        const ed = services.imports.direct_either_dictionaries?.values().next()
          .value;
        if (ed === undefined) return undefined;
        either_dict_id = id(ed);
      }
    }

    const stages = stages_rev.reverse();
    const stmts: Statement[] = [];
    let fb_id: IdentifierReference | undefined;
    if (
      terminal.kind === "from_maybe" || terminal.kind === "maybe_fold" ||
      terminal.kind === "from_right" || terminal.kind === "from_left"
    ) {
      fb_id = services.fresh("ch_fb");
      stmts.push(variable(fb_id, terminal.fallback, "const"));
    }

    const fail_return = (err_expr?: Expression): Statement => {
      if (
        terminal!.kind === "from_maybe" || terminal!.kind === "maybe_fold" ||
        terminal!.kind === "from_right"
      ) return ret(fb_id!);
      if (terminal!.kind === "from_left") return ret(err_expr!);
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
        const body = terminal!.err_decl !== null && err_expr !== undefined
          ? substitute_ident(
            terminal!.err_body,
            terminal!.err_decl,
            err_expr,
            services,
          )
          : terminal!.err_body;
        return ret(body);
      }
      if (mode === "maybe") {
        return ret(
          node({
            type: "TSAsExpression",
            expression: maybe_nothing_expr!(),
            typeAnnotation: node({ type: "TSNeverKeyword" }),
          }),
        );
      }
      return ret(
        as_const(
          node({
            type: "ArrayExpression",
            elements: [literal("Left"), err_expr!],
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
        terminal!.kind === "match" || terminal!.kind === "from_right" ||
        terminal!.kind === "from_left" || terminal!.kind === "recover_or_else"
      ) return fail_return(payload);
      return ret(raw_id);
    };

    let current_var = services.fresh("ch_v");
    switch (root.kind) {
      case "just":
      case "right":
        stmts.push(variable(current_var, root.value, "const", root.value_type));
        break;
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
      case "wrapped": {
        const raw_id = services.fresh("ch_raw");
        const fail_tag = mode === "maybe" ? "Nothing" : "Left";
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
              : fail_return_raw_left(raw_id),
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

    for (const stage of stages) {
      const inlined = stage.param_decl !== null
        ? substitute_ident(stage.body, stage.param_decl, current_var, services)
        : stage.body;
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
      const ok_res = terminal.ok_decl !== null
        ? substitute_ident(
          terminal.ok_body,
          terminal.ok_decl,
          current_var,
          services,
        )
        : terminal.ok_body;
      stmts.push(ret(ok_res));
      return { expression: call(arrow([], block(stmts)), []), direct: true };
    }
    if (mode === "maybe") {
      stmts.push(ret(maybe_just_expr!(current_var)));
      return { expression: call(arrow([], block(stmts)), []), direct: true };
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
      readonly items: Expression;
      readonly is_view?: boolean;
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
        return { kind: "array", array_ctor: callee, items };
      }
      if (
        services.imports.array_view_functions?.has(name) ||
        services.imports.array_from_array_functions?.has(name)
      ) {
        const ctor_name = services.imports.array_constructors?.values().next()
          .value;
        return {
          kind: "array",
          array_ctor: ctor_name !== undefined ? id(ctor_name) : undefined,
          items,
          is_view: services.imports.array_view_functions?.has(name),
        };
      }
      if (services.imports.typed_array_constructors?.has(name)) {
        return { kind: "typed_array", items };
      }
      if (services.imports.set_constructors?.has(name)) {
        return { kind: "set", items };
      }
      if (services.imports.map_constructors?.has(name)) {
        return {
          kind: "map",
          items,
          is_view: name === "from_map_view",
        };
      }
      if (services.imports.record_constructors?.has(name)) {
        return {
          kind: "record",
          items,
          is_view: name === "from_record_view",
        };
      }
    } else if (
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.object.type === "Identifier" &&
      callee.property.type === "Identifier" &&
      services.bindings.imported(callee.object) &&
      services.imports.array_namespaces?.has(callee.object.name) &&
      (callee.property.name === "ArrayT" ||
        callee.property.name === "from_array" ||
        callee.property.name === "from_array_view")
    ) {
      const ctor_name = services.imports.array_constructors?.values().next()
        .value;
      return {
        kind: "array",
        array_ctor: ctor_name !== undefined ? id(ctor_name) : undefined,
        items,
        is_view: callee.property.name === "from_array_view",
      };
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
    type ArrTerm =
      | { readonly kind: "wrap" }
      | { readonly kind: "raw_array" }
      | {
        readonly kind: "fold";
        readonly init: Expression;
        readonly step: Expression;
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
      is_imported_from_set(callee, services.imports.array_to_array_functions)
    ) {
      cursor = outer.arguments[0] as Expression;
      term = { kind: "raw_array" };
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
      } else if (mname === "map" && outer.arguments.length === 1) {
        cursor = outer;
        term = { kind: "wrap" };
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    // Peel .map(...) stages
    const stages_rev: {
      readonly param_decl: Node | null;
      readonly body: Expression;
    }[] = [];
    while (true) {
      const cur = parentheses(cursor!);
      if (
        cur.type === "CallExpression" && !cur.optional &&
        cur.typeArguments == null && cur.arguments.length === 1 &&
        cur.arguments[0].type !== "SpreadElement" &&
        cur.callee.type === "MemberExpression" && !cur.callee.computed &&
        !cur.callee.optional && cur.callee.property.type === "Identifier" &&
        cur.callee.property.name === "map"
      ) {
        const parsed = extract_unary_arrow(cur.arguments[0] as Expression);
        if (parsed === undefined) return undefined;
        stages_rev.push(parsed);
        cursor = cur.callee.object;
        continue;
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
    if (root.kind !== "array") {
      // Non-ArrayT collections only fuse direct 0-stage Foldable terminals
      // (wrap/raw_array/map have collection-specific semantics like dedup or width clamping).
      if (
        stages_rev.length > 0 || resolved_term.kind === "wrap" ||
        resolved_term.kind === "raw_array"
      ) return undefined;
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

    const emit_stages = (
      stmts: Statement[],
      seed_expr: Expression,
    ): Expression => {
      let cur_expr = seed_expr;
      for (const st of stages) {
        const v_id = services.fresh("arr_v");
        stmts.push(variable(v_id, cur_expr, "const"));
        cur_expr = st.param_decl !== null
          ? substitute_ident(st.body, st.param_decl, v_id, services)
          : st.body;
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
      return node({
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
      const body_stmts: Statement[] = [
        variable(src_id, root.items, "const"),
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

    // Case 2: Zero-array fold / fold_while / some / find
    const needs_len = root.kind === "array" || root.kind === "typed_array";

    if (resolved_term.kind === "some" || resolved_term.kind === "find") {
      const pred_arrow = extract_unary_arrow(resolved_term.pred);
      let pred_fn_id: IdentifierReference | undefined;
      if (pred_arrow === undefined) {
        if (!is_safe_callable_ref(resolved_term.pred)) return undefined;
        if (
          root.kind !== "array" && !root.is_view &&
          !is_fresh_collection_expr(root.items)
        ) return undefined;
        pred_fn_id = services.fresh("arr_pred");
      } else if (
        root.kind !== "array" && !root.is_view &&
        !is_fresh_collection_expr(root.items) &&
        !is_pure_no_call(pred_arrow.body)
      ) {
        return undefined;
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
        : pred_arrow!.param_decl !== null
        ? substitute_ident(
          pred_arrow!.body,
          pred_arrow!.param_decl,
          item_var,
          services,
        )
        : pred_arrow!.body;
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
      const stmts: Statement[] = [variable(src_id, root.items, "const")];
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
    if (step_arrow === undefined) {
      if (!is_safe_callable_ref(resolved_term.step)) return undefined;
      if (
        root.kind !== "array" && !root.is_view &&
        !is_fresh_collection_expr(root.items)
      ) return undefined;
      step_fn_id = services.fresh("arr_step_fn");
    } else if (
      root.kind !== "array" && !root.is_view &&
      !is_fresh_collection_expr(root.items) &&
      !is_pure_no_call(step_arrow.body)
    ) {
      return undefined;
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

    const stmts: Statement[] = [variable(src_id, root.items, "const")];
    if (needs_len) {
      stmts.push(variable(len_id, member(src_id, "length"), "const"));
    }
    stmts.push(variable(acc_id, resolved_term.init, "let"));
    if (step_fn_id !== undefined) {
      stmts.push(variable(step_fn_id, resolved_term.step, "const"));
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
    const import_stm_helper = (
      helper_name: string,
      fallback_anchor?: string,
    ): IdentifierReference | undefined => {
      const anchor = stm_anchor ?? fallback_anchor;
      if (anchor === undefined) return undefined;
      return services.import_from_module?.(anchor, "stm", helper_name);
    };

    function emit_stm_yield(
      raw_arg: Expression,
      target_stmts: Statement[],
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
          const lowered = lower_stm_expr(stmt.expression, stmts);
          stmts.push({ ...stmt, expression: lowered });
          return stmts;
        }
        case "ReturnStatement": {
          if (stmt.argument === null || !contains_yield(stmt.argument)) {
            return [stmt];
          }
          const stmts: Statement[] = [];
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

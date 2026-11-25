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
export function create_round5_fusions(services: TransformServices) {
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

  function is_task_dict(expr: Expression): boolean {
    return expr.type === "Identifier" &&
      services.task_dictionaries.has(expr.name) &&
      services.bindings.imported(expr);
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
  // P1: Direct async lowering for immediate Task runs:
  //   run_task(Do(Task, function* () { ... }))
  //   Do(Task, function* () { ... }).run()
  //   run_task(Program(function* () { ... })) (known Task lifts/primitives)
  // =========================================================================
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
    const callee = parentheses(outer.callee);
    if (outer.arguments.length === 1 && is_run_task_callee(callee)) {
      const inner = parentheses(outer.arguments[0] as Expression);
      if (
        inner.type === "CallExpression" && !inner.optional &&
        inner.typeArguments == null
      ) {
        const k = services.kind(inner);
        if (
          k === "do" && inner.arguments.length === 2 &&
          inner.arguments[0].type !== "SpreadElement" &&
          is_task_dict(parentheses(inner.arguments[0] as Expression))
        ) {
          gen_call = inner;
        } else if (k === "program" && inner.arguments.length === 1) {
          gen_call = inner;
          program_mode = true;
        }
      }
    } else if (
      outer.arguments.length === 0 &&
      callee.type === "MemberExpression" && !callee.computed &&
      !callee.optional && callee.property.type === "Identifier" &&
      callee.property.name === "run"
    ) {
      const recv = parentheses(callee.object);
      if (
        recv.type === "CallExpression" && !recv.optional &&
        recv.typeArguments == null && services.kind(recv) === "do" &&
        recv.arguments.length === 2 &&
        recv.arguments[0].type !== "SpreadElement" &&
        is_task_dict(parentheses(recv.arguments[0] as Expression))
      ) {
        gen_call = recv;
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

    function emit_yield_expr(
      raw_arg: Expression,
      target_stmts: Statement[],
    ): Expression {
      const lowered_arg = lower_expr(raw_arg, target_stmts);
      const classified = classify_task_yield(lowered_arg, program_mode)!;
      switch (classified.kind) {
        case "pure":
          return classified.value;
        case "from_fn": {
          const cb = unwrap(classified.fn);
          if (
            cb.type === "ArrowFunctionExpression" && !cb.generator &&
            cb.typeParameters == null && cb.returnType == null &&
            cb.params.length === 0 && cb.body.type !== "BlockStatement"
          ) {
            const inner = cb.body as Expression;
            if (!cb.async && is_sync_non_thenable(inner)) return inner;
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
            argument: call(classified.fn, [void_zero()]),
          });
        }
        case "task_ctor": {
          const cb = unwrap(classified.fn);
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
            argument: call(classified.fn, [void_zero()]),
          });
        }
        case "arbitrary":
          return node({
            type: "AwaitExpression",
            argument: call(call(member(classified.expr, "value"), []), []),
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

    const emitted = lower_list(body.body as Statement[]);
    const async_fn: ArrowFunctionExpression = node({
      type: "ArrowFunctionExpression",
      id: null,
      expression: false,
      generator: false,
      async: true,
      params: [],
      body: block(emitted),
      typeParameters: null,
      returnType: null,
    });
    return { expression: call(async_fn, []), direct: true };
  }

  // =========================================================================
  // P4: Traversable.traverse / ArrayT(xs).traverse / traverse_sequential fusion
  // =========================================================================
  type TraverseDict = {
    readonly mode: "maybe" | "either" | "identity";
    readonly dict_id: IdentifierReference;
  };

  function match_traverse_dict(expr: Expression): TraverseDict | undefined {
    const val = parentheses(expr);
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
    | { readonly kind: "ok"; readonly expr: Expression }
    | {
      readonly kind: "cond";
      readonly test: Expression;
      readonly ok_expr: Expression;
      readonly err_expr?: Expression;
    };

  function match_ctor_call(
    expr: Expression,
    mode: "maybe" | "either" | "identity",
  ): { readonly ok: boolean; readonly arg?: Expression } | undefined {
    const val = parentheses(expr);
    if (
      val.type !== "CallExpression" || val.optional ||
      val.typeArguments != null
    ) return undefined;
    const callee = parentheses(val.callee);
    if (callee.type === "Identifier" && services.bindings.imported(callee)) {
      const name = callee.name;
      if (mode === "maybe") {
        if (
          services.imports.just_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) return { ok: true, arg: val.arguments[0] as Expression };
        if (
          services.imports.nothing_constructors?.has(name) &&
          val.arguments.length === 0
        ) return { ok: false };
      } else if (mode === "either") {
        if (
          services.imports.right_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) return { ok: true, arg: val.arguments[0] as Expression };
        if (
          services.imports.left_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) return { ok: false, arg: val.arguments[0] as Expression };
      } else {
        if (
          services.imports.identity_constructors?.has(name) &&
          val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) return { ok: true, arg: val.arguments[0] as Expression };
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
        ) return { ok: true, arg: val.arguments[0] as Expression };
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
        ) return { ok: true, arg: val.arguments[0] as Expression };
        if (
          prop === "Left" && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) return { ok: false, arg: val.arguments[0] as Expression };
      } else if (
        mode === "identity" &&
        services.imports.direct_identity_dictionaries?.has(obj)
      ) {
        if (
          prop === "pure" && val.arguments.length === 1 &&
          val.arguments[0].type !== "SpreadElement"
        ) return { ok: true, arg: val.arguments[0] as Expression };
      }
    }
    return undefined;
  }

  function match_elided_body(
    expr: Expression,
    mode: "maybe" | "either" | "identity",
  ): ElidedBranch | undefined {
    const direct = match_ctor_call(expr, mode);
    if (direct !== undefined && direct.ok && direct.arg !== undefined) {
      return { kind: "ok", expr: direct.arg };
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
            err_expr: alt.arg,
          };
        }
        return {
          kind: "cond",
          test: node({
            type: "UnaryExpression",
            operator: "!",
            prefix: true,
            argument: val.test,
          }),
          ok_expr: alt.arg!,
          err_expr: cons.arg,
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

  return {
    lower_before(
      outer: CallExpression,
    ): { expression: Expression; direct: boolean } | undefined {
      return task_terminal_fusion(outer);
    },
    lower_after(
      outer: CallExpression,
    ): { expression: Expression; direct: boolean } | undefined {
      return traverse_fusion(outer) ?? match_fusion(outer);
    },
  };
}

import { visitorKeys } from "oxc-parser";
import type {
  ArrowFunctionExpression,
  BindingPattern,
  BlockStatement,
  CallExpression,
  Expression,
  FunctionBody,
  IdentifierReference,
  Node,
  ParamPattern,
  ReturnStatement,
  Statement,
  StaticMemberExpression,
  TSType,
  TSTypeReference,
  VariableDeclaration,
} from "oxc-parser";

/** Generated nodes have no source span until printed. */
export function node<const T extends { type: string }>(value: T) {
  return { ...value, start: -1, end: -1 };
}

export function id(name: string): IdentifierReference {
  return node({ type: "Identifier", name });
}

export function literal(value: string | number | boolean | null): Expression {
  if (value === null) {
    return node({ type: "Literal", value: null, raw: "null" });
  }
  if (typeof value === "boolean") {
    return node({ type: "Literal", value, raw: value ? "true" : "false" });
  }
  if (typeof value === "number") {
    return node({
      type: "Literal",
      value,
      raw: Number.isFinite(value) ? String(value) : "null",
    });
  }
  return node({ type: "Literal", value, raw: JSON.stringify(value) });
}

export function member(
  object: Expression,
  property: string,
): StaticMemberExpression {
  return node({
    type: "MemberExpression",
    object,
    property: id(property),
    optional: false,
    computed: false,
  });
}

export function call(
  callee: Expression,
  args: readonly Expression[],
  type_arguments?: readonly TSType[],
): CallExpression {
  const result: CallExpression = node({
    type: "CallExpression",
    callee,
    arguments: [...args],
    optional: false,
  });
  if (type_arguments !== undefined) {
    result.typeArguments = node({
      type: "TSTypeParameterInstantiation",
      params: Array.from(type_arguments),
    });
  }
  return result;
}

export function arrow(
  params: readonly ParamPattern[],
  body: Expression | FunctionBody,
  return_type?: TSType,
): ArrowFunctionExpression {
  const result: ArrowFunctionExpression = node({
    type: "ArrowFunctionExpression",
    params: [...params],
    body,
    expression: body.type !== "BlockStatement",
    async: false,
    id: null,
    generator: false,
  });
  if (return_type !== undefined) {
    result.returnType = node({
      type: "TSTypeAnnotation",
      typeAnnotation: return_type,
    });
  }
  return result;
}

export function block(body: readonly Statement[]): BlockStatement {
  return node({ type: "BlockStatement", body: [...body] });
}

export function ret(expression?: Expression): ReturnStatement {
  let argument: Expression | null = null;
  if (expression !== undefined) argument = expression;
  return node({ type: "ReturnStatement", argument });
}

export function variable(
  kind: "const" | "let",
  name: BindingPattern,
  init?: Expression,
): VariableDeclaration {
  let initial: Expression | null = null;
  if (init !== undefined) initial = init;
  return node({
    type: "VariableDeclaration",
    kind,
    declarations: [
      node({ type: "VariableDeclarator", id: name, init: initial }),
    ],
  });
}

export function parameter(
  name: string | BindingPattern,
  type?: TSType,
): ParamPattern {
  let pattern: BindingPattern;
  if (typeof name === "string") pattern = id(name);
  else pattern = name;
  if (type === undefined) return pattern;
  return {
    ...pattern,
    typeAnnotation: node({ type: "TSTypeAnnotation", typeAnnotation: type }),
  } as ParamPattern;
}

export function type_ref(
  name: string,
  args?: readonly TSType[],
): TSTypeReference {
  const result: TSTypeReference = node({
    type: "TSTypeReference",
    typeName: id(name),
    typeArguments: null,
  });
  if (args !== undefined) {
    result.typeArguments = node({
      type: "TSTypeParameterInstantiation",
      params: Array.from(args),
    });
  }
  return result;
}

const skipped_type_keys = new Set([
  "typeAnnotation",
  "typeArguments",
  "returnType",
  "typeParameters",
]);

/** Precomputed runtime-only child keys for each Oxc AST node type. */
export const value_visitor_keys: Readonly<Record<string, readonly string[]>> =
  /* @__PURE__ */ (() => {
    const result: Record<string, readonly string[]> = Object.create(null);
    for (const [type, keys] of Object.entries(visitorKeys)) {
      result[type] = keys.filter((key) => !skipped_type_keys.has(key));
    }
    return result;
  })();

export function is_node(value: unknown): value is Node {
  return typeof value === "object" && value !== null &&
    typeof (value as { type?: unknown }).type === "string";
}

/** Visit only Oxc's child keys; returning false skips a subtree. */
export function walk(
  root: Node,
  visit: (node: Node, parent?: Node) => void | false,
  parent?: Node,
): void {
  if (visit(root, parent) === false) return;
  const keys = visitorKeys[root.type];
  if (keys === undefined || keys.length === 0) return;
  const record = root as unknown as Record<string, unknown>;
  for (let index = 0; index < keys.length; index += 1) {
    const value = record[keys[index]];
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let item = 0; item < value.length; item += 1) {
        const child = value[item];
        if (
          child !== null && typeof child === "object" &&
          typeof (child as { type?: unknown }).type === "string"
        ) walk(child as Node, visit, root);
      }
    } else if (typeof (value as { type?: unknown }).type === "string") {
      walk(value as Node, visit, root);
    }
  }
}

/** Visit only runtime-value child keys (skipping TS type annotations/arguments). */
export function walk_values(
  root: Node,
  visit: (node: Node, parent?: Node) => void | false,
  parent?: Node,
): void {
  if (visit(root, parent) === false) return;
  const type = root.type;
  switch (type) {
    case "Literal":
    case "ThisExpression":
    case "Super":
    case "TemplateElement":
    case "PrivateIdentifier":
    case "EmptyStatement":
    case "DebuggerStatement":
      return;
    case "Identifier":
      if (
        "decorators" in root && root.decorators !== undefined &&
        root.decorators.length > 0
      ) {
        const decs = root.decorators;
        for (let i = 0; i < decs.length; i += 1) {
          walk_values(decs[i], visit, root);
        }
      }
      return;
    case "MemberExpression":
      walk_values(root.object, visit, root);
      walk_values(root.property, visit, root);
      return;
    case "CallExpression":
    case "NewExpression": {
      walk_values(root.callee, visit, root);
      const args = root.arguments;
      for (let i = 0; i < args.length; i += 1) {
        walk_values(args[i], visit, root);
      }
      return;
    }
    case "BinaryExpression":
    case "LogicalExpression":
    case "AssignmentExpression":
      walk_values(root.left, visit, root);
      walk_values(root.right, visit, root);
      return;
    case "ExpressionStatement":
      walk_values(root.expression, visit, root);
      return;
    case "ReturnStatement":
    case "YieldExpression":
      if (root.argument !== null) walk_values(root.argument, visit, root);
      return;
    case "UnaryExpression":
    case "UpdateExpression":
    case "AwaitExpression":
    case "SpreadElement":
    case "ThrowStatement":
      walk_values(root.argument, visit, root);
      return;
    case "BreakStatement":
    case "ContinueStatement":
      if (root.label !== null) walk_values(root.label, visit, root);
      return;
    case "VariableDeclaration": {
      const decls = root.declarations;
      for (let i = 0; i < decls.length; i += 1) {
        walk_values(decls[i], visit, root);
      }
      return;
    }
    case "VariableDeclarator":
      walk_values(root.id, visit, root);
      if (root.init !== null) walk_values(root.init, visit, root);
      return;
    case "BlockStatement":
    case "Program": {
      const body = root.body;
      for (let i = 0; i < body.length; i += 1) {
        walk_values(body[i], visit, root);
      }
      return;
    }
    case "IfStatement":
      walk_values(root.test, visit, root);
      walk_values(root.consequent, visit, root);
      if (root.alternate !== null) walk_values(root.alternate, visit, root);
      return;
    case "ConditionalExpression":
      walk_values(root.test, visit, root);
      walk_values(root.consequent, visit, root);
      walk_values(root.alternate, visit, root);
      return;
    case "ArrowFunctionExpression": {
      const params = root.params;
      for (let i = 0; i < params.length; i += 1) {
        walk_values(params[i], visit, root);
      }
      walk_values(root.body, visit, root);
      return;
    }
    case "FunctionDeclaration":
    case "FunctionExpression": {
      if (root.id !== null) walk_values(root.id, visit, root);
      const params = root.params;
      for (let i = 0; i < params.length; i += 1) {
        walk_values(params[i], visit, root);
      }
      if (root.body !== null) walk_values(root.body, visit, root);
      return;
    }
    case "Property":
      walk_values(root.key, visit, root);
      walk_values(root.value, visit, root);
      return;
    case "ObjectExpression": {
      const props = root.properties;
      for (let i = 0; i < props.length; i += 1) {
        walk_values(props[i], visit, root);
      }
      return;
    }
    case "ArrayExpression": {
      const els = root.elements;
      for (let i = 0; i < els.length; i += 1) {
        const el = els[i];
        if (el !== null) walk_values(el, visit, root);
      }
      return;
    }
    case "SequenceExpression": {
      const exprs = root.expressions;
      for (let i = 0; i < exprs.length; i += 1) {
        walk_values(exprs[i], visit, root);
      }
      return;
    }
    case "TemplateLiteral": {
      const quasis = root.quasis;
      for (let i = 0; i < quasis.length; i += 1) {
        walk_values(quasis[i], visit, root);
      }
      const exprs = root.expressions;
      for (let i = 0; i < exprs.length; i += 1) {
        walk_values(exprs[i], visit, root);
      }
      return;
    }
    case "ChainExpression":
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSInstantiationExpression":
    case "TSTypeAssertion":
      walk_values(root.expression, visit, root);
      return;
    case "ExportDefaultDeclaration":
      walk_values(root.declaration, visit, root);
      return;
    case "ExportNamedDeclaration":
      if (
        root.declaration !== null && root.specifiers.length === 0 &&
        root.source === null &&
        (root.attributes === undefined || root.attributes.length === 0)
      ) {
        walk_values(root.declaration, visit, root);
        return;
      }
      break;
  }
  const keys = value_visitor_keys[type];
  if (keys === undefined || keys.length === 0) return;
  const record = root as unknown as Record<string, unknown>;
  for (let index = 0; index < keys.length; index += 1) {
    const value = record[keys[index]];
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let item = 0; item < value.length; item += 1) {
        const child = value[item];
        if (
          child !== null && typeof child === "object" &&
          typeof (child as { type?: unknown }).type === "string"
        ) walk_values(child as Node, visit, root);
      }
    } else if (typeof (value as { type?: unknown }).type === "string") {
      walk_values(value as Node, visit, root);
    }
  }
}

/** Postorder functional rewrite. Undefined keeps a node; null removes it. */
export function rewrite<T extends Node>(
  root: T,
  visit: (node: Node) => Node | null | undefined,
): T;
export function rewrite(
  root: Node,
  visit: (node: Node) => Node | null | undefined,
): Node {
  function descend(current: Node): Node | null {
    let result = current;
    const keys = visitorKeys[current.type];
    if (keys !== undefined && keys.length > 0) {
      const record = current as unknown as Record<string, unknown>;
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const value = record[key];
        if (value === null || typeof value !== "object") continue;
        let next: unknown = value;
        if (Array.isArray(value)) {
          let children: unknown[] | undefined;
          for (let item = 0; item < value.length; item += 1) {
            const child = value[item];
            if (
              child === null || typeof child !== "object" ||
              typeof (child as { type?: unknown }).type !== "string"
            ) {
              if (children !== undefined) children.push(child);
              continue;
            }
            const rewritten = descend(child as Node);
            if (rewritten !== child) {
              if (children === undefined) children = value.slice(0, item);
              if (rewritten !== null) children.push(rewritten);
            } else if (children !== undefined) {
              children.push(child);
            }
          }
          if (children !== undefined) next = children;
        } else if (typeof (value as { type?: unknown }).type === "string") {
          next = descend(value as Node);
        }
        if (next !== value) result = { ...result, [key]: next };
      }
    }
    const replacement = visit(result);
    if (replacement === undefined) return result;
    return replacement;
  }
  const result = descend(root);
  if (result === null) throw new Error("Cannot remove the rewrite root");
  return result;
}

export function unwrap(expression: Expression): Expression {
  while (expression.type === "ParenthesizedExpression") {
    expression = expression.expression;
  }
  return expression;
}

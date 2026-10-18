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

export function is_node(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value &&
    typeof value.type === "string";
}

/** Visit only Oxc's child keys; returning false skips a subtree. */
export function walk(
  root: Node,
  visit: (node: Node, parent?: Node) => void | false,
  parent?: Node,
): void {
  if (visit(root, parent) === false) return;
  const record = root as unknown as Record<string, unknown>;
  for (const key of visitorKeys[root.type] ?? []) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const child of value) if (is_node(child)) walk(child, visit, root);
    } else if (is_node(value)) walk(value, visit, root);
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
    const record = current as unknown as Record<string, unknown>;
    for (const key of visitorKeys[current.type] ?? []) {
      const value = record[key];
      let next: unknown = value;
      if (Array.isArray(value)) {
        const children: unknown[] = [];
        let changed = false;
        for (const child of value) {
          if (!is_node(child)) {
            children.push(child);
            continue;
          }
          const rewritten = descend(child);
          if (rewritten !== child) changed = true;
          if (rewritten !== null) children.push(rewritten);
        }
        if (changed) next = children;
      } else if (is_node(value)) next = descend(value);
      if (next !== value) result = { ...result, [key]: next };
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

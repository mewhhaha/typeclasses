import { visitorKeys } from "oxc-parser";
import type { BindingPattern, Node, Program } from "oxc-parser";
import { is_node } from "./transform_ast.ts";

type Scope = {
  readonly owner: Node;
  readonly parent?: Scope;
  readonly bindings: Map<string, Node>;
};

/** Lexical value bindings, including declarations which shadow during the TDZ. */
export function create_binding_analysis(program: Program) {
  const scopes = new WeakMap<Node, Scope>();
  const parents = new WeakMap<Node, Node>();
  const root: Scope = { owner: program, bindings: new Map() };
  function declare(
    pattern: BindingPattern,
    declaration: Node,
    scope: Scope,
  ): void {
    switch (pattern.type) {
      case "Identifier":
        scope.bindings.set(pattern.name, declaration);
        return;
      case "AssignmentPattern":
        declare(pattern.left, declaration, scope);
        return;
      case "ObjectPattern":
        for (const property of pattern.properties) {
          if (property.type === "RestElement") {
            declare(property.argument, declaration, scope);
          } else declare(property.value, declaration, scope);
        }
        return;
      case "ArrayPattern":
        for (const element of pattern.elements) {
          if (element === null) continue;
          if (element.type === "RestElement") {
            declare(element.argument, declaration, scope);
          } else declare(element, declaration, scope);
        }
    }
  }
  function visit(current: Node, outer: Scope, function_scope: Scope): void {
    let scope = outer;
    switch (current.type) {
      case "FunctionDeclaration":
      case "TSDeclareFunction":
      case "ClassDeclaration":
        if (current.id !== null) declare(current.id, current, outer);
        break;
      case "TSEnumDeclaration":
      case "TSImportEqualsDeclaration":
        if (
          current.type !== "TSImportEqualsDeclaration" ||
          current.importKind !== "type"
        ) declare(current.id, current, outer);
        break;
      case "TSModuleDeclaration":
        if (!current.global && current.id.type === "Identifier") {
          declare(current.id, current, outer);
        }
        break;
    }
    switch (current.type) {
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "TSDeclareFunction":
      case "TSEmptyBodyFunctionExpression":
      case "ArrowFunctionExpression":
        scope = { owner: current, parent: outer, bindings: new Map() };
        function_scope = scope;
        if (current.id !== null) declare(current.id, current, scope);
        for (const parameter of current.params) {
          if (parameter.type === "RestElement") {
            declare(parameter.argument, parameter, scope);
          } else if (parameter.type === "TSParameterProperty") {
            declare(parameter.parameter, parameter, scope);
          } else declare(parameter, parameter, scope);
        }
        break;
      case "StaticBlock":
      case "TSModuleBlock":
        scope = { owner: current, parent: outer, bindings: new Map() };
        function_scope = scope;
        break;
      case "BlockStatement":
      case "SwitchStatement":
      case "CatchClause":
      case "ForStatement":
      case "ForOfStatement":
      case "ForInStatement":
      case "ClassDeclaration":
      case "ClassExpression":
      case "TSEnumDeclaration":
        scope = { owner: current, parent: outer, bindings: new Map() };
        if (
          (current.type === "ClassDeclaration" ||
            current.type === "ClassExpression") && current.id !== null
        ) declare(current.id, current, scope);
        if (current.type === "TSEnumDeclaration") {
          for (const member of current.body.members) {
            if (member.id.type === "Identifier") {
              scope.bindings.set(member.id.name, member);
            } else if (member.id.type === "Literal") {
              scope.bindings.set(member.id.value, member);
            }
          }
        }
        break;
    }
    scopes.set(current, scope);
    if (current.type === "ImportDeclaration" && current.importKind !== "type") {
      for (const specifier of current.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind === "type"
        ) continue;
        declare(specifier.local, current, scope);
      }
    }
    if (current.type === "VariableDeclaration") {
      let target = scope;
      if (current.kind === "var") target = function_scope;
      for (const declaration of current.declarations) {
        declare(declaration.id, declaration, target);
      }
    }
    if (current.type === "CatchClause" && current.param !== null) {
      declare(current.param, current.param, scope);
    }
    const record = current as unknown as Record<string, unknown>;
    for (const key of visitorKeys[current.type] ?? []) {
      const value = record[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (!is_node(child)) continue;
          parents.set(child, current);
          visit(child, scope, function_scope);
        }
      } else if (is_node(value)) {
        parents.set(value, current);
        visit(value, scope, function_scope);
      }
    }
  }
  visit(program, root, root);
  const resolved = new WeakMap<Node, Node | null>();
  function resolve(
    identifier: Extract<Node, { type: "Identifier" }>,
  ): Node | null {
    const cached = resolved.get(identifier);
    if (cached !== undefined) return cached;
    let scope = scopes.get(identifier);
    while (scope !== undefined) {
      const declaration = scope.bindings.get(identifier.name);
      if (declaration !== undefined) {
        resolved.set(identifier, declaration);
        return declaration;
      }
      scope = scope.parent;
    }
    resolved.set(identifier, null);
    return null;
  }
  return {
    resolve,
    imported(identifier: Extract<Node, { type: "Identifier" }>): boolean {
      return resolve(identifier)?.type === "ImportDeclaration";
    },
    scope(current: Node): Node | null {
      return scopes.get(current)?.owner ?? null;
    },
    parent(current: Node): Node | null {
      return parents.get(current) ?? null;
    },
  };
}

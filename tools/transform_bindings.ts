import { visitorKeys } from "oxc-parser";
import type { BindingPattern, Node, Program, Statement } from "oxc-parser";
import { value_visitor_keys } from "./transform_ast.ts";

type Scope = {
  readonly owner: Node;
  readonly parent?: Scope;
  bindings?: Record<string, Node>;
};

export type BindingAnalysisObserver = {
  readonly names?: Set<string>;
  readonly on_node?: (node: Node) => void;
  readonly minimal?: boolean;
  readonly skip_statement?: (statement: Statement) => boolean;
  readonly active_indices?: readonly number[];
  readonly record_top_level_scopes?: boolean;
};

/** Lexical value bindings, including declarations which shadow during the TDZ. */
export function create_binding_analysis(
  program: Program,
  observer?: BindingAnalysisObserver,
) {
  const scopes = new Map<Node, Scope>();
  const parents = new Map<Node, Node>();
  const root: Scope = { owner: program };
  const names = observer?.names;
  const on_node = observer?.on_node;
  const minimal = observer?.minimal === true;
  const skip_statement = observer?.skip_statement;
  const active_indices = observer?.active_indices;
  const record_top_level_scopes = observer?.record_top_level_scopes === true;
  const key_table = minimal ? value_visitor_keys : visitorKeys;
  const deferred_top_level: Statement[] = [];
  let top_level_flushed = false;

  function flush_deferred_top_level(): void {
    if (top_level_flushed) return;
    top_level_flushed = true;
    for (let i = 0; i < deferred_top_level.length; i += 1) {
      declare_top_level(deferred_top_level[i]);
    }
    deferred_top_level.length = 0;
  }

  function set_binding(scope: Scope, name: string, declaration: Node): void {
    let bindings = scope.bindings;
    if (bindings === undefined) {
      bindings = Object.create(null) as Record<string, Node>;
      scope.bindings = bindings;
    }
    bindings[name] = declaration;
  }
  function declare(
    pattern: BindingPattern,
    declaration: Node,
    scope: Scope,
  ): void {
    switch (pattern.type) {
      case "Identifier":
        set_binding(scope, pattern.name, declaration);
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
  function declare_top_level(statement: Statement): void {
    let target: Node = statement;
    if (
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration !== null
    ) {
      target = statement.declaration;
    }
    switch (target.type) {
      case "FunctionDeclaration":
      case "TSDeclareFunction":
      case "ClassDeclaration":
        if (target.id !== null) {
          declare(target.id, target, root);
          if (record_top_level_scopes) scopes.set(target, root);
        }
        break;
      case "VariableDeclaration":
        for (const declaration of target.declarations) {
          declare(declaration.id, declaration, root);
          if (record_top_level_scopes) scopes.set(declaration, root);
        }
        break;
      case "TSEnumDeclaration":
      case "TSImportEqualsDeclaration":
        if (
          target.type !== "TSImportEqualsDeclaration" ||
          target.importKind !== "type"
        ) declare(target.id, target, root);
        break;
      case "TSModuleDeclaration":
        if (!target.global && target.id.type === "Identifier") {
          declare(target.id, target, root);
        }
        break;
    }
  }
  function visit(current: Node, outer: Scope, function_scope: Scope): void {
    const type = current.type;
    if (type === "Identifier") {
      if (names !== undefined) names.add(current.name);
      if (on_node !== undefined) on_node(current);
      scopes.set(current, outer);
      return;
    }
    if (
      type === "Literal" || type === "ThisExpression" || type === "Super" ||
      type === "EmptyStatement" || type === "TemplateElement" ||
      type === "PrivateIdentifier" || type === "DebuggerStatement"
    ) {
      if (on_node !== undefined) on_node(current);
      if (!minimal) scopes.set(current, outer);
      return;
    }
    if (on_node !== undefined) on_node(current);
    let scope = outer;
    let record_scope = !minimal;
    switch (type) {
      case "FunctionDeclaration":
      case "TSDeclareFunction":
        record_scope = true;
        if (current.id !== null) declare(current.id, current, outer);
        scope = { owner: current, parent: outer };
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
      case "FunctionExpression":
      case "TSEmptyBodyFunctionExpression":
      case "ArrowFunctionExpression":
        scope = { owner: current, parent: outer };
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
      case "ClassDeclaration":
        record_scope = true;
        if (current.id !== null) declare(current.id, current, outer);
        scope = { owner: current, parent: outer };
        if (current.id !== null) declare(current.id, current, scope);
        break;
      case "ClassExpression":
        scope = { owner: current, parent: outer };
        if (current.id !== null) declare(current.id, current, scope);
        break;
      case "TSEnumDeclaration":
        record_scope = true;
        declare(current.id, current, outer);
        scope = { owner: current, parent: outer };
        for (const member of current.body.members) {
          if (member.id.type === "Identifier") {
            set_binding(scope, member.id.name, member);
          } else if (member.id.type === "Literal") {
            set_binding(scope, member.id.value, member);
          }
        }
        break;
      case "TSImportEqualsDeclaration":
        record_scope = true;
        if (current.importKind !== "type") declare(current.id, current, outer);
        break;
      case "TSModuleDeclaration":
        record_scope = true;
        if (!current.global && current.id.type === "Identifier") {
          declare(current.id, current, outer);
        }
        break;
      case "StaticBlock":
      case "TSModuleBlock":
        record_scope = true;
        scope = { owner: current, parent: outer };
        function_scope = scope;
        break;
      case "BlockStatement":
      case "SwitchStatement":
      case "ForStatement":
      case "ForOfStatement":
      case "ForInStatement":
        record_scope = true;
        scope = { owner: current, parent: outer };
        break;
      case "CatchClause":
        record_scope = true;
        scope = { owner: current, parent: outer };
        if (current.param !== null) {
          declare(current.param, current.param, scope);
        }
        break;
      case "VariableDeclaration": {
        record_scope = true;
        const target = current.kind === "var" ? function_scope : scope;
        for (const declaration of current.declarations) {
          declare(declaration.id, declaration, target);
        }
        break;
      }
      case "ImportDeclaration":
        record_scope = true;
        if (current.importKind !== "type") {
          for (const specifier of current.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.importKind === "type"
            ) continue;
            declare(specifier.local, current, scope);
          }
        }
        break;
      case "VariableDeclarator":
      case "Program":
        record_scope = true;
        break;
    }
    if (record_scope) scopes.set(current, scope);
    if (current === program && active_indices !== undefined) {
      const body = program.body;
      let active_ptr = 0;
      const active_len = active_indices.length;
      for (let index = 0; index < body.length; index += 1) {
        const statement = body[index] as Statement;
        if (statement.type === "ImportDeclaration") {
          if (!minimal) parents.set(statement, program);
          visit(statement, root, root);
          continue;
        }
        if (active_ptr < active_len && active_indices[active_ptr] === index) {
          active_ptr += 1;
          if (!minimal || statement.type === "FunctionDeclaration") {
            parents.set(statement, program);
          }
          visit(statement, root, root);
        } else {
          deferred_top_level.push(statement);
        }
      }
      return;
    }
    if (current === program && skip_statement !== undefined) {
      const body = program.body;
      for (let index = 0; index < body.length; index += 1) {
        const statement = body[index] as Statement;
        if (
          statement.type !== "ImportDeclaration" && skip_statement(statement)
        ) {
          deferred_top_level.push(statement);
          continue;
        }
        if (!minimal || statement.type === "FunctionDeclaration") {
          parents.set(statement, program);
        }
        visit(statement, root, root);
      }
      return;
    }
    if (minimal) {
      if (type === "MemberExpression") {
        visit(current.object, scope, function_scope);
        if (current.computed) {
          visit(current.property, scope, function_scope);
        } else if (
          names !== undefined && current.property.type === "Identifier"
        ) {
          names.add(current.property.name);
        }
        return;
      }
      if (type === "Property" && !current.computed && !current.shorthand) {
        if (names !== undefined && current.key.type === "Identifier") {
          names.add(current.key.name);
        }
        visit(current.value, scope, function_scope);
        return;
      }
    }
    const keys = key_table[type];
    if (keys === undefined || keys.length === 0) return;
    const record = current as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const value = record[keys[index]];
      if (value === null || typeof value !== "object") continue;
      if (Array.isArray(value)) {
        for (let item = 0; item < value.length; item += 1) {
          const child = value[item];
          if (
            child === null || typeof child !== "object" ||
            typeof (child as { type?: unknown }).type !== "string"
          ) continue;
          const child_node = child as Node;
          if (
            !minimal || child_node.type === "VariableDeclarator" ||
            child_node.type === "FunctionDeclaration"
          ) {
            parents.set(child_node, current);
          }
          visit(child_node, scope, function_scope);
        }
      } else if (typeof (value as { type?: unknown }).type === "string") {
        const child_node = value as Node;
        if (
          !minimal || child_node.type === "VariableDeclarator" ||
          child_node.type === "FunctionDeclaration"
        ) {
          parents.set(child_node, current);
        }
        visit(child_node, scope, function_scope);
      }
    }
  }
  visit(program, root, root);
  const resolved = new Map<Node, Node | null>();
  function resolve(
    identifier: Extract<Node, { type: "Identifier" }>,
  ): Node | null {
    const cached = resolved.get(identifier);
    if (cached !== undefined) return cached;
    let scope = scopes.get(identifier);
    const id_name = identifier.name;
    while (scope !== undefined) {
      const bindings = scope.bindings;
      if (bindings !== undefined) {
        const declaration = bindings[id_name];
        if (declaration !== undefined) {
          resolved.set(identifier, declaration);
          return declaration;
        }
      }
      if (
        scope === root && !top_level_flushed && deferred_top_level.length > 0
      ) {
        flush_deferred_top_level();
        const declaration = root.bindings?.[id_name];
        if (declaration !== undefined) {
          resolved.set(identifier, declaration);
          return declaration;
        }
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
      let found = scopes.get(current);
      if (
        found === undefined && record_top_level_scopes && !top_level_flushed &&
        deferred_top_level.length > 0
      ) {
        flush_deferred_top_level();
        found = scopes.get(current);
      }
      return found?.owner ?? null;
    },
    parent(current: Node): Node | null {
      return parents.get(current) ?? null;
    },
  };
}

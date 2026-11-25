import { visitorKeys } from "oxc-parser";
import type {
  BindingPattern,
  Node,
  ParamPattern,
  Program,
  Statement,
} from "oxc-parser";
import { value_visitor_keys } from "./transform_ast.ts";

type Scope = {
  readonly owner: Node;
  readonly parent: Scope | undefined;
  bindings: Record<string, Node> | undefined;
};

export type BindingAnalysisObserver = {
  readonly names?: Set<string>;
  readonly on_node?: (node: Node) => void;
  readonly on_declare?: (name: string) => void;
  readonly on_call?: (node: Extract<Node, { type: "CallExpression" }>) => void;
  readonly minimal?: boolean;
  readonly skip_statement?: (statement: Statement) => boolean;
  readonly active_indices?: readonly number[];
  readonly import_nodes?: readonly Statement[];
  readonly record_top_level_scopes?: boolean;
};

/** Lexical value bindings, including declarations which shadow during the TDZ. */
export function create_binding_analysis(
  program: Program,
  observer?: BindingAnalysisObserver,
) {
  const scopes = new Map<Node, Scope>();
  const parents = new Map<Node, Node>();
  const root: Scope = {
    owner: program,
    parent: undefined,
    bindings: undefined,
  };
  const imported_names = new Set<string>();
  const names = observer?.names;
  const on_node = observer?.on_node;
  const on_declare = observer?.on_declare;
  const on_call = observer?.on_call;
  const minimal = observer?.minimal === true;
  const skip_statement = observer?.skip_statement;
  const active_indices = observer?.active_indices;
  const import_nodes = observer?.import_nodes;
  const record_top_level_scopes = observer?.record_top_level_scopes === true;
  const key_table = minimal ? value_visitor_keys : visitorKeys;
  const deferred_top_level: Statement[] = [];
  let has_deferred_top_level = false;
  let top_level_flushed = false;

  function flush_deferred_top_level(): void {
    if (top_level_flushed || !has_deferred_top_level) return;
    top_level_flushed = true;
    has_deferred_top_level = false;
    if (active_indices !== undefined) {
      const body = program.body;
      const body_len = body.length;
      const active_len = active_indices.length;
      let active_ptr = 0;
      for (let index = 0; index < body_len; index += 1) {
        if (active_ptr < active_len && active_indices[active_ptr] === index) {
          active_ptr += 1;
          continue;
        }
        const statement = body[index] as Statement;
        if (statement.type === "ImportDeclaration") continue;
        declare_top_level(statement);
      }
      return;
    }
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
    notify: boolean,
  ): void {
    switch (pattern.type) {
      case "Identifier": {
        const id_name = pattern.name;
        set_binding(scope, id_name, declaration);
        if (notify && on_declare !== undefined) on_declare(id_name);
        return;
      }
      case "AssignmentPattern":
        declare(pattern.left, declaration, scope, notify);
        return;
      case "ObjectPattern": {
        const props = pattern.properties;
        for (let i = 0; i < props.length; i += 1) {
          const property = props[i];
          if (property.type === "RestElement") {
            declare(property.argument, declaration, scope, notify);
          } else {
            declare(property.value, declaration, scope, notify);
          }
        }
        return;
      }
      case "ArrayPattern": {
        const els = pattern.elements;
        for (let i = 0; i < els.length; i += 1) {
          const element = els[i];
          if (element === null) continue;
          if (element.type === "RestElement") {
            declare(element.argument, declaration, scope, notify);
          } else {
            declare(element, declaration, scope, notify);
          }
        }
      }
    }
  }

  function declare_param(
    parameter: ParamPattern,
    scope: Scope,
    notify: boolean,
  ): void {
    if (parameter.type === "Identifier") {
      const p_name = parameter.name;
      set_binding(scope, p_name, parameter);
      if (notify && on_declare !== undefined) on_declare(p_name);
    } else if (parameter.type === "RestElement") {
      declare(parameter.argument, parameter, scope, notify);
    } else if (parameter.type === "TSParameterProperty") {
      declare(parameter.parameter, parameter, scope, notify);
    } else {
      declare(parameter, parameter, scope, notify);
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
          declare(target.id, target, root, false);
          if (record_top_level_scopes) scopes.set(target, root);
        }
        break;
      case "VariableDeclaration": {
        const decls = target.declarations;
        for (let i = 0; i < decls.length; i += 1) {
          const declaration = decls[i];
          declare(declaration.id, declaration, root, false);
          if (record_top_level_scopes) scopes.set(declaration, root);
        }
        break;
      }
      case "TSEnumDeclaration":
      case "TSImportEqualsDeclaration":
        if (
          target.type !== "TSImportEqualsDeclaration" ||
          target.importKind !== "type"
        ) declare(target.id, target, root, false);
        break;
      case "TSModuleDeclaration":
        if (!target.global && target.id.type === "Identifier") {
          declare(target.id, target, root, false);
        }
        break;
    }
  }

  function visit_minimal(
    current: Node,
    outer: Scope,
    function_scope: Scope,
  ): void {
    const type = current.type;
    if (type === "Identifier") {
      if (names !== undefined) names.add(current.name);
      if (on_node !== undefined) on_node(current);
      scopes.set(current, outer);
      if (
        "decorators" in current && current.decorators !== undefined &&
        current.decorators.length > 0
      ) {
        const decs = current.decorators;
        for (let i = 0; i < decs.length; i += 1) {
          visit_minimal(decs[i], outer, function_scope);
        }
      }
      return;
    }
    if (
      type === "Literal" || type === "ThisExpression" || type === "Super" ||
      type === "EmptyStatement" || type === "TemplateElement" ||
      type === "PrivateIdentifier" || type === "DebuggerStatement"
    ) {
      if (on_node !== undefined) on_node(current);
      return;
    }
    if (on_node !== undefined) on_node(current);

    switch (type) {
      case "MemberExpression": {
        visit_minimal(current.object, outer, function_scope);
        if (current.computed) {
          visit_minimal(current.property, outer, function_scope);
        } else if (
          names !== undefined && current.property.type === "Identifier"
        ) {
          names.add(current.property.name);
        }
        return;
      }
      case "CallExpression": {
        if (on_call !== undefined) on_call(current);
        visit_minimal(current.callee, outer, function_scope);
        const args = current.arguments;
        for (let i = 0; i < args.length; i += 1) {
          visit_minimal(args[i], outer, function_scope);
        }
        return;
      }
      case "BinaryExpression":
      case "LogicalExpression":
      case "AssignmentExpression":
        visit_minimal(current.left, outer, function_scope);
        visit_minimal(current.right, outer, function_scope);
        return;
      case "ExpressionStatement":
        visit_minimal(current.expression, outer, function_scope);
        return;
      case "ReturnStatement":
      case "YieldExpression":
        if (current.argument !== null) {
          visit_minimal(current.argument, outer, function_scope);
        }
        return;
      case "UnaryExpression":
      case "UpdateExpression":
      case "AwaitExpression":
      case "SpreadElement":
      case "ThrowStatement":
        visit_minimal(current.argument, outer, function_scope);
        return;
      case "ConditionalExpression":
        visit_minimal(current.test, outer, function_scope);
        visit_minimal(current.consequent, outer, function_scope);
        visit_minimal(current.alternate, outer, function_scope);
        return;
      case "IfStatement": {
        visit_minimal(current.test, outer, function_scope);
        const cons = current.consequent;
        if (cons.type === "FunctionDeclaration") parents.set(cons, current);
        visit_minimal(cons, outer, function_scope);
        const alt = current.alternate;
        if (alt !== null) {
          if (alt.type === "FunctionDeclaration") parents.set(alt, current);
          visit_minimal(alt, outer, function_scope);
        }
        return;
      }
      case "BlockStatement": {
        const scope: Scope = {
          owner: current,
          parent: outer,
          bindings: undefined,
        };
        scopes.set(current, scope);
        const body = current.body;
        for (let i = 0; i < body.length; i += 1) {
          const stmt = body[i];
          if (stmt.type === "FunctionDeclaration") parents.set(stmt, current);
          visit_minimal(stmt, scope, function_scope);
        }
        return;
      }
      case "VariableDeclaration": {
        scopes.set(current, outer);
        const target = current.kind === "var" ? function_scope : outer;
        const decls = current.declarations;
        if (decls.length === 1) {
          const decl = decls[0];
          parents.set(decl, current);
          if (on_node !== undefined) on_node(decl);
          scopes.set(decl, outer);
          const decl_id = decl.id;
          if (decl_id.type === "Identifier") {
            const id_name = decl_id.name;
            set_binding(target, id_name, decl);
            if (on_declare !== undefined) on_declare(id_name);
            if (names !== undefined) names.add(id_name);
            if (on_node !== undefined) on_node(decl_id);
            scopes.set(decl_id, outer);
          } else {
            declare(decl_id, decl, target, true);
            visit_minimal(decl_id, outer, function_scope);
          }
          if (decl.init !== null) {
            visit_minimal(decl.init, outer, function_scope);
          }
          return;
        }
        for (let i = 0; i < decls.length; i += 1) {
          const decl = decls[i];
          declare(decl.id, decl, target, true);
        }
        for (let i = 0; i < decls.length; i += 1) {
          const decl = decls[i];
          parents.set(decl, current);
          if (on_node !== undefined) on_node(decl);
          scopes.set(decl, outer);
          visit_minimal(decl.id, outer, function_scope);
          if (decl.init !== null) {
            visit_minimal(decl.init, outer, function_scope);
          }
        }
        return;
      }
      case "ArrowFunctionExpression": {
        const scope: Scope = {
          owner: current,
          parent: outer,
          bindings: undefined,
        };
        const params = current.params;
        if (params.length === 1 && params[0].type === "Identifier") {
          const p = params[0];
          const p_name = p.name;
          set_binding(scope, p_name, p);
          if (on_declare !== undefined) on_declare(p_name);
          if (names !== undefined) names.add(p_name);
          if (on_node !== undefined) on_node(p);
          scopes.set(p, scope);
        } else if (params.length > 0) {
          for (let i = 0; i < params.length; i += 1) {
            declare_param(params[i], scope, true);
          }
          for (let i = 0; i < params.length; i += 1) {
            visit_minimal(params[i], scope, scope);
          }
        }
        visit_minimal(current.body, scope, scope);
        return;
      }
      case "Property": {
        if (!current.computed && !current.shorthand) {
          if (names !== undefined && current.key.type === "Identifier") {
            names.add(current.key.name);
          }
          visit_minimal(current.value, outer, function_scope);
        } else {
          visit_minimal(current.key, outer, function_scope);
          visit_minimal(current.value, outer, function_scope);
        }
        return;
      }
      case "ObjectExpression": {
        const props = current.properties;
        for (let i = 0; i < props.length; i += 1) {
          visit_minimal(props[i], outer, function_scope);
        }
        return;
      }
      case "ArrayExpression": {
        const els = current.elements;
        for (let i = 0; i < els.length; i += 1) {
          const el = els[i];
          if (el !== null) visit_minimal(el, outer, function_scope);
        }
        return;
      }
      case "SequenceExpression": {
        const exprs = current.expressions;
        for (let i = 0; i < exprs.length; i += 1) {
          visit_minimal(exprs[i], outer, function_scope);
        }
        return;
      }
      case "NewExpression": {
        visit_minimal(current.callee, outer, function_scope);
        const args = current.arguments;
        for (let i = 0; i < args.length; i += 1) {
          visit_minimal(args[i], outer, function_scope);
        }
        return;
      }
      case "TemplateLiteral": {
        if (on_node !== undefined) {
          const quasis = current.quasis;
          for (let i = 0; i < quasis.length; i += 1) on_node(quasis[i]);
        }
        const exprs = current.expressions;
        for (let i = 0; i < exprs.length; i += 1) {
          visit_minimal(exprs[i], outer, function_scope);
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
        visit_minimal(current.expression, outer, function_scope);
        return;
      case "FunctionDeclaration":
      case "TSDeclareFunction": {
        if (current.id !== null) {
          const fn_name = current.id.name;
          set_binding(outer, fn_name, current);
          if (on_declare !== undefined) on_declare(fn_name);
        }
        const scope: Scope = {
          owner: current,
          parent: outer,
          bindings: undefined,
        };
        scopes.set(current, scope);
        if (current.id !== null) {
          const fn_name = current.id.name;
          set_binding(scope, fn_name, current);
          if (names !== undefined) names.add(fn_name);
          if (on_node !== undefined) on_node(current.id);
          scopes.set(current.id, scope);
        }
        const params = current.params;
        for (let i = 0; i < params.length; i += 1) {
          declare_param(params[i], scope, true);
        }
        for (let i = 0; i < params.length; i += 1) {
          visit_minimal(params[i], scope, scope);
        }
        if (current.body !== null) {
          visit_minimal(current.body, scope, scope);
        }
        return;
      }
      case "FunctionExpression":
      case "TSEmptyBodyFunctionExpression": {
        const scope: Scope = {
          owner: current,
          parent: outer,
          bindings: undefined,
        };
        if (current.id !== null) {
          const fn_name = current.id.name;
          set_binding(scope, fn_name, current);
          if (on_declare !== undefined) on_declare(fn_name);
          if (names !== undefined) names.add(fn_name);
          if (on_node !== undefined) on_node(current.id);
          scopes.set(current.id, scope);
        }
        const params = current.params;
        for (let i = 0; i < params.length; i += 1) {
          declare_param(params[i], scope, true);
        }
        for (let i = 0; i < params.length; i += 1) {
          visit_minimal(params[i], scope, scope);
        }
        if (current.body !== null) {
          visit_minimal(current.body, scope, scope);
        }
        return;
      }
      case "ExportDefaultDeclaration": {
        const decl = current.declaration;
        if (decl.type === "FunctionDeclaration") parents.set(decl, current);
        visit_minimal(decl, outer, function_scope);
        return;
      }
      case "ExportNamedDeclaration": {
        if (
          current.declaration !== null && current.specifiers.length === 0 &&
          current.source === null &&
          (current.attributes === undefined || current.attributes.length === 0)
        ) {
          const decl = current.declaration;
          if (decl.type === "FunctionDeclaration") parents.set(decl, current);
          visit_minimal(decl, outer, function_scope);
          return;
        }
        break;
      }
      case "ImportDeclaration": {
        scopes.set(current, outer);
        const is_root = outer === root;
        const value_import = current.importKind !== "type";
        const specs = current.specifiers;
        for (let i = 0; i < specs.length; i += 1) {
          const specifier = specs[i];
          if (on_node !== undefined) on_node(specifier);
          if (
            value_import &&
            !(specifier.type === "ImportSpecifier" &&
              specifier.importKind === "type")
          ) {
            const local_name = specifier.local.name;
            set_binding(outer, local_name, current);
            if (is_root) imported_names.add(local_name);
          }
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier"
          ) {
            if (names !== undefined) names.add(specifier.imported.name);
            if (on_node !== undefined) on_node(specifier.imported);
            scopes.set(specifier.imported, outer);
          }
          if (names !== undefined) names.add(specifier.local.name);
          if (on_node !== undefined) on_node(specifier.local);
          scopes.set(specifier.local, outer);
        }
        if (on_node !== undefined) on_node(current.source);
        return;
      }
      case "Program": {
        scopes.set(current, outer);
        visit_program_body(current, visit_minimal);
        return;
      }
      default:
        break;
    }

    let scope = outer;
    let record_scope = false;
    switch (type) {
      case "ClassDeclaration":
        record_scope = true;
        if (current.id !== null) declare(current.id, current, outer, true);
        scope = { owner: current, parent: outer, bindings: undefined };
        if (current.id !== null) declare(current.id, current, scope, false);
        break;
      case "ClassExpression":
        scope = { owner: current, parent: outer, bindings: undefined };
        if (current.id !== null) declare(current.id, current, scope, true);
        break;
      case "TSEnumDeclaration":
        record_scope = true;
        declare(current.id, current, outer, true);
        scope = { owner: current, parent: outer, bindings: undefined };
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
        if (current.importKind !== "type") {
          declare(current.id, current, outer, true);
        }
        break;
      case "TSModuleDeclaration":
        record_scope = true;
        if (!current.global && current.id.type === "Identifier") {
          declare(current.id, current, outer, true);
        }
        break;
      case "StaticBlock":
      case "TSModuleBlock":
        record_scope = true;
        scope = { owner: current, parent: outer, bindings: undefined };
        function_scope = scope;
        break;
      case "SwitchStatement":
      case "ForStatement":
      case "ForOfStatement":
      case "ForInStatement":
        record_scope = true;
        scope = { owner: current, parent: outer, bindings: undefined };
        break;
      case "CatchClause":
        record_scope = true;
        scope = { owner: current, parent: outer, bindings: undefined };
        if (current.param !== null) {
          declare(current.param, current.param, scope, false);
        }
        break;
      case "VariableDeclarator":
        record_scope = true;
        break;
    }
    if (record_scope) scopes.set(current, scope);

    const keys = value_visitor_keys[type];
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
            child_node.type === "VariableDeclarator" ||
            child_node.type === "FunctionDeclaration"
          ) {
            parents.set(child_node, current);
          }
          visit_minimal(child_node, scope, function_scope);
        }
      } else if (typeof (value as { type?: unknown }).type === "string") {
        const child_node = value as Node;
        if (
          child_node.type === "VariableDeclarator" ||
          child_node.type === "FunctionDeclaration"
        ) {
          parents.set(child_node, current);
        }
        visit_minimal(child_node, scope, function_scope);
      }
    }
  }

  function visit_program_body(
    prog: Program,
    visitor: (node: Node, outer: Scope, fn_scope: Scope) => void,
  ): void {
    const body = prog.body;
    const body_len = body.length;
    if (active_indices !== undefined) {
      const active_len = active_indices.length;
      if (import_nodes !== undefined) {
        for (let i = 0; i < import_nodes.length; i += 1) {
          const statement = import_nodes[i];
          if (!minimal) parents.set(statement, prog);
          visitor(statement, root, root);
        }
        for (let i = 0; i < active_len; i += 1) {
          const statement = body[active_indices[i]] as Statement;
          if (!minimal || statement.type === "FunctionDeclaration") {
            parents.set(statement, prog);
          }
          visitor(statement, root, root);
        }
        has_deferred_top_level = import_nodes.length + active_len < body_len;
        return;
      }
      let active_ptr = 0;
      for (let index = 0; index < body_len; index += 1) {
        const statement = body[index] as Statement;
        if (statement.type === "ImportDeclaration") {
          if (!minimal) parents.set(statement, prog);
          visitor(statement, root, root);
          continue;
        }
        if (active_ptr < active_len && active_indices[active_ptr] === index) {
          active_ptr += 1;
          if (!minimal || statement.type === "FunctionDeclaration") {
            parents.set(statement, prog);
          }
          visitor(statement, root, root);
        } else {
          has_deferred_top_level = true;
        }
      }
      return;
    }
    if (skip_statement !== undefined) {
      for (let index = 0; index < body_len; index += 1) {
        const statement = body[index] as Statement;
        if (
          statement.type !== "ImportDeclaration" && skip_statement(statement)
        ) {
          deferred_top_level.push(statement);
          has_deferred_top_level = true;
          continue;
        }
        if (!minimal || statement.type === "FunctionDeclaration") {
          parents.set(statement, prog);
        }
        visitor(statement, root, root);
      }
      return;
    }
    for (let index = 0; index < body_len; index += 1) {
      const statement = body[index] as Statement;
      if (!minimal || statement.type === "FunctionDeclaration") {
        parents.set(statement, prog);
      }
      visitor(statement, root, root);
    }
  }

  function visit_full(
    current: Node,
    outer: Scope,
    function_scope: Scope,
  ): void {
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
      scopes.set(current, outer);
      return;
    }
    if (on_node !== undefined) on_node(current);
    let scope = outer;
    switch (type) {
      case "CallExpression":
        if (on_call !== undefined) on_call(current);
        break;
      case "FunctionDeclaration":
      case "TSDeclareFunction":
        if (current.id !== null) declare(current.id, current, outer, true);
        scope = { owner: current, parent: outer, bindings: undefined };
        function_scope = scope;
        if (current.id !== null) declare(current.id, current, scope, false);
        for (const parameter of current.params) {
          declare_param(parameter, scope, true);
        }
        break;
      case "FunctionExpression":
      case "TSEmptyBodyFunctionExpression":
      case "ArrowFunctionExpression":
        scope = { owner: current, parent: outer, bindings: undefined };
        function_scope = scope;
        if (current.id !== null) declare(current.id, current, scope, true);
        for (const parameter of current.params) {
          declare_param(parameter, scope, true);
        }
        break;
      case "ClassDeclaration":
        if (current.id !== null) declare(current.id, current, outer, true);
        scope = { owner: current, parent: outer, bindings: undefined };
        if (current.id !== null) declare(current.id, current, scope, false);
        break;
      case "ClassExpression":
        scope = { owner: current, parent: outer, bindings: undefined };
        if (current.id !== null) declare(current.id, current, scope, true);
        break;
      case "TSEnumDeclaration":
        declare(current.id, current, outer, true);
        scope = { owner: current, parent: outer, bindings: undefined };
        for (const member of current.body.members) {
          if (member.id.type === "Identifier") {
            set_binding(scope, member.id.name, member);
          } else if (member.id.type === "Literal") {
            set_binding(scope, member.id.value, member);
          }
        }
        break;
      case "TSImportEqualsDeclaration":
        if (current.importKind !== "type") {
          declare(current.id, current, outer, true);
        }
        break;
      case "TSModuleDeclaration":
        if (!current.global && current.id.type === "Identifier") {
          declare(current.id, current, outer, true);
        }
        break;
      case "StaticBlock":
      case "TSModuleBlock":
        scope = { owner: current, parent: outer, bindings: undefined };
        function_scope = scope;
        break;
      case "BlockStatement":
      case "SwitchStatement":
      case "ForStatement":
      case "ForOfStatement":
      case "ForInStatement":
        scope = { owner: current, parent: outer, bindings: undefined };
        break;
      case "CatchClause":
        scope = { owner: current, parent: outer, bindings: undefined };
        if (current.param !== null) {
          declare(current.param, current.param, scope, false);
        }
        break;
      case "VariableDeclaration": {
        const target = current.kind === "var" ? function_scope : scope;
        for (const declaration of current.declarations) {
          declare(declaration.id, declaration, target, true);
        }
        break;
      }
      case "ImportDeclaration":
        if (current.importKind !== "type") {
          const is_root = scope === root;
          for (const specifier of current.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.importKind === "type"
            ) continue;
            const local_name = specifier.local.name;
            set_binding(scope, local_name, current);
            if (is_root) imported_names.add(local_name);
          }
        }
        break;
    }
    scopes.set(current, scope);
    if (current === program) {
      visit_program_body(current, visit_full);
      return;
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
          parents.set(child_node, current);
          visit_full(child_node, scope, function_scope);
        }
      } else if (typeof (value as { type?: unknown }).type === "string") {
        const child_node = value as Node;
        parents.set(child_node, current);
        visit_full(child_node, scope, function_scope);
      }
    }
  }

  if (minimal) visit_minimal(program, root, root);
  else visit_full(program, root, root);

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
      if (scope === root && has_deferred_top_level) {
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

  function resolve_name_at(name: string, at: Node): Node | null {
    let scope = scopes.get(at);
    while (scope !== undefined) {
      const bindings = scope.bindings;
      if (bindings !== undefined) {
        const declaration = bindings[name];
        if (declaration !== undefined) return declaration;
      }
      if (scope === root && has_deferred_top_level) {
        flush_deferred_top_level();
        const declaration = root.bindings?.[name];
        if (declaration !== undefined) return declaration;
      }
      scope = scope.parent;
    }
    return null;
  }

  return {
    resolve,
    resolve_name_at,
    imported(identifier: Extract<Node, { type: "Identifier" }>): boolean {
      if (imported_names.size === 0) return false;
      const id_name = identifier.name;
      if (!imported_names.has(id_name)) return false;
      const root_binding = root.bindings?.[id_name];
      if (
        root_binding === undefined || root_binding.type !== "ImportDeclaration"
      ) return false;
      const cached = resolved.get(identifier);
      if (cached !== undefined) return cached?.type === "ImportDeclaration";
      let scope = scopes.get(identifier);
      if (scope === root) {
        resolved.set(identifier, root_binding);
        return true;
      }
      while (scope !== undefined) {
        if (scope === root) {
          resolved.set(identifier, root_binding);
          return true;
        }
        const bindings = scope.bindings;
        if (bindings !== undefined) {
          const declaration = bindings[id_name];
          if (declaration !== undefined) {
            resolved.set(identifier, declaration);
            return declaration.type === "ImportDeclaration";
          }
        }
        scope = scope.parent;
      }
      return false;
    },
    scope(current: Node): Node | null {
      let found = scopes.get(current);
      if (
        found === undefined && record_top_level_scopes && has_deferred_top_level
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

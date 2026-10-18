/** Historical TypeScript-only resolver for archived transformer experiments. */
import ts from "typescript";

type Scope = {
  readonly parent?: Scope;
  readonly bindings: Map<string, ts.Node>;
};

/** Lexical value bindings shared by transform passes, including TDZ shadows. */
export function create_legacy_binding_analysis(source: ts.SourceFile) {
  const scopes = new WeakMap<ts.Node, Scope>();
  const root: Scope = { bindings: new Map() };
  function declare(name: ts.BindingName, declaration: ts.Node, scope: Scope) {
    if (ts.isIdentifier(name)) scope.bindings.set(name.text, declaration);
    else {for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          declare(element.name, declaration, scope);
        }
      }}
  }
  function visit(node: ts.Node, outer: Scope, function_scope: Scope) {
    let scope = outer;
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      declare(node.name, node, outer);
    }
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      declare(node.name, node, outer);
    }
    if (ts.isEnumDeclaration(node)) declare(node.name, node, outer);
    if (ts.isImportEqualsDeclaration(node)) declare(node.name, node, outer);
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      declare(node.name, node, outer);
    }
    if (ts.isFunctionLike(node)) {
      scope = { parent: outer, bindings: new Map() };
      function_scope = scope;
      if (
        (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
        node.name !== undefined
      ) declare(node.name, node, scope);
      for (const parameter of node.parameters) {
        declare(parameter.name, parameter, scope);
      }
    } else if (
      ts.isBlock(node) || ts.isCaseBlock(node) || ts.isCatchClause(node) ||
      ts.isForStatement(node) || ts.isForOfStatement(node) ||
      ts.isForInStatement(node) || ts.isClassExpression(node)
    ) {
      scope = { parent: outer, bindings: new Map() };
      if (ts.isClassExpression(node) && node.name !== undefined) {
        declare(node.name, node, scope);
      }
    }
    scopes.set(node, scope);
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause === undefined || clause.isTypeOnly) return;
      if (clause.name !== undefined) declare(clause.name, node, scope);
      const bindings = clause.namedBindings;
      if (bindings !== undefined) {
        if (ts.isNamespaceImport(bindings)) declare(bindings.name, node, scope);
        else {for (const binding of bindings.elements) {
            if (!binding.isTypeOnly) declare(binding.name, node, scope);
          }}
      }
      return;
    }
    if (ts.isVariableDeclarationList(node)) {
      let target = function_scope;
      if ((node.flags & ts.NodeFlags.BlockScoped) !== 0) target = scope;
      for (const declaration of node.declarations) {
        declare(declaration.name, declaration, target);
      }
    }
    if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      declare(node.variableDeclaration.name, node.variableDeclaration, scope);
    }
    ts.forEachChild(node, (child) => visit(child, scope, function_scope));
  }
  visit(source, root, root);
  const resolved = new WeakMap<ts.Identifier, ts.Node | null>();
  function resolve(identifier: ts.Identifier): ts.Node | undefined {
    const cached = resolved.get(identifier);
    if (cached !== undefined) return cached ?? undefined;
    let scope = scopes.get(identifier);
    while (scope !== undefined) {
      const declaration = scope.bindings.get(identifier.text);
      if (declaration !== undefined) {
        resolved.set(identifier, declaration);
        return declaration;
      }
      scope = scope.parent;
    }
    resolved.set(identifier, null);
    return undefined;
  }
  return {
    resolve,
    imported(identifier: ts.Identifier): boolean {
      const declaration = resolve(identifier);
      return declaration !== undefined && ts.isImportDeclaration(declaration);
    },
  };
}

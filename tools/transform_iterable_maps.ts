import ts from "typescript";

const constructors = new Set([
  "IterableT",
  "from_array",
  "from_factory",
  "from_iterable",
  "filter",
  "take",
]);

/** @ignore */
export function might_contain_iterable_maps(source: string): boolean {
  return source.includes("\\u") ||
    ((source.includes("iterable") || source.includes("IterableT")) &&
      /\.\s*map\b/.test(source));
}

/** @ignore */
export function create_iterable_map_fusion(
  source: ts.SourceFile,
  library_specifiers: readonly string[] = [],
) {
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  const roots = new Set<string>();
  const root_namespaces = new Set<string>();

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (clause?.isTypeOnly || bindings === undefined) continue;
    const specifier = statement.moduleSpecifier.text;
    const module = source_module(specifier);
    const iterable = module === "iterable" ||
      /^(@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)\/iterable$/
        .test(
          specifier,
        );
    const root = module === "mod" || specifier === "@mewhhaha/typeclasses" ||
      /^jsr:@mewhhaha\/typeclasses(?:@[^/]+)?$/.test(specifier) ||
      library_specifiers.includes(specifier);
    if (!iterable && !root) continue;

    if (ts.isNamespaceImport(bindings)) {
      (iterable ? namespaces : root_namespaces).add(bindings.name.text);
    } else {
      for (const binding of bindings.elements) {
        if (binding.isTypeOnly) continue;
        const name = (binding.propertyName ?? binding.name).text;
        if (iterable && constructors.has(name)) {
          functions.add(binding.name.text);
        }
        if (root && name === "iterable") roots.add(binding.name.text);
      }
    }
  }

  const immutable = new Map<string, ts.VariableDeclaration>();
  const callbacks = new Map<string, ts.FunctionLikeDeclaration>();
  const binding_counts = new Map<string, number>();
  for (const statement of source.statements) {
    if (
      ts.isVariableStatement(statement) &&
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.initializer === undefined
        ) continue;
        immutable.set(declaration.name.text, declaration);
        const initial = unwrap(declaration.initializer);
        if (ts.isArrowFunction(initial) || ts.isFunctionExpression(initial)) {
          callbacks.set(declaration.name.text, initial);
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      callbacks.set(statement.name.text, statement);
    }
  }
  const candidates = new Set([
    ...functions,
    ...namespaces,
    ...roots,
    ...root_namespaces,
  ]);
  function remove_binding(name: ts.BindingName | ts.Identifier | undefined) {
    if (name === undefined) return;
    if (ts.isIdentifier(name)) {
      binding_counts.set(name.text, (binding_counts.get(name.text) ?? 0) + 1);
      functions.delete(name.text);
      namespaces.delete(name.text);
      roots.delete(name.text);
      root_namespaces.delete(name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) remove_binding(element.name);
    }
  }
  function visit_bindings(node: ts.Node) {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isVariableDeclaration(node) || ts.isParameter(node) ||
      ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) || ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) || ts.isImportEqualsDeclaration(node)
    ) remove_binding(node.name);
    if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name)) {
      remove_binding(node.name);
    }
    ts.forEachChild(node, visit_bindings);
  }
  if (candidates.size > 0) ts.forEachChild(source, visit_bindings);
  for (const name of immutable.keys()) {
    if (binding_counts.get(name) !== 1) immutable.delete(name);
  }
  for (const name of callbacks.keys()) {
    if (binding_counts.get(name) !== 1) callbacks.delete(name);
  }

  function mapper(expression: ts.Expression): boolean {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const callback = callbacks.get(node.text);
      if (
        callback === undefined ||
        callback.pos >= node.pos && !ts.isFunctionDeclaration(callback)
      ) return false;
      return unary_mapper(callback);
    }
    return simple_mapper(node);
  }

  function known_iterable(
    expression: ts.Expression,
    seen = new Set<string>(),
  ): boolean {
    const node = unwrap(expression);
    if (ts.isIdentifier(node)) {
      const declaration = immutable.get(node.text);
      if (
        declaration?.initializer === undefined || declaration.end >= node.pos ||
        seen.has(node.text)
      ) return false;
      seen.add(node.text);
      return known_iterable(declaration.initializer, seen);
    }
    if (!ts.isCallExpression(node) || node.questionDotToken !== undefined) {
      return false;
    }
    const callee = unwrap(node.expression);
    if (ts.isIdentifier(callee)) return functions.has(callee.text);
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.questionDotToken !== undefined
    ) return false;
    const receiver = unwrap(callee.expression);
    const method = callee.name.text;
    if (constructors.has(method)) {
      if (
        ts.isIdentifier(receiver) &&
        (namespaces.has(receiver.text) || roots.has(receiver.text))
      ) return true;
      if (
        ts.isPropertyAccessExpression(receiver) &&
        receiver.questionDotToken === undefined &&
        receiver.name.text === "iterable" &&
        ts.isIdentifier(receiver.expression) &&
        root_namespaces.has(receiver.expression.text)
      ) return true;
    }
    return (method === "map" || method === "filter" || method === "take" ||
      method === "bind") && known_iterable(receiver);
  }

  let helper: ts.Identifier | undefined;
  return {
    enabled: functions.size + namespaces.size + roots.size +
        root_namespaces.size > 0,
    fuse(
      node: ts.CallExpression,
      factory: ts.NodeFactory,
    ): ts.CallExpression | undefined {
      const maps: ts.CallExpression[] = [];
      let current: ts.Expression = node;
      while (true) {
        const call = unwrap(current);
        if (
          !ts.isCallExpression(call) || call.questionDotToken !== undefined ||
          call.typeArguments !== undefined || call.arguments.length !== 1 ||
          !ts.isPropertyAccessExpression(call.expression) ||
          call.expression.questionDotToken !== undefined ||
          call.expression.name.text !== "map" ||
          !mapper(call.arguments[0])
        ) break;
        maps.push(call);
        current = call.expression.expression;
      }
      if (maps.length < 2 || !known_iterable(current)) return undefined;
      helper ??= factory.createUniqueName("compose_iterable_maps");
      maps.reverse();
      let composed = maps[0].arguments[0];
      for (const map of maps.slice(1)) {
        composed = factory.createCallExpression(helper, undefined, [
          composed,
          map.arguments[0],
        ]);
      }
      // Keep the original arrows in their lexical scope, evaluating them once
      // at construction. Their unary calls retain the lazy per-item order.
      return factory.updateCallExpression(
        maps[0],
        maps[0].expression,
        undefined,
        [composed],
      );
    },
    add_helper(file: ts.SourceFile, factory: ts.NodeFactory): ts.SourceFile {
      if (helper === undefined) return file;
      return factory.updateSourceFile(file, [
        ...file.statements,
        compose_helper(helper, factory),
      ]);
    },
  };
}

function unwrap(expression: ts.Expression): ts.Expression {
  let node = expression;
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}

function simple_mapper(expression: ts.Expression): boolean {
  const node = unwrap(expression);
  if (!ts.isArrowFunction(node)) return false;
  return unary_mapper(node);
}

function unary_mapper(node: ts.FunctionLikeDeclaration): boolean {
  if (
    node.typeParameters !== undefined || node.modifiers !== undefined ||
    node.parameters.length !== 1 ||
    (ts.isFunctionExpression(node) && node.asteriskToken !== undefined) ||
    (ts.isFunctionDeclaration(node) && node.asteriskToken !== undefined)
  ) return false;
  const parameter = node.parameters[0];
  return ts.isIdentifier(parameter.name) &&
    parameter.dotDotDotToken === undefined &&
    parameter.initializer === undefined &&
    parameter.questionToken === undefined;
}

function source_module(specifier: string): string | undefined {
  if (/^(?:\.\.?\/)+src\/(iterable|mod)(?:\.ts)?$/.test(specifier)) {
    return specifier.match(/(iterable|mod)(?:\.ts)?$/)?.[1];
  }
  for (const module of ["iterable", "mod"]) {
    try {
      const url = new URL(`../src/${module}.ts`, import.meta.url);
      if (specifier === url.href || specifier === url.pathname) return module;
    } catch {
      // Bundled tools can still recognize package and relative imports.
    }
  }
  return undefined;
}

function compose_helper(
  name: ts.Identifier,
  factory: ts.NodeFactory,
): ts.FunctionDeclaration {
  const type = (name: string) => factory.createTypeReferenceNode(name);
  const unary = (input: string, output: string) =>
    factory.createFunctionTypeNode(undefined, [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        "value",
        undefined,
        type(input),
      ),
    ], type(output));
  return factory.createFunctionDeclaration(
    undefined,
    undefined,
    name,
    ["from", "middle", "to"].map((name) =>
      factory.createTypeParameterDeclaration(undefined, name)
    ),
    [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        "first",
        undefined,
        unary("from", "middle"),
      ),
      factory.createParameterDeclaration(
        undefined,
        undefined,
        "second",
        undefined,
        unary("middle", "to"),
      ),
    ],
    unary("from", "to"),
    factory.createBlock([
      factory.createReturnStatement(factory.createArrowFunction(
        undefined,
        undefined,
        [factory.createParameterDeclaration(undefined, undefined, "value")],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createCallExpression(
          factory.createIdentifier("second"),
          undefined,
          [
            factory.createCallExpression(
              factory.createIdentifier("first"),
              undefined,
              [
                factory.createIdentifier("value"),
              ],
            ),
          ],
        ),
      )),
    ], true),
  );
}

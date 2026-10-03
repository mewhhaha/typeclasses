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

  const candidates = new Set([
    ...functions,
    ...namespaces,
    ...roots,
    ...root_namespaces,
  ]);
  function remove_binding(name: ts.BindingName | ts.Identifier | undefined) {
    if (name === undefined) return;
    if (ts.isIdentifier(name)) {
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

  function known_iterable(expression: ts.Expression): boolean {
    const node = unwrap(expression);
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
          !simple_mapper(call.arguments[0])
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
  if (
    !ts.isArrowFunction(node) || ts.isBlock(node.body) ||
    node.typeParameters !== undefined || node.modifiers !== undefined ||
    node.parameters.length !== 1
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

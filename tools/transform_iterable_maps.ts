import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Function,
  IdentifierReference,
  Node,
  Program,
  StaticMemberExpression,
  TSType,
  VariableDeclarator,
} from "oxc-parser";
import {
  arrow,
  block,
  call,
  id,
  node,
  parameter,
  ret,
  type_ref,
  unwrap,
  walk,
} from "./transform_ast.ts";
import { create_binding_analysis } from "./transform_bindings.ts";

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
  program: Program,
  library_specifiers: readonly string[] = [],
  analysis?: ReturnType<typeof create_binding_analysis>,
  fresh?: (name: string) => string,
) {
  const functions = new Set<string>();
  const namespaces = new Set<string>();
  const roots = new Set<string>();
  const root_namespaces = new Set<string>();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" || statement.importKind === "type"
    ) continue;
    const specifier = statement.source.value;
    const module = source_module(specifier);
    const iterable = module === "iterable" ||
      /^(@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)\/iterable$/
        .test(specifier);
    const root = module === "mod" || specifier === "@mewhhaha/typeclasses" ||
      /^jsr:@mewhhaha\/typeclasses(?:@[^/]+)?$/.test(specifier) ||
      library_specifiers.includes(specifier);
    if (!iterable && !root) continue;
    for (const binding of statement.specifiers) {
      if (binding.type === "ImportNamespaceSpecifier") {
        if (iterable) namespaces.add(binding.local.name);
        else root_namespaces.add(binding.local.name);
      } else if (
        binding.type === "ImportSpecifier" && binding.importKind !== "type"
      ) {
        let name: string;
        if (binding.imported.type === "Identifier") {
          name = binding.imported.name;
        } else name = binding.imported.value;
        if (iterable && constructors.has(name)) {
          functions.add(binding.local.name);
        }
        if (root && name === "iterable") roots.add(binding.local.name);
      }
    }
  }

  const bindings = analysis ?? create_binding_analysis(program);
  const immutable = new Set<VariableDeclarator>();
  const callbacks = new Map<Node, Function | ArrowFunctionExpression>();
  const writes = new Set<Node>();
  const used_names = new Set<string>();
  walk(program, (current) => {
    if (current.type === "Identifier") used_names.add(current.name);
    if (current.type === "VariableDeclaration" && current.kind === "const") {
      for (const declaration of current.declarations) {
        if (declaration.id.type !== "Identifier" || declaration.init === null) {
          continue;
        }
        immutable.add(declaration);
        const initial = unwrap(declaration.init);
        if (
          initial.type === "ArrowFunctionExpression" ||
          initial.type === "FunctionExpression"
        ) callbacks.set(declaration, initial);
      }
    }
    if (current.type === "FunctionDeclaration" && current.id !== null) {
      callbacks.set(current, current);
    }
    if (current.type === "AssignmentExpression") mark_write(current.left);
    if (current.type === "UpdateExpression") mark_write(current.argument);
    if (
      (current.type === "ForOfStatement" ||
        current.type === "ForInStatement") &&
      current.left.type !== "VariableDeclaration"
    ) mark_write(current.left);
  });
  function mark_write(target: Node): void {
    if (target.type === "Identifier") {
      const declaration = bindings.resolve(target);
      if (declaration !== null) writes.add(declaration);
    } else if (
      target.type === "ObjectPattern" || target.type === "ArrayPattern" ||
      target.type === "AssignmentPattern" || target.type === "RestElement"
    ) {
      walk(target, (child) => {
        if (child.type === "MemberExpression") return false;
        if (child.type === "Identifier") {
          const declaration = bindings.resolve(child);
          if (declaration !== null) writes.add(declaration);
        }
      });
    }
  }

  function mapper(expression: Expression): boolean {
    const current = unwrap(expression);
    if (current.type !== "Identifier") {
      return current.type === "ArrowFunctionExpression" &&
        unary_mapper(current);
    }
    const declaration = bindings.resolve(current);
    if (declaration === null || writes.has(declaration)) return false;
    const callback = callbacks.get(declaration);
    if (callback === undefined) return false;
    let owner: Node = declaration;
    if (declaration.type === "FunctionDeclaration") {
      owner = bindings.parent(declaration) ?? declaration;
    }
    if (bindings.scope(current) !== bindings.scope(owner)) return false;
    if (
      declaration.type !== "FunctionDeclaration" &&
      declaration.end >= current.start
    ) return false;
    return unary_mapper(callback);
  }

  function known_iterable(
    expression: Expression,
    seen = new Set<Node>(),
  ): boolean {
    const current = unwrap(expression);
    if (current.type === "Identifier") {
      const declaration = bindings.resolve(current);
      if (
        declaration === null || declaration.type !== "VariableDeclarator" ||
        declaration.init === null || !immutable.has(declaration) ||
        writes.has(declaration) || declaration.end >= current.start ||
        seen.has(declaration) ||
        bindings.scope(current) !== bindings.scope(declaration)
      ) return false;
      seen.add(declaration);
      return known_iterable(declaration.init, seen);
    }
    if (current.type !== "CallExpression" || current.optional) return false;
    const callee = unwrap(current.callee);
    if (callee.type === "Identifier") {
      return functions.has(callee.name) && bindings.imported(callee);
    }
    if (!static_member(callee)) return false;
    const receiver = unwrap(callee.object);
    const method = callee.property.name;
    if (constructors.has(method)) {
      if (
        receiver.type === "Identifier" &&
        (namespaces.has(receiver.name) || roots.has(receiver.name)) &&
        bindings.imported(receiver)
      ) return true;
      if (
        static_member(receiver) && receiver.property.name === "iterable" &&
        receiver.object.type === "Identifier" &&
        root_namespaces.has(receiver.object.name) &&
        bindings.imported(receiver.object)
      ) return true;
    }
    return (method === "map" || method === "filter" || method === "take" ||
      method === "bind") && known_iterable(receiver, seen);
  }

  let helper: IdentifierReference | undefined;
  return {
    enabled:
      functions.size + namespaces.size + roots.size + root_namespaces.size > 0,
    fuse(current: CallExpression): Expression | undefined {
      const maps: CallExpression[] = [];
      let expression: Expression = current;
      while (true) {
        const candidate = unwrap(expression);
        if (
          candidate.type !== "CallExpression" || candidate.optional ||
          candidate.typeArguments != null || candidate.arguments.length !== 1 ||
          !static_member(candidate.callee) ||
          candidate.callee.property.name !== "map" ||
          candidate.arguments[0].type === "SpreadElement" ||
          !mapper(candidate.arguments[0])
        ) break;
        maps.push(candidate);
        expression = candidate.callee.object;
      }
      if (maps.length < 2 || !known_iterable(expression)) return undefined;
      if (helper === undefined) {
        let name = "compose_iterable_maps";
        if (fresh !== undefined) name = fresh(name);
        else {
          let suffix = 1;
          while (used_names.has(name)) {
            name = `compose_iterable_maps_${suffix++}`;
          }
          used_names.add(name);
        }
        helper = id(name);
      }
      maps.reverse();
      let composed = maps[0].arguments[0] as Expression;
      for (const map of maps.slice(1)) {
        composed = call(helper, [composed, map.arguments[0] as Expression]);
      }
      return call(maps[0].callee, [composed]);
    },
    add_helper(file: Program): Program {
      if (helper === undefined) return file;
      return { ...file, body: [...file.body, compose_helper(helper)] };
    },
  };
}

function static_member(
  expression: Expression,
): expression is StaticMemberExpression {
  return expression.type === "MemberExpression" && !expression.optional &&
    !expression.computed && expression.property.type === "Identifier";
}

function unary_mapper(current: Function | ArrowFunctionExpression): boolean {
  if (
    current.typeParameters != null || current.async || current.generator ||
    current.params.length !== 1
  ) return false;
  const parameter = current.params[0];
  return parameter.type === "Identifier" && !parameter.optional &&
    (parameter.decorators === undefined || parameter.decorators.length === 0);
}

function source_module(specifier: string): string | undefined {
  if (/^(?:\.\.?\/)+src\/(iterable|mod)(?:\.ts)?$/.test(specifier)) {
    return specifier.match(/(iterable|mod)(?:\.ts)?$/)?.[1];
  }
  for (const module of ["iterable", "mod"]) {
    try {
      const url = new URL(`../src/${module}.ts`, import.meta.url);
      if (specifier === url.href || specifier === url.pathname) return module;
    } catch { /* Bundles still recognize package and relative imports. */ }
  }
  return undefined;
}

function compose_helper(name: IdentifierReference): Function {
  function unary(input: string, output: string): TSType {
    return node({
      type: "TSFunctionType",
      typeParameters: null,
      params: [parameter("value", type_ref(input))],
      returnType: node({
        type: "TSTypeAnnotation",
        typeAnnotation: type_ref(output),
      }),
    });
  }
  return node({
    type: "FunctionDeclaration",
    id: name,
    async: false,
    generator: false,
    expression: false,
    typeParameters: node({
      type: "TSTypeParameterDeclaration",
      params: ["from", "middle", "to"].map((name) =>
        node({
          type: "TSTypeParameter",
          name: id(name),
          constraint: null,
          default: null,
          in: false,
          out: false,
          const: false,
        })
      ),
    }),
    params: [
      parameter("first", unary("from", "middle")),
      parameter("second", unary("middle", "to")),
    ],
    returnType: node({
      type: "TSTypeAnnotation",
      typeAnnotation: unary("from", "to"),
    }),
    body: block([
      ret(
        arrow(
          [parameter("value")],
          call(id("second"), [call(id("first"), [id("value")])]),
        ),
      ),
    ]),
  });
}

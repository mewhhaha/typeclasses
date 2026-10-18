import { parseSync } from "oxc-parser";
import type { BindingPattern, Expression, Node, Program } from "oxc-parser";
import { walk } from "./transform_ast.ts";

const package_root = new URL("../", import.meta.url);
const source_root = new URL("../src/", import.meta.url);
const forbidden_core_globals = new Set(["Bun", "Deno", "process", "require"]);
const runtime_capability_modules = new Map([
  ["DisposableStack", "src/parallel.ts"],
  ["Worker", "src/parallel.ts"],
  ["navigator", "src/parallel.ts"],
  ["self", "src/parallel.ts"],
]);
const type_nodes = new Set([
  "TSArrayType",
  "TSConditionalType",
  "TSConstructorType",
  "TSFunctionType",
  "TSImportType",
  "TSIndexedAccessType",
  "TSInferType",
  "TSIntersectionType",
  "TSLiteralType",
  "TSMappedType",
  "TSNamedTupleMember",
  "TSTemplateLiteralType",
  "TSThisType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
  "TSUnionType",
  "TSParenthesizedType",
  "TSInterfaceHeritage",
  "TSClassImplements",
  "JSDocNullableType",
  "JSDocNonNullableType",
  "JSDocUnknownType",
]);

if (import.meta.main) {
  const published_sources = [
    ...await collect_typescript_sources(source_root),
    new URL("transform_ast.ts", import.meta.url),
    new URL("transform_bindings.ts", import.meta.url),
    new URL("transform_context.ts", import.meta.url),
    new URL("transform_do_program.ts", import.meta.url),
    new URL("transform_generator.ts", import.meta.url),
    new URL("transform_imports.ts", import.meta.url),
    new URL("transform_iterable_maps.ts", import.meta.url),
    new URL("transform_plugin.ts", import.meta.url),
    new URL("transform_terminals.ts", import.meta.url),
  ];
  const violations: string[] = [];
  for (const source_url of published_sources) {
    violations.push(
      ...check_portability_source(
        await Deno.readTextFile(source_url),
        source_path(source_url),
      ),
    );
  }
  if (violations.length > 0) {
    throw new Error(
      "Published source is not portable:\n" + violations.join("\n"),
    );
  }
}

/** Inspect syntax used by the published portable entrypoints. */
export function check_portability_source(
  source: string,
  path: string,
): string[] {
  const parsed = parseSync(path, source);
  const program = parsed.program;
  const declared_names = collect_declared_names(program);
  const violations: string[] = [];
  const type_context = new WeakSet<Node>();
  const line_starts = [0];
  for (let index = 0; index < source.length; index++) {
    const character = source.charCodeAt(index);
    if (character === 13) {
      if (source.charCodeAt(index + 1) === 10) index++;
      line_starts.push(index + 1);
    } else if (
      character === 10 || character === 0x2028 || character === 0x2029
    ) {
      line_starts.push(index + 1);
    }
  }
  function add(position: number, message: string): void {
    let line = 0;
    while (line + 1 < line_starts.length && line_starts[line + 1] <= position) {
      line++;
    }
    violations.push(
      `${path}:${line + 1}:${position - line_starts[line] + 1}: ${message}`,
    );
  }
  for (const diagnostic of parsed.errors) {
    add(
      diagnostic.labels[0]?.start ?? 0,
      "TypeScript parse error: " + diagnostic.message,
    );
  }
  walk(program, (current, parent) => {
    if (
      type_nodes.has(current.type) || current.type.endsWith("Keyword") ||
      (parent !== undefined && type_context.has(parent))
    ) type_context.add(current);
    if (path.startsWith("src/") && current.type === "TSParameterProperty") {
      add(
        current.start,
        "constructor parameter properties are unsupported by Node strip-only mode",
      );
    }
    if (current.type === "TSTypeParameter" && current.name.name === "out") {
      add(
        current.name.start,
        'type parameter "out" is rejected by esbuild and Bun; use "output"',
      );
    }
    if (!path.startsWith("src/")) return;
    if (
      (current.type === "ImportDeclaration" ||
        current.type === "ExportNamedDeclaration" ||
        current.type === "ExportAllDeclaration") && current.source != null
    ) check_import(current.source);
    if (current.type === "ImportExpression") check_import(current.source);
    if (
      current.type !== "Identifier" || type_context.has(current) ||
      declared_names.has(current.name) ||
      !is_runtime_value_reference(current, parent)
    ) return;
    if (forbidden_core_globals.has(current.name)) {
      add(
        current.start,
        `core source directly references the ${current.name} runtime global`,
      );
    }
    const capability_module = runtime_capability_modules.get(current.name);
    if (capability_module !== undefined && capability_module !== path) {
      add(
        current.start,
        `${current.name} is a runtime capability reserved for ${capability_module}`,
      );
    }
  });
  function check_import(expression: Expression): void {
    const specifier = module_specifier(expression);
    if (specifier !== undefined && !is_relative_specifier(specifier)) {
      add(
        expression.start,
        `core source imports runtime dependency ${JSON.stringify(specifier)}`,
      );
    }
  }
  return violations;
}

async function collect_typescript_sources(directory: URL): Promise<URL[]> {
  const sources: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    let name = entry.name;
    if (entry.isDirectory) name += "/";
    const url = new URL(name, directory);
    if (entry.isDirectory) {
      sources.push(...await collect_typescript_sources(url));
      continue;
    }
    if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) sources.push(url);
  }
  return sources.sort((left, right) =>
    left.pathname.localeCompare(right.pathname)
  );
}

function collect_declared_names(program: Program): Set<string> {
  const names = new Set<string>();
  walk(program, (current) => {
    if (current.type === "VariableDeclarator") {
      collect_binding_names(current.id, names);
    }
    if (
      (current.type === "FunctionDeclaration" ||
        current.type === "TSDeclareFunction" ||
        current.type === "ClassDeclaration") && current.id !== null
    ) collect_binding_names(current.id, names);
    if (
      current.type === "ImportSpecifier" ||
      current.type === "ImportDefaultSpecifier" ||
      current.type === "ImportNamespaceSpecifier"
    ) collect_binding_names(current.local, names);
    if (current.type === "CatchClause" && current.param !== null) {
      collect_binding_names(current.param, names);
    }
    if ("params" in current) {
      for (const parameter of current.params) {
        if (parameter.type === "TSParameterProperty") {
          collect_binding_names(parameter.parameter, names);
        } else if (parameter.type === "RestElement") {
          collect_binding_names(parameter.argument, names);
        } else if (
          parameter.type === "Identifier" ||
          parameter.type === "ObjectPattern" ||
          parameter.type === "ArrayPattern" ||
          parameter.type === "AssignmentPattern"
        ) collect_binding_names(parameter, names);
      }
    }
    if (current.type === "TSIndexSignature") {
      for (const parameter of current.parameters) names.add(parameter.name);
    }
  });
  return names;
}

function collect_binding_names(
  pattern: BindingPattern,
  names: Set<string>,
): void {
  switch (pattern.type) {
    case "Identifier":
      names.add(pattern.name);
      return;
    case "AssignmentPattern":
      collect_binding_names(pattern.left, names);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          collect_binding_names(property.argument, names);
        } else collect_binding_names(property.value, names);
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements) {
        if (element === null) continue;
        if (element.type === "RestElement") {
          collect_binding_names(element.argument, names);
        } else collect_binding_names(element, names);
      }
  }
}

function is_runtime_value_reference(
  identifier: Extract<Node, { type: "Identifier" }>,
  parent: Node | undefined,
): boolean {
  if (parent === undefined) return true;
  if (
    parent.type === "MemberExpression" && !parent.computed &&
    parent.property === identifier
  ) return false;
  if (
    parent.type === "Property" && !parent.computed && parent.key === identifier
  ) return false;
  if (
    (parent.type === "PropertyDefinition" ||
      parent.type === "TSAbstractPropertyDefinition" ||
      parent.type === "AccessorProperty" ||
      parent.type === "TSPropertySignature") &&
    !parent.computed && parent.key === identifier
  ) return false;
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "TSAbstractMethodDefinition") &&
    parent.kind === "method" && !parent.computed && parent.key === identifier
  ) return false;
  return true;
}

function module_specifier(expression: Expression): string | undefined {
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }
  if (
    expression.type === "TemplateLiteral" && expression.expressions.length === 0
  ) return expression.quasis[0].value.cooked ?? undefined;
  return undefined;
}

function is_relative_specifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function source_path(source_url: URL): string {
  return decodeURIComponent(
    source_url.pathname.slice(package_root.pathname.length),
  );
}

import ts from "typescript";

const package_root = new URL("../", import.meta.url);
const source_root = new URL("../src/", import.meta.url);
const published_sources = [
  ...await collect_typescript_sources(source_root),
  new URL("transform_do_program.ts", import.meta.url),
  new URL("transform_plugin.ts", import.meta.url),
];
const forbidden_core_globals = new Set(["Bun", "Deno", "process", "require"]);
const runtime_capability_modules = new Map([
  ["DisposableStack", "src/parallel.ts"],
  ["Worker", "src/parallel.ts"],
  ["navigator", "src/parallel.ts"],
  ["self", "src/parallel.ts"],
]);
const violations: string[] = [];

for (const source_url of published_sources) {
  await check_source(source_url);
}

if (violations.length > 0) {
  throw new Error(
    "Published source is not portable:\n" + violations.join("\n"),
  );
}

async function check_source(source_url: URL): Promise<void> {
  const source = await Deno.readTextFile(source_url);
  const path = source_path(source_url);
  const source_file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declared_names = collect_declared_names(source_file);

  const parse_diagnostics = (source_file as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
  }).parseDiagnostics ?? [];

  for (const diagnostic of parse_diagnostics) {
    const start = diagnostic.start ?? 0;
    add_violation(
      source_file,
      start,
      "TypeScript parse error: " + ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        " ",
      ),
    );
  }

  visit(source_file);

  function visit(node: ts.Node): void {
    if (ts.isTypeParameterDeclaration(node) && node.name.text === "out") {
      add_violation(
        source_file,
        node.name.getStart(source_file),
        'type parameter "out" is rejected by esbuild and Bun; use "output"',
      );
    }

    if (
      path.startsWith("src/") &&
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined
    ) {
      const specifier = module_specifier(node.moduleSpecifier);

      if (specifier !== undefined && !is_relative_specifier(specifier)) {
        add_violation(
          source_file,
          node.moduleSpecifier.getStart(source_file),
          `core source imports runtime dependency ${JSON.stringify(specifier)}`,
        );
      }
    }

    if (path.startsWith("src/") && ts.isCallExpression(node)) {
      const [specifier_node] = node.arguments;

      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        specifier_node !== undefined
      ) {
        const specifier = module_specifier(specifier_node);

        if (specifier !== undefined && !is_relative_specifier(specifier)) {
          add_violation(
            source_file,
            specifier_node.getStart(source_file),
            `core source imports runtime dependency ${
              JSON.stringify(specifier)
            }`,
          );
        }
      }
    }

    if (
      path.startsWith("src/") && ts.isIdentifier(node) &&
      is_runtime_value_reference(node) && !declared_names.has(node.text)
    ) {
      if (forbidden_core_globals.has(node.text)) {
        add_violation(
          source_file,
          node.getStart(source_file),
          `core source directly references the ${node.text} runtime global`,
        );
      }

      const capability_module = runtime_capability_modules.get(node.text);

      if (capability_module !== undefined && capability_module !== path) {
        add_violation(
          source_file,
          node.getStart(source_file),
          `${node.text} is a runtime capability reserved for ${capability_module}`,
        );
      }
    }

    ts.forEachChild(node, visit);
  }
}

async function collect_typescript_sources(directory: URL): Promise<URL[]> {
  const sources: URL[] = [];

  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);

    if (entry.isDirectory) {
      sources.push(...await collect_typescript_sources(url));
      continue;
    }

    if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      sources.push(url);
    }
  }

  return sources.sort((left, right) =>
    left.pathname.localeCompare(right.pathname)
  );
}

function collect_declared_names(source_file: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  visit(source_file);
  return names;

  function visit(node: ts.Node): void {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
        ts.isImportClause(node) || ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node)) && node.name !== undefined
    ) {
      collect_binding_names(node.name, names);
    }

    ts.forEachChild(node, visit);
  }
}

function collect_binding_names(
  name: ts.BindingName | ts.Identifier,
  names: Set<string>,
): void {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collect_binding_names(element.name, names);
    }
  }
}

function is_runtime_value_reference(identifier: ts.Identifier): boolean {
  let current: ts.Node | undefined = identifier;

  while (current !== undefined) {
    if (ts.isTypeNode(current)) {
      return false;
    }

    current = current.parent;
  }

  const parent = identifier.parent;

  if (
    ts.isPropertyAccessExpression(parent) && parent.name === identifier ||
    ts.isPropertyAssignment(parent) && parent.name === identifier ||
    ts.isMethodDeclaration(parent) && parent.name === identifier ||
    ts.isPropertyDeclaration(parent) && parent.name === identifier ||
    ts.isPropertySignature(parent) && parent.name === identifier
  ) {
    return false;
  }

  return true;
}

function module_specifier(node: ts.Expression): string | undefined {
  return ts.isStringLiteralLike(node) ? node.text : undefined;
}

function is_relative_specifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function add_violation(
  source_file: ts.SourceFile,
  position: number,
  message: string,
): void {
  const location = source_file.getLineAndCharacterOfPosition(position);
  violations.push(
    source_file.fileName + ":" + String(location.line + 1) + ":" +
      String(location.character + 1) + ": " + message,
  );
}

function source_path(source_url: URL): string {
  return decodeURIComponent(
    source_url.pathname.slice(package_root.pathname.length),
  );
}

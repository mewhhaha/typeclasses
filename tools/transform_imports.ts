import type {
  BindingPattern,
  CallExpression,
  Expression,
  ImportDeclaration,
  Node,
  Program,
} from "oxc-parser";
import { unwrap, walk } from "./transform_ast.ts";
import type {
  ImportedBindings,
  PrimitiveFunctionName,
  TerminalFunctionName,
  TransformConfig,
  TransformKind,
} from "./transform_context.ts";

const terminals = new Set<TerminalFunctionName>([
  "run",
  "run_reader",
  "run_state",
  "run_writer",
]);
const primitives = new Set<PrimitiveFunctionName>([
  "ask",
  "asks",
  "get",
  "gets",
  "put",
  "modify",
  "writer",
  "tell",
]);
const source_specifiers = new Map<string, string>();
for (
  const name of ["effects", "mod", "reader", "state", "typeclasses", "writer"]
) {
  try {
    const url = new URL(`../src/${name}.ts`, import.meta.url);
    source_specifiers.set(url.href, name);
    source_specifiers.set(url.pathname, name);
  } catch { /* Bundled data URLs use package or relative matches. */ }
}

function source_module(specifier: string): string | undefined {
  return source_specifiers.get(specifier) ??
    specifier.match(/^(?:\.\.?\/)+src\/(\w+)(?:\.ts)?$/)?.[1];
}
function package_module(specifier: string): string | undefined {
  const match = /^(?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?(?:\/(\w+))?\/?$/
    .exec(specifier);
  if (match === null) return undefined;
  return match[1] ?? "mod";
}
function library(specifier: string, config: TransformConfig): boolean {
  if (config.library_specifiers?.includes(specifier)) return true;
  if (/^(?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?(?:\/.*)?$/.test(specifier)) {
    return true;
  }
  return ["mod", "effects", "typeclasses"].includes(
    source_module(specifier) ?? "",
  );
}
function terminal_exports(
  specifier: string,
  config: TransformConfig,
): ReadonlySet<TerminalFunctionName> | undefined {
  if (config.terminal_library_specifiers?.includes(specifier)) return terminals;
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
      return terminals;
    case "effects":
      return new Set(["run"]);
    case "reader":
      return new Set(["run_reader"]);
    case "state":
      return new Set(["run_state"]);
    case "writer":
      return new Set(["run_writer"]);
  }
}
function primitive_exports(
  specifier: string,
): ReadonlySet<PrimitiveFunctionName> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
      return primitives;
    case "reader":
      return new Set(["ask", "asks"]);
    case "state":
      return new Set(["get", "gets", "put", "modify"]);
    case "writer":
      return new Set(["writer", "tell"]);
  }
}

function import_name(
  binding: ImportDeclaration["specifiers"][number],
): string | undefined {
  if (binding.type !== "ImportSpecifier") return undefined;
  if (binding.imported.type === "Identifier") return binding.imported.name;
  return binding.imported.value;
}

/** Import recognition is deliberately limited to the package's declared surfaces. */
export function collect_imports(
  program: Program,
  source: string,
  config: TransformConfig,
): ImportedBindings {
  const do_names = new Set<string>();
  const program_names = new Set<string>();
  const effect_names = new Set<string>();
  const namespaces = new Set<string>();
  const terminal_functions = new Map<
    string,
    { imported: TerminalFunctionName }
  >();
  const terminal_namespaces = new Map<
    string,
    ReadonlySet<TerminalFunctionName>
  >();
  const primitive_functions = new Map<string, PrimitiveFunctionName>();
  const primitive_namespaces = new Map<
    string,
    ReadonlySet<PrimitiveFunctionName>
  >();
  let program_module: string | undefined;
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" || statement.importKind === "type"
    ) continue;
    const specifier = statement.source.value;
    const available_terminals = terminal_exports(specifier, config);
    const available_primitives = primitive_exports(specifier);
    const is_library = library(specifier, config);
    for (const binding of statement.specifiers) {
      const local = binding.local.name;
      if (binding.type === "ImportNamespaceSpecifier") {
        if (available_terminals !== undefined) {
          terminal_namespaces.set(local, available_terminals);
        }
        if (available_primitives !== undefined) {
          primitive_namespaces.set(local, available_primitives);
        }
        if (is_library) {
          namespaces.add(local);
          program_module ??= specifier;
        }
        continue;
      }
      if (binding.type !== "ImportSpecifier" || binding.importKind === "type") {
        continue;
      }
      const imported = import_name(binding)!;
      if (available_terminals?.has(imported as TerminalFunctionName)) {
        terminal_functions.set(local, {
          imported: imported as TerminalFunctionName,
        });
      }
      if (available_primitives?.has(imported as PrimitiveFunctionName)) {
        primitive_functions.set(local, imported as PrimitiveFunctionName);
      }
      if (!is_library) continue;
      switch (imported) {
        case "Do":
          do_names.add(local);
          break;
        case "Program":
          program_names.add(local);
          program_module ??= specifier;
          break;
        case "Effect":
          effect_names.add(local);
          break;
      }
    }
  }
  const candidates = new Set([
    ...do_names,
    ...program_names,
    ...effect_names,
    ...namespaces,
    ...terminal_functions.keys(),
    ...terminal_namespaces.keys(),
    ...primitive_functions.keys(),
    ...primitive_namespaces.keys(),
  ]);
  for (const name of non_import_bindings(program, candidates).keys()) {
    do_names.delete(name);
    program_names.delete(name);
    effect_names.delete(name);
    namespaces.delete(name);
    terminal_functions.delete(name);
    terminal_namespaces.delete(name);
    primitive_functions.delete(name);
    primitive_namespaces.delete(name);
  }
  return {
    do_names,
    program_names,
    effect_names,
    namespaces,
    terminal_functions,
    terminal_namespaces,
    primitive_functions,
    primitive_namespaces,
    program_module,
    effect_helper_shadowed: (program_names.size > 0 || namespaces.size > 0) &&
      source.includes("Effect") &&
      non_import_bindings(program, new Set(["Effect"])).has("Effect"),
  };
}

function names(
  pattern: BindingPattern | Node | null,
  add: (name: string) => void,
): void {
  if (pattern === null) return;
  switch (pattern.type) {
    case "Identifier":
      add(pattern.name);
      break;
    case "AssignmentPattern":
      names(pattern.left, add);
      break;
    case "RestElement":
      names(pattern.argument, add);
      break;
    case "ObjectPattern":
      for (const property of pattern.properties) {
        if (property.type === "RestElement") names(property.argument, add);
        else names(property.value, add);
      }
      break;
    case "ArrayPattern":
      for (const element of pattern.elements) names(element, add);
      break;
  }
}

function non_import_bindings(
  program: Program,
  candidates: ReadonlySet<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: string) => {
    if (candidates.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  walk(program, (current) => {
    switch (current.type) {
      case "ImportDeclaration":
        return false;
      case "VariableDeclarator":
        names(current.id, add);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
        names(current.id, add);
        for (const parameter of current.params) names(parameter, add);
        break;
      case "ArrowFunctionExpression":
        for (const parameter of current.params) names(parameter, add);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
      case "TSEnumDeclaration":
      case "TSImportEqualsDeclaration":
      case "TSModuleDeclaration":
        names(current.id, add);
        break;
    }
  });
  return counts;
}

/** Match only names anchored to recognized imports. */
export function imported_target(
  expression: Expression,
  target: "Do" | "Program" | "Effect",
  imports: ImportedBindings,
): boolean {
  const value = unwrap(expression);
  if (value.type === "Identifier") {
    switch (target) {
      case "Do":
        return imports.do_names.has(value.name);
      case "Program":
        return imports.program_names.has(value.name);
      case "Effect":
        return imports.effect_names.has(value.name);
    }
  }
  return value.type === "MemberExpression" && !value.computed &&
    value.property.type === "Identifier" &&
    value.property.name === target && value.object.type === "Identifier" &&
    imports.namespaces.has(value.object.name);
}

/** Recognize safe top-level Program.scope aliases, including TDZ barriers. */
export function collect_program_scopes(
  program: Program,
  imports: ImportedBindings,
): ReadonlySet<string> {
  const scopes = new Set(imports.program_names);
  const declarations = new Map<string, number>();
  for (let statement of program.body) {
    if (
      statement.type === "ExportNamedDeclaration" &&
      statement.declaration !== null
    ) statement = statement.declaration;
    if (
      statement.type !== "VariableDeclaration" || statement.kind !== "const"
    ) continue;
    for (const declaration of statement.declarations) {
      const expression = declaration.init;
      if (
        declaration.id.type !== "Identifier" ||
        expression?.type !== "CallExpression"
      ) continue;
      const callee = expression.callee;
      if (
        callee.type !== "MemberExpression" || callee.computed ||
        callee.property.type !== "Identifier" ||
        callee.property.name !== "scope"
      ) continue;
      if (!imported_target(callee.object, "Program", imports)) continue;
      scopes.add(declaration.id.name);
      declarations.set(declaration.id.name, declaration.end);
    }
  }
  const aliases = new Set(declarations.keys());
  const counts = non_import_bindings(program, aliases);
  walk(program, (current) => {
    if (
      current.type !== "CallExpression" || current.callee.type !== "Identifier"
    ) return;
    const end = declarations.get(current.callee.name);
    if (end !== undefined && current.start < end) {
      scopes.delete(current.callee.name);
    }
  });
  for (const name of aliases) if (counts.get(name) !== 1) scopes.delete(name);
  return scopes;
}

/** Classify generator calls after import and alias validation. */
export function generator_kind(
  call: CallExpression,
  scopes: ReadonlySet<string>,
  imports: ImportedBindings,
): TransformKind | undefined {
  if (imported_target(call.callee, "Do", imports)) return "do";
  if (call.callee.type === "Identifier" && scopes.has(call.callee.name)) {
    return "program";
  }
  if (imported_target(call.callee, "Program", imports)) return "program";
}

/** Only imported built-ins are proof of a supported MonadRec implementation. */
export function collect_loop_support(program: Program) {
  const dictionaries = new Set<string>();
  const tasks = new Set<string>();
  let specifier: string | undefined;
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" || statement.importKind === "type"
    ) continue;
    const module = statement.source.value;
    if (/^(?:\.\.?\/)+src\/(?:mod|typeclasses)\.ts$/.test(module)) {
      specifier = module.replace(/(?:typeclasses|mod)\.ts$/, "loop.ts");
    }
    if (
      /^(?:@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)$/.test(
        module,
      )
    ) specifier = module + "/loop";
    const kind = package_module(module) ?? source_module(module);
    if (kind === undefined) continue;
    for (const binding of statement.specifiers) {
      if (binding.type !== "ImportSpecifier" || binding.importKind === "type") {
        continue;
      }
      const imported = import_name(binding)!;
      if (
        ["Maybe", "Either", "Identity", "Task"].includes(imported) &&
        (kind === "mod" || kind === imported.toLowerCase())
      ) {
        dictionaries.add(binding.local.name);
        if (imported === "Task") tasks.add(binding.local.name);
      }
    }
  }
  for (const name of non_import_bindings(program, dictionaries).keys()) {
    dictionaries.delete(name);
    tasks.delete(name);
  }
  if (specifier === undefined) dictionaries.clear();
  return { dictionaries, tasks, specifier };
}

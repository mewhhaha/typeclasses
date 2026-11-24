import type {
  BindingPattern,
  CallExpression,
  Expression,
  ImportDeclaration,
  Node,
  Program,
} from "oxc-parser";
import { unwrap, walk } from "./transform_ast.ts";
import { might_contain_iterable_maps } from "./transform_iterable_maps.ts";
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

export type UnverifiedImports = {
  readonly do_names: Set<string>;
  readonly program_names: Set<string>;
  readonly effect_names: Set<string>;
  readonly namespaces: Set<string>;
  readonly terminal_functions: Map<string, { imported: TerminalFunctionName }>;
  readonly terminal_namespaces: Map<string, ReadonlySet<TerminalFunctionName>>;
  readonly primitive_functions: Map<string, PrimitiveFunctionName>;
  readonly primitive_namespaces: Map<
    string,
    ReadonlySet<PrimitiveFunctionName>
  >;
  readonly program_module?: string;
  readonly import_declarations: Map<string, ImportDeclaration>;
  readonly loop_dictionaries: Set<string>;
  readonly loop_tasks: Set<string>;
  readonly loop_specifier?: string;
  readonly leading_imports_end: number;
};

/** Cheap pre-parse filter shared by the CLI and bundler plugins. */
export function might_contain_transform_target(source: string): boolean {
  if (might_contain_iterable_maps(source) || source.includes("\\u")) {
    return true;
  }
  if (
    (source.includes("Do") || source.includes("Program")) &&
    /\b(?:Do|Program)\b/.test(source)
  ) return true;
  if (
    source.includes("run_") &&
    (source.includes("run_reader") || source.includes("run_state") ||
      source.includes("run_writer")) &&
    /\brun\b/.test(source)
  ) return true;
  return source.includes("Effect") &&
    (source.includes("interpret") || source.includes("handle_with"));
}

/** Scan only top-level ImportDeclarations (O(imports), no deep AST walk). */
export function scan_import_headers(
  program: Program,
  config: TransformConfig,
): UnverifiedImports {
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
  const import_declarations = new Map<string, ImportDeclaration>();
  const loop_dictionaries = new Set<string>();
  const loop_tasks = new Set<string>();
  let program_module: string | undefined;
  let loop_specifier: string | undefined;
  let leading_imports_end = 0;
  let saw_non_import = false;
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") {
      if (
        !(statement.type === "ExpressionStatement" &&
          "directive" in statement &&
          statement.directive != null)
      ) saw_non_import = true;
      continue;
    }
    if (saw_non_import) leading_imports_end = -1;
    else if (leading_imports_end >= 0 && statement.end > leading_imports_end) {
      leading_imports_end = statement.end;
    }
    if (statement.importKind === "type") continue;
    const specifier = statement.source.value;
    const available_terminals = terminal_exports(specifier, config);
    const available_primitives = primitive_exports(specifier);
    const is_library = library(specifier, config);
    if (/^(?:\.\.?\/)+src\/(?:mod|typeclasses)\.ts$/.test(specifier)) {
      loop_specifier = specifier.replace(/(?:typeclasses|mod)\.ts$/, "loop.ts");
    } else if (
      /^(?:@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)$/.test(
        specifier,
      )
    ) {
      loop_specifier = specifier + "/loop";
    }
    const loop_kind = package_module(specifier) ?? source_module(specifier);
    for (const binding of statement.specifiers) {
      const local = binding.local.name;
      if (!import_declarations.has(local)) {
        import_declarations.set(local, statement);
      }
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
      if (
        loop_kind !== undefined &&
        (imported === "Maybe" || imported === "Either" ||
          imported === "Identity" || imported === "Task") &&
        (loop_kind === "mod" || loop_kind === imported.toLowerCase())
      ) {
        loop_dictionaries.add(local);
        if (imported === "Task") loop_tasks.add(local);
      }
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
    import_declarations,
    loop_dictionaries,
    loop_tasks,
    loop_specifier,
    leading_imports_end,
  };
}

/** Scan only top-level `const alias = Program.scope(...)` declarations. */
export function scan_scope_declarations(
  program: Program,
  imports: Pick<
    ImportedBindings,
    "do_names" | "program_names" | "effect_names" | "namespaces"
  >,
): Map<string, number> {
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
      if (
        !imported_target(callee.object, "Program", imports as ImportedBindings)
      ) {
        continue;
      }
      declarations.set(declaration.id.name, declaration.end);
    }
  }
  return declarations;
}

/** Record non-import value bindings and scope-alias TDZ hazards in a single pass. */
export function create_import_shadow_tracker(
  headers: UnverifiedImports,
  scope_declarations: ReadonlyMap<string, number>,
  source: string,
) {
  const check_effect =
    (headers.program_names.size > 0 || headers.namespaces.size > 0) &&
    source.includes("Effect");
  const candidates = new Set<string>([
    ...headers.do_names,
    ...headers.program_names,
    ...headers.effect_names,
    ...headers.namespaces,
    ...headers.terminal_functions.keys(),
    ...headers.terminal_namespaces.keys(),
    ...headers.primitive_functions.keys(),
    ...headers.primitive_namespaces.keys(),
    ...headers.loop_dictionaries,
    ...scope_declarations.keys(),
  ]);
  if (check_effect) candidates.add("Effect");
  const counts = new Map<string, number>();
  const tdz_violated = new Set<string>();
  const add = (name: string) => {
    if (candidates.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  return {
    observe(current: Node): void {
      switch (current.type) {
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
        case "CallExpression":
          if (
            scope_declarations.size > 0 &&
            current.callee.type === "Identifier"
          ) {
            const end = scope_declarations.get(current.callee.name);
            if (end !== undefined && current.start < end) {
              tdz_violated.add(current.callee.name);
            }
          }
          break;
      }
    },
    finish(): {
      readonly imports: ImportedBindings;
      readonly scopes: ReadonlySet<string>;
      readonly loop_support: {
        readonly dictionaries: Set<string>;
        readonly tasks: Set<string>;
        readonly specifier: string | undefined;
      };
    } {
      for (const name of counts.keys()) {
        headers.do_names.delete(name);
        headers.program_names.delete(name);
        headers.effect_names.delete(name);
        headers.namespaces.delete(name);
        headers.terminal_functions.delete(name);
        headers.terminal_namespaces.delete(name);
        headers.primitive_functions.delete(name);
        headers.primitive_namespaces.delete(name);
        headers.loop_dictionaries.delete(name);
        headers.loop_tasks.delete(name);
      }
      if (headers.loop_specifier === undefined) {
        headers.loop_dictionaries.clear();
      }
      const scopes = new Set(headers.program_names);
      for (const name of scope_declarations.keys()) {
        if (counts.get(name) === 1 && !tdz_violated.has(name)) {
          scopes.add(name);
        }
      }
      return {
        imports: {
          do_names: headers.do_names,
          program_names: headers.program_names,
          effect_names: headers.effect_names,
          namespaces: headers.namespaces,
          terminal_functions: headers.terminal_functions,
          terminal_namespaces: headers.terminal_namespaces,
          primitive_functions: headers.primitive_functions,
          primitive_namespaces: headers.primitive_namespaces,
          program_module: headers.program_module,
          effect_helper_shadowed:
            (headers.program_names.size > 0 || headers.namespaces.size > 0) &&
            check_effect && counts.has("Effect"),
        },
        scopes,
        loop_support: {
          dictionaries: headers.loop_dictionaries,
          tasks: headers.loop_tasks,
          specifier: headers.loop_specifier,
        },
      };
    },
  };
}

/** Import recognition is deliberately limited to the package's declared surfaces. */
export function collect_imports(
  program: Program,
  source: string,
  config: TransformConfig,
): ImportedBindings {
  const headers = scan_import_headers(program, config);
  const tracker = create_import_shadow_tracker(headers, new Map(), source);
  walk(program, (current) => {
    if (current.type === "ImportDeclaration") return false;
    tracker.observe(current);
  });
  return tracker.finish().imports;
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

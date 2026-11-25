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
  CellFactoryKind,
  CellRunnerName,
  ExceptPrimitiveName,
  ImportedBindings,
  OperationHelperName,
  OperationRunnerName,
  PrimitiveFunctionName,
  StateEvalName,
  TerminalFunctionName,
  TransformConfig,
  TransformKind,
} from "./transform_context.ts";

const terminals = new Set<TerminalFunctionName>([
  "run",
  "run_reader",
  "run_state",
  "run_writer",
  "run_except",
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
const except_primitive_set = new Set<ExceptPrimitiveName>([
  "fail",
  "from_either",
  "from_maybe",
  "from_nullable",
  "from_validation",
]);
const state_eval_set = new Set<StateEvalName>(["eval_state", "exec_state"]);
const operation_runner_set = new Set<OperationRunnerName>([
  "handle_operations",
  "prepare_operations",
]);
const operation_helper_set = new Set<OperationHelperName>([
  "operation",
  "send",
  "pure",
]);
const source_specifiers = new Map<string, string>();
for (
  const name of [
    "array",
    "effects",
    "either",
    "except",
    "handlers",
    "identity",
    "iterable",
    "maybe",
    "mod",
    "reader",
    "state",
    "task",
    "typeclasses",
    "writer",
  ]
) {
  try {
    const url = new URL(`../src/${name}.ts`, import.meta.url);
    source_specifiers.set(url.href, name);
    source_specifiers.set(url.pathname, name);
  } catch { /* Bundled data URLs use package or relative matches. */ }
}
for (const name of ["applicative", "foldable"]) {
  try {
    const url = new URL(`../src/typeclasses/${name}.ts`, import.meta.url);
    source_specifiers.set(url.href, name);
    source_specifiers.set(url.pathname, name);
  } catch { /* Bundled data URLs use package or relative matches. */ }
}

function source_module(specifier: string): string | undefined {
  return source_specifiers.get(specifier) ??
    specifier.match(/^(?:\.\.?\/)+src\/(?:typeclasses\/)?(\w+)(?:\.ts)?$/)?.[1];
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
    case "except":
      return new Set(["run_except"]);
  }
}
function except_primitive_exports(
  specifier: string,
): ReadonlySet<ExceptPrimitiveName> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
    case "except":
      return except_primitive_set;
  }
}
function state_eval_exports(
  specifier: string,
): ReadonlySet<StateEvalName> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
    case "state":
      return state_eval_set;
  }
}
function operation_runner_exports(
  specifier: string,
): ReadonlySet<OperationRunnerName> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
    case "handlers":
      return operation_runner_set;
  }
}
function operation_helper_exports(
  specifier: string,
): ReadonlySet<OperationHelperName> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
    case "effects":
      return operation_helper_set;
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

const cell_factory_kinds = new Set<CellFactoryKind>([
  "reader",
  "state",
  "writer",
]);

function cell_factory_exports(
  specifier: string,
): ReadonlySet<CellFactoryKind> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
      return cell_factory_kinds;
    case "reader":
      return new Set<CellFactoryKind>(["reader"]);
    case "state":
      return new Set<CellFactoryKind>(["state"]);
    case "writer":
      return new Set<CellFactoryKind>(["writer"]);
  }
}

function cell_factory_kind_for(
  imported: string,
): CellFactoryKind | undefined {
  switch (imported) {
    case "reader":
      return "reader";
    case "state":
      return "state";
    case "writer_cell":
      return "writer";
  }
}

const cell_runner_names = new Set<CellRunnerName>([
  "run_cells",
  "prepare_cells",
  "handle_cells",
  "prepare_handle_cells",
]);

function cell_runner_exports(
  specifier: string,
): ReadonlySet<CellRunnerName> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
    case "handlers":
      return cell_runner_names;
  }
}

function cell_provider_exports(
  specifier: string,
): ReadonlySet<CellFactoryKind> | undefined {
  switch (package_module(specifier) ?? source_module(specifier)) {
    case "mod":
    case "handlers":
      return cell_factory_kinds;
  }
}

function cell_provider_kind_for(
  imported: string,
): CellFactoryKind | undefined {
  switch (imported) {
    case "provide_reader":
      return "reader";
    case "provide_state":
      return "state";
    case "provide_writer":
      return "writer";
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
  readonly except_primitives: Map<string, ExceptPrimitiveName>;
  readonly except_namespaces: Map<string, ReadonlySet<ExceptPrimitiveName>>;
  readonly state_eval_functions: Map<string, StateEvalName>;
  readonly state_eval_namespaces: Map<string, ReadonlySet<StateEvalName>>;
  readonly operation_runners: Map<string, OperationRunnerName>;
  readonly operation_runner_namespaces: Map<
    string,
    ReadonlySet<OperationRunnerName>
  >;
  readonly operation_helpers: Map<string, OperationHelperName>;
  readonly cell_factories: Map<string, CellFactoryKind>;
  readonly cell_namespaces: Map<string, ReadonlySet<CellFactoryKind>>;
  readonly cell_runners: Map<string, CellRunnerName>;
  readonly cell_runner_namespaces: Map<string, ReadonlySet<CellRunnerName>>;
  readonly cell_providers: Map<string, CellFactoryKind>;
  readonly cell_provider_namespaces: Map<string, ReadonlySet<CellFactoryKind>>;
  readonly direct_maybe_dictionaries: Set<string>;
  readonly just_constructors: Set<string>;
  readonly nothing_constructors: Set<string>;
  readonly direct_either_dictionaries: Set<string>;
  readonly left_constructors: Set<string>;
  readonly right_constructors: Set<string>;
  readonly direct_identity_dictionaries: Set<string>;
  readonly identity_constructors: Set<string>;
  readonly array_constructors: Set<string>;
  readonly direct_reader_dictionaries: Set<string>;
  readonly direct_state_dictionaries: Set<string>;
  readonly collect_functions: Set<string>;
  readonly collect_namespaces: Set<string>;
  readonly applicative_objects: Set<string>;
  readonly applicative_namespaces: Set<string>;
  readonly iterable_locals: Set<string>;
  readonly program_module?: string;
  readonly import_declarations: Map<string, ImportDeclaration>;
  readonly loop_dictionaries: Set<string>;
  readonly loop_tasks: Set<string>;
  readonly loop_specifier?: string;
  readonly leading_imports_end: number;
};

/** O(N) monotonic substring span scanner across non-overlapping sorted spans. */
export function create_span_scanner(
  source: string,
  tokens: readonly string[],
  start_offset = 0,
): (start: number, end: number) => boolean {
  const seen = new Set<string>();
  const active_tokens: string[] = [];
  const next: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.length === 0 || seen.has(token)) continue;
    seen.add(token);
    const pos = source.indexOf(token, start_offset);
    if (pos >= 0) {
      active_tokens.push(token);
      next.push(pos);
    }
  }
  let active = active_tokens.length;
  if (active === 0) return () => false;
  let min_pos = next[0];
  for (let i = 1; i < active; i += 1) {
    if (next[i] < min_pos) min_pos = next[i];
  }
  return (start: number, end: number): boolean => {
    if (active === 0 || min_pos >= end) return false;
    let hit = false;
    let new_min = Infinity;
    for (let index = 0; index < active; index += 1) {
      let pos = next[index];
      if (pos < start) {
        pos = source.indexOf(active_tokens[index], start);
        if (pos < 0) {
          active -= 1;
          active_tokens[index] = active_tokens[active];
          next[index] = next[active];
          index -= 1;
          continue;
        }
        next[index] = pos;
      }
      if (pos < end) hit = true;
      if (pos < new_min) new_min = pos;
    }
    min_pos = new_min;
    return hit;
  };
}

/** Cheap pre-parse filter shared by the CLI and bundler plugins. */
export function might_contain_transform_target(source: string): boolean {
  if (
    (source.includes("Do") || source.includes("Program")) &&
    /\b(?:Do|Program)\b/.test(source)
  ) return true;
  if (
    (source.includes("run_") &&
      (source.includes("run_reader") || source.includes("run_state") ||
        source.includes("run_writer") || source.includes("run_cells") ||
        source.includes("run_except"))) ||
    source.includes("prepare_cells") ||
    source.includes("handle_cells") ||
    source.includes("prepare_handle_cells") ||
    source.includes("handle_operations") ||
    source.includes("prepare_operations")
  ) {
    if (
      source.includes("run_cells") || source.includes("prepare_cells") ||
      /\brun\b/.test(source)
    ) return true;
  }
  if (source.includes("eval_state") || source.includes("exec_state")) {
    return true;
  }
  if (source.includes("collect") && /\bcollect\s*\(/.test(source)) {
    return true;
  }
  if (
    source.includes("Applicative") && /\bApplicative\s*\.\s*lift\b/.test(source)
  ) return true;
  if (
    source.includes("Effect") &&
    (source.includes("interpret") || source.includes("handle_with"))
  ) return true;
  return might_contain_iterable_maps(source);
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
  const except_primitives = new Map<string, ExceptPrimitiveName>();
  const except_namespaces = new Map<
    string,
    ReadonlySet<ExceptPrimitiveName>
  >();
  const state_eval_functions = new Map<string, StateEvalName>();
  const state_eval_namespaces = new Map<string, ReadonlySet<StateEvalName>>();
  const operation_runners = new Map<string, OperationRunnerName>();
  const operation_runner_namespaces = new Map<
    string,
    ReadonlySet<OperationRunnerName>
  >();
  const operation_helpers = new Map<string, OperationHelperName>();
  const cell_factories = new Map<string, CellFactoryKind>();
  const cell_namespaces = new Map<string, ReadonlySet<CellFactoryKind>>();
  const cell_runners = new Map<string, CellRunnerName>();
  const cell_runner_namespaces = new Map<string, ReadonlySet<CellRunnerName>>();
  const cell_providers = new Map<string, CellFactoryKind>();
  const cell_provider_namespaces = new Map<
    string,
    ReadonlySet<CellFactoryKind>
  >();
  const direct_maybe_dictionaries = new Set<string>();
  const just_constructors = new Set<string>();
  const nothing_constructors = new Set<string>();
  const direct_either_dictionaries = new Set<string>();
  const left_constructors = new Set<string>();
  const right_constructors = new Set<string>();
  const direct_identity_dictionaries = new Set<string>();
  const identity_constructors = new Set<string>();
  const array_constructors = new Set<string>();
  const direct_reader_dictionaries = new Set<string>();
  const direct_state_dictionaries = new Set<string>();
  const collect_functions = new Set<string>();
  const collect_namespaces = new Set<string>();
  const applicative_objects = new Set<string>();
  const applicative_namespaces = new Set<string>();
  const iterable_locals = new Set<string>();
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
    const available_except_primitives = except_primitive_exports(specifier);
    const available_state_evals = state_eval_exports(specifier);
    const available_op_runners = operation_runner_exports(specifier);
    const available_op_helpers = operation_helper_exports(specifier);
    const available_cell_factories = cell_factory_exports(specifier);
    const available_cell_runners = cell_runner_exports(specifier);
    const available_cell_providers = cell_provider_exports(specifier);
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
        if (available_except_primitives !== undefined) {
          except_namespaces.set(local, available_except_primitives);
        }
        if (available_state_evals !== undefined) {
          state_eval_namespaces.set(local, available_state_evals);
        }
        if (available_op_runners !== undefined) {
          operation_runner_namespaces.set(local, available_op_runners);
        }
        if (available_cell_factories !== undefined) {
          cell_namespaces.set(local, available_cell_factories);
        }
        if (available_cell_runners !== undefined) {
          cell_runner_namespaces.set(local, available_cell_runners);
        }
        if (available_cell_providers !== undefined) {
          cell_provider_namespaces.set(local, available_cell_providers);
        }
        if (is_library) {
          namespaces.add(local);
          program_module ??= specifier;
        }
        if (
          loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "applicative"
        ) {
          collect_namespaces.add(local);
          applicative_namespaces.add(local);
        }
        if (
          loop_kind === "iterable" || loop_kind === "mod" ||
          loop_kind === "typeclasses" || loop_kind === "foldable"
        ) {
          iterable_locals.add(local);
        }
        continue;
      }
      if (binding.type !== "ImportSpecifier" || binding.importKind === "type") {
        continue;
      }
      const imported = import_name(binding)!;
      if (
        loop_kind === "iterable" ||
        ((loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "foldable") &&
          (imported === "iterable" || imported === "Foldable"))
      ) {
        iterable_locals.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "applicative") && imported === "collect"
      ) {
        collect_functions.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "applicative") && imported === "Applicative"
      ) {
        applicative_objects.add(local);
      }
      if (
        loop_kind !== undefined &&
        (imported === "Maybe" || imported === "Either" ||
          imported === "Identity" || imported === "Task") &&
        (loop_kind === "mod" || loop_kind === imported.toLowerCase())
      ) {
        loop_dictionaries.add(local);
        if (imported === "Task") loop_tasks.add(local);
        if (imported === "Maybe") direct_maybe_dictionaries.add(local);
        if (imported === "Either") direct_either_dictionaries.add(local);
        if (imported === "Identity") direct_identity_dictionaries.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") && imported === "Just"
      ) {
        just_constructors.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") && imported === "Nothing"
      ) {
        nothing_constructors.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "either") && imported === "Left"
      ) {
        left_constructors.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "either") && imported === "Right"
      ) {
        right_constructors.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "identity") &&
        (imported === "identity" || imported === "Identity")
      ) {
        identity_constructors.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "array") && imported === "ArrayT"
      ) {
        array_constructors.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "reader") && imported === "Reader"
      ) {
        direct_reader_dictionaries.add(local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "state") && imported === "State"
      ) {
        direct_state_dictionaries.add(local);
      }
      if (available_terminals?.has(imported as TerminalFunctionName)) {
        terminal_functions.set(local, {
          imported: imported as TerminalFunctionName,
        });
      }
      if (available_primitives?.has(imported as PrimitiveFunctionName)) {
        primitive_functions.set(local, imported as PrimitiveFunctionName);
      }
      if (available_except_primitives?.has(imported as ExceptPrimitiveName)) {
        except_primitives.set(local, imported as ExceptPrimitiveName);
      }
      if (available_state_evals?.has(imported as StateEvalName)) {
        state_eval_functions.set(local, imported as StateEvalName);
      }
      if (available_op_runners?.has(imported as OperationRunnerName)) {
        operation_runners.set(local, imported as OperationRunnerName);
      }
      if (available_op_helpers?.has(imported as OperationHelperName)) {
        operation_helpers.set(local, imported as OperationHelperName);
      }
      const factory_kind = cell_factory_kind_for(imported);
      if (
        factory_kind !== undefined &&
        available_cell_factories?.has(factory_kind)
      ) {
        cell_factories.set(local, factory_kind);
      }
      if (available_cell_runners?.has(imported as CellRunnerName)) {
        cell_runners.set(local, imported as CellRunnerName);
      }
      const provider_kind = cell_provider_kind_for(imported);
      if (
        provider_kind !== undefined &&
        available_cell_providers?.has(provider_kind)
      ) {
        cell_providers.set(local, provider_kind);
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
    except_primitives,
    except_namespaces,
    state_eval_functions,
    state_eval_namespaces,
    operation_runners,
    operation_runner_namespaces,
    operation_helpers,
    cell_factories,
    cell_namespaces,
    cell_runners,
    cell_runner_namespaces,
    cell_providers,
    cell_provider_namespaces,
    direct_maybe_dictionaries,
    just_constructors,
    nothing_constructors,
    direct_either_dictionaries,
    left_constructors,
    right_constructors,
    direct_identity_dictionaries,
    identity_constructors,
    array_constructors,
    direct_reader_dictionaries,
    direct_state_dictionaries,
    collect_functions,
    collect_namespaces,
    applicative_objects,
    applicative_namespaces,
    iterable_locals,
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
    ...headers.except_primitives.keys(),
    ...headers.except_namespaces.keys(),
    ...headers.state_eval_functions.keys(),
    ...headers.state_eval_namespaces.keys(),
    ...headers.operation_runners.keys(),
    ...headers.operation_runner_namespaces.keys(),
    ...headers.operation_helpers.keys(),
    ...headers.cell_factories.keys(),
    ...headers.cell_namespaces.keys(),
    ...headers.cell_runners.keys(),
    ...headers.cell_runner_namespaces.keys(),
    ...headers.cell_providers.keys(),
    ...headers.cell_provider_namespaces.keys(),
    ...headers.direct_maybe_dictionaries,
    ...headers.just_constructors,
    ...headers.nothing_constructors,
    ...headers.direct_either_dictionaries,
    ...headers.left_constructors,
    ...headers.right_constructors,
    ...headers.direct_identity_dictionaries,
    ...headers.identity_constructors,
    ...headers.array_constructors,
    ...headers.direct_reader_dictionaries,
    ...headers.direct_state_dictionaries,
    ...headers.collect_functions,
    ...headers.collect_namespaces,
    ...headers.applicative_objects,
    ...headers.applicative_namespaces,
    ...headers.iterable_locals,
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
        headers.except_primitives.delete(name);
        headers.except_namespaces.delete(name);
        headers.state_eval_functions.delete(name);
        headers.state_eval_namespaces.delete(name);
        headers.operation_runners.delete(name);
        headers.operation_runner_namespaces.delete(name);
        headers.operation_helpers.delete(name);
        headers.cell_factories.delete(name);
        headers.cell_namespaces.delete(name);
        headers.cell_runners.delete(name);
        headers.cell_runner_namespaces.delete(name);
        headers.cell_providers.delete(name);
        headers.cell_provider_namespaces.delete(name);
        headers.direct_maybe_dictionaries.delete(name);
        headers.just_constructors.delete(name);
        headers.nothing_constructors.delete(name);
        headers.direct_either_dictionaries.delete(name);
        headers.left_constructors.delete(name);
        headers.right_constructors.delete(name);
        headers.direct_identity_dictionaries.delete(name);
        headers.identity_constructors.delete(name);
        headers.array_constructors.delete(name);
        headers.direct_reader_dictionaries.delete(name);
        headers.direct_state_dictionaries.delete(name);
        headers.collect_functions.delete(name);
        headers.collect_namespaces.delete(name);
        headers.applicative_objects.delete(name);
        headers.applicative_namespaces.delete(name);
        headers.iterable_locals.delete(name);
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
          except_primitives: headers.except_primitives,
          except_namespaces: headers.except_namespaces,
          state_eval_functions: headers.state_eval_functions,
          state_eval_namespaces: headers.state_eval_namespaces,
          operation_runners: headers.operation_runners,
          operation_runner_namespaces: headers.operation_runner_namespaces,
          operation_helpers: headers.operation_helpers,
          cell_factories: headers.cell_factories,
          cell_namespaces: headers.cell_namespaces,
          cell_runners: headers.cell_runners,
          cell_runner_namespaces: headers.cell_runner_namespaces,
          cell_providers: headers.cell_providers,
          cell_provider_namespaces: headers.cell_provider_namespaces,
          direct_maybe_dictionaries: headers.direct_maybe_dictionaries,
          just_constructors: headers.just_constructors,
          nothing_constructors: headers.nothing_constructors,
          direct_either_dictionaries: headers.direct_either_dictionaries,
          left_constructors: headers.left_constructors,
          right_constructors: headers.right_constructors,
          direct_identity_dictionaries: headers.direct_identity_dictionaries,
          identity_constructors: headers.identity_constructors,
          array_constructors: headers.array_constructors,
          direct_reader_dictionaries: headers.direct_reader_dictionaries,
          direct_state_dictionaries: headers.direct_state_dictionaries,
          collect_functions: headers.collect_functions,
          collect_namespaces: headers.collect_namespaces,
          applicative_objects: headers.applicative_objects,
          applicative_namespaces: headers.applicative_namespaces,
          iterable_locals: headers.iterable_locals,
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

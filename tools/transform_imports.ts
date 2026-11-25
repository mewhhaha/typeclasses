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
  StmPrimitiveName,
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
  "run_reader_terminal",
  "run_state_terminal",
  "run_writer_terminal",
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
const stm_primitive_set = new Set<StmPrimitiveName>([
  "read_tvar",
  "write_tvar",
  "modify_tvar",
  "retry",
  "abort",
  "or_else",
]);
const source_specifiers = new Map<string, string>();
for (
  const name of [
    "array",
    "async_iterable",
    "effects",
    "either",
    "except",
    "handlers",
    "identity",
    "iterable",
    "list",
    "map",
    "maybe",
    "mod",
    "reader",
    "record",
    "set",
    "state",
    "stm",
    "tagged",
    "task",
    "traversal",
    "typeclasses",
    "typed_array",
    "validation",
    "writer",
  ]
) {
  try {
    const url = new URL(`../src/${name}.ts`, import.meta.url);
    source_specifiers.set(url.href, name);
    source_specifiers.set(url.pathname, name);
  } catch { /* Bundled data URLs use package or relative matches. */ }
}
for (const name of ["applicative", "foldable", "traversable"]) {
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
      return new Set(["run_reader", "run_reader_terminal"]);
    case "state":
      return new Set(["run_state", "run_state_terminal"]);
    case "writer":
      return new Set(["run_writer", "run_writer_terminal"]);
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
  readonly from_nullable_functions: Set<string>;
  readonly from_maybe_functions: Set<string>;
  readonly to_nullable_functions: Set<string>;
  readonly maybe_get_or_else_functions: Set<string>;
  readonly maybe_fold_functions: Set<string>;
  readonly maybe_filter_functions: Set<string>;
  readonly direct_either_dictionaries: Set<string>;
  readonly left_constructors: Set<string>;
  readonly right_constructors: Set<string>;
  readonly either_fold_functions: Set<string>;
  readonly either_from_right_functions: Set<string>;
  readonly either_from_left_functions: Set<string>;
  readonly either_recover_functions: Set<string>;
  readonly direct_identity_dictionaries: Set<string>;
  readonly identity_constructors: Set<string>;
  readonly array_constructors: Set<string>;
  readonly array_from_array_functions: Set<string>;
  readonly array_view_functions: Set<string>;
  readonly array_to_array_functions: Set<string>;
  readonly array_namespaces: Set<string>;
  readonly typed_array_constructors: Set<string>;
  readonly set_constructors: Set<string>;
  readonly map_constructors: Set<string>;
  readonly record_constructors: Set<string>;
  readonly foldable_objects: Set<string>;
  readonly foldable_namespaces: Set<string>;
  readonly stm_dictionaries: Set<string>;
  readonly stm_namespaces: Set<string>;
  readonly stm_atomically_functions: Set<string>;
  readonly stm_primitive_functions: Map<string, StmPrimitiveName>;
  readonly list_constructors: Set<string>;
  readonly list_from_array_functions: Set<string>;
  readonly list_namespaces: Set<string>;
  readonly nil_constructors: Set<string>;
  readonly cons_constructors: Set<string>;
  readonly direct_reader_dictionaries: Set<string>;
  readonly direct_state_dictionaries: Set<string>;
  readonly direct_writer_dictionaries: Set<string>;
  readonly parallel_task_dictionaries: Set<string>;
  readonly task_parallel_functions: Set<string>;
  readonly task_sequential_functions: Set<string>;
  readonly task_from_fn_functions: Set<string>;
  readonly task_succeed_functions: Set<string>;
  readonly task_run_functions: Set<string>;
  readonly task_run_exit_functions: Set<string>;
  readonly task_is_cancellation_functions: Set<string>;
  readonly task_namespaces: Set<string>;
  readonly traversable_objects: Set<string>;
  readonly traversable_namespaces: Set<string>;
  readonly traverse_sequential_functions: Set<string>;
  readonly traverse_sequential_namespaces: Set<string>;
  readonly match_functions: Set<string>;
  readonly match_namespaces: Set<string>;
  readonly tagged_type_names: Map<
    string,
    "maybe" | "either" | "validation" | "list"
  >;
  readonly validation_constructors: Set<string>;
  readonly direct_validation_dictionaries: Set<string>;
  readonly valid_constructors: Set<string>;
  readonly invalid_constructors: Set<string>;
  readonly invalid_messages_constructors: Set<string>;
  readonly collect_functions: Set<string>;
  readonly collect_namespaces: Set<string>;
  readonly applicative_objects: Set<string>;
  readonly applicative_namespaces: Set<string>;
  readonly iterable_locals: Set<string>;
  readonly async_iterable_locals: Set<string>;
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

function escape_regex_token(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ident_token_re = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Word-boundary inverted token scan over `program.body` statements.
 * Returns sorted indices of non-import top-level statements containing at least
 * one token on a valid identifier boundary, skipping whole statements once hit.
 */
export function collect_active_statement_indices(
  source: string,
  body: Program["body"],
  tokens: readonly string[],
  start_offset: number,
): number[] {
  const seen = new Set<string>();
  const ident_parts: string[] = [];
  const other_parts: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.length === 0 || seen.has(tok)) continue;
    seen.add(tok);
    if (ident_token_re.test(tok)) {
      ident_parts.push(escape_regex_token(tok));
    } else {
      let escaped = tok.charCodeAt(0) === 46 /* . */
        ? "\\.\\s*" + escape_regex_token(tok.slice(1))
        : escape_regex_token(tok);
      const last = tok.charCodeAt(tok.length - 1);
      if (
        (last >= 65 && last <= 90) || (last >= 97 && last <= 122) ||
        (last >= 48 && last <= 57) || last === 95 || last === 36
      ) {
        escaped += "\\b";
      }
      other_parts.push(escaped);
    }
  }
  const branches: string[] = [];
  if (ident_parts.length > 0) {
    branches.push("\\b(?:" + ident_parts.join("|") + ")\\b");
  }
  if (other_parts.length > 0) {
    branches.push("(?:" + other_parts.join("|") + ")");
  }
  if (branches.length === 0) return [];
  const re = new RegExp(branches.join("|"), "g");
  re.lastIndex = start_offset;
  const active: number[] = [];
  const total = body.length;
  let stmt_idx = 0;
  // Advance past leading imports.
  while (stmt_idx < total && body[stmt_idx].end <= start_offset) {
    stmt_idx += 1;
  }
  let match: RegExpExecArray | null;
  while (stmt_idx < total && (match = re.exec(source)) !== null) {
    const pos = match.index;
    if (pos < body[stmt_idx].start) continue;
    if (pos >= body[stmt_idx].end) {
      // Binary search for the statement containing `pos`.
      let lo = stmt_idx + 1;
      let hi = total;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (body[mid].end <= pos) lo = mid + 1;
        else hi = mid;
      }
      stmt_idx = lo;
      if (stmt_idx >= total) break;
      if (pos < body[stmt_idx].start) continue;
    }
    const stmt = body[stmt_idx];
    if (stmt.type !== "ImportDeclaration") {
      active.push(stmt_idx);
    }
    re.lastIndex = stmt.end;
    stmt_idx += 1;
  }
  return active;
}

/** Cheap pre-parse filter shared by the CLI and bundler plugins. */
export function might_contain_transform_target(
  source: string,
  config?: TransformConfig,
): boolean {
  if (
    (source.includes("Do") || source.includes("Program")) &&
    /\b(?:Do|Program)\b/.test(source)
  ) return true;
  if (!source.includes("import")) return false;
  if (
    config?.library_specifiers === undefined &&
    config?.terminal_library_specifiers === undefined &&
    !source.includes("@mewhhaha/typeclasses") &&
    !source.includes("src/") &&
    !source.includes("\\u")
  ) return false;
  if (
    (source.includes("run_") &&
      (source.includes("run_reader") || source.includes("run_state") ||
        source.includes("run_writer") || source.includes("run_cells") ||
        source.includes("run_except") || source.includes("run_task"))) ||
    source.includes("prepare_cells") ||
    source.includes("handle_cells") ||
    source.includes("prepare_handle_cells") ||
    source.includes("handle_operations") ||
    source.includes("prepare_operations")
  ) {
    if (
      source.includes("run_cells") || source.includes("prepare_cells") ||
      source.includes("_terminal") || source.includes("run_task") ||
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
    source.includes("traverse") &&
    /\bTraversable\b|\btraverse_sequential\b|\.\s*traverse\b/.test(source)
  ) return true;
  if (
    source.includes("match") &&
    (/\.\s*match\s*\(\s*\{/.test(source) ||
      /(?:^|[^.\w$])match\s*\(/.test(source))
  ) return true;
  if (
    source.includes("Effect") &&
    (source.includes("interpret") || source.includes("handle_with"))
  ) return true;
  if (
    source.includes("from_maybe") || source.includes("to_nullable") ||
    source.includes("get_or_else") || source.includes("from_right") ||
    source.includes("from_left") || source.includes("recover_or_else") ||
    source.includes("atomically") ||
    (source.includes("maybe(") || source.includes("either(")) ||
    (source.includes(".map(") &&
      (source.includes("Just") || source.includes("Right") ||
        source.includes("Maybe") || source.includes("Either") ||
        source.includes("from_nullable") || source.includes("ArrayT") ||
        source.includes("from_array"))) ||
    (source.includes(".bind(") &&
      (source.includes("Just") || source.includes("Right") ||
        source.includes("Maybe") || source.includes("Either") ||
        source.includes("from_nullable"))) ||
    ((source.includes("ArrayT") || source.includes("from_array") ||
      source.includes("TypedArrayT") || source.includes("from_typed_array") ||
      source.includes("SetT") || source.includes("from_set") ||
      source.includes("MapT") || source.includes("from_map_view") ||
      source.includes("RecordT") || source.includes("from_record_view") ||
      source.includes("from_snapshot")) &&
      (source.includes("Foldable") || source.includes(".fold(")))
  ) return true;
  return might_contain_iterable_maps(source);
}

const EMPTY_SET: Set<string> = new Set<string>();
const EMPTY_MAP: Map<string, never> = new Map<string, never>();

function add_set(current: Set<string>, value: string): Set<string> {
  if (current === EMPTY_SET) {
    const next = new Set<string>();
    next.add(value);
    return next;
  }
  current.add(value);
  return current;
}

function set_map<V>(
  current: Map<string, V>,
  key: string,
  value: V,
): Map<string, V> {
  if (current === (EMPTY_MAP as unknown as Map<string, V>)) {
    const next = new Map<string, V>();
    next.set(key, value);
    return next;
  }
  current.set(key, value);
  return current;
}

/** Scan only top-level ImportDeclarations (O(imports), no deep AST walk). */
export function scan_import_headers(
  program: Program,
  config: TransformConfig,
): UnverifiedImports {
  let do_names = EMPTY_SET;
  let program_names = EMPTY_SET;
  let effect_names = EMPTY_SET;
  let namespaces = EMPTY_SET;
  let terminal_functions = EMPTY_MAP as Map<
    string,
    { imported: TerminalFunctionName }
  >;
  let terminal_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<TerminalFunctionName>
  >;
  let primitive_functions = EMPTY_MAP as Map<string, PrimitiveFunctionName>;
  let primitive_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<PrimitiveFunctionName>
  >;
  let except_primitives = EMPTY_MAP as Map<string, ExceptPrimitiveName>;
  let except_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<ExceptPrimitiveName>
  >;
  let state_eval_functions = EMPTY_MAP as Map<string, StateEvalName>;
  let state_eval_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<StateEvalName>
  >;
  let operation_runners = EMPTY_MAP as Map<string, OperationRunnerName>;
  let operation_runner_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<OperationRunnerName>
  >;
  let operation_helpers = EMPTY_MAP as Map<string, OperationHelperName>;
  let cell_factories = EMPTY_MAP as Map<string, CellFactoryKind>;
  let cell_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<CellFactoryKind>
  >;
  let cell_runners = EMPTY_MAP as Map<string, CellRunnerName>;
  let cell_runner_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<CellRunnerName>
  >;
  let cell_providers = EMPTY_MAP as Map<string, CellFactoryKind>;
  let cell_provider_namespaces = EMPTY_MAP as Map<
    string,
    ReadonlySet<CellFactoryKind>
  >;
  let direct_maybe_dictionaries = EMPTY_SET;
  let just_constructors = EMPTY_SET;
  let nothing_constructors = EMPTY_SET;
  let from_nullable_functions = EMPTY_SET;
  let from_maybe_functions = EMPTY_SET;
  let to_nullable_functions = EMPTY_SET;
  let maybe_get_or_else_functions = EMPTY_SET;
  let maybe_fold_functions = EMPTY_SET;
  let maybe_filter_functions = EMPTY_SET;
  let direct_either_dictionaries = EMPTY_SET;
  let left_constructors = EMPTY_SET;
  let right_constructors = EMPTY_SET;
  let either_fold_functions = EMPTY_SET;
  let either_from_right_functions = EMPTY_SET;
  let either_from_left_functions = EMPTY_SET;
  let either_recover_functions = EMPTY_SET;
  let direct_identity_dictionaries = EMPTY_SET;
  let identity_constructors = EMPTY_SET;
  let array_constructors = EMPTY_SET;
  let array_from_array_functions = EMPTY_SET;
  let array_view_functions = EMPTY_SET;
  let array_to_array_functions = EMPTY_SET;
  let array_namespaces = EMPTY_SET;
  let typed_array_constructors = EMPTY_SET;
  let set_constructors = EMPTY_SET;
  let map_constructors = EMPTY_SET;
  let record_constructors = EMPTY_SET;
  let foldable_objects = EMPTY_SET;
  let foldable_namespaces = EMPTY_SET;
  let stm_dictionaries = EMPTY_SET;
  let stm_namespaces = EMPTY_SET;
  let stm_atomically_functions = EMPTY_SET;
  let stm_primitive_functions = EMPTY_MAP as Map<string, StmPrimitiveName>;
  let list_constructors = EMPTY_SET;
  let list_from_array_functions = EMPTY_SET;
  let list_namespaces = EMPTY_SET;
  let nil_constructors = EMPTY_SET;
  let cons_constructors = EMPTY_SET;
  let direct_reader_dictionaries = EMPTY_SET;
  let direct_state_dictionaries = EMPTY_SET;
  let direct_writer_dictionaries = EMPTY_SET;
  let parallel_task_dictionaries = EMPTY_SET;
  let task_parallel_functions = EMPTY_SET;
  let task_sequential_functions = EMPTY_SET;
  let task_from_fn_functions = EMPTY_SET;
  let task_succeed_functions = EMPTY_SET;
  let task_run_functions = EMPTY_SET;
  let task_run_exit_functions = EMPTY_SET;
  let task_is_cancellation_functions = EMPTY_SET;
  let task_namespaces = EMPTY_SET;
  let traversable_objects = EMPTY_SET;
  let traversable_namespaces = EMPTY_SET;
  let traverse_sequential_functions = EMPTY_SET;
  let traverse_sequential_namespaces = EMPTY_SET;
  let match_functions = EMPTY_SET;
  let match_namespaces = EMPTY_SET;
  let tagged_type_names = EMPTY_MAP as Map<
    string,
    "maybe" | "either" | "validation" | "list"
  >;
  let validation_constructors = EMPTY_SET;
  let direct_validation_dictionaries = EMPTY_SET;
  let valid_constructors = EMPTY_SET;
  let invalid_constructors = EMPTY_SET;
  let invalid_messages_constructors = EMPTY_SET;
  let collect_functions = EMPTY_SET;
  let collect_namespaces = EMPTY_SET;
  let applicative_objects = EMPTY_SET;
  let applicative_namespaces = EMPTY_SET;
  let iterable_locals = EMPTY_SET;
  let async_iterable_locals = EMPTY_SET;
  let import_declarations = EMPTY_MAP as Map<string, ImportDeclaration>;
  let loop_dictionaries = EMPTY_SET;
  let loop_tasks = EMPTY_SET;
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
    if (statement.importKind === "type") {
      const type_kind = package_module(statement.source.value) ??
        source_module(statement.source.value);
      if (type_kind !== undefined) {
        for (const binding of statement.specifiers) {
          if (binding.type !== "ImportSpecifier") continue;
          const imported = import_name(binding);
          if (
            imported === "Maybe" &&
            (type_kind === "mod" || type_kind === "maybe")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "maybe",
            );
          } else if (
            imported === "Either" &&
            (type_kind === "mod" || type_kind === "either")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "either",
            );
          } else if (
            imported === "Validation" &&
            (type_kind === "mod" || type_kind === "validation")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "validation",
            );
          } else if (
            imported === "List" &&
            (type_kind === "mod" || type_kind === "list")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "list",
            );
          }
        }
      }
      continue;
    }
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
        import_declarations = set_map(import_declarations, local, statement);
      }
      if (binding.type === "ImportNamespaceSpecifier") {
        if (available_terminals !== undefined) {
          terminal_namespaces = set_map(
            terminal_namespaces,
            local,
            available_terminals,
          );
        }
        if (available_primitives !== undefined) {
          primitive_namespaces = set_map(
            primitive_namespaces,
            local,
            available_primitives,
          );
        }
        if (available_except_primitives !== undefined) {
          except_namespaces = set_map(
            except_namespaces,
            local,
            available_except_primitives,
          );
        }
        if (available_state_evals !== undefined) {
          state_eval_namespaces = set_map(
            state_eval_namespaces,
            local,
            available_state_evals,
          );
        }
        if (available_op_runners !== undefined) {
          operation_runner_namespaces = set_map(
            operation_runner_namespaces,
            local,
            available_op_runners,
          );
        }
        if (available_cell_factories !== undefined) {
          cell_namespaces = set_map(
            cell_namespaces,
            local,
            available_cell_factories,
          );
        }
        if (available_cell_runners !== undefined) {
          cell_runner_namespaces = set_map(
            cell_runner_namespaces,
            local,
            available_cell_runners,
          );
        }
        if (available_cell_providers !== undefined) {
          cell_provider_namespaces = set_map(
            cell_provider_namespaces,
            local,
            available_cell_providers,
          );
        }
        if (is_library) {
          namespaces = add_set(namespaces, local);
          program_module ??= specifier;
        }
        if (
          loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "applicative"
        ) {
          collect_namespaces = add_set(collect_namespaces, local);
          applicative_namespaces = add_set(applicative_namespaces, local);
        }
        if (
          loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "traversable"
        ) {
          traversable_namespaces = add_set(traversable_namespaces, local);
        }
        if (loop_kind === "mod" || loop_kind === "traversal") {
          traverse_sequential_namespaces = add_set(
            traverse_sequential_namespaces,
            local,
          );
        }
        if (loop_kind === "mod" || loop_kind === "tagged") {
          match_namespaces = add_set(match_namespaces, local);
        }
        if (loop_kind === "mod" || loop_kind === "task") {
          task_namespaces = add_set(task_namespaces, local);
        }
        if (
          loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "foldable"
        ) {
          foldable_namespaces = add_set(foldable_namespaces, local);
        }
        if (loop_kind === "stm") {
          stm_namespaces = add_set(stm_namespaces, local);
        }
        if (loop_kind === "array") {
          array_namespaces = add_set(array_namespaces, local);
        }
        if (loop_kind === "list") {
          list_namespaces = add_set(list_namespaces, local);
        }
        if (
          loop_kind === "iterable" || loop_kind === "mod" ||
          loop_kind === "typeclasses" || loop_kind === "foldable"
        ) {
          iterable_locals = add_set(iterable_locals, local);
        }
        if (loop_kind === "async_iterable" || loop_kind === "mod") {
          async_iterable_locals = add_set(async_iterable_locals, local);
        }
        continue;
      }
      if (binding.type !== "ImportSpecifier") continue;
      if (binding.importKind === "type") {
        const imported = import_name(binding);
        if (
          imported === "Maybe" &&
          (loop_kind === "mod" || loop_kind === "maybe")
        ) tagged_type_names = set_map(tagged_type_names, local, "maybe");
        else if (
          imported === "Either" &&
          (loop_kind === "mod" || loop_kind === "either")
        ) tagged_type_names = set_map(tagged_type_names, local, "either");
        else if (
          imported === "Validation" &&
          (loop_kind === "mod" || loop_kind === "validation")
        ) tagged_type_names = set_map(tagged_type_names, local, "validation");
        else if (
          imported === "List" && (loop_kind === "mod" || loop_kind === "list")
        ) tagged_type_names = set_map(tagged_type_names, local, "list");
        continue;
      }
      const imported = import_name(binding)!;
      if (
        (loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "traversable") && imported === "Traversable"
      ) {
        traversable_objects = add_set(traversable_objects, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "traversal") &&
        imported === "traverse_sequential"
      ) {
        traverse_sequential_functions = add_set(
          traverse_sequential_functions,
          local,
        );
      }
      if (
        (loop_kind === "mod" || loop_kind === "tagged") && imported === "match"
      ) {
        match_functions = add_set(match_functions, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "ParallelTask"
      ) parallel_task_dictionaries = add_set(parallel_task_dictionaries, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "parallel"
      ) task_parallel_functions = add_set(task_parallel_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "sequential"
      ) task_sequential_functions = add_set(task_sequential_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "from_fn"
      ) task_from_fn_functions = add_set(task_from_fn_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "succeed"
      ) task_succeed_functions = add_set(task_succeed_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "run_task"
      ) task_run_functions = add_set(task_run_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "run_task_exit"
      ) task_run_exit_functions = add_set(task_run_exit_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "task") &&
        imported === "is_task_cancellation"
      ) {
        task_is_cancellation_functions = add_set(
          task_is_cancellation_functions,
          local,
        );
      }
      if (
        (loop_kind === "mod" || loop_kind === "list") && imported === "List"
      ) {
        list_constructors = add_set(list_constructors, local);
        tagged_type_names = set_map(tagged_type_names, local, "list");
      }
      if ((loop_kind === "mod" || loop_kind === "list") && imported === "Nil") {
        nil_constructors = add_set(nil_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "list") &&
        (imported === "Cons" || imported === "cons")
      ) {
        cons_constructors = add_set(cons_constructors, local);
      }
      if (loop_kind === "list" && imported === "from_array") {
        list_from_array_functions = add_set(list_from_array_functions, local);
      }
      if (loop_kind === "mod" && imported === "list") {
        list_namespaces = add_set(list_namespaces, local);
      }
      if (loop_kind === "mod" && imported === "array") {
        array_namespaces = add_set(array_namespaces, local);
      }
      if (
        loop_kind === "async_iterable" ||
        (loop_kind === "mod" && imported === "async_iterable")
      ) {
        async_iterable_locals = add_set(async_iterable_locals, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "validation") &&
        (imported === "Validation" || imported === "Valid" ||
          imported === "Invalid" || imported === "InvalidMessages" ||
          imported === "valid" || imported === "invalid")
      ) {
        validation_constructors = add_set(validation_constructors, local);
        if (imported === "Validation") {
          tagged_type_names = set_map(tagged_type_names, local, "validation");
          direct_validation_dictionaries = add_set(
            direct_validation_dictionaries,
            local,
          );
        } else if (imported === "Valid") {
          valid_constructors = add_set(valid_constructors, local);
        } else if (imported === "Invalid") {
          invalid_constructors = add_set(invalid_constructors, local);
        } else if (imported === "InvalidMessages") {
          invalid_messages_constructors = add_set(
            invalid_messages_constructors,
            local,
          );
        }
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") && imported === "Maybe"
      ) tagged_type_names = set_map(tagged_type_names, local, "maybe");
      if (
        (loop_kind === "mod" || loop_kind === "either") && imported === "Either"
      ) tagged_type_names = set_map(tagged_type_names, local, "either");
      if (
        loop_kind === "iterable" ||
        ((loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "foldable") &&
          (imported === "iterable" || imported === "Foldable"))
      ) {
        iterable_locals = add_set(iterable_locals, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "applicative") && imported === "collect"
      ) {
        collect_functions = add_set(collect_functions, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "applicative") && imported === "Applicative"
      ) {
        applicative_objects = add_set(applicative_objects, local);
      }
      if (
        loop_kind !== undefined &&
        (imported === "Maybe" || imported === "Either" ||
          imported === "Identity" || imported === "Task") &&
        (loop_kind === "mod" || loop_kind === imported.toLowerCase())
      ) {
        loop_dictionaries = add_set(loop_dictionaries, local);
        if (imported === "Task") loop_tasks = add_set(loop_tasks, local);
        if (imported === "Maybe") {
          direct_maybe_dictionaries = add_set(direct_maybe_dictionaries, local);
        }
        if (imported === "Either") {
          direct_either_dictionaries = add_set(
            direct_either_dictionaries,
            local,
          );
        }
        if (imported === "Identity") {
          direct_identity_dictionaries = add_set(
            direct_identity_dictionaries,
            local,
          );
        }
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") && imported === "Just"
      ) {
        just_constructors = add_set(just_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") && imported === "Nothing"
      ) {
        nothing_constructors = add_set(nothing_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") &&
        imported === "from_nullable"
      ) from_nullable_functions = add_set(from_nullable_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "maybe") &&
        imported === "from_maybe"
      ) from_maybe_functions = add_set(from_maybe_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "maybe") &&
        imported === "to_nullable"
      ) to_nullable_functions = add_set(to_nullable_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "maybe") &&
        imported === "get_or_else"
      ) {
        maybe_get_or_else_functions = add_set(
          maybe_get_or_else_functions,
          local,
        );
      }
      if (
        (loop_kind === "mod" || loop_kind === "maybe") &&
        imported === "maybe"
      ) maybe_fold_functions = add_set(maybe_fold_functions, local);
      if (loop_kind === "maybe" && imported === "filter") {
        maybe_filter_functions = add_set(maybe_filter_functions, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "either") &&
        imported === "either"
      ) either_fold_functions = add_set(either_fold_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "either") &&
        imported === "from_right"
      ) {
        either_from_right_functions = add_set(
          either_from_right_functions,
          local,
        );
      }
      if (
        (loop_kind === "mod" || loop_kind === "either") &&
        imported === "from_left"
      ) either_from_left_functions = add_set(either_from_left_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "either") &&
        imported === "recover_or_else"
      ) either_recover_functions = add_set(either_recover_functions, local);
      if (
        (loop_kind === "mod" || loop_kind === "typeclasses" ||
          loop_kind === "foldable") && imported === "Foldable"
      ) foldable_objects = add_set(foldable_objects, local);
      if (loop_kind === "array" && imported === "from_array") {
        array_from_array_functions = add_set(array_from_array_functions, local);
      }
      if (loop_kind === "array" && imported === "from_array_view") {
        array_view_functions = add_set(array_view_functions, local);
      }
      if (loop_kind === "array" && imported === "to_array") {
        array_to_array_functions = add_set(array_to_array_functions, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "typed_array") &&
        (imported === "TypedArrayT" || imported === "from_typed_array")
      ) {
        typed_array_constructors = add_set(typed_array_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "set") &&
        (imported === "SetT" || imported === "from_set")
      ) {
        set_constructors = add_set(set_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "map") &&
        (imported === "MapT" || imported === "from_map_view" ||
          imported === "from_snapshot")
      ) {
        map_constructors = add_set(map_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "record") &&
        (imported === "RecordT" || imported === "from_record_view" ||
          imported === "from_snapshot")
      ) {
        record_constructors = add_set(record_constructors, local);
      }
      if ((loop_kind === "mod" || loop_kind === "stm") && imported === "Stm") {
        stm_dictionaries = add_set(stm_dictionaries, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "stm") &&
        imported === "atomically"
      ) {
        stm_atomically_functions = add_set(stm_atomically_functions, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "stm") &&
        stm_primitive_set.has(imported as StmPrimitiveName)
      ) {
        stm_primitive_functions = set_map(
          stm_primitive_functions,
          local,
          imported as StmPrimitiveName,
        );
      }
      if (
        (loop_kind === "mod" || loop_kind === "either") && imported === "Left"
      ) {
        left_constructors = add_set(left_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "either") && imported === "Right"
      ) {
        right_constructors = add_set(right_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "identity") &&
        (imported === "identity" || imported === "Identity")
      ) {
        identity_constructors = add_set(identity_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "array") && imported === "ArrayT"
      ) {
        array_constructors = add_set(array_constructors, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "reader") && imported === "Reader"
      ) {
        direct_reader_dictionaries = add_set(direct_reader_dictionaries, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "state") && imported === "State"
      ) {
        direct_state_dictionaries = add_set(direct_state_dictionaries, local);
      }
      if (
        (loop_kind === "mod" || loop_kind === "writer") && imported === "Writer"
      ) {
        direct_writer_dictionaries = add_set(direct_writer_dictionaries, local);
      }
      if (available_terminals?.has(imported as TerminalFunctionName)) {
        terminal_functions = set_map(terminal_functions, local, {
          imported: imported as TerminalFunctionName,
        });
      }
      if (available_primitives?.has(imported as PrimitiveFunctionName)) {
        primitive_functions = set_map(
          primitive_functions,
          local,
          imported as PrimitiveFunctionName,
        );
      }
      if (available_except_primitives?.has(imported as ExceptPrimitiveName)) {
        except_primitives = set_map(
          except_primitives,
          local,
          imported as ExceptPrimitiveName,
        );
      }
      if (available_state_evals?.has(imported as StateEvalName)) {
        state_eval_functions = set_map(
          state_eval_functions,
          local,
          imported as StateEvalName,
        );
      }
      if (available_op_runners?.has(imported as OperationRunnerName)) {
        operation_runners = set_map(
          operation_runners,
          local,
          imported as OperationRunnerName,
        );
      }
      if (available_op_helpers?.has(imported as OperationHelperName)) {
        operation_helpers = set_map(
          operation_helpers,
          local,
          imported as OperationHelperName,
        );
      }
      const factory_kind = cell_factory_kind_for(imported);
      if (
        factory_kind !== undefined &&
        available_cell_factories?.has(factory_kind)
      ) {
        cell_factories = set_map(cell_factories, local, factory_kind);
      }
      if (available_cell_runners?.has(imported as CellRunnerName)) {
        cell_runners = set_map(cell_runners, local, imported as CellRunnerName);
      }
      const provider_kind = cell_provider_kind_for(imported);
      if (
        provider_kind !== undefined &&
        available_cell_providers?.has(provider_kind)
      ) {
        cell_providers = set_map(cell_providers, local, provider_kind);
      }
      if (!is_library) continue;
      switch (imported) {
        case "Do":
          do_names = add_set(do_names, local);
          break;
        case "Program":
          program_names = add_set(program_names, local);
          program_module ??= specifier;
          break;
        case "Effect":
          effect_names = add_set(effect_names, local);
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
    from_nullable_functions,
    from_maybe_functions,
    to_nullable_functions,
    maybe_get_or_else_functions,
    maybe_fold_functions,
    maybe_filter_functions,
    direct_either_dictionaries,
    left_constructors,
    right_constructors,
    either_fold_functions,
    either_from_right_functions,
    either_from_left_functions,
    either_recover_functions,
    direct_identity_dictionaries,
    identity_constructors,
    array_constructors,
    array_from_array_functions,
    array_view_functions,
    array_to_array_functions,
    array_namespaces,
    typed_array_constructors,
    set_constructors,
    map_constructors,
    record_constructors,
    foldable_objects,
    foldable_namespaces,
    stm_dictionaries,
    stm_namespaces,
    stm_atomically_functions,
    stm_primitive_functions,
    list_constructors,
    list_from_array_functions,
    list_namespaces,
    nil_constructors,
    cons_constructors,
    direct_reader_dictionaries,
    direct_state_dictionaries,
    direct_writer_dictionaries,
    parallel_task_dictionaries,
    task_parallel_functions,
    task_sequential_functions,
    task_from_fn_functions,
    task_succeed_functions,
    task_run_functions,
    task_run_exit_functions,
    task_is_cancellation_functions,
    task_namespaces,
    traversable_objects,
    traversable_namespaces,
    traverse_sequential_functions,
    traverse_sequential_namespaces,
    match_functions,
    match_namespaces,
    tagged_type_names,
    validation_constructors,
    direct_validation_dictionaries,
    valid_constructors,
    invalid_constructors,
    invalid_messages_constructors,
    collect_functions,
    collect_namespaces,
    applicative_objects,
    applicative_namespaces,
    iterable_locals,
    async_iterable_locals,
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
  const candidates = new Set<string>(headers.import_declarations.keys());
  if (scope_declarations.size > 0) {
    for (const name of scope_declarations.keys()) candidates.add(name);
  }
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
        headers.from_nullable_functions.delete(name);
        headers.from_maybe_functions.delete(name);
        headers.to_nullable_functions.delete(name);
        headers.maybe_get_or_else_functions.delete(name);
        headers.maybe_fold_functions.delete(name);
        headers.maybe_filter_functions.delete(name);
        headers.direct_either_dictionaries.delete(name);
        headers.left_constructors.delete(name);
        headers.right_constructors.delete(name);
        headers.either_fold_functions.delete(name);
        headers.either_from_right_functions.delete(name);
        headers.either_from_left_functions.delete(name);
        headers.either_recover_functions.delete(name);
        headers.direct_identity_dictionaries.delete(name);
        headers.identity_constructors.delete(name);
        headers.array_constructors.delete(name);
        headers.array_from_array_functions.delete(name);
        headers.array_view_functions.delete(name);
        headers.array_to_array_functions.delete(name);
        headers.array_namespaces.delete(name);
        headers.typed_array_constructors.delete(name);
        headers.set_constructors.delete(name);
        headers.map_constructors.delete(name);
        headers.record_constructors.delete(name);
        headers.foldable_objects.delete(name);
        headers.foldable_namespaces.delete(name);
        headers.stm_dictionaries.delete(name);
        headers.stm_namespaces.delete(name);
        headers.stm_atomically_functions.delete(name);
        headers.stm_primitive_functions.delete(name);
        headers.list_constructors.delete(name);
        headers.list_from_array_functions.delete(name);
        headers.list_namespaces.delete(name);
        headers.nil_constructors.delete(name);
        headers.cons_constructors.delete(name);
        headers.direct_reader_dictionaries.delete(name);
        headers.direct_state_dictionaries.delete(name);
        headers.direct_writer_dictionaries.delete(name);
        headers.parallel_task_dictionaries.delete(name);
        headers.task_parallel_functions.delete(name);
        headers.task_sequential_functions.delete(name);
        headers.task_from_fn_functions.delete(name);
        headers.task_succeed_functions.delete(name);
        headers.task_run_functions.delete(name);
        headers.task_run_exit_functions.delete(name);
        headers.task_is_cancellation_functions.delete(name);
        headers.task_namespaces.delete(name);
        headers.traversable_objects.delete(name);
        headers.traversable_namespaces.delete(name);
        headers.traverse_sequential_functions.delete(name);
        headers.traverse_sequential_namespaces.delete(name);
        headers.match_functions.delete(name);
        headers.match_namespaces.delete(name);
        headers.validation_constructors.delete(name);
        headers.direct_validation_dictionaries.delete(name);
        headers.valid_constructors.delete(name);
        headers.invalid_constructors.delete(name);
        headers.invalid_messages_constructors.delete(name);
        headers.collect_functions.delete(name);
        headers.collect_namespaces.delete(name);
        headers.applicative_objects.delete(name);
        headers.applicative_namespaces.delete(name);
        headers.iterable_locals.delete(name);
        headers.async_iterable_locals.delete(name);
        headers.loop_dictionaries.delete(name);
        headers.loop_tasks.delete(name);
      }
      if (
        headers.loop_specifier === undefined &&
        headers.loop_dictionaries.size > 0
      ) {
        headers.loop_dictionaries.clear();
      }
      const scopes = scope_declarations.size === 0
        ? headers.program_names
        : (() => {
          const next = new Set(headers.program_names);
          for (const name of scope_declarations.keys()) {
            if (counts.get(name) === 1 && !tdz_violated.has(name)) {
              next.add(name);
            }
          }
          return next;
        })();
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
          from_nullable_functions: headers.from_nullable_functions,
          from_maybe_functions: headers.from_maybe_functions,
          to_nullable_functions: headers.to_nullable_functions,
          maybe_get_or_else_functions: headers.maybe_get_or_else_functions,
          maybe_fold_functions: headers.maybe_fold_functions,
          maybe_filter_functions: headers.maybe_filter_functions,
          direct_either_dictionaries: headers.direct_either_dictionaries,
          left_constructors: headers.left_constructors,
          right_constructors: headers.right_constructors,
          either_fold_functions: headers.either_fold_functions,
          either_from_right_functions: headers.either_from_right_functions,
          either_from_left_functions: headers.either_from_left_functions,
          either_recover_functions: headers.either_recover_functions,
          direct_identity_dictionaries: headers.direct_identity_dictionaries,
          identity_constructors: headers.identity_constructors,
          array_constructors: headers.array_constructors,
          array_from_array_functions: headers.array_from_array_functions,
          array_view_functions: headers.array_view_functions,
          array_to_array_functions: headers.array_to_array_functions,
          array_namespaces: headers.array_namespaces,
          typed_array_constructors: headers.typed_array_constructors,
          set_constructors: headers.set_constructors,
          map_constructors: headers.map_constructors,
          record_constructors: headers.record_constructors,
          foldable_objects: headers.foldable_objects,
          foldable_namespaces: headers.foldable_namespaces,
          stm_dictionaries: headers.stm_dictionaries,
          stm_namespaces: headers.stm_namespaces,
          stm_atomically_functions: headers.stm_atomically_functions,
          stm_primitive_functions: headers.stm_primitive_functions,
          list_constructors: headers.list_constructors,
          list_from_array_functions: headers.list_from_array_functions,
          list_namespaces: headers.list_namespaces,
          nil_constructors: headers.nil_constructors,
          cons_constructors: headers.cons_constructors,
          direct_reader_dictionaries: headers.direct_reader_dictionaries,
          direct_state_dictionaries: headers.direct_state_dictionaries,
          direct_writer_dictionaries: headers.direct_writer_dictionaries,
          parallel_task_dictionaries: headers.parallel_task_dictionaries,
          task_parallel_functions: headers.task_parallel_functions,
          task_sequential_functions: headers.task_sequential_functions,
          task_from_fn_functions: headers.task_from_fn_functions,
          task_succeed_functions: headers.task_succeed_functions,
          task_run_functions: headers.task_run_functions,
          task_run_exit_functions: headers.task_run_exit_functions,
          task_is_cancellation_functions:
            headers.task_is_cancellation_functions,
          task_namespaces: headers.task_namespaces,
          traversable_objects: headers.traversable_objects,
          traversable_namespaces: headers.traversable_namespaces,
          traverse_sequential_functions: headers.traverse_sequential_functions,
          traverse_sequential_namespaces:
            headers.traverse_sequential_namespaces,
          match_functions: headers.match_functions,
          match_namespaces: headers.match_namespaces,
          tagged_type_names: headers.tagged_type_names,
          validation_constructors: headers.validation_constructors,
          direct_validation_dictionaries:
            headers.direct_validation_dictionaries,
          valid_constructors: headers.valid_constructors,
          invalid_constructors: headers.invalid_constructors,
          invalid_messages_constructors: headers.invalid_messages_constructors,
          collect_functions: headers.collect_functions,
          collect_namespaces: headers.collect_namespaces,
          applicative_objects: headers.applicative_objects,
          applicative_namespaces: headers.applicative_namespaces,
          iterable_locals: headers.iterable_locals,
          async_iterable_locals: headers.async_iterable_locals,
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

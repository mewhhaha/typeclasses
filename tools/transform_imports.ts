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
const effects_terminals = new Set<TerminalFunctionName>(["run"]);
const reader_terminals = new Set<TerminalFunctionName>([
  "run_reader",
  "run_reader_terminal",
]);
const state_terminals = new Set<TerminalFunctionName>([
  "run_state",
  "run_state_terminal",
]);
const writer_terminals = new Set<TerminalFunctionName>([
  "run_writer",
  "run_writer_terminal",
]);
const except_terminals = new Set<TerminalFunctionName>(["run_except"]);
const reader_primitives = new Set<PrimitiveFunctionName>(["ask", "asks"]);
const state_primitives = new Set<PrimitiveFunctionName>([
  "get",
  "gets",
  "put",
  "modify",
]);
const writer_primitives = new Set<PrimitiveFunctionName>(["writer", "tell"]);
const reader_cell_kinds = new Set<CellFactoryKind>(["reader"]);
const state_cell_kinds = new Set<CellFactoryKind>(["state"]);
const writer_cell_kinds = new Set<CellFactoryKind>(["writer"]);

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
    "prelude",
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
for (
  const name of [
    "alternative",
    "applicative",
    "bifunctor",
    "foldable",
    "monad_error",
    "traversable",
  ]
) {
  try {
    const url = new URL(`../src/typeclasses/${name}.ts`, import.meta.url);
    source_specifiers.set(url.href, name);
    source_specifiers.set(url.pathname, name);
  } catch { /* Bundled data URLs use package or relative matches. */ }
}

const source_module_re = /^(?:\.\.?\/)+src\/(?:typeclasses\/)?(\w+)(?:\.ts)?$/;
const package_module_re =
  /^(?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?(?:\/(\w+))?\/?$/;
const package_any_re = /^(?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?(?:\/.*)?$/;
const loop_source_re = /^(?:\.\.?\/)+src\/(?:mod|typeclasses)\.ts$/;
const loop_pkg_re =
  /^(?:@mewhhaha\/typeclasses|jsr:@mewhhaha\/typeclasses(?:@[^/]+)?)$/;

function source_module(specifier: string): string | undefined {
  const hit = source_specifiers.get(specifier);
  if (hit !== undefined) return hit;
  if (!specifier.includes("src/")) return undefined;
  return source_module_re.exec(specifier)?.[1];
}
function package_module(specifier: string): string | undefined {
  if (!specifier.includes("@mewhhaha/typeclasses")) return undefined;
  const match = package_module_re.exec(specifier);
  if (match === null) return undefined;
  return match[1] ?? "mod";
}
function is_library_kind(
  mod_kind: string | undefined,
  specifier: string,
  config: TransformConfig,
): boolean {
  if (config.library_specifiers?.includes(specifier)) return true;
  if (
    mod_kind === "mod" || mod_kind === "effects" || mod_kind === "typeclasses"
  ) return true;
  return specifier.includes("@mewhhaha/typeclasses") &&
    package_any_re.test(specifier);
}
function terminal_exports_for(
  mod_kind: string | undefined,
  specifier: string,
  config: TransformConfig,
): ReadonlySet<TerminalFunctionName> | undefined {
  if (config.terminal_library_specifiers?.includes(specifier)) return terminals;
  switch (mod_kind) {
    case "mod":
      return terminals;
    case "effects":
      return effects_terminals;
    case "reader":
      return reader_terminals;
    case "state":
      return state_terminals;
    case "writer":
      return writer_terminals;
    case "except":
      return except_terminals;
  }
}
function primitive_exports_for(
  mod_kind: string | undefined,
): ReadonlySet<PrimitiveFunctionName> | undefined {
  switch (mod_kind) {
    case "mod":
      return primitives;
    case "reader":
      return reader_primitives;
    case "state":
      return state_primitives;
    case "writer":
      return writer_primitives;
  }
}

const cell_factory_kinds = new Set<CellFactoryKind>([
  "reader",
  "state",
  "writer",
]);

function cell_factory_exports_for(
  mod_kind: string | undefined,
): ReadonlySet<CellFactoryKind> | undefined {
  switch (mod_kind) {
    case "mod":
      return cell_factory_kinds;
    case "reader":
      return reader_cell_kinds;
    case "state":
      return state_cell_kinds;
    case "writer":
      return writer_cell_kinds;
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
  readonly maybe_to_either_functions: Set<string>;
  readonly direct_either_dictionaries: Set<string>;
  readonly left_constructors: Set<string>;
  readonly right_constructors: Set<string>;
  readonly either_fold_functions: Set<string>;
  readonly either_from_right_functions: Set<string>;
  readonly either_from_left_functions: Set<string>;
  readonly either_recover_functions: Set<string>;
  readonly either_hush_functions: Set<string>;
  readonly either_note_functions: Set<string>;
  readonly either_from_number_functions: Set<string>;
  readonly either_try_catch_functions: Set<string>;
  readonly either_is_left_functions: Set<string>;
  readonly either_is_right_functions: Set<string>;
  readonly either_map_left_functions: Set<string>;
  readonly either_bind_widen_functions: Set<string>;
  readonly direct_identity_dictionaries: Set<string>;
  readonly identity_constructors: Set<string>;
  readonly array_constructors: Set<string>;
  readonly array_from_array_functions: Set<string>;
  readonly array_view_functions: Set<string>;
  readonly array_to_array_functions: Set<string>;
  readonly array_indexed_functions: Set<string>;
  readonly array_flat_map_streaming_functions: Set<string>;
  readonly array_namespaces: Set<string>;
  readonly typed_array_constructors: Set<string>;
  readonly set_constructors: Set<string>;
  readonly map_constructors: Set<string>;
  readonly record_constructors: Set<string>;
  readonly foldable_objects: Set<string>;
  readonly foldable_namespaces: Set<string>;
  readonly alternative_objects: Set<string>;
  readonly alternative_namespaces: Set<string>;
  readonly bifunctor_objects: Set<string>;
  readonly bifunctor_namespaces: Set<string>;
  readonly monad_error_objects: Set<string>;
  readonly monad_error_namespaces: Set<string>;
  readonly stm_dictionaries: Set<string>;
  readonly stm_namespaces: Set<string>;
  readonly stm_atomically_functions: Set<string>;
  readonly stm_primitive_functions: Map<string, StmPrimitiveName>;
  readonly stm_retry_classes: Set<string>;
  readonly stm_error_classes: Set<string>;
  readonly list_constructors: Set<string>;
  readonly list_from_array_functions: Set<string>;
  readonly list_to_array_functions: Set<string>;
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
  readonly task_from_promise_functions: Set<string>;
  readonly task_succeed_functions: Set<string>;
  readonly task_run_functions: Set<string>;
  readonly task_run_exit_functions: Set<string>;
  readonly task_traverse_functions: Set<string>;
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
  readonly validation_to_either_functions: Set<string>;
  readonly validation_map_error_functions: Set<string>;
  readonly collect_functions: Set<string>;
  readonly collect_namespaces: Set<string>;
  readonly applicative_objects: Set<string>;
  readonly applicative_namespaces: Set<string>;
  readonly prelude_fmap_functions: Set<string>;
  readonly prelude_bind_functions: Set<string>;
  readonly prelude_ap_functions: Set<string>;
  readonly prelude_lift_functions: Set<string>;
  readonly prelude_traverse_functions: Set<string>;
  readonly prelude_sequence_functions: Set<string>;
  readonly prelude_foldl_functions: Set<string>;
  readonly prelude_fold_while_functions: Set<string>;
  readonly prelude_some_functions: Set<string>;
  readonly prelude_find_functions: Set<string>;
  readonly prelude_to_array_functions: Set<string>;
  readonly prelude_length_functions: Set<string>;
  readonly prelude_sum_functions: Set<string>;
  readonly prelude_product_functions: Set<string>;
  readonly prelude_alt_functions: Set<string>;
  readonly prelude_concat_functions: Set<string>;
  readonly prelude_namespaces: Set<string>;
  readonly iterable_locals: Set<string>;
  readonly async_iterable_locals: Set<string>;
  readonly program_module?: string;
  readonly import_declarations: Map<string, ImportDeclaration>;
  readonly import_nodes: readonly ImportDeclaration[];
  readonly non_import_count: number;
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

function is_ident_char_code(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) || code === 95 || code === 36;
}

function is_space_code(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function find_next_token_match(
  source: string,
  needle: string,
  kind: 0 | 1 | 2, // 0 = ident, 1 = .prop, 2 = raw/match(
  from: number,
  len: number,
): number {
  let cursor = from;
  const nlen = needle.length;
  while (cursor < len) {
    const pos = source.indexOf(needle, cursor);
    if (pos < 0) return -1;
    if (kind === 0) {
      const left_ok = pos === 0 ||
        !is_ident_char_code(source.charCodeAt(pos - 1));
      const end = pos + nlen;
      const right_ok = end >= len ||
        !is_ident_char_code(source.charCodeAt(end));
      if (left_ok && right_ok) return pos;
      cursor = pos + 1;
      continue;
    }
    if (kind === 1) {
      const end = pos + nlen;
      if (end < len && is_ident_char_code(source.charCodeAt(end))) {
        cursor = pos + 1;
        continue;
      }
      let k = pos - 1;
      while (k >= 0 && is_space_code(source.charCodeAt(k))) k -= 1;
      if (k >= 0 && source.charCodeAt(k) === 46 /* . */) return k;
      cursor = pos + 1;
      continue;
    }
    // kind === 2: e.g. "match(" or raw prefix
    const end = pos + nlen;
    const last = needle.charCodeAt(nlen - 1);
    if (
      is_ident_char_code(last) && end < len &&
      is_ident_char_code(source.charCodeAt(end))
    ) {
      cursor = pos + 1;
      continue;
    }
    return pos;
  }
  return -1;
}

const active_regex_cache = new Map<string, RegExp>();

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
  abort_if_dense = false,
): number[] | undefined {
  const seen = new Set<string>();
  const simd_needles: string[] = [];
  const simd_kinds: (0 | 1 | 2)[] = [];
  const ident_parts: string[] = [];
  const other_parts: string[] = [];
  const src_len = source.length;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.length === 0 || seen.has(tok)) continue;
    seen.add(tok);
    if (ident_token_re.test(tok)) {
      if (source.indexOf(tok, start_offset) < 0) continue;
      ident_parts.push(tok);
      if (simd_needles.length <= 12) {
        simd_needles.push(tok);
        simd_kinds.push(0);
      }
    } else if (tok.charCodeAt(0) === 46 /* . */) {
      const prop = tok.slice(1);
      if (prop.length === 0 || source.indexOf(prop, start_offset) < 0) continue;
      other_parts.push(tok);
      if (simd_needles.length <= 12) {
        simd_needles.push(prop);
        simd_kinds.push(1);
      }
    } else {
      if (source.indexOf(tok, start_offset) < 0) continue;
      other_parts.push(tok);
      if (simd_needles.length <= 12) {
        simd_needles.push(tok);
        simd_kinds.push(2);
      }
    }
  }
  const unique_present = ident_parts.length + other_parts.length;
  if (unique_present === 0) return [];

  const total = body.length;
  let stmt_idx = 0;
  while (stmt_idx < total && body[stmt_idx].end <= start_offset) {
    stmt_idx += 1;
  }
  const first_non_import = stmt_idx;
  const dense_limit = abort_if_dense && total < 256 ? 24 : 0;
  const active: number[] = [];

  // Fast SIMD path for small present token sets: zero RegExp compile cost!
  if (unique_present <= 10) {
    let active_toks = simd_needles.length;
    const next_pos: number[] = [];
    for (let i = 0; i < active_toks; i += 1) {
      const p = find_next_token_match(
        source,
        simd_needles[i],
        simd_kinds[i],
        start_offset,
        src_len,
      );
      if (p < 0) {
        active_toks -= 1;
        simd_needles[i] = simd_needles[active_toks];
        simd_kinds[i] = simd_kinds[active_toks];
        i -= 1;
      } else {
        next_pos.push(p);
      }
    }
    if (active_toks === 0) return [];
    let cursor = start_offset;
    while (stmt_idx < total && active_toks > 0) {
      let min_pos = src_len;
      for (let i = 0; i < active_toks; i += 1) {
        let p = next_pos[i];
        if (p < cursor) {
          p = find_next_token_match(
            source,
            simd_needles[i],
            simd_kinds[i],
            cursor,
            src_len,
          );
          if (p < 0) {
            active_toks -= 1;
            simd_needles[i] = simd_needles[active_toks];
            simd_kinds[i] = simd_kinds[active_toks];
            next_pos[i] = next_pos[active_toks];
            i -= 1;
            continue;
          }
          next_pos[i] = p;
        }
        if (p < min_pos) min_pos = p;
      }
      if (active_toks === 0 || min_pos >= src_len) break;
      if (min_pos < body[stmt_idx].start) {
        cursor = body[stmt_idx].start;
        continue;
      }
      if (min_pos >= body[stmt_idx].end) {
        let lo = stmt_idx + 1;
        let hi = total;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (body[mid].end <= min_pos) lo = mid + 1;
          else hi = mid;
        }
        stmt_idx = lo;
        if (stmt_idx >= total) break;
        if (min_pos < body[stmt_idx].start) {
          cursor = body[stmt_idx].start;
          continue;
        }
      }
      const stmt = body[stmt_idx];
      if (stmt.type !== "ImportDeclaration") {
        active.push(stmt_idx);
        if (
          dense_limit > 0 && active.length === dense_limit &&
          stmt_idx - first_non_import + 1 === dense_limit
        ) return undefined;
      }
      cursor = stmt.end;
      stmt_idx += 1;
    }
    return active;
  }

  ident_parts.sort();
  other_parts.sort();
  const branches: string[] = [];
  if (ident_parts.length > 0) {
    branches.push(
      "(?<![$\\w])(?:" + ident_parts.map(escape_regex_token).join("|") +
        ")(?![$\\w])",
    );
  }
  if (other_parts.length > 0) {
    const escaped_others: string[] = [];
    for (let i = 0; i < other_parts.length; i += 1) {
      const tok = other_parts[i];
      let escaped = tok.charCodeAt(0) === 46 /* . */
        ? "\\.\\s*" + escape_regex_token(tok.slice(1))
        : escape_regex_token(tok);
      const last = tok.charCodeAt(tok.length - 1);
      if (is_ident_char_code(last)) escaped += "(?![$\\w])";
      escaped_others.push(escaped);
    }
    branches.push("(?:" + escaped_others.join("|") + ")");
  }
  const pattern = branches.join("|");
  let re = active_regex_cache.get(pattern);
  if (re === undefined) {
    if (active_regex_cache.size >= 128) active_regex_cache.clear();
    re = new RegExp(pattern, "g");
    active_regex_cache.set(pattern, re);
  }
  re.lastIndex = start_offset;
  let match: RegExpExecArray | null;
  while (stmt_idx < total && (match = re.exec(source)) !== null) {
    const pos = match.index;
    if (pos < body[stmt_idx].start) continue;
    if (pos >= body[stmt_idx].end) {
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
      if (
        dense_limit > 0 && active.length === dense_limit &&
        stmt_idx - first_non_import + 1 === dense_limit
      ) return undefined;
    }
    re.lastIndex = stmt.end;
    stmt_idx += 1;
  }
  return active;
}

const do_or_program_re = /\b(?:Do|Program)\b/;

/** Cheap pre-parse filter shared by the CLI and bundler plugins. */
export function might_contain_transform_target(
  source: string,
  config?: TransformConfig,
): boolean {
  // Unimported Do/Program diagnostic escape hatch only triggers on `function*`.
  const has_do_or_prog = source.includes("Do") || source.includes("Program");
  if (
    has_do_or_prog && source.includes("function") && source.includes("*") &&
    do_or_program_re.test(source)
  ) return true;
  if (!source.includes("import")) return false;
  if (
    config?.library_specifiers === undefined &&
    config?.terminal_library_specifiers === undefined &&
    !source.includes("@mewhhaha/typeclasses") &&
    !source.includes("src/") &&
    !source.includes("\\u")
  ) return false;
  if (has_do_or_prog && do_or_program_re.test(source)) return true;
  // Prefix-gated runner/handler checks (~5 SIMD scans on unmatched files).
  if (
    (source.includes("run_") &&
      (source.includes("run_reader") || source.includes("run_state") ||
        source.includes("run_writer") || source.includes("run_cells") ||
        source.includes("run_except") || source.includes("run_task"))) ||
    (source.includes("prepare_") &&
      (source.includes("prepare_cells") ||
        source.includes("prepare_handle_cells") ||
        source.includes("prepare_operations"))) ||
    (source.includes("handle_") &&
      (source.includes("handle_cells") || source.includes("handle_operations")))
  ) {
    if (
      source.includes("run_cells") || source.includes("prepare_cells") ||
      source.includes("_terminal") || source.includes("run_task") ||
      /\brun\b/.test(source)
    ) return true;
  }
  if (
    source.includes("_state") &&
    (source.includes("eval_state") || source.includes("exec_state"))
  ) return true;
  if (
    (source.includes("lift") &&
      (source.includes("Applicative") || source.includes("prelude") ||
        /\blift\s*\(/.test(source))) ||
    (source.includes("collect") && /\bcollect\s*\(/.test(source)) ||
    (source.includes("traverse") &&
      (source.includes("Traversable") || source.includes("traverse_") ||
        source.includes("prelude") || /\.\s*traverse\b/.test(source))) ||
    (source.includes("sequence") && source.includes("prelude")) ||
    (source.includes("match") &&
      (/\.\s*match\s*\(\s*\{/.test(source) ||
        /(?:^|[^.\w$])match\s*\(/.test(source))) ||
    (source.includes("Effect") &&
      (source.includes("interpret") || source.includes("handle_with"))) ||
    source.includes("atomically") ||
    (source.includes("from_") &&
      (source.includes("from_maybe") || source.includes("from_right") ||
        source.includes("from_left") || source.includes("from_number") ||
        source.includes("from_fn") || source.includes("from_promise"))) ||
    (source.includes("_or_else") &&
      (source.includes("get_or_else") || source.includes("recover_or_else"))) ||
    (source.includes("to_") &&
      (source.includes("to_nullable") || source.includes("to_either") ||
        source.includes("to_array"))) ||
    source.includes("maybe(") || source.includes("either(") ||
    source.includes("hush") || source.includes("note(") ||
    source.includes("map_left") || source.includes("bind_widen") ||
    source.includes("try_catch") || source.includes("map_error") ||
    source.includes("is_left") || source.includes("is_right") ||
    source.includes("fmap") || source.includes("foldl") ||
    source.includes("Alternative") || source.includes("Bifunctor") ||
    source.includes("MonadError") || source.includes("parallel(") ||
    source.includes("indexed(") || source.includes("flat_map_streaming")
  ) return true;
  // Gate collection/monad chain scans on method/Foldable operators FIRST.
  if (
    source.includes(".map(") || source.includes(".bind(") ||
    source.includes(".ap(") || source.includes(".concat(") ||
    source.includes(".alt(") || source.includes(".bimap(") ||
    source.includes(".catch_error(") || source.includes(".fold(") ||
    source.includes("Foldable") || source.includes("fold_while") ||
    source.includes("prelude")
  ) {
    if (
      source.includes("Just") || source.includes("Nothing") ||
      source.includes("Right") || source.includes("Left") ||
      source.includes("Maybe") || source.includes("Either") ||
      source.includes("Valid") || source.includes("Invalid") ||
      source.includes("Validation") || source.includes("from_nullable") ||
      source.includes("ArrayT") || source.includes("from_array") ||
      source.includes("List") || source.includes("TypedArrayT") ||
      source.includes("from_typed_array") || source.includes("SetT") ||
      source.includes("from_set") || source.includes("MapT") ||
      source.includes("from_map_view") || source.includes("RecordT") ||
      source.includes("from_record_view") || source.includes("from_snapshot") ||
      source.includes("Task") || source.includes("succeed") ||
      source.includes("prelude")
    ) return true;
  }
  return might_contain_iterable_maps(source, false);
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
  let maybe_to_either_functions = EMPTY_SET;
  let direct_either_dictionaries = EMPTY_SET;
  let left_constructors = EMPTY_SET;
  let right_constructors = EMPTY_SET;
  let either_fold_functions = EMPTY_SET;
  let either_from_right_functions = EMPTY_SET;
  let either_from_left_functions = EMPTY_SET;
  let either_recover_functions = EMPTY_SET;
  let either_hush_functions = EMPTY_SET;
  let either_note_functions = EMPTY_SET;
  let either_from_number_functions = EMPTY_SET;
  let either_try_catch_functions = EMPTY_SET;
  let either_is_left_functions = EMPTY_SET;
  let either_is_right_functions = EMPTY_SET;
  let either_map_left_functions = EMPTY_SET;
  let either_bind_widen_functions = EMPTY_SET;
  let direct_identity_dictionaries = EMPTY_SET;
  let identity_constructors = EMPTY_SET;
  let array_constructors = EMPTY_SET;
  let array_from_array_functions = EMPTY_SET;
  let array_view_functions = EMPTY_SET;
  let array_to_array_functions = EMPTY_SET;
  let array_indexed_functions = EMPTY_SET;
  let array_flat_map_streaming_functions = EMPTY_SET;
  let array_namespaces = EMPTY_SET;
  let typed_array_constructors = EMPTY_SET;
  let set_constructors = EMPTY_SET;
  let map_constructors = EMPTY_SET;
  let record_constructors = EMPTY_SET;
  let foldable_objects = EMPTY_SET;
  let foldable_namespaces = EMPTY_SET;
  let alternative_objects = EMPTY_SET;
  let alternative_namespaces = EMPTY_SET;
  let bifunctor_objects = EMPTY_SET;
  let bifunctor_namespaces = EMPTY_SET;
  let monad_error_objects = EMPTY_SET;
  let monad_error_namespaces = EMPTY_SET;
  let stm_dictionaries = EMPTY_SET;
  let stm_namespaces = EMPTY_SET;
  let stm_atomically_functions = EMPTY_SET;
  let stm_primitive_functions = EMPTY_MAP as Map<string, StmPrimitiveName>;
  let stm_retry_classes = EMPTY_SET;
  let stm_error_classes = EMPTY_SET;
  let list_constructors = EMPTY_SET;
  let list_from_array_functions = EMPTY_SET;
  let list_to_array_functions = EMPTY_SET;
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
  let task_from_promise_functions = EMPTY_SET;
  let task_succeed_functions = EMPTY_SET;
  let task_run_functions = EMPTY_SET;
  let task_run_exit_functions = EMPTY_SET;
  let task_traverse_functions = EMPTY_SET;
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
  let validation_to_either_functions = EMPTY_SET;
  let validation_map_error_functions = EMPTY_SET;
  let collect_functions = EMPTY_SET;
  let collect_namespaces = EMPTY_SET;
  let applicative_objects = EMPTY_SET;
  let applicative_namespaces = EMPTY_SET;
  let prelude_fmap_functions = EMPTY_SET;
  let prelude_bind_functions = EMPTY_SET;
  let prelude_ap_functions = EMPTY_SET;
  let prelude_lift_functions = EMPTY_SET;
  let prelude_traverse_functions = EMPTY_SET;
  let prelude_sequence_functions = EMPTY_SET;
  let prelude_foldl_functions = EMPTY_SET;
  let prelude_fold_while_functions = EMPTY_SET;
  let prelude_some_functions = EMPTY_SET;
  let prelude_find_functions = EMPTY_SET;
  let prelude_to_array_functions = EMPTY_SET;
  let prelude_length_functions = EMPTY_SET;
  let prelude_sum_functions = EMPTY_SET;
  let prelude_product_functions = EMPTY_SET;
  let prelude_alt_functions = EMPTY_SET;
  let prelude_concat_functions = EMPTY_SET;
  let prelude_namespaces = EMPTY_SET;
  let iterable_locals = EMPTY_SET;
  let async_iterable_locals = EMPTY_SET;
  let import_declarations = EMPTY_MAP as Map<string, ImportDeclaration>;
  const import_nodes: ImportDeclaration[] = [];
  let non_import_count = 0;
  let loop_dictionaries = EMPTY_SET;
  let loop_tasks = EMPTY_SET;
  let program_module: string | undefined;
  let loop_specifier: string | undefined;
  let leading_imports_end = 0;
  let saw_non_import = false;
  const body = program.body;
  for (let i = 0; i < body.length; i += 1) {
    const statement = body[i];
    if (statement.type !== "ImportDeclaration") {
      non_import_count += 1;
      if (!saw_non_import) {
        if (
          !(statement.type === "ExpressionStatement" &&
            "directive" in statement &&
            statement.directive != null)
        ) saw_non_import = true;
      }
      continue;
    }
    import_nodes.push(statement);
    if (saw_non_import) leading_imports_end = -1;
    else if (leading_imports_end >= 0 && statement.end > leading_imports_end) {
      leading_imports_end = statement.end;
    }
    const specifier = statement.source.value;
    const mod_kind = package_module(specifier) ?? source_module(specifier);
    if (statement.importKind === "type") {
      if (
        mod_kind === "mod" || mod_kind === "maybe" || mod_kind === "either" ||
        mod_kind === "validation" || mod_kind === "list"
      ) {
        for (const binding of statement.specifiers) {
          if (binding.type !== "ImportSpecifier") continue;
          const imported = import_name(binding);
          if (
            imported === "Maybe" &&
            (mod_kind === "mod" || mod_kind === "maybe")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "maybe",
            );
          } else if (
            imported === "Either" &&
            (mod_kind === "mod" || mod_kind === "either")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "either",
            );
          } else if (
            imported === "Validation" &&
            (mod_kind === "mod" || mod_kind === "validation")
          ) {
            tagged_type_names = set_map(
              tagged_type_names,
              binding.local.name,
              "validation",
            );
          } else if (
            imported === "List" &&
            (mod_kind === "mod" || mod_kind === "list")
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
    const is_library = is_library_kind(mod_kind, specifier, config);
    const available_terminals = terminal_exports_for(
      mod_kind,
      specifier,
      config,
    );
    if (
      mod_kind === undefined && !is_library && available_terminals === undefined
    ) {
      continue;
    }
    const available_primitives = primitive_exports_for(mod_kind);
    const available_except_primitives =
      mod_kind === "mod" || mod_kind === "except"
        ? except_primitive_set
        : undefined;
    const available_state_evals = mod_kind === "mod" || mod_kind === "state"
      ? state_eval_set
      : undefined;
    const available_op_runners = mod_kind === "mod" || mod_kind === "handlers"
      ? operation_runner_set
      : undefined;
    const available_op_helpers = mod_kind === "mod" || mod_kind === "effects"
      ? operation_helper_set
      : undefined;
    const available_cell_factories = cell_factory_exports_for(mod_kind);
    const available_cell_runners = mod_kind === "mod" || mod_kind === "handlers"
      ? cell_runner_names
      : undefined;
    const available_cell_providers =
      mod_kind === "mod" || mod_kind === "handlers"
        ? cell_factory_kinds
        : undefined;
    if (mod_kind === "mod" || mod_kind === "typeclasses") {
      if (loop_source_re.test(specifier)) {
        loop_specifier = specifier.replace(
          /(?:typeclasses|mod)\.ts$/,
          "loop.ts",
        );
      } else if (loop_pkg_re.test(specifier)) {
        loop_specifier = specifier + "/loop";
      }
    }
    const is_mod = mod_kind === "mod";
    const is_prelude = mod_kind === "prelude";
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
        switch (mod_kind) {
          case "mod":
            collect_namespaces = add_set(collect_namespaces, local);
            applicative_namespaces = add_set(applicative_namespaces, local);
            traversable_namespaces = add_set(traversable_namespaces, local);
            traverse_sequential_namespaces = add_set(
              traverse_sequential_namespaces,
              local,
            );
            match_namespaces = add_set(match_namespaces, local);
            task_namespaces = add_set(task_namespaces, local);
            foldable_namespaces = add_set(foldable_namespaces, local);
            alternative_namespaces = add_set(alternative_namespaces, local);
            bifunctor_namespaces = add_set(bifunctor_namespaces, local);
            monad_error_namespaces = add_set(monad_error_namespaces, local);
            iterable_locals = add_set(iterable_locals, local);
            async_iterable_locals = add_set(async_iterable_locals, local);
            break;
          case "typeclasses":
            collect_namespaces = add_set(collect_namespaces, local);
            applicative_namespaces = add_set(applicative_namespaces, local);
            traversable_namespaces = add_set(traversable_namespaces, local);
            foldable_namespaces = add_set(foldable_namespaces, local);
            alternative_namespaces = add_set(alternative_namespaces, local);
            bifunctor_namespaces = add_set(bifunctor_namespaces, local);
            monad_error_namespaces = add_set(monad_error_namespaces, local);
            iterable_locals = add_set(iterable_locals, local);
            break;
          case "applicative":
            collect_namespaces = add_set(collect_namespaces, local);
            applicative_namespaces = add_set(applicative_namespaces, local);
            break;
          case "traversable":
            traversable_namespaces = add_set(traversable_namespaces, local);
            break;
          case "traversal":
            traverse_sequential_namespaces = add_set(
              traverse_sequential_namespaces,
              local,
            );
            break;
          case "tagged":
            match_namespaces = add_set(match_namespaces, local);
            break;
          case "task":
            task_namespaces = add_set(task_namespaces, local);
            break;
          case "foldable":
            foldable_namespaces = add_set(foldable_namespaces, local);
            iterable_locals = add_set(iterable_locals, local);
            break;
          case "alternative":
            alternative_namespaces = add_set(alternative_namespaces, local);
            break;
          case "bifunctor":
            bifunctor_namespaces = add_set(bifunctor_namespaces, local);
            break;
          case "monad_error":
            monad_error_namespaces = add_set(monad_error_namespaces, local);
            break;
          case "stm":
            stm_namespaces = add_set(stm_namespaces, local);
            break;
          case "array":
            array_namespaces = add_set(array_namespaces, local);
            break;
          case "list":
            list_namespaces = add_set(list_namespaces, local);
            break;
          case "iterable":
            iterable_locals = add_set(iterable_locals, local);
            break;
          case "async_iterable":
            async_iterable_locals = add_set(async_iterable_locals, local);
            break;
          case "prelude":
            prelude_namespaces = add_set(prelude_namespaces, local);
            traverse_sequential_namespaces = add_set(
              traverse_sequential_namespaces,
              local,
            );
            iterable_locals = add_set(iterable_locals, local);
            break;
        }
        continue;
      }
      if (binding.type !== "ImportSpecifier") continue;
      if (binding.importKind === "type") {
        const imported = import_name(binding);
        if (imported === "Maybe" && (is_mod || mod_kind === "maybe")) {
          tagged_type_names = set_map(tagged_type_names, local, "maybe");
        } else if (imported === "Either" && (is_mod || mod_kind === "either")) {
          tagged_type_names = set_map(tagged_type_names, local, "either");
        } else if (
          imported === "Validation" && (is_mod || mod_kind === "validation")
        ) {
          tagged_type_names = set_map(tagged_type_names, local, "validation");
        } else if (imported === "List" && (is_mod || mod_kind === "list")) {
          tagged_type_names = set_map(tagged_type_names, local, "list");
        }
        continue;
      }
      const imported = import_name(binding)!;
      if (mod_kind === "iterable") {
        iterable_locals = add_set(iterable_locals, local);
      } else if (mod_kind === "async_iterable") {
        async_iterable_locals = add_set(async_iterable_locals, local);
      }
      switch (imported) {
        case "Do":
          if (is_library) do_names = add_set(do_names, local);
          break;
        case "Program":
          if (is_library) {
            program_names = add_set(program_names, local);
            program_module ??= specifier;
          }
          break;
        case "Effect":
          if (is_library) effect_names = add_set(effect_names, local);
          break;
        case "Traversable":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "traversable"
          ) traversable_objects = add_set(traversable_objects, local);
          break;
        case "traverse_sequential":
          if (is_mod || mod_kind === "traversal" || is_prelude) {
            traverse_sequential_functions = add_set(
              traverse_sequential_functions,
              local,
            );
          }
          break;
        case "match":
          if (is_mod || mod_kind === "tagged") {
            match_functions = add_set(match_functions, local);
          }
          break;
        case "ParallelTask":
          if (is_mod || mod_kind === "task") {
            parallel_task_dictionaries = add_set(
              parallel_task_dictionaries,
              local,
            );
          }
          break;
        case "parallel":
          if (is_mod || mod_kind === "task") {
            task_parallel_functions = add_set(task_parallel_functions, local);
          }
          break;
        case "sequential":
          if (is_mod || mod_kind === "task") {
            task_sequential_functions = add_set(
              task_sequential_functions,
              local,
            );
          }
          break;
        case "from_fn":
          if (is_mod || mod_kind === "task") {
            task_from_fn_functions = add_set(task_from_fn_functions, local);
          }
          break;
        case "from_promise":
          if (is_mod || mod_kind === "task") {
            task_from_promise_functions = add_set(
              task_from_promise_functions,
              local,
            );
          }
          break;
        case "succeed":
          if (is_mod || mod_kind === "task") {
            task_succeed_functions = add_set(task_succeed_functions, local);
          }
          break;
        case "run_task":
          if (is_mod || mod_kind === "task") {
            task_run_functions = add_set(task_run_functions, local);
          }
          break;
        case "run_task_exit":
          if (is_mod || mod_kind === "task") {
            task_run_exit_functions = add_set(task_run_exit_functions, local);
          }
          break;
        case "traverse_task":
          if (is_mod || mod_kind === "task") {
            task_traverse_functions = add_set(task_traverse_functions, local);
          }
          break;
        case "is_task_cancellation":
          if (is_mod || mod_kind === "task") {
            task_is_cancellation_functions = add_set(
              task_is_cancellation_functions,
              local,
            );
          }
          break;
        case "List":
          if (is_mod || mod_kind === "list") {
            list_constructors = add_set(list_constructors, local);
            tagged_type_names = set_map(tagged_type_names, local, "list");
          }
          break;
        case "Nil":
          if (is_mod || mod_kind === "list") {
            nil_constructors = add_set(nil_constructors, local);
          }
          break;
        case "Cons":
        case "cons":
          if (is_mod || mod_kind === "list") {
            cons_constructors = add_set(cons_constructors, local);
          }
          break;
        case "from_array":
          if (mod_kind === "list") {
            list_from_array_functions = add_set(
              list_from_array_functions,
              local,
            );
          } else if (mod_kind === "array") {
            array_from_array_functions = add_set(
              array_from_array_functions,
              local,
            );
          }
          break;
        case "to_array":
          if (mod_kind === "array") {
            array_to_array_functions = add_set(array_to_array_functions, local);
          } else if (mod_kind === "list") {
            list_to_array_functions = add_set(list_to_array_functions, local);
          } else if (is_prelude) {
            prelude_to_array_functions = add_set(
              prelude_to_array_functions,
              local,
            );
            iterable_locals = add_set(iterable_locals, local);
          }
          break;
        case "from_array_view":
          if (mod_kind === "array") {
            array_view_functions = add_set(array_view_functions, local);
          }
          break;
        case "indexed":
          if (mod_kind === "array") {
            array_indexed_functions = add_set(array_indexed_functions, local);
          }
          break;
        case "flat_map_streaming":
          if (mod_kind === "array") {
            array_flat_map_streaming_functions = add_set(
              array_flat_map_streaming_functions,
              local,
            );
          }
          break;
        case "list":
          if (is_mod) list_namespaces = add_set(list_namespaces, local);
          break;
        case "array":
          if (is_mod) array_namespaces = add_set(array_namespaces, local);
          break;
        case "async_iterable":
          if (is_mod) {
            async_iterable_locals = add_set(async_iterable_locals, local);
          }
          break;
        case "iterable":
          if (is_mod) iterable_locals = add_set(iterable_locals, local);
          break;
        case "Validation":
          if (is_mod || mod_kind === "validation") {
            validation_constructors = add_set(validation_constructors, local);
            tagged_type_names = set_map(tagged_type_names, local, "validation");
            direct_validation_dictionaries = add_set(
              direct_validation_dictionaries,
              local,
            );
          }
          break;
        case "Valid":
          if (is_mod || mod_kind === "validation") {
            validation_constructors = add_set(validation_constructors, local);
            valid_constructors = add_set(valid_constructors, local);
          }
          break;
        case "Invalid":
          if (is_mod || mod_kind === "validation") {
            validation_constructors = add_set(validation_constructors, local);
            invalid_constructors = add_set(invalid_constructors, local);
          }
          break;
        case "InvalidMessages":
          if (is_mod || mod_kind === "validation") {
            validation_constructors = add_set(validation_constructors, local);
            invalid_messages_constructors = add_set(
              invalid_messages_constructors,
              local,
            );
          }
          break;
        case "valid":
        case "invalid":
          if (is_mod || mod_kind === "validation") {
            validation_constructors = add_set(validation_constructors, local);
          }
          break;
        case "validation_to_either":
          if (is_mod || mod_kind === "validation") {
            validation_to_either_functions = add_set(
              validation_to_either_functions,
              local,
            );
          }
          break;
        case "map_error":
          if (is_mod || mod_kind === "validation") {
            validation_map_error_functions = add_set(
              validation_map_error_functions,
              local,
            );
          }
          break;
        case "Maybe":
          if (is_mod || mod_kind === "maybe") {
            tagged_type_names = set_map(tagged_type_names, local, "maybe");
            loop_dictionaries = add_set(loop_dictionaries, local);
            direct_maybe_dictionaries = add_set(
              direct_maybe_dictionaries,
              local,
            );
          }
          break;
        case "Either":
          if (is_mod || mod_kind === "either") {
            tagged_type_names = set_map(tagged_type_names, local, "either");
            loop_dictionaries = add_set(loop_dictionaries, local);
            direct_either_dictionaries = add_set(
              direct_either_dictionaries,
              local,
            );
          }
          break;
        case "Identity":
          if (is_mod || mod_kind === "identity") {
            loop_dictionaries = add_set(loop_dictionaries, local);
            direct_identity_dictionaries = add_set(
              direct_identity_dictionaries,
              local,
            );
            identity_constructors = add_set(identity_constructors, local);
          }
          break;
        case "identity":
          if (is_mod || mod_kind === "identity") {
            identity_constructors = add_set(identity_constructors, local);
          }
          break;
        case "Task":
          if (is_mod || mod_kind === "task") {
            loop_dictionaries = add_set(loop_dictionaries, local);
            loop_tasks = add_set(loop_tasks, local);
          }
          break;
        case "Foldable":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "foldable"
          ) {
            foldable_objects = add_set(foldable_objects, local);
            iterable_locals = add_set(iterable_locals, local);
          }
          break;
        case "Alternative":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "alternative"
          ) alternative_objects = add_set(alternative_objects, local);
          break;
        case "Bifunctor":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "bifunctor"
          ) bifunctor_objects = add_set(bifunctor_objects, local);
          break;
        case "MonadError":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "monad_error"
          ) monad_error_objects = add_set(monad_error_objects, local);
          break;
        case "collect":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "applicative"
          ) collect_functions = add_set(collect_functions, local);
          break;
        case "Applicative":
          if (
            is_mod || mod_kind === "typeclasses" || mod_kind === "applicative"
          ) applicative_objects = add_set(applicative_objects, local);
          break;
        case "Just":
          if (is_mod || mod_kind === "maybe") {
            just_constructors = add_set(just_constructors, local);
          }
          break;
        case "Nothing":
          if (is_mod || mod_kind === "maybe") {
            nothing_constructors = add_set(nothing_constructors, local);
          }
          break;
        case "from_nullable":
          if (is_mod || mod_kind === "maybe") {
            from_nullable_functions = add_set(from_nullable_functions, local);
          }
          break;
        case "from_maybe":
          if (is_mod || mod_kind === "maybe" || is_prelude) {
            from_maybe_functions = add_set(from_maybe_functions, local);
          }
          break;
        case "to_nullable":
          if (is_mod || mod_kind === "maybe" || is_prelude) {
            to_nullable_functions = add_set(to_nullable_functions, local);
          }
          break;
        case "to_either":
          if (is_mod || mod_kind === "maybe" || is_prelude) {
            maybe_to_either_functions = add_set(
              maybe_to_either_functions,
              local,
            );
          }
          break;
        case "get_or_else":
          if (is_mod || mod_kind === "maybe") {
            maybe_get_or_else_functions = add_set(
              maybe_get_or_else_functions,
              local,
            );
          }
          break;
        case "maybe":
          if (is_mod || mod_kind === "maybe" || is_prelude) {
            maybe_fold_functions = add_set(maybe_fold_functions, local);
          }
          break;
        case "filter":
          if (mod_kind === "maybe") {
            maybe_filter_functions = add_set(maybe_filter_functions, local);
          }
          break;
        case "Left":
          if (is_mod || mod_kind === "either") {
            left_constructors = add_set(left_constructors, local);
          }
          break;
        case "Right":
          if (is_mod || mod_kind === "either") {
            right_constructors = add_set(right_constructors, local);
          }
          break;
        case "either":
          if (is_mod || mod_kind === "either" || is_prelude) {
            either_fold_functions = add_set(either_fold_functions, local);
          }
          break;
        case "from_right":
          if (is_mod || mod_kind === "either" || is_prelude) {
            either_from_right_functions = add_set(
              either_from_right_functions,
              local,
            );
          }
          break;
        case "from_left":
          if (is_mod || mod_kind === "either" || is_prelude) {
            either_from_left_functions = add_set(
              either_from_left_functions,
              local,
            );
          }
          break;
        case "recover_or_else":
          if (is_mod || mod_kind === "either") {
            either_recover_functions = add_set(either_recover_functions, local);
          }
          break;
        case "hush":
          if (is_mod || mod_kind === "either" || is_prelude) {
            either_hush_functions = add_set(either_hush_functions, local);
          }
          break;
        case "note":
          if (is_mod || mod_kind === "either" || is_prelude) {
            either_note_functions = add_set(either_note_functions, local);
          }
          break;
        case "from_number":
          if (is_mod || mod_kind === "either") {
            either_from_number_functions = add_set(
              either_from_number_functions,
              local,
            );
          }
          break;
        case "try_catch":
          if (is_mod || mod_kind === "either") {
            either_try_catch_functions = add_set(
              either_try_catch_functions,
              local,
            );
          }
          break;
        case "is_left":
          if (is_mod || mod_kind === "either") {
            either_is_left_functions = add_set(either_is_left_functions, local);
          }
          break;
        case "is_right":
          if (is_mod || mod_kind === "either") {
            either_is_right_functions = add_set(
              either_is_right_functions,
              local,
            );
          }
          break;
        case "map_left":
          if (is_mod || mod_kind === "either") {
            either_map_left_functions = add_set(
              either_map_left_functions,
              local,
            );
          }
          break;
        case "bind_widen":
          if (is_mod || mod_kind === "either") {
            either_bind_widen_functions = add_set(
              either_bind_widen_functions,
              local,
            );
          }
          break;
        case "ArrayT":
          if (is_mod || mod_kind === "array") {
            array_constructors = add_set(array_constructors, local);
          }
          break;
        case "TypedArrayT":
        case "from_typed_array":
          if (is_mod || mod_kind === "typed_array") {
            typed_array_constructors = add_set(typed_array_constructors, local);
          }
          break;
        case "SetT":
        case "from_set":
          if (is_mod || mod_kind === "set") {
            set_constructors = add_set(set_constructors, local);
          }
          break;
        case "MapT":
        case "from_map_view":
          if (is_mod || mod_kind === "map") {
            map_constructors = add_set(map_constructors, local);
          }
          break;
        case "RecordT":
        case "from_record_view":
          if (is_mod || mod_kind === "record") {
            record_constructors = add_set(record_constructors, local);
          }
          break;
        case "from_snapshot":
          if (is_mod || mod_kind === "map") {
            map_constructors = add_set(map_constructors, local);
          }
          if (is_mod || mod_kind === "record") {
            record_constructors = add_set(record_constructors, local);
          }
          if (mod_kind === "array") {
            array_from_array_functions = add_set(
              array_from_array_functions,
              local,
            );
          }
          break;
        case "Stm":
          if (is_mod || mod_kind === "stm") {
            stm_dictionaries = add_set(stm_dictionaries, local);
          }
          break;
        case "atomically":
          if (is_mod || mod_kind === "stm") {
            stm_atomically_functions = add_set(stm_atomically_functions, local);
          }
          break;
        case "StmRetry":
          if (is_mod || mod_kind === "stm") {
            stm_retry_classes = add_set(stm_retry_classes, local);
          }
          break;
        case "StmError":
          if (is_mod || mod_kind === "stm") {
            stm_error_classes = add_set(stm_error_classes, local);
          }
          break;
        case "read_tvar":
        case "write_tvar":
        case "modify_tvar":
        case "retry":
        case "abort":
        case "or_else":
          if (is_mod || mod_kind === "stm") {
            stm_primitive_functions = set_map(
              stm_primitive_functions,
              local,
              imported as StmPrimitiveName,
            );
          }
          break;
        case "Reader":
          if (is_mod || mod_kind === "reader") {
            direct_reader_dictionaries = add_set(
              direct_reader_dictionaries,
              local,
            );
          }
          break;
        case "State":
          if (is_mod || mod_kind === "state") {
            direct_state_dictionaries = add_set(
              direct_state_dictionaries,
              local,
            );
          }
          break;
        case "Writer":
          if (is_mod || mod_kind === "writer") {
            direct_writer_dictionaries = add_set(
              direct_writer_dictionaries,
              local,
            );
          }
          break;
        // Prelude-specific exports
        case "fmap":
          if (is_prelude) {
            prelude_fmap_functions = add_set(prelude_fmap_functions, local);
          }
          break;
        case "bind":
          if (is_prelude) {
            prelude_bind_functions = add_set(prelude_bind_functions, local);
          }
          break;
        case "ap":
          if (is_prelude) {
            prelude_ap_functions = add_set(prelude_ap_functions, local);
          }
          break;
        case "lift":
          if (is_prelude) {
            prelude_lift_functions = add_set(prelude_lift_functions, local);
          }
          break;
        case "traverse":
          if (is_prelude) {
            prelude_traverse_functions = add_set(
              prelude_traverse_functions,
              local,
            );
          }
          break;
        case "sequence":
          if (is_prelude) {
            prelude_sequence_functions = add_set(
              prelude_sequence_functions,
              local,
            );
          }
          break;
        case "foldl":
          if (is_prelude) {
            prelude_foldl_functions = add_set(prelude_foldl_functions, local);
            iterable_locals = add_set(iterable_locals, local);
          }
          break;
        case "fold_while":
          if (is_prelude) {
            prelude_fold_while_functions = add_set(
              prelude_fold_while_functions,
              local,
            );
            iterable_locals = add_set(iterable_locals, local);
          }
          break;
        case "some":
          if (is_prelude) {
            prelude_some_functions = add_set(prelude_some_functions, local);
            iterable_locals = add_set(iterable_locals, local);
          }
          break;
        case "find":
          if (is_prelude) {
            prelude_find_functions = add_set(prelude_find_functions, local);
            iterable_locals = add_set(iterable_locals, local);
          }
          break;
        case "length":
          if (is_prelude) {
            prelude_length_functions = add_set(prelude_length_functions, local);
          }
          break;
        case "sum":
          if (is_prelude) {
            prelude_sum_functions = add_set(prelude_sum_functions, local);
          }
          break;
        case "product":
          if (is_prelude) {
            prelude_product_functions = add_set(
              prelude_product_functions,
              local,
            );
          }
          break;
        case "alt":
          if (is_prelude) {
            prelude_alt_functions = add_set(prelude_alt_functions, local);
          }
          break;
        case "concat":
          if (is_prelude) {
            prelude_concat_functions = add_set(prelude_concat_functions, local);
          }
          break;
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
    maybe_to_either_functions,
    direct_either_dictionaries,
    left_constructors,
    right_constructors,
    either_fold_functions,
    either_from_right_functions,
    either_from_left_functions,
    either_recover_functions,
    either_hush_functions,
    either_note_functions,
    either_from_number_functions,
    either_try_catch_functions,
    either_is_left_functions,
    either_is_right_functions,
    either_map_left_functions,
    either_bind_widen_functions,
    direct_identity_dictionaries,
    identity_constructors,
    array_constructors,
    array_from_array_functions,
    array_view_functions,
    array_to_array_functions,
    array_indexed_functions,
    array_flat_map_streaming_functions,
    array_namespaces,
    typed_array_constructors,
    set_constructors,
    map_constructors,
    record_constructors,
    foldable_objects,
    foldable_namespaces,
    alternative_objects,
    alternative_namespaces,
    bifunctor_objects,
    bifunctor_namespaces,
    monad_error_objects,
    monad_error_namespaces,
    stm_dictionaries,
    stm_namespaces,
    stm_atomically_functions,
    stm_primitive_functions,
    stm_retry_classes,
    stm_error_classes,
    list_constructors,
    list_from_array_functions,
    list_to_array_functions,
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
    task_from_promise_functions,
    task_succeed_functions,
    task_run_functions,
    task_run_exit_functions,
    task_traverse_functions,
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
    validation_to_either_functions,
    validation_map_error_functions,
    collect_functions,
    collect_namespaces,
    applicative_objects,
    applicative_namespaces,
    prelude_fmap_functions,
    prelude_bind_functions,
    prelude_ap_functions,
    prelude_lift_functions,
    prelude_traverse_functions,
    prelude_sequence_functions,
    prelude_foldl_functions,
    prelude_fold_while_functions,
    prelude_some_functions,
    prelude_find_functions,
    prelude_to_array_functions,
    prelude_length_functions,
    prelude_sum_functions,
    prelude_product_functions,
    prelude_alt_functions,
    prelude_concat_functions,
    prelude_namespaces,
    iterable_locals,
    async_iterable_locals,
    program_module,
    import_declarations,
    import_nodes,
    non_import_count,
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
    observe_declare: add,
    observe_call(current: CallExpression): void {
      if (
        scope_declarations.size > 0 &&
        current.callee.type === "Identifier"
      ) {
        const end = scope_declarations.get(current.callee.name);
        if (end !== undefined && current.start < end) {
          tdz_violated.add(current.callee.name);
        }
      }
    },
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
      const shadowed_names = counts.size > 0
        ? new Set<string>(counts.keys())
        : EMPTY_SET;
      for (const name of counts.keys()) {
        // Only globally remove names checked without per-site lexical resolution
        // (Do/Program/Effect/namespaces/loop_dictionaries). Every other imported
        // symbol is verified at each call site via services.bindings.imported(...)
        // and emitted symbols check shadowed_names to request fresh aliased imports.
        headers.do_names.delete(name);
        headers.program_names.delete(name);
        headers.effect_names.delete(name);
        headers.namespaces.delete(name);
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
          maybe_to_either_functions: headers.maybe_to_either_functions,
          direct_either_dictionaries: headers.direct_either_dictionaries,
          left_constructors: headers.left_constructors,
          right_constructors: headers.right_constructors,
          either_fold_functions: headers.either_fold_functions,
          either_from_right_functions: headers.either_from_right_functions,
          either_from_left_functions: headers.either_from_left_functions,
          either_recover_functions: headers.either_recover_functions,
          either_hush_functions: headers.either_hush_functions,
          either_note_functions: headers.either_note_functions,
          either_from_number_functions: headers.either_from_number_functions,
          either_try_catch_functions: headers.either_try_catch_functions,
          either_is_left_functions: headers.either_is_left_functions,
          either_is_right_functions: headers.either_is_right_functions,
          either_map_left_functions: headers.either_map_left_functions,
          either_bind_widen_functions: headers.either_bind_widen_functions,
          direct_identity_dictionaries: headers.direct_identity_dictionaries,
          identity_constructors: headers.identity_constructors,
          array_constructors: headers.array_constructors,
          array_from_array_functions: headers.array_from_array_functions,
          array_view_functions: headers.array_view_functions,
          array_to_array_functions: headers.array_to_array_functions,
          array_indexed_functions: headers.array_indexed_functions,
          array_flat_map_streaming_functions:
            headers.array_flat_map_streaming_functions,
          array_namespaces: headers.array_namespaces,
          typed_array_constructors: headers.typed_array_constructors,
          set_constructors: headers.set_constructors,
          map_constructors: headers.map_constructors,
          record_constructors: headers.record_constructors,
          foldable_objects: headers.foldable_objects,
          foldable_namespaces: headers.foldable_namespaces,
          alternative_objects: headers.alternative_objects,
          alternative_namespaces: headers.alternative_namespaces,
          bifunctor_objects: headers.bifunctor_objects,
          bifunctor_namespaces: headers.bifunctor_namespaces,
          monad_error_objects: headers.monad_error_objects,
          monad_error_namespaces: headers.monad_error_namespaces,
          stm_dictionaries: headers.stm_dictionaries,
          stm_namespaces: headers.stm_namespaces,
          stm_atomically_functions: headers.stm_atomically_functions,
          stm_primitive_functions: headers.stm_primitive_functions,
          stm_retry_classes: headers.stm_retry_classes,
          stm_error_classes: headers.stm_error_classes,
          list_constructors: headers.list_constructors,
          list_from_array_functions: headers.list_from_array_functions,
          list_to_array_functions: headers.list_to_array_functions,
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
          task_from_promise_functions: headers.task_from_promise_functions,
          task_succeed_functions: headers.task_succeed_functions,
          task_run_functions: headers.task_run_functions,
          task_run_exit_functions: headers.task_run_exit_functions,
          task_traverse_functions: headers.task_traverse_functions,
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
          validation_to_either_functions:
            headers.validation_to_either_functions,
          validation_map_error_functions:
            headers.validation_map_error_functions,
          collect_functions: headers.collect_functions,
          collect_namespaces: headers.collect_namespaces,
          applicative_objects: headers.applicative_objects,
          applicative_namespaces: headers.applicative_namespaces,
          prelude_fmap_functions: headers.prelude_fmap_functions,
          prelude_bind_functions: headers.prelude_bind_functions,
          prelude_ap_functions: headers.prelude_ap_functions,
          prelude_lift_functions: headers.prelude_lift_functions,
          prelude_traverse_functions: headers.prelude_traverse_functions,
          prelude_sequence_functions: headers.prelude_sequence_functions,
          prelude_foldl_functions: headers.prelude_foldl_functions,
          prelude_fold_while_functions: headers.prelude_fold_while_functions,
          prelude_some_functions: headers.prelude_some_functions,
          prelude_find_functions: headers.prelude_find_functions,
          prelude_to_array_functions: headers.prelude_to_array_functions,
          prelude_length_functions: headers.prelude_length_functions,
          prelude_sum_functions: headers.prelude_sum_functions,
          prelude_product_functions: headers.prelude_product_functions,
          prelude_alt_functions: headers.prelude_alt_functions,
          prelude_concat_functions: headers.prelude_concat_functions,
          prelude_namespaces: headers.prelude_namespaces,
          iterable_locals: headers.iterable_locals,
          async_iterable_locals: headers.async_iterable_locals,
          shadowed_names,
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

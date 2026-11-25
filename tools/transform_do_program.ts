import { parseSync } from "oxc-parser";
import type {
  Expression,
  IdentifierReference,
  ImportDeclaration,
  Node,
  Program,
  Statement,
  VariableDeclaration,
  VariableDeclarator,
} from "oxc-parser";
import {
  id,
  literal,
  node,
  unwrap,
  value_visitor_keys,
  walk_values,
} from "./transform_ast.ts";
import { create_binding_analysis } from "./transform_bindings.ts";
import {
  collect_active_statement_indices,
  create_import_shadow_tracker,
  generator_kind,
  might_contain_transform_target,
  scan_import_headers,
  scan_scope_declarations,
} from "./transform_imports.ts";
import { lower_generator } from "./transform_generator.ts";
import {
  create_terminal_transform,
  type Round5TokenHints,
} from "./transform_terminals.ts";
import {
  create_iterable_map_fusion,
  might_contain_iterable_maps,
} from "./transform_iterable_maps.ts";
import {
  create_source_positions,
  type PositionLookup,
  type SourceEdit,
  splice_edits,
} from "./transform_splice.ts";
import type {
  TransformConfig,
  TransformDiagnostic,
  TransformReport,
  TransformResult,
  TransformServices,
  TransformSourceMap,
} from "./transform_context.ts";
export type {
  TransformConfig,
  TransformDiagnostic,
  TransformReport,
  TransformResult,
  TransformSourceMap,
} from "./transform_context.ts";

type ImportRequest = {
  readonly source: string;
  readonly imported: string;
  readonly local: IdentifierReference;
  readonly namespace?: boolean;
};

let raw_transfer_supported = true;

function parse_source(
  file_name: string,
  source: string,
  lang: "ts" | "tsx",
) {
  if (raw_transfer_supported) {
    try {
      return parseSync(
        file_name,
        source,
        {
          lang,
          astType: "ts",
          preserveParens: false,
          experimentalRawTransfer: true,
        } as Parameters<typeof parseSync>[2],
      );
    } catch {
      raw_transfer_supported = false;
    }
  }
  return parseSync(file_name, source, {
    lang,
    astType: "ts",
    preserveParens: false,
  });
}

const r5_syntax_re =
  /\.\s*(?:map|bind|fold)\s*\(|\bmatch\b|traverse|\bFoldable\b/g;

function push_set(target: string[], set: ReadonlySet<string>): void {
  if (set.size === 0) return;
  for (const item of set) target.push(item);
}

function push_keys(target: string[], map: ReadonlyMap<string, unknown>): void {
  if (map.size === 0) return;
  for (const key of map.keys()) target.push(key);
}

function has_any_token(
  source: string,
  from: number,
  set: ReadonlySet<string>,
): boolean {
  if (set.size === 0) return false;
  for (const name of set) {
    if (source.indexOf(name, from) >= 0) return true;
  }
  return false;
}

/** Lower supported generators, effect runners, and lazy iterable map chains. */
export function transform_do_program_source(
  source: string,
  file_name = "input.ts",
  config: TransformConfig = {},
): TransformResult {
  if (!might_contain_transform_target(source, config)) {
    return unchanged_transform_result(source);
  }
  return transform_do_program_checked(source, file_name, config);
}

function transform_do_program_checked(
  source: string,
  file_name = "input.ts",
  config: TransformConfig = {},
): TransformResult {
  let lang: "ts" | "tsx" = "ts";
  if (file_name.split("?", 1)[0].toLowerCase().endsWith(".tsx")) lang = "tsx";
  const parsed = parse_source(file_name, source, lang);
  if (parsed.errors.length > 0) {
    const position = create_source_positions(source);
    return {
      ...unchanged_transform_result(source),
      diagnostics: parsed.errors.map((error) => {
        const at = position(error.labels[0]?.start ?? 0);
        return {
          file_name,
          line: at.line,
          column: at.column + 1,
          message: "Parse error: " + error.message,
        };
      }),
    };
  }
  const program = parsed.program;
  const headers = scan_import_headers(program, config);
  const has_unicode = source.includes("\\u");
  const has_iterable = config.optimizations?.iterable_map !== false &&
    (has_unicode || might_contain_iterable_maps(source, false));
  const scope_declarations =
    (headers.program_names.size > 0 || headers.namespaces.size > 0) &&
      (has_unicode || source.includes("scope"))
      ? scan_scope_declarations(program, headers)
      : new Map<string, number>();

  let skipped_statements = false;
  let skip_statement: ((statement: Statement) => boolean) | undefined;
  let active_indices: number[] | undefined;
  let r5_hints: Round5TokenHints | undefined;
  if (!has_unicode && headers.leading_imports_end >= 0) {
    const scan_from = headers.leading_imports_end;
    const has_effect_interp = headers.effect_names.size > 0 ||
      headers.namespaces.size > 0;
    const has_collect = headers.collect_functions.size > 0 ||
      headers.collect_namespaces.size > 0;
    const has_lift = headers.applicative_objects.size > 0 ||
      headers.applicative_namespaces.size > 0;
    const has_traverse = headers.traversable_objects.size > 0 ||
      headers.traversable_namespaces.size > 0 ||
      headers.traverse_sequential_functions.size > 0 ||
      headers.traverse_sequential_namespaces.size > 0 ||
      headers.array_constructors.size > 0;
    const has_match = headers.match_functions.size > 0 ||
      headers.match_namespaces.size > 0 ||
      headers.tagged_type_names.size > 0 ||
      headers.just_constructors.size > 0 ||
      headers.nothing_constructors.size > 0 ||
      headers.left_constructors.size > 0 ||
      headers.right_constructors.size > 0 ||
      headers.validation_constructors.size > 0 ||
      headers.list_constructors.size > 0 ||
      headers.nil_constructors.size > 0 ||
      headers.cons_constructors.size > 0;
    const has_array_chain = headers.array_constructors.size > 0 ||
      headers.array_from_array_functions.size > 0 ||
      headers.array_view_functions.size > 0 ||
      headers.array_namespaces.size > 0 ||
      headers.typed_array_constructors.size > 0 ||
      headers.set_constructors.size > 0 ||
      headers.map_constructors.size > 0 ||
      headers.record_constructors.size > 0;
    const has_maybe_either_chain = headers.just_constructors.size > 0 ||
      headers.nothing_constructors.size > 0 ||
      headers.from_nullable_functions.size > 0 ||
      headers.from_maybe_functions.size > 0 ||
      headers.to_nullable_functions.size > 0 ||
      headers.maybe_get_or_else_functions.size > 0 ||
      headers.maybe_fold_functions.size > 0 ||
      headers.maybe_filter_functions.size > 0 ||
      headers.left_constructors.size > 0 ||
      headers.right_constructors.size > 0 ||
      headers.either_fold_functions.size > 0 ||
      headers.either_from_right_functions.size > 0 ||
      headers.either_from_left_functions.size > 0 ||
      headers.either_recover_functions.size > 0 ||
      headers.direct_maybe_dictionaries.size > 0 ||
      headers.direct_either_dictionaries.size > 0 ||
      headers.tagged_type_names.size > 0;
    const target_tokens: string[] = ["Do", "Program"];
    push_set(target_tokens, headers.do_names);
    push_set(target_tokens, headers.program_names);
    push_set(target_tokens, headers.namespaces);
    push_keys(target_tokens, headers.terminal_functions);
    push_keys(target_tokens, headers.terminal_namespaces);
    push_keys(target_tokens, headers.cell_runners);
    push_keys(target_tokens, headers.cell_runner_namespaces);
    push_keys(target_tokens, headers.operation_runners);
    push_keys(target_tokens, headers.operation_runner_namespaces);
    push_keys(target_tokens, headers.state_eval_functions);
    push_keys(target_tokens, headers.state_eval_namespaces);
    push_set(target_tokens, headers.task_run_functions);
    push_set(target_tokens, headers.task_run_exit_functions);
    push_set(target_tokens, headers.task_namespaces);
    push_set(target_tokens, headers.stm_atomically_functions);
    push_set(target_tokens, headers.stm_namespaces);
    push_set(target_tokens, headers.collect_functions);
    push_set(target_tokens, headers.collect_namespaces);
    push_set(target_tokens, headers.applicative_objects);
    push_set(target_tokens, headers.applicative_namespaces);
    push_set(target_tokens, headers.traversable_objects);
    push_set(target_tokens, headers.traversable_namespaces);
    push_set(target_tokens, headers.traverse_sequential_functions);
    push_set(target_tokens, headers.traverse_sequential_namespaces);
    push_set(target_tokens, headers.match_functions);
    push_set(target_tokens, headers.match_namespaces);
    push_set(target_tokens, headers.from_maybe_functions);
    push_set(target_tokens, headers.to_nullable_functions);
    push_set(target_tokens, headers.maybe_get_or_else_functions);
    push_set(target_tokens, headers.maybe_fold_functions);
    push_set(target_tokens, headers.maybe_filter_functions);
    push_set(target_tokens, headers.either_fold_functions);
    push_set(target_tokens, headers.either_from_right_functions);
    push_set(target_tokens, headers.either_from_left_functions);
    push_set(target_tokens, headers.either_recover_functions);
    push_set(target_tokens, headers.array_to_array_functions);
    if (has_effect_interp) {
      target_tokens.push("run", "handle_with", "value");
    } else if (
      headers.direct_reader_dictionaries.size > 0 ||
      headers.direct_state_dictionaries.size > 0 ||
      headers.direct_writer_dictionaries.size > 0 ||
      headers.loop_tasks.size > 0 ||
      headers.cell_factories.size > 0 ||
      headers.cell_namespaces.size > 0
    ) {
      target_tokens.push("run", "value");
    }
    if (has_collect) target_tokens.push("collect");
    if (has_lift) target_tokens.push("lift");
    let has_r5_syntax = false;
    if (
      has_traverse || has_match || has_maybe_either_chain || has_array_chain
    ) {
      r5_syntax_re.lastIndex = scan_from;
      has_r5_syntax = r5_syntax_re.test(source);
    }
    const hint_traverse = has_traverse && (
      (has_r5_syntax && source.indexOf("traverse", scan_from) >= 0) ||
      has_any_token(source, scan_from, headers.traverse_sequential_functions) ||
      has_any_token(source, scan_from, headers.traversable_objects)
    );
    const hint_match = has_match && (
      (has_r5_syntax && source.indexOf("match", scan_from) >= 0) ||
      has_any_token(source, scan_from, headers.match_functions)
    );
    const has_dot_map = has_r5_syntax &&
      (has_maybe_either_chain || has_array_chain) &&
      source.indexOf(".map", scan_from) >= 0;
    const has_dot_bind = has_r5_syntax && has_maybe_either_chain &&
      source.indexOf(".bind", scan_from) >= 0;
    const has_dot_fold = has_r5_syntax && has_array_chain &&
      source.indexOf(".fold", scan_from) >= 0;
    const has_foldable_tok = has_array_chain && (
      (has_r5_syntax && source.indexOf("Foldable", scan_from) >= 0) ||
      has_any_token(source, scan_from, headers.foldable_objects)
    );
    const hint_chain = has_maybe_either_chain && (
      has_dot_map || has_dot_bind ||
      headers.from_maybe_functions.size > 0 ||
      headers.to_nullable_functions.size > 0 ||
      headers.maybe_get_or_else_functions.size > 0 ||
      headers.maybe_fold_functions.size > 0 ||
      headers.maybe_filter_functions.size > 0 ||
      headers.either_fold_functions.size > 0 ||
      headers.either_from_right_functions.size > 0 ||
      headers.either_from_left_functions.size > 0 ||
      headers.either_recover_functions.size > 0
    );
    const hint_array = has_array_chain && (
      has_dot_map || has_dot_fold || has_foldable_tok ||
      headers.array_to_array_functions.size > 0
    );
    r5_hints = {
      traverse: hint_traverse,
      match: hint_match,
      chain: hint_chain,
      array: hint_array,
    };
    if (hint_traverse) target_tokens.push("traverse");
    if (hint_match) target_tokens.push(".match", "match(");
    if (has_dot_map) target_tokens.push(".map");
    if (has_dot_bind) target_tokens.push(".bind");
    if (has_dot_fold) target_tokens.push(".fold");
    if (has_foldable_tok) target_tokens.push("Foldable");
    if (has_iterable) {
      target_tokens.push(
        "IterableT",
        "AsyncIterableT",
        "from_array",
        "from_array_view",
        "from_factory",
        "from_sync_factory",
        "from_chunks",
        "from_iterable",
        "from_snapshot",
        "map_sync",
        "filter",
        "filter_map",
        "take",
        "to_array",
        "preview",
        "compile_fold",
        "Foldable",
        "iterable",
        "async_iterable",
        ".map",
        ".fold",
        "fold_while",
        "find",
        "some",
      );
      push_set(target_tokens, headers.iterable_locals);
      push_set(target_tokens, headers.async_iterable_locals);
    }
    let has_target_token = false;
    for (let index = 0; index < target_tokens.length; index += 1) {
      if (source.indexOf(target_tokens[index], scan_from) >= 0) {
        has_target_token = true;
        break;
      }
    }
    if (config.optimizations?.candidate_scan !== false && !has_target_token) {
      return unchanged_transform_result(source);
    }
    if (
      !config.explain &&
      config.optimizations?.candidate_scan !== false &&
      program.body.length >= 16
    ) {
      const relevant_tokens: string[] = [...target_tokens, "Effect"];
      push_set(relevant_tokens, headers.effect_names);
      push_keys(relevant_tokens, headers.primitive_functions);
      push_keys(relevant_tokens, headers.primitive_namespaces);
      push_keys(relevant_tokens, headers.except_primitives);
      push_keys(relevant_tokens, headers.except_namespaces);
      push_keys(relevant_tokens, headers.operation_helpers);
      push_keys(relevant_tokens, headers.cell_factories);
      push_keys(relevant_tokens, headers.cell_namespaces);
      push_keys(relevant_tokens, headers.cell_providers);
      push_keys(relevant_tokens, headers.cell_provider_namespaces);
      push_set(relevant_tokens, headers.loop_dictionaries);
      push_set(relevant_tokens, headers.direct_maybe_dictionaries);
      push_set(relevant_tokens, headers.just_constructors);
      push_set(relevant_tokens, headers.nothing_constructors);
      push_set(relevant_tokens, headers.from_nullable_functions);
      push_set(relevant_tokens, headers.direct_either_dictionaries);
      push_set(relevant_tokens, headers.left_constructors);
      push_set(relevant_tokens, headers.right_constructors);
      push_set(relevant_tokens, headers.direct_identity_dictionaries);
      push_set(relevant_tokens, headers.identity_constructors);
      push_set(relevant_tokens, headers.array_constructors);
      push_set(relevant_tokens, headers.array_from_array_functions);
      push_set(relevant_tokens, headers.array_namespaces);
      push_set(relevant_tokens, headers.typed_array_constructors);
      push_set(relevant_tokens, headers.set_constructors);
      push_set(relevant_tokens, headers.map_constructors);
      push_set(relevant_tokens, headers.record_constructors);
      push_set(relevant_tokens, headers.list_constructors);
      push_set(relevant_tokens, headers.list_from_array_functions);
      push_set(relevant_tokens, headers.list_namespaces);
      push_set(relevant_tokens, headers.nil_constructors);
      push_set(relevant_tokens, headers.cons_constructors);
      push_set(relevant_tokens, headers.direct_reader_dictionaries);
      push_set(relevant_tokens, headers.direct_state_dictionaries);
      push_set(relevant_tokens, headers.direct_writer_dictionaries);
      push_set(relevant_tokens, headers.parallel_task_dictionaries);
      push_set(relevant_tokens, headers.task_parallel_functions);
      push_set(relevant_tokens, headers.task_sequential_functions);
      push_set(relevant_tokens, headers.task_from_fn_functions);
      push_set(relevant_tokens, headers.task_succeed_functions);
      push_set(relevant_tokens, headers.task_is_cancellation_functions);
      push_set(relevant_tokens, headers.stm_dictionaries);
      push_keys(relevant_tokens, headers.stm_primitive_functions);
      push_set(relevant_tokens, headers.validation_constructors);
      push_set(relevant_tokens, headers.direct_validation_dictionaries);
      push_set(relevant_tokens, headers.valid_constructors);
      push_set(relevant_tokens, headers.invalid_constructors);
      push_set(relevant_tokens, headers.invalid_messages_constructors);
      push_set(relevant_tokens, headers.iterable_locals);
      push_set(relevant_tokens, headers.async_iterable_locals);
      push_keys(relevant_tokens, scope_declarations);
      const found_active = collect_active_statement_indices(
        source,
        program.body,
        relevant_tokens,
        scan_from,
      );
      let non_import_count = 0;
      for (let index = 0; index < program.body.length; index += 1) {
        if (program.body[index].type !== "ImportDeclaration") {
          non_import_count += 1;
        }
      }
      if (found_active.length < non_import_count) {
        skipped_statements = true;
        active_indices = found_active;
        const active_set = new Set<Statement>();
        for (let i = 0; i < found_active.length; i += 1) {
          active_set.add(program.body[found_active[i]] as Statement);
        }
        skip_statement = (statement: Statement) => !active_set.has(statement);
      }
    }
  }

  if (
    config.optimizations?.candidate_scan !== false &&
    !has_iterable
  ) {
    const raw_scopes = scope_declarations.size > 0
      ? new Set([...headers.program_names, ...scope_declarations.keys()])
      : headers.program_names;
    let candidate = false;
    const scan_candidate = (root: Node) =>
      walk_values(root, (current) => {
        if (candidate) return false;
        if (current.type === "ImportDeclaration") return false;
        if (current.type !== "CallExpression") return;
        if (
          generator_kind(
            current,
            raw_scopes,
            headers as unknown as TransformServices["imports"],
          ) !== undefined
        ) {
          candidate = true;
          return false;
        }
        const callee = current.callee;
        if (
          callee.type === "Identifier" &&
          (headers.terminal_functions.has(callee.name) ||
            headers.cell_runners.has(callee.name) ||
            headers.operation_runners.has(callee.name) ||
            headers.state_eval_functions.has(callee.name) ||
            headers.task_run_functions.has(callee.name) ||
            headers.task_run_exit_functions.has(callee.name) ||
            headers.stm_atomically_functions.has(callee.name) ||
            headers.traverse_sequential_functions.has(callee.name) ||
            headers.match_functions.has(callee.name) ||
            headers.collect_functions.has(callee.name) ||
            headers.from_maybe_functions.has(callee.name) ||
            headers.to_nullable_functions.has(callee.name) ||
            headers.maybe_get_or_else_functions.has(callee.name) ||
            headers.maybe_fold_functions.has(callee.name) ||
            headers.maybe_filter_functions.has(callee.name) ||
            headers.either_fold_functions.has(callee.name) ||
            headers.either_from_right_functions.has(callee.name) ||
            headers.either_from_left_functions.has(callee.name) ||
            headers.either_recover_functions.has(callee.name) ||
            headers.array_to_array_functions.has(callee.name) ||
            callee.name === "Do" ||
            callee.name === "Program")
        ) {
          candidate = true;
          return false;
        }
        if (
          callee.type === "MemberExpression" && !callee.computed &&
          callee.property.type === "Identifier"
        ) {
          const property = callee.property.name;
          if (
            property === "Do" || property === "Program" || property === "run" ||
            property === "handle_with" || property === "value" ||
            property === "run_cells" || property === "prepare_cells" ||
            property === "handle_cells" ||
            property === "prepare_handle_cells" ||
            property === "handle_operations" ||
            property === "prepare_operations" ||
            property === "eval_state" || property === "exec_state" ||
            property === "run_task" || property === "run_task_exit" ||
            property === "atomically" ||
            property === "traverse" ||
            property === "traverse_sequential" || property === "match" ||
            property === "collect" || property === "lift" ||
            property === "map" || property === "bind" ||
            property === "fold" || property === "fold_while" ||
            property === "some" || property === "find"
          ) {
            candidate = true;
            return false;
          }
        }
      });
    if (active_indices !== undefined) {
      for (let i = 0; i < active_indices.length; i += 1) {
        scan_candidate(program.body[active_indices[i]] as Statement);
        if (candidate) break;
      }
    } else {
      for (let index = 0; index < program.body.length; index += 1) {
        const stmt = program.body[index] as Statement;
        if (stmt.type === "ImportDeclaration") continue;
        scan_candidate(stmt);
        if (candidate) break;
      }
    }
    if (!candidate) return unchanged_transform_result(source);
  }

  let position_fn: PositionLookup | undefined;
  function get_position(): PositionLookup {
    return position_fn ??= create_source_positions(source);
  }
  const diagnostics: TransformDiagnostic[] = [];
  const reports: TransformReport[] = [];
  function location(current: Node) {
    const at = get_position()(Math.max(current.start, 0));
    return { file_name, line: at.line, column: at.column + 1 };
  }
  function report(
    current: Node,
    optimization: TransformReport["optimization"],
    outcome: TransformReport["outcome"],
    message: string,
  ) {
    if (config.explain) {
      reports.push({ ...location(current), optimization, outcome, message });
    }
  }
  const names = new Set<string>();
  const shadow_tracker = create_import_shadow_tracker(
    headers,
    scope_declarations,
    source,
  );
  const bindings = create_binding_analysis(program, {
    names,
    minimal: true,
    skip_statement,
    active_indices,
    record_top_level_scopes: has_iterable,
    on_node(current) {
      if (current.type !== "ImportDeclaration") shadow_tracker.observe(current);
    },
  });
  const { imports, scopes, loop_support } = shadow_tracker.finish();
  const fresh_counts = new Map<string, number>();
  const prefix_in_source = new Map<string, boolean>();
  function fresh(prefix: string): IdentifierReference {
    let count = (fresh_counts.get(prefix) ?? 0) + 1;
    let name = prefix + "_" + count;
    let check_source = false;
    if (skipped_statements) {
      let present = prefix_in_source.get(prefix);
      if (present === undefined) {
        present = source.includes(prefix + "_");
        prefix_in_source.set(prefix, present);
      }
      check_source = present;
    }
    while (names.has(name) || (check_source && source.includes(name))) {
      count += 1;
      name = prefix + "_" + count;
    }
    fresh_counts.set(prefix, count);
    names.add(name);
    return id(name);
  }
  const requests: ImportRequest[] = [];
  function request(
    source: string,
    imported: string,
    prefix = imported,
    namespace = false,
  ) {
    const existing = requests.find((item) =>
      item.source === source && item.imported === imported &&
      Boolean(item.namespace) === namespace
    );
    if (existing !== undefined) return existing.local;
    const local = fresh(prefix);
    requests.push({ source, imported, local, namespace });
    return local;
  }
  function source_import(local: string): ImportDeclaration | undefined {
    return headers.import_declarations.get(local);
  }
  let effect: Expression | undefined;
  function effect_helper(): Expression {
    if (effect !== undefined) return effect;
    // Preserve the familiar public helper name when the module already imports it.
    if (imports.effect_names.size > 0) {
      effect = id(imports.effect_names.values().next().value!);
      return effect;
    }
    if (imports.program_module === undefined) {
      effect = id("Effect");
      return effect;
    }
    const local = id("Effect");
    names.add("Effect");
    requests.push({
      source: imports.program_module,
      imported: "Effect",
      local,
    });
    effect = local;
    return effect;
  }
  let loop: IdentifierReference | undefined;
  const flat_dictionaries = new Map<string, Expression | null>();
  const services: TransformServices = {
    program,
    source,
    file_name,
    config,
    bindings,
    imports,
    recursive_dictionaries: loop_support.dictionaries,
    task_dictionaries: loop_support.tasks,
    fresh,
    diagnose(current, message) {
      diagnostics.push({ ...location(current), message });
    },
    report,
    kind(current) {
      return generator_kind(current, scopes, imports);
    },
    effect: effect_helper,
    loop() {
      if (
        config.optimizations?.loop === false ||
        loop_support.specifier === undefined
      ) return undefined;
      loop ??= request(loop_support.specifier, "*", "loop_runtime", true);
      return loop;
    },
    flat_dictionary(expression) {
      const value = unwrap(expression);
      if (
        value.type !== "CallExpression" || value.callee.type !== "Identifier" ||
        !bindings.imported(value.callee)
      ) return undefined;
      const name = value.callee.name;
      if (flat_dictionaries.has(name)) {
        return flat_dictionaries.get(name) ?? undefined;
      }
      const declaration = source_import(name);
      let result: Expression | undefined;
      if (
        declaration !== undefined &&
        /^(?:(?:\.\.?\/)+src\/(?:maybe|either|identity|task|mod)\.ts|(?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?(?:\/(?:maybe|either|identity|task))?)$/
          .test(declaration.source.value)
      ) {
        const binding = declaration.specifiers.find((binding) =>
          binding.local.name === name
        );
        if (
          binding?.type === "ImportSpecifier" && binding.importKind !== "type"
        ) {
          let imported: string;
          if (binding.imported.type === "Identifier") {
            imported = binding.imported.name;
          } else imported = binding.imported.value;
          switch (imported) {
            case "Just":
            case "Nothing":
              imported = "Maybe";
              break;
            case "Left":
            case "Right":
              imported = "Either";
              break;
            case "identity":
              imported = "Identity";
              break;
            case "Task":
              break;
            default:
              imported = "";
          }
          if (imported) {
            result = request(
              declaration.source.value,
              imported,
              "flat_dictionary",
            );
          }
        }
      }
      flat_dictionaries.set(name, result ?? null);
      return result;
    },
    terminal(imported, source_local_name) {
      const declaration = source_import(source_local_name);
      if (declaration === undefined) {
        throw new Error("Missing terminal import " + source_local_name);
      }
      return request(declaration.source.value, imported);
    },
    import_from_module(anchor_local, sub_module, imported) {
      const declaration = source_import(anchor_local);
      if (declaration === undefined) return undefined;
      const spec = declaration.source.value;
      if (
        /^(?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?\/?$/.test(spec) ||
        /(?:^|\/)mod\.ts$/.test(spec)
      ) {
        return request(spec, imported);
      }
      const pkg_sub = /^((?:jsr:)?@mewhhaha\/typeclasses(?:@[^/]+)?)\/\w+\/?$/
        .exec(spec);
      if (pkg_sub !== null) {
        return request(pkg_sub[1] + "/" + sub_module, imported);
      }
      const file_sub = /^(.*\/)\w+(\.ts)$/.exec(spec);
      if (file_sub !== null) {
        return request(file_sub[1] + sub_module + file_sub[2], imported);
      }
      return undefined;
    },
    compile(current) {
      return lower_generator(current, services);
    },
  };
  const terminals = create_terminal_transform(
    services,
    skip_statement,
    r5_hints,
  );
  let iterable: ReturnType<typeof create_iterable_map_fusion> | undefined;
  if (has_iterable) {
    iterable = create_iterable_map_fusion(
      program,
      config.library_specifiers,
      bindings,
      (prefix) => fresh(prefix).name,
      skip_statement,
      source,
      services.import_from_module,
    );
  }
  let transformed = 0;
  const replaced = new WeakSet<Node>();
  function mark_replaced<T extends Node>(value: T): T {
    replaced.add(value);
    return value;
  }
  function terminal_report(current: Node, direct: boolean) {
    transformed += 1;
    let explanation =
      "Specialized terminal dispatch; unsupported primitives preserve the effect spine and keyed calls retain the original cell and runtime identity checks.";
    if (direct) {
      explanation =
        "Fused a primitive terminal body without an effect spine; eager construction and same-scope capture checks passed.";
    }
    report(current, "terminal", "transformed", explanation);
    if (!direct) {
      report(
        current,
        "terminal-body",
        "preserved",
        "The body contains noncanonical operations or lacks explicit input types, so dynamic terminal dispatch is retained.",
      );
    }
  }
  function visit(current: Node): Node {
    if (current.type === "ImportDeclaration" || terminals.skip(current)) {
      return current;
    }
    if (current.type === "CallExpression") {
      const fused = iterable?.fuse(current);
      if (fused !== undefined) {
        transformed += 1;
        report(
          current,
          "iterable-map",
          "transformed",
          "Composed adjacent lazy maps; callback evaluation and item order are retained.",
        );
        return mark_replaced(children(fused));
      }
      if (
        current.callee.type === "MemberExpression" &&
        !current.callee.computed &&
        current.callee.property.type === "Identifier" &&
        current.callee.property.name === "map" &&
        current.callee.object.type === "CallExpression"
      ) {
        report(
          current,
          "iterable-map",
          "preserved",
          "Map chain needs a known immutable iterable root and stable unary callbacks; optional calls and explicit type arguments are barriers.",
        );
      }
      // Immediate Program syntax must be visible before generator lowering.
      const terminal = terminals.lower(current, "before");
      if (terminal !== undefined) {
        terminal_report(current, terminal.direct);
        // Effect interpretation can expose another terminal call. Dynamic
        // terminal dispatch deliberately retains the original Program subtree.
        if (
          is_effect_interpreter_call(current) &&
          terminal.expression.type === "CallExpression"
        ) {
          const next = terminals.lower(terminal.expression);
          if (next !== undefined) {
            terminal_report(current, next.direct);
            return mark_replaced(next.expression);
          }
        }
        return mark_replaced(terminal.expression);
      }
      const kind = services.kind(current);
      if (kind !== undefined && config.optimizations?.generator !== false) {
        const diagnostic_start = diagnostics.length;
        const lowered = lower_generator(current, services);
        if (lowered !== undefined) {
          transformed += 1;
          report(
            current,
            "generator",
            "transformed",
            "Lowered the generator into dictionary continuations after checking capture and eager-prefix semantics.",
          );
          return mark_replaced(lowered);
        }
        report(
          current,
          "generator",
          "preserved",
          diagnostics.slice(diagnostic_start).map((diagnostic) =>
            diagnostic.message
          ).join(" "),
        );
        return current;
      }
      const visited = children(current);
      if (terminals.has_after && visited.type === "CallExpression") {
        const lowered = terminals.lower(visited);
        if (lowered !== undefined) {
          terminal_report(current, lowered.direct);
          if (
            is_effect_interpreter_call(visited) &&
            lowered.expression.type === "CallExpression"
          ) {
            const next = terminals.lower(lowered.expression);
            if (next !== undefined) {
              terminal_report(current, next.direct);
              return mark_replaced(next.expression);
            }
          }
          return mark_replaced(lowered.expression);
        }
      }
      const callee = current.callee;
      let target: string | undefined;
      if (callee.type === "Identifier") target = callee.name;
      if (
        callee.type === "MemberExpression" && !callee.computed &&
        callee.property.type === "Identifier"
      ) target = callee.property.name;
      if ((target === "Do" || target === "Program") && kind === undefined) {
        const run = current.arguments[current.arguments.length - 1];
        if (run?.type === "FunctionExpression" && run.generator) {
          services.diagnose(
            current,
            "Skipped " + target +
              ": callee is not imported from @mewhhaha/typeclasses.",
          );
        }
      }
      return visited;
    }
    return children(current);
  }
  function children(current: Node): Node {
    if (current === program && active_indices !== undefined) {
      const body = program.body;
      let items: Statement[] | undefined;
      for (let i = 0; i < active_indices.length; i += 1) {
        const idx = active_indices[i];
        const statement = body[idx] as Statement;
        const updated = visit(statement) as Statement;
        if (updated !== statement) {
          if (items === undefined) {
            items = body.slice() as Statement[];
          }
          items[idx] = updated;
        }
      }
      return items !== undefined ? { ...program, body: items } : program;
    }
    if (current === program && skip_statement !== undefined) {
      const body = program.body;
      let items: Statement[] | undefined;
      for (let item = 0; item < body.length; item += 1) {
        const statement = body[item] as Statement;
        if (
          statement.type === "ImportDeclaration" || skip_statement(statement)
        ) {
          if (items !== undefined) items.push(statement);
          continue;
        }
        const updated = visit(statement) as Statement;
        if (updated !== statement) {
          if (items === undefined) {
            items = body.slice(0, item) as Statement[];
          }
          items.push(updated);
        } else if (items !== undefined) {
          items.push(statement);
        }
      }
      return items !== undefined ? { ...program, body: items } : program;
    }
    let result = current;
    const keys = value_visitor_keys[current.type];
    if (keys === undefined || keys.length === 0) return result;
    const record = current as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const value = record[key];
      if (value === null || typeof value !== "object") continue;
      let next: unknown = value;
      if (Array.isArray(value)) {
        let items: unknown[] | undefined;
        for (let item = 0; item < value.length; item += 1) {
          const child = value[item];
          if (
            child === null || typeof child !== "object" ||
            typeof (child as { type?: unknown }).type !== "string"
          ) {
            if (items !== undefined) items.push(child);
            continue;
          }
          const updated = visit(child as Node);
          if (updated !== child) {
            if (items === undefined) items = value.slice(0, item);
            items.push(updated);
          } else if (items !== undefined) {
            items.push(child);
          }
        }
        if (items !== undefined) next = items;
      } else if (typeof (value as { type?: unknown }).type === "string") {
        next = visit(value as Node);
      }
      if (next !== value) result = { ...result, [key]: next };
    }
    return result;
  }
  const output = visit(program) as Program;
  if (transformed === 0) {
    return { code: source, diagnostics, map: null, transformed, reports };
  }

  const edits: SourceEdit[] = [];
  collect_import_edits(program, requests, edits);

  function collect_ast_edits(orig: Node, next: Node): void {
    if (orig === next) return;
    if (
      replaced.has(next) || orig.type !== next.type || next.start < 0 ||
      next.start !== orig.start || next.end !== orig.end
    ) {
      edits.push({
        kind: "replace",
        start: orig.start,
        end: orig.end,
        node: inline_iifes(next),
        is_expression: true,
      });
      return;
    }
    if (
      (orig.type === "Program" && next.type === "Program") ||
      (orig.type === "BlockStatement" && next.type === "BlockStatement")
    ) {
      const o_body = orig.body;
      const n_body = next.body;
      if (
        orig === program && active_indices !== undefined &&
        !terminals.has_removals()
      ) {
        for (let i = 0; i < active_indices.length; i += 1) {
          const index = active_indices[i];
          const o_stmt = o_body[index] as Statement;
          const n_stmt = n_body[index] as Statement;
          if (o_stmt === n_stmt) continue;
          const expanded = inline_statement(n_stmt);
          if (expanded !== undefined) {
            edits.push({
              kind: "replace_statements",
              start: o_stmt.start,
              end: o_stmt.end,
              statements: expanded.map((stmt) => inline_iifes(stmt)),
            });
            continue;
          }
          collect_ast_edits(o_stmt, n_stmt);
        }
        return;
      }
      for (let index = 0; index < o_body.length; index += 1) {
        const o_stmt = o_body[index] as Statement;
        const n_stmt = n_body[index] as Statement;
        if (terminals.remove(o_stmt)) {
          edits.push({ kind: "delete", start: o_stmt.start, end: o_stmt.end });
          continue;
        }
        const hoisted = terminals.hoist(o_stmt);
        if (hoisted !== undefined) {
          edits.push({
            kind: "replace_statements",
            start: o_stmt.start,
            end: o_stmt.end,
            statements: hoisted.map((stmt) => inline_iifes(stmt)),
          });
          continue;
        }
        if (o_stmt === n_stmt) continue;
        const expanded = inline_statement(n_stmt);
        if (expanded !== undefined) {
          edits.push({
            kind: "replace_statements",
            start: o_stmt.start,
            end: o_stmt.end,
            statements: expanded.map((stmt) => inline_iifes(stmt)),
          });
          continue;
        }
        collect_ast_edits(o_stmt, n_stmt);
      }
      return;
    }
    const keys = value_visitor_keys[orig.type];
    if (keys === undefined || keys.length === 0) return;
    const o_record = orig as unknown as Record<string, unknown>;
    const n_record = next as unknown as Record<string, unknown>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const o_val = o_record[key];
      const n_val = n_record[key];
      if (o_val === n_val || o_val === null || n_val === null) continue;
      if (Array.isArray(o_val) && Array.isArray(n_val)) {
        const length = Math.min(o_val.length, n_val.length);
        for (let item = 0; item < length; item += 1) {
          const o_child = o_val[item];
          const n_child = n_val[item];
          if (
            o_child !== n_child &&
            o_child !== null && typeof o_child === "object" &&
            n_child !== null && typeof n_child === "object" &&
            typeof (o_child as { type?: unknown }).type === "string" &&
            typeof (n_child as { type?: unknown }).type === "string"
          ) {
            collect_ast_edits(o_child as Node, n_child as Node);
          }
        }
      } else if (
        typeof o_val === "object" && typeof n_val === "object" &&
        typeof (o_val as { type?: unknown }).type === "string" &&
        typeof (n_val as { type?: unknown }).type === "string"
      ) {
        collect_ast_edits(o_val as Node, n_val as Node);
      }
    }
  }
  collect_ast_edits(program, output);

  const helper = iterable?.helper_declaration();
  if (helper !== undefined) {
    edits.push({
      kind: "insert",
      at: source.length,
      statements: [helper as Statement],
      prefix: "\n",
    });
  }

  const spliced = splice_edits(
    source,
    file_name,
    lang,
    parsed.comments,
    edits,
    config.source_map !== false,
    position_fn,
  );
  return {
    code: spliced.code,
    diagnostics,
    map: spliced.map,
    transformed,
    reports,
  };
}

function is_effect_interpreter_call(value: Expression): boolean {
  return value.type === "CallExpression" &&
    value.callee.type === "MemberExpression";
}

function collect_import_edits(
  program: Program,
  requests: readonly ImportRequest[],
  edits: SourceEdit[],
): void {
  if (requests.length === 0) return;
  const remaining = new Set(requests);
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" || statement.specifiers.some((binding) =>
        binding.type === "ImportNamespaceSpecifier"
      )
    ) {
      continue;
    }
    const added = requests.filter((request) =>
      !request.namespace && request.source === statement.source.value &&
      remaining.has(request)
    );
    if (added.length === 0) {
      continue;
    }
    for (const request of added) {
      remaining.delete(request);
    }
    edits.push({
      kind: "replace",
      start: statement.start,
      end: statement.end,
      node: {
        ...statement,
        specifiers: [
          ...statement.specifiers,
          ...added.map((request) =>
            node({
              type: "ImportSpecifier",
              imported: id(request.imported),
              local: request.local,
              importKind: "value" as const,
            })
          ),
        ],
      },
    });
  }
  if (remaining.size === 0) return;
  const inserted: Statement[] = [];
  for (const request of remaining) {
    let specifiers: ImportDeclaration["specifiers"];
    if (request.namespace) {
      specifiers = [
        node({ type: "ImportNamespaceSpecifier", local: request.local }),
      ];
    } else {
      specifiers = [
        node({
          type: "ImportSpecifier",
          imported: id(request.imported),
          local: request.local,
          importKind: "value",
        }),
      ];
    }
    inserted.unshift(
      node({
        type: "ImportDeclaration",
        source: literal(request.source) as ImportDeclaration["source"],
        specifiers,
        importKind: "value",
        attributes: [],
        phase: null,
      }) as unknown as Statement,
    );
  }
  let insert_at = 0;
  for (const statement of program.body) {
    if (
      statement.type === "ExpressionStatement" && "directive" in statement &&
      statement.directive != null
    ) continue;
    insert_at = statement.start;
    break;
  }
  edits.push({
    kind: "insert",
    at: insert_at,
    statements: inserted,
    suffix: "\n",
  });
}

function unchanged_transform_result(source: string): TransformResult {
  return {
    code: source,
    diagnostics: [],
    map: null,
    transformed: 0,
    reports: [],
  };
}

// Generated zero-argument wrappers contain compiler temporaries, which can move
// into a surrounding declaration or return without leaking source local names.
function is_generated_declaration(
  statement: Statement,
): statement is VariableDeclaration {
  return statement.type === "VariableDeclaration" &&
    statement.declarations.every((declaration) =>
      declaration.id.type === "Identifier" && declaration.id.start < 0
    );
}
type InlineResult = { prefix: Statement[]; expression: Expression };
function inline_expression(value: Expression): InlineResult | undefined {
  if (value.type !== "CallExpression" || value.optional) return undefined;
  const callee = unwrap(value.callee);
  if (
    value.start < 0 && value.arguments.length === 0 &&
    callee.type === "ArrowFunctionExpression" && !callee.async &&
    callee.params.length === 0 && callee.body.type === "BlockStatement"
  ) {
    const body = callee.body.body;
    const last = body[body.length - 1];
    if (
      last?.type === "ReturnStatement" && last.argument !== null &&
      body.slice(0, -1).every((statement) =>
        is_generated_declaration(statement as Statement)
      )
    ) {
      return {
        prefix: body.slice(0, -1) as Statement[],
        expression: last.argument,
      };
    }
  }
  if (
    !static_target(value.callee) || value.arguments[0] === undefined ||
    value.arguments[0].type === "SpreadElement"
  ) return undefined;
  const inner = inline_expression(value.arguments[0]);
  if (inner === undefined) return undefined;
  return {
    prefix: inner.prefix,
    expression: {
      ...value,
      arguments: [inner.expression, ...value.arguments.slice(1)],
    },
  };
}
function inline_sequence(
  value: Expression,
):
  | { declarations: VariableDeclarator[]; expression: Expression }
  | undefined {
  const inlined = inline_expression(value);
  if (inlined !== undefined && inlined.prefix.length > 0) {
    const declarations: VariableDeclarator[] = [];
    const expressions: Expression[] = [];
    for (const statement of inlined.prefix) {
      if (!is_generated_declaration(statement)) return undefined;
      for (const declaration of statement.declarations) {
        if (
          declaration.id.type !== "Identifier" || declaration.init === null
        ) return undefined;
        declarations.push({ ...declaration, init: null });
        expressions.push(
          node({
            type: "AssignmentExpression",
            operator: "=",
            left: id(declaration.id.name),
            right: declaration.init,
          }),
        );
      }
    }
    expressions.push(inlined.expression);
    return {
      declarations,
      expression: node({ type: "SequenceExpression", expressions }),
    };
  }
  if (
    value.type !== "CallExpression" || value.optional ||
    value.arguments.some((argument) => argument.type === "SpreadElement")
  ) return undefined;
  const declarations: VariableDeclarator[] = [];
  let changed = false;
  const args = value.arguments.map((argument) => {
    const result = inline_sequence(argument as Expression);
    if (result === undefined) return argument;
    changed = true;
    declarations.push(...result.declarations);
    return result.expression;
  });
  if (!changed) return undefined;
  return { declarations, expression: { ...value, arguments: args } };
}
function inline_statement(current: Statement): Statement[] | undefined {
  let value: Expression | null | undefined;
  if (current.type === "ReturnStatement") value = current.argument;
  if (
    current.type === "VariableDeclaration" &&
    current.declarations.length === 1
  ) value = current.declarations[0].init;
  if (value == null) return undefined;
  const inlined = inline_expression(value);
  const sequenced = inlined === undefined && inline_sequence(value);
  let prefix: Statement[];
  let result: Expression;
  if (inlined !== undefined) {
    prefix = inlined.prefix;
    result = inlined.expression;
  } else if (sequenced) {
    prefix = [
      node({
        type: "VariableDeclaration",
        kind: "let",
        declarations: sequenced.declarations,
      }),
    ];
    result = sequenced.expression;
  } else if (
    current.type === "ReturnStatement" &&
    value.type === "CallExpression" && !value.optional && value.start < 0 &&
    value.arguments.length === 0
  ) {
    const callee = unwrap(value.callee);
    if (
      callee.type === "ArrowFunctionExpression" && !callee.async &&
      callee.params.length === 0 && callee.body.type === "BlockStatement"
    ) {
      const body = callee.body.body;
      const last = body[body.length - 1];
      if (last?.type === "ReturnStatement") {
        return [callee.body];
      }
    }
    return undefined;
  } else return undefined;
  if (current.type === "ReturnStatement") {
    return [...prefix, { ...current, argument: result }];
  }
  if (current.type === "VariableDeclaration") {
    return [...prefix, {
      ...current,
      declarations: [{ ...current.declarations[0], init: result }],
    }];
  }
  return undefined;
}
function inline_iifes<T extends Node>(root: T): T {
  function descend(current: Node): Node {
    const type = current.type;
    switch (type) {
      case "Identifier":
      case "Literal":
      case "ThisExpression":
      case "TemplateElement":
      case "PrivateIdentifier":
      case "EmptyStatement":
      case "BreakStatement":
      case "ContinueStatement":
        return current;
      case "MemberExpression": {
        const obj = descend(current.object) as Expression;
        const prop = current.computed
          ? descend(current.property) as Expression
          : current.property;
        if (obj === current.object && prop === current.property) return current;
        return { ...current, object: obj, property: prop } as Node;
      }
      case "BinaryExpression": {
        const left = current.left.type === "PrivateIdentifier"
          ? current.left
          : descend(current.left) as Expression;
        const right = descend(current.right) as Expression;
        if (left === current.left && right === current.right) return current;
        return { ...current, left, right } as Node;
      }
      case "LogicalExpression": {
        const left = descend(current.left) as Expression;
        const right = descend(current.right) as Expression;
        if (left === current.left && right === current.right) return current;
        return { ...current, left, right };
      }
      case "UnaryExpression":
      case "UpdateExpression": {
        const arg = descend(current.argument) as Expression;
        if (arg === current.argument) return current;
        return { ...current, argument: arg } as Node;
      }
      case "ReturnStatement": {
        if (current.argument === null) return current;
        const arg = descend(current.argument) as Expression;
        return arg === current.argument
          ? current
          : { ...current, argument: arg };
      }
      case "ExpressionStatement": {
        const expr = descend(current.expression) as Expression;
        return expr === current.expression
          ? current
          : { ...current, expression: expr };
      }
      case "VariableDeclarator": {
        if (current.init === null) return current;
        const init = descend(current.init) as Expression;
        return init === current.init ? current : { ...current, init };
      }
      case "VariableDeclaration": {
        const decls = current.declarations;
        let next_decls: VariableDeclarator[] | undefined;
        for (let i = 0; i < decls.length; i += 1) {
          const d = decls[i];
          const updated = descend(d) as VariableDeclarator;
          if (updated !== d) {
            if (next_decls === undefined) next_decls = decls.slice(0, i);
            next_decls.push(updated);
          } else if (next_decls !== undefined) next_decls.push(d);
        }
        return next_decls === undefined
          ? current
          : { ...current, declarations: next_decls };
      }
      case "CallExpression": {
        const callee = descend(current.callee) as Expression;
        const args = current.arguments;
        let next_args: typeof args | undefined;
        for (let i = 0; i < args.length; i += 1) {
          const a = args[i];
          const updated = descend(a) as typeof a;
          if (updated !== a) {
            if (next_args === undefined) next_args = args.slice(0, i);
            next_args.push(updated);
          } else if (next_args !== undefined) next_args.push(a);
        }
        if (callee === current.callee && next_args === undefined) {
          return current;
        }
        return {
          ...current,
          callee,
          arguments: next_args ?? args,
        };
      }
      case "IfStatement": {
        const test = descend(current.test) as Expression;
        const cons = descend(current.consequent) as Statement;
        const alt = current.alternate !== null
          ? descend(current.alternate) as Statement
          : null;
        if (
          test === current.test && cons === current.consequent &&
          alt === current.alternate
        ) return current;
        return { ...current, test, consequent: cons, alternate: alt };
      }
      case "ArrowFunctionExpression": {
        const body = descend(current.body) as typeof current.body;
        return body === current.body ? current : { ...current, body };
      }
      case "BlockStatement":
      case "Program": {
        const orig_body = current.body;
        let next_body: Statement[] | undefined;
        for (let i = 0; i < orig_body.length; i += 1) {
          const item = orig_body[i] as Statement;
          const rewritten = descend(item) as Statement;
          const expanded = inline_statement(rewritten);
          if (expanded !== undefined) {
            if (next_body === undefined) {
              next_body = orig_body.slice(0, i) as Statement[];
            }
            next_body.push(...expanded);
          } else if (rewritten !== item) {
            if (next_body === undefined) {
              next_body = orig_body.slice(0, i) as Statement[];
            }
            next_body.push(rewritten);
          } else if (next_body !== undefined) {
            next_body.push(item);
          }
        }
        return next_body === undefined
          ? current
          : { ...current, body: next_body };
      }
    }
    if (type.startsWith("TS")) return current;
    let result = current;
    const keys = value_visitor_keys[type];
    if (keys !== undefined && keys.length > 0) {
      const record = current as unknown as Record<string, unknown>;
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index];
        const value = record[key];
        if (value === null || typeof value !== "object") continue;
        let next: unknown = value;
        if (Array.isArray(value)) {
          let items: unknown[] | undefined;
          for (let item = 0; item < value.length; item += 1) {
            const child = value[item];
            if (
              child === null || typeof child !== "object" ||
              typeof (child as { type?: unknown }).type !== "string"
            ) {
              if (items !== undefined) items.push(child);
              continue;
            }
            const rewritten = descend(child as Node);
            if (rewritten !== child) {
              if (items === undefined) items = value.slice(0, item);
              items.push(rewritten);
            } else if (items !== undefined) {
              items.push(child);
            }
          }
          if (items !== undefined) next = items;
        } else if (typeof (value as { type?: unknown }).type === "string") {
          next = descend(value as Node);
        }
        if (next !== value) result = { ...result, [key]: next };
      }
    }
    return result;
  }
  return descend(root) as T;
}
function static_target(value: Expression): boolean {
  if (value.type === "Identifier") return true;
  return value.type === "MemberExpression" && !value.computed &&
    !value.optional && static_target(value.object);
}

async function run_cli(args: readonly string[]) {
  const write = args.includes("--write");
  const check = args.includes("--check");
  const explain = args.includes("--explain");
  const files = args.filter((arg) =>
    arg !== "--" && arg !== "--write" && arg !== "--check" &&
    arg !== "--explain"
  );

  if (files.length === 0) {
    console.error(
      "usage: deno run --allow-env --allow-read --allow-write --allow-ffi tools/transform_do_program.ts [--write] [--check] [--explain] <file...>",
    );
    Deno.exit(2);
  }

  let failed = false;

  for (const file of files) {
    const source = await Deno.readTextFile(file);
    const result = transform_do_program_source(source, file, { explain });
    for (const report of result.reports) console.error(JSON.stringify(report));

    for (const diagnostic of result.diagnostics) {
      console.error(format_diagnostic(diagnostic));
    }

    failed = failed || (check && result.diagnostics.length > 0);

    if (write) {
      await Deno.writeTextFile(file, result.code);
      continue;
    }

    if (files.length > 1) {
      console.log("// " + file);
    }

    console.log(result.code);
  }

  if (failed) {
    Deno.exit(1);
  }
}

/** Compiler and transform revision included in every cache key. */
export const transform_cache_version: string =
  "14:oxc-parser@0.154.0:esrap@2.4.0";

/** A bounded transform cache with observable hit, miss and retention counts. */
export type TransformCache = {
  transform(
    source: string,
    file_name?: string,
    config?: TransformConfig,
  ): TransformResult;
  clear(): void;
  stats(): {
    hits: number;
    misses: number;
    size: number;
    capacity: number;
    bytes: number;
    max_bytes: number;
  };
};

type CacheEntry = {
  readonly source: string;
  readonly meta: string;
  readonly result: TransformResult;
  readonly bytes: number;
};

function cache_meta_key(
  file_name: string,
  config: TransformConfig,
): string {
  if (
    config.library_specifiers === undefined &&
    config.terminal_library_specifiers === undefined &&
    config.optimizations === undefined
  ) {
    return transform_cache_version + "\0" + file_name + "\0" +
      (config.explain ? "1" : "0") +
      (config.source_map === false ? "0" : "1");
  }
  return JSON.stringify([
    transform_cache_version,
    file_name,
    config.library_specifiers ?? [],
    config.terminal_library_specifiers ?? [],
    config.explain ?? false,
    config.source_map ?? true,
    config.optimizations ?? {},
  ]);
}

/** A bounded LRU cache. Source text and all semantic config are part of the key. */
function transform_result_bytes(
  meta: string,
  source_length: number,
  result: TransformResult,
): number {
  let characters = meta.length + source_length + 1 + result.code.length;
  const map = result.map;
  if (map !== null) {
    characters += map.file.length + map.sourceRoot.length + map.mappings.length;
    for (const text of map.sources) characters += text.length;
    for (const text of map.sourcesContent ?? []) {
      characters += text?.length ?? 0;
    }
    for (const text of map.names) characters += text.length;
  }
  for (const item of result.diagnostics) {
    characters += item.file_name.length + item.message.length;
  }
  for (const item of result.reports) {
    characters += item.file_name.length + item.message.length;
  }
  // Conservative UTF-16 string storage plus fixed container estimates. This is
  // a retention budget, not a measurement of the engine's object layout.
  return characters * 2 + 512 + result.diagnostics.length * 128 +
    result.reports.length * 160;
}

/** A bounded LRU cache. Source text and all semantic config are part of the key. */
export function create_transform_cache(
  capacity = 32,
  max_bytes = 4 * 1024 * 1024,
): TransformCache {
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError(
      "transform cache capacity must be a nonnegative integer",
    );
  }
  if (!Number.isSafeInteger(max_bytes) || max_bytes < 0) {
    throw new RangeError(
      "transform cache byte limit must be a nonnegative integer",
    );
  }
  const by_source = new Map<string, Map<string, CacheEntry>>();
  const lru = new Set<CacheEntry>();
  let bytes = 0;
  let hits = 0;
  let misses = 0;
  return {
    transform(
      source: string,
      file_name = "input.ts",
      config: TransformConfig = {},
    ): TransformResult {
      if (capacity === 0 || max_bytes === 0) {
        misses += 1;
        return transform_do_program_source(source, file_name, config);
      }
      const meta = cache_meta_key(file_name, config);
      const bucket = by_source.get(source);
      const cached = bucket?.get(meta);
      if (cached !== undefined) {
        hits += 1;
        lru.delete(cached);
        lru.add(cached);
        return clone_transform_result(cached.result);
      }
      misses += 1;
      const result = transform_do_program_source(source, file_name, config);
      const entry_bytes = transform_result_bytes(meta, source.length, result);
      if (capacity > 0 && entry_bytes <= max_bytes) {
        while (lru.size >= capacity || bytes + entry_bytes > max_bytes) {
          const oldest = lru.values().next().value!;
          lru.delete(oldest);
          bytes -= oldest.bytes;
          const old_bucket = by_source.get(oldest.source);
          if (old_bucket !== undefined) {
            old_bucket.delete(oldest.meta);
            if (old_bucket.size === 0) by_source.delete(oldest.source);
          }
        }
        const entry: CacheEntry = {
          source,
          meta,
          result: clone_transform_result(result),
          bytes: entry_bytes,
        };
        let target_bucket = by_source.get(source);
        if (target_bucket === undefined) {
          target_bucket = new Map();
          by_source.set(source, target_bucket);
        }
        target_bucket.set(meta, entry);
        lru.add(entry);
        bytes += entry_bytes;
      }
      return result;
    },
    clear() {
      by_source.clear();
      lru.clear();
      bytes = 0;
    },
    stats() {
      return { hits, misses, size: lru.size, capacity, bytes, max_bytes };
    },
  };
}

// Source and generated code are immutable strings; clone only public containers.
function clone_transform_result(result: TransformResult): TransformResult {
  let map: TransformSourceMap | null = null;
  if (result.map !== null) {
    map = {
      ...result.map,
      sources: [...result.map.sources],
      names: [...result.map.names],
    };
    if (result.map.sourcesContent !== undefined) {
      map = { ...map, sourcesContent: [...result.map.sourcesContent] };
    }
  }
  return {
    ...result,
    map,
    diagnostics: result.diagnostics.map((item) => ({ ...item })),
    reports: result.reports.map((item) => ({ ...item })),
  };
}

function format_diagnostic(diagnostic: TransformDiagnostic): string {
  return diagnostic.file_name + ":" + diagnostic.line + ":" +
    diagnostic.column + ": " + diagnostic.message;
}
if (import.meta.main) await run_cli(Deno.args);

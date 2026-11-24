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
  create_import_shadow_tracker,
  generator_kind,
  might_contain_transform_target,
  scan_import_headers,
  scan_scope_declarations,
} from "./transform_imports.ts";
import { lower_generator } from "./transform_generator.ts";
import { create_terminal_transform } from "./transform_terminals.ts";
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

/** Lower supported generators, effect runners, and lazy iterable map chains. */
export function transform_do_program_source(
  source: string,
  file_name = "input.ts",
  config: TransformConfig = {},
): TransformResult {
  if (!might_contain_transform_target(source)) {
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
    might_contain_iterable_maps(source);
  const scope_declarations = source.includes("scope") || has_unicode
    ? scan_scope_declarations(program, headers)
    : new Map<string, number>();

  let min_relevant = -1;
  let max_relevant = -1;
  if (!has_iterable && !has_unicode && headers.leading_imports_end >= 0) {
    const scan_from = headers.leading_imports_end;
    let has_target_token = false;
    const check_token = (token: string, is_target: boolean) => {
      const first = source.indexOf(token, scan_from);
      if (first < 0) return;
      if (is_target) has_target_token = true;
      if (min_relevant < 0 || first < min_relevant) min_relevant = first;
      const last = source.lastIndexOf(token);
      if (last > max_relevant) max_relevant = last;
    };
    check_token("Do", true);
    check_token("Program", true);
    check_token("run", true);
    check_token("handle_with", true);
    check_token("value", true);
    for (const name of headers.do_names) check_token(name, true);
    for (const name of headers.program_names) check_token(name, true);
    for (const name of headers.namespaces) check_token(name, true);
    for (const name of headers.terminal_functions.keys()) {
      check_token(name, true);
    }
    for (const name of headers.terminal_namespaces.keys()) {
      check_token(name, true);
    }
    for (const name of headers.cell_runners.keys()) check_token(name, true);
    for (const name of headers.cell_runner_namespaces.keys()) {
      check_token(name, true);
    }
    if (config.optimizations?.candidate_scan !== false && !has_target_token) {
      return unchanged_transform_result(source);
    }
    if (
      !config.explain &&
      headers.terminal_functions.size === 0 &&
      headers.terminal_namespaces.size === 0 &&
      headers.cell_runners.size === 0 &&
      headers.cell_runner_namespaces.size === 0
    ) {
      check_token("Effect", false);
      for (const name of headers.effect_names) check_token(name, false);
      for (const name of headers.loop_dictionaries) check_token(name, false);
      for (const name of headers.direct_maybe_dictionaries) {
        check_token(name, false);
      }
      for (const name of headers.just_constructors) check_token(name, false);
      for (const name of headers.direct_either_dictionaries) {
        check_token(name, false);
      }
      for (const name of headers.right_constructors) check_token(name, false);
      for (const name of headers.direct_reader_dictionaries) {
        check_token(name, false);
      }
      for (const name of headers.direct_state_dictionaries) {
        check_token(name, false);
      }
      for (const name of scope_declarations.keys()) check_token(name, false);
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
    walk_values(program, (current) => {
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
          headers.cell_runners.has(callee.name) || callee.name === "Do" ||
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
          property === "run_cells" || property === "prepare_cells"
        ) {
          candidate = true;
          return false;
        }
      }
    });
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
  let skipped_statements = false;
  const skip_statement = !has_iterable && !has_unicode && !config.explain &&
      headers.terminal_functions.size === 0 &&
      headers.terminal_namespaces.size === 0 &&
      headers.cell_runners.size === 0 &&
      headers.cell_runner_namespaces.size === 0 && min_relevant >= 0
    ? (statement: Statement) => {
      if (statement.end <= min_relevant || statement.start > max_relevant) {
        skipped_statements = true;
        return true;
      }
      return false;
    }
    : undefined;
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
    on_node(current) {
      if (current.type !== "ImportDeclaration") shadow_tracker.observe(current);
    },
  });
  const { imports, scopes, loop_support } = shadow_tracker.finish();
  const fresh_counts = new Map<string, number>();
  function fresh(prefix: string): IdentifierReference {
    let count = (fresh_counts.get(prefix) ?? 0) + 1;
    let name = prefix + "_" + count;
    while (names.has(name) || (skipped_statements && source.includes(name))) {
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
    compile(current) {
      return lower_generator(current, services);
    },
  };
  const terminals = create_terminal_transform(services, skip_statement);
  let iterable: ReturnType<typeof create_iterable_map_fusion> | undefined;
  if (
    config.optimizations?.iterable_map !== false &&
    might_contain_iterable_maps(source)
  ) {
    iterable = create_iterable_map_fusion(
      program,
      config.library_specifiers,
      bindings,
      (prefix) => fresh(prefix).name,
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
      if (visited.type === "CallExpression") {
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
    callee.type === "ArrowFunctionExpression" && callee.params.length === 0 &&
    callee.body.type === "BlockStatement"
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
    let result = current;
    const keys = value_visitor_keys[current.type];
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
    if (result.type !== "Program" && result.type !== "BlockStatement") {
      return result;
    }
    let body: Statement[] | undefined;
    for (let index = 0; index < result.body.length; index += 1) {
      const item = result.body[index] as Statement;
      const expanded = inline_statement(item);
      if (expanded !== undefined) {
        if (body === undefined) {
          body = result.body.slice(0, index) as Statement[];
        }
        body.push(...expanded);
      } else if (body !== undefined) {
        body.push(item);
      }
    }
    if (body === undefined) return result;
    return { ...result, body };
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
  "8:oxc-parser@0.154.0:esrap@2.4.0";

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

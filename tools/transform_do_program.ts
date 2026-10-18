import { parseSync, visitorKeys } from "oxc-parser";
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
import { print } from "esrap";
import ts_language from "esrap/languages/ts";
import tsx_language from "esrap/languages/tsx";
import { basename } from "node:path";
import {
  id,
  is_node,
  literal,
  node,
  rewrite,
  unwrap,
  walk,
} from "./transform_ast.ts";
import { create_binding_analysis } from "./transform_bindings.ts";
import {
  collect_imports,
  collect_loop_support,
  collect_program_scopes,
  generator_kind,
} from "./transform_imports.ts";
import { lower_generator } from "./transform_generator.ts";
import { create_terminal_transform } from "./transform_terminals.ts";
import {
  create_iterable_map_fusion,
  might_contain_iterable_maps,
} from "./transform_iterable_maps.ts";
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

/** Lower supported generators, effect runners, and lazy iterable map chains. */
export function transform_do_program_source(
  source: string,
  file_name = "input.ts",
  config: TransformConfig = {},
): TransformResult {
  if (!might_contain_transform_target(source)) {
    return unchanged_transform_result(source);
  }
  let lang: "ts" | "tsx" = "ts";
  if (file_name.split("?", 1)[0].toLowerCase().endsWith(".tsx")) lang = "tsx";
  const parsed = parseSync(file_name, source, {
    lang,
    astType: "ts",
    preserveParens: false,
  });
  if (parsed.errors.length > 0) {
    const position = source_positions(source);
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
  const imports = collect_imports(program, source, config);
  let scopes = imports.program_names;
  if (source.includes("scope") || source.includes("\\u")) {
    scopes = collect_program_scopes(program, imports);
  }
  if (
    config.optimizations?.candidate_scan !== false &&
    !(config.optimizations?.iterable_map !== false &&
      might_contain_iterable_maps(source))
  ) {
    let candidate = false;
    walk(program, (current) => {
      if (candidate) return false;
      if (current.type !== "CallExpression") return;
      if (generator_kind(current, scopes, imports) !== undefined) {
        candidate = true;
        return false;
      }
      const callee = current.callee;
      if (
        callee.type === "Identifier" &&
        (imports.terminal_functions.has(callee.name) || callee.name === "Do" ||
          callee.name === "Program")
      ) candidate = true;
      if (
        callee.type === "MemberExpression" && !callee.computed &&
        callee.property.type === "Identifier" &&
        ["Do", "Program", "run", "handle_with", "value"].includes(
          callee.property.name,
        )
      ) candidate = true;
    });
    if (!candidate) return unchanged_transform_result(source);
  }
  const position = source_positions(source);
  walk(program, (current) => {
    if (current.start < 0) return;
    Object.assign(current, {
      loc: { start: position(current.start), end: position(current.end) },
    });
  });
  const comments = parsed.comments.map((comment) => ({
    ...comment,
    loc: { start: position(comment.start), end: position(comment.end) },
  }));
  const diagnostics: TransformDiagnostic[] = [];
  const reports: TransformReport[] = [];
  function location(current: Node) {
    const at = position(Math.max(current.start, 0));
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
  const bindings = create_binding_analysis(program);
  const loop_support = collect_loop_support(program);
  const names = new Set<string>();
  walk(program, (current) => {
    if (current.type === "Identifier") names.add(current.name);
  });
  const fresh_counts = new Map<string, number>();
  function fresh(prefix: string): IdentifierReference {
    let count = (fresh_counts.get(prefix) ?? 0) + 1;
    let name = prefix + "_" + count;
    while (names.has(name)) {
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
    return program.body.find((statement): statement is ImportDeclaration =>
      statement.type === "ImportDeclaration" &&
      statement.importKind !== "type" &&
      statement.specifiers.some((binding) => binding.local.name === local)
    );
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
  const terminals = create_terminal_transform(services);
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
    if (terminals.skip(current)) return current;
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
        return children(fused);
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
            return next.expression;
          }
        }
        return terminal.expression;
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
          return lowered;
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
              return next.expression;
            }
          }
          return lowered.expression;
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
    let result = current;
    const record = current as unknown as Record<string, unknown>;
    for (const key of visitorKeys[current.type] ?? []) {
      const value = record[key];
      let next: unknown = value;
      if (Array.isArray(value)) {
        let changed = false;
        const items = value.map((child) => {
          if (!is_node(child)) return child;
          const updated = visit(child);
          changed ||= updated !== child;
          return updated;
        });
        if (changed) next = items;
      } else if (is_node(value)) next = visit(value);
      if (next !== value) result = { ...result, [key]: next };
    }
    return result;
  }
  let output = visit(program) as Program;
  output = rewrite(output, (current) => {
    if (terminals.remove(current)) return null;
  });
  if (transformed === 0) {
    return { code: source, diagnostics, map: null, transformed, reports };
  }
  output = add_imports(output, requests);
  if (iterable !== undefined) output = iterable.add_helper(output);
  output = inline_iifes(output);
  let language = ts_language({ quotes: "double", comments });
  if (lang === "tsx") language = tsx_language({ quotes: "double", comments });
  if (config.source_map === false) {
    const previous = language._;
    language._ = (current, context, visitor) => {
      const previous_location = context.location;
      context.location = () => {};
      try {
        if (previous !== undefined) previous(current, context, visitor);
        else visitor(current);
      } finally {
        context.location = previous_location;
      }
    };
  }
  const printed = print(output, language, {
    indent: "  ",
    sourceMapSource: basename(file_name),
    sourceMapContent: source,
  });
  let map: TransformSourceMap | null = null;
  if (config.source_map !== false) {
    map = {
      ...(printed.map as Omit<TransformSourceMap, "file" | "sourceRoot">),
      file: basename(file_name),
      sourceRoot: "",
    };
  }
  return { code: printed.code + "\n", diagnostics, map, transformed, reports };
}

function is_effect_interpreter_call(value: Expression): boolean {
  return value.type === "CallExpression" &&
    value.callee.type === "MemberExpression";
}
function source_positions(source: string) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charCodeAt(index);
    if (character === 13) {
      if (source.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (
      character === 10 || character === 0x2028 || character === 0x2029
    ) starts.push(index + 1);
  }
  return (offset: number) => {
    let left = 0;
    let right = starts.length;
    while (left + 1 < right) {
      const middle = (left + right) >>> 1;
      if (starts[middle] <= offset) left = middle;
      else right = middle;
    }
    return { line: left + 1, column: offset - starts[left] };
  };
}
function add_imports(
  program: Program,
  requests: readonly ImportRequest[],
): Program {
  const remaining = new Set(requests);
  const body = program.body.map((statement) => {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.importKind === "type" || statement.specifiers.some((binding) =>
        binding.type === "ImportNamespaceSpecifier"
      )
    ) {
      return statement;
    }
    const added = requests.filter((request) =>
      !request.namespace && request.source === statement.source.value &&
      remaining.has(request)
    );
    for (const request of added) {
      remaining.delete(request);
    }
    return {
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
    };
  });
  for (const request of remaining) {
    let specifiers: ImportDeclaration["specifiers"];
    if (request.namespace) {
      specifiers = [
        node({ type: "ImportNamespaceSpecifier", local: request.local }),
      ];
    } else {specifiers = [
        node({
          type: "ImportSpecifier",
          imported: id(request.imported),
          local: request.local,
          importKind: "value",
        }),
      ];}
    body.unshift(
      node({
        type: "ImportDeclaration",
        source: literal(request.source) as ImportDeclaration["source"],
        specifiers,
        importKind: "value",
        attributes: [],
        phase: null,
      }),
    );
  }
  return { ...program, body };
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
function might_contain_transform_target(source: string): boolean {
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

// Generated zero-argument wrappers contain compiler temporaries, which can move
// into a surrounding declaration or return without leaking source local names.
function inline_iifes(program: Program): Program {
  function generated(statement: Statement): statement is VariableDeclaration {
    return statement.type === "VariableDeclaration" &&
      statement.declarations.every((declaration) =>
        declaration.id.type === "Identifier" && declaration.id.start < 0
      );
  }
  type Inline = { prefix: Statement[]; expression: Expression };
  function expression(value: Expression): Inline | undefined {
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
          generated(statement as Statement)
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
    const inner = expression(value.arguments[0]);
    if (inner === undefined) return undefined;
    return {
      prefix: inner.prefix,
      expression: {
        ...value,
        arguments: [inner.expression, ...value.arguments.slice(1)],
      },
    };
  }
  function sequence(
    value: Expression,
  ):
    | { declarations: VariableDeclarator[]; expression: Expression }
    | undefined {
    const inlined = expression(value);
    if (inlined !== undefined && inlined.prefix.length > 0) {
      const declarations: VariableDeclarator[] = [];
      const expressions: Expression[] = [];
      for (const statement of inlined.prefix) {
        if (!generated(statement)) return undefined;
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
      const result = sequence(argument as Expression);
      if (result === undefined) return argument;
      changed = true;
      declarations.push(...result.declarations);
      return result.expression;
    });
    if (!changed) return undefined;
    return { declarations, expression: { ...value, arguments: args } };
  }
  function statement(current: Statement): Statement[] {
    let value: Expression | null | undefined;
    if (current.type === "ReturnStatement") value = current.argument;
    if (
      current.type === "VariableDeclaration" &&
      current.declarations.length === 1
    ) value = current.declarations[0].init;
    if (value == null) return [current];
    const inlined = expression(value);
    const sequenced = inlined === undefined && sequence(value);
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
    } else return [current];
    if (current.type === "ReturnStatement") {
      return [...prefix, { ...current, argument: result }];
    }
    if (current.type === "VariableDeclaration") {
      return [...prefix, {
        ...current,
        declarations: [{ ...current.declarations[0], init: result }],
      }];
    }
    return [current];
  }
  return rewrite(program, (current) => {
    if (current.type !== "Program" && current.type !== "BlockStatement") return;
    return {
      ...current,
      body: current.body.flatMap((item) => statement(item as Statement)),
    };
  });
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
  "5:oxc-parser@0.154.0:esrap@2.4.0";

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

/** A bounded LRU cache. Source text and all semantic config are part of the key. */
function transform_result_bytes(key: string, result: TransformResult): number {
  let characters = key.length + result.code.length;
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
  const entries = new Map<string, { result: TransformResult; bytes: number }>();
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
      const key = JSON.stringify([
        transform_cache_version,
        file_name,
        config.library_specifiers ?? [],
        config.terminal_library_specifiers ?? [],
        config.explain ?? false,
        config.source_map ?? true,
        config.optimizations ?? {},
      ]) + "\0" + source;
      const cached = entries.get(key);
      if (cached !== undefined) {
        hits += 1;
        entries.delete(key);
        entries.set(key, cached);
        return clone_transform_result(cached.result);
      }
      misses += 1;
      const result = transform_do_program_source(source, file_name, config);
      const entry_bytes = transform_result_bytes(key, result);
      if (capacity > 0 && entry_bytes <= max_bytes) {
        while (entries.size >= capacity || bytes + entry_bytes > max_bytes) {
          const oldest = entries.keys().next().value!;
          bytes -= entries.get(oldest)!.bytes;
          entries.delete(oldest);
        }
        entries.set(key, {
          result: clone_transform_result(result),
          bytes: entry_bytes,
        });
        bytes += entry_bytes;
      }
      return result;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    stats() {
      return { hits, misses, size: entries.size, capacity, bytes, max_bytes };
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

import { transform_do_program_source } from "../tools/transform_do_program.ts";
import { assert_equals } from "../src/assert.ts";

type CaseStudyName =
  | "http_router"
  | "io_application"
  | "agent_harness"
  | "parallel_analyzer"
  | "programming_language_parser";

type TransformStats = Record<
  CaseStudyName,
  { rewrites: number; preserved: number }
>;

type ModuleSet = {
  readonly label: string;
  readonly stats: TransformStats;
  readonly array: typeof import("../src/array.ts");
  readonly effects: typeof import("../src/effects.ts");
  readonly reader: typeof import("../src/reader.ts");
  readonly writer: typeof import("../src/writer.ts");
  readonly http_router: typeof import("../case_studies/http_router/mod.ts");
  readonly io_application:
    typeof import("../case_studies/io_application/mod.ts");
  readonly agent_harness: typeof import("../case_studies/agent_harness/mod.ts");
  readonly parallel_analyzer:
    typeof import("../case_studies/parallel_analyzer/analyzer.ts");
  readonly parallel_mod:
    typeof import("../case_studies/parallel_analyzer/mod.ts");
  readonly parallel_program:
    typeof import("../case_studies/parallel_analyzer/program.ts");
  readonly parser_language:
    typeof import("../case_studies/programming_language_parser/language.ts");
};

const source_root = new URL("../", import.meta.url);
const transformed_root = new URL(
  "file://" +
    await Deno.makeTempDir({
      prefix: "typeclasses-case-study-transform-bench-",
    }) + "/",
);
const original = await load_modules(source_root, "without transformer");
const transformed = await prepare_transformed_modules();
await Deno.remove(transformed_root, { recursive: true });

let _sink = 0;

register_case_study_benchmarks(original);
register_case_study_benchmarks(transformed);

function register_case_study_benchmarks(modules: ModuleSet) {
  Deno.bench(bench_name("http_router", modules), async () => {
    _sink = await run_http_router_dry(modules);
  });

  Deno.bench(bench_name("io_application", modules), async () => {
    _sink = await run_io_application_dry(modules);
  });

  Deno.bench(bench_name("agent_harness", modules), async () => {
    _sink = await run_agent_harness_dry(modules);
  });

  Deno.bench(bench_name("parallel_analyzer", modules), () => {
    _sink = run_parallel_analyzer_dry(modules);
  });

  Deno.bench(bench_name("programming_language_parser", modules), () => {
    _sink = run_parser_dry(modules);
  });
}

async function run_http_router_dry(modules: ModuleSet): Promise<number> {
  let checksum = 0;

  for (const input of http_requests) {
    const response = modules.http_router.route_http(
      new Request(input.url, { method: input.method }),
    );
    checksum += response.status;
    checksum += (await response.text()).length;
  }

  return checksum;
}

async function run_io_application_dry(modules: ModuleSet): Promise<number> {
  let checksum = 0;

  for (const argv of cli_commands) {
    const report = await modules.io_application.run_cli(argv, true);
    checksum += report.exit_code;
    checksum += report.stdout.length;
    checksum += Object.keys(report.files).length;
    checksum += Object.keys(report.writes).length;
  }

  return checksum;
}

async function run_agent_harness_dry(modules: ModuleSet): Promise<number> {
  const report = await modules.agent_harness.run_agent_harness();

  return report.result.turns +
    report.result.transcript.length +
    report.stdout.length +
    Object.keys(report.files).length +
    Object.keys(report.writes).length;
}

function run_parallel_analyzer_dry(modules: ModuleSet): number {
  const { report, logs } = observe_parallel_analyzer(modules);
  return report.files + report.parsed + report.failed + logs.length;
}

function observe_parallel_analyzer(modules: ModuleSet) {
  const files = modules.parallel_mod.sample_sources(32);
  const effect = modules.writer.run_writer(
    run_analyze_sources_locally(
      modules,
      modules.reader.run_reader(modules.parallel_program.parallel_analyzer, {
        files,
        workers: 4,
      }),
    ),
    modules.array.from_array<string>([]),
  ) as unknown as import("../src/effects.ts").Effect<
    never,
    readonly [
      import("../case_studies/parallel_analyzer/types.ts").AnalyzerReport,
      { value(): readonly string[] },
    ]
  >;
  const [report, logs] = modules.effects.Effect.interpret(effect).run(
    modules.effects.run,
  );

  return { report, logs: logs.value() };
}

function run_parser_dry(modules: ModuleSet): number {
  const parsed = modules.parser_language.parse_program(
    modules.parser_language.sample_program,
    "sample.typeclasses",
  );
  const broken = modules.parser_language.parse_program(
    modules.parser_language.broken_program,
    "broken.typeclasses",
  );

  return parsed[0].length + broken[0].length;
}

async function observe_case_studies(modules: ModuleSet) {
  const http = [];
  for (const input of http_requests) {
    const response = modules.http_router.route_http(
      new Request(input.url, { method: input.method }),
    );
    http.push({
      status: response.status,
      headers: [...response.headers],
      body: await response.text(),
    });
  }
  const cli = [];
  for (const argv of cli_commands) {
    cli.push(await modules.io_application.run_cli(argv, true));
  }
  return {
    http,
    cli,
    agent: await modules.agent_harness.run_agent_harness(),
    parallel: observe_parallel_analyzer(modules),
    parser: [
      modules.parser_language.parse_program(
        modules.parser_language.sample_program,
        "sample.typeclasses",
      ),
      modules.parser_language.parse_program(
        modules.parser_language.broken_program,
        "broken.typeclasses",
      ),
    ],
  };
}

function run_analyze_sources_locally(
  modules: ModuleSet,
  effect: import("../src/effects.ts").Effect<unknown, unknown>,
): import("../src/effects.ts").Effect<unknown, unknown> {
  if (effect[0] === "pure") {
    return modules.effects.Effect.pure(effect[1]);
  }

  const operation = effect[1] as readonly [string, unknown];

  if (operation[0] === "parallel_analyzer.analyze_sources") {
    const [, request] = effect[1] as readonly [
      "parallel_analyzer.analyze_sources",
      {
        readonly files:
          readonly import("../case_studies/parallel_analyzer/types.ts").SourceFile[];
      },
    ];
    const results = modules.parallel_analyzer.analyze_sources_sequential(
      request.files,
    );

    return run_analyze_sources_locally(modules, effect[2](results));
  }

  return modules.effects.Effect.suspend(effect[1], (value) => {
    return run_analyze_sources_locally(modules, effect[2](value));
  });
}

async function prepare_transformed_modules(): Promise<ModuleSet> {
  await remove_directory(transformed_root);
  await copy_tree(
    new URL("src/", source_root),
    new URL("src/", transformed_root),
    {
      transform: false,
      stats: empty_stats(),
      prefix: "src/",
    },
  );

  const stats = empty_stats();
  for (const study of Object.keys(stats) as CaseStudyName[]) {
    const path = `case_studies/${study}/`;
    await copy_tree(
      new URL(path, source_root),
      new URL(path, transformed_root),
      {
        transform: true,
        stats,
        prefix: path,
      },
    );
  }

  return await load_modules(transformed_root, "with transformer", stats);
}

async function load_modules(
  root: URL,
  label: string,
  stats = empty_stats(),
): Promise<ModuleSet> {
  const array = await import_module<typeof import("../src/array.ts")>(
    root,
    "src/array.ts",
  );
  const effects = await import_module<typeof import("../src/effects.ts")>(
    root,
    "src/effects.ts",
  );
  const reader = await import_module<typeof import("../src/reader.ts")>(
    root,
    "src/reader.ts",
  );
  const writer = await import_module<typeof import("../src/writer.ts")>(
    root,
    "src/writer.ts",
  );
  const http_router = await import_module<
    typeof import("../case_studies/http_router/mod.ts")
  >(root, "case_studies/http_router/mod.ts");
  const io_application = await import_module<
    typeof import("../case_studies/io_application/mod.ts")
  >(root, "case_studies/io_application/mod.ts");
  const agent_harness = await import_module<
    typeof import("../case_studies/agent_harness/mod.ts")
  >(root, "case_studies/agent_harness/mod.ts");
  const parallel_analyzer = await import_module<
    typeof import("../case_studies/parallel_analyzer/analyzer.ts")
  >(root, "case_studies/parallel_analyzer/analyzer.ts");
  const parallel_mod = await import_module<
    typeof import("../case_studies/parallel_analyzer/mod.ts")
  >(root, "case_studies/parallel_analyzer/mod.ts");
  const parallel_program = await import_module<
    typeof import("../case_studies/parallel_analyzer/program.ts")
  >(root, "case_studies/parallel_analyzer/program.ts");
  const parser_language = await import_module<
    typeof import("../case_studies/programming_language_parser/language.ts")
  >(root, "case_studies/programming_language_parser/language.ts");

  return {
    label,
    stats,
    array,
    effects,
    reader,
    writer,
    http_router,
    io_application,
    agent_harness,
    parallel_analyzer,
    parallel_mod,
    parallel_program,
    parser_language,
  };
}

async function import_module<module>(
  root: URL,
  path: string,
): Promise<module> {
  return await import(new URL(path, root).href) as module;
}

async function copy_tree(
  source: URL,
  destination: URL,
  options: {
    readonly transform: boolean;
    readonly stats: TransformStats;
    readonly prefix: string;
  },
) {
  await Deno.mkdir(destination, { recursive: true });

  for await (const entry of Deno.readDir(source)) {
    const source_path = new URL(entry.name, source);
    const destination_path = new URL(entry.name, destination);
    const relative_path = options.prefix + entry.name;

    if (entry.isDirectory) {
      await copy_tree(
        new URL(entry.name + "/", source),
        new URL(entry.name + "/", destination),
        {
          transform: options.transform,
          stats: options.stats,
          prefix: relative_path + "/",
        },
      );
      continue;
    }

    if (entry.isFile && entry.name.endsWith(".ts")) {
      if (entry.name.endsWith(".test.ts")) continue;
      await copy_ts_file(source_path, destination_path, relative_path, options);
      continue;
    }

    if (entry.isFile) {
      await Deno.writeFile(destination_path, await Deno.readFile(source_path));
    }
  }
}

async function copy_ts_file(
  source: URL,
  destination: URL,
  relative_path: string,
  options: {
    readonly transform: boolean;
    readonly stats: TransformStats;
  },
) {
  const source_code = await Deno.readTextFile(source);
  let code = source_code;

  if (options.transform) {
    const result = transform_do_program_source(source_code, relative_path);
    // Use the plugin's explicit preserve policy for unsupported files. Report
    // every fallback, and include its count in the measured benchmark label.
    if (result.diagnostics.length > 0) {
      for (const diagnostic of result.diagnostics) {
        console.warn(
          `Preserved benchmark source ${diagnostic.file_name}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`,
        );
      }
      add_transformed_count(options.stats, relative_path, 0, 1);
    } else {
      code = result.code;
      add_transformed_count(
        options.stats,
        relative_path,
        result.transformed,
        0,
      );
    }
  }

  await Deno.writeTextFile(destination, code);
}

async function remove_directory(path: URL) {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }

    throw error;
  }
}

function bench_name(study: CaseStudyName, modules: ModuleSet): string {
  if (modules.label === "without transformer") {
    return "case study/" + study + " dry run (without transformer)";
  }

  return "case study/" + study + " dry run (with transformer, rewrites=" +
    modules.stats[study].rewrites.toString() + ", preserved files=" +
    modules.stats[study].preserved.toString() + ")";
}

function empty_stats(): TransformStats {
  return {
    http_router: { rewrites: 0, preserved: 0 },
    io_application: { rewrites: 0, preserved: 0 },
    agent_harness: { rewrites: 0, preserved: 0 },
    parallel_analyzer: { rewrites: 0, preserved: 0 },
    programming_language_parser: { rewrites: 0, preserved: 0 },
  };
}

function add_transformed_count(
  stats: TransformStats,
  relative_path: string,
  count: number,
  preserved: number,
) {
  const study = case_study_from_path(relative_path);

  if (study === undefined) {
    return;
  }

  stats[study].rewrites += count;
  stats[study].preserved += preserved;
}

function case_study_from_path(path: string): CaseStudyName | undefined {
  if (path.startsWith("case_studies/http_router/")) {
    return "http_router";
  }

  if (path.startsWith("case_studies/io_application/")) {
    return "io_application";
  }

  if (path.startsWith("case_studies/agent_harness/")) {
    return "agent_harness";
  }

  if (path.startsWith("case_studies/parallel_analyzer/")) {
    return "parallel_analyzer";
  }

  if (path.startsWith("case_studies/programming_language_parser/")) {
    return "programming_language_parser";
  }

  return undefined;
}

const http_requests = [
  { method: "GET", url: "https://example.test/users/42?tab=activity" },
  { method: "GET", url: "https://example.test/api/users/42" },
  {
    method: "GET",
    url: "https://example.test/users/42/settings?section=privacy",
  },
  { method: "GET", url: "https://example.test/users/not-a-number" },
  {
    method: "POST",
    url: "https://example.test/users/42/messages?dry_run=true",
  },
  { method: "GET", url: "https://example.test/admin" },
];

const cli_commands = [
  ["echo", "hello", "typeclasses"],
  ["cat", "notes.txt"],
  ["cat", "missing.txt"],
  ["write", "out.txt", "preview only"],
  ["unknown"],
];

const observed = await observe_case_studies(original);
assert_equals(
  await observe_case_studies(original),
  observed,
  "original case studies changed on repeated execution",
);
assert_equals(
  await observe_case_studies(transformed),
  observed,
  "transformed case studies differ in values, failures, or logs and writes",
);
assert_equals(
  await observe_case_studies(transformed),
  observed,
  "transformed case studies changed on repeated execution",
);

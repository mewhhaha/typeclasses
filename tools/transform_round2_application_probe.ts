// Reuse the pinned end-to-end application fixture without maintaining a second
// workload. Each invocation measures one pass configuration in its own process.
// deno run -A this.ts generator (or terminal, terminal_body, interpreter, iterable_map)
const root = new URL("../", import.meta.url);
const source = await Deno.readTextFile(
  new URL("bench/case_studies_transformer.bench.ts", root),
);
const anchor = "transform_do_program_source(source_code, relative_path)";
if (!source.includes(anchor)) {
  throw new Error("application benchmark transform anchor changed");
}
const disabled = Deno.args[0];
const config: { optimizations?: Record<string, boolean> } = {};
if (disabled !== undefined && disabled !== "all" && disabled !== "clone") {
  config.optimizations = { [disabled]: false };
}
const temporary = await Deno.makeTempDir({
  dir: "/var/tmp",
  prefix: "typeclasses-transform-ablation-",
});
try {
  let rewritten = source.replaceAll('"../', '"' + root.href)
    .replace(
      'const source_root = new URL("../", import.meta.url);',
      "const source_root = new URL(" + JSON.stringify(root.href) + ");",
    )
    .replace(
      'const source_root = new URL("' + root.href + '", import.meta.url);',
      "const source_root = new URL(" + JSON.stringify(root.href) + ");",
    )
    .replace(
      anchor,
      `transform_do_program_source(source_code, relative_path, ${
        JSON.stringify(config)
      })`,
    );
  if (disabled === "clone") {
    rewritten = rewritten.replace("transform: true,", "transform: false,");
  }
  if (Deno.args.includes("--reverse")) {
    rewritten = rewritten.replace(
      "register_case_study_benchmarks(original);\nregister_case_study_benchmarks(transformed);",
      "register_case_study_benchmarks(transformed);\nregister_case_study_benchmarks(original);",
    );
  }
  const path = temporary + "/parallel.bench.ts";
  await Deno.writeTextFile(path, rewritten);
  const profiling_flags: string[] = [];
  if (Deno.args.includes("--profile")) {
    profiling_flags.push(
      "--v8-flags=--prof,--logfile=/var/tmp/typeclasses-round2-parallel-v8.log,--no-logfile-per-isolate",
    );
  }
  const result = await new Deno.Command(Deno.execPath(), {
    args: [
      "bench",
      ...profiling_flags,
      "--allow-env",
      "--allow-read",
      "--allow-write",
      "--config",
      new URL("deno.json", root).pathname,
      "--json",
      "--filter",
      "parallel_analyzer",
      path,
    ],
    env: { TMPDIR: "/var/tmp" },
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) Deno.exit(result.code);
} finally {
  await Deno.remove(temporary, { recursive: true });
}

import { type Node, parseSync, visitorKeys } from "oxc-parser";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type PairedBlock, summarize_pairs } from "../tools/paired_bench.ts";
import type { TransformResult } from "../tools/transform_context.ts";
import { source_transform_cases } from "./source_transform_cases.ts";

type Transformer = typeof import("../tools/transform_do_program.ts");
type Workload = {
  name: string;
  source: string;
  file: string;
  iterations: number;
  transformed: boolean;
  expected?: number;
};
const [baseline_arg, candidate_arg, destination_arg] = Deno.args;
if (!baseline_arg || !candidate_arg || !destination_arg) {
  throw new Error(
    "Usage: oxc_migration.ts BASELINE CANDIDATE OUTPUT.json [--preflight-only]",
  );
}
const baseline = resolve(baseline_arg);
const candidate = resolve(candidate_arg);
const destination = resolve(destination_arg);
if (baseline === candidate) {
  throw new Error("Use separate frozen source snapshots.");
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let sink: unknown;
const lock_path = "/tmp/typeclasses-round3-bench.lock";
using lock = await Deno.open(lock_path, {
  create: true,
  read: true,
  write: true,
});
await lock.lock(true);
try {
  await run();
} finally {
  await lock.unlock();
}

async function hash(value: string | Uint8Array): Promise<string> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof value === "string") bytes = encoder.encode(value);
  else bytes = new Uint8Array(value);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function fingerprints(root: string): Promise<Record<string, string>> {
  const files = ["deno.json", "deno.lock"];
  async function collect(directory: string): Promise<void> {
    for await (const entry of Deno.readDir(resolve(root, directory))) {
      const relative = directory + "/" + entry.name;
      if (entry.isDirectory) await collect(relative);
      else if (entry.isFile && entry.name.endsWith(".ts")) files.push(relative);
    }
  }
  await collect("src");
  await collect("tools");
  const result: Record<string, string> = {};
  for (const file of files.sort()) {
    result[file] = await hash(await Deno.readFile(resolve(root, file)));
  }
  return result;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function parse(source: string, file: string) {
  let lang: "ts" | "tsx" = "ts";
  if (file.endsWith(".tsx")) lang = "tsx";
  const result = parseSync(file, source, { lang });
  assert(
    result.errors.length === 0,
    file + ": " + result.errors.map((error) => error.message).join("; "),
  );
  return result.program;
}
function calls(source: string, file: string): Record<string, number> {
  const result: Record<string, number> = {};
  function visit(value: Node): void {
    if (value.type === "CallExpression") {
      const target = value.callee;
      let name: string | undefined;
      if (target.type === "Identifier") name = target.name;
      if (
        target.type === "MemberExpression" && !target.computed &&
        target.property.type === "Identifier"
      ) name = "." + target.property.name;
      if (name) result[name] = (result[name] ?? 0) + 1;
    }
    const record = value as unknown as Record<string, unknown>;
    for (const key of visitorKeys[value.type] ?? []) {
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) {
            visit(item as Node);
          }
        }
      } else if (child && typeof child === "object" && "type" in child) {
        visit(child as Node);
      }
    }
  }
  visit(parse(source, file));
  return result;
}
function describe(result: TransformResult, workload: Workload) {
  return {
    transformed: result.transformed,
    diagnostics: result.diagnostics,
    output_bytes: encoder.encode(result.code).byteLength,
    map_bytes: encoder.encode(JSON.stringify(result.map)).byteLength,
    output_calls: calls(result.code, workload.file),
  };
}
function workloads(): Workload[] {
  const functions = Array.from(
    { length: 5000 },
    (_, index) =>
      `export function f${index}(n: number) { return Math.sqrt(n + ${index}); }`,
  ).join("\n");
  const independent = Array.from(
    { length: 1000 },
    (_, index) => `const n${index} = yield* Just(${index});`,
  ).join("\n");
  const source = source_transform_cases;
  return [
    {
      name: "no target / 5000 unique functions",
      source: functions,
      file: "untargeted.ts",
      iterations: 100,
      transformed: false,
    },
    {
      name: "unused Do / 5000 unique functions",
      source: `import { Do } from "../src/typeclasses.ts";\n` + functions,
      file: "unused.ts",
      iterations: 2,
      transformed: false,
    },
    {
      name: "100 yields",
      source: source["100 yields"] + "\nexport default p.value()[1];",
      file: "yield100.ts",
      iterations: 5,
      transformed: true,
      expected: 99,
    },
    {
      name: "1000 independent yields / Maybe",
      source:
        `import { Do } from "../src/typeclasses.ts"; import { Maybe, Just } from "../src/maybe.ts"; const p = Do(Maybe, function* () { ${independent} return n999; }); export default p.value()[1];`,
      file: "yield1000.ts",
      iterations: 2,
      transformed: true,
      expected: 999,
    },
    {
      name: "named terminal",
      source: source["named terminal"] + "\nexport default a + b;",
      file: "terminal.ts",
      iterations: 20,
      transformed: true,
      expected: 5,
    },
    {
      name: "named iterable",
      source: source["named iterable"] +
        "\nexport default [...p.value()()].reduce((sum, n) => sum + Number(n), 0);",
      file: "iterable.ts",
      iterations: 20,
      transformed: true,
      expected: 18,
    },
    {
      name: "counted loop / 1000 iterations",
      source: source["counted loop"].replace("100000", "1000") +
        "\nexport default p.value()[1];",
      file: "loop.ts",
      iterations: 20,
      transformed: true,
      expected: 42,
    },
    {
      name: "TSX",
      source:
        `import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; const p = Do(function* () { const n = yield* Just(41); return n + 1; }); export const view = <span title="value">{p.value()}</span>;`,
      file: "view.tsx",
      iterations: 20,
      transformed: true,
    },
    {
      name: "Unicode comments",
      source:
        `// 🪿 Ångström: café and 日本語\nimport { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; const café = Do(function* () { const n = yield* Just(46); return n + 1; }); export default café.value()[1];`,
      file: "unicode.ts",
      iterations: 20,
      transformed: true,
      expected: 47,
    },
  ];
}
function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length / 2;
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle) - 1]) / 2;
}
function paired(a: () => unknown, b: () => unknown, iterations: number) {
  const observe = (operation: () => unknown): number => {
    const started = performance.now();
    for (let index = 0; index < iterations; index += 1) sink = operation();
    return (performance.now() - started) / iterations;
  };
  for (let index = 0; index < 3; index += 1) {
    observe(a);
    observe(b);
  }
  const blocks: PairedBlock[] = [];
  for (let index = 0; index < 8; index += 1) {
    blocks.push([observe(a), observe(b), observe(b), observe(a)]);
  }
  return {
    iterations,
    sample_blocks: blocks,
    a_median_ms: median(blocks.flatMap((block) => [block[0], block[3]])),
    b_median_ms: median(blocks.flatMap((block) => [block[1], block[2]])),
    ...summarize_pairs(blocks),
  };
}
async function fresh_import(root: string) {
  const target =
    pathToFileURL(resolve(root, "tools/transform_do_program.ts")).href;
  const script =
    `const start = performance.now(); const module = await import(${
      JSON.stringify(target)
    }); if (typeof module.transform_do_program_source !== "function") throw new Error("Missing transformer"); console.log(JSON.stringify({ import_ms: performance.now() - start }));`;
  const started = performance.now();
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      "--allow-env",
      "--allow-read",
      "--allow-ffi",
      "--cached-only",
      "--frozen-lockfile",
      "--config",
      resolve(root, "deno.json"),
      script,
    ],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const wall_ms = performance.now() - started;
  const stderr = decoder.decode(output.stderr);
  assert(output.success, "Fresh import failed: " + stderr);
  const metric = JSON.parse(decoder.decode(output.stdout)) as {
    import_ms: number;
  };
  assert(
    Number.isFinite(metric.import_ms) && metric.import_ms > 0,
    "Invalid fresh-import metric",
  );
  return { ...metric, wall_ms, stderr };
}
async function cold_imports() {
  // Populate filesystem/module caches before measuring fresh processes.
  await fresh_import(baseline);
  await fresh_import(candidate);
  const observations: {
    variant: "A" | "B";
    import_ms: number;
    wall_ms: number;
    stderr: string;
  }[] = [];
  const blocks: PairedBlock[] = [];
  const wall_blocks: PairedBlock[] = [];
  for (let index = 0; index < 4; index += 1) {
    const block: number[] = [];
    const walls: number[] = [];
    for (const variant of ["A", "B", "B", "A"] as const) {
      let root = baseline;
      if (variant === "B") root = candidate;
      const observation = await fresh_import(root);
      observations.push({ variant, ...observation });
      block.push(observation.import_ms);
      walls.push(observation.wall_ms);
    }
    blocks.push([block[0], block[1], block[2], block[3]]);
    wall_blocks.push([walls[0], walls[1], walls[2], walls[3]]);
  }
  const summary = (raw: PairedBlock[]) => ({
    sample_blocks: raw,
    a_median_ms: median(raw.flatMap((block) => [block[0], block[3]])),
    b_median_ms: median(raw.flatMap((block) => [block[1], block[2]])),
    ...summarize_pairs(raw),
  });
  return {
    observations,
    dynamic_import: summary(blocks),
    whole_process: summary(wall_blocks),
  };
}
async function run(): Promise<void> {
  const started = new Date().toISOString();
  const before = {
    baseline: await fingerprints(baseline),
    candidate: await fingerprints(candidate),
  };
  const driver_sha256 = await hash(
    await Deno.readFile(new URL(import.meta.url)),
  );
  const module_at = (root: string, name: string) =>
    import(pathToFileURL(resolve(root, name)).href);
  const old: Transformer = await module_at(
    baseline,
    "tools/transform_do_program.ts",
  );
  const current: Transformer = await module_at(
    candidate,
    "tools/transform_do_program.ts",
  );
  const execute: typeof import("../tools/transform_execute.ts") =
    await module_at(candidate, "tools/transform_execute.ts");
  const inputs = workloads();
  const preflight: Record<string, unknown> = {};
  async function evaluate(source: string, file: string): Promise<unknown> {
    const absolute = source.replaceAll(
      /\.\.\/src\/([a-z_]+)\.ts/g,
      (_match, name: string) =>
        pathToFileURL(resolve(candidate, "src", name + ".ts")).href,
    );
    const code = execute.executable_typescript(absolute, file);
    return (await import(
      "data:application/javascript," + encodeURIComponent(code)
    )).default;
  }
  for (const workload of inputs) {
    parse(workload.source, workload.file);
    const a = old.transform_do_program_source(workload.source, workload.file);
    const b = current.transform_do_program_source(
      workload.source,
      workload.file,
    );
    assert(
      a.diagnostics.length === 0 && b.diagnostics.length === 0,
      workload.name + ": unexpected diagnostics " +
        JSON.stringify({ a: a.diagnostics, b: b.diagnostics }),
    );
    assert(
      a.transformed === b.transformed,
      workload.name + ": transformation counts differ",
    );
    if (workload.transformed) {
      assert(
        a.transformed > 0 && a.map !== null && b.map !== null,
        workload.name + ": missing mapped transformation",
      );
    } else {assert(
        a.transformed === 0 && b.transformed === 0,
        workload.name + ": unexpected rewrite",
      );}
    const decisions = {
      baseline:
        old.transform_do_program_source(workload.source, workload.file, {
          explain: true,
        }).reports,
      candidate:
        current.transform_do_program_source(workload.source, workload.file, {
          explain: true,
        }).reports,
    };
    const outcomes: unknown[] = [];
    if (workload.expected !== undefined) {
      for (const source of [workload.source, a.code, b.code]) {
        outcomes.push(await evaluate(source, workload.file));
      }
      assert(
        outcomes.every((value) => value === workload.expected),
        workload.name + ": execution mismatch " + JSON.stringify(outcomes),
      );
    }
    if (workload.name === "Unicode comments") {
      assert(
        a.code.includes("🪿 Ångström") && b.code.includes("🪿 Ångström"),
        "Unicode comment was lost",
      );
    }
    preflight[workload.name] = {
      source_bytes: encoder.encode(workload.source).byteLength,
      source_sha256: await hash(workload.source),
      source_calls: calls(workload.source, workload.file),
      baseline: describe(a, workload),
      candidate: describe(b, workload),
      expected: workload.expected,
      execution: outcomes,
      decisions,
    };
  }
  const unsupported =
    `import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; const p = Do(function* () { try { yield* Just(1); } finally {} });`;
  const barriers = [old, current].map((api) =>
    api.transform_do_program_source(unsupported, "unsupported.ts")
  );
  assert(
    barriers.every((value) =>
      value.transformed === 0 && value.code === unsupported &&
      value.diagnostics.length > 0
    ),
    "Unsupported generator must stay intact with diagnostics",
  );
  const malformed =
    `import { Do } from "../src/typeclasses.ts"; const p = Do(function* () { const x = ; });`;
  const malformed_result = current.transform_do_program_source(
    malformed,
    "malformed.ts",
  );
  assert(
    malformed_result.transformed === 0 && malformed_result.code === malformed &&
      malformed_result.diagnostics.some((diagnostic) =>
        diagnostic.message.startsWith("Parse error:")
      ),
    "Native parser must preserve malformed input with a parse diagnostic",
  );
  preflight["untimed diagnostic controls"] = {
    unsupported_sha256: await hash(unsupported),
    unsupported: barriers.map((value) => value.diagnostics),
    malformed_sha256: await hash(malformed),
    malformed: malformed_result.diagnostics,
  };
  const warm = inputs.find((workload) => workload.name === "100 yields")!;
  const no_maps = current.transform_do_program_source(warm.source, warm.file, {
    source_map: false,
  });
  assert(
    no_maps.map === null && no_maps.diagnostics.length === 0 &&
      no_maps.transformed > 0,
    "Map opt-out preflight failed",
  );
  parse(no_maps.code, warm.file);
  assert(
    await evaluate(no_maps.code, warm.file) === warm.expected,
    "Map opt-out execution mismatch",
  );
  const cache = current.create_transform_cache();
  cache.transform(warm.source, warm.file);
  const hit = cache.transform(warm.source, warm.file);
  assert(cache.stats().hits === 1, "Cache-hit preflight failed");
  assert(
    await evaluate(hit.code, warm.file) === warm.expected,
    "Cache-hit execution mismatch",
  );
  preflight["candidate controls"] = {
    maps_optout: describe(no_maps, warm),
    cache_hit: describe(hit, warm),
  };
  if (Deno.args[3] === "--preflight-only") {
    await Deno.writeTextFile(
      destination,
      JSON.stringify(
        { driver_sha256, baseline, candidate, preflight },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        destination,
        preflight: "passed",
        workloads: inputs.length,
      }),
    );
    return;
  }
  const results: Record<string, unknown> = {};
  for (const workload of inputs) {
    const row = paired(
      () => old.transform_do_program_source(workload.source, workload.file),
      () => current.transform_do_program_source(workload.source, workload.file),
      workload.iterations,
    );
    results[workload.name] = {
      a: "TypeScript Compiler API baseline / default maps",
      b: "Oxc candidate / default maps",
      ...row,
    };
    console.log(
      JSON.stringify({
        workload: workload.name,
        speedup: row.speedup,
        confidence_95: row.confidence_95,
      }),
    );
  }
  results["candidate only / maps opt-out / 100 yields"] = {
    a: "Oxc candidate / default maps",
    b: "Oxc candidate / source_map:false",
    ...paired(
      () => current.transform_do_program_source(warm.source, warm.file),
      () =>
        current.transform_do_program_source(warm.source, warm.file, {
          source_map: false,
        }),
      5,
    ),
  };
  results["candidate only / cache hit / 100 yields"] = {
    a: "Oxc candidate / uncached default maps",
    b: "Oxc candidate / warm cache hit",
    ...paired(
      () => current.transform_do_program_source(warm.source, warm.file),
      () => cache.transform(warm.source, warm.file),
      10,
    ),
    cache_stats: cache.stats(),
  };
  const cold = await cold_imports();
  const after = {
    baseline: await fingerprints(baseline),
    candidate: await fingerprints(candidate),
  };
  const changed_inputs: string[] = [];
  for (const variant of ["baseline", "candidate"] as const) {
    for (
      const name of new Set([
        ...Object.keys(before[variant]),
        ...Object.keys(after[variant]),
      ])
    ) {
      if (before[variant][name] !== after[variant][name]) {
        changed_inputs.push(variant + "/" + name);
      }
    }
  }
  const configurations = {
    baseline:
      JSON.parse(await Deno.readTextFile(resolve(baseline, "deno.json")))
        .imports,
    candidate:
      JSON.parse(await Deno.readTextFile(resolve(candidate, "deno.json")))
        .imports,
  };
  let cpu = "unavailable";
  try {
    cpu = (await Deno.readTextFile("/proc/cpuinfo")).match(
      /^model name\s*:\s*(.*)$/m,
    )?.[1] ?? cpu;
  } catch { /* Non-Linux host. */ }
  const report = {
    started,
    completed: new Date().toISOString(),
    runtime: Deno.version,
    build: Deno.build,
    cpu,
    hardware_concurrency: navigator.hardwareConcurrency,
    baseline,
    candidate,
    lock_path,
    driver_sha256,
    workload_catalog_sha256: await hash(
      await Deno.readFile(
        new URL("./source_transform_cases.ts", import.meta.url),
      ),
    ),
    configurations,
    source_hashes: before,
    changed_inputs,
    preflight,
    results,
    cold_import: cold,
    method: {
      full_transform_blocks: 8,
      cold_import_blocks: 4,
      order: "ABBA",
      warmup_batches: 3,
      confidence:
        "95% deterministic percentile bootstrap resampling whole ABBA blocks",
      per_observation:
        "serial arithmetic mean milliseconds per transform; raw blocks retained",
      cold_import:
        "fresh Deno eval processes; one untimed import per variant; cached-only and frozen lockfiles; filesystem/package/module caches warm; dynamic-import timing and process wall time separate",
      execution_control:
        "same candidate runtime and Oxc TypeScript erasure for original/baseline-generated/candidate-generated numeric defaults; counted loop bound 1000",
    },
    limitations:
      "One host, serial in-process warmed transforms: shared JIT, GC, thermal state and system noise remain. Whole-block bootstrap describes these observations; it does not remove systematic bias. Fresh import is process-cold with warm filesystem caches. Workloads cover specific source shapes, not a universal speedup. TypeScript erasure executes fixtures without type checking.",
  };
  await Deno.writeTextFile(destination, JSON.stringify(report, null, 2) + "\n");
  assert(
    changed_inputs.length === 0,
    "Snapshots changed during measurement: " + changed_inputs.join(", "),
  );
  console.log(
    JSON.stringify({
      destination,
      changed_inputs,
      cold_import: cold.dynamic_import,
    }),
  );
  void sink;
}

import {
  transform_do_program_source,
  type TransformConfig,
} from "./transform_do_program.ts";

// Counterfactual source evidence for the parallel application's timed path.
const root = new URL("../", import.meta.url);
const modes = [
  "all",
  "generator",
  "terminal",
  "terminal_body",
  "interpreter",
  "iterable_map",
] as const;
const hash = async (source: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const files = [];
for (const directory of ["parallel_analyzer", "programming_language_parser"]) {
  for await (
    const entry of Deno.readDir(new URL(`case_studies/${directory}/`, root))
  ) {
    if (
      !entry.isFile || !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".test.ts")
    ) continue;
    const file = `case_studies/${directory}/${entry.name}`;
    const source = await Deno.readTextFile(new URL(file, root));
    const input_sha256 = await hash(source);
    const outputs = [];
    for (const mode of modes) {
      const config: TransformConfig = { explain: true };
      let result = transform_do_program_source(source, file, config);
      if (mode !== "all") {
        result = transform_do_program_source(source, file, {
          ...config,
          optimizations: { [mode]: false },
        });
      }
      let effective = result.code;
      if (result.diagnostics.length > 0) effective = source;
      outputs.push({
        mode,
        sha256: await hash(effective),
        same_input: effective === source,
        transformed: result.transformed,
        preserved: result.diagnostics.length > 0,
        reports: result.reports.filter((report) =>
          report.outcome === "transformed"
        ),
      });
    }
    files.push({ file, input_sha256, outputs });
  }
}
console.log(JSON.stringify(files, null, 2));

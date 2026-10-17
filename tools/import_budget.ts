import * as esbuild from "esbuild";
import { resolve } from "node:path";

const root = resolve(Deno.args[0] ?? ".");
const cases = {
  root_namespace:
    `import * as library from "${root}/src/mod.ts"; console.log(Object.keys(library));`,
  root_just: `import { Just } from "${root}/src/mod.ts"; console.log(Just(1));`,
  maybe_just:
    `import { Just } from "${root}/src/maybe.ts"; console.log(Just(1));`,
};
const bundles: Record<string, unknown> = {};
const input_files = new Set<string>();
for (const [name, contents] of Object.entries(cases)) {
  const result = await esbuild.build({
    stdin: { contents, loader: "ts", resolveDir: root },
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "neutral",
    metafile: true,
  });
  const bytes = result.outputFiles[0].contents;
  const compressed = await new Response(
    new Blob([new Uint8Array(bytes)]).stream().pipeThrough(
      new CompressionStream("gzip"),
    ),
  ).arrayBuffer();
  bundles[name] = {
    bytes: bytes.length,
    gzip_bytes: compressed.byteLength,
    input_modules: Object.keys(result.metafile.inputs).length,
  };
  for (const filename of Object.keys(result.metafile.inputs)) {
    if (filename !== "<stdin>") input_files.add(resolve(filename));
  }
}
esbuild.stop();
const imports: Record<string, number[]> = {};
for (const name of ["mod", "maybe"]) {
  imports[name] = [];
  for (let repeat = 0; repeat < 5; repeat++) {
    const result = await new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `const start = performance.now(); await import(${
          JSON.stringify(root + "/src/" + name + ".ts")
        }); console.log(performance.now() - start);`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    imports[name].push(Number(new TextDecoder().decode(result.stdout)));
  }
}
const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
const sources: Record<string, string> = {};
for (const filename of [...input_files].sort()) {
  sources[filename.replace(root, "$ROOT")] = await digest(
    await Deno.readTextFile(filename),
  );
}
console.log(
  JSON.stringify(
    {
      esbuild: esbuild.version,
      workload_sha256: await digest(
        JSON.stringify(cases).replaceAll(root, "$ROOT"),
      ),
      source_sha256: await digest(JSON.stringify(sources)),
      driver_sha256: await digest(
        await Deno.readTextFile(new URL(import.meta.url)),
      ),
      sources,
      runtime: Deno.version,
      bundles,
      fresh_process_import_ms: imports,
    },
    null,
    2,
  ),
);

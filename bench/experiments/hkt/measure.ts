import ts from "typescript";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const output = Deno.args[0];
const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
};
// Every context sees the same chain length, callback types, raw shape assertions,
// and expected failures. No large unions or artificial depth stressors.
const workloads = 128;
const body = `
function expect<expected>(_value: expected): void {}
const custom = box(1);
const fixed_error = result<string, number>(["Right", 1]);
const fixed_environment = reader((environment: { readonly base: number }) => environment.base);
expect<Box<string>>(map(custom, item => item.toString()));
expect<Result<string, string>>(map(fixed_error, item => item.toString()));
expect<Reader<{ readonly base: number }, string>>(map(fixed_environment, item => item.toString()));
expect<{ readonly item: number }>(custom.value());
expect<readonly ["Left", string] | readonly ["Right", number]>(fixed_error.value());
expect<(environment: { readonly base: number }) => number>(fixed_environment.value());
// @ts-expect-error fixed error survives generic map
expect<Result<number, number>>(map(fixed_error, item => item + 1));
// @ts-expect-error fixed environment survives generic map
expect<Reader<{ readonly label: string }, number>>(map(fixed_environment, item => item + 1));
// @ts-expect-error third-party Box and Result contexts cannot mix
combine(custom, fixed_error);
combine(custom, box(2));
${
  Array.from({ length: workloads }, (_, index) => `
const box_${index} = map(custom.map(item => item + ${index}), item => item.toString()).map(item => item.length);
const result_${index} = map(fixed_error.map(item => item + ${index}), item => item.toString()).map(item => item.length);
const reader_${index} = map(fixed_environment.map(item => item + ${index}), item => item.toString()).map(item => item.length);
expect<Box<number>>(box_${index});
expect<Result<string, number>>(result_${index});
expect<Reader<{ readonly base: number }, number>>(reader_${index});
`).join("\n")
}
`;
const digest = async (value: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const samples: object[] = [];
for (
  const model of ["current", "lambda", "lambda", "current", "current", "lambda"]
) {
  const filename = resolve(directory, "__" + model + "_workload.ts");
  const source =
    `import { box, result, reader, map, combine, type Box, type Result, type Reader } from "./${model}_contexts.ts";\n` +
    body;
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.readFile = (file) => {
    if (file === filename) return source;
    return read(file);
  };
  host.fileExists = (file) => file === filename || exists(file);
  const started = performance.now();
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const check_ms = performance.now() - started;
  if (diagnostics.length > 0) {
    console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => directory,
      getNewLine: () => "\n",
    }));
    Deno.exit(1);
  }
  const stats = program as ts.Program & {
    getTypeCount(): number;
    getInstantiationCount(): number;
  };
  const sources = program.getSourceFiles().filter((file) =>
    !program.isSourceFileDefaultLibrary(file)
  );
  samples.push({
    model,
    check_ms,
    types: stats.getTypeCount(),
    instantiations: stats.getInstantiationCount(),
    source_files: sources.length,
    source_sha256: await digest(
      sources.map((file) =>
        file.fileName.slice(directory.length) + "\n" + file.text
      ).sort().join("\n"),
    ),
  });
}
const report = {
  compiler: ts.version,
  runtime: Deno.version,
  workloads_per_context: workloads,
  map_calls: workloads * 3 * 3,
  workload_sha256: await digest(body),
  order: "A B B A A B",
  samples,
  scope:
    "Functor-only third-party contexts; declarations only. Lambda omits runtime dictionaries, tagged matching, Do, broad dictionary members and callable construction implementation. Timing includes program creation and full diagnostics; source imports differ and this is not an isolated encoding-only cost claim.",
};
const json = JSON.stringify(report, null, 2) + "\n";
if (output !== undefined) await Deno.writeTextFile(output, json);
console.log(json);

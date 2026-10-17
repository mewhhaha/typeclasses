import ts from "typescript";
import { resolve } from "node:path";

const root = resolve(Deno.args[0] ?? ".");
const source = `
import { Just, Maybe, Right, Either, Identity, Functor, Do, Program, Effect, type Data, type AsMaybe } from "${root}/src/mod.ts";
import { ArrayT } from "${root}/src/array.ts";
import { traverse } from "${root}/src/prelude.ts";
const optional = Just(1);
const mapped = optional.map(value => value.toString()).bind(value => Just(value.length));
const generic = Functor.map(optional, value => value + 1);
const result = Right(1).bind(value => Right(value + 1));
const items = traverse(value => Just(value + 1), Maybe, ArrayT([1,2,3]));
const block = Do(Maybe, function* () { return (yield* optional) + (yield* mapped); });
const program = Program(function* () { return yield* Effect.pure(1); });
const typed: Data<AsMaybe, number> = mapped;
void [generic,result,items,block,program,typed,Either,Identity];
`;
const filename = resolve(root, "__type_budget__.ts");
const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  skipLibCheck: true,
};
const host = ts.createCompilerHost(options);
const read = host.readFile.bind(host);
host.readFile = (file) => {
  if (file === filename) return source;
  return read(file);
};
const exists = host.fileExists.bind(host);
host.fileExists = (file) => file === filename || exists(file);
const started = performance.now();
const program = ts.createProgram([filename], options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length > 0) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  }));
  Deno.exit(1);
}
const check_ms = performance.now() - started;
const stats = program as ts.Program & {
  getTypeCount(): number;
  getInstantiationCount(): number;
};
const service = ts.createLanguageService({
  getCompilationSettings: () => options,
  getScriptFileNames: () => [filename],
  getScriptVersion: () => "1",
  getScriptSnapshot(file) {
    const content = host.readFile(file);
    if (content === undefined) return undefined;
    return ts.ScriptSnapshot.fromString(content);
  },
  getCurrentDirectory: () => root,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: host.fileExists,
  readFile: host.readFile,
  readDirectory: ts.sys.readDirectory,
});
const completions_at = source.indexOf("optional.map") + "optional.".length;
const hover_at = source.indexOf("const mapped") + "const ".length;
const warm_started = performance.now();
service.getQuickInfoAtPosition(filename, hover_at);
const editor_initial_ms = performance.now() - warm_started;
const latencies: number[] = [];
let entries = 0;
for (let index = 0; index < 20; index++) {
  const before = performance.now();
  entries =
    service.getCompletionsAtPosition(filename, completions_at, {})?.entries
      .length ?? 0;
  latencies.push(performance.now() - before);
}
latencies.sort((a, b) => a - b);
const hover = ts.displayPartsToString(
  service.getQuickInfoAtPosition(filename, hover_at)?.displayParts,
);
const digest = async (text: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const files = program.getSourceFiles().filter((file) =>
  file.fileName.startsWith(root + "/src/")
);
const report = {
  compiler: ts.version,
  runtime: Deno.version,
  workload_sha256: await digest(source.replaceAll(root, "$ROOT")),
  source_sha256: await digest(
    files.map((file) => file.fileName.slice(root.length) + "\n" + file.text)
      .sort().join("\n"),
  ),
  check_ms,
  types: stats.getTypeCount(),
  instantiations: stats.getInstantiationCount(),
  memory: Deno.memoryUsage(),
  editor_initial_ms,
  completion_p50_ms: latencies[10],
  completion_p95_ms: latencies[18],
  completion_entries: entries,
  hover_characters: hover.length,
  hover,
};
console.log(JSON.stringify(report, null, 2));
service.dispose();

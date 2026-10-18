import ts from "typescript";
import { resolve } from "node:path";

const root = resolve(Deno.args[0] ?? ".");
const source = `import { Just, Maybe } from "${root}/src/maybe.ts";
import { Right } from "${root}/src/either.ts";
import { collect } from "${root}/src/typeclasses/applicative.ts";
import { Do } from "${root}/src/typeclasses/monad.ts";
const value = Just(1).map(n=>String(n)).bind(s=>Just(s.length));
const output = collect({id: value, name: Just("Ada")});
const explicit = collect(Maybe, {id: value, name: Just("Ada")});
const block = Do(Maybe, function*(){return (yield* value)+1});
const result = Right(1).bind(n=>Right(String(n)));
void [output, explicit, block, result];`;
const filename = resolve(root, "__round3_types__.ts");
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
type Counts = ts.Program & {
  getInstantiationCount(): number;
  getTypeCount(): number;
};
const declarations = new Map<string, string>();
const evidence: unknown[] = [];
for (
  const variant of [
    "current",
    "pick-members",
    "drop-item-slots",
    "nondistributive-capabilities",
    "mapped-collect",
    "declaration-facade",
  ]
) {
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.fileExists = (file) => file === filename || exists(file);
  host.readFile = (file) => {
    if (file === filename) return source;
    let text = read(file);
    if (text === undefined) return undefined;
    if (variant === "declaration-facade" && declarations.has(file)) {
      return declarations.get(file);
    }
    if (file.endsWith("/src/data_value.ts")) {
      if (variant === "pick-members") {
        text = text.replace(
          /export type DictionaryMembers<dictionary> = \{[\s\S]*?\n\};/,
          "export type DictionaryMembers<dictionary> = Pick<dictionary, keyof dictionary>;",
        );
      }
      if (variant === "drop-item-slots") {
        text = 'import type { type_item, type_data } from "./typeclass.ts";\n' +
          text.replace(
            /export type DictionaryMembers<dictionary> = \{[\s\S]*?\n\};/,
            "export type DictionaryMembers<dictionary> = Omit<dictionary, typeof type_item | typeof type_data>;",
          );
      }
      if (variant === "nondistributive-capabilities") {
        text = text.replace(
          "dictionary extends Runnable ?",
          "[dictionary] extends [Runnable] ?",
        ).replace(
          "dictionary extends Matchable ?",
          "[dictionary] extends [Matchable] ?",
        );
      }
    }
    if (
      variant === "mapped-collect" &&
      file.endsWith("/src/typeclasses/applicative.ts")
    ) {
      text = text.replace(
        /type CollectedDictionary<values> =[\s\S]*?\n\/\*\* @ignore \*\//,
        `type CollectedDictionary<values> = { [key in keyof values]: values[key] extends { readonly [dictionary_type]?: infer dictionary extends Dictionary } ? dictionary : never }[keyof values];\n/** @ignore */`,
      );
    }
    return text;
  };
  const started = performance.now();
  const program = ts.createProgram([filename], options, host) as Counts;
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const elapsed_ms = performance.now() - started;
  evidence.push({
    variant,
    compiler: ts.version,
    elapsed_ms,
    instantiations: program.getInstantiationCount(),
    types: program.getTypeCount(),
    errors: diagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, "\n")
    ),
  });
  console.log(JSON.stringify(evidence.at(-1)));
  if (variant === "current" && diagnostics.length === 0) {
    const declaration_options = {
      ...options,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
    };
    const emitter = ts.createProgram([filename], declaration_options, host);
    emitter.emit(undefined, (file, text) => {
      if (file.endsWith(".d.ts")) {
        declarations.set(file.slice(0, -5) + ".ts", text);
      }
    });
  }
}
if (Deno.args[1]) {
  await Deno.writeTextFile(
    Deno.args[1],
    JSON.stringify(
      { root, runtime: Deno.version, workload: source, results: evidence },
      null,
      2,
    ) + "\n",
  );
}

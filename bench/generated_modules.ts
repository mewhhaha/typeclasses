import { parseSync } from "oxc-parser";
import { transform_do_program_source } from "../tools/transform_do_program.ts";

/** Prepare actual transformer output before timed benchmark callbacks run. */
export async function load_benchmark_variants<module>(source: URL): Promise<{
  readonly original: module;
  readonly transformed: module;
}> {
  const result = transform_do_program_source(
    await Deno.readTextFile(source),
    source.pathname,
  );
  if (result.diagnostics.length > 0) {
    throw new Error(
      result.diagnostics.map((diagnostic) =>
        `${diagnostic.file_name}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`
      ).join("\n"),
    );
  }
  if (result.transformed === 0) {
    throw new Error(`No benchmark sites transformed in ${source}`);
  }

  const temporary = await Deno.makeTempDir({
    prefix: "typeclasses-transform-bench-",
  });
  try {
    const generated = new URL("file://" + temporary + "/generated.ts");
    await Deno.writeTextFile(generated, absolute_imports(result.code, source));
    return {
      original: await import(source.href) as module,
      transformed: await import(generated.href) as module,
    };
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}

/** Resolve static relative imports before loading a temporary benchmark module. */
export function absolute_imports(code: string, source: URL): string {
  const parsed = parseSync(source.pathname, code).program;
  const replacements: {
    readonly start: number;
    readonly end: number;
    readonly text: string;
  }[] = [];
  for (const statement of parsed.body) {
    if (
      statement.type !== "ImportDeclaration" &&
      statement.type !== "ExportNamedDeclaration" &&
      statement.type !== "ExportAllDeclaration"
    ) continue;
    const specifier = statement.source;
    if (
      specifier == null || !specifier.value.startsWith(".")
    ) continue;
    replacements.push({
      start: specifier.start,
      end: specifier.end,
      text: JSON.stringify(new URL(specifier.value, source).href),
    });
  }
  for (const replacement of replacements.reverse()) {
    code = code.slice(0, replacement.start) + replacement.text +
      code.slice(replacement.end);
  }
  return code;
}

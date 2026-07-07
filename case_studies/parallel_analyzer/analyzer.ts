import {
  type Declaration,
  parse_program,
} from "../programming_language_parser/language.ts";
import type { ParseError } from "../programming_language_parser/parser.ts";
import type {
  AnalyzeResult,
  FileDiagnostic,
  FileSummary,
  SourceFile,
} from "./types.ts";

export function analyze_source(file: SourceFile): AnalyzeResult {
  const [tag, payload] = parse_program(file.source, file.path);

  switch (tag) {
    case "parsed":
      return ["Right", summarize_declarations(file.path, payload.declarations)];
    case "failed":
      return ["Left", parse_diagnostic(file.path, payload)];
  }
}

export function analyze_sources_sequential(
  files: readonly SourceFile[],
): readonly AnalyzeResult[] {
  return files.map(analyze_source);
}

function summarize_declarations(
  path: string,
  declarations: readonly Declaration[],
): FileSummary {
  let imports = 0;
  let types = 0;
  let functions = 0;
  let lets = 0;

  for (const declaration of declarations) {
    switch (declaration.kind) {
      case "import_declaration":
        imports += 1;
        break;
      case "type_declaration":
        types += 1;
        break;
      case "function_declaration":
        functions += 1;
        break;
      case "let_declaration":
        lets += 1;
        break;
    }
  }

  return {
    path,
    declarations: declarations.length,
    imports,
    types,
    functions,
    lets,
  };
}

function parse_diagnostic(path: string, error: ParseError): FileDiagnostic {
  let message = error.message;

  if (message === undefined) {
    message = "expected " + error.expected.join(", ");
  }

  return {
    path,
    line: error.position.line,
    column: error.position.column,
    expected: error.expected,
    message,
  };
}

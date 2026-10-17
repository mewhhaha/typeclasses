import type { RawEither } from "../../src/either.ts";

export type SourceFile = {
  readonly path: string;
  readonly source: string;
};

export type FileSummary = {
  readonly path: string;
  readonly declarations: number;
  readonly imports: number;
  readonly types: number;
  readonly functions: number;
  readonly lets: number;
};

export type FileDiagnostic = {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly expected: readonly string[];
  readonly message: string;
};

export type AnalyzeResult = RawEither<FileDiagnostic, FileSummary>;

export type AnalyzerReport = {
  readonly files: number;
  readonly parsed: number;
  readonly failed: number;
  readonly declarations: number;
  readonly imports: number;
  readonly types: number;
  readonly functions: number;
  readonly lets: number;
  readonly diagnostics: readonly FileDiagnostic[];
};

export type AnalyzerRun = {
  readonly report: AnalyzerReport;
  readonly logs: readonly string[];
  readonly elapsed_ms: number;
};

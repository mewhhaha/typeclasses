import { from_array } from "../../src/array.ts";
import {
  type As,
  type Data,
  data,
  type type_data,
  type type_item,
} from "../../src/typeclass.ts";
import { Foldable, Monoid, Semigroup, Show } from "../../src/typeclasses.ts";
import type {
  AnalyzeResult,
  AnalyzerReport,
  FileDiagnostic,
  FileSummary,
} from "./types.ts";

export interface AsReport
  extends As<AsReport>, Show<AsReport>, Semigroup<AsReport>, Monoid<AsReport> {
  readonly [type_item]: unknown;
  readonly [type_data]: AnalyzerReport;
}

export type ReportValue = Data<AsReport, AnalyzerReport>;

export const Report = data<AsReport>();

export function empty_report(): AnalyzerReport {
  return {
    files: 0,
    parsed: 0,
    failed: 0,
    declarations: 0,
    imports: 0,
    types: 0,
    functions: 0,
    lets: 0,
    diagnostics: [],
  };
}

export function report_from_summary(summary: FileSummary): AnalyzerReport {
  return {
    files: 1,
    parsed: 1,
    failed: 0,
    declarations: summary.declarations,
    imports: summary.imports,
    types: summary.types,
    functions: summary.functions,
    lets: summary.lets,
    diagnostics: [],
  };
}

export function report_from_diagnostic(
  diagnostic: FileDiagnostic,
): AnalyzerReport {
  return {
    files: 1,
    parsed: 0,
    failed: 1,
    declarations: 0,
    imports: 0,
    types: 0,
    functions: 0,
    lets: 0,
    diagnostics: [diagnostic],
  };
}

export function report_from_result(result: AnalyzeResult): AnalyzerReport {
  const [tag, payload] = result;

  switch (tag) {
    case "Right":
      return report_from_summary(payload);
    case "Left":
      return report_from_diagnostic(payload);
  }
}

export function concat_reports(
  left: AnalyzerReport,
  right: AnalyzerReport,
): AnalyzerReport {
  return {
    files: left.files + right.files,
    parsed: left.parsed + right.parsed,
    failed: left.failed + right.failed,
    declarations: left.declarations + right.declarations,
    imports: left.imports + right.imports,
    types: left.types + right.types,
    functions: left.functions + right.functions,
    lets: left.lets + right.lets,
    diagnostics: concat_diagnostics(left.diagnostics, right.diagnostics),
  };
}

export function summarize_results(
  results: readonly AnalyzeResult[],
): AnalyzerReport {
  return Foldable.fold(
    from_array(results),
    empty_report_value(),
    (report, result) => concat_report_value(report, report_from_result(result)),
  ).value();
}

export function summarize_reports(
  reports: readonly AnalyzerReport[],
): AnalyzerReport {
  return Foldable.fold(
    from_array(reports),
    empty_report_value(),
    concat_report_value,
  ).value();
}

export function empty_report_value(): ReportValue {
  return Monoid.empty(Report(empty_report()));
}

export function concat_report_value(
  left: ReportValue,
  right: AnalyzerReport,
): ReportValue {
  return Monoid.concat(left, Report(right));
}

Show.instance(Report)({
  show() {
    const report = this.value();

    return "AnalyzerReport(" +
      "files=" + report.files.toString() +
      ", parsed=" + report.parsed.toString() +
      ", failed=" + report.failed.toString() +
      ")";
  },
});

Semigroup.instance(Report)({
  concat(right) {
    return Report(concat_reports(this.value(), right.value()));
  },
});

Monoid.instance(Report)({
  empty() {
    return Report(empty_report());
  },
});

function concat_diagnostics(
  left: readonly FileDiagnostic[],
  right: readonly FileDiagnostic[],
): readonly FileDiagnostic[] {
  if (left.length === 0) {
    return right;
  }

  if (right.length === 0) {
    return left;
  }

  return [...left, ...right];
}

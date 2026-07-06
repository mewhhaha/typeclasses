import { from_array, to_array } from "../../src/array.ts";
import { Effect } from "../../src/effects.ts";
import {
  run_parallel,
  run_parallel_with_pool,
  with_worker_pool,
  type WorkerPool,
} from "../../src/parallel.ts";
import { run_reader } from "../../src/reader.ts";
import { from_fn, run_task, succeed } from "../../src/task.ts";
import { Foldable, Monad } from "../../src/typeclasses.ts";
import { run_writer } from "../../src/writer.ts";
import {
  broken_program,
  sample_program,
} from "../programming_language_parser/language.ts";
import { analyze_sources_sequential } from "./analyzer.ts";
import { run_analyze_sources_with_workers } from "./effects.ts";
import { parallel_analyzer } from "./program.ts";
import { concat_reports, empty_report, summarize_results } from "./report.ts";
import type {
  AnalyzeResult,
  AnalyzerReport,
  AnalyzerRun,
  SourceFile,
} from "./types.ts";

const worker_url = new URL("./worker.ts", import.meta.url);

type AnalyzerBatchRun = {
  readonly batches: number;
  readonly files: number;
  readonly parsed: number;
  readonly failed: number;
  readonly elapsed_ms: number;
};

type BatchAnalyzer = (
  files: readonly SourceFile[],
) => AnalyzerRun | Promise<AnalyzerRun>;

export async function run_parallel_analyzer_case_study() {
  const files = sample_sources(512);
  const sequential = run_sequential_analyzer(files);
  const parallel = await run_parallel_analyzer(files, 4);
  const pooled = await run_pooled_parallel_analyzer(files, 4);

  console.log(
    "parallel analyzer sequential",
    report_summary(sequential.report),
    format_ms(sequential.elapsed_ms),
  );
  console.log(
    "parallel analyzer workers one-shot",
    report_summary(parallel.report),
    format_ms(parallel.elapsed_ms),
  );
  console.log(
    "parallel analyzer workers pooled",
    report_summary(pooled.report),
    format_ms(pooled.elapsed_ms),
  );
  console.log("parallel analyzer logs", Deno.inspect(pooled.logs));

  const batches = sample_batches(8, 64);
  const repeated_sequential = await run_repeated_sequential_analyzer(batches);
  const repeated_parallel = await run_repeated_parallel_analyzer(batches, 4);
  const repeated_pooled = await run_repeated_pooled_parallel_analyzer(
    batches,
    4,
  );

  console.log(
    "parallel analyzer repeated sequential",
    batch_summary(repeated_sequential),
    format_ms(repeated_sequential.elapsed_ms),
  );
  console.log(
    "parallel analyzer repeated workers one-shot",
    batch_summary(repeated_parallel),
    format_ms(repeated_parallel.elapsed_ms),
  );
  console.log(
    "parallel analyzer repeated workers pooled",
    batch_summary(repeated_pooled),
    format_ms(repeated_pooled.elapsed_ms),
  );

  for (const diagnostic of pooled.report.diagnostics) {
    console.log(
      "parallel analyzer diagnostic",
      diagnostic.path + ":" + diagnostic.line.toString() + ":" +
        diagnostic.column.toString(),
      diagnostic.message,
    );
  }
}

export function run_sequential_analyzer(
  files: readonly SourceFile[],
): AnalyzerRun {
  const started = performance.now();
  const results = analyze_sources_sequential(files);
  const report = summarize_results(results);

  return {
    report,
    logs: ["sequential analyzer files=" + files.length.toString()],
    elapsed_ms: performance.now() - started,
  };
}

export async function run_parallel_analyzer(
  files: readonly SourceFile[],
  workers: number,
): Promise<AnalyzerRun> {
  const started = performance.now();
  const [report, logs] = await Effect.interpret(parallel_analyzer)
    .handle((effect) =>
      run_reader(effect, {
        files,
        workers,
      })
    )
    .handle((effect) => run_writer(effect, from_array<string>([])))
    .handle((effect) => run_analyze_sources_with_workers(effect, worker_url))
    .handle((effect) => run_parallel(effect))
    .run(run_task);

  return {
    report,
    logs: to_array(logs),
    elapsed_ms: performance.now() - started,
  };
}

export async function run_pooled_parallel_analyzer(
  files: readonly SourceFile[],
  workers: number,
): Promise<AnalyzerRun> {
  return await with_worker_pool(
    worker_url,
    async (pool: WorkerPool<SourceFile, AnalyzeResult>) => {
      await pool.map(files.slice(0, workers));
      return await run_parallel_analyzer_with_pool(files, workers, pool);
    },
    { workers },
  );
}

function run_repeated_sequential_analyzer(
  batches: readonly (readonly SourceFile[])[],
): Promise<AnalyzerBatchRun> {
  return run_batched_analyzer(batches, run_sequential_analyzer);
}

async function run_repeated_parallel_analyzer(
  batches: readonly (readonly SourceFile[])[],
  workers: number,
): Promise<AnalyzerBatchRun> {
  return await run_batched_analyzer(batches, (batch) => {
    return run_parallel_analyzer(batch, workers);
  });
}

async function run_repeated_pooled_parallel_analyzer(
  batches: readonly (readonly SourceFile[])[],
  workers: number,
): Promise<AnalyzerBatchRun> {
  if (batches.length === 0) {
    return batch_run_from_report(0, empty_report(), 0);
  }

  return await with_worker_pool(
    worker_url,
    async (pool: WorkerPool<SourceFile, AnalyzeResult>) => {
      await pool.map(batches[0].slice(0, workers));

      return await run_batched_analyzer(batches, (batch) => {
        return run_parallel_analyzer_with_pool(batch, workers, pool);
      });
    },
    { workers },
  );
}

async function run_batched_analyzer(
  batches: readonly (readonly SourceFile[])[],
  analyze_batch: BatchAnalyzer,
): Promise<AnalyzerBatchRun> {
  const started = performance.now();
  const report = await analyze_batches(batches, analyze_batch).run();

  return batch_run_from_report(
    batches.length,
    report,
    performance.now() - started,
  );
}

function analyze_batches(
  batches: readonly (readonly SourceFile[])[],
  analyze_batch: BatchAnalyzer,
) {
  return Foldable.fold(
    from_array(batches),
    succeed(empty_report()),
    (report_task, batch) => {
      return Monad.bind(report_task, (report) => {
        return from_fn(async () => {
          const run = await analyze_batch(batch);
          return concat_reports(report, run.report);
        });
      });
    },
  );
}

async function run_parallel_analyzer_with_pool(
  files: readonly SourceFile[],
  workers: number,
  pool: WorkerPool<SourceFile, AnalyzeResult>,
): Promise<AnalyzerRun> {
  const started = performance.now();
  const [report, logs] = await Effect.interpret(parallel_analyzer)
    .handle((effect) =>
      run_reader(effect, {
        files,
        workers,
      })
    )
    .handle((effect) => run_writer(effect, from_array<string>([])))
    .handle((effect) => run_analyze_sources_with_workers(effect, worker_url))
    .handle((effect) => run_parallel_with_pool(effect, pool))
    .run(run_task);

  return {
    report,
    logs: to_array(logs),
    elapsed_ms: performance.now() - started,
  };
}

export function sample_sources(count: number): readonly SourceFile[] {
  const files: SourceFile[] = [];

  for (let index = 0; index < count; index += 1) {
    files.push({
      path: "generated_" + index.toString() + ".typeclasses",
      source: generated_source(index),
    });
  }

  files.push({
    path: "broken_parallel.typeclasses",
    source: broken_program,
  });

  return files;
}

function sample_batches(
  batch_count: number,
  files_per_batch: number,
): readonly (readonly SourceFile[])[] {
  const batches: SourceFile[][] = [];

  for (let index = 0; index < batch_count; index += 1) {
    batches.push(sample_sources(files_per_batch + index).slice());
  }

  return batches;
}

function generated_source(index: number): string {
  const suffix = index.toString();

  return sample_program
    .replace("fn score", "fn score_" + suffix)
    .replace("return score(user", "return score_" + suffix + "(user")
    .replace("fn main", "fn main_" + suffix);
}

function report_summary(report: AnalyzerReport): string {
  return "files=" + report.files.toString() +
    " parsed=" + report.parsed.toString() +
    " failed=" + report.failed.toString() +
    " declarations=" + report.declarations.toString() +
    " functions=" + report.functions.toString();
}

function batch_summary(run: AnalyzerBatchRun): string {
  return "batches=" + run.batches.toString() +
    " files=" + run.files.toString() +
    " parsed=" + run.parsed.toString() +
    " failed=" + run.failed.toString();
}

function batch_run_from_report(
  batches: number,
  report: AnalyzerReport,
  elapsed_ms: number,
): AnalyzerBatchRun {
  return {
    batches,
    files: report.files,
    parsed: report.parsed,
    failed: report.failed,
    elapsed_ms,
  };
}

function format_ms(value: number): string {
  return value.toFixed(2) + "ms";
}

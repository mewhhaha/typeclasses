import {
  Effect,
  type Operation,
  type TaggedOperation,
} from "../../src/effects.ts";
import { type Parallel, parallel_map } from "../../src/parallel.ts";
import type { AnalyzeResult, SourceFile } from "./types.ts";

export type AnalyzeSources =
  & Operation<readonly AnalyzeResult[]>
  & readonly [
    "parallel_analyzer.analyze_sources",
    {
      readonly files: readonly SourceFile[];
      readonly workers: number | undefined;
    },
  ];

export type AnalyzeSourcesOptions = {
  readonly workers?: number;
};

type WithoutAnalyzeSources<requirements> = requirements extends AnalyzeSources
  ? never
  : requirements;

export function analyze_sources(
  files: readonly SourceFile[],
  options: AnalyzeSourcesOptions = {},
): Effect<AnalyzeSources, readonly AnalyzeResult[]> {
  return Effect.send([
    "parallel_analyzer.analyze_sources",
    { files, workers: options.workers },
  ] as AnalyzeSources);
}

export function run_analyze_sources_with_workers<requirements, item>(
  effect: Effect<requirements, item>,
  worker: string | URL,
): Effect<WithoutAnalyzeSources<requirements> | Parallel, item> {
  if (effect[0] === "pure") {
    return Effect.pure(effect[1]);
  }

  const operation = effect[1] as TaggedOperation;

  if (operation[0] === "parallel_analyzer.analyze_sources") {
    const [, analyze] = effect[1] as AnalyzeSources;

    return Effect.bind(
      parallel_map<SourceFile, AnalyzeResult>(worker, analyze.files, {
        workers: analyze.workers,
      }),
      (results) => {
        return run_analyze_sources_with_workers(
          effect[2](results),
          worker,
        );
      },
    );
  }

  return Effect.suspend(
    effect[1] as WithoutAnalyzeSources<requirements>,
    (value) => run_analyze_sources_with_workers(effect[2](value), worker),
  );
}

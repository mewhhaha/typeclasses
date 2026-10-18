import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** A workload separates retained construction from execution. */
export type ProfileWorkload<value> = {
  readonly name: string;
  readonly create: () => value;
  readonly run: (value: value) => unknown | PromiseLike<unknown>;
  readonly dispose?: (value: value) => unknown | PromiseLike<unknown>;
};

/** Nearest-rank latency percentiles; durations include awaited work. */
export function latency_summary(samples: readonly number[]): {
  samples: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
} {
  if (
    samples.length === 0 ||
    samples.some((value) => !Number.isFinite(value) || value < 0)
  ) throw new RangeError("latencies must be nonnegative finite samples");
  const ordered = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    ordered[Math.ceil(ordered.length * fraction) - 1];
  return {
    samples: samples.length,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    max_ms: ordered.at(-1)!,
  };
}

/** Profile one isolated workload; this measures memory snapshots, not allocation traffic. */
export async function profile_workload<value>(
  workload: ProfileWorkload<value>,
  count = 1_000,
  warmups = 10,
) {
  if (
    !Number.isSafeInteger(count) || count < 1 ||
    !Number.isSafeInteger(warmups) || warmups < 0
  ) throw new RangeError("samples >= 1 and warmups >= 0 must be integers");
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  for (let index = 0; index < warmups; index += 1) {
    const value = workload.create();
    try {
      await workload.run(value);
    } finally {
      await workload.dispose?.(value);
    }
  }
  gc?.();
  const before = Deno.memoryUsage();
  const retained: value[] = [];
  const construction_ms: number[] = [];
  const execution_ms: number[] = [];
  let last_result: unknown;
  async function release_values(): Promise<void> {
    let failure: { error: unknown } | undefined;
    while (retained.length > 0) {
      const value = retained.pop()!;
      try {
        await workload.dispose?.(value);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== undefined) throw failure.error;
  }
  try {
    for (let index = 0; index < count; index += 1) {
      const start = performance.now();
      retained.push(workload.create());
      construction_ms.push(performance.now() - start);
    }
    gc?.();
    const constructed = Deno.memoryUsage();
    for (const value of retained) {
      const start = performance.now();
      last_result = await workload.run(value);
      execution_ms.push(performance.now() - start);
    }
    gc?.();
    const executed = Deno.memoryUsage();
    const result_type = typeof last_result;
    await release_values();
    last_result = undefined;
    gc?.();
    const released = Deno.memoryUsage();
    const delta = (snapshot: typeof before) => ({
      rss: snapshot.rss - before.rss,
      heapTotal: snapshot.heapTotal - before.heapTotal,
      heapUsed: snapshot.heapUsed - before.heapUsed,
      external: snapshot.external - before.external,
    });
    return {
      name: workload.name,
      runtime: Deno.version,
      gc_available: gc !== undefined,
      result_type,
      construction: latency_summary(construction_ms),
      execution: latency_summary(execution_ms),
      construction_ms,
      execution_ms,
      memory: { before, constructed, executed, released },
      deltas_from_before: {
        constructed: delta(constructed),
        executed: delta(executed),
        released: delta(released),
      },
      limitations:
        "Memory snapshots show retained heap/RSS/external bytes at sampling points; they are not allocation counts or peak memory. Harness arrays and timing samples are included. Final run output is retained until execution sampling, then released. Explicit GC is optional. Timings include harness calls and awaited completion. Tail percentiles describe these samples on one host.",
    };
  } finally {
    await release_values();
    void last_result;
  }
}

if (import.meta.main) {
  const [module, destination, count = "1000", warmups = "10"] = Deno.args;
  if (!module || !destination) {
    throw new Error(
      "Usage: runtime_profile.ts WORKLOAD.ts OUTPUT.json [SAMPLES] [WARMUPS]",
    );
  }
  const workload = (await import(pathToFileURL(resolve(module)).href))
    .default as ProfileWorkload<unknown>;
  const report = await profile_workload(
    workload,
    Number(count),
    Number(warmups),
  );
  await Deno.writeTextFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      destination,
      name: report.name,
      gc_available: report.gc_available,
      construction: report.construction,
      execution: report.execution,
      memory: report.deltas_from_before,
    }),
  );
}

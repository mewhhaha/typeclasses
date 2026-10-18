import { Session } from "node:inspector/promises";
import { performance, PerformanceObserver } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import process from "node:process";
import type { ProfileWorkload } from "./runtime_profile.ts";

/** Sampled allocation and latency report; allocation bytes are statistical estimates. */
export type AllocationProfile = {
  name: string;
  runtime: string;
  samples: number;
  sampling_interval: number;
  allocated_bytes: number;
  allocated_bytes_per_run: number;
  cpu_ms: number;
  latency: { p50_ms: number; p99_ms: number; max_ms: number };
  gc: { collections: number; pause_ms: number; max_pause_ms: number };
};

/** Explicit relative budgets; compare matching workloads, hosts and sample settings. */
export function profile_budget_failures(
  baseline: AllocationProfile,
  candidate: AllocationProfile,
  limits: {
    allocation_ratio: number;
    p99_ratio: number;
    gc_pause_ratio: number;
  },
): string[] {
  if (
    baseline.name !== candidate.name ||
    baseline.runtime !== candidate.runtime ||
    baseline.samples !== candidate.samples ||
    baseline.sampling_interval !== candidate.sampling_interval
  ) {
    throw new Error(
      "Allocation profiles must use the same workload, runtime and sampling settings",
    );
  }
  const failures: string[] = [];
  for (
    const [name, before, after, ratio] of [
      [
        "allocated bytes/run",
        baseline.allocated_bytes_per_run,
        candidate.allocated_bytes_per_run,
        limits.allocation_ratio,
      ],
      [
        "p99 latency",
        baseline.latency.p99_ms,
        candidate.latency.p99_ms,
        limits.p99_ratio,
      ],
      [
        "GC pause",
        baseline.gc.pause_ms,
        candidate.gc.pause_ms,
        limits.gc_pause_ratio,
      ],
    ] as const
  ) {
    if (
      !Number.isFinite(before) || !Number.isFinite(after) || before < 0 ||
      after < 0
    ) {
      throw new RangeError("Profile metrics must be finite and nonnegative");
    }
    if (!Number.isFinite(ratio) || ratio < 1) {
      throw new RangeError("Budget ratios must be finite and >= 1");
    }
    if (after > before * ratio) {
      failures.push(`${name}: ${after} exceeds ${before} × ${ratio}`);
    }
  }
  return failures;
}

/** Profile allocation traffic including collected objects using the Node inspector. */
export async function allocation_profile<value>(
  workload: ProfileWorkload<value>,
  count = 1_000,
  sampling_interval = 16_384,
): Promise<AllocationProfile> {
  if (
    !Number.isSafeInteger(count) || count < 1 ||
    !Number.isSafeInteger(sampling_interval) || sampling_interval < 1
  ) {
    throw new RangeError(
      "Sample count and sampling interval must be positive integers",
    );
  }
  const session = new Session();
  session.connect();
  const pauses: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) pauses.push(entry.duration);
  });
  observer.observe({ entryTypes: ["gc"] });
  const latencies: number[] = [];
  let profile: unknown;
  const cpu = process.cpuUsage();
  try {
    await session.post("HeapProfiler.startSampling", {
      samplingInterval: sampling_interval,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    for (let index = 0; index < count; index++) {
      const started = performance.now();
      const value = workload.create();
      try {
        await workload.run(value);
      } finally {
        await workload.dispose?.(value);
      }
      latencies.push(performance.now() - started);
    }
    profile = await session.post("HeapProfiler.stopSampling");
    await setImmediate();
    await setImmediate();
  } finally {
    observer.disconnect();
    session.disconnect();
  }
  const elapsed_cpu = process.cpuUsage(cpu);
  const sample = profile as unknown as {
    profile: { head: { selfSize: number; children: unknown[] } };
  };
  const pending = [sample.profile.head];
  let allocated_bytes = 0;
  while (pending.length > 0) {
    const node = pending.pop()!;
    allocated_bytes += node.selfSize;
    for (const child of node.children) pending.push(child as typeof node);
  }
  latencies.sort((a, b) => a - b);
  return {
    name: workload.name,
    runtime: process.version,
    samples: count,
    sampling_interval,
    allocated_bytes,
    allocated_bytes_per_run: allocated_bytes / count,
    cpu_ms: (elapsed_cpu.user + elapsed_cpu.system) / 1_000,
    latency: {
      p50_ms: latencies[Math.ceil(count * .5) - 1],
      p99_ms: latencies[Math.ceil(count * .99) - 1],
      max_ms: latencies.at(-1)!,
    },
    gc: {
      collections: pauses.length,
      pause_ms: pauses.reduce((sum, n) => sum + n, 0),
      max_pause_ms: pauses.reduce(
        (maximum, pause) => Math.max(maximum, pause),
        0,
      ),
    },
  };
}

if (import.meta.main) {
  const [module, destination, count = "1000"] = process.argv.slice(2);
  if (!module || !destination) {
    throw new Error(
      "Usage: node --experimental-strip-types tools/allocation_profile.ts WORKLOAD.ts OUTPUT.json [SAMPLES]",
    );
  }
  const workload = (await import(pathToFileURL(resolve(module)).href))
    .default as ProfileWorkload<unknown>;
  const report = await allocation_profile(workload, Number(count));
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}

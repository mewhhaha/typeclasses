import { resolve } from "node:path";

/** Four serial observations counterbalance linear drift: A, B, B, A. */
export type PairedBlock = readonly [number, number, number, number];

/** Geometric A/B speedup with a deterministic block-bootstrap interval. */
export function summarize_pairs(blocks: readonly PairedBlock[]): {
  blocks: number;
  speedup: number;
  confidence_95: readonly [number, number];
} {
  if (blocks.length < 2) {
    throw new RangeError("at least two ABBA blocks are required");
  }
  const ratios = blocks.map(([a, b, c, d]) => {
    if (![a, b, c, d].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError("observations must be finite and positive");
    }
    return Math.log((a + d) / (b + c));
  });
  const mean = (values: readonly number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  let seed = 0x812feb19;
  const samples: number[] = [];
  for (let repeat = 0; repeat < 10_000; repeat += 1) {
    let sum = 0;
    for (let index = 0; index < ratios.length; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      sum += ratios[Math.floor(seed / 4_294_967_296 * ratios.length)];
    }
    samples.push(Math.exp(sum / ratios.length));
  }
  samples.sort((a, b) => a - b);
  return {
    blocks: blocks.length,
    speedup: Math.exp(mean(ratios)),
    confidence_95: [samples[249], samples[9749]],
  };
}

type Specification = {
  readonly baseline: readonly [string, ...string[]];
  readonly candidate: readonly [string, ...string[]];
  readonly blocks?: number;
  readonly warmups?: number;
  readonly cwd?: string;
  readonly inputs?: readonly string[];
  /** Read this numeric JSON stdout field instead of process wall time. */
  readonly metric?: string;
};

async function fingerprints(
  root: string,
  inputs: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const input of inputs) {
    const bytes = await Deno.readFile(resolve(root, input));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    out[input] = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  return out;
}

if (import.meta.main) {
  const [specification, destination] = Deno.args;
  if (!specification || !destination) {
    throw new Error("Usage: paired_bench.ts SPEC.json OUTPUT.json");
  }
  const spec = JSON.parse(
    await Deno.readTextFile(specification),
  ) as Specification;
  const root = resolve(spec.cwd ?? ".");
  const count = spec.blocks ?? 8;
  const warmups = spec.warmups ?? 1;
  if (
    !Number.isSafeInteger(count) || count < 2 ||
    !Number.isSafeInteger(warmups) || warmups < 0
  ) throw new RangeError("blocks >= 2 and warmups >= 0 must be integers");
  const before = await fingerprints(root, spec.inputs ?? []);
  const observations: {
    variant: "A" | "B";
    value: number;
    wall_ms: number;
    stdout: string;
    stderr: string;
  }[] = [];
  const observe = async (
    variant: "A" | "B",
    record: boolean,
  ): Promise<number> => {
    let command = spec.baseline;
    if (variant === "B") command = spec.candidate;
    if (!Array.isArray(command) || typeof command[0] !== "string") {
      throw new TypeError("commands must be nonempty argv arrays");
    }
    const started = performance.now();
    const result = await new Deno.Command(command[0], {
      args: [...command.slice(1)],
      cwd: root,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const wall_ms = performance.now() - started;
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);
    if (!result.success) {
      throw new Error(`${variant} failed (${result.code}): ${stderr}`);
    }
    let value = wall_ms;
    if (spec.metric !== undefined) value = JSON.parse(stdout)[spec.metric];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new TypeError("metric must be finite and positive");
    }
    if (record) observations.push({ variant, value, wall_ms, stdout, stderr });
    return value;
  };
  for (let index = 0; index < warmups; index += 1) {
    await observe("A", false);
    await observe("B", false);
  }
  const blocks: PairedBlock[] = [];
  for (let index = 0; index < count; index += 1) {
    blocks.push([
      await observe("A", true),
      await observe("B", true),
      await observe("B", true),
      await observe("A", true),
    ]);
  }
  const after = await fingerprints(root, spec.inputs ?? []);
  const report = {
    captured_at: new Date().toISOString(),
    runtime: Deno.version,
    spec,
    metric: spec.metric ?? "process_wall_ms",
    order: "ABBA",
    observations,
    blocks,
    summary: summarize_pairs(blocks),
    source_hashes: before,
    changed_inputs: Object.keys(before).filter((input) =>
      before[input] !== after[input]
    ),
    limitations:
      "95% percentile bootstrap over ABBA blocks; descriptive on one host, not protection against systematic bias. Process startup is included unless metric selects workload timing.",
  };
  await Deno.writeTextFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      destination,
      ...report.summary,
      changed_inputs: report.changed_inputs,
    }),
  );
}

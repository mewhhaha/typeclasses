import { relative, resolve } from "node:path";

// Capture an arbitrary command with the exact source/workload state it measured.
const [destination, root_argument, ...command] = Deno.args;
if (!destination || !root_argument || command.length === 0) {
  throw new Error("Usage: capture_measurement.ts OUTPUT ROOT COMMAND [ARG...]");
}
const root = resolve(root_argument);
async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
async function fingerprint(): Promise<Record<string, string>> {
  const entries: [string, string][] = [];
  async function visit(path: string) {
    for await (const entry of Deno.readDir(path)) {
      const filename = resolve(path, entry.name);
      if (entry.isDirectory && entry.name !== "artifacts") {
        await visit(filename);
      }
      if (entry.isFile && entry.name.endsWith(".ts")) {
        entries.push([
          relative(root, filename),
          await digest(await Deno.readFile(filename)),
        ]);
      }
    }
  }
  for (const directory of ["src", "bench", "tools", "case_studies"]) {
    await visit(resolve(root, directory));
  }
  for (const file of ["deno.json", "deno.lock"]) {
    entries.push([
      file,
      await digest(await Deno.readFile(resolve(root, file))),
    ]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}
const sources = await fingerprint();
const start = performance.now();
const result = await new Deno.Command(command[0], {
  args: command.slice(1),
  cwd: root,
  stdout: "piped",
  stderr: "piped",
}).output();
const elapsed_ms = performance.now() - start;
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const stdout = decode(result.stdout);
let output: unknown = stdout;
try {
  output = JSON.parse(stdout);
} catch { /* Commands need not emit JSON. */ }
const after = await fingerprint();
const changed_files = [
  ...new Set([...Object.keys(sources), ...Object.keys(after)]),
]
  .filter((file) => sources[file] !== after[file]);
const commit = await new Deno.Command("git", {
  args: ["rev-parse", "HEAD"],
  cwd: root,
  stdout: "piped",
}).output();
const cpu = await Deno.readTextFile("/proc/cpuinfo").catch(() => "unavailable");
await Deno.writeTextFile(
  destination,
  JSON.stringify(
    {
      captured_at: new Date().toISOString(),
      commit: decode(commit.stdout).trim(),
      command,
      runtime: Deno.version,
      platform: Deno.build,
      cpu: cpu.match(/^model name\s*:\s*(.*)$/m)?.[1] ?? cpu,
      source_sha256: await digest(
        new TextEncoder().encode(JSON.stringify(sources)),
      ),
      sources,
      changed_files,
      elapsed_ms,
      exit_code: result.code,
      output,
      stderr: decode(result.stderr),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    destination,
    elapsed_ms,
    exit_code: result.code,
    changed_files,
  }),
);
if (result.code !== 0 || changed_files.length > 0) Deno.exit(1);

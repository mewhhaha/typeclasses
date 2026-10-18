import { resolve } from "node:path";

/** Select transitive consumers, including tests, of edited source files. */
export function affected_files(
  sources: ReadonlyMap<string, string>,
  changed: readonly string[],
): string[] {
  // A nonliteral dynamic import can reference any module; check the whole graph.
  if (
    [...sources.values()].some((source) => /import\s*\(\s*[^\s"']/.test(source))
  ) {
    return [...sources.keys()].sort();
  }
  const reverse = new Map<string, Set<string>>();
  for (const [file, source] of sources) {
    for (
      const match of source.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+\.ts)["']/g,
      )
    ) {
      const imported = new URL(match[1], "file://" + file).pathname;
      let consumers = reverse.get(imported);
      if (consumers === undefined) {
        consumers = new Set();
        reverse.set(imported, consumers);
      }
      consumers.add(file);
    }
  }
  const selected = new Set(changed);
  for (const file of selected) {
    for (const consumer of reverse.get(file) ?? []) selected.add(consumer);
  }
  return [...selected].filter((file) => sources.has(file)).sort();
}

async function source_files(
  directory: string,
  sources = new Map<string, string>(),
) {
  for await (const entry of Deno.readDir(directory)) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory) await source_files(file, sources);
    if (entry.isFile && file.endsWith(".ts")) {
      sources.set(file, await Deno.readTextFile(file));
    }
  }
  return sources;
}

async function check(
  changed: readonly string[],
  plan: boolean,
): Promise<boolean> {
  const sources = await source_files(resolve("src"));
  let selected = affected_files(sources, changed);
  if (changed.some((path) => !path.endsWith(".ts") || !sources.has(path))) {
    selected = [...sources.keys()];
  }
  const tests = selected.filter((path) => path.endsWith(".test.ts"));
  if (plan) {
    console.log(JSON.stringify({ changed, checked: selected, tests }, null, 2));
    return true;
  }
  if (selected.length === 0) return true;
  const start = performance.now();
  const commands = [["check", ...selected], ["lint", ...selected]];
  if (tests.length > 0) commands.push(["test", "--no-check", ...tests]);
  for (const args of commands) {
    const result = await new Deno.Command(Deno.execPath(), {
      args,
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    if (!result.success) return false;
  }
  console.log(
    `Checked ${selected.length} affected files in ${
      (performance.now() - start).toFixed(0)
    } ms`,
  );
  return true;
}

if (import.meta.main) {
  if (!Deno.args.includes("--watch")) {
    let changed = Deno.args.filter((arg) => !arg.startsWith("--")).map((path) =>
      resolve(path)
    );
    if (changed.length === 0) {
      for (
        const args of [["diff", "HEAD", "--name-only", "-z"], [
          "ls-files",
          "--others",
          "--exclude-standard",
          "-z",
        ]]
      ) {
        const result = await new Deno.Command("git", { args, stdout: "piped" })
          .output();
        if (!result.success) throw new Error("Cannot read changed files");
        changed.push(
          ...new TextDecoder().decode(result.stdout).split("\0").filter(Boolean)
            .map((path) => resolve(path)),
        );
      }
    }
    changed = changed.filter((path) =>
      path.endsWith(".ts") || path.endsWith("deno.json") ||
      path.endsWith("deno.lock")
    );
    if (!await check(changed, Deno.args.includes("--plan"))) Deno.exit(1);
  } else {
    const pending = new Set<string>();
    let running = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const flush = async () => {
      if (running) return;
      running = true;
      try {
        while (pending.size > 0) {
          const paths = [...pending];
          pending.clear();
          try {
            await check(paths, false);
          } catch (error) {
            console.error(error);
          }
        }
      } finally {
        running = false;
      }
    };
    console.log(
      "Watching src and compiler configuration; edits are checked before tests run.",
    );
    for await (const event of Deno.watchFs(["src", "deno.json", "deno.lock"])) {
      for (const path of event.paths) pending.add(path);
      clearTimeout(debounce);
      debounce = setTimeout(() => void flush(), 40);
    }
  }
}

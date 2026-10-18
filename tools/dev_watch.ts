import { resolve } from "node:path";

/** Select transitive consumers, including tests, of edited source files. */
export function affected_files(
  sources: ReadonlyMap<string, string>,
  changed: readonly string[],
): string[] {
  return create_dependency_graph(sources).affected(changed);
}

/** Incremental import graph; updating a file reparses only that file. */
export function create_dependency_graph(
  initial: ReadonlyMap<string, string> = new Map(),
) {
  const sources = new Map<string, string>();
  const reverse = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();
  const dynamic = new Set<string>();
  function update(file: string, source?: string): void {
    for (const imported of dependencies.get(file) ?? []) {
      const consumers = reverse.get(imported);
      consumers?.delete(file);
      if (consumers?.size === 0) reverse.delete(imported);
    }
    dependencies.delete(file);
    dynamic.delete(file);
    if (source === undefined) {
      sources.delete(file);
      return;
    }
    sources.set(file, source);
    if (/import\s*\(\s*[^\s"']/.test(source)) dynamic.add(file);
    const imports = new Set<string>();
    for (
      const match of source.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s*)["'](\.[^"']+\.ts)["']/g,
      )
    ) {
      const imported = new URL(match[1], "file://" + file).pathname;
      imports.add(imported);
      let consumers = reverse.get(imported);
      if (consumers === undefined) {
        consumers = new Set();
        reverse.set(imported, consumers);
      }
      consumers.add(file);
    }
    dependencies.set(file, imports);
  }
  function affected(changed: readonly string[]): string[] {
    if (dynamic.size > 0) return [...sources.keys()].sort();
    const selected = new Set(changed);
    for (const file of selected) {
      for (const consumer of reverse.get(file) ?? []) selected.add(consumer);
    }
    return [...selected].filter((file) => sources.has(file)).sort();
  }
  for (const [file, source] of initial) update(file, source);
  return { sources, update, affected };
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
  graph?: ReturnType<typeof create_dependency_graph>,
): Promise<boolean> {
  graph ??= create_dependency_graph(await source_files(resolve("src")));
  const sources = graph.sources;
  let selected = graph.affected(changed);
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
    let graph = create_dependency_graph(await source_files(resolve("src")));
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
            if (paths.some((path) => !path.endsWith(".ts"))) {
              graph = create_dependency_graph(
                await source_files(resolve("src")),
              );
            } else {
              for (const path of paths) {
                try {
                  graph.update(path, await Deno.readTextFile(path));
                } catch (error) {
                  if (!(error instanceof Deno.errors.NotFound)) throw error;
                  graph.update(path);
                }
              }
            }
            await check(paths, false, graph);
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

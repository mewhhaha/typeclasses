const source_root = new URL("../src/", import.meta.url);
const violations: string[] = [];

await scan(source_root);

if (violations.length > 0) {
  throw new Error(
    "Published source must not reference Deno globals:\n" +
      violations.join("\n"),
  );
}

async function scan(directory: URL): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const url = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);

    if (entry.isDirectory) {
      await scan(url);
      continue;
    }

    if (!entry.isFile || !entry.name.endsWith(".ts")) {
      continue;
    }

    if (entry.name.endsWith(".test.ts")) {
      continue;
    }

    const source = await Deno.readTextFile(url);
    const lines = source.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes("Deno.")) {
        violations.push(url.pathname + ":" + String(index + 1));
      }
    }
  }
}

import { dirname, relative, resolve, sep } from "node:path";

/** Render marker-selected executable examples using public package imports. */
export async function render_examples(
  markdown: string,
  root: string,
  exports: Readonly<Record<string, string>>,
  name: string,
  read: (path: string) => Promise<string> = Deno.readTextFile,
): Promise<string> {
  const markers = [
    ...markdown.matchAll(
      /<!-- example:([^\s#]+)#([^\s]+) -->\n[\s\S]*?\n<!-- \/example -->/g,
    ),
  ];
  if (
    (markdown.match(/<!-- example:/g)?.length ?? 0) !== markers.length ||
    (markdown.match(/<!-- \/example -->/g)?.length ?? 0) !== markers.length
  ) throw new Error("malformed example marker block");
  let result = markdown;
  for (const match of markers) {
    const source_path = match[1];
    const id = match[2];
    const filename = resolve(root, source_path);
    if (
      !source_path.startsWith("examples/") ||
      !filename.startsWith(resolve(root, "examples") + sep)
    ) {
      throw new Error(
        `example source must stay inside examples/: ${source_path}`,
      );
    }
    const source = await read(filename);
    const start = `// docs:begin ${id}`;
    const end = `// docs:end ${id}`;
    if (source.split(start).length !== 2 || source.split(end).length !== 2) {
      throw new Error(`expected exactly one marker pair: ${source_path}#${id}`);
    }
    const begin = source.indexOf(start) + start.length;
    const finish = source.indexOf(end);
    if (finish < begin) {
      throw new Error(`reversed example markers: ${source_path}#${id}`);
    }
    const lines = source.slice(begin, finish).trim().split("\n");
    const snippet = lines.join("\n").replace(
      /(from\s+)(["'])(\.[^"']+)\2/g,
      (_match, prefix: string, quote: string, target: string) => {
        const resolved = relative(root, resolve(dirname(filename), target))
          .split(sep).join("/");
        const entry = Object.entries(exports).find(([, value]) =>
          value.replace(/^\.\//, "") === resolved
        );
        if (entry === undefined) {
          throw new Error(`example import has no public export: ${target}`);
        }
        let specifier = name;
        if (entry[0] !== ".") specifier += entry[0].slice(1);
        return prefix + quote + specifier + quote;
      },
    );
    const replacement =
      `<!-- example:${source_path}#${id} -->\n\n\`\`\`ts\n${snippet}\n\`\`\`\n\n<!-- /example -->`;
    result = result.replace(match[0], replacement);
  }
  return result;
}

if (import.meta.main) {
  if (Deno.args.some((argument) => argument !== "--check")) {
    throw new Error("Usage: sync_examples.ts [--check]");
  }
  const root = new URL("../", import.meta.url).pathname;
  const manifest = JSON.parse(
    await Deno.readTextFile(resolve(root, "deno.json")),
  ) as { name: string; exports: Record<string, string> };
  const changed: string[] = [];
  for (const name of ["README.md", "LLMS.md"]) {
    const path = resolve(root, name);
    const before = await Deno.readTextFile(path);
    const after = await render_examples(
      before,
      root,
      manifest.exports,
      manifest.name,
    );
    if (before === after) continue;
    changed.push(name);
    if (!Deno.args.includes("--check")) await Deno.writeTextFile(path, after);
  }
  if (Deno.args.includes("--check") && changed.length > 0) {
    throw new Error("example snippets drifted: " + changed.join(", "));
  }
  console.log(JSON.stringify({ checked: ["README.md", "LLMS.md"], changed }));
}

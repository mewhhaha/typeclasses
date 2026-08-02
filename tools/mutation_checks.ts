type Mutation = {
  readonly file: string;
  readonly original: string;
  readonly replacement: string;
  readonly tests: readonly string[];
};

const mutations: readonly Mutation[] = [
  {
    file: "src/task.ts",
    original: "return Task((signal) => {\n    if (signal?.aborted) {",
    replacement:
      "return Task((signal) => {\n    if (signal !== undefined && false) {",
    tests: ["src/task_runtime.test.ts"],
  },
  {
    file: "src/typeclass.ts",
    original: "if (tagged.length !== expected_length) {",
    replacement: "if (false && tagged.length !== expected_length) {",
    tests: ["src/api_soundness.test.ts"],
  },
  {
    file: "tools/transform_do_program.ts",
    original:
      'return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;',
    replacement: "return ts.ScriptKind.TS;",
    tests: [
      "--allow-env",
      "tools/transform_do_program_checks.ts",
      "--filter",
      "inside TSX",
    ],
  },
];

for (const mutation of mutations) {
  const workspace = await Deno.makeTempDir({ prefix: "typeclasses-mutant-" });

  try {
    await copy_tree("src", workspace + "/src");
    await copy_tree("tools", workspace + "/tools");
    await Deno.copyFile("deno.json", workspace + "/deno.json");
    await Deno.copyFile("deno.lock", workspace + "/deno.lock");

    const path = workspace + "/" + mutation.file;
    const source = await Deno.readTextFile(path);
    const occurrences = source.split(mutation.original).length - 1;

    if (occurrences !== 1) {
      throw new Error(
        `Mutation target ${mutation.file} expected one occurrence; found ${occurrences.toString()}`,
      );
    }

    await Deno.writeTextFile(
      path,
      source.replace(mutation.original, mutation.replacement),
    );

    const result = await new Deno.Command(Deno.execPath(), {
      args: ["test", ...mutation.tests],
      cwd: workspace,
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (result.success) {
      throw new Error(
        `Tests did not kill mutation in ${mutation.file}: ${mutation.replacement}`,
      );
    }
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
}

async function copy_tree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });

  for await (const entry of Deno.readDir(source)) {
    const from = source + "/" + entry.name;
    const to = destination + "/" + entry.name;

    if (entry.isDirectory) {
      await copy_tree(from, to);
      continue;
    }

    if (entry.isFile) {
      await Deno.copyFile(from, to);
    }
  }
}

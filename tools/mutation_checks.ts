type Mutation = {
  readonly name: string;
  readonly file: string;
  readonly original: string;
  readonly replacement: string;
  readonly test: string;
  readonly expected_test: string;
  readonly permissions?: readonly string[];
};

const mutations: readonly Mutation[] = [
  {
    name: "pure Task direct cancellation",
    file: "src/task.ts",
    original:
      "if (signal?.aborted) {\n      return Promise.reject(task_abort_error(operation, signal));\n    }\n    return Promise.resolve(resolved);",
    replacement: "return Promise.resolve(resolved);",
    test: "src/task_runtime.test.ts",
    expected_test:
      "built-in pure Tasks respect cancellation during direct execution",
  },
  {
    name: "tagged constructor arity",
    file: "src/typeclass.ts",
    original: "if (tagged.length !== expected_length) {",
    replacement:
      "if (tagged.length !== expected_length && tagged.length < 0) {",
    test: "src/api_soundness.test.ts",
    expected_test: "tagged dictionaries reject malformed raw values",
  },
  {
    name: "TSX parser selection",
    file: "tools/transform_do_program.ts",
    original: '.toLowerCase().endsWith(".tsx")',
    replacement: '.toLowerCase().endsWith(".tsz")',
    test: "tools/transform_do_program_checks.ts",
    expected_test: "transformer parses and lowers Do expressions inside TSX",
    permissions: ["--allow-env", "--allow-read", "--allow-ffi"],
  },
];

/** Read the selected JUnit case; module/type/permission errors are not kills. */
export function selected_test_result(
  xml: string,
  name: string,
): { passed: boolean; assertion_failed: boolean; evidence: string } {
  const decode = (value: string) =>
    value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll(
      "&lt;",
      "<",
    ).replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  for (
    const match of xml.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)
  ) {
    const actual = match[1].match(/\bname="([^"]*)"/);
    if (actual === null || decode(actual[1]) !== name) continue;
    const body = decode(match[2]);
    const failed = body.includes("<failure");
    const error = body.includes("<error");
    const skipped = body.includes("<skipped");
    return {
      passed: !failed && !error && !skipped,
      assertion_failed: failed && !error &&
        /assert_equals|assert_true|assert\.ts/.test(body),
      evidence: body.trim(),
    };
  }
  throw new Error(`expected test did not execute: ${name}`);
}

async function copy_tree(source: string, destination: string): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  for await (const entry of Deno.readDir(source)) {
    const from = source + "/" + entry.name;
    const to = destination + "/" + entry.name;
    if (entry.isDirectory) await copy_tree(from, to);
    else if (entry.isFile) await Deno.copyFile(from, to);
  }
}

if (import.meta.main) {
  const workspace = await Deno.makeTempDir({ prefix: "typeclasses-mutant-" });
  const records: unknown[] = [];
  try {
    await copy_tree("src", workspace + "/src");
    await copy_tree("tools", workspace + "/tools");
    await copy_tree("bench/experiments", workspace + "/bench/experiments");
    await Deno.copyFile("deno.json", workspace + "/deno.json");
    await Deno.copyFile("deno.lock", workspace + "/deno.lock");
    const execute = async (args: string[]) => {
      const result = await new Deno.Command(Deno.execPath(), {
        args,
        cwd: workspace,
        stdout: "piped",
        stderr: "piped",
      }).output();
      return {
        command: args,
        code: result.code,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
      };
    };
    for (const mutation of mutations) {
      const path = workspace + "/" + mutation.file;
      const source = await Deno.readTextFile(path);
      const occurrences = source.split(mutation.original).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `stale mutation ${mutation.name}: expected one anchor, found ${occurrences}`,
        );
      }
      const test_args = [
        "test",
        "--no-check",
        "--reporter=junit",
        ...(mutation.permissions ?? []),
        "--filter",
        mutation.expected_test,
        mutation.test,
      ];
      const baseline_check = await execute(["check", mutation.test]);
      if (baseline_check.code !== 0) {
        throw new Error(
          `baseline does not compile for ${mutation.name}: ${baseline_check.stderr}`,
        );
      }
      const baseline = await execute(test_args);
      const baseline_case = selected_test_result(
        baseline.stdout,
        mutation.expected_test,
      );
      if (baseline.code !== 0 || !baseline_case.passed) {
        throw new Error(
          `baseline did not pass ${mutation.expected_test}: ${baseline.stdout}\n${baseline.stderr}`,
        );
      }
      try {
        await Deno.writeTextFile(
          path,
          source.replace(mutation.original, mutation.replacement),
        );
        const mutant_check = await execute(["check", mutation.test]);
        if (mutant_check.code !== 0) {
          throw new Error(
            `invalid mutant ${mutation.name}; compilation failure is not a kill: ${mutant_check.stderr}`,
          );
        }
        const mutant = await execute(test_args);
        const observed = selected_test_result(
          mutant.stdout,
          mutation.expected_test,
        );
        if (mutant.code === 0 || !observed.assertion_failed) {
          throw new Error(
            `mutation ${mutation.name} was not killed by the intended assertion: ${mutant.stdout}\n${mutant.stderr}`,
          );
        }
        records.push({
          name: mutation.name,
          file: mutation.file,
          test: mutation.test,
          expected_test: mutation.expected_test,
          baseline_check,
          baseline,
          mutant_check,
          mutant,
          assertion_evidence: observed.evidence,
        });
        console.log(
          JSON.stringify({
            mutation: mutation.name,
            killed_by: mutation.expected_test,
            baseline: "passed",
            mutant_compile: "passed",
            outcome: "assertion failure",
          }),
        );
      } finally {
        await Deno.writeTextFile(path, source);
      }
    }
    if (Deno.args[0] !== undefined) {
      await Deno.writeTextFile(
        Deno.args[0],
        JSON.stringify({ runtime: Deno.version, records }, null, 2) + "\n",
      );
    }
  } finally {
    await Deno.remove(workspace, { recursive: true });
  }
}

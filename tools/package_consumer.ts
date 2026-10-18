import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Match the repository's publish include/exclude glob vocabulary. */
export function publish_matches(path: string, pattern: string): boolean {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
  }
  return new RegExp(expression + "$").test(path);
}

type Manifest = {
  readonly name: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, string>>;
  readonly imports?: Readonly<Record<string, string>>;
  readonly publish?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
  };
};

/** Stage only publish-selected files and check every package export in a new consumer. */
export async function check_package_consumer(
  root: string,
  destination?: string,
) {
  root = resolve(root);
  const manifest = JSON.parse(
    await Deno.readTextFile(resolve(root, "deno.json")),
  ) as Manifest;
  if (!manifest.name || !manifest.exports || !manifest.publish?.include) {
    throw new Error("name, exports and explicit publish.include are required");
  }
  const scratch = await Deno.makeTempDir({ prefix: "typeclasses-consumer-" });
  try {
    const stage = resolve(scratch, "package");
    const consumer = resolve(scratch, "consumer");
    await Deno.mkdir(consumer, { recursive: true });
    const included: string[] = [];
    const copy = async (directory: string): Promise<void> => {
      for await (const entry of Deno.readDir(directory)) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const source = resolve(directory, entry.name);
        const name = relative(root, source).split(sep).join("/");
        if (entry.isDirectory) {
          await copy(source);
          continue;
        }
        if (!entry.isFile) continue;
        if (
          !manifest.publish!.include!.some((pattern) =>
            publish_matches(name, pattern)
          )
        ) continue;
        if (
          manifest.publish?.exclude?.some((pattern) =>
            publish_matches(name, pattern)
          )
        ) continue;
        const target = resolve(stage, name);
        await Deno.mkdir(dirname(target), { recursive: true });
        await Deno.copyFile(source, target);
        included.push(name);
      }
    };
    await copy(root);
    included.sort();
    const imports: Record<string, string> = {};
    const import_lines: string[] = [];
    const checks: string[] = [];
    const exports = Object.entries(manifest.exports);
    for (const [index, [subpath, target]] of exports.entries()) {
      const filename = resolve(stage, target);
      if (
        !filename.startsWith(stage + sep) ||
        !included.includes(relative(stage, filename).split(sep).join("/"))
      ) {
        throw new Error(
          `export ${subpath} is absent from the staged publish files: ${target}`,
        );
      }
      let specifier = manifest.name;
      if (subpath !== ".") specifier += subpath.slice(1);
      imports[specifier] = pathToFileURL(filename).href;
      import_lines.push(
        `import * as entry_${index} from ${JSON.stringify(specifier)};`,
      );
      checks.push(
        `if (Object.keys(entry_${index}).length === 0) throw new Error(${
          JSON.stringify("empty runtime export: " + subpath)
        });`,
      );
    }
    const scopes: Record<string, Record<string, string>> = {};
    const dependencies: Record<string, string> = {};
    for (const [specifier, target] of Object.entries(manifest.imports ?? {})) {
      if (target.startsWith(".")) {
        dependencies[specifier] =
          new URL(target, pathToFileURL(stage + sep)).href;
      } else dependencies[specifier] = target;
    }
    scopes[pathToFileURL(stage + sep).href] = dependencies;
    const config = resolve(consumer, "deno.json");
    await Deno.writeTextFile(
      config,
      JSON.stringify(
        {
          imports,
          scopes,
          lock: false,
          nodeModulesDir: "none",
          compilerOptions: { strict: true },
        },
        null,
        2,
      ),
    );
    const smoke = resolve(consumer, "main.ts");
    await Deno.writeTextFile(
      smoke,
      [
        ...import_lines,
        ...checks,
        `console.log(${
          JSON.stringify("checked " + exports.length + " exports")
        });`,
      ].join("\n"),
    );
    const commands: {
      command: string[];
      code: number;
      stdout: string;
      stderr: string;
    }[] = [];
    const run = async (
      args: string[],
      expected_success: boolean,
    ): Promise<void> => {
      const result = await new Deno.Command(Deno.execPath(), {
        args,
        cwd: consumer,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const observation = {
        command: [Deno.execPath(), ...args],
        code: result.code,
        stdout: new TextDecoder().decode(result.stdout),
        stderr: new TextDecoder().decode(result.stderr),
      };
      commands.push(observation);
      if (result.success !== expected_success) {
        throw new Error(
          `fresh consumer command failed expectation: ${
            JSON.stringify(observation)
          }`,
        );
      }
    };
    await run(["check", "--config", config, smoke], true);
    // Oxc's native loader also reads platform metadata before loading its addon.
    await run(
      [
        "run",
        "--allow-env",
        "--allow-read",
        "--allow-ffi",
        "--config",
        config,
        smoke,
      ],
      true,
    );
    const private_import = resolve(consumer, "private.ts");
    await Deno.writeTextFile(
      private_import,
      `import ${JSON.stringify(manifest.name + "/src/internal.ts")};\n`,
    );
    await run(["check", "--config", config, private_import], false);
    const hashes: Record<string, string> = {};
    for (const name of included) {
      const bytes = await Deno.readFile(resolve(stage, name));
      hashes[name] = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    }
    const report = {
      name: manifest.name,
      version: manifest.version,
      runtime: Deno.version,
      coverage:
        "publish-selected local source files, all declared exports, fresh consumer config with package-scoped dependency imports, runtime imports and type checking, rejected unexported deep import",
      artifact:
        "local staged directory; no actual npm tarball or JSR registry artifact was produced or installed",
      files: included,
      source_hashes: hashes,
      exports: manifest.exports,
      commands,
    };
    if (destination !== undefined) {
      await Deno.writeTextFile(
        destination,
        JSON.stringify(report, null, 2) + "\n",
      );
    }
    return report;
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}

if (import.meta.main) {
  const report = await check_package_consumer(
    Deno.args[0] ?? new URL("../", import.meta.url).pathname,
    Deno.args[1],
  );
  console.log(
    JSON.stringify({
      name: report.name,
      version: report.version,
      files: report.files.length,
      exports: Object.keys(report.exports).length,
      coverage: report.coverage,
      artifact: report.artifact,
    }),
  );
}

import ts from "typescript";
import parser from "oxc-parser/package.json" with { type: "json" };
import transformer from "oxc-transform/package.json" with { type: "json" };

const versions = JSON.parse(await Deno.readTextFile("toolchains.json"));
const actual: Record<string, string> = {
  deno: Deno.version.deno,
  deno_typescript: Deno.version.typescript,
  typescript: ts.version,
  oxc_parser: parser.version,
  oxc_transform: transformer.version,
  esrap: JSON.parse(
    await Deno.readTextFile(
      new URL("../package.json", import.meta.resolve("esrap")),
    ),
  ).version,
};
for (const command of ["node", "bun"]) {
  const result = await new Deno.Command(command, {
    args: ["--version"],
    stdout: "piped",
  }).output();
  if (!result.success) throw new Error(command + " --version failed");
  actual[command] = new TextDecoder().decode(result.stdout).trim().replace(
    /^v/,
    "",
  );
}
for (const [tool, expected] of Object.entries(versions)) {
  if (actual[tool] !== expected) {
    throw new Error(`${tool}: expected ${expected}, found ${actual[tool]}`);
  }
}
console.log(JSON.stringify(actual));

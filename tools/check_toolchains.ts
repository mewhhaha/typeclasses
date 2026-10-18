import ts from "typescript";

const versions = JSON.parse(await Deno.readTextFile("toolchains.json"));
const actual: Record<string, string> = {
  deno: Deno.version.deno,
  deno_typescript: Deno.version.typescript,
  typescript: ts.version,
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

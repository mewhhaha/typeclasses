const baseline = JSON.parse(await Deno.readTextFile("bench/budgets.json"));
async function report(tool: string, permissions: string[]) {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", ...permissions, tool],
    stdout: "piped",
    stderr: "inherit",
  }).output();
  if (!output.success) throw new Error(tool + " failed");
  return JSON.parse(new TextDecoder().decode(output.stdout));
}
const types = await report("tools/type_budget.ts", [
  "--allow-read",
  "--allow-env",
]);
const imports = await report("tools/import_budget.ts", [
  "--allow-read",
  "--allow-env",
  "--allow-run",
]);
const values: Record<string, number> = { instantiations: types.instantiations };
for (const [name, size] of Object.entries(imports.bundles)) {
  values[name] = (size as { bytes: number }).bytes;
}
for (const [name, expected] of Object.entries(baseline.values)) {
  const actual = values[name];
  if (
    actual === undefined ||
    actual > (expected as number) * (1 + baseline.tolerance)
  ) {
    throw new Error(
      `${name}: ${actual} exceeds reviewed baseline ${expected} + ${
        baseline.tolerance * 100
      }%`,
    );
  }
}
if (types.compiler !== baseline.compiler) {
  throw new Error("Compiler changed; review the type budget baseline");
}
console.log(JSON.stringify({ compiler: types.compiler, values }, null, 2));

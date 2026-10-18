import { source_transform_cases } from "./source_transform_cases.ts";
import * as current from "../tools/transform_do_program.ts";

// Run serially with the pinned baseline checkout supplied by the measurement log.
// TYPECLASSES_TRANSFORM_BASELINE=/path deno bench --allow-env --allow-read this.ts
const baseline_path = Deno.env.get("TYPECLASSES_TRANSFORM_BASELINE");
const versions: [string, typeof current][] = [["current", current]];
if (baseline_path !== undefined) {
  versions.unshift([
    "baseline",
    await import(
      new URL("tools/transform_do_program.ts", "file://" + baseline_path + "/")
        .href
    ),
  ]);
}
let _sink = 0;
for (const [version, module] of versions) {
  for (const [name, source] of Object.entries(source_transform_cases)) {
    Deno.bench(`${version}/${name}`, () => {
      _sink =
        module.transform_do_program_source(source, "fixture.ts").code.length;
    });
  }
  const cache = module.create_transform_cache();
  const source = source_transform_cases["100 yields"];
  cache.transform(source, "fixture.ts");
  Deno.bench(`${version}/100 yields cached`, () => {
    _sink = cache.transform(source, "fixture.ts").code.length;
  });
  const no_target = "// Document\n" + "const x = 1;\n".repeat(10000);
  const disabled = module.create_transform_cache(0);
  Deno.bench(`${version}/large no-op cache disabled`, () => {
    _sink = disabled.transform(no_target).code.length;
  });
}

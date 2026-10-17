import { source_transform_cases } from "./source_transform_cases.ts";

// Point this runner at another checkout to compare identical literal inputs.
let root = new URL("../", import.meta.url);
const configured = Deno.env.get("TYPECLASSES_BENCH_ROOT");
if (configured !== undefined) {
  root = new URL(
    configured.replace(/\/$/, "") + "/",
    "file://" + Deno.cwd() + "/",
  );
}
const transformer = await import(
  new URL("tools/transform_do_program.ts", root).href
);
let _sink = 0;
for (const [name, source] of Object.entries(source_transform_cases)) {
  Deno.bench(name, () => {
    _sink =
      transformer.transform_do_program_source(source, "fixture.ts").code.length;
  });
}
if (typeof transformer.create_transform_cache === "function") {
  const cache = transformer.create_transform_cache();
  const source = source_transform_cases["100 yields"];
  cache.transform(source, "fixture.ts");
  Deno.bench("100 yields cached", () => {
    _sink = cache.transform(source, "fixture.ts").code.length;
  });
}

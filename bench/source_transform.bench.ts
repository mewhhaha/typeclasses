import { source_transform_cases } from "./source_transform_cases.ts";
import {
  create_transform_cache,
  transform_do_program_source,
} from "../tools/transform_do_program.ts";

const no_target_source = await Deno.readTextFile(
  new URL(
    "../case_studies/programming_language_parser/parser.ts",
    import.meta.url,
  ),
);
const do_heavy_source = await Deno.readTextFile(
  new URL(
    "../case_studies/programming_language_parser/language.ts",
    import.meta.url,
  ),
);
const effect_heavy_source = await Deno.readTextFile(
  new URL("../case_studies/io_application/filesystem.ts", import.meta.url),
);
const long_do_source = create_long_do_source(100);
const cache = create_transform_cache();
cache.transform(source_transform_cases["100 yields"], "fixture.ts");

let _sink = 0;

Deno.bench("source transform/no target", () => {
  consume(transform_do_program_source(no_target_source, "parser.ts"));
});

Deno.bench("source transform/Do-heavy", () => {
  consume(transform_do_program_source(do_heavy_source, "language.ts"));
});

Deno.bench("source transform/Effect-heavy without rewrites", () => {
  consume(transform_do_program_source(effect_heavy_source, "filesystem.ts"));
});

Deno.bench("source transform/100 straight-line yields", () => {
  consume(transform_do_program_source(long_do_source, "long_do.ts"));
});

Deno.bench("source transform/100 const yields cached", () => {
  consume(cache.transform(source_transform_cases["100 yields"], "fixture.ts"));
});

for (const [name, source] of Object.entries(source_transform_cases)) {
  Deno.bench("source transform/fixed/" + name, () => {
    consume(transform_do_program_source(source, "fixture.ts"));
  });
}

function create_long_do_source(yields: number): string {
  const statements = ["let value = 0;"];

  for (let index = 0; index < yields; index += 1) {
    statements.push("value = yield* Just(value + 1);");
  }

  statements.push("return value;");

  return `
import { Do } from "../src/typeclasses.ts";
import { Just } from "../src/maybe.ts";

const result = Do(function* () {
  ${statements.join("\n  ")}
});
`;
}

function consume(result: ReturnType<typeof transform_do_program_source>) {
  _sink = result.code.length + result.diagnostics.length + result.transformed;
}

import ts from "typescript";
import { transform_do_program_source } from "../../tools/transform_do_program.ts";
import {
  dependent_source,
  lowered_fixture,
} from "../../tools/round3_transform_checks.ts";
import { flatten_numeric_do } from "./round3_transform_flat.ts";
import { print_changed_statements } from "./round3_transform_print.ts";

// The printer and numeric-frame rows retain their historical TypeScript AST
// prototypes; candidate/* and flat/production-preserve use the current backend.
const results: Record<
  string,
  { median_ms: number; samples_ms: number[]; iterations: number }
> = {};
let sink: unknown;
function measure(name: string, fn: () => unknown, iterations: number) {
  for (let index = 0; index < 5; index += 1) sink = fn();
  const samples_ms: number[] = [];
  for (let sample = 0; sample < 7; sample += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) sink = fn();
    samples_ms.push((performance.now() - start) / iterations);
  }
  results[name] = {
    median_ms: samples_ms.toSorted((a, b) => a - b)[3],
    samples_ms,
    iterations,
  };
}
const unused = `import{Do}from'../src/typeclasses.ts';\n` +
  Array.from(
    { length: 5000 },
    (_, index) => `function f${index}(a:number){return Math.sqrt(a+${index});}`,
  ).join("\n");
measure(
  "candidate/full-visitor-unused5000",
  () =>
    transform_do_program_source(unused, "unused.ts", {
      optimizations: { candidate_scan: false },
    }),
  10,
);
measure(
  "candidate/index-unused5000",
  () => transform_do_program_source(unused, "unused.ts"),
  10,
);
const used = dependent_source(8);
measure(
  "candidate/full-visitor-used8",
  () =>
    transform_do_program_source(used, "used.ts", {
      optimizations: { candidate_scan: false },
    }),
  100,
);
measure(
  "candidate/index-used8",
  () => transform_do_program_source(used, "used.ts"),
  100,
);
const source =
  `import{Do}from'../src/typeclasses.ts';import{Just}from'../src/maybe.ts';\n` +
  Array.from(
    { length: 5000 },
    (_, index) =>
      `function f${index}( a:number ){  return a+${index} } // keep${index}`,
  )
    .join("\n") +
  `\nconst result=Do(function*(){const n=yield*Just(1);return n+1;});export default result.value();`;
const file = ts.createSourceFile(
  "print.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const transformed = lowered_fixture(file);
let preserved: string | undefined;
try {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  measure(
    "print/full-file5000",
    () => printer.printFile(transformed.transformed[0]),
    20,
  );
  measure(
    "print/changed-statement5000",
    () => print_changed_statements(file, transformed.transformed[0], source),
    20,
  );
  const encoder = new TextEncoder();
  measure(
    "print/full-file5000-encoded",
    () => encoder.encode(printer.printFile(transformed.transformed[0])),
    5,
  );
  measure(
    "print/changed-statement5000-encoded",
    () =>
      encoder.encode(
        print_changed_statements(file, transformed.transformed[0], source)!,
      ),
    5,
  );
  preserved = print_changed_statements(
    file,
    transformed.transformed[0],
    source,
  );
} finally {
  transformed.dispose();
}
async function runnable(input: string): Promise<() => unknown> {
  const absolute = input.replaceAll(
    /\.\.\/src\/([a-z_]+)\.ts/g,
    (_match, name: string) =>
      new URL(`../../src/${name}.ts`, import.meta.url).href,
  );
  const compiled = ts.transpileModule(absolute, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return (await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  )).default;
}
const probes: Record<string, unknown> = {};
for (const count of [300, 1024]) {
  const source = dependent_source(count).replace(
    "const result=",
    "export default()=>{const result=",
  ).replace("export default result.value();", "return result.value();};");
  measure(`flat/analyze-emit${count}`, () => flatten_numeric_do(source), 10);
  measure(
    `flat/production-preserve${count}`,
    () => transform_do_program_source(source, "flat.ts", { source_map: false }),
    10,
  );
  const result = flatten_numeric_do(source);
  const original = await runnable(source);
  const flat = await runnable(result.code);
  measure(`flat/original-run${count}`, original, 5);
  measure(`flat/generated-run${count}`, flat, 100);
  probes[String(count)] = {
    source_bytes: source.length,
    generated_bytes: result.code.length,
    max_live: result.max_live,
    original: original(),
    generated: flat(),
  };
}
const fingerprints: Record<string, string> = {};
for (
  const name of [
    "../../tools/transform_do_program.ts",
    "../../tools/transform_bindings.ts",
    "./round3_transform_flat.ts",
    "./legacy_bindings.ts",
    "./round3_transform_print.ts",
    "./round3_transform_measure.ts",
    "../../tools/round3_transform_checks.ts",
  ]
) {
  const url = new URL(name, import.meta.url);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await Deno.readFile(url),
  );
  fingerprints[name] = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
const artifact = {
  date: new Date().toISOString(),
  deno: Deno.version,
  workload:
    "7 samples;5 warmups;per-row iterations;5000 unrelated statements;typed numeric dependency chains",
  backends: {
    production: "Oxc ESTree",
    printer_prototype: "historical TypeScript AST",
    numeric_frame_prototype: "historical TypeScript AST",
  },
  fingerprints,
  results,
  probes,
  printer: {
    source_bytes: source.length,
    preserved_bytes: preserved?.length,
    unchanged_function_preserved: preserved?.includes(
      "function f4999( a:number ){  return a+4999 } // keep4999",
    ),
  },
};
await Deno.writeTextFile(
  Deno.args[0],
  JSON.stringify(artifact, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    results: Object.fromEntries(
      Object.entries(results).map(([key, value]) => [key, value.median_ms]),
    ),
    probes,
  }),
);
void sink;

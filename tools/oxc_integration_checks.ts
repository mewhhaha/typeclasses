import { SourceMap } from "node:module";
import { assert_equals, assert_true } from "../src/assert.ts";
import {
  create_transform_cache,
  transform_do_program_source,
} from "./transform_do_program.ts";

Deno.test("Oxc preserves comments and UTF-16 source locations across mapped and unmapped output", () => {
  const source = `import { Do } from "../src/typeclasses.ts";
import { Just } from "../src/maybe.ts";
// keep this heading 😀
const emoji = "😀"; const program = Do(function* () {
  /* keep this block 🧪 */
  const item = yield* Just(1);
  return item + (() => { throw new Error("location-marker"); })();
});
// keep this footer
`;
  const mapped = transform_do_program_source(source, "unicode.ts");
  const plain = transform_do_program_source(source, "unicode.ts", {
    source_map: false,
  });
  assert_equals(mapped.transformed, 1);
  assert_equals(mapped.diagnostics, []);
  assert_equals(plain.code, mapped.code);
  assert_equals(plain.map, null);
  for (
    const comment of [
      "keep this heading 😀",
      "keep this block 🧪",
      "keep this footer",
    ]
  ) {
    assert_equals(mapped.code.split(comment).length, 2);
  }
  assert_true(mapped.map !== null, "mapped output exists");
  if (mapped.map === null) return;
  const output_lines = mapped.code.split("\n");
  const line = output_lines.findIndex((value) =>
    value.includes('"location-marker"')
  );
  const column = output_lines[line].indexOf('"location-marker"');
  const original_lines = source.split("\n");
  const original_line = original_lines.findIndex((value) =>
    value.includes('"location-marker"')
  );
  const original_column = original_lines[original_line].indexOf(
    '"location-marker"',
  );
  const entry = new SourceMap({
    ...mapped.map,
    sources: [...mapped.map.sources],
    names: [...mapped.map.names],
    sourcesContent: [source],
  }).findEntry(line, column);
  if (!("originalLine" in entry)) throw new Error("Missing original mapping");
  assert_equals(entry.originalLine, original_line);
  assert_equals(entry.originalColumn, original_column);
});

Deno.test("Oxc preserves malformed sources with parse diagnostics", () => {
  const source =
    'import { Do } from "../src/typeclasses.ts"; const value = Do(function*(){ const = yield* Just(1); });';
  const result = transform_do_program_source(source, "broken.ts");
  assert_equals(result.code, source);
  assert_equals(result.transformed, 0);
  assert_equals(result.map, null);
  assert_true(result.diagnostics.length > 0, "parse errors are reported");
  assert_true(
    result.diagnostics.every((item) => item.message.startsWith("Parse error:")),
    "native errors are identified",
  );
});

Deno.test("Oxc maps every ECMAScript line terminator and reports original error lines", () => {
  const lines = [
    'import { Do } from "../src/typeclasses.ts";',
    'import { Just } from "../src/maybe.ts";',
    "// line terminator control",
    "const program = Do(function* () {",
    "  const item = yield* Just(1);",
    '  return item + (() => { throw new Error("line-marker"); })();',
    "});",
  ];
  for (const separator of ["\r", "\r\n", "\u2028", "\u2029"]) {
    const result = transform_do_program_source(
      lines.join(separator),
      "lines.ts",
    );
    assert_equals(result.transformed, 1);
    assert_equals(result.diagnostics, []);
    if (result.map === null) throw new Error("Missing source map");
    const output = result.code.split("\n");
    const line = output.findIndex((value) => value.includes('"line-marker"'));
    const column = output[line].indexOf('"line-marker"');
    const entry = new SourceMap({
      ...result.map,
      sources: [...result.map.sources],
      names: [...result.map.names],
      sourcesContent: [lines.join(separator)],
    }).findEntry(line, column);
    if (!("originalLine" in entry)) throw new Error("Missing original mapping");
    assert_equals(entry.originalLine, 5);
    assert_equals(entry.originalColumn, lines[5].indexOf('"line-marker"'));
    const broken = transform_do_program_source(
      lines.slice(0, 3).join(separator) + separator +
        "const program = Do(function* () { const x = ; });",
      "broken-lines.ts",
    );
    assert_true(broken.diagnostics.length > 0, "parse diagnostic exists");
    assert_equals(broken.diagnostics[0].line, 4);
  }
});

Deno.test("surgical splice preserves untouched formatting and stitches accurate source maps after edits", () => {
  const source = [
    'import { Do } from "../src/typeclasses.ts";',
    'import { Just } from "../src/maybe.ts";',
    "",
    "// untouched leading block with custom spacing",
    "export function before(x:   number): number { return x * 2; }",
    "",
    "const total = Do(function* () {",
    "  const a = yield* Just(10);",
    "  const b = yield* Just(32);",
    "  return a + b;",
    "}) /* trailing inline comment */;",
    "",
    "export function after(y: number): number {",
    '  if (y < 0) throw new Error("after-marker");',
    "  return before(y) + 1;",
    "}",
  ].join("\n");
  const mapped = transform_do_program_source(source, "splice.ts");
  const plain = transform_do_program_source(source, "splice.ts", {
    source_map: false,
  });
  assert_equals(mapped.transformed, 1);
  assert_equals(mapped.diagnostics, []);
  assert_equals(plain.code, mapped.code);
  assert_equals(plain.map, null);
  assert_true(
    mapped.code.includes(
      "export function before(x:   number): number { return x * 2; }",
    ),
    "untouched leading function formatting must stay verbatim",
  );
  assert_true(
    mapped.code.includes("/* trailing inline comment */;"),
    "same-line trailing content after replaced expression must stay verbatim",
  );
  if (mapped.map === null) throw new Error("Missing spliced source map");
  const map = new SourceMap({
    ...mapped.map,
    sources: [...mapped.map.sources],
    names: [...mapped.map.names],
    sourcesContent: [source],
  });
  const out_lines = mapped.code.split("\n");
  const orig_lines = source.split("\n");
  for (
    const marker of [
      "export function before(",
      "export function after(",
      'if (y < 0) throw new Error("after-marker");',
    ]
  ) {
    const gen_line = out_lines.findIndex((line) => line.includes(marker));
    const orig_line = orig_lines.findIndex((line) => line.includes(marker));
    assert_true(gen_line >= 0 && orig_line >= 0, "expected marker " + marker);
    const entry = map.findEntry(gen_line, out_lines[gen_line].indexOf(marker));
    if (!("originalLine" in entry)) {
      throw new Error("Missing mapping for " + marker);
    }
    assert_equals(entry.originalLine, orig_line);
  }
});

Deno.test("top-level span skipping still detects distant shadows and avoids fresh-name collisions", () => {
  const filler = Array.from(
    { length: 20 },
    (_, index) =>
      `export function filler_${index}(n: number) { return n + ${index}; }`,
  ).join("\n");
  const shadowed = [
    'import { Do } from "../src/typeclasses.ts";',
    'import { Just } from "../src/maybe.ts";',
    "const p = Do(function* () { const a = yield* Just(1); return a + 1; });",
    filler,
    "function distant_shadow() { const Do = 1; return Do; }",
  ].join("\n");
  const shadowed_result = transform_do_program_source(shadowed, "shadow.ts");
  assert_equals(shadowed_result.transformed, 0);

  const collision = [
    'import { Do } from "../src/typeclasses.ts";',
    'import { Just } from "../src/maybe.ts";',
    "const p = Do(function* () { const a = yield* Just(1); const b = yield* Just(a); return b + 1; });",
    filler,
    "export function context_1() { return 0; }",
  ].join("\n");
  const collision_result = transform_do_program_source(
    collision,
    "collision.ts",
  );
  assert_equals(collision_result.transformed, 1);
  assert_equals(
    collision_result.code.match(/\bcontext_1\b/g)?.length,
    1,
    "fresh identifier must not collide with skipped function name",
  );
});

Deno.test("transform cache isolates configs on shared source and preserves LRU eviction", () => {
  const cache = create_transform_cache(2);
  const a =
    'import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; export const a = Do(function* () { const n = yield* Just(1); return n; });';
  const b =
    'import { Do } from "../src/typeclasses.ts"; import { Just } from "../src/maybe.ts"; export const b = Do(function* () { const n = yield* Just(2); return n; });';
  const mapped_a = cache.transform(a, "a.ts", { source_map: true });
  const plain_a = cache.transform(a, "a.ts", { source_map: false });
  assert_true(mapped_a.map !== null, "mapped entry keeps map");
  assert_equals(plain_a.map, null);
  assert_equals(cache.stats().size, 2);
  assert_equals(cache.stats().hits, 0);

  // Touch mapped_a so plain_a becomes least-recently used.
  const hit_a = cache.transform(a, "a.ts", { source_map: true });
  assert_true(hit_a.map !== null, "promoted entry hits cache");
  assert_equals(cache.stats().hits, 1);

  // Inserting b should evict plain_a, keeping mapped_a warm.
  cache.transform(b, "b.ts", { source_map: false });
  assert_equals(cache.stats().size, 2);
  cache.transform(a, "a.ts", { source_map: true });
  assert_equals(cache.stats().hits, 2);
});

Deno.test("terminal lift specializes 2-arg keyed run_writer using the cell default empty", () => {
  const source = [
    'import { Program, run } from "../src/effects.ts";',
    'import { run_writer, tell, writer_cell } from "../src/writer.ts";',
    'import { String } from "../src/monoid.ts";',
    'const log = writer_cell("log", () => String.empty());',
    'const effect = Program(function* () { yield* tell(log, "hi"); return 1; });',
    "export const out = run(run_writer(log, effect));",
  ].join("\n");
  const result = transform_do_program_source(source, "keyed_writer.ts");
  assert_equals(result.diagnostics, []);
  assert_true(
    /run_writer_terminal(?:_\d+)?\(log, effect\)/.test(result.code),
    "expected 2-arg keyed run_writer to lift to run_writer_terminal\n\n" +
      result.code,
  );
});

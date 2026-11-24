import { SourceMap } from "node:module";
import { assert_equals, assert_true } from "../src/assert.ts";
import {
  create_transform_cache,
  transform_do_program_source,
} from "./transform_do_program.ts";
import { executable_typescript } from "./transform_execute.ts";

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

Deno.test("direct Maybe Do lowering elides Just, short-circuits Nothing, and respects shadows", async () => {
  const root = new URL("../src/", import.meta.url).href;
  const source = [
    `import { Do } from ${JSON.stringify(root + "typeclasses.ts")};`,
    `import { Just, Maybe, Nothing } from ${
      JSON.stringify(root + "maybe.ts")
    };`,
    "export const hit = Do(Maybe, function* () {",
    "  const a = yield* Just(20);",
    "  const b = yield* (a > 0 ? Just(22) : Nothing<number>());",
    "  return a + b;",
    "}).value();",
    "export const miss = Do(Maybe, function* () {",
    "  const a = yield* Nothing<number>();",
    "  const b = yield* Just(1);",
    "  return a + b;",
    "}).value();",
    "export function returned(v: number) {",
    "  return Do(Maybe, function* () {",
    "    const a = yield* Just(v);",
    "    return a + 2;",
    "  });",
    "}",
  ].join("\n");
  const result = transform_do_program_source(source, "direct_maybe.ts");
  assert_equals(result.diagnostics, []);
  assert_equals(result.transformed, 3);
  assert_true(
    !result.code.includes(".bind(") && !result.code.includes(".map("),
    "expected direct Maybe lowering without bind/map closures\n\n" +
      result.code,
  );
  assert_true(
    result.code.includes("export function returned(v: number) {\n  {\n"),
    "expected return Do(Maybe, ...) to unwrap zero-arg IIFE into lexical block\n\n" +
      result.code,
  );
  const compiled = executable_typescript(result.code, "direct_maybe.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  assert_equals(mod.hit, ["Just", 42]);
  assert_equals(mod.miss, ["Nothing"]);
  assert_equals(mod.returned(40).value(), ["Just", 42]);

  // Shadowed Maybe must stay on dynamic dictionary dispatch.
  const shadowed = [
    'import { Do } from "../src/typeclasses.ts";',
    'import { Just, Maybe } from "../src/maybe.ts";',
    "function inner(Maybe: typeof import('../src/maybe.ts').Maybe) {",
    "  return Do(Maybe, function* () { const a = yield* Just(1); return a + 1; });",
    "}",
  ].join("\n");
  const shadowed_result = transform_do_program_source(
    shadowed,
    "shadowed_maybe.ts",
  );
  assert_equals(shadowed_result.diagnostics, []);
  assert_true(
    shadowed_result.code.includes(".map("),
    "shadowed Maybe must not use direct Maybe lowering\n\n" +
      shadowed_result.code,
  );
});

Deno.test("keyed cell terminal fusion lowers Reader, State, and Writer cells without an Effect spine", async () => {
  const root = new URL("../src/", import.meta.url).href;
  const source = [
    `import { Program, run } from ${JSON.stringify(root + "effects.ts")};`,
    `import { reader, run_reader } from ${JSON.stringify(root + "reader.ts")};`,
    `import { state, run_state } from ${JSON.stringify(root + "state.ts")};`,
    `import { writer_cell, run_writer } from ${
      JSON.stringify(root + "writer.ts")
    };`,
    `import { ArrayT } from ${JSON.stringify(root + "array.ts")};`,
    'const cfg = reader<{ inc: number }>()("cfg");',
    'const cnt = state<number>()("cnt");',
    'const log = writer_cell("log", ArrayT<string>([]));',
    "export const r = run(run_reader(cfg, Program(function* () {",
    "  const a = yield* cfg.ask();",
    "  const b = yield* cfg.asks((c) => c.inc * 2);",
    "  return a.inc + b;",
    "}), { inc: 7 }));",
    "export const s = run(run_state(cnt, Program(function* () {",
    "  const before = yield* cnt.get();",
    "  yield* cnt.modify((n) => n + 5);",
    "  const after = yield* cnt.gets((n) => n * 2);",
    "  return before + after;",
    "}), 3));",
    "export const w = run(run_writer(log, Program(function* () {",
    '  yield* log.tell(ArrayT(["a"]));',
    '  const v = yield* log.write(10, ArrayT(["b"]));',
    "  return v + 1;",
    "})));",
  ].join("\n");
  const result = transform_do_program_source(source, "keyed_fuse.ts");
  assert_equals(result.diagnostics, []);
  assert_equals(result.transformed, 3);
  assert_true(
    !result.code.includes("Effect.bind_from") &&
      !result.code.includes("run_reader_terminal") &&
      !result.code.includes("run_state_terminal") &&
      !result.code.includes("run_writer_terminal"),
    "expected keyed cells to fuse without Effect spine\n\n" + result.code,
  );
  const compiled = executable_typescript(result.code, "keyed_fuse.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  assert_equals(mod.r, 21);
  assert_equals(mod.s, [19, 8]);
  assert_equals([mod.w[0], mod.w[1].value()], [11, ["a", "b"]]);
});

Deno.test("round-2 post-plugin fusion covers control-flow terminals, multi-cell runners, Reader/State Do, and Either Do", async () => {
  const root = new URL("../src/", import.meta.url).href;
  const source = [
    `import { Do } from ${JSON.stringify(root + "typeclasses.ts")};`,
    `import { Either, Left, Right } from ${
      JSON.stringify(root + "either.ts")
    };`,
    `import { Program, run } from ${JSON.stringify(root + "effects.ts")};`,
    `import { ask, asks, Reader, reader, run_reader } from ${
      JSON.stringify(root + "reader.ts")
    };`,
    `import { get, modify, State, state, run_state } from ${
      JSON.stringify(root + "state.ts")
    };`,
    `import { writer_cell } from ${JSON.stringify(root + "writer.ts")};`,
    `import { ArrayT } from ${JSON.stringify(root + "array.ts")};`,
    `import { prepare_cells, run_cells, provide_reader, provide_state, provide_writer } from ${
      JSON.stringify(root + "handlers.ts")
    };`,
    'const cfg = reader<{ step: number }>()("cfg");',
    'const cnt = state<number>()("cnt");',
    'const log = writer_cell("log", ArrayT<number>([]));',
    "export let init_count = 0;",
    "const shared_env = () => { init_count += 1; return { step: 3 }; };",
    "const run3 = prepare_cells({",
    "  cfg: provide_reader(cfg, shared_env()),",
    "  cnt: provide_state(cnt, 0),",
    "  log: provide_writer(log),",
    "});",
    // P1: control-flow terminal with for loop, continue, break, and early return
    "export function loop_state(limit: number) {",
    "  return run(run_state(cnt, Program(function* () {",
    "    for (let i = 0; i < limit; i += 1) {",
    "      if (i % 2 === 0) continue;",
    "      if (i > 7) break;",
    "      yield* cnt.modify((n) => n + i);",
    "    }",
    "    const total = yield* cnt.get();",
    "    if (total > 10) return total * 2;",
    "    return total;",
    "  }), 0));",
    "}",
    // P2: prepare_cells fused call (plus dynamic fallback and once-only init)
    "export function run3_fused() {",
    "  return run3(Program(function* () {",
    "    const c = yield* cfg.ask();",
    "    for (let i = 0; i < 3; i += 1) {",
    "      yield* cnt.modify((n) => n + c.step);",
    "      yield* log.tell(ArrayT([i]));",
    "    }",
    "    return c;",
    "  }));",
    "}",
    "export function run3_dynamic() {",
    "  const eff = cnt.modify((n) => n + 5);",
    "  return run3(Program(function* () { yield* eff; return yield* cnt.get(); }));",
    "}",
    // P2: inline run_cells with duplicate cell key (first wins)
    "export function run_cells_dup() {",
    "  return run_cells(Program(function* () {",
    "    yield* cnt.modify((n) => n + 4);",
    "    return yield* cnt.get();",
    "  }), {",
    "    first: provide_state(cnt, 10),",
    "    second: provide_state(cnt, 99),",
    "  });",
    "}",
    // P2: stacked run_reader + run_state
    "export function stacked(step: number, init: number) {",
    "  return run(run_reader(cfg, run_state(cnt, Program(function* () {",
    "    const c = yield* cfg.ask();",
    "    yield* cnt.modify((n) => n + c.step);",
    "    return yield* cnt.get();",
    "  }), init), { step }));",
    "}",
    // P3: Reader & State Do.run() and reusable Do(Reader, ...)
    "export function reader_do(step: number) {",
    "  return Do(function* () {",
    "    const a = yield* ask<{ step: number }>();",
    "    const b = yield* asks<{ step: number }, number>((x) => x.step * 2);",
    "    return a.step + b;",
    "  }).run({ step });",
    "}",
    "export function state_do(init: number) {",
    "  return Do(function* () {",
    "    const a = yield* get<number>();",
    "    yield* modify((n: number) => n + 5);",
    "    const b = yield* get<number>();",
    "    return a + b;",
    "  }).run(init);",
    "}",
    "export const reusable_reader = Do(Reader, function* () {",
    "  const a = yield* ask<number>();",
    "  return a * 3;",
    "});",
    // P4: direct Either Do lowering with heterogeneous Left union
    'function f_a(n: number): Either<"a", number> { return n > 0 ? Right(n + 1) : Left("a"); }',
    'function f_b(n: number): Either<"b", number> { return n < 10 ? Right(n * 2) : Left("b"); }',
    "export function either_do(n: number) {",
    "  return Do(Either, function* () {",
    "    const x = yield* Right(n);",
    "    const a = yield* f_a(x);",
    "    const b = yield* f_b(a);",
    "    return a + b;",
    "  });",
    "}",
    "export const either_mapped = either_do(2).map((x) => x + 1);",
    // P4: named keyed Program
    "export function named_keyed(step: number) {",
    "  const p = Program(function* () {",
    "    const c = yield* cfg.ask();",
    "    return c.step * 4;",
    "  });",
    "  return run(run_reader(cfg, p, { step }));",
    "}",
  ].join("\n");

  const result = transform_do_program_source(source, "round2_fusion.ts");
  assert_equals(result.diagnostics, []);
  assert_true(
    !result.code.includes("run_state_terminal") &&
      !result.code.includes("run_reader_terminal"),
    "expected control-flow, stacked, and named keyed terminals to fuse\n\n" +
      result.code,
  );
  assert_true(
    !result.code.includes(".bind(") && !result.code.includes("Do("),
    "expected Reader/State/Either Do blocks to fuse without .bind\n\n" +
      result.code,
  );
  assert_true(
    result.code.includes("prepared_cell_0"),
    "expected prepare_cells initializers to hoist once\n\n" + result.code,
  );

  // Strict TypeScript check on generated code!
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round2-check-",
    suffix: ".ts",
  });
  try {
    await Deno.writeTextFile(temp_file, result.code);
    const check = await new Deno.Command(Deno.execPath(), {
      args: ["check", temp_file],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!check.success) {
      throw new Error(
        "Generated TypeScript failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Runtime execution verification!
  const compiled = executable_typescript(result.code, "round2_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  assert_equals(mod.init_count, 1);
  assert_equals(mod.loop_state(10), [32, 16]);
  assert_equals(mod.loop_state(4), [4, 4]);
  const r1 = mod.run3_fused();
  const r2 = mod.run3_fused();
  assert_equals(mod.init_count, 1);
  assert_true(
    r1.result === r2.result,
    "prepare_cells fusion must preserve shared object identity",
  );
  assert_equals(r1.states, { cnt: 9 });
  assert_equals(r1.logs.log.value(), [0, 1, 2]);
  assert_equals(mod.run3_dynamic().states, { cnt: 5 });
  const dup = mod.run_cells_dup();
  assert_equals(dup.result, 14);
  assert_equals(dup.states, { first: 14, second: 99 });
  assert_equals(mod.stacked(4, 10), [14, 14]);
  assert_equals(mod.reader_do(5), 15);
  assert_equals(mod.state_do(10), [25, 15]);
  assert_equals(mod.reusable_reader.run(7), 21);
  assert_equals(mod.either_do(2).value(), ["Right", 9]);
  assert_equals(mod.either_do(0).value(), ["Left", "a"]);
  assert_equals(mod.either_do(10).value(), ["Left", "b"]);
  assert_equals(mod.either_mapped.value(), ["Right", 10]);
  assert_equals(mod.named_keyed(6), 24);

  // T2: source_map: false omits map cleanly
  const unmapped = transform_do_program_source(source, "round2_fusion.ts", {
    source_map: false,
  });
  assert_equals(unmapped.map, null);
  assert_equals(unmapped.code, result.code);
});

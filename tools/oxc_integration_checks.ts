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

Deno.test("round-3 post-plugin fusion covers direct single-shot loops, run_except, handle_operations, expression yields, Writer ArrayT push, and eval/exec_state", async () => {
  const root = new URL("../src/", import.meta.url).href;
  const source = [
    `import { Do } from ${JSON.stringify(root + "typeclasses.ts")};`,
    `import { Maybe, Just, Nothing } from ${
      JSON.stringify(root + "maybe.ts")
    };`,
    `import { Either, Left, Right } from ${
      JSON.stringify(root + "either.ts")
    };`,
    `import { Identity, identity } from ${
      JSON.stringify(root + "identity.ts")
    };`,
    `import { Effect, Program, run } from ${
      JSON.stringify(root + "effects.ts")
    };`,
    `import { ask, run_reader } from ${JSON.stringify(root + "reader.ts")};`,
    `import { eval_state, exec_state, get, modify, put, run_state, State } from ${
      JSON.stringify(root + "state.ts")
    };`,
    `import { run_writer, tell, writer, writer_cell } from ${
      JSON.stringify(root + "writer.ts")
    };`,
    `import { fail, from_either, from_maybe, from_nullable, from_validation, run_except } from ${
      JSON.stringify(root + "except.ts")
    };`,
    `import { type Validation, Valid, InvalidMessages } from ${
      JSON.stringify(root + "validation.ts")
    };`,
    `import { ArrayT } from ${JSON.stringify(root + "array.ts")};`,
    `import { handle_operations, prepare_operations, provide_writer, run_cells } from ${
      JSON.stringify(root + "handlers.ts")
    };`,
    // P1: Direct single-shot loops + mutable locals + expression yields
    "export function maybe_loop(n: number, fail_at: number) {",
    "  return Do(Maybe, function* () {",
    "    let sum = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      const v = yield* (i === fail_at ? Nothing<number>() : Just(i));",
    "      sum += v;",
    "    }",
    "    return sum;",
    "  });",
    "}",
    "export function maybe_expr_yield(flag: boolean) {",
    "  return Do(Maybe, function* () {",
    "    return flag ? (yield* Just(10)) + (yield* Just(5)) : (yield* Just(1));",
    "  });",
    "}",
    'function check_a(n: number): Either<"neg", number> { return n < 0 ? Left("neg") : Right(n + 1); }',
    'function check_b(n: number): Either<"big", number> { return n > 20 ? Left("big") : Right(n * 2); }',
    "export function either_loop(limit: number) {",
    "  return Do(Either, function* () {",
    "    let total = 0;",
    "    for (let i = 0; i < limit; i += 1) {",
    "      if (i % 2 === 0) continue;",
    "      const a = yield* check_a(i);",
    "      total += a + (yield* check_b(a));",
    "    }",
    "    return total;",
    "  });",
    "}",
    "export const either_loop_mapped = either_loop(6).map((x) => x + 1);",
    "export function identity_loop(n: number) {",
    "  return Do(Identity, function* () {",
    "    let acc = 0;",
    "    let i = 0;",
    "    while (i < n) {",
    "      acc += yield* identity(i + 1);",
    "      i += 1;",
    "    }",
    "    return acc;",
    "  });",
    "}",
    // P2: run_except single-layer + stacked with state/reader/writer (both orders!)
    "export let lazy_calls = 0;",
    "export function except_single(x: number | null, m: Maybe<number>, e: Either<string, number>, v: Validation<readonly string[], number>) {",
    "  return run(run_except(Program(function* () {",
    '    const a = yield* from_nullable(x, () => { lazy_calls += 1; return "null" as const; });',
    '    const b = yield* from_maybe(m, () => { lazy_calls += 1; return "nothing" as const; });',
    "    const c = yield* from_either(e);",
    "    const d = yield* from_validation(v);",
    '    if (a + b + c + d < 0) yield* fail<"neg">("neg");',
    "    return a + b + c + d;",
    "  })));",
    "}",
    "export function except_outer_state_inner(stop: number) {",
    "  return run(run_except(run_state(Program(function* () {",
    "    for (let i = 1; i <= 5; i += 1) {",
    "      yield* modify((n: number) => n + i);",
    '      if (i === stop) yield* fail<"stopped">("stopped");',
    "    }",
    "    return yield* get<number>();",
    "  }), 0)));",
    "}",
    "export function state_outer_except_inner(stop: number) {",
    "  return run(run_state(run_except(Program(function* () {",
    "    for (let i = 1; i <= 5; i += 1) {",
    "      yield* modify((n: number) => n + i);",
    '      if (i === stop) yield* fail<"stopped">("stopped");',
    "    }",
    "    return yield* get<number>();",
    "  })), 0));",
    "}",
    "export function writer_outer_except_reader(fail_step: number) {",
    "  return run(run_writer(run_except(run_reader(Program(function* () {",
    "    const mul = yield* ask<number>();",
    "    for (let i = 1; i <= 3; i += 1) {",
    "      yield* tell(ArrayT([`step:${i * mul}`]));",
    '      if (i === fail_step) yield* fail<"halt">("halt");',
    "    }",
    "    return mul * 10;",
    "  }), 2)), ArrayT<string>([])));",
    "}",
    "export function named_except(ok: boolean) {",
    "  const p = Program(function* () {",
    '    const v = yield* from_nullable(ok ? 42 : null, () => "missing" as const);',
    "    return v;",
    "  });",
    "  return run(run_except(p));",
    "}",
    // P3: handle_operations & prepare_operations with pure inlining, hygiene, and dynamic fallback
    'const Step = Effect.operation<number, number>()("step");',
    'const Ping = Effect.operation<number, void>()("ping");',
    'const Dyn = Effect.operation<number, number>()("dyn");',
    "const outer_bias = 100;",
    "export function ops_pure_loop(n: number) {",
    "  return run(handle_operations(Program(function* () {",
    "    let sum = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      sum += yield* Step.send(i);",
    "    }",
    "    sum += yield* Ping.send();",
    "    return sum;",
    "  }), {",
    "    step: ([, x]) => Effect.pure(x * 2),",
    "    ping: () => Effect.pure(5),",
    "  }));",
    "}",
    "export function ops_hygiene() {",
    "  return run(handle_operations(Program(function* () {",
    "    const outer_bias = 999;",
    "    const a = yield* Step.send(1);",
    "    return a + outer_bias;",
    "  }), {",
    "    step: ([, x]) => Effect.pure(x + outer_bias),",
    "  }));",
    "}",
    "let dyn_fn = ([, x]: readonly ['dyn', number]) => Effect.pure(x + 10);",
    "const prepared_ops = prepare_operations({",
    "  step: ([, x]: readonly ['step', number]) => Effect.pure(x * 3),",
    "  dyn: dyn_fn,",
    "});",
    "dyn_fn = ([, x]: readonly ['dyn', number]) => Effect.pure(x + 999);",
    "export function ops_prepared(x: number) {",
    "  return run(prepared_ops(Program(function* () {",
    "    const a = yield* Step.send(x);",
    "    const b = yield* Dyn.send(a);",
    "    return b;",
    "  })));",
    "}",
    "export function ops_stacked_state(n: number) {",
    "  return run(run_state(handle_operations(Program(function* () {",
    "    for (let i = 0; i < n; i += 1) {",
    "      const next = yield* Step.send(yield* get<number>());",
    "      yield* put<number>(next);",
    "    }",
    "    return yield* get<number>();",
    "  }), {",
    "    step: ([, x]) => Effect.pure(x + 2),",
    "  }), 0));",
    "}",
    // P4: expression-level yields, O(N) Writer ArrayT buffer fusion, eval_state & exec_state
    "export function expr_yield_while(limit: number) {",
    "  return run(run_state(Program(function* () {",
    "    while ((yield* get<number>()) < limit) {",
    "      yield* put<number>((yield* get<number>()) + 1);",
    "    }",
    "    return yield* get<number>();",
    "  }), 0));",
    "}",
    "export function expr_yield_binary(env: number, init: number) {",
    "  return run(run_reader(run_state(Program(function* () {",
    "    return (yield* ask<number>()) + (yield* get<number>());",
    "  }), init), env));",
    "}",
    "export function writer_buffer_loop(n: number) {",
    "  return run(run_writer(Program(function* () {",
    "    for (let i = 0; i < n; i += 1) {",
    "      yield* tell(ArrayT([i]));",
    "    }",
    "    return yield* writer(n * 10, ArrayT([999]));",
    "  }), ArrayT<number>([])));",
    "}",
    'const log_cell = writer_cell("log", ArrayT<number>([]));',
    "export function cells_writer_buffer(n: number) {",
    "  return run_cells(Program(function* () {",
    "    for (let i = 0; i < n; i += 1) {",
    "      yield* log_cell.tell(ArrayT([i * 2]));",
    "    }",
    "    return n;",
    "  }), { log: provide_writer(log_cell) });",
    "}",
    "export function eval_state_fused(init: number) {",
    "  return eval_state(Do(State, function* () {",
    "    yield* modify((n: number) => n + 7);",
    "    return (yield* get<number>()) * 2;",
    "  }), init);",
    "}",
    "export function exec_state_fused(init: number) {",
    "  return exec_state(Do(State, function* () {",
    "    yield* modify((n: number) => n + 7);",
    "    return 0;",
    "  }), init);",
    "}",
  ].join("\n");

  const result = transform_do_program_source(source, "round3_fusion.ts");
  assert_equals(result.diagnostics, []);
  assert_true(
    !result.code.includes("function*") &&
      !result.code.includes("Do(") &&
      !result.code.includes("run_except(") &&
      !result.code.includes("eval_state(") &&
      !result.code.includes("exec_state(") &&
      (result.code.match(/handle_operations\(/g) ?? []).length === 1,
    "expected all Round 3 constructs to fuse completely (except hygiene fallback)\n\n" +
      result.code,
  );
  assert_true(
    !result.code.includes("state_ready_") &&
      !result.code.includes("writer_ready_"),
    "expected literal-init loops to eager-init without ready guards\n\n" +
      result.code,
  );
  assert_true(
    result.code.includes(".push(") && !result.code.includes(".concat("),
    "expected Writer ArrayT buffer fusion to use .push() instead of .concat()\n\n" +
      result.code,
  );

  // Strict TypeScript check on generated code!
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round3-check-",
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
  const compiled = executable_typescript(result.code, "round3_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  assert_equals(mod.maybe_loop(5, 0).value(), ["Just", 15]);
  assert_equals(mod.maybe_loop(5, 3).value(), ["Nothing"]);
  assert_equals(mod.maybe_expr_yield(true).value(), ["Just", 15]);
  assert_equals(mod.maybe_expr_yield(false).value(), ["Just", 1]);
  assert_equals(mod.either_loop(6).value(), ["Right", 36]);
  assert_equals(mod.either_loop(25).value(), ["Left", "big"]);
  assert_equals(mod.either_loop_mapped.value(), ["Right", 37]);
  assert_equals(mod.identity_loop(5).value(), 15);

  // P2 checks
  const { Just: J, Nothing: N } = await import("../src/maybe.ts");
  const { Left: L, Right: R } = await import("../src/either.ts");
  const { InvalidMessages: inv, Valid: val } = await import(
    "../src/validation.ts"
  );
  assert_equals(mod.except_single(1, J(2), R(3), val(4)).value(), [
    "Right",
    10,
  ]);
  assert_equals(mod.lazy_calls, 0);
  assert_equals(mod.except_single(null, J(2), R(3), val(4)).value(), [
    "Left",
    "null",
  ]);
  assert_equals(mod.lazy_calls, 1);
  assert_equals(mod.except_single(1, N(), R(3), val(4)).value(), [
    "Left",
    "nothing",
  ]);
  assert_equals(mod.lazy_calls, 2);
  assert_equals(mod.except_single(1, J(2), L("e"), val(4)).value(), [
    "Left",
    "e",
  ]);
  assert_equals(mod.except_single(1, J(2), R(3), inv("v")).value(), [
    "Left",
    ["v"],
  ]);
  assert_equals(mod.except_single(-10, J(2), R(3), val(4)).value(), [
    "Left",
    "neg",
  ]);
  assert_equals(mod.except_outer_state_inner(0).value(), ["Right", [15, 15]]);
  assert_equals(mod.except_outer_state_inner(3).value(), ["Left", "stopped"]);
  const [so_ok, so_state_ok] = mod.state_outer_except_inner(0);
  assert_equals(so_ok.value(), ["Right", 15]);
  assert_equals(so_state_ok, 15);
  const [so_err, so_state_err] = mod.state_outer_except_inner(3);
  assert_equals(so_err.value(), ["Left", "stopped"]);
  assert_equals(so_state_err, 6);
  const [wr_err, wr_log] = mod.writer_outer_except_reader(2);
  assert_equals(wr_err.value(), ["Left", "halt"]);
  assert_equals(wr_log.value(), ["step:2", "step:4"]);
  assert_equals(mod.named_except(true).value(), ["Right", 42]);
  assert_equals(mod.named_except(false).value(), ["Left", "missing"]);

  // P3 checks
  assert_equals(mod.ops_pure_loop(5), 35);
  assert_equals(mod.ops_hygiene(), 1100);
  assert_equals(mod.ops_prepared(4), 22);
  assert_equals(mod.ops_stacked_state(5), [10, 10]);

  // P4 checks
  assert_equals(mod.expr_yield_while(6), [6, 6]);
  assert_equals(mod.expr_yield_binary(10, 7), [17, 7]);
  const [wb_val, wb_log] = mod.writer_buffer_loop(5);
  assert_equals(wb_val, 50);
  assert_equals(wb_log.value(), [0, 1, 2, 3, 4, 999]);
  const cb = mod.cells_writer_buffer(4);
  assert_equals(cb.result, 4);
  assert_equals(cb.logs.log.value(), [0, 2, 4, 6]);
  assert_equals(mod.eval_state_fused(3), 20);
  assert_equals(mod.exec_state_fused(3), 10);

  // T1 safety: named Program referenced by an otherwise-untouched skipped function must NOT be deleted!
  const t1_helpers = Array.from(
    { length: 40 },
    (_, i) => `export function helper_${i}(x: number) { return x + ${i}; }`,
  ).join("\n");
  const t1_source = [
    `import { Program, run } from ${JSON.stringify(root + "effects.ts")};`,
    `import { ask, run_reader } from ${JSON.stringify(root + "reader.ts")};`,
    "const escaped_prog = Program(function* () { return yield* ask<number>(); });",
    "export const fused_val = run(run_reader(escaped_prog, 7));",
    t1_helpers,
    "export function keep_ref() { return escaped_prog; }",
  ].join("\n");
  const t1_result = transform_do_program_source(t1_source, "t1_escape.ts");
  assert_true(
    t1_result.code.includes("const escaped_prog ="),
    "T1 span skipping must retain named Programs referenced by untouched statements\n\n" +
      t1_result.code,
  );
});

Deno.test("round-4 post-plugin fusion covers ArrayT comprehensions, IterableT terminal loops, inferred single-shot Do, collect/lift, handle_cells, and iterable span skipping", async () => {
  const root = new URL("../src/", import.meta.url).href;
  const untouched_tail = Array.from(
    { length: 40 },
    (_, i) =>
      `export function r4_untouched_${i}(x: number) { return x + ${i}; }`,
  ).join("\n");
  const source = [
    `import { Do, Applicative, Foldable, collect } from ${
      JSON.stringify(root + "typeclasses.ts")
    };`,
    `import { ArrayT } from ${JSON.stringify(root + "array.ts")};`,
    `import { Just, Maybe, Nothing } from ${
      JSON.stringify(root + "maybe.ts")
    };`,
    `import { Either, Left, Right } from ${
      JSON.stringify(root + "either.ts")
    };`,
    `import { Identity, identity } from ${
      JSON.stringify(root + "identity.ts")
    };`,
    `import { from_array, from_factory, from_iterable, to_array, compile_fold, filter, take } from ${
      JSON.stringify(root + "iterable.ts")
    };`,
    `import { Program, run } from ${JSON.stringify(root + "effects.ts")};`,
    `import { reader } from ${JSON.stringify(root + "reader.ts")};`,
    `import { state } from ${JSON.stringify(root + "state.ts")};`,
    `import { writer_cell } from ${JSON.stringify(root + "writer.ts")};`,
    `import { fail, run_except } from ${JSON.stringify(root + "except.ts")};`,
    `import { handle_cells, prepare_handle_cells, provide_reader, provide_state, provide_writer } from ${
      JSON.stringify(root + "handlers.ts")
    };`,
    // P1: Direct Do(ArrayT) comprehensions (explicit & inferred, guards, elision)
    "export function array_comp_2d(xs: ArrayT<number>, ys: ArrayT<number>) {",
    "  return Do(ArrayT, function* () {",
    "    const x = yield* xs;",
    "    const y = yield* ys;",
    "    if ((x + y) % 2 !== 0) return yield* ArrayT.empty<number>();",
    "    return x * 10 + y;",
    "  });",
    "}",
    "export function array_comp_3d_inferred() {",
    "  return Do(function* () {",
    "    const a = yield* ArrayT([1, 2]);",
    "    const b = yield* ArrayT([10, 20]);",
    "    if (a === 2 && b === 10) return yield* ArrayT.empty<number>();",
    "    return yield* ArrayT([a + b, a * b]);",
    "  });",
    "}",
    // P2: Full IterableT terminal pipeline fusion
    "export function iter_filter_map_to_array(xs: number[]) {",
    "  return to_array(from_array(xs).filter((x) => x % 2 === 0).map((x) => x * 3 + 1));",
    "}",
    "export function iter_live_growth(xs: number[]) {",
    "  return to_array(from_array(xs).filter((x) => { if (x === 2) xs.push(4); return x % 2 === 0; }).map((x) => x * 10));",
    "}",
    "export function iter_map_filter_take_fold(xs: number[], limit: number) {",
    "  return Foldable.fold(from_array(xs).map((x) => x * 2).filter((x) => x > 4).take(limit), 0, (acc, x) => acc + x);",
    "}",
    "export function iter_mid_take_filter(xs: number[], limit: number) {",
    "  return to_array(filter(take(from_array(xs), limit), (x) => x % 2 === 0));",
    "}",
    "export function iter_snapshot_take_zero(xs: number[]) {",
    "  let reads = 0;",
    "  const out = to_array(from_factory(function* () { reads += 1; yield 1; yield 2; }).map((x) => x + 1).take(0));",
    "  const snap = to_array(from_iterable(xs).map((x) => x + 10).take(2));",
    "  return { reads, out, snap };",
    "}",
    "export function iter_some_closes() {",
    "  let closed = false;",
    "  const hit = Foldable.some(from_factory(function* () { try { yield 1; yield 2; yield 3; } finally { closed = true; } }).map((x) => x * 10), (x) => x === 20);",
    "  return { hit, closed };",
    "}",
    "export function iter_find_typeguard(xs: (string | number)[]) {",
    "  const found: string | undefined = Foldable.find(from_array(xs).filter((x): x is string => typeof x === 'string'), (s) => s.length > 2);",
    "  return found;",
    "}",
    "export function iter_compile_fold_call(xs: number[]) {",
    "  return compile_fold(from_array(xs).filter((x) => x > 0).map((x) => x * 2))(0, (acc, x) => acc + x);",
    "}",
    // P3a: Inferred-dictionary direct single-shot Do loops
    "export function inferred_maybe_loop(n: number, fail_at: number) {",
    "  return Do(function* () {",
    "    let sum = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      const step = yield* (i === fail_at ? Nothing<number>() : Just(i));",
    "      sum += step;",
    "    }",
    "    return sum;",
    "  });",
    "}",
    "export function inferred_either_loop(n: number) {",
    "  return Do(function* () {",
    "    let total = 0;",
    "    const seed = yield* Right<string, number>(1);",
    "    for (let i = seed; i <= n; i += 1) {",
    "      const v = yield* (i > 10 ? Left<string, number>('too-big') : Right<string, number>(i * 2));",
    "      total += v;",
    "    }",
    "    return total;",
    "  });",
    "}",
    "export function inferred_identity_loop(n: number) {",
    "  return Do(function* () {",
    "    let sum = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      sum += yield* identity(i);",
    "    }",
    "    return sum;",
    "  });",
    "}",
    // P3b: Direct collect & Applicative.lift fusion
    "export const collect_eval_log: string[] = [];",
    "function track<T>(label: string, val: T): T { collect_eval_log.push(label); return val; }",
    "export function collect_maybe_tuple(a: Maybe<number>, b: Maybe<string>, c: Maybe<boolean>) {",
    "  return collect(Maybe, [track('a', a), track('b', b), track('c', c)]);",
    "}",
    "export function collect_either_record(a: Either<'e1', number>, b: Either<'e2', string>) {",
    "  const out: Either<'e1' | 'e2', { readonly a: number; readonly b: string }> = collect(Either, { a, b });",
    "  return out;",
    "}",
    "export function collect_inferred_just(x: number) {",
    "  return collect([Just(x), Just(x + 1)]);",
    "}",
    "export function collect_identity_tuple(a: Identity<number>, b: Identity<number>) {",
    "  return collect(Identity, [a, b]);",
    "}",
    "export function lift_just_fused(x: number, y: number) {",
    "  return Applicative.lift((a: number, b: number) => a * b, Just(x), Just(y));",
    "}",
    // P4: handle_cells & prepare_handle_cells fusion
    'const r4_cfg = reader<{ readonly mul: number }>()("r4_cfg");',
    'const r4_cnt = state<number>()("r4_cnt");',
    'const r4_log = writer_cell("r4_log", ArrayT<string>([]));',
    "export function handle_cells_fused(n: number) {",
    "  return run(handle_cells(Program(function* () {",
    "    const { mul } = yield* r4_cfg.ask();",
    "    for (let i = 1; i <= n; i += 1) {",
    "      yield* r4_cnt.modify((c) => c + i * mul);",
    "      yield* r4_log.tell(ArrayT([`i:${i}`]));",
    "    }",
    "    return yield* r4_cnt.get();",
    "  }), {",
    "    cfg: provide_reader(r4_cfg, { mul: 2 }),",
    "    cnt: provide_state(r4_cnt, 0),",
    "    log: provide_writer(r4_log),",
    "  }));",
    "}",
    "export function except_outer_handle_cells_inner(fail_at: number) {",
    "  return run(run_except(handle_cells(Program(function* () {",
    "    for (let i = 1; i <= 5; i += 1) {",
    "      if (i === fail_at) return yield* fail('aborted' as const);",
    "      yield* r4_cnt.modify((c) => c + i);",
    "      yield* r4_log.tell(ArrayT([`step:${i}`]));",
    "    }",
    "    return yield* r4_cnt.get();",
    "  }), {",
    "    cnt: provide_state(r4_cnt, 0),",
    "    log: provide_writer(r4_log),",
    "  })));",
    "}",
    "export function handle_cells_outer_except_inner(fail_at: number) {",
    "  return run(handle_cells(run_except(Program(function* () {",
    "    for (let i = 1; i <= 5; i += 1) {",
    "      if (i === fail_at) return yield* fail('stopped' as const);",
    "      yield* r4_cnt.modify((c) => c + i);",
    "      yield* r4_log.tell(ArrayT([`keep:${i}`]));",
    "    }",
    "    return yield* r4_cnt.get();",
    "  })), {",
    "    cnt: provide_state(r4_cnt, 0),",
    "    log: provide_writer(r4_log),",
    "  }));",
    "}",
    "let prep_init_count = 0;",
    "const prepared_handle = prepare_handle_cells({",
    "  cfg: provide_reader(r4_cfg, { mul: (prep_init_count += 1, 3) }),",
    "  cnt: provide_state(r4_cnt, 10),",
    "});",
    "export function handle_cells_prepared(n: number) {",
    "  return run(prepared_handle(Program(function* () {",
    "    const { mul } = yield* r4_cfg.ask();",
    "    yield* r4_cnt.modify((c) => c + n * mul);",
    "    return yield* r4_cnt.get();",
    "  })));",
    "}",
    "export function get_prep_init_count() { return prep_init_count; }",
    untouched_tail,
  ].join("\n");

  const result = transform_do_program_source(source, "round4_fusion.ts");
  assert_equals(result.diagnostics, []);
  assert_true(
    !/\bDo\(/.test(result.code) &&
      !/\bProgram\(/.test(result.code) &&
      !/\bto_array\(/.test(result.code) &&
      !/\bFoldable\./.test(result.code) &&
      !/\bcompile_fold\(/.test(result.code) &&
      !/\bcollect\(/.test(result.code) &&
      !/\bApplicative\.lift\(/.test(result.code) &&
      !/\bhandle_cells\(/.test(result.code) &&
      !/\brun_except\(/.test(result.code),
    "expected all Round 4 constructs to fuse completely\n\n" + result.code,
  );
  assert_true(
    result.code.includes(untouched_tail),
    "expected T1/T2 span skipping & surgical splice to preserve untouched tail verbatim",
  );
  assert_true(result.map !== null, "expected V3 source map");

  // Strict TypeScript check on generated code!
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round4-check-",
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
        "Generated Round 4 TypeScript failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Execute generated code and verify every semantic invariant!
  const compiled = executable_typescript(result.code, "round4_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  const { ArrayT } = await import("../src/array.ts");
  const { Just, Nothing } = await import("../src/maybe.ts");
  const { Left, Right } = await import("../src/either.ts");
  const { identity } = await import("../src/identity.ts");

  // P1 checks
  assert_equals(
    mod.array_comp_2d(ArrayT([1, 2, 3]), ArrayT([1, 2])).value(),
    [11, 22, 31],
  );
  assert_equals(mod.array_comp_3d_inferred().value(), [11, 10, 21, 20, 22, 40]);

  // P2 checks
  assert_equals(mod.iter_filter_map_to_array([1, 2, 3, 4, 5]), [7, 13]);
  assert_equals(mod.iter_live_growth([1, 2, 3]), [20, 40]);
  assert_equals(mod.iter_map_filter_take_fold([1, 2, 3, 4, 5, 6], 2), 14);
  assert_equals(mod.iter_map_filter_take_fold([1, 2, 3, 4, 5, 6], 0), 0);
  let range_err = false;
  try {
    mod.iter_map_filter_take_fold([1, 2, 3], -1);
  } catch (e) {
    range_err = e instanceof RangeError;
  }
  assert_true(range_err, "take(-1) must throw RangeError");
  assert_equals(mod.iter_mid_take_filter([1, 2, 3, 4, 5], 2), [2]);
  assert_equals(mod.iter_mid_take_filter([1, 3, 4, 6], 2), []);
  assert_equals(mod.iter_snapshot_take_zero([5, 6, 7]), {
    reads: 0,
    out: [],
    snap: [15, 16],
  });
  assert_equals(mod.iter_some_closes(), { hit: true, closed: true });
  assert_equals(mod.iter_find_typeguard([1, "hi", 2, "world", "ok"]), "world");
  assert_equals(mod.iter_compile_fold_call([-2, 3, 0, 5]), 16);

  // P3a checks
  assert_equals(mod.inferred_maybe_loop(5, 0).value(), ["Just", 15]);
  assert_equals(mod.inferred_maybe_loop(5, 3).value(), ["Nothing"]);
  assert_equals(mod.inferred_either_loop(5).value(), ["Right", 30]);
  assert_equals(mod.inferred_either_loop(12).value(), ["Left", "too-big"]);
  assert_equals(mod.inferred_identity_loop(5).value(), 15);

  // P3b checks
  mod.collect_eval_log.length = 0;
  assert_equals(
    mod.collect_maybe_tuple(Just(1), Just("x"), Just(true)).value(),
    ["Just", [1, "x", true]],
  );
  assert_equals(mod.collect_eval_log, ["a", "b", "c"]);
  mod.collect_eval_log.length = 0;
  assert_equals(
    mod.collect_maybe_tuple(Nothing(), Just("x"), Just(true)).value(),
    ["Nothing"],
  );
  assert_equals(mod.collect_eval_log, ["a", "b", "c"]);
  assert_equals(
    mod.collect_either_record(Right(1), Right("ok")).value(),
    ["Right", { a: 1, b: "ok" }],
  );
  assert_equals(
    mod.collect_either_record(Left("e1"), Left("e2")).value(),
    ["Left", "e1"],
  );
  assert_equals(mod.collect_inferred_just(7).value(), ["Just", [7, 8]]);
  assert_equals(
    mod.collect_identity_tuple(identity(3), identity(4)).value(),
    [3, 4],
  );
  assert_equals(mod.lift_just_fused(6, 7).value(), ["Just", 42]);

  // P4 checks
  const hc = mod.handle_cells_fused(3);
  assert_equals(hc.result, 12);
  assert_equals(hc.states, { cnt: 12 });
  assert_equals(hc.logs.log.value(), ["i:1", "i:2", "i:3"]);

  const eo_ok = mod.except_outer_handle_cells_inner(0).value();
  assert_equals(eo_ok[0], "Right");
  if (eo_ok[0] === "Right") {
    assert_equals(eo_ok[1].result, 15);
    assert_equals(eo_ok[1].states, { cnt: 15 });
    assert_equals(eo_ok[1].logs.log.value(), [
      "step:1",
      "step:2",
      "step:3",
      "step:4",
      "step:5",
    ]);
  }
  assert_equals(
    mod.except_outer_handle_cells_inner(3).value(),
    ["Left", "aborted"],
  );

  const ho_err = mod.handle_cells_outer_except_inner(3);
  assert_equals(ho_err.result.value(), ["Left", "stopped"]);
  assert_equals(ho_err.states, { cnt: 3 });
  assert_equals(ho_err.logs.log.value(), ["keep:1", "keep:2"]);

  const hp1 = mod.handle_cells_prepared(4);
  const hp2 = mod.handle_cells_prepared(5);
  assert_equals(hp1.result, 22);
  assert_equals(hp1.states, { cnt: 22 });
  assert_equals(hp2.result, 25);
  assert_equals(hp2.states, { cnt: 25 });
  assert_equals(mod.get_prep_init_count(), 1);
  assert_equals(mod.r4_untouched_39(1), 40);
});

Deno.test("round-5 post-plugin fusion covers Task run_task, direct run_*_terminal, Do(List), Traversable.traverse, tagged match, and IterableT filter_map/preview/fold_while", async () => {
  const src_dir = new URL("../src/", import.meta.url).href;
  const source = [
    `import { Do, Either, Foldable, Identity, identity, Just, Left, List, Nil, Maybe, Nothing, Program, Right, Traversable, Validation, Invalid, Valid, match, from_array as list_from_arr } from "${src_dir}mod.ts";`,
    `import { ArrayT } from "${src_dir}array.ts";`,
    `import { from_fn, run_task, succeed, Task } from "${src_dir}task.ts";`,
    `import { Effect } from "${src_dir}effects.ts";`,
    `import { ask, reader, Reader, run_reader_terminal } from "${src_dir}reader.ts";`,
    `import { get, modify, run_state_terminal, state, State } from "${src_dir}state.ts";`,
    `import { run_writer_terminal, tell, writer_cell } from "${src_dir}writer.ts";`,
    `import { traverse_sequential } from "${src_dir}traversal.ts";`,
    `import { from_array, filter_map, preview, to_array } from "${src_dir}iterable.ts";`,
    // P1: Immediate Task fusion (Do(Task), .run(), Program) + try/catch barrier
    "export function task_pure_loop(n: number) {",
    "  return run_task(Do(Task, function* () {",
    "    let acc = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      acc += yield* succeed(i);",
    "      acc += yield* from_fn(() => i * 2);",
    "    }",
    "    return acc;",
    "  }));",
    "}",
    "export function task_do_dot_run(base: number) {",
    "  return Do(Task, function* () {",
    "    const a = yield* from_fn(() => Promise.resolve(base + 5));",
    "    const b = yield* Task.pure(a * 2);",
    "    return b;",
    "  }).run();",
    "}",
    "export function task_program_run(n: number) {",
    "  return run_task(Program(function* () {",
    "    let total = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      total += yield* Effect.lift(from_fn(() => i + 1));",
    "    }",
    "    return yield* Effect.pure(total);",
    "  }));",
    "}",
    "export function task_try_barrier() {",
    "  return run_task(Do(Task, function* () {",
    "    try {",
    "      return yield* from_fn((): number => { throw new Error('reject'); });",
    "    } catch {",
    "      return -1;",
    "    }",
    "  }));",
    "}",
    // P2: Direct run_*_terminal fusion (inline Program, named Program, keyed cells, Do(Reader/State))
    'const r5_cfg = reader<number>()("r5_cfg");',
    'const r5_cnt = state<number>()("r5_cnt");',
    'const r5_log = writer_cell("r5_log", ArrayT<number>([]));',
    "export function direct_reader_terminal(n: number) {",
    "  const prog = Program(function* () {",
    "    const mul = yield* ask<number>();",
    "    let s = 0;",
    "    for (let i = 1; i <= n; i += 1) s += i * mul;",
    "    return s;",
    "  });",
    "  return run_reader_terminal(prog, 3);",
    "}",
    "export function direct_state_terminal(n: number) {",
    "  return run_state_terminal(Program(function* () {",
    "    for (let i = 1; i <= n; i += 1) {",
    "      yield* modify((s: number) => s + i);",
    "    }",
    "    return yield* get<number>();",
    "  }), 10);",
    "}",
    "export function direct_writer_terminal(n: number) {",
    "  return run_writer_terminal(r5_log, Program(function* () {",
    "    for (let i = 1; i <= n; i += 1) {",
    "      yield* r5_log.tell(ArrayT([i * 2]));",
    "    }",
    "    return n;",
    "  }));",
    "}",
    "export function direct_do_reader_state(x: number) {",
    "  const r = run_reader_terminal(Do(Reader, function* () {",
    "    const env = yield* ask<number>();",
    "    return env + x;",
    "  }), 7);",
    "  const [sv, st] = run_state_terminal(Do(State, function* () {",
    "    yield* modify((s: number) => s + r);",
    "    return yield* get<number>();",
    "  }), 5);",
    "  const k = run_reader_terminal(r5_cfg, Program(function* () {",
    "    const c = yield* r5_cfg.ask();",
    "    return c * 2;",
    "  }), 4);",
    "  const [kv, ks] = run_state_terminal(r5_cnt, Program(function* () {",
    "    yield* r5_cnt.modify((s) => s + k);",
    "    return yield* r5_cnt.get();",
    "  }), 1);",
    "  return [r, sv, st, kv, ks];",
    "}",
    // P3: Direct Do(List, ...) comprehension
    "export function list_comp_2d(xs: List<number>, ys: List<number>) {",
    "  return Do(List, function* () {",
    "    const x = yield* xs;",
    "    const y = yield* ys;",
    "    if ((x + y) % 2 !== 0) return yield* Nil<number>();",
    "    return x * 10 + y;",
    "  });",
    "}",
    // P4: Traversable.traverse & traverse_sequential fusion
    "export const trav_log: number[] = [];",
    "export function trav_maybe_elided(xs: number[]) {",
    "  return Traversable.traverse(ArrayT(xs), Maybe, (x) => x > 0 ? Just(x * 2) : Nothing());",
    "}",
    "export function trav_maybe_method_side_effects(xs: number[]) {",
    "  return ArrayT(xs).traverse(Maybe, (x) => { trav_log.push(x); return x > 0 ? Just(x + 1) : Nothing(); });",
    "}",
    "export function trav_either_app_side_effects(xs: number[]) {",
    "  return Traversable.traverse(ArrayT(xs), Either, (x) => (trav_log.push(x), x > 0 ? Right(x) : Left(`bad:${x}`)));",
    "}",
    "export function trav_seq_either_elided(xs: number[]) {",
    "  return traverse_sequential(xs, Either, (x) => (trav_log.push(x), x > 0 ? Right(x * 3) : Left(`stop:${x}`)));",
    "}",
    "export function trav_identity_elided(xs: number[]) {",
    "  return ArrayT(xs).traverse(Identity, (x) => identity(x + 10));",
    "}",
    // P5a: match(val, ...) & val.match(...) + non-target regex/custom .match safety
    "export function match_maybe_val(m: Maybe<number>) {",
    "  return m.match({ Just: (v) => v * 2, Nothing: () => -1 });",
    "}",
    "export function match_either_fn(e: Either<string, number>) {",
    "  return match(e, { Right: (v) => v + 1, Left: (err) => err.length });",
    "}",
    "export function match_validation_block(v: Validation<string, number>) {",
    "  return v.match({",
    "    valid: (n) => { const out = n * 3; return out; },",
    "    invalid: (err, _s) => -err.length,",
    "  });",
    "}",
    "export function match_list_array(xs: readonly List<number>[], idx: number) {",
    "  return xs[idx].match({ Cons: (h, _t) => h, Nil: () => 0 });",
    "}",
    "export function regex_and_custom_untouched(s: string) {",
    "  const custom = { match(o: { a: () => number }) { return o.a(); } };",
    "  return [s.match(/[0-9]+/)?.[0] ?? '', custom.match({ a: () => 99 })];",
    "}",
    // P5b: IterableT filter_map, preview, Foldable.fold_while
    "export function iter_filter_map_preview(xs: number[], limit: number) {",
    "  return preview(filter_map(from_array(xs), (x) => x % 2 === 0 ? Just(x * 10) : Nothing()), limit);",
    "}",
    "export function iter_preview_zero_stage(xs: number[], limit: number) {",
    "  return preview(from_array(xs), limit);",
    "}",
    "export function iter_fold_while_elided(xs: number[], cap: number) {",
    "  return Foldable.fold_while(from_array(xs).map((x) => x * 2), 0, (acc, x) => acc + x >= cap ? ['Done', acc + x] : ['Continue', acc + x]);",
    "}",
    "export function iter_filter_map_general(xs: number[]) {",
    "  const to_m = (n: number): Maybe<number> => n > 2 ? Just(n + 1) : Nothing();",
    "  return to_array(filter_map(from_array(xs), to_m));",
    "}",
    "export function make_list_pair() { return list_from_arr([1, 2]); }",
    "export function make_val_pair() { return [Valid(4), Invalid('err', { concat: (a: string, b: string) => a + b })] as const; }",
  ].join("\n");

  const result = transform_do_program_source(source, "round5_fusion.ts");
  assert_equals(result.diagnostics.length, 1);
  assert_true(
    result.diagnostics[0].message.includes("Skipped Do"),
    "only task_try_barrier should emit a diagnostic",
  );
  // Verify P1 fused task_pure_loop/task_do_dot_run/task_program_run while preserving try/catch barrier
  assert_true(
    result.code.includes("async () =>"),
    "expected P1 immediate Task calls to fuse into async IIFE\n\n" +
      result.code,
  );
  // Verify P2 fused all run_*_terminal calls (zero remaining run_*_terminal runtime calls!)
  assert_true(
    !/run_reader_terminal\(/.test(result.code) &&
      !/run_state_terminal\(/.test(result.code) &&
      !/run_writer_terminal\(/.test(result.code),
    "expected P2 run_*_terminal calls to fuse completely\n\n" + result.code,
  );
  // Verify P3 fused Do(List)
  assert_true(
    !/Do\(List/.test(result.code),
    "expected P3 Do(List) comprehension to fuse\n\n" + result.code,
  );
  // Verify P4 fused Traversable.traverse & traverse_sequential
  assert_true(
    !/Traversable\.traverse\(/.test(result.code) &&
      !/\.traverse\(/.test(result.code) &&
      !/traverse_sequential\(/.test(result.code),
    "expected P4 Traversable.traverse and traverse_sequential to fuse\n\n" +
      result.code,
  );
  // Verify P5a fused tagged match/val.match while leaving regex and custom.match untouched
  assert_true(
    !/\bmatch\(e,/.test(result.code) &&
      !/\bm\.match\(/.test(result.code) &&
      !/\bv\.match\(/.test(result.code) &&
      !/xs\[idx\]\.match\(/.test(result.code) &&
      result.code.includes("s.match(/[0-9]+/)") &&
      result.code.includes("custom.match("),
    "expected P5a tagged match fusion + non-target preservation\n\n" +
      result.code,
  );
  // Verify P5b fused filter_map, preview, and Foldable.fold_while
  assert_true(
    !/\bpreview\(/.test(result.code) &&
      !/Foldable\.fold_while\(/.test(result.code) &&
      !/\bfilter_map\(/.test(result.code),
    "expected P5b IterableT filter_map, preview, and fold_while to fuse\n\n" +
      result.code,
  );

  // Strict TypeScript check on generated Round 5 code!
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round5-check-",
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
        "Generated Round 5 TypeScript failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Execute generated code and verify every semantic invariant!
  const compiled = executable_typescript(result.code, "round5_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  const { Just, Nothing } = await import("../src/maybe.ts");
  const { Left, Right } = await import("../src/either.ts");
  const { from_array: list_from_array, to_array: list_to_array } = await import(
    "../src/list.ts"
  );

  // P1 runtime checks
  assert_equals(await mod.task_pure_loop(5), 45);
  assert_equals(await mod.task_do_dot_run(10), 30);
  assert_equals(await mod.task_program_run(4), 14);
  assert_equals(await mod.task_try_barrier(), -1);

  // P2 runtime checks
  assert_equals(mod.direct_reader_terminal(4), 30);
  assert_equals(mod.direct_state_terminal(4), [20, 20]);
  const [w_res, w_log] = mod.direct_writer_terminal(3);
  assert_equals([w_res, w_log.value()], [3, [2, 4, 6]]);
  assert_equals(mod.direct_do_reader_state(3), [10, 15, 15, 9, 9]);

  // P3 runtime checks
  assert_equals(
    list_to_array(
      mod.list_comp_2d(list_from_array([1, 2, 3]), list_from_array([1, 2])),
    ),
    [11, 22, 31],
  );

  // P4 runtime checks (including applicative vs sequential side-effect order & empty/index-0 edge cases!)
  const tm_ok = mod.trav_maybe_elided([1, 2, 3]).value();
  assert_equals(tm_ok[0], "Just");
  if (tm_ok[0] === "Just") assert_equals(tm_ok[1].value(), [2, 4, 6]);
  const tm_empty = mod.trav_maybe_elided([]).value();
  assert_equals(tm_empty[0], "Just");
  if (tm_empty[0] === "Just") assert_equals(tm_empty[1].value(), []);
  assert_equals(mod.trav_maybe_elided([0, 2, 3]).value(), ["Nothing"]);
  assert_equals(mod.trav_maybe_elided([1, 0, 3]).value(), ["Nothing"]);

  mod.trav_log.length = 0;
  assert_equals(mod.trav_maybe_method_side_effects([1, -1, 2]).value(), [
    "Nothing",
  ]);
  assert_equals(mod.trav_log, [1, -1, 2]);

  mod.trav_log.length = 0;
  assert_equals(mod.trav_either_app_side_effects([1, -2, -3, 4]).value(), [
    "Left",
    "bad:-2",
  ]);
  assert_equals(mod.trav_log, [1, -2, -3, 4]);

  mod.trav_log.length = 0;
  assert_equals(mod.trav_seq_either_elided([1, -2, 3]).value(), [
    "Left",
    "stop:-2",
  ]);
  assert_equals(mod.trav_log, [1, -2]);
  assert_equals(mod.trav_seq_either_elided([]).value(), ["Right", []]);
  assert_equals(mod.trav_seq_either_elided([-5, 1]).value(), [
    "Left",
    "stop:-5",
  ]);
  assert_equals(mod.trav_seq_either_elided([1, 2, 3]).value(), [
    "Right",
    [3, 6, 9],
  ]);
  assert_equals(mod.trav_identity_elided([]).value().value(), []);
  assert_equals(mod.trav_identity_elided([1, 2]).value().value(), [11, 12]);

  // P5a runtime checks
  assert_equals(mod.match_maybe_val(Just(21)), 42);
  assert_equals(mod.match_maybe_val(Nothing()), -1);
  assert_equals(mod.match_either_fn(Right(10)), 11);
  assert_equals(mod.match_either_fn(Left("oops")), 4);
  const [v_ok, v_bad] = mod.make_val_pair();
  assert_equals(mod.match_validation_block(v_ok), 12);
  assert_equals(mod.match_validation_block(v_bad), -3);
  assert_equals(
    mod.match_list_array([mod.make_list_pair(), list_from_array([])], 0),
    1,
  );
  assert_equals(
    mod.match_list_array([mod.make_list_pair(), list_from_array([])], 1),
    0,
  );
  assert_equals(mod.regex_and_custom_untouched("abc123def"), ["123", 99]);

  // P5b runtime checks
  assert_equals(mod.iter_filter_map_preview([1, 2, 3, 4, 5, 6], 2), [20, 40]);
  assert_equals(mod.iter_preview_zero_stage([10, 20, 30], 2), [10, 20]);
  assert_equals(mod.iter_fold_while_elided([1, 2, 3, 4, 5], 12), 12);
  assert_equals(mod.iter_filter_map_general([1, 2, 3, 4]), [4, 5]);
});

Deno.test("round-5b post-plugin fusion covers stacked async run_task, Maybe/Either chains, ArrayT chains/folds, and Do(Stm)", async () => {
  const src_dir = new URL("../src/", import.meta.url).href;
  const source = [
    `import { Do, Either, Foldable, from_maybe, from_nullable, Just, Left, match, Maybe, Nothing, Program, Right, to_nullable } from "${src_dir}mod.ts";`,
    `import { ArrayT, from_array_view, to_array as arr_to_array } from "${src_dir}array.ts";`,
    `import { Effect } from "${src_dir}effects.ts";`,
    `import { from_fn, run_task, succeed } from "${src_dir}task.ts";`,
    `import { ask, reader, run_reader } from "${src_dir}reader.ts";`,
    `import { get, modify, run_state, state } from "${src_dir}state.ts";`,
    `import { writer_cell } from "${src_dir}writer.ts";`,
    `import { fail, run_except } from "${src_dir}except.ts";`,
    `import { handle_cells, provide_reader, provide_state, provide_writer } from "${src_dir}handlers.ts";`,
    `import { atomically, new_tvar, or_else, read_tvar, retry, Stm, type TVar, write_tvar } from "${src_dir}stm.ts";`,
    // P6: Stacked async run_task over Reader/State/Writer/Except/handle_cells + Effect.interpret
    'const s_cfg = reader<number>()("s_cfg");',
    'const s_cnt = state<number>()("s_cnt");',
    'const s_log = writer_cell("s_log", ArrayT<number>([]));',
    "export function async_reader_prog(n: number) {",
    "  const prog = Program(function* () {",
    "    const mul = yield* ask<number>();",
    "    let acc = 0;",
    "    for (let i = 1; i <= n; i += 1) {",
    "      acc += yield* Effect.lift(from_fn(() => i * mul));",
    "    }",
    "    return acc;",
    "  });",
    "  return run_task(run_reader(prog, 4));",
    "}",
    "export function async_except_state(n: number, fail_at: number) {",
    "  return run_task(run_except(run_state(Program(function* () {",
    "    for (let i = 1; i <= n; i += 1) {",
    "      const step = yield* Effect.lift(from_fn(() => i === 2 ? Promise.resolve(i * 10) : i));",
    "      if (i === fail_at) return yield* fail('stopped' as const);",
    "      yield* modify((s: number) => s + step);",
    "    }",
    "    return yield* get<number>();",
    "  }), 0)));",
    "}",
    "export function async_handle_cells(n: number) {",
    "  return run_task(handle_cells(Program(function* () {",
    "    const mul = yield* s_cfg.ask();",
    "    for (let i = 1; i <= n; i += 1) {",
    "      const v = yield* from_fn(() => i * mul);",
    "      yield* s_cnt.modify((c) => c + v);",
    "      yield* s_log.tell(ArrayT([v]));",
    "    }",
    "    return yield* s_cnt.get();",
    "  }), {",
    "    cfg: provide_reader(s_cfg, 3),",
    "    cnt: provide_state(s_cnt, 1),",
    "    log: provide_writer(s_log),",
    "  }));",
    "}",
    "export function async_interpret_chain(n: number) {",
    "  return Effect.interpret(Program(function* () {",
    "    const k = yield* ask<number>();",
    "    const base = yield* Effect.lift(succeed(n * k));",
    "    yield* modify((s: number) => s + base);",
    "    return yield* get<number>();",
    "  }))",
    "    .handle((e) => run_reader(e, 5))",
    "    .handle((e) => run_state(e, 10))",
    "    .run(run_task);",
    "}",
    // P7: Fluent Maybe & Either chain fusion
    "export const fb_log: string[] = [];",
    "export function maybe_chain_wrap(n: number) {",
    "  return Just(n).map((x) => x + 1).bind((x) => x % 2 === 0 ? Just(x * 3) : Nothing()).map((x) => x - 1);",
    "}",
    "export function maybe_nullable_match(s: string | null) {",
    "  return from_nullable(s).map((v) => v.trim()).bind((v) => v.length > 0 ? Just(v.length) : Nothing()).match({ Just: (n) => n * 2, Nothing: () => -1 });",
    "}",
    "export function maybe_from_maybe_eager(m: Maybe<number>) {",
    "  return from_maybe((fb_log.push('fb'), 99), m.map((x) => x + 10));",
    "}",
    "export function maybe_to_nullable_chain(m: Maybe<number>) {",
    "  return to_nullable(m.map((x) => x * 2));",
    "}",
    "export function either_chain_match(e: Either<string, number>) {",
    "  return match(e.map((x) => x + 1).bind((x) => x > 5 ? Right(x * 2) : Left('small')), { Right: (n) => n, Left: (err) => -err.length });",
    "}",
    "export function either_chain_wrap(n: number) {",
    "  return Right(n).map((x) => x + 2).bind((x) => x > 0 ? Right(x * 5) : Left('neg'));",
    "}",
    // P8: ArrayT fluent .map chain & Foldable.fold/fold_while/some/find fusion
    "export function arr_map_chain(xs: number[]) {",
    "  return ArrayT(xs).map((x) => x * 2).map((x) => x + 1);",
    "}",
    "export function arr_to_array_map(xs: number[]) {",
    "  return arr_to_array(from_array_view(xs).map((x) => x + 5));",
    "}",
    "export function arr_fold_chain(xs: number[]) {",
    "  return Foldable.fold(ArrayT(xs).map((x) => x * 2).map((x) => x + 1), 0, (acc, x) => acc + x);",
    "}",
    "export function arr_method_fold(xs: number[]) {",
    "  return ArrayT(xs).map((x) => x * 3).fold(10, (acc, x) => acc + x);",
    "}",
    "export function arr_fold_while(xs: number[], cap: number) {",
    "  return Foldable.fold_while(ArrayT(xs).map((x) => x * 2), 0, (acc, x) => acc + x >= cap ? ['Done', acc + x] : ['Continue', acc + x]);",
    "}",
    "export function arr_some_find(xs: number[]) {",
    "  const has = Foldable.some(ArrayT(xs).map((x) => x * 2), (x) => x > 8);",
    "  const first = Foldable.find(ArrayT(xs).map((x) => x * 2), (x) => x > 6);",
    "  return [has, first] as const;",
    "}",
    // P9: Do(Stm, ...) direct journal fusion
    "export function stm_do_loop(tv: TVar<number>, n: number) {",
    "  return atomically(Do(Stm, function* () {",
    "    let sum = 0;",
    "    for (let i = 0; i < n; i += 1) {",
    "      const v = yield* read_tvar(tv);",
    "      yield* write_tvar(tv, v + 1);",
    "      sum += v;",
    "    }",
    "    return yield* Stm.pure(sum);",
    "  }));",
    "}",
    "export function stm_do_retry_fallback(tv: TVar<number>) {",
    "  const guarded = Do(Stm, function* () {",
    "    const v = yield* read_tvar(tv);",
    "    if (v < 10) return yield* retry<number>();",
    "    return v;",
    "  });",
    "  return atomically(or_else(guarded, Stm.pure(-1)));",
    "}",
    "export function make_tv(n: number) { return new_tvar(n); }",
  ].join("\n");

  const result = transform_do_program_source(source, "round5b_fusion.ts");
  assert_equals(result.diagnostics, []);
  // Verify P6 fused all stacked run_task & Effect.interpret calls
  assert_true(
    !/\brun_task\(/.test(result.code) &&
      !/\bProgram\(/.test(result.code) &&
      !/Effect\.interpret\(/.test(result.code) &&
      !/\bhandle_cells\(/.test(result.code),
    "expected P6 stacked async run_task & interpret chains to fuse completely\n\n" +
      result.code,
  );
  // Verify P7 fused Maybe/Either chains
  assert_true(
    !/\.map\(/.test(result.code) &&
      !/\.bind\(/.test(result.code) &&
      !/\bfrom_maybe\(/.test(result.code) &&
      !/\bto_nullable\(/.test(result.code) &&
      !/\bfrom_nullable\(/.test(result.code),
    "expected P7/P8 Maybe/Either/ArrayT chains to fuse completely\n\n" +
      result.code,
  );
  // Verify P8 fused ArrayT folds
  assert_true(
    !/Foldable\./.test(result.code) &&
      !/\.fold\(/.test(result.code) &&
      !/arr_to_array\(/.test(result.code),
    "expected P8 ArrayT Foldable/to_array calls to fuse completely\n\n" +
      result.code,
  );
  // Verify P9 fused Do(Stm)
  assert_true(
    !/\bDo\(Stm/.test(result.code),
    "expected P9 Do(Stm) to fuse into direct Stm journal function\n\n" +
      result.code,
  );

  // Strict TypeScript check on generated Round 5b code!
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round5b-check-",
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
        "Generated Round 5b TypeScript failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Execute generated code and verify every semantic invariant!
  const compiled = executable_typescript(result.code, "round5b_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  const { Just, Nothing } = await import("../src/maybe.ts");
  const { Left, Right } = await import("../src/either.ts");

  // P6 runtime checks
  assert_equals(await mod.async_reader_prog(4), 40);
  const aes_ok = (await mod.async_except_state(3, 0)).value();
  assert_equals(aes_ok, ["Right", [24, 24]]);
  const aes_err = (await mod.async_except_state(3, 2)).value();
  assert_equals(aes_err, ["Left", "stopped"]);
  const ahc = await mod.async_handle_cells(3);
  assert_equals(ahc.result, 19);
  assert_equals(ahc.states, { cnt: 19 });
  assert_equals(ahc.logs.log.value(), [3, 6, 9]);
  assert_equals(await mod.async_interpret_chain(4), [30, 30]);

  // P7 runtime checks
  assert_equals(mod.maybe_chain_wrap(3).value(), ["Just", 11]);
  assert_equals(mod.maybe_chain_wrap(4).value(), ["Nothing"]);
  assert_equals(mod.maybe_nullable_match("  hi  "), 4);
  assert_equals(mod.maybe_nullable_match("   "), -1);
  assert_equals(mod.maybe_nullable_match(null), -1);
  mod.fb_log.length = 0;
  assert_equals(mod.maybe_from_maybe_eager(Just(5)), 15);
  assert_equals(mod.fb_log, ["fb"]);
  mod.fb_log.length = 0;
  assert_equals(mod.maybe_from_maybe_eager(Nothing()), 99);
  assert_equals(mod.fb_log, ["fb"]);
  assert_equals(mod.maybe_to_nullable_chain(Just(7)), 14);
  assert_equals(mod.maybe_to_nullable_chain(Nothing()), null);
  assert_equals(mod.either_chain_match(Right(5)), 12);
  assert_equals(mod.either_chain_match(Right(2)), -5);
  assert_equals(mod.either_chain_match(Left("bad")), -3);
  assert_equals(mod.either_chain_wrap(3).value(), ["Right", 25]);
  assert_equals(mod.either_chain_wrap(-5).value(), ["Left", "neg"]);

  // P8 runtime checks
  assert_equals(mod.arr_map_chain([1, 2, 3]).value(), [3, 5, 7]);
  assert_equals(mod.arr_map_chain([]).value(), []);
  assert_equals(mod.arr_to_array_map([10, 20]), [15, 25]);
  assert_equals(mod.arr_to_array_map([]), []);
  assert_equals(mod.arr_fold_chain([1, 2, 3]), 15);
  assert_equals(mod.arr_method_fold([1, 2, 3]), 28);
  assert_equals(mod.arr_fold_while([1, 2, 3, 4, 5], 12), 12);
  assert_equals(mod.arr_some_find([1, 2, 4, 5]), [true, 8]);
  assert_equals(mod.arr_some_find([1, 2, 3]), [false, undefined]);

  // P9 runtime checks
  const tv = mod.make_tv(0);
  assert_equals(mod.stm_do_loop(tv, 5), 10);
  assert_equals(mod.stm_do_retry_fallback(tv), -1);
  assert_equals(mod.stm_do_loop(tv, 5), 35);
  assert_equals(mod.stm_do_retry_fallback(tv), 10);
});

Deno.test("round-6 post-plugin fusion covers Do(Maybe)/Do(Either) cond+nullable elision, Validation/Task traverse, run_task_exit, standalone Do(Reader)/Do(State) prefix, Validation collect/lift, IterableT.bind, and fast-printer source maps", async () => {
  const mod_url = new URL("../src/mod.ts", import.meta.url).href;
  const task_url = new URL("../src/task.ts", import.meta.url).href;
  const reader_url = new URL("../src/reader.ts", import.meta.url).href;
  const state_url = new URL("../src/state.ts", import.meta.url).href;
  const handlers_url = new URL("../src/handlers.ts", import.meta.url).href;
  const array_url = new URL("../src/array.ts", import.meta.url).href;
  const iterable_url = new URL("../src/iterable.ts", import.meta.url).href;
  const traversal_url = new URL("../src/traversal.ts", import.meta.url).href;
  const validation_url = new URL("../src/validation.ts", import.meta.url).href;

  const source = [
    `import { Applicative, collect, Do, Effect, Either, Foldable, from_nullable, Invalid, InvalidMessages, Just, Left, Maybe, Nothing, Program, Right, Traversable, Valid, Validation } from ${
      JSON.stringify(mod_url)
    };`,
    `import { from_fn, run_task, run_task_exit, Task } from ${
      JSON.stringify(task_url)
    };`,
    `import { ask, asks, Reader, reader, run_reader } from ${
      JSON.stringify(reader_url)
    };`,
    `import { get, put, run_state, State, state } from ${
      JSON.stringify(state_url)
    };`,
    `import { handle_cells, provide_reader, provide_state } from ${
      JSON.stringify(handlers_url)
    };`,
    `import { ArrayT } from ${JSON.stringify(array_url)};`,
    `import { from_array, preview, to_array } from ${
      JSON.stringify(iterable_url)
    };`,
    `import { traverse_sequential } from ${JSON.stringify(traversal_url)};`,
    `import type { ValidationSemigroup } from ${
      JSON.stringify(validation_url)
    };`,
    // Q1: Do(Maybe) & Do(Either) conditional & from_nullable yield elision
    "export function do_maybe_cond_loop(x: number, n: number) {",
    "  return Do(Maybe, function* () {",
    "    let total = 0;",
    "    for (let i = 0; i < n; i += 1) {",
    "      const a = yield* (x > i ? Just(x + i) : Nothing<number>());",
    "      const b = yield* (a < 0 ? Nothing<number>() : Just(a * 2));",
    "      total += b;",
    "    }",
    "    return total;",
    "  });",
    "}",
    "export function do_maybe_nullable(a: number | null, b: number | undefined) {",
    "  return Do(Maybe, function* () {",
    "    const x = yield* from_nullable(a);",
    "    const y = yield* from_nullable(b);",
    "    return x + y;",
    "  });",
    "}",
    "export function do_either_cond_loop(x: number, n: number) {",
    "  return Do(Either, function* () {",
    "    let total = 0;",
    "    for (let i = 0; i < n; i += 1) {",
    "      const a = yield* (x > i ? Right(x + i) : Left<string, number>(`fail:${i}`));",
    "      total += a;",
    "    }",
    "    return total;",
    "  });",
    "}",
    "export function do_either_mixed(e: Either<number, number>, ok: boolean) {",
    "  return Do(Either, function* () {",
    "    const a = yield* e;",
    "    const b = yield* (ok ? Right(a * 2) : Left<string, number>('bad'));",
    "    return a + b;",
    "  });",
    "}",
    // Q2a: Validation traverse fusion
    "export function trav_val_messages(xs: number[]) {",
    "  return Traversable.traverse(ArrayT(xs), Validation.with_error<readonly string[]>(), (x) => x > 0 ? Valid(x * 2) : InvalidMessages(`bad:${x}`));",
    "}",
    "export function trav_val_with_error(xs: number[]) {",
    "  return ArrayT(xs).traverse(Validation.with_error<readonly string[]>(), (x) => x >= 0 ? Valid(x + 1) : InvalidMessages(`neg:${x}`));",
    "}",
    "const sum_sg: ValidationSemigroup<number> = { concat: (a, b) => a + b };",
    "export function trav_val_custom_sg(xs: number[]) {",
    "  return Traversable.traverse(ArrayT(xs), Validation.with_error<number>(), (x) => x > 0 ? Valid(x) : Invalid(-x, sum_sg));",
    "}",
    // Q2b: Task traverse fusion (run_task & run_task_exit)
    "export function run_trav_task_sync(xs: number[]) {",
    "  return run_task(Traversable.traverse(ArrayT(xs), Task, (x) => from_fn(() => x * 3)));",
    "}",
    "export function run_trav_task_async(xs: number[]) {",
    "  return run_task(traverse_sequential(xs, Task, (x) => from_fn(async () => await Promise.resolve(x + 10))));",
    "}",
    "export function run_trav_task_exit(xs: number[]) {",
    "  return run_task_exit(Traversable.traverse(ArrayT(xs), Task, (x) => from_fn(() => {",
    "    if (x < 0) throw new Error(`neg:${x}`);",
    "    return x * 2;",
    "  })));",
    "}",
    // Q3: run_task_exit direct & stacked
    "const cfg_cell = reader<{ mul: number }>()('r6_cfg');",
    "const cnt_cell = state<number>()('r6_cnt');",
    "export function exit_do_task(x: number) {",
    "  return run_task_exit(Do(Task, function* () {",
    "    const a = yield* from_fn(() => x + 1);",
    "    if (a < 0) throw new Error('boom');",
    "    const b = yield* from_fn(() => Promise.resolve(a * 2));",
    "    return b;",
    "  }));",
    "}",
    "export function exit_stacked_reader_state(mul: number, init: number) {",
    "  const env = { mul };",
    "  return run_task_exit(run_reader(run_state(Program(function* () {",
    "    const cfg = yield* ask<{ mul: number }>();",
    "    const cur = yield* get<number>();",
    "    const add = yield* Effect.lift(from_fn(() => cfg.mul * 2));",
    "    if (add < 0) throw new Error('neg-mul');",
    "    yield* put<number>(cur + add);",
    "    return yield* get<number>();",
    "  }), init), env));",
    "}",
    "export function exit_handle_cells(mul: number, init: number) {",
    "  const env = { mul };",
    "  return run_task_exit(handle_cells(Program(function* () {",
    "    const cfg = yield* cfg_cell.ask();",
    "    const step = yield* Effect.lift(from_fn(() => cfg.mul + 1));",
    "    yield* cnt_cell.modify((n) => n + step);",
    "    return yield* cnt_cell.get();",
    "  }), { cfg: provide_reader(cfg_cell, env), cnt: provide_state(cnt_cell, init) }));",
    "}",
    "export function exit_sync_arg_throw() {",
    "  const fail_env = (): { mul: number } => { throw new Error('arg-sync'); };",
    "  return run_task_exit(run_reader(Program(function* () {",
    "    const cfg = yield* ask<{ mul: number }>();",
    "    return cfg.mul;",
    "  }), fail_env()));",
    "}",
    // Q4: Standalone Do(State) & Do(Reader) with pure local prefix + eager barrier preservation
    "export function standalone_do_state(n: number) {",
    "  return Do(State, function* () {",
    "    let total = 0;",
    "    for (let i = 0; i < n; i += 1) {",
    "      const s = yield* get<number>();",
    "      yield* put<number>(s + i);",
    "      total += s;",
    "    }",
    "    return total;",
    "  });",
    "}",
    "export function standalone_do_reader(n: number) {",
    "  return Do(Reader, function* () {",
    "    let acc = 0;",
    "    for (let i = 0; i < n; i += 1) {",
    "      acc += yield* asks((e: { base: number }) => e.base + i);",
    "    }",
    "    return acc;",
    "  });",
    "}",
    "export const eager_log: string[] = [];",
    "export function standalone_do_state_eager() {",
    "  return Do(function* () {",
    "    eager_log.push('eager');",
    "    const s = yield* get<number>();",
    "    return s + 1;",
    "  });",
    "}",
    // Q5a: Validation Applicative.lift & collect
    "export function lift_validation_form(name: string, age: number, email: string, role: string) {",
    "  return Applicative.lift(",
    "    (a, b, c, d) => ({ name: a, age: b, email: c, role: d }),",
    "    name.length > 0 ? Valid(name) : InvalidMessages('name required'),",
    "    age >= 18 ? Valid(age) : InvalidMessages('must be 18+'),",
    "    email.includes('@') ? Valid(email) : InvalidMessages('invalid email'),",
    "    role.length > 0 ? Valid(role) : InvalidMessages('role required'),",
    "  );",
    "}",
    "export function collect_validation_general(a: Validation<readonly string[], number>, b: Validation<readonly string[], number>) {",
    "  return collect(Validation.with_error<readonly string[]>(), { a, b });",
    "}",
    // Q5b: IterableT.bind loop fusion
    "export function iter_bind_filter_map(xs: number[]) {",
    "  return to_array(from_array(xs).bind((x) => from_array([x, x * 2])).filter((y) => y > 4).map((y) => y + 1));",
    "}",
    "export function iter_bind_preview(xs: number[], limit: number) {",
    "  return preview(from_array(xs).bind((x) => from_array([x, x * 10])), limit);",
    "}",
    "export function iter_bind_fold_while(xs: number[], cap: number) {",
    "  return Foldable.fold_while(from_array(xs).bind((x) => from_array([x, x + 1])), 0, (acc, v) => acc + v >= cap ? ['Done', acc + v] : ['Continue', acc + v]);",
    "}",
    "export function untouched_tail_anchor(v: number) {",
    "  return v * 7;",
    "}",
  ].join("\n");

  const result = transform_do_program_source(source, "round6_fusion.ts", {
    source_map: true,
  });
  assert_equals(result.diagnostics.length, 1);
  assert_true(
    result.diagnostics[0].message.includes("observable generator statements"),
    "only standalone_do_state_eager should emit a diagnostic",
  );
  assert_true(result.map !== null, "expected V3 source map");

  // Verify Q1 elided Just/Nothing/Right/Left/from_nullable inside Do loops
  assert_true(
    !/Do\(Maybe/.test(result.code) &&
      !/Do\(Either/.test(result.code) &&
      !/from_nullable\(/.test(result.code) &&
      !/maybe_raw/.test(result.code),
    "expected Q1 Do(Maybe)/Do(Either) cond+nullable yields to elide wrappers\n\n" +
      result.code,
  );
  // Verify Q2 fused Validation & Task traverse
  assert_true(
    !/Traversable\.traverse\(/.test(result.code) &&
      !/\.traverse\(/.test(result.code) &&
      !/traverse_sequential\(/.test(result.code),
    "expected Q2 Validation and Task traverse calls to fuse\n\n" + result.code,
  );
  // Verify Q3 fused run_task_exit (except exit_sync_arg_throw which preserves sync arg throw!)
  assert_true(
    !/run_task_exit\(Do\(/.test(result.code) &&
      !/run_task_exit\(handle_cells\(/.test(result.code) &&
      result.code.includes("is_task_cancellation"),
    "expected Q3 run_task_exit calls to fuse with is_task_cancellation\n\n" +
      result.code,
  );
  // Verify Q4 fused standalone_do_state & standalone_do_reader directly into State/Reader
  assert_true(
    result.code.includes("State((state_arg_") &&
      result.code.includes("Reader((reader_arg_"),
    "expected Q4 standalone Do(State)/Do(Reader) with pure prefix to fuse\n\n" +
      result.code,
  );
  // Verify Q5a fused Applicative.lift & collect(Validation, ...)
  assert_true(
    !/Applicative\.lift\(/.test(result.code) &&
      !/\bcollect\(/.test(result.code),
    "expected Q5a Validation Applicative.lift and collect to fuse\n\n" +
      result.code,
  );
  // Verify Q5b fused IterableT.bind pipelines
  assert_true(
    !/\.bind\(/.test(result.code) &&
      !/\bto_array\(/.test(result.code) &&
      !/\bpreview\(/.test(result.code) &&
      !/Foldable\.fold_while\(/.test(result.code),
    "expected Q5b IterableT.bind pipelines to fuse into nested loops\n\n" +
      result.code,
  );

  // Verify fast-printer inline V3 source map resolves both edited and untouched lines accurately!
  const smap = new SourceMap({
    ...result.map!,
    sources: [...result.map!.sources],
    names: [...result.map!.names],
    sourcesContent: [source],
  });
  const orig_lines = source.split("\n");
  const gen_lines = result.code.split("\n");
  const orig_tail_line = orig_lines.findIndex((l) =>
    l.includes("return v * 7;")
  );
  const gen_tail_line = gen_lines.findIndex((l) => l.includes("return v * 7;"));
  assert_true(orig_tail_line > 0 && gen_tail_line > 0, "found tail anchor");
  const mapped_tail = smap.findEntry(
    gen_tail_line,
    gen_lines[gen_tail_line].indexOf("return"),
  );
  if (!("originalLine" in mapped_tail)) {
    throw new Error("Missing tail mapping");
  }
  assert_equals(mapped_tail.originalLine, orig_tail_line);
  const orig_loop_line = orig_lines.findIndex((l) => l.includes("total += b;"));
  const gen_loop_line = gen_lines.findIndex((l) => l.includes("total += b;"));
  assert_true(
    orig_loop_line > 0 && gen_loop_line > 0,
    "found edited loop body",
  );
  const mapped_loop = smap.findEntry(
    gen_loop_line,
    gen_lines[gen_loop_line].indexOf("total"),
  );
  if (!("originalLine" in mapped_loop)) {
    throw new Error("Missing edited loop mapping");
  }
  assert_equals(mapped_loop.originalLine, orig_loop_line);

  // Strict TypeScript check on generated Round 6 code!
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round6-check-",
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
        "Generated Round 6 TypeScript failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Execute generated code and verify every semantic invariant!
  const compiled = executable_typescript(result.code, "round6_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  const { Left, Right } = await import("../src/either.ts");
  const { Valid, InvalidMessages } = await import("../src/validation.ts");

  // Q1 runtime checks
  assert_equals(mod.do_maybe_cond_loop(10, 4).value(), ["Just", 92]);
  assert_equals(mod.do_maybe_cond_loop(2, 4).value(), ["Nothing"]);
  assert_equals(mod.do_maybe_nullable(10, 32).value(), ["Just", 42]);
  assert_equals(mod.do_maybe_nullable(null, 32).value(), ["Nothing"]);
  assert_equals(mod.do_maybe_nullable(10, undefined).value(), ["Nothing"]);
  assert_equals(mod.do_either_cond_loop(10, 4).value(), ["Right", 46]);
  assert_equals(mod.do_either_cond_loop(2, 4).value(), ["Left", "fail:2"]);
  assert_equals(mod.do_either_mixed(Right(5), true).value(), ["Right", 15]);
  assert_equals(mod.do_either_mixed(Right(5), false).value(), ["Left", "bad"]);
  assert_equals(mod.do_either_mixed(Left(99), true).value(), ["Left", 99]);

  // Q2a runtime checks
  const tvm_ok = mod.trav_val_messages([1, 2, 3]).value();
  assert_equals(tvm_ok[0], "valid");
  if (tvm_ok[0] === "valid") assert_equals(tvm_ok[1].value(), [2, 4, 6]);
  const tvm_bad = mod.trav_val_messages([1, -2, 3, -4]).value();
  assert_equals(tvm_bad[0], "invalid");
  if (tvm_bad[0] === "invalid") {
    assert_equals(tvm_bad[1], ["bad:-2", "bad:-4"]);
  }
  const tvw_ok = mod.trav_val_with_error([0, 2]).value();
  assert_equals(tvw_ok[0], "valid");
  if (tvw_ok[0] === "valid") assert_equals(tvw_ok[1].value(), [1, 3]);
  const tvw_bad = mod.trav_val_with_error([0, -1, -3]).value();
  assert_equals(tvw_bad[0], "invalid");
  if (tvw_bad[0] === "invalid") assert_equals(tvw_bad[1], ["neg:-1", "neg:-3"]);
  const tvc_bad = mod.trav_val_custom_sg([1, -3, -7]).value();
  assert_equals(tvc_bad[0], "invalid");
  if (tvc_bad[0] === "invalid") assert_equals(tvc_bad[1], 10);

  // Q2b runtime checks
  assert_equals((await mod.run_trav_task_sync([1, 2, 3])).value(), [3, 6, 9]);
  assert_equals((await mod.run_trav_task_sync([])).value(), []);
  assert_equals(await mod.run_trav_task_async([1, 2, 3]), [11, 12, 13]);
  const rte_ok = await mod.run_trav_task_exit([2, 3]);
  assert_equals(rte_ok.status, "succeeded");
  if (rte_ok.status === "succeeded") {
    assert_equals(rte_ok.value.value(), [4, 6]);
  }
  const rte_fail = await mod.run_trav_task_exit([2, -5, 3]);
  assert_equals(rte_fail.status, "failed");

  // Q3 runtime checks
  assert_equals(await mod.exit_do_task(10), { status: "succeeded", value: 22 });
  const ed_fail = await mod.exit_do_task(-5);
  assert_equals(ed_fail.status, "failed");
  assert_equals(await mod.exit_stacked_reader_state(3, 10), {
    status: "succeeded",
    value: [16, 16],
  });
  const es_fail = await mod.exit_stacked_reader_state(-1, 10);
  assert_equals(es_fail.status, "failed");
  const hc_ok = await mod.exit_handle_cells(4, 10);
  assert_equals(hc_ok.status, "succeeded");
  if (hc_ok.status === "succeeded") {
    assert_equals(hc_ok.value.result, 15);
    assert_equals(hc_ok.value.states, { cnt: 15 });
  }
  let sync_arg_threw = false;
  try {
    mod.exit_sync_arg_throw();
  } catch (err) {
    sync_arg_threw = err instanceof Error && err.message === "arg-sync";
  }
  assert_true(
    sync_arg_threw,
    "synchronous throw in non-pure run_task_exit argument must not be swallowed",
  );

  // Q4 runtime checks (reusable across multiple .run calls + eager prefix preserved)
  const st_prog = mod.standalone_do_state(4);
  assert_equals(st_prog.run(10), [44, 16]);
  assert_equals(st_prog.run(1), [8, 7]);
  const rd_prog = mod.standalone_do_reader(4);
  assert_equals(rd_prog.run({ base: 10 }), 46);
  assert_equals(rd_prog.run({ base: 1 }), 10);
  mod.eager_log.length = 0;
  const eager_st = mod.standalone_do_state_eager();
  assert_equals(mod.eager_log, ["eager"]);
  assert_equals(eager_st.run(41), [42, 41]);

  // Q5a runtime checks
  const form_ok = mod.lift_validation_form("Ada", 30, "a@b.c", "eng").value();
  assert_equals(form_ok, [
    "valid",
    { name: "Ada", age: 30, email: "a@b.c", role: "eng" },
  ]);
  const form_bad = mod.lift_validation_form("", 12, "nope", "").value();
  assert_equals(form_bad[0], "invalid");
  if (form_bad[0] === "invalid") {
    assert_equals(form_bad[1], [
      "name required",
      "must be 18+",
      "invalid email",
      "role required",
    ]);
  }
  assert_equals(
    mod.collect_validation_general(Valid(3), Valid(4)).value(),
    ["valid", { a: 3, b: 4 }],
  );
  const cv_bad = mod.collect_validation_general(
    InvalidMessages("e1"),
    InvalidMessages("e2"),
  ).value();
  assert_equals(cv_bad[0], "invalid");
  if (cv_bad[0] === "invalid") assert_equals(cv_bad[1], ["e1", "e2"]);

  // Q5b runtime checks
  assert_equals(mod.iter_bind_filter_map([1, 2, 3, 4]), [7, 9]);
  assert_equals(mod.iter_bind_preview([1, 2, 3, 4], 3), [1, 10, 2]);
  assert_equals(mod.iter_bind_preview([1, 2], 0), []);
  assert_equals(mod.iter_bind_fold_while([2, 3, 4], 8), 8);
});

Deno.test("round-7 post-plugin fusion covers Writer Do/dynamic tell, AsyncIterableT terminals, ParallelTask & 2-arg signal, STM untagged/atomically, named Effect/helper lift/List/Array/non-Array Foldable/Maybe-Either chains, and T1-T4 word-boundary + fast-printer source maps", async () => {
  const mod_url = new URL("../src/mod.ts", import.meta.url).href;
  const task_url = new URL("../src/task.ts", import.meta.url).href;
  const writer_url = new URL("../src/writer.ts", import.meta.url).href;
  const reader_url = new URL("../src/reader.ts", import.meta.url).href;
  const state_url = new URL("../src/state.ts", import.meta.url).href;
  const stm_url = new URL("../src/stm.ts", import.meta.url).href;
  const async_iterable_url = new URL(
    "../src/async_iterable.ts",
    import.meta.url,
  ).href;
  const array_url = new URL("../src/array.ts", import.meta.url).href;
  const list_url = new URL("../src/list.ts", import.meta.url).href;
  const maybe_url = new URL("../src/maybe.ts", import.meta.url).href;
  const either_url = new URL("../src/either.ts", import.meta.url).href;
  const typed_array_url = new URL("../src/typed_array.ts", import.meta.url)
    .href;
  const set_url = new URL("../src/set.ts", import.meta.url).href;
  const map_url = new URL("../src/map.ts", import.meta.url).href;
  const record_url = new URL("../src/record.ts", import.meta.url).href;
  const handlers_url = new URL("../src/handlers.ts", import.meta.url).href;

  // Include filler functions containing word-boundary near-miss tokens (isDone, running, getValue)
  // to verify T1 word-boundary statement skipping & T4 cached_starts V3 source maps.
  const filler_lines: string[] = [];
  for (let i = 0; i < 60; i += 1) {
    filler_lines.push(
      `export function helper_filler_${i}(isDone: boolean, running: number, getValue: () => number) { return isDone ? running : getValue() + ${i}; }`,
    );
  }

  const source = [
    `import { Applicative, collect, Do, Foldable, from_nullable, InvalidMessages, Just, Nothing, Program, Traversable, Valid } from ${
      JSON.stringify(mod_url)
    };`,
    `import { from_fn, parallel, ParallelTask, run_task, run_task_exit, sequential, Task } from ${
      JSON.stringify(task_url)
    };`,
    `import { run_writer_terminal, tell, Writer, writer_cell } from ${
      JSON.stringify(writer_url)
    };`,
    `import { reader } from ${JSON.stringify(reader_url)};`,
    `import { state } from ${JSON.stringify(state_url)};`,
    `import { atomically, modify_tvar, new_tvar, or_else, read_tvar, retry, write_tvar, type TVar } from ${
      JSON.stringify(stm_url)
    };`,
    `import { filter, filter_map, find, fold_while, from_chunks, from_factory, from_sync_factory, map_sync, preview, some, take, to_array } from ${
      JSON.stringify(async_iterable_url)
    };`,
    `import { ArrayT, from_array as array_from_array } from ${
      JSON.stringify(array_url)
    };`,
    `import { from_array as list_from_array, List, to_array as list_to_array } from ${
      JSON.stringify(list_url)
    };`,
    `import { filter as maybe_filter, get_or_else, maybe } from ${
      JSON.stringify(maybe_url)
    };`,
    `import { either, type Either, from_left, from_right, recover_or_else } from ${
      JSON.stringify(either_url)
    };`,
    `import { TypedArrayT } from ${JSON.stringify(typed_array_url)};`,
    `import { SetT } from ${JSON.stringify(set_url)};`,
    `import { MapT } from ${JSON.stringify(map_url)};`,
    `import { RecordT } from ${JSON.stringify(record_url)};`,
    `import { provide_reader, provide_state, run_cells } from ${
      JSON.stringify(handlers_url)
    };`,
    ...filler_lines,
    // R1: Writer Do / Writer.with / writer_cell / run_writer_terminal + dynamic tell
    "const w_cell = writer_cell('r7_w', ArrayT<string>([]));",
    "export function writer_do_with(xs: string[]) {",
    "  return Do(Writer.with(ArrayT<string>([])), function* () {",
    "    yield* tell(ArrayT(['head']));",
    "    yield* tell(array_from_array(xs));",
    "    return xs.length;",
    "  }).value();",
    "}",
    "export function writer_cell_do(xs: string[]) {",
    "  return Do(w_cell, function* () {",
    "    const log_var = ArrayT(xs);",
    "    yield* w_cell.tell(log_var);",
    "    return { len() { return xs.length; } }.len();",
    "  }).value();",
    "}",
    "export function writer_run_terminal(xs: string[]) {",
    "  return run_writer_terminal(Do(function* () {",
    "    yield* tell(ArrayT(xs));",
    "    return xs.length * 2;",
    "  }), ArrayT<string>([]));",
    "}",
    // R2: AsyncIterableT terminal pipelines
    "export function ai_sync_to_array(xs: number[]) {",
    "  return to_array(take(filter(map_sync(from_sync_factory(() => xs), (x) => x * 2), (y) => y > 4), 2));",
    "}",
    "export function ai_chunks_fold_while(chunks: number[][], cap: number) {",
    "  return fold_while(filter_map(from_chunks(async function* () { for (const c of chunks) yield c; }), (x) => x > 0 ? Just(x * 3) : Nothing<number>()), 0, (acc, v) => acc + v >= cap ? ['Done', acc + v] : ['Continue', acc + v]);",
    "}",
    "export function ai_factory_find(xs: number[], target: number) {",
    "  return find(from_factory(async function* () { for (const x of xs) yield await Promise.resolve(x); }).map((x) => x + 1), (x) => x === target);",
    "}",
    "export function ai_preview_some(xs: number[]) {",
    "  return Promise.all([preview(from_sync_factory(() => xs).map((x) => x * 10), 2), some(from_sync_factory(() => xs), (x) => x === 3)]);",
    "}",
    "export function ai_take_neg(xs: number[]) {",
    "  return to_array(take(from_sync_factory(() => xs), -1));",
    "}",
    "export function ai_take_zero(on_open: () => void) {",
    "  return to_array(take(from_sync_factory(() => { on_open(); return [1, 2]; }), 0));",
    "}",
    // R3: ParallelTask + untagged Task Do + 2-arg signal
    "export function par_traverse_run(xs: number[]) {",
    "  return run_task(sequential(Traversable.traverse(ArrayT(xs), ParallelTask, (x) => parallel(from_fn(() => Promise.resolve(x * 2))))));",
    "}",
    "export function par_lift_run(a: number, b: number) {",
    "  return run_task(sequential(Applicative.lift((x, y) => x + y, parallel(from_fn(() => a)), parallel(from_fn(() => Promise.resolve(b))))));",
    "}",
    "export function par_collect_run(a: number, b: number) {",
    "  return run_task(sequential(collect(ParallelTask, { x: parallel(from_fn(() => a)), y: parallel(from_fn(() => b * 2)) })));",
    "}",
    "export function task_untagged_signal(x: number, signal?: AbortSignal) {",
    "  return run_task(Do(function* () {",
    "    const a = yield* from_fn(() => x + 1);",
    "    const b = yield* from_fn(() => Promise.resolve(a * 2));",
    "    return b;",
    "  }), { signal });",
    "}",
    "export function task_exit_signal(x: number, signal?: AbortSignal) {",
    "  return run_task_exit(Do(Task, function* () {",
    "    const a = yield* from_fn(() => Promise.resolve(x + 5));",
    "    return a;",
    "  }), { signal });",
    "}",
    // R4: Untagged STM Do & atomically(Do(...))
    "export function make_r7_tvar(v: number) { return new_tvar(v); }",
    "export function stm_untagged_atomically(tv: TVar<number>, n: number) {",
    "  return atomically(Do(function* () {",
    "    let acc = yield* read_tvar(tv);",
    "    yield* write_tvar(tv, acc + 1);",
    "    for (let i = 1; i < n; i += 1) {",
    "      const cur = yield* read_tvar(tv);",
    "      yield* write_tvar(tv, cur + 1);",
    "      acc += cur;",
    "    }",
    "    return acc;",
    "  }));",
    "}",
    "export function stm_untagged_retry(tv: TVar<number>) {",
    "  return atomically(or_else(Do(function* () {",
    "    yield* modify_tvar(tv, (x) => x + 100);",
    "    const cur = yield* read_tvar(tv);",
    "    if (cur < 1000) return yield* retry<number>();",
    "    return cur;",
    "  }), read_tvar(tv)));",
    "}",
    // R5: Named top-level Program, helper-returning Validation lift, List/Array from_array, non-Array Foldable, Maybe/Either chains
    "const r7_cfg = reader<{ mul: number }>()('r7_cfg');",
    "const r7_cnt = state<number>()('r7_cnt');",
    "const named_cell_prog = Program(function* () {",
    "  const cfg = yield* r7_cfg.ask();",
    "  yield* r7_cnt.modify((n) => n + cfg.mul);",
    "  return yield* r7_cnt.get();",
    "});",
    "export function run_named_cell_prog(mul: number, init: number) {",
    "  return run_cells(named_cell_prog, {",
    "    cfg: provide_reader(r7_cfg, { mul }),",
    "    cnt: provide_state(r7_cnt, init),",
    "  });",
    "}",
    "function check_non_empty(s: string) {",
    "  return s.length > 0 ? Valid(s) : InvalidMessages<string>('empty');",
    "}",
    "export function lift_helper_validation(a: string, b: string) {",
    "  return Applicative.lift(",
    "    (x, y): { x: string; y: string } => ({ x, y }),",
    "    check_non_empty(a),",
    "    check_non_empty(b),",
    "  );",
    "}",
    "export function list_comp(xs: number[], ys: number[]) {",
    "  return list_to_array(Do(List, function* () {",
    "    const x = yield* list_from_array(xs);",
    "    const y = yield* list_from_array(ys);",
    "    return x + y;",
    "  }));",
    "}",
    "function add_pair(acc: number, x: number): number { return acc + x; }",
    "export function fold_fn_ref(xs: number[]) {",
    "  return Foldable.fold(array_from_array(xs), 0, add_pair);",
    "}",
    "export function fold_typed_array(xs: Int32Array) {",
    "  return Foldable.fold(TypedArrayT(xs), 0, (acc, n) => acc + n);",
    "}",
    "export function fold_set(s: Set<number>) {",
    "  return Foldable.fold(SetT(s), 0, (acc, n) => acc + n);",
    "}",
    "export function fold_map_vals(m: Map<string, number>) {",
    "  return Foldable.fold(MapT(m), 0, (acc, n) => acc + n);",
    "}",
    "export function fold_record_vals(r: Record<string, number>) {",
    "  return Foldable.fold(RecordT(r), 0, (acc, n) => acc + n);",
    "}",
    "export function fold_set_mutating_callback(s: Set<number>) {",
    "  return Foldable.fold(SetT(s), 0, (acc, n) => { s.add(n + 100); return acc + n; });",
    "}",
    "export function maybe_chain_r7(x: number | null) {",
    "  return get_or_else(maybe_filter(from_nullable(x).map((n) => n * 2), (n) => n > 5), () => -1);",
    "}",
    "export function maybe_fold_r7(x: number | null) {",
    "  return maybe('none', (n) => `val:${n}`, from_nullable(x).map((n) => n + 1));",
    "}",
    "export function either_chain_r7(e: Either<string, number>) {",
    "  return recover_or_else(e.map((n) => n + 10), (err) => err.length);",
    "}",
    "export function either_fold_r7(e: Either<string, number>) {",
    "  return [from_right(0, e.map((n) => n * 2)), from_left('ok', e.map((n) => n + 1)), either((l) => `L:${l}`, (r) => `R:${r}`, e.map((n) => n + 1))];",
    "}",
    "export function r7_tail_anchor(v: number) {",
    "  return v + 13;",
    "}",
  ].join("\n");

  const result = transform_do_program_source(source, "round7_fusion.ts", {
    source_map: true,
  });
  assert_equals(result.diagnostics, []);
  assert_true(result.map !== null, "expected V3 source map");

  // Structural checks for R1–R5 fusions
  assert_true(
    !/Do\(Writer\.with/.test(result.code) &&
      !/Do\(w_cell/.test(result.code) &&
      !/run_writer_terminal\(Do\(/.test(result.code),
    "expected R1 Writer Do & dynamic tell fusions\n\n" + result.code,
  );
  assert_true(
    !/\bto_array\(take\(/.test(result.code) &&
      !/\bfold_while\(filter_map\(/.test(result.code) &&
      !/\bfind\(from_factory\(/.test(result.code) &&
      !/\bpreview\(from_sync_factory\(/.test(result.code) &&
      !/\bsome\(from_sync_factory\(/.test(result.code),
    "expected R2 AsyncIterableT terminal pipelines to fuse\n\n" + result.code,
  );
  assert_true(
    !/Traversable\.traverse\(/.test(result.code) &&
      !/collect\(ParallelTask/.test(result.code) &&
      !/run_task\(Do\(/.test(result.code) &&
      !/run_task_exit\(Do\(/.test(result.code) &&
      result.code.includes("task_check_signal") &&
      result.code.includes("task_await_signal"),
    "expected R3 ParallelTask and 2-arg signal fusions\n\n" + result.code,
  );
  assert_true(
    result.code.includes("stm_atomically_direct") &&
      result.code.includes("stm_trusted") &&
      result.code.includes("stm_read_journal") &&
      result.code.includes("stm_write_journal") &&
      result.code.includes("stm_modify_journal"),
    "expected R4 STM trusted/direct journal fusions\n\n" + result.code,
  );
  assert_true(
    !/run_cells\(named_cell_prog/.test(result.code) &&
      !/Applicative\.lift\(/.test(result.code) &&
      !/Do\(List/.test(result.code) &&
      !/Foldable\.fold\(array_from_array/.test(result.code) &&
      !/Foldable\.fold\(TypedArrayT/.test(result.code) &&
      !/Foldable\.fold\(MapT/.test(result.code) &&
      !/Foldable\.fold\(RecordT/.test(result.code) &&
      !/get_or_else\(/.test(result.code) &&
      !/recover_or_else\(/.test(result.code) &&
      !/\bfrom_right\(/.test(result.code),
    "expected R5 fusions across named cells, helper lift, List, non-Array Foldable, and Maybe/Either\n\n" +
      result.code,
  );
  // Clone-safety invariant: fold_set_mutating_callback must NOT fuse directly over mutable Set
  assert_true(
    result.code.includes("Foldable.fold(SetT(s)"),
    "expected mutating SetT callback to remain unfused for snapshot safety\n\n" +
      result.code,
  );

  // V3 source-map verification (including cached_starts across skipped filler statements)
  const smap = new SourceMap({
    ...result.map!,
    sources: [...result.map!.sources],
    names: [...result.map!.names],
    sourcesContent: [source],
  });
  const orig_lines = source.split("\n");
  const gen_lines = result.code.split("\n");
  const orig_filler_line = orig_lines.findIndex((l) =>
    l.includes("helper_filler_50")
  );
  const gen_filler_line = gen_lines.findIndex((l) =>
    l.includes("helper_filler_50")
  );
  assert_true(orig_filler_line > 0 && gen_filler_line > 0, "found filler line");
  const mapped_filler = smap.findEntry(
    gen_filler_line,
    gen_lines[gen_filler_line].indexOf("helper_filler_50"),
  );
  assert_true(
    "originalLine" in mapped_filler &&
      mapped_filler.originalLine === orig_filler_line,
    "expected skipped filler line to map accurately",
  );
  const orig_tail_line = orig_lines.findIndex((l) =>
    l.includes("return v + 13;")
  );
  const gen_tail_line = gen_lines.findIndex((l) =>
    l.includes("return v + 13;")
  );
  const mapped_tail = smap.findEntry(
    gen_tail_line,
    gen_lines[gen_tail_line].indexOf("return"),
  );
  assert_true(
    "originalLine" in mapped_tail &&
      mapped_tail.originalLine === orig_tail_line,
    "expected untouched tail line to map accurately",
  );

  // Strict TypeScript check on generated Round 7 code
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-round7-check-",
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
        "Generated Round 7 TypeScript failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Execute generated code and verify every semantic invariant
  const compiled = executable_typescript(result.code, "round7_fusion.ts");
  const mod = await import(
    "data:application/javascript," + encodeURIComponent(compiled)
  );
  const { Left, Right } = await import("../src/either.ts");

  // R1 runtime checks
  const [wd_v, wd_log] = mod.writer_do_with(["a", "b"]);
  assert_equals(wd_v, 2);
  assert_equals(wd_log.value(), ["head", "a", "b"]);
  const [wc_v, wc_log] = mod.writer_cell_do(["x", "y", "z"]);
  assert_equals(wc_v, 3);
  assert_equals(wc_log.value(), ["x", "y", "z"]);
  const [wt_v, wt_log] = mod.writer_run_terminal(["p", "q"]);
  assert_equals(wt_v, 4);
  assert_equals(wt_log.value(), ["p", "q"]);

  // R2 runtime checks
  assert_equals(await mod.ai_sync_to_array([1, 2, 3, 4, 5]), [6, 8]);
  assert_equals(
    await mod.ai_chunks_fold_while([[1, -2, 3], [4, 5]], 20),
    24,
  );
  assert_equals((await mod.ai_factory_find([1, 2, 3], 3)).value(), ["Just", 3]);
  assert_equals((await mod.ai_factory_find([1, 2, 3], 99)).value(), [
    "Nothing",
  ]);
  assert_equals(await mod.ai_preview_some([1, 2, 3, 4]), [[10, 20], true]);
  let neg_threw_sync = false;
  try {
    mod.ai_take_neg([1, 2]);
  } catch (err) {
    neg_threw_sync = err instanceof RangeError;
  }
  assert_true(
    neg_threw_sync,
    "take(-1) must throw RangeError synchronously before returning a Promise",
  );
  let opened = false;
  assert_equals(
    await mod.ai_take_zero(() => {
      opened = true;
    }),
    [],
  );
  assert_equals(opened, false);

  // R3 runtime checks
  assert_equals((await mod.par_traverse_run([2, 3, 4])).value(), [4, 6, 8]);
  assert_equals(await mod.par_lift_run(10, 32), 42);
  assert_equals(await mod.par_collect_run(5, 6), { x: 5, y: 12 });
  assert_equals(await mod.task_untagged_signal(10), 22);
  const ac = new AbortController();
  ac.abort(new Error("r7-abort"));
  const exit_ok = await mod.task_exit_signal(7);
  assert_equals(exit_ok, { status: "succeeded", value: 12 });
  const exit_cancel = await mod.task_exit_signal(7, ac.signal);
  assert_equals(exit_cancel.status, "cancelled");
  let rej_cancel = false;
  try {
    await mod.task_untagged_signal(10, ac.signal);
  } catch {
    rej_cancel = true;
  }
  assert_true(rej_cancel, "aborted signal must reject run_task");

  // R4 runtime checks
  const tv = mod.make_r7_tvar(0);
  assert_equals(mod.stm_untagged_atomically(tv, 5), 10);
  assert_equals(mod.stm_untagged_retry(tv), 5);
  assert_equals(mod.stm_untagged_atomically(tv, 3), 18);

  // R5 runtime checks
  const ncp = mod.run_named_cell_prog(4, 10);
  assert_equals(ncp.result, 14);
  assert_equals(ncp.states, { cnt: 14 });
  assert_equals(mod.lift_helper_validation("hi", "there").value(), [
    "valid",
    { x: "hi", y: "there" },
  ]);
  const lhv_bad = mod.lift_helper_validation("", "").value();
  assert_equals(lhv_bad[0], "invalid");
  if (lhv_bad[0] === "invalid") assert_equals(lhv_bad[1], ["empty", "empty"]);
  assert_equals(mod.list_comp([1, 2], [10, 20]), [11, 21, 12, 22]);
  assert_equals(mod.fold_fn_ref([1, 2, 3, 4]), 10);
  assert_equals(mod.fold_typed_array(new Int32Array([2, 4, 6])), 12);
  assert_equals(mod.fold_set(new Set([3, 5, 7])), 15);
  assert_equals(mod.fold_map_vals(new Map([["a", 4], ["b", 9]])), 13);
  assert_equals(mod.fold_record_vals({ a: 2, b: 8, c: 5 }), 15);
  const mut_set = new Set([1, 2, 3]);
  assert_equals(mod.fold_set_mutating_callback(mut_set), 6);
  assert_equals(mut_set.size, 6);
  assert_equals(mod.maybe_chain_r7(4), 8);
  assert_equals(mod.maybe_chain_r7(2), -1);
  assert_equals(mod.maybe_chain_r7(null), -1);
  assert_equals(mod.maybe_fold_r7(4), "val:5");
  assert_equals(mod.maybe_fold_r7(null), "none");
  assert_equals(mod.either_chain_r7(Right(5)), 15);
  assert_equals(mod.either_chain_r7(Left("oops")), 4);
  assert_equals(mod.either_fold_r7(Right(3)), [6, "ok", "R:4"]);
  assert_equals(mod.either_fold_r7(Left("bad")), [0, "bad", "L:bad"]);
});

Deno.test("round-7 codex differential parity: named Program param capture, ParallelTask sync-throw & signal prefix order, STM prefix/zero-yield, snapshot vs live array, AsyncIterable thenable/return/shadowed-Just, and $-prefixed alias scanning", async () => {
  const mod_url = new URL("../src/mod.ts", import.meta.url).href;
  const task_url = new URL("../src/task.ts", import.meta.url).href;
  const reader_url = new URL("../src/reader.ts", import.meta.url).href;
  const stm_url = new URL("../src/stm.ts", import.meta.url).href;
  const async_iterable_url = new URL(
    "../src/async_iterable.ts",
    import.meta.url,
  ).href;
  const array_url = new URL("../src/array.ts", import.meta.url).href;
  const list_url = new URL("../src/list.ts", import.meta.url).href;
  const handlers_url = new URL("../src/handlers.ts", import.meta.url).href;

  const fillers = Array.from(
    { length: 20 },
    (_, i) => `export function pad_${i}(v: number) { return v + ${i}; }`,
  );

  const source = [
    `import { Applicative, Do as $d, Foldable, Just, Program } from ${
      JSON.stringify(mod_url)
    };`,
    `import { from_fn, parallel, run_task, run_task_exit, sequential, succeed, Task } from ${
      JSON.stringify(task_url)
    };`,
    `import { reader } from ${JSON.stringify(reader_url)};`,
    `import { atomically, new_tvar, read_tvar, Stm, type TVar } from ${
      JSON.stringify(stm_url)
    };`,
    `import { find, from_sync_factory, to_array } from ${
      JSON.stringify(async_iterable_url)
    };`,
    `import { ArrayT, from_array as array_from_array } from ${
      JSON.stringify(array_url)
    };`,
    `import { from_array as list_from_array, List, to_array as list_to_array } from ${
      JSON.stringify(list_url)
    };`,
    `import { provide_reader, run_cells } from ${
      JSON.stringify(handlers_url)
    };`,
    ...fillers,
    // 1. Named Program closing over module-level `n = 3` run inside function with parameter `n`
    "const cfg_c = reader<{ mul: number }>()('cdx_cfg');",
    "const n = 3;",
    "const cap_prog = Program(function* () { const c = yield* cfg_c.ask(); return c.mul + n; });",
    "export function run_param_shadow(n: number) {",
    "  return run_cells(cap_prog, { cfg: provide_reader(cfg_c, { mul: 2 }) }).result + (n * 0);",
    "}",
    // 2a. ParallelTask branch 0 sync throw still starts branch 1
    "export async function par_sync_throw_order(trace: string[]) {",
    "  try {",
    "    await run_task(sequential(Applicative.lift(",
    "      (a: number, b: number) => a + b,",
    "      parallel(from_fn((): number => { trace.push('b0'); throw new Error('boom'); })),",
    "      parallel(from_fn(() => { trace.push('b1'); return 2; })),",
    "    )));",
    "  } catch {",
    "    // expected",
    "  }",
    "}",
    // 2b. run_task_exit(Do, { signal }) preserves eager prefix before signal expression
    "export function task_exit_prefix_order(trace: string[], sig: AbortSignal) {",
    "  const get_sig = () => { trace.push('signal'); return sig; };",
    "  return run_task_exit($d(Task, function* () {",
    "    trace.push('prefix');",
    "    return yield* succeed(1);",
    "  }), { signal: get_sig() });",
    "}",
    // 3a. Standalone Do(Stm) preserves construction-time eager prefix
    "export function stm_eager_prefix(trace: string[]) {",
    "  const tv = new_tvar(4);",
    "  const tx = $d(Stm, function* () { trace.push('stm-prefix'); return yield* read_tvar(tv); });",
    "  const before = trace.slice();",
    "  const val = atomically(tx);",
    "  return { before, val };",
    "}",
    // 3b. Untagged STM Do returning before first yield still throws
    "export function stm_untagged_zero_yield(tv: TVar<number>, early: boolean) {",
    "  return atomically($d(function* () { if (early) return 7; return yield* read_tvar(tv); }));",
    "}",
    "export function mk_tv(v: number) { return new_tvar(v); }",
    // 4a. from_array snapshot parity during fold
    "export function fold_from_array_snapshot(xs: number[]) {",
    "  return Foldable.fold(array_from_array(xs), 0, (acc, x) => { xs[1] = 100; return acc + x; });",
    "}",
    // 4b. list.from_array snapshot parity during Do(List) comprehension
    "export function list_from_array_snapshot(xs: number[]) {",
    "  return list_to_array($d(List, function* () { const x = yield* list_from_array(xs); xs[1] = 99; return x; }));",
    "}",
    // 4c. ArrayT live iteration sees push during fold
    "export function fold_array_t_live_push(xs: number[]) {",
    "  return Foldable.fold(ArrayT(xs), 0, (acc, x) => { if (x === 1) xs.push(3); return acc + x; });",
    "}",
    // 5a. AsyncIterable .map returning object-literal thenable resolves it
    "export function ai_object_thenable(xs: number[]) {",
    "  return to_array(from_sync_factory(() => xs).map((x) => ({ then(resolve: (v: number) => void) { resolve(x * 10); } })));",
    "}",
    // 5b. AsyncIterable throwing next() calls return() once
    "export async function ai_throwing_next_cleanup() {",
    "  let returns = 0;",
    "  const src: Iterable<number> = { [Symbol.iterator]() { return { next() { throw new Error('next-boom'); }, return() { returns += 1; return { done: true, value: undefined }; } }; } };",
    "  try { await to_array(from_sync_factory(() => src).map((x) => x + 1)); } catch { /* expected */ }",
    "  return returns;",
    "}",
    // 5c. AsyncIterable find with local parameter shadowing Just
    "export function ai_find_shadowed_just(xs: number[], Just: number) {",
    "  return find(from_sync_factory(() => xs), (x) => x === Just);",
    "}",
    // 8. $-prefixed Do alias ($d) with 20 filler functions still gets scanned and rewritten
    "export function dollar_alias_do(x: number) {",
    "  return $d(function* () { const a = yield* Just(x); return a + 1; });",
    "}",
  ].join("\n");

  const result = transform_do_program_source(source, "round7_codex_parity.ts", {
    source_map: true,
  });
  assert_equals(result.diagnostics.length, 3);
  // Ensure `$d` alias was actually recognized by candidate scanning and rewritten!
  assert_true(
    !/\$d\(function\* \(\) \{ const a = yield\* Just\(x\)/.test(result.code),
    "expected $-prefixed Do alias to be rewritten under candidate scanning\n\n" +
      result.code,
  );

  // Strict deno check on generated TS (specifically catches shadowed `Just` parameter!)
  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-r7-codex-check-",
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
        "Generated Codex parity TS failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  // Differential comparison: transformed vs original unfused execution!
  const mod_orig = await import(
    "data:application/javascript," +
      encodeURIComponent(executable_typescript(source, "codex_orig.ts"))
  );
  const mod_tx = await import(
    "data:application/javascript," +
      encodeURIComponent(executable_typescript(result.code, "codex_tx.ts"))
  );

  // 1. Named Program parameter shadowing
  assert_equals(mod_tx.run_param_shadow(10), 5);
  assert_equals(mod_tx.run_param_shadow(10), mod_orig.run_param_shadow(10));

  // 2a. ParallelTask sync throw startup order
  const t_orig: string[] = [];
  const t_tx: string[] = [];
  await mod_orig.par_sync_throw_order(t_orig);
  await mod_tx.par_sync_throw_order(t_tx);
  assert_equals(t_tx, ["b0", "b1"]);
  assert_equals(t_tx, t_orig);

  // 2b. run_task_exit eager prefix vs signal evaluation order
  const ac = new AbortController();
  ac.abort(new Error("pre"));
  const p_orig: string[] = [];
  const p_tx: string[] = [];
  const r_orig = await mod_orig.task_exit_prefix_order(p_orig, ac.signal);
  const r_tx = await mod_tx.task_exit_prefix_order(p_tx, ac.signal);
  assert_equals(p_tx, ["prefix", "signal"]);
  assert_equals(p_tx, p_orig);
  assert_equals(r_tx.status, r_orig.status);

  // 3a. STM eager prefix
  const s_orig: string[] = [];
  const s_tx: string[] = [];
  assert_equals(
    mod_tx.stm_eager_prefix(s_tx),
    mod_orig.stm_eager_prefix(s_orig),
  );
  assert_equals(mod_tx.stm_eager_prefix([]).before, ["stm-prefix"]);

  // 3b. Untagged STM zero-yield throws
  const tv_tx = mod_tx.mk_tv(1);
  let threw_zero = false;
  try {
    mod_tx.stm_untagged_zero_yield(tv_tx, true);
  } catch (err) {
    threw_zero = err instanceof Error &&
      err.message.includes("Do requires at least one yielded value");
  }
  assert_true(threw_zero, "untagged STM Do with early return must throw");

  // 4a, 4b, 4c. Snapshot vs live array iteration
  assert_equals(mod_tx.fold_from_array_snapshot([1, 2]), 3);
  assert_equals(mod_tx.list_from_array_snapshot([1, 2]), [1, 2]);
  assert_equals(mod_tx.fold_array_t_live_push([1, 2]), 6);

  // 5a, 5b, 5c. AsyncIterable object thenable, throwing next() return(), shadowed Just
  assert_equals(await mod_tx.ai_object_thenable([1, 2]), [10, 20]);
  assert_equals(await mod_tx.ai_throwing_next_cleanup(), 1);
  assert_equals((await mod_tx.ai_find_shadowed_just([1, 2, 3], 2)).value(), [
    "Just",
    2,
  ]);

  // 8. $-prefixed Do alias
  assert_equals(mod_tx.dollar_alias_do(41).value(), ["Just", 42]);
});

Deno.test("Wave 2 transformer fusions preserve differential parity and strict TypeScript checking", async () => {
  const mod_url = new URL("../src/mod.ts", import.meta.url).href;
  const array_url = new URL("../src/array.ts", import.meta.url).href;
  const prelude_url = new URL("../src/prelude.ts", import.meta.url).href;
  const list_url = new URL("../src/list.ts", import.meta.url).href;
  const task_url = new URL("../src/task.ts", import.meta.url).href;
  const stm_url = new URL("../src/stm.ts", import.meta.url).href;
  const source = [
    `import { Do, Just, Left, List, Maybe, Nothing, Right, field, define_union, match } from ${
      JSON.stringify(mod_url)
    };`,
    `import { ArrayT } from ${JSON.stringify(array_url)};`,
    `import { fmap, foldl, fold_while, length, sum, product, to_array as p_to_array, some as p_some, find as p_find } from ${
      JSON.stringify(prelude_url)
    };`,
    `import { from_array as list_from_array, to_array as list_to_array } from ${
      JSON.stringify(list_url)
    };`,
    `import { Task, from_fn, from_promise, run_task, traverse_task } from ${
      JSON.stringify(task_url)
    };`,
    `import { Stm, atomically, modify_tvar, new_tvar, or_else, read_tvar, retry, write_tvar } from ${
      JSON.stringify(stm_url)
    };`,
    "const shape_id: unique symbol = Symbol('Shape');",
    "const Shape = define_union(shape_id, ['Circle', field<number>()], ['Rect', field<number>(), field<number>()]);",
    "export function list_to_array_do(xs: number[], ys: number[]) {",
    "  return list_to_array(Do(List, function* () {",
    "    const x = yield* list_from_array(xs);",
    "    const y = yield* list_from_array(ys);",
    "    return x * 10 + y;",
    "  }));",
    "}",
    "export function prelude_fusions(xs: number[]) {",
    "  const a = ArrayT(xs);",
    "  return {",
    "    sum: sum(ArrayT(xs).map((n: number) => n * 2)),",
    "    fmap_val: fmap((n: number) => n * 2, a).value(),",
    "    prod: product(a),",
    "    len: length(a),",
    "    arr: p_to_array(ArrayT(xs).map((n: number) => n + 1)),",
    "    folded: foldl((acc: number, n: number) => acc + n, 0, a),",
    "    while_sum: fold_while(a, 0, (acc: number, n: number) => acc + n >= 6 ? ['Done', acc + n] : ['Continue', acc + n]),",
    "    has_even: p_some(a, (n: number) => n % 2 === 0),",
    "    first_big: p_find(a, (n: number) => n > 2),",
    "  };",
    "}",
    "export function custom_match_fusion(r: number, w: number, h: number) {",
    "  const raw: readonly ['Circle', number] | readonly ['Rect', number, number] = r > 0 ? ['Circle', r] : ['Rect', w, h];",
    "  const rc = Shape.Rect(w, h);",
    "  const a = match(raw, { Circle: (rad: number) => rad * rad, Rect: (x: number, y: number) => x * y });",
    "  const b = rc.match({ Circle: (rad: number) => rad, Rect: (x: number, y: number) => x + y });",
    "  return a + b;",
    "}",
    "export function standalone_task_do(x: number) {",
    "  const t = Do(Task, function* () {",
    "    const a = yield* from_fn(() => x + 1);",
    "    const b = yield* from_promise(Promise.resolve(a * 2));",
    "    return b + 3;",
    "  });",
    "  return run_task(t);",
    "}",
    "export function task_traverse_fusion(xs: number[]) {",
    "  return run_task(traverse_task(xs, 2, (n) => from_fn(() => n * 5)));",
    "}",
    "export function stm_retry_and_direct(init: number) {",
    "  const tv = new_tvar(init);",
    "  const v = atomically(or_else(",
    "    Do(Stm, function* () {",
    "      yield* write_tvar(tv, -1);",
    "      return yield* retry<number>();",
    "    }),",
    "    Do(Stm, function* () {",
    "      yield* modify_tvar(tv, (n) => n + 10);",
    "      return yield* read_tvar(tv);",
    "    }),",
    "  ));",
    "  return [v, atomically(read_tvar(tv))];",
    "}",
    "export function maybe_either_keep(x: number) {",
    "  return [Just(x).map((n) => n + 1).value(), Left('e').value(), Right(x).value(), Nothing().value(), Maybe.pure(x).value()];",
    "}",
  ].join("\n");

  const result = transform_do_program_source(source, "round7_wave2_parity.ts", {
    source_map: true,
  });
  assert_equals(result.diagnostics.length, 0);
  assert_true(result.transformed > 0, "expected Wave 2 fusions to transform");

  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-r7-wave2-check-",
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
        "Generated Wave 2 parity TS failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  const mod_orig = await import(
    "data:application/javascript," +
      encodeURIComponent(executable_typescript(source, "wave2_orig.ts"))
  );
  const mod_tx = await import(
    "data:application/javascript," +
      encodeURIComponent(executable_typescript(result.code, "wave2_tx.ts"))
  );

  assert_equals(
    mod_tx.list_to_array_do([1, 2], [3, 4]),
    mod_orig.list_to_array_do([1, 2], [3, 4]),
  );
  assert_equals(
    mod_tx.list_to_array_do([], [3, 4]),
    mod_orig.list_to_array_do([], [3, 4]),
  );
  assert_equals(
    mod_tx.prelude_fusions([1, 2, 3, 4]),
    mod_orig.prelude_fusions([1, 2, 3, 4]),
  );
  assert_equals(
    mod_tx.custom_match_fusion(3, 4, 5),
    mod_orig.custom_match_fusion(3, 4, 5),
  );
  assert_equals(
    await mod_tx.standalone_task_do(10),
    await mod_orig.standalone_task_do(10),
  );
  assert_equals(
    await mod_tx.task_traverse_fusion([1, 2, 3]),
    await mod_orig.task_traverse_fusion([1, 2, 3]),
  );
  assert_equals(
    mod_tx.stm_retry_and_direct(5),
    mod_orig.stm_retry_and_direct(5),
  );
  assert_equals(
    mod_tx.maybe_either_keep(7),
    mod_orig.maybe_either_keep(7),
  );
});

Deno.test("Codex Wave 2 transformer review regressions (Task eager construction, shadowed intrinsics, ArrayT concat snapshot)", async () => {
  const mod_url = new URL("../src/mod.ts", import.meta.url).href;
  const array_url = new URL("../src/array.ts", import.meta.url).href;
  const task_url = new URL("../src/task.ts", import.meta.url).href;
  const source = [
    `import { Applicative, Do } from ${JSON.stringify(mod_url)};`,
    `import { ArrayT, from_array } from ${JSON.stringify(array_url)};`,
    `import { Task, from_fn, from_promise, parallel, run_task, succeed, traverse_task } from ${
      JSON.stringify(task_url)
    };`,
    "export async function eager_task_lift() {",
    "  const trace: string[] = [];",
    "  const hit = (label: string) => { trace.push(label); return trace.length; };",
    "  const add = (a: number, b: number) => a + b;",
    "  const t = Applicative.lift(add, succeed(hit('pure')), from_fn(() => hit('run')));",
    "  trace.push('built');",
    "  const value = await run_task(t);",
    "  return { trace, value };",
    "}",
    "export async function eager_parallel_lift() {",
    "  const trace: string[] = [];",
    "  const hit = (label: string) => { trace.push(label); return trace.length; };",
    "  const add = (a: number, b: number) => a + b;",
    "  const pt = Applicative.lift(add, parallel(succeed(hit('pure'))), parallel(from_fn(() => hit('run'))));",
    "  trace.push('built');",
    "  const value = await run_task(pt);",
    "  return { trace, value };",
    "}",
    "export async function eager_lift_before_signal() {",
    "  const trace: string[] = [];",
    "  const ctrl = new AbortController();",
    "  const hit = (label: string) => { trace.push(label); return trace.length; };",
    "  const get_sig = () => { trace.push('sig'); return ctrl.signal; };",
    "  const add = (a: number, b: number) => a + b;",
    "  const value = await run_task(",
    "    Applicative.lift(add, succeed(hit('pure')), from_fn(() => hit('run'))),",
    "    { signal: get_sig() },",
    "  );",
    "  return { trace, value };",
    "}",
    "export async function eager_fluent_chain() {",
    "  const trace: string[] = [];",
    "  const make_cb = () => {",
    "    trace.push('make_cb');",
    "    return () => { trace.push('run_cb'); return 10; };",
    "  };",
    "  const t = from_fn(make_cb()).map((n) => n + 5);",
    "  trace.push('built');",
    "  const value = await run_task(t);",
    "  return { trace, value };",
    "}",
    "export async function eager_standalone_do_promise() {",
    "  const trace: string[] = [];",
    "  const make_promise = () => { trace.push('make_p'); return Promise.resolve(42); };",
    "  const t = Do(Task, function* () {",
    "    return yield* from_promise(make_promise());",
    "  });",
    "  trace.push('built');",
    "  const value = await run_task(t);",
    "  return { trace, value };",
    "}",
    "export function shadowed_array_traverse(",
    "  Array: { isArray(v: unknown): boolean },",
    "  xs: number[],",
    ") {",
    "  return run_task(traverse_task(xs, 2, (n) => from_fn(() => n * 3)));",
    "}",
    "export function concat_snapshot_and_view() {",
    "  const xs = [1, 2];",
    "  const snap = from_array(xs).concat(ArrayT((xs[0] = 9, [3]))).value();",
    "  const ys = [1, 2];",
    "  const view = ArrayT(ys).concat(ArrayT((ys[0] = 9, [3]))).value();",
    "  return { snap, view };",
    "}",
  ].join("\n");

  const result = transform_do_program_source(
    source,
    "round7_codex_wave2_regs.ts",
    { source_map: true },
  );
  assert_true(
    result.diagnostics.every((d) => d.message.startsWith("Skipped")),
    "expected only skip diagnostics for unsafe standalone Do first-yield",
  );
  assert_true(
    result.transformed >= 5,
    "expected safe Task/ArrayT fusions to transform",
  );

  const temp_file = await Deno.makeTempFile({
    prefix: "typeclasses-r7-codex-w2-",
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
        "Generated Codex Wave 2 regression TS failed deno check:\n" +
          new TextDecoder().decode(check.stderr) + "\n\n" + result.code,
      );
    }
  } finally {
    await Deno.remove(temp_file);
  }

  const mod_orig = await import(
    "data:application/javascript," +
      encodeURIComponent(executable_typescript(source, "cw2_orig.ts"))
  );
  const mod_tx = await import(
    "data:application/javascript," +
      encodeURIComponent(executable_typescript(result.code, "cw2_tx.ts"))
  );

  assert_equals(
    await mod_tx.eager_task_lift(),
    await mod_orig.eager_task_lift(),
  );
  assert_equals(
    await mod_tx.eager_parallel_lift(),
    await mod_orig.eager_parallel_lift(),
  );
  assert_equals(
    await mod_tx.eager_lift_before_signal(),
    await mod_orig.eager_lift_before_signal(),
  );
  assert_equals(
    await mod_tx.eager_fluent_chain(),
    await mod_orig.eager_fluent_chain(),
  );
  assert_equals(
    await mod_tx.eager_standalone_do_promise(),
    await mod_orig.eager_standalone_do_promise(),
  );
  const hostile_array = {
    isArray(): boolean {
      throw new Error("shadowed Array parameter should not be called");
    },
  };
  assert_equals(
    await mod_tx.shadowed_array_traverse(hostile_array, [1, 2, 3]),
    await mod_orig.shadowed_array_traverse(hostile_array, [1, 2, 3]),
  );
  assert_equals(
    mod_tx.concat_snapshot_and_view(),
    mod_orig.concat_snapshot_and_view(),
  );
  assert_equals(mod_tx.concat_snapshot_and_view().snap, [1, 2, 3]);
  assert_equals(mod_tx.concat_snapshot_and_view().view, [9, 2, 3]);
});

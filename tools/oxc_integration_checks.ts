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

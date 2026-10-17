import ts from "typescript";
import { assert_equals, assert_true } from "../src/assert.ts";
import {
  create_transform_cache,
  transform_do_program_source,
} from "./transform_do_program.ts";

async function evaluate(source: string): Promise<unknown> {
  const absolute = source.replaceAll(
    /\.\.\/src\/([a-z_]+)\.ts/g,
    (_match, name: string) =>
      new URL(`../src/${name}.ts`, import.meta.url).href,
  );
  const code = ts.transpileModule(absolute, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return (await import(
    "data:application/javascript," + encodeURIComponent(code)
  )).default;
}

async function typecheck(sources: readonly string[]): Promise<void> {
  const paths: string[] = [];
  try {
    for (const source of sources) {
      const path = await Deno.makeTempFile({ suffix: ".ts" });
      paths.push(path);
      const absolute = source.replaceAll(
        /\.\.\/src\/([a-z_]+)\.ts/g,
        (_match, name: string) =>
          new URL(`../src/${name}.ts`, import.meta.url).href,
      );
      await Deno.writeTextFile(path, absolute);
    }
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["check", ...paths],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert_true(
      result.success,
      new TextDecoder().decode(result.stderr) + "\n" + sources.join("\n"),
    );
  } finally {
    for (const path of paths) await Deno.remove(path);
  }
}

Deno.test("bounded transform cache isolates source, filename, config and caller mutation", () => {
  const source =
    'import { Do } from "custom"; const x = Do(Maybe, function* () { return 1; });';
  const cache = create_transform_cache(2);
  assert_equals(cache.transform(source).transformed, 0);
  const configured = cache.transform(source, "input.ts", {
    library_specifiers: ["custom"],
  });
  assert_equals(configured.transformed, 1);
  const replay = cache.transform(source, "input.ts", {
    library_specifiers: ["custom"],
  });
  assert_equals(replay, configured);
  (replay as { code: string }).code = "corrupted";
  assert_equals(
    cache.transform(source, "input.ts", { library_specifiers: ["custom"] }),
    configured,
  );
  cache.transform(source, "another.ts");
  assert_equals(cache.stats().hits, 2);
  assert_equals(cache.stats().size, 2);
  cache.transform(source);
  assert_equals(cache.stats().misses, 4);
  assert_equals(create_transform_cache(10, 1).transform(source).code, source);
  const disabled = create_transform_cache(0);
  disabled.transform(source);
  assert_equals(disabled.stats().size, 0);
  cache.clear();
  assert_equals(cache.stats().bytes, 0);
});

Deno.test("explicit built-in counted loops lower through MonadRec without stack growth", async () => {
  const generated: string[] = [];
  for (
    const [module, dictionary, value] of [["maybe", "Maybe", "Just"], [
      "identity",
      "Identity",
      "identity",
    ], ["either", "Either", "Right"]]
  ) {
    const source = `import { Do } from "../src/typeclasses.ts";
import { ${dictionary}, ${value} } from "../src/${module}.ts";
const result = Do(${dictionary}, function* () {
  for (let i = 0; i < 1000000; i += 1) { yield* ${value}(i); }
  return 42;
});
export default result.value();`;
    const result = transform_do_program_source(source, "loop.ts", {
      explain: true,
    });
    assert_equals(result.diagnostics, []);
    assert_true(result.code.includes("tail_rec_m"), result.code);
    generated.push(result.code);
    assert_equals(
      await evaluate(result.code),
      await evaluate(source.replace("1000000", "100")),
    );
  }
  await typecheck(generated);
});

Deno.test("named Reader and State terminal programs fuse with repeated event traces", async () => {
  const generated: string[] = [];
  for (
    const [module, primitive, handler] of [["reader", "ask", "run_reader"], [
      "state",
      "get",
      "run_state",
    ]]
  ) {
    const source = `import { Program, run } from "../src/effects.ts";
import { ${primitive}, ${handler} } from "../src/${module}.ts";
const events: number[] = [];
const p = Program(function* () {
  const n = yield* ${primitive}<number>();
  events.push(n);
  return n + 1;
});
const a = run(${handler}(p, 1));
const b = run(${handler}(p, 2));
export default { a, b, events };`;
    const result = transform_do_program_source(source, "named.ts", {
      explain: true,
    });
    assert_equals(result.diagnostics, []);
    assert_true(!result.code.includes("const p ="), result.code);
    assert_true(!result.code.includes("Effect.bind"), result.code);
    generated.push(result.code);
    assert_equals(await evaluate(result.code), await evaluate(source));
  }
  await typecheck(generated);
});

Deno.test("named programs retain eager construction effects and escaping identity", async () => {
  const source = `import { Program, run } from "../src/effects.ts";
import { ask, run_reader } from "../src/reader.ts";
const events: string[] = [];
const p = Program(function* () { events.push("construct"); const n = yield* ask<number>(); return n; });
events.push("before");
const a = run(run_reader(p, 1));
const b = run(run_reader(p, 2));
export default {a,b,events};`;
  const result = transform_do_program_source(source);
  assert_true(result.code.includes("const p ="), result.code);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

Deno.test("keyed terminal specialization preserves the cell identity and mismatch error", async () => {
  for (const [family, operation] of [["reader", "ask"], ["state", "get"]]) {
    const source = `import { Program, run } from "../src/effects.ts";
import { ${family}, run_${family} } from "../src/${family}.ts";
const one = ${family}<"one", number>("one");
const other = ${family}<"other", number>("other");
const same = ${family}<"one", number>("one");
const p = Program(function* () { return yield* one.${operation}(); });
const result = run(run_${family}(same, p, 7));
let error = "";
try { run(run_${family}(other, p as never, 9)); } catch (caught) { error = (caught as Error).message; }
export default { result, error };`;
    const result = transform_do_program_source(source, "keyed.ts", {
      explain: true,
    });
    assert_true(result.code.includes(`run_${family}_terminal`), result.code);
    assert_equals(await evaluate(result.code), await evaluate(source));
    assert_true(
      result.reports.some((report) => report.message.includes("identity")),
      "keyed lowering must explain its identity boundary",
    );
  }
});

Deno.test("explanation reports include original source locations and preservation barriers", () => {
  const source = `import { Do } from "../src/typeclasses.ts";
const p = Do(Maybe, function* () { try { yield* Just(1); } finally {} });`;
  const result = transform_do_program_source(source, "barrier.ts", {
    explain: true,
  });
  assert_equals(result.reports[0].file_name, "barrier.ts");
  assert_equals(result.reports[0].line, 2);
  assert_equals(result.reports[0].outcome, "preserved");
  assert_true(
    result.reports[0].message.includes("try"),
    "report must give the preservation reason",
  );
  assert_equals(transform_do_program_source(source).reports, []);
});

// Deterministic generation and prefix shrinking provide an executable source
// reproduction on failure, including construction, callback and cleanup events.
function generated_trace(seed: number, size: number): string {
  const callbacks: string[] = [];
  for (let index = 0; index < size; index += 1) {
    const delta = (seed * 17 + index * 7) % 11;
    callbacks.push(
      `.map(n => { events.push("${index}:" + n); if (n === ${
        seed % 7
      }) throw new Error("stop"); return n + ${delta}; })`,
    );
  }
  return `import { from_factory, to_array } from "../src/iterable.ts";
const events: string[] = [];
const base = from_factory(function* () { events.push("open"); try { yield* [0,1,2,3]; } finally { events.push("close"); } });
const pipe = base${callbacks.join("")};
events.push("ready");
const values: unknown[] = [];
for (let repeat = 0; repeat < 2; repeat += 1) { try { values.push(to_array(pipe.take(${
    seed % 4
  }))); } catch (error) { values.push((error as Error).message); } }
export default { events, values };`;
}

Deno.test("generated original/transformed event traces retain reproduction and shrinking", async () => {
  for (let seed = 1; seed <= 32; seed += 1) {
    const size = 2 + seed % 6;
    const source = generated_trace(seed, size);
    const transformed = transform_do_program_source(source);
    assert_equals(transformed.transformed, 1);
    if (
      JSON.stringify(await evaluate(source)) ===
        JSON.stringify(await evaluate(transformed.code))
    ) continue;
    let minimal = source;
    for (let smaller = 2; smaller < size; smaller += 1) {
      const candidate = generated_trace(seed, smaller);
      if (
        JSON.stringify(await evaluate(candidate)) !==
          JSON.stringify(
            await evaluate(transform_do_program_source(candidate).code),
          )
      ) {
        minimal = candidate;
        break;
      }
    }
    throw new Error(`trace mismatch; seed=${seed}\n${minimal}`);
  }
});

Deno.test("keyed Writer terminal specialization retains eager log arguments and identity", async () => {
  const source = `import { Program, run } from "../src/effects.ts";
import { writer_cell, run_writer } from "../src/writer.ts";
import { ArrayT } from "../src/array.ts";
const audit = writer_cell("trace-audit", ArrayT<string>([]));
const other = writer_cell("trace-other", ArrayT<string>([]));
const events: string[] = [];
function entry() { events.push("construct log"); return ArrayT(["entry"]); }
const p = Program(function* () { yield* audit.tell(entry()); return 4; });
events.push("before run");
const [value, output] = run(run_writer(audit, p, ArrayT<string>([])));
let error = "";
try { run(run_writer(other, p as never, ArrayT<string>([]))); } catch (caught) { error = (caught as Error).message; }
export default { value, output: output.value(), events, error };`;
  const result = transform_do_program_source(source, "keyed_writer.ts", {
    explain: true,
  });
  assert_true(result.code.includes("run_writer_terminal"), result.code);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

Deno.test("stack-safe transformed Task loops retain cold replay and callback captures", async () => {
  const source = `import { Do } from "../src/typeclasses.ts";
import { Task } from "../src/task.ts";
const events: number[] = [];
const p = Do(Task, function* () {
  for (let i = 0; i < 100; i += 1) { yield* Task(async () => { events.push(i); return i; }); }
  return 42;
});
const initial = [...events];
const a = await p.value()();
const b = await p.value()();
export default { initial, a, b, events };`;
  const result = transform_do_program_source(source);
  assert_true(result.code.includes("tail_rec_m"), result.code);
  await typecheck([result.code]);
  assert_equals(await evaluate(result.code), await evaluate(source));
});

Deno.test("named fusion preserves TDZ and refuses different lexical capture scopes", () => {
  const sources = [
    `const first = run(run_reader(p, 1)); const p = Program(function* () { return yield* ask<number>(); });`,
    `const outer = 1; const p = Program(function* () { const n = yield* ask<number>(); return n + outer; }); function f() { const outer = 2; return run(run_reader(p, 1)); }`,
  ];
  for (const body of sources) {
    const source =
      `import { Program, run } from "../src/effects.ts"; import { ask, run_reader } from "../src/reader.ts"; ${body}`;
    const result = transform_do_program_source(source);
    assert_true(result.code.includes("const p ="), result.code);
  }
});

Deno.test("stack-safe loop specialization recognizes named package-root imports", () => {
  const source = `import { Do, Maybe, Just } from "@mewhhaha/typeclasses";
const p = Do(Maybe, function* () { for (let i = 0; i < 10; i += 1) { yield* Just(i); } return 42; });`;
  const result = transform_do_program_source(source, "package.ts", {
    explain: true,
  });
  assert_true(
    result.code.includes('from "@mewhhaha/typeclasses/loop"'),
    result.code,
  );
  assert_true(result.code.includes("Maybe.tail_rec_m"), result.code);
  assert_true(
    result.reports.some((report) =>
      report.optimization === "loop" && report.outcome === "transformed"
    ),
    "report must identify the stack-safe loop site",
  );
});

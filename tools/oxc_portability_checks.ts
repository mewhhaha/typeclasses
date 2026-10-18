import { assert_equals, assert_true } from "../src/assert.ts";
import { absolute_imports } from "../bench/generated_modules.ts";
import { check_portability_source } from "./check_portability.ts";

Deno.test("native portability scanner retains strip-only syntax restrictions", () => {
  const violations = check_portability_source(
    `class Example {
  constructor(readonly value: number, private other: number) {}
}
function f<out>(value: out) { return value; }
`,
    "src/example.ts",
  );
  assert_equals(violations.length, 3);
  assert_true(
    violations[0].startsWith("src/example.ts:2:15:"),
    "parameter property span",
  );
  assert_true(
    violations[0].includes("constructor parameter properties"),
    "readonly restriction",
  );
  assert_true(
    violations[1].includes("constructor parameter properties"),
    "private restriction",
  );
  assert_true(
    violations[2].includes('type parameter "out"'),
    "reserved type parameter",
  );
  assert_equals(
    check_portability_source(
      "class C { constructor(readonly value: number) {} }",
      "tools/example.ts",
    ),
    [],
  );
});

Deno.test("native portability scanner checks static and literal dynamic core imports", () => {
  const violations = check_portability_source(
    `
import "external";
export * from "node:fs";
export { value } from "./value.ts";
import("npm:package");
import(\`jsr:package\`);
import("../portable.ts");
import(dynamic);
`,
    "src/example.ts",
  );
  assert_equals(violations.length, 4);
  for (const violation of violations) {
    assert_true(
      violation.includes("core source imports runtime dependency"),
      "dependency restriction",
    );
  }
  assert_equals(
    check_portability_source('import "external";', "tools/example.ts"),
    [],
  );
});

Deno.test("native portability scanner distinguishes types, property names, and runtime references", () => {
  assert_equals(
    check_portability_source(
      `
type Runtime = typeof Deno;
interface Options { Deno: unknown; }
const result = { Deno: value, process() {}, require: 1 };
result.Deno;
function f({ Deno }: Options, ...process: unknown[]) { return Deno; }
`,
      "src/example.ts",
    ),
    [],
  );
  const violations = check_portability_source(
    'const text = "😀"; ({ Deno }); object[process]; (Bun as unknown); require("file");',
    "src/example.ts",
  );
  assert_equals(violations.length, 4);
  assert_true(
    violations[0].startsWith("src/example.ts:1:23:"),
    "UTF-16 source offsets",
  );
  for (const name of ["Deno", "process", "Bun", "require"]) {
    assert_true(
      violations.some((violation) =>
        violation.includes(`the ${name} runtime global`)
      ),
      "runtime reference " + name,
    );
  }
  const lines = check_portability_source(
    "value;\rDeno;\u2028Bun;\r\nprocess;",
    "src/example.ts",
  );
  assert_true(lines[0].startsWith("src/example.ts:2:1:"), "CR line offsets");
  assert_true(
    lines[1].startsWith("src/example.ts:3:1:"),
    "Unicode line offsets",
  );
  assert_true(lines[2].startsWith("src/example.ts:4:1:"), "CRLF line offsets");
});

Deno.test("native portability scanner reserves capabilities for parallel module", () => {
  const source =
    "new Worker(url); navigator.hardwareConcurrency; self.close(); new DisposableStack();";
  assert_equals(check_portability_source(source, "src/parallel.ts"), []);
  assert_equals(check_portability_source(source, "src/example.ts").length, 4);
  assert_true(
    check_portability_source("const = ;", "src/example.ts")[0].includes(
      "TypeScript parse error",
    ),
    "parse errors remain violations",
  );
});

Deno.test("native benchmark import rewriting retains static import and export behavior", () => {
  const source = new URL("file:///project/bench/case.ts");
  const code = `// 😀 keep offsets intact
import { value } from /* comment */ './value.ts';
export { next } from "../src/next.ts";
export * from './more.ts';
export * as names from "./names.ts";
import "package";
const dynamic = import("./dynamic.ts");
const text = "./literal.ts";
`;
  const expected = code.replace(
    "'./value.ts'",
    '"file:///project/bench/value.ts"',
  )
    .replace('"../src/next.ts"', '"file:///project/src/next.ts"')
    .replace("'./more.ts'", '"file:///project/bench/more.ts"')
    .replace('"./names.ts"', '"file:///project/bench/names.ts"');
  assert_equals(absolute_imports(code, source), expected);
});

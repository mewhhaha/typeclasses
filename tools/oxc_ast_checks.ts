import { parseSync } from "oxc-parser";
import type { CallExpression, Node, Program } from "oxc-parser";
import { assert_equals, assert_true as check_true } from "../src/assert.ts";
import { id, literal, rewrite, walk } from "./transform_ast.ts";
import { create_binding_analysis } from "./transform_bindings.ts";
import { create_iterable_map_fusion } from "./transform_iterable_maps.ts";

function assert_true(
  value: boolean,
  message = "assertion failed",
): asserts value {
  check_true(value, message);
}

function parse(source: string): Program {
  const result = parseSync("fixture.ts", source);
  assert_equals(result.errors, []);
  return result.program;
}

function reference(program: Program, name: string, occurrence = 0) {
  const found: Extract<Node, { type: "Identifier" }>[] = [];
  walk(program, (current, parent) => {
    if (
      current.type === "Identifier" && current.name === name &&
      parent?.type === "CallExpression" && parent.callee === current
    ) found.push(current);
  });
  assert_true(found[occurrence] !== undefined);
  return found[occurrence];
}

Deno.test("native bindings retain value shadows and lexical declaration owners", () => {
  const source = parse(`
    import { target } from "library";
    target();
    { target(); const { target } = value; }
    function f() { target(); if (condition) { var target = value; } }
    function g(target: unknown) { target(); }
    try {} catch ({ target }) { target(); }
    for (let target of values) target();
    { target(); class target {} }
    { target(); enum target { member } }
    { target(); namespace target {} }
    { type target = unknown; interface target {} target(); }
  `);
  const bindings = create_binding_analysis(source);
  const expected = [
    "ImportDeclaration",
    "VariableDeclarator",
    "VariableDeclarator",
    "Identifier",
    "ObjectPattern",
    "VariableDeclarator",
    "ClassDeclaration",
    "TSEnumDeclaration",
    "TSModuleDeclaration",
    "ImportDeclaration",
  ];
  for (let index = 0; index < expected.length; index++) {
    assert_equals(
      bindings.resolve(reference(source, "target", index))?.type,
      expected[index],
    );
  }
  assert_true(bindings.imported(reference(source, "target")));
  assert_equals(bindings.imported(reference(source, "target", 1)), false);
});

Deno.test("native binding analysis excludes type imports and contains namespace vars", () => {
  const source = parse(`
    import type { type_only } from "library";
    import { type mixed, value } from "library";
    import type alias = require("library");
    type_only(); mixed(); alias(); value();
    namespace local { var value; value(); }
    value();
    enum E { value, next = value() }
  `);
  const bindings = create_binding_analysis(source);
  for (const name of ["type_only", "mixed", "alias"]) {
    assert_equals(bindings.resolve(reference(source, name)), null);
  }
  assert_true(bindings.imported(reference(source, "value", 0)));
  assert_equals(
    bindings.resolve(reference(source, "value", 1))?.type,
    "VariableDeclarator",
  );
  assert_true(bindings.imported(reference(source, "value", 2)));
  assert_equals(
    bindings.resolve(reference(source, "value", 3))?.type,
    "TSEnumMember",
  );
});

Deno.test("native walkers skip subtrees and rewrite without mutating their input", () => {
  const source = parse("const result = source.map(value => value + 1);");
  const names: string[] = [];
  walk(source, (current) => {
    if (current.type === "ArrowFunctionExpression") return false;
    if (current.type === "Identifier") names.push(current.name);
  });
  assert_equals(names, ["result", "source", "map"]);
  const changed = rewrite(source, (current) => {
    if (current.type === "Identifier" && current.name === "source") {
      return id("replacement");
    }
    if (current.type === "Literal" && current.value === 1) return literal(2);
  });
  assert_true(changed !== source);
  const original_names: string[] = [];
  const rewritten_names: string[] = [];
  walk(source, (current) => {
    if (current.type === "Identifier") original_names.push(current.name);
  });
  walk(changed, (current) => {
    if (current.type === "Identifier") rewritten_names.push(current.name);
  });
  assert_true(original_names.includes("source"));
  assert_equals(original_names.includes("replacement"), false);
  assert_true(rewritten_names.includes("replacement"));
});

function fused(source: string): boolean {
  const program = parse(
    'import { from_array } from "../src/iterable.ts";\n' + source,
  );
  const fusion = create_iterable_map_fusion(program);
  let candidate: CallExpression | undefined;
  walk(program, (current) => {
    if (
      current.type !== "CallExpression" ||
      current.callee.type !== "MemberExpression" || current.callee.computed ||
      current.callee.property.type !== "Identifier" ||
      current.callee.property.name !== "map"
    ) return;
    candidate ??= current;
  });
  assert_true(candidate !== undefined);
  return fusion.fuse(candidate) !== undefined;
}

Deno.test("native iterable fusion proves named callbacks and roots before fusing", () => {
  assert_true(fused("from_array([1]).map(n => n + 1).map(n => n * 2);"));
  assert_true(
    fused(
      "function first(n) { return n; } const second = n => n; const base = from_array([1]); base.map(first).map(second);",
    ),
  );
  assert_equals(
    fused(
      "function first(n) { return n; } first = function(a, b) { return b; }; from_array([1]).map(first).map(n => n);",
    ),
    false,
  );
  assert_equals(
    fused(
      "function run() { return base.map(n => n).map(n => n); } const base = from_array([1]);",
    ),
    false,
  );
  assert_equals(
    fused("from_array([1]).map(first).map(n => n); const first = n => n;"),
    false,
  );
  assert_equals(
    fused(
      "{ from_array([1]).map(n => n).map(n => n); const from_array = other; }",
    ),
    false,
  );
});

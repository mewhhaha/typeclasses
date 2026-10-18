import ts from "typescript";
import { SourceMap } from "node:module";
import { assert_equals, assert_true } from "../src/assert.ts";
import { transform_do_program_source } from "./transform_do_program.ts";
import { flatten_numeric_do } from "../bench/experiments/round3_transform_flat.ts";
import { print_changed_statements } from "../bench/experiments/round3_transform_print.ts";

export async function evaluate(source: string): Promise<unknown> {
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
export function dependent_source(
  count: number,
  dictionary = "Maybe",
  branch = false,
): string {
  let module = "maybe", constructor = "Just";
  if (dictionary === "ArrayT") {
    module = "array";
    constructor = "ArrayT";
  }
  if (dictionary === "Identity") {
    module = "identity";
    constructor = "Identity";
  }
  const lines = Array.from({ length: count }, (_, index) => {
    let value = "0";
    if (index > 0) value = `n${index - 1}+1`;
    if (dictionary === "ArrayT") {
      if (branch && index === 0) value = "[1,2]";
      else value = `[${value}]`;
    }
    return `const n${index}:number=yield* ${constructor}(${value});`;
  }).join("\n");
  const members = [...new Set([dictionary, constructor])].join(",");
  return `import {Do} from '../src/typeclasses.ts';import {${members}} from '../src/${module}.ts';
  const result=Do(${dictionary},function*(){${lines}return n${
    count - 1
  };});export default result.value();`;
}

Deno.test("candidate index preserves aliases, scoped programs, shadow and unanchored diagnostics", () => {
  const cases = [
    `import {Do} from '../src/typeclasses.ts'; const unused=1; function f(a:number){return Math.sqrt(a);}`,
    `import {Do as sequence} from '../src/typeclasses.ts';import{Just}from'../src/maybe.ts';const value=sequence(function*(){return yield*Just(1);});`,
    `import {Program as P} from '../src/effects.ts';const scoped=P.scope<never>();const value=scoped(function*(){return 1;});`,
    `import{Do}from'../src/typeclasses.ts';function f(Do:unknown){return Do(function*(){yield*bad();});}`,
    `const value={Do:(f:unknown)=>f}.Do(function*(){yield*bad();});`,
    `const value=D\\u006f(function*(){yield*bad();});`,
    `import {Effect as E}from'../src/effects.ts';const x=E.handle_with(program,[]);`,
    `import{Do}from'../src/typeclasses.ts';const text='Do(function*(){})';`,
  ];
  for (const source of cases) {
    assert_equals(
      transform_do_program_source(source, "probe.ts", { explain: true }),
      transform_do_program_source(source, "probe.ts", {
        explain: true,
        optimizations: { candidate_scan: false },
      }),
    );
  }
});

/** Tiny lowering fixture retaining original node ancestry for printer qualification. */
export function lowered_fixture(
  file: ts.SourceFile,
): ts.TransformationResult<ts.SourceFile> {
  return ts.transform(file, [(context) => {
    const f = context.factory;
    const visit: ts.Visitor = (node) => {
      if (
        ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === "Do"
      ) {
        return f.createCallExpression(
          f.createPropertyAccessExpression(
            f.createCallExpression(f.createIdentifier("Just"), undefined, [
              f.createNumericLiteral(1),
            ]),
            "map",
          ),
          undefined,
          [f.createArrowFunction(
            undefined,
            undefined,
            [f.createParameterDeclaration(
              undefined,
              undefined,
              "n",
              undefined,
              f.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
            )],
            undefined,
            undefined,
            f.createBinaryExpression(
              f.createIdentifier("n"),
              ts.SyntaxKind.PlusToken,
              f.createNumericLiteral(1),
            ),
          )],
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (file) => ts.visitNode(file, visit, ts.isSourceFile)!;
  }]);
}
Deno.test("source-preserving printer retains unrelated text and comments with semantic parity", async () => {
  const untouched =
    `function keep( a:number ){  return a*2 } // literal spacing\n`;
  const source =
    `import{Do}from'../src/typeclasses.ts';\nimport{Just}from'../src/maybe.ts';\n${untouched}// result comment\nconst result=Do(function*(){const n=yield*Just(1);return n+1;});\nexport default result.value();`;
  const before = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = lowered_fixture(before);
  try {
    const printed = print_changed_statements(
      before,
      result.transformed[0],
      source,
    );
    assert_true(
      printed !== undefined,
      "qualified fixture prints changed statements",
    );
    assert_true(
      printed!.includes(untouched),
      "unrelated function bytes preserved",
    );
    assert_true(printed!.includes("// result comment"), "comment preserved");
    assert_equals(await evaluate(printed!), await evaluate(source));
  } finally {
    result.dispose();
  }
});
Deno.test("source printer rejects generated-name changes; production maps remain mapped", () => {
  const source =
    `import{Do}from'../src/typeclasses.ts';import{Just}from'../src/maybe.ts';const result=Do(function*(){const n=yield*Just(1);return n+1;});`;
  const before = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const generated = ts.factory.createUniqueName("frame");
  const declaration = ts.factory.updateVariableStatement(
    before.statements[2] as ts.VariableStatement,
    undefined,
    ts.factory.createVariableDeclarationList([
      ts.factory.createVariableDeclaration(
        generated,
        undefined,
        undefined,
        ts.factory.createNumericLiteral(1),
      ),
    ], ts.NodeFlags.Const),
  );
  const after = ts.factory.updateSourceFile(before, [
    ...before.statements.slice(0, 2),
    declaration,
  ]);
  assert_equals(print_changed_statements(before, after, source), undefined);
  const transformed = transform_do_program_source(source, "probe.ts");
  assert_true(
    transformed.map !== null,
    "full mapped printer remains the production path",
  );
  const mapped = new SourceMap(JSON.parse(JSON.stringify(transformed.map)));
  assert_true(
    Object.keys(mapped.findEntry(0, 0)).length > 0,
    "original positions remain available",
  );
});
Deno.test("typed liveness IR handles1024 dependent yields and branch replay", async () => {
  for (
    const [dictionary, branch] of [["Maybe", false], ["ArrayT", true], [
      "Identity",
      false,
    ]] as const
  ) {
    const source = dependent_source(1024, dictionary, branch);
    const probe = flatten_numeric_do(source);
    assert_equals(probe.reason, undefined);
    assert_equals(probe.yields, 1024);
    assert_equals(probe.max_live, 1);
    let expected: unknown = ["Just", 1023];
    if (dictionary === "ArrayT") expected = [1024, 1025];
    if (dictionary === "Identity") expected = 1023;
    assert_equals(await evaluate(probe.code), expected);
    const small = dependent_source(8, dictionary, branch);
    assert_equals(
      await evaluate(flatten_numeric_do(small).code),
      await evaluate(small),
    );
  }
});
Deno.test("liveness tracks distant uses and rejects mutation, closure, TDZ and outer reads", async () => {
  const source = dependent_source(300).replace(
    "return n299;",
    "return n0+n299;",
  );
  const probe = flatten_numeric_do(source);
  assert_equals(probe.max_live, 2);
  assert_equals(await evaluate(probe.code), ["Just", 299]);
  const first = "const n0:number=yield* Just(0);";
  for (
    const changed of [
      "let n0:number=yield*Just(0);",
      "const n0:number=yield*Just(sideEffect());",
      "const n0:number=yield*Just(n1);",
      "const n0:number=yield*Just(outer);",
      "const n0:number=yield*Just(()=>1);",
    ]
  ) {
    const input = dependent_source(300).replace(first, changed);
    assert_true(flatten_numeric_do(input).reason !== undefined, changed);
  }
  const shadow = dependent_source(300).replace(
    "const result=Do(",
    "function shadow(Maybe:unknown){return Do(",
  ).replace("export default result.value();", "} export default 0;");
  assert_true(
    flatten_numeric_do(shadow).reason !== undefined,
    "shadowed dictionary cannot qualify",
  );
  const actual = transform_do_program_source(dependent_source(300));
  assert_equals(actual.transformed, 0);
  assert_true(
    actual.diagnostics.some((item) => item.message.includes("liveness")),
    "production preserves unqualified long dependent generators",
  );
});

Deno.test("liveness output typechecks1024 stages without any or unknown frame slots", async () => {
  const paths: string[] = [];
  try {
    for (const dictionary of ["Maybe", "ArrayT", "Identity"]) {
      const probe = flatten_numeric_do(dependent_source(1024, dictionary));
      assert_true(
        !/\b(?:any|unknown)\b/.test(probe.code),
        "frame has concrete numeric types",
      );
      const absolute = probe.code.replaceAll(
        /\.\.\/src\/([a-z_]+)\.ts/g,
        (_match, name: string) =>
          new URL(`../src/${name}.ts`, import.meta.url).href,
      );
      const path = await Deno.makeTempFile({ suffix: ".ts" });
      paths.push(path);
      await Deno.writeTextFile(path, absolute);
    }
    const checked = await new Deno.Command(Deno.execPath(), {
      args: ["check", ...paths],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assert_true(checked.success, new TextDecoder().decode(checked.stderr));
  } finally {
    for (const path of paths) await Deno.remove(path);
  }
});

Deno.test("source printer falls back for an interior comment rather than dropping annotations", () => {
  const source = `const value=Do(/* annotation */ function*(){return 1;});`;
  const before = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = lowered_fixture(before);
  try {
    assert_equals(
      print_changed_statements(before, result.transformed[0], source),
      undefined,
    );
  } finally {
    result.dispose();
  }
});

Deno.test("shared-frame counterexamples change captured branch values and replay-local mutation", async () => {
  const captures =
    `import{Do}from'../src/typeclasses.ts';import{ArrayT}from'../src/array.ts';
    const result=Do(ArrayT,function*(){const n:number=yield*ArrayT([1,2]);return ()=>n;});export default result.value();`;
  const callbacks = await evaluate(captures) as (() => number)[];
  assert_equals(callbacks.map((callback) => callback()), [1, 2]);
  let shared = 0;
  const unsafe = [1, 2].map((value) => {
    shared = value;
    return () => shared;
  });
  assert_equals(unsafe.map((callback) => callback()), [2, 2]);
  assert_true(
    flatten_numeric_do(captures).reason !== undefined,
    "escaping closures cannot qualify",
  );
  const mutation =
    `import{Do}from'../src/typeclasses.ts';import{ArrayT}from'../src/array.ts';
    const result=Do(ArrayT,function*(){let count=0;const n:number=yield*ArrayT([1,2]);count+=1;return n+count;});export default result.value();`;
  assert_equals(await evaluate(mutation), [2, 3]);
  let count = 0;
  assert_equals(
    [1, 2].map((value) => {
      count += 1;
      return value + count;
    }),
    [2, 4],
  );
  assert_true(
    flatten_numeric_do(mutation).reason !== undefined,
    "mutable replay locals cannot qualify",
  );
});

Deno.test("typed dependent IR preserves Nothing short circuit before later stages", async () => {
  const source = dependent_source(300).replace(
    "Maybe,Just",
    "Maybe,Just,Nothing",
  )
    .replace("yield* Just(n149+1)", "yield* Nothing<number>()");
  const probe = flatten_numeric_do(source);
  assert_equals(probe.reason, undefined);
  assert_equals(await evaluate(probe.code), ["Nothing"]);
});

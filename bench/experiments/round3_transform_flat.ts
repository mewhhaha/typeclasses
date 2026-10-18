import ts from "typescript";
import { create_legacy_binding_analysis } from "./legacy_bindings.ts";
export type FlatProbe = {
  readonly code: string;
  readonly yields: number;
  readonly max_live: number;
  readonly reason?: string;
};
/** Narrow numeric prototype: typed const yields and pure constructor expressions.
 * Fresh immutable tuples thread live values; this never shares a mutable frame.
 */
export function flatten_numeric_do(
  source: string,
  loop_specifier = "../src/loop.ts",
): FlatProbe {
  const file = ts.createSourceFile(
    "probe.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const bindings = create_legacy_binding_analysis(file);
  const imports = new Map<string, { name: string; module: string }>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const name of bindings.elements) {
        imports.set(name.name.text, {
          name: (name.propertyName ?? name.name).text,
          module: statement.moduleSpecifier.text,
        });
      }
    }
  }
  const calls: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      imports.get(node.expression.text)?.name === "Do" &&
      bindings.imported(node.expression)
    ) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  const reject = (reason: string): FlatProbe => ({
    code: source,
    yields: 0,
    max_live: 0,
    reason,
  });
  if (calls.length !== 1) return reject("requires exactly one imported Do");
  const call = calls[0];
  const dictionary = call.arguments[0];
  const generator = call.arguments[1];
  if (
    dictionary === undefined || !ts.isIdentifier(dictionary) ||
    generator === undefined || !ts.isFunctionExpression(generator) ||
    generator.asteriskToken === undefined || generator.parameters.length !== 0
  ) return reject("requires explicit dictionary and parameterless generator");
  const do_import = imports.get((call.expression as ts.Identifier).text)!;
  const trusted_do = new URL("../../src/typeclasses.ts", import.meta.url).href;
  if (
    do_import.module !== "../src/typeclasses.ts" &&
    do_import.module !== trusted_do
  ) return reject("Do must use the qualified library import");
  const dictionary_import = imports.get(dictionary.text);
  if (dictionary_import === undefined || !bindings.imported(dictionary)) {
    return reject("dictionary must be imported");
  }
  let constructors: string[] = [];
  switch (dictionary_import.name) {
    case "Maybe":
      constructors = ["Just", "Nothing"];
      break;
    case "ArrayT":
      constructors = ["ArrayT"];
      break;
    case "Identity":
      constructors = ["Identity"];
      break;
    default:
      return reject("dictionary has no qualified MonadRec prototype");
  }
  const trusted_modules = ["maybe", "array", "identity"].flatMap((name) => [
    `../src/${name}.ts`,
    new URL(`../../src/${name}.ts`, import.meta.url).href,
  ]);
  if (!trusted_modules.includes(dictionary_import.module)) {
    return reject("dictionary module is outside the prototype corpus");
  }
  const statements = [...generator.body.statements];
  const terminal = statements.pop();
  if (
    terminal === undefined || !ts.isReturnStatement(terminal) ||
    terminal.expression === undefined
  ) return reject("requires numeric return");
  const yields: {
    name: string;
    expression: ts.CallExpression;
    uses: Set<string>;
  }[] = [];
  const names = new Map<string, number>();
  for (const statement of statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0 ||
      statement.declarationList.declarations.length !== 1
    ) return reject("only linear const yields are supported");
    const declaration = statement.declarationList.declarations[0];
    const initial = declaration.initializer;
    if (
      !ts.isIdentifier(declaration.name) ||
      declaration.type?.kind !== ts.SyntaxKind.NumberKeyword ||
      initial === undefined || !ts.isYieldExpression(initial) ||
      initial.asteriskToken === undefined || initial.expression === undefined ||
      !ts.isCallExpression(initial.expression) ||
      !ts.isIdentifier(initial.expression.expression)
    ) {
      return reject(
        "yield declarations require explicit number type and direct constructors",
      );
    }
    const imported = imports.get(initial.expression.expression.text);
    if (
      imported === undefined ||
      !bindings.imported(initial.expression.expression) ||
      imported.module !== dictionary_import.module ||
      !constructors.includes(imported.name)
    ) return reject("context constructor does not belong to the dictionary");
    if (names.has(declaration.name.text)) {
      return reject("duplicate local binding");
    }
    names.set(declaration.name.text, yields.length);
    yields.push({
      name: declaration.name.text,
      expression: initial.expression,
      uses: new Set(),
    });
  }
  if (yields.length === 0) return reject("requires at least one yield");
  const numeric_ops = new Set([
    ts.SyntaxKind.PlusToken,
    ts.SyntaxKind.MinusToken,
    ts.SyntaxKind.AsteriskToken,
    ts.SyntaxKind.SlashToken,
    ts.SyntaxKind.PercentToken,
    ts.SyntaxKind.AsteriskAsteriskToken,
    ts.SyntaxKind.LessThanLessThanToken,
    ts.SyntaxKind.GreaterThanGreaterThanToken,
    ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
    ts.SyntaxKind.AmpersandToken,
    ts.SyntaxKind.BarToken,
    ts.SyntaxKind.CaretToken,
  ]);
  function pure(
    node: ts.Expression,
    stage: number,
    uses: Set<string>,
  ): boolean {
    if (ts.isNumericLiteral(node)) return true;
    if (ts.isIdentifier(node)) {
      const declared = names.get(node.text);
      if (declared === undefined || declared >= stage) return false;
      uses.add(node.text);
      return true;
    }
    if (ts.isParenthesizedExpression(node)) {
      return pure(node.expression, stage, uses);
    }
    if (
      ts.isPrefixUnaryExpression(node) &&
      (node.operator === ts.SyntaxKind.MinusToken ||
        node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.TildeToken)
    ) return pure(node.operand, stage, uses);
    if (
      ts.isBinaryExpression(node) && numeric_ops.has(node.operatorToken.kind)
    ) return pure(node.left, stage, uses) && pure(node.right, stage, uses);
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.every((item) =>
        !ts.isSpreadElement(item) && !ts.isOmittedExpression(item) &&
        pure(item, stage, uses)
      );
    }
    return false;
  }
  const last_use = new Map<string, number>();
  for (let index = 0; index < yields.length; index += 1) {
    const current = yields[index];
    if (
      current.expression.typeArguments?.some((type) =>
        type.kind !== ts.SyntaxKind.NumberKeyword
      )
    ) return reject("constructor type arguments must be number");
    for (const argument of current.expression.arguments) {
      if (!pure(argument, index, current.uses)) {
        return reject(
          "context contains effects, closures, outer references or forward references",
        );
      }
    }
    for (const name of current.uses) last_use.set(name, index);
  }
  const terminal_uses = new Set<string>();
  if (
    ts.isArrayLiteralExpression(terminal.expression) ||
    !pure(terminal.expression, yields.length, terminal_uses)
  ) return reject("return must be a pure numeric expression");
  for (const name of terminal_uses) last_use.set(name, yields.length);
  const stages: string[][] = [];
  let active: string[] = [];
  for (let stage = 0; stage < yields.length; stage += 1) {
    active = active.filter((name) => last_use.get(name)! >= stage);
    if (stage > 0) {
      const previous = yields[stage - 1].name;
      if ((last_use.get(previous) ?? -1) >= stage) active.push(previous);
    }
    stages.push(active);
  }
  const live = (stage: number) => stages[stage];
  let suffix = 0;
  while (source.includes(`__flat${suffix}`)) suffix += 1;
  const prefix = `__flat${suffix}`;
  const frame = `${prefix}Frame`,
    step = `${prefix}Step`,
    rec = `${prefix}rec`,
    done = `${prefix}done`,
    state = `${prefix}state`;
  const states = yields.map((_, index) =>
    `readonly [${index}${
      live(index).map((name) => `,${name}:number`).join("")
    }]`
  );
  let max_live = 0;
  const cases = yields.map((current, index) => {
    const incoming = live(index);
    max_live = Math.max(max_live, incoming.length);
    const restored = incoming.map((name, index) =>
      `const ${name}=${state}[${index + 1}];`
    ).join("\n");
    let result = `${done}(${terminal.expression!.getText(file)})`;
    if (index < yields.length - 1) {
      result = `${rec}<${frame}>([${index + 1}${
        live(index + 1).map((name) => `,${name}`).join("")
      }])`;
    }
    return `case ${index}:{${restored}\nreturn ${
      current.expression.getText(file)
    }.map((${current.name}:number):${step}<${frame},number>=>${result});}`;
  });
  const expression = `(()=>{type ${frame}=${
    states.join("|")
  };return ${dictionary.text}.tail_rec_m<${frame},number>([0],(${state}:${frame})=>{switch(${state}[0]){${
    cases.join("\n")
  }}});})()`;
  return {
    code:
      `import {rec as ${rec},done as ${done},type LoopStep as ${step}} from ${
        JSON.stringify(loop_specifier)
      };\n` + source.slice(0, call.getStart(file)) + expression +
      source.slice(call.end),
    yields: yields.length,
    max_live,
  };
}

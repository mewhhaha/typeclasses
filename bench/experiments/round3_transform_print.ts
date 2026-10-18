import ts from "typescript";

/** Conservative source-preserving printer prototype. Maps require the full printer. */
export function print_changed_statements(
  before: ts.SourceFile,
  after: ts.SourceFile,
  source: string,
): string | undefined {
  if (before.statements.length !== after.statements.length) return undefined;
  const edits: { start: number; end: number; text: string }[] = [];
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: true,
  });
  function generated(node: ts.Node): boolean {
    const api = ts as unknown as {
      isGeneratedIdentifier(node: ts.Node): boolean;
    };
    if (ts.isIdentifier(node) && api.isGeneratedIdentifier(node)) return true;
    return ts.forEachChild(node, generated) ?? false;
  }
  for (let index = 0; index < before.statements.length; index += 1) {
    const previous = before.statements[index];
    const current = after.statements[index];
    if (current === previous) continue;
    if (ts.getOriginalNode(current) !== previous || generated(current)) {
      return undefined;
    }
    const start = previous.getFullStart();
    const token_start = previous.getStart(before);
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      source.slice(token_start, previous.end),
    );
    let token = scanner.scan();
    while (token !== ts.SyntaxKind.EndOfFileToken) {
      if (
        token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia
      ) return undefined;
      token = scanner.scan();
    }
    const printed = printer.printNode(ts.EmitHint.Unspecified, current, before);
    // Preserve all original trivia, including the previous statement's trailing
    // line comment. The printer must not emit its own duplicate leading trivia.
    const prefix = source.slice(start, token_start);
    edits.push({ start, end: previous.end, text: prefix + printed });
  }
  let output = "";
  let position = 0;
  for (const edit of edits) {
    output += source.slice(position, edit.start) + edit.text;
    position = edit.end;
  }
  return output + source.slice(position);
}

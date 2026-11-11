/** Size, nesting and selection budgets for the page GraphQL schema and the documents run against it. */
import {
  parse,
  Lexer,
  Source,
  TokenKind,
  buildASTSchema,
  assertValidSchema,
  type DocumentNode,
  type SelectionSetNode,
} from "graphql";
function syntaxBudget(source: string, limit: number) {
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > limit
  )
    throw Error("GraphQL source size budget exceeded");
  // Lexical nesting limit bounds parser recursion before AST validation.
  let nesting = 0;
  const lexer = new Lexer(new Source(source));
  for (
    let token = lexer.advance();
    token.kind !== TokenKind.EOF;
    token = lexer.advance()
  ) {
    if (["{", "(", "["].includes(token.kind)) nesting++;
    if (["}", ")", "]"].includes(token.kind)) nesting--;
    if (nesting > 64) throw Error("Syntax nesting budget exceeded");
  }
}
export function boundedSchema(source: string, limit = 65536) {
  syntaxBudget(source, limit);
  const ast = parse(source);
  if (ast.definitions.length > 512)
    throw Error("Schema definition budget exceeded");
  const schema = buildASTSchema(ast);
  assertValidSchema(schema);
  return schema;
}
export function boundedDocument(source: string): DocumentNode {
  syntaxBudget(source, 16384);
  const document = parse(source);
  const fragments = new Map(
    document.definitions
      .filter((d) => d.kind === "FragmentDefinition")
      .map((d) => [d.name.value, d]),
  );
  let fields = 0;
  function walk(set: SelectionSetNode, depth: number, path: Set<string>) {
    if (depth > 32) throw Error("Selection depth budget exceeded");
    for (const selection of set.selections) {
      if (++fields > 512) throw Error("Expanded selection budget exceeded");
      if (selection.kind === "FragmentSpread") {
        const name = selection.name.value;
        if (path.has(name)) throw Error("Fragment cycle");
        const f = fragments.get(name);
        if (f) walk(f.selectionSet, depth, new Set([...path, name]));
      } else if (selection.selectionSet)
        walk(selection.selectionSet, depth + 1, path);
    }
  }
  for (const d of document.definitions)
    if (d.kind === "OperationDefinition") walk(d.selectionSet, 0, new Set());
  return document;
}

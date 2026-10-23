import {
  parse,
  Lexer,
  Source,
  TokenKind,
  buildASTSchema,
  assertValidSchema,
  validateSchema,
  Kind,
  type DocumentNode,
  type GraphQLSchema,
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
/** Supplied by the platform to every backend file; authors never declare these. */
export const BACKEND_PLATFORM_SDL =
  "directive @auth(signedIn: Boolean, role: Role) on FIELD_DEFINITION\nenum Role { VIEWER EDITOR OWNER }\n";
const MISSING_QUERY = "Query root type must be provided.";
/**
 * One backend file's schema, written as if the file were alone: the platform
 * `@auth`/`Role` are in scope, a file may have only Mutation fields, and root
 * field names are unique across Query and Mutation (resolvers are looked up by name).
 */
export function boundedBackendSchema(typeDefs: string): GraphQLSchema {
  if (typeof typeDefs !== "string") throw Error("typeDefs must be a string");
  syntaxBudget(typeDefs, 65536);
  const ast = parse(BACKEND_PLATFORM_SDL + typeDefs);
  if (ast.definitions.length > 514)
    throw Error("Schema definition budget exceeded");
  for (const definition of ast.definitions.slice(2)) {
    if (
      definition.kind === Kind.SCHEMA_DEFINITION ||
      definition.kind === Kind.SCHEMA_EXTENSION
    )
      throw Error("Root types are always Query and Mutation");
    if (definition.kind === Kind.DIRECTIVE_DEFINITION)
      throw Error("Backend files cannot declare directives");
    // @auth guards a call before it runs, so it belongs on Query and Mutation fields only.
    if (
      "fields" in definition &&
      definition.fields &&
      !(
        (definition.kind === Kind.OBJECT_TYPE_DEFINITION ||
          definition.kind === Kind.OBJECT_TYPE_EXTENSION) &&
        (definition.name.value === "Query" ||
          definition.name.value === "Mutation")
      )
    )
      for (const field of definition.fields)
        if (field.directives?.some((d) => d.name.value === "auth"))
          throw Error(
            `@auth is allowed only on Query and Mutation fields, not ${definition.name.value}.${field.name.value}`,
          );
  }
  const schema = buildASTSchema(ast);
  const errors = validateSchema(schema).filter(
    (error) => error.message !== MISSING_QUERY,
  );
  if (errors.length) throw Error(errors.map((e) => e.message).join("\n"));
  if (schema.getSubscriptionType())
    throw Error("Subscriptions are unavailable");
  const query = Object.keys(schema.getQueryType()?.getFields() ?? {});
  const mutation = Object.keys(schema.getMutationType()?.getFields() ?? {});
  if (!query.length && !mutation.length)
    throw Error("A backend needs a Query or Mutation field");
  if (query.some((field) => mutation.includes(field)))
    throw Error("Root field names must be unique across Query and Mutation");
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

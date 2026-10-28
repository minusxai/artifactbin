/**
 * Page-level GraphQL over linked backend files (contract:
 * ./af-namespace-contracts.ts). Pure: graphql-js only, no I/O.
 *
 * Composition renames every type a file declares to `<name>__<Type>` and
 * mounts the file's roots as `Query.<name>` / `Mutation.<name>`. The composed
 * SDL is self-describing: each namespace field carries
 * `@backend(file, version)`, so execution needs nothing but the SDL.
 */
import {
  execute,
  getDirectiveValues,
  getNamedType,
  getOperationAST,
  getVariableValues,
  GraphQLError,
  isAbstractType,
  Kind,
  parse,
  print,
  responsePathAsArray,
  validate,
  visit,
  type DocumentNode,
  type GraphQLDirective,
  type GraphQLField,
  type GraphQLFieldResolver,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLTypeResolver,
  type TypeNode,
} from "graphql";
import type { HtmlJson as AfJson, HtmlJsonObject as AfJsonObject, PageMutationOutcome as Outcome, PageResolverRole as PageRole, PageNamespaceSource as NamespaceSource, PageSchema, PageOperationResponse as RemoteResponse } from '@artifactbin/contracts';
import { PAGE_OPERATION_RESULT_BYTES, FIELD_ERROR_CODE, FieldFailed, FieldNotExecuted, boundedDetail, type ExecuteOptions, type RemoteError } from './contracts';
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
import {
  BACKEND_PLATFORM_SDL,
  boundedBackendSchema,
  boundedDocument,
  boundedSchema,
} from "./execution-policy";

const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
const SEPARATOR = "__";
const SHARED_TYPES = new Set([
  "String",
  "Int",
  "Float",
  "Boolean",
  "ID",
  "Role",
]);
const BACKEND_DIRECTIVE =
  "directive @backend(file: String!, version: String!) on FIELD_DEFINITION\n";
const ROLE_RANK: Record<PageRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };
const MAX_SOURCES = 64;
const MAX_COMPOSED_BYTES = 1048576;
const MAX_VARIABLE_BYTES = 65536;

const TYPE_DEFINITIONS = new Set<string>([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.OBJECT_TYPE_EXTENSION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_EXTENSION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.UNION_TYPE_EXTENSION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.ENUM_TYPE_EXTENSION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_EXTENSION,
  Kind.SCALAR_TYPE_DEFINITION,
  Kind.SCALAR_TYPE_EXTENSION,
]);

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "invalid";

interface Mounted {
  namespace: string;
  fileId: string;
  version: string;
  type: GraphQLObjectType;
}
interface Compiled {
  schema: GraphQLSchema;
  auth: GraphQLDirective;
  query: Map<string, Mounted>;
  mutation: Map<string, Mounted>;
  namespaces: string[];
}
const compiledSchemas = new WeakMap<PageSchema, Compiled>();

/** Rename a file's own types into its namespace; root fields become nullable so one failure stays local. */
function renameFile(name: string, typeDefs: string): string {
  const document = parse(typeDefs);
  const rename = (type: string) =>
    SHARED_TYPES.has(type) ? type : name + SEPARATOR + type;
  const nullable = (type: TypeNode): TypeNode =>
    type.kind === Kind.NON_NULL_TYPE ? type.type : type;
  const renamed = visit(document, {
    NamedType: (node) => ({
      ...node,
      name: { ...node.name, value: rename(node.name.value) },
    }),
    enter(node) {
      if (!TYPE_DEFINITIONS.has(node.kind) || !("name" in node) || !node.name)
        return undefined;
      const original = node.name.value;
      const root =
        (node.kind === Kind.OBJECT_TYPE_DEFINITION ||
          node.kind === Kind.OBJECT_TYPE_EXTENSION) &&
        (original === "Query" || original === "Mutation");
      return {
        ...node,
        name: { ...node.name, value: rename(original) },
        ...(root && "fields" in node && node.fields
          ? {
              fields: node.fields.map((field) =>
                "type" in field
                  ? { ...field, type: nullable(field.type) }
                  : field,
              ),
            }
          : {}),
      };
    },
  }) as DocumentNode;
  return print(renamed);
}

export function composePageSchema(
  sources: readonly NamespaceSource[],
): PageSchema {
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES)
    throw Error(`A page links at most ${MAX_SOURCES} backends`);
  const names: string[] = [];
  const owners = new Map<string, string>();
  const parts = [BACKEND_PLATFORM_SDL, BACKEND_DIRECTIVE];
  const query: string[] = [];
  const mutation: string[] = [];
  for (const source of sources) {
    const name = source?.name;
    const label = JSON.stringify(String(name));
    if (
      typeof name !== "string" ||
      !GRAPHQL_NAME.test(name) ||
      name.startsWith(SEPARATOR)
    )
      throw Error(`Backend name ${label} is not a GraphQL name`);
    if (names.includes(name))
      throw Error(`Backend name ${label} is used more than once`);
    if (
      typeof source.fileId !== "string" ||
      !FILE_ID_PATTERN.test(source.fileId)
    )
      throw Error(`Backend ${name} has an invalid file ID`);
    if (typeof source.version !== "string" || !source.version)
      throw Error(`Backend ${name} has no version`);
    let fileSchema: GraphQLSchema;
    try {
      fileSchema = boundedBackendSchema(source.typeDefs);
    } catch (error) {
      throw Error(`Backend ${name} has an invalid schema: ${messageOf(error)}`);
    }
    names.push(name);
    for (const type of Object.keys(fileSchema.getTypeMap())) {
      if (type.startsWith("__") || SHARED_TYPES.has(type)) continue;
      const composed = name + SEPARATOR + type;
      const other = owners.get(composed);
      if (other !== undefined)
        throw Error(
          `Backend ${name} type ${type} collides with backend ${other}`,
        );
      owners.set(composed, name);
    }
    parts.push(renameFile(name, source.typeDefs));
    const mount = `@backend(file: ${JSON.stringify(source.fileId)}, version: ${JSON.stringify(source.version)})`;
    if (fileSchema.getQueryType())
      query.push(`  ${name}: ${name}${SEPARATOR}Query! ${mount}`);
    if (fileSchema.getMutationType())
      mutation.push(`  ${name}: ${name}${SEPARATOR}Mutation! ${mount}`);
  }
  // A schema needs a Query type; `_` stands in when no backend has queries.
  parts.push(
    `type Query {\n${query.length ? query.join("\n") : "  _: Boolean"}\n}`,
  );
  if (mutation.length) parts.push(`type Mutation {\n${mutation.join("\n")}\n}`);
  const sdl = parts.join("\n");
  if (new TextEncoder().encode(sdl).length > MAX_COMPOSED_BYTES)
    throw Error("The page's backend schemas are too large");
  const schema: PageSchema = Object.freeze({
    sdl,
    namespaces: Object.freeze([...names]),
  });
  compiledSchemas.set(schema, compile(sdl));
  return schema;
}

function compile(sdl: string): Compiled {
  const schema = boundedSchema(sdl, MAX_COMPOSED_BYTES);
  const backend = schema.getDirective("backend");
  const auth = schema.getDirective("auth");
  if (!backend || !auth) throw Error("Not a page schema");
  const mounts = (root: GraphQLObjectType | null | undefined) => {
    const mounted = new Map<string, Mounted>();
    for (const field of Object.values(root?.getFields() ?? {})) {
      const meta = field.astNode
        ? getDirectiveValues(backend, field.astNode)
        : undefined;
      if (!meta) continue;
      const type = getNamedType(field.type);
      if (!type || !("getFields" in type) || isAbstractType(type))
        throw Error("Not a page schema");
      mounted.set(field.name, {
        namespace: field.name,
        fileId: String(meta.file),
        version: String(meta.version),
        type: type as GraphQLObjectType,
      });
    }
    return mounted;
  };
  const query = mounts(schema.getQueryType());
  const mutation = mounts(schema.getMutationType());
  const namespaces = [...new Set([...query.keys(), ...mutation.keys()])];
  return { schema, auth, query, mutation, namespaces };
}

const json = <T>(value: unknown): T =>
  value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);

/**
 * The invoke port's sanitized reason, if it gave one (FieldNotExecuted/FieldFailed),
 * with what the backend said only for the page owner, and only bounded.
 */
function extensionsOf(
  error: unknown,
  owner: boolean,
): { code: string; detail?: string } | undefined {
  if (
    !(error instanceof FieldNotExecuted || error instanceof FieldFailed) &&
    !(
      error instanceof Error &&
      (error.name === "FieldNotExecuted" || error.name === "FieldFailed")
    )
  )
    return undefined;
  const { code, detail } = error as { code?: unknown; detail?: unknown };
  if (typeof code !== "string" || !FIELD_ERROR_CODE.test(code)) return undefined;
  const bounded = owner ? boundedDetail(detail) : undefined;
  return bounded === undefined ? { code } : { code, detail: bounded };
}

function plainErrors(errors: readonly GraphQLError[]): RemoteError[] {
  return errors.map((error) => {
    const plain: RemoteError = { message: error.message };
    if (error.path) plain.path = [...error.path];
    // Only the code (and owner-only detail) this module attached to a backend field's error.
    const code = error.extensions?.code;
    if (
      error.originalError &&
      typeof code === "string" &&
      FIELD_ERROR_CODE.test(code)
    ) {
      const detail = error.extensions?.detail;
      plain.extensions =
        typeof detail === "string" ? { code, detail } : { code };
    }
    return plain;
  });
}
const failure = (message: string): RemoteResponse => ({
  data: null,
  errors: [{ message }],
});

export async function executePageOperation(
  options: ExecuteOptions,
): Promise<RemoteResponse> {
  const { caller, request, invoke } = options;
  let compiled: Compiled;
  try {
    compiled =
      compiledSchemas.get(options.schema) ?? compile(options.schema.sdl);
  } catch {
    return failure("The page's backend schema is unavailable");
  }
  const { schema, auth } = compiled;
  if (!request || typeof request.query !== "string")
    return failure("A query string is required");
  let document: DocumentNode;
  try {
    document = boundedDocument(request.query);
  } catch (error) {
    return failure(messageOf(error));
  }
  const invalid = validate(schema, document);
  if (invalid.length) return { data: null, errors: plainErrors(invalid) };
  const operation = getOperationAST(
    document,
    request.operationName ?? undefined,
  );
  if (!operation || operation.operation === "subscription")
    return failure("Exactly one query or mutation is required");
  const variables = request.variables ?? {};
  if (
    !variables ||
    typeof variables !== "object" ||
    Array.isArray(variables) ||
    new TextEncoder().encode(JSON.stringify(variables)).length >
      MAX_VARIABLE_BYTES
  )
    return failure("Variables must be a JSON object of at most 64 KiB");
  const coerced = getVariableValues(
    schema,
    operation.variableDefinitions ?? [],
    variables,
  );
  if (coerced.errors)
    return { data: null, errors: plainErrors(coerced.errors) };

  const mutating = operation.operation === "mutation";
  const signal = options.signal ?? new AbortController().signal;
  const principal = { tenant: caller.pageId, subject: caller.subject };
  // The owner may read what their own backend said; nobody else learns more than the code.
  const owner = caller.role === "OWNER";
  const outcomes: Record<string, Outcome> = {};
  let chain: Promise<unknown> = Promise.resolve();

  /** Why this caller may not run a field, or null when it may. */
  const refusal = (field: GraphQLField<unknown, unknown>): string | null => {
    if (!caller.role || !Object.hasOwn(ROLE_RANK, caller.role))
      return "Not allowed";
    const rule = field.astNode
      ? getDirectiveValues(auth, field.astNode)
      : undefined;
    if (rule?.signedIn === true && !caller.subject) return "Sign in required";
    const role = rule?.role as PageRole | undefined;
    if (role && ROLE_RANK[caller.role] < ROLE_RANK[role]) return "Not allowed";
    return null;
  };

  const namespaceValue = (mounted: Mounted) => {
    const resolvers = Object.create(null) as Record<string, unknown>;
    for (const field of Object.values(mounted.type.getFields())) {
      resolvers[field.name] = (
        args: Record<string, unknown>,
        _context: unknown,
        info: { path: Parameters<typeof responsePathAsArray>[0] },
      ) => {
        const key = responsePathAsArray(info.path).join(".");
        const settle = (outcome: Outcome) => {
          if (mutating) outcomes[key] = outcome;
        };
        const run = async (): Promise<AfJson> => {
          const refused = refusal(field);
          if (refused) {
            settle("rejected");
            throw new GraphQLError(refused);
          }
          if (signal.aborted) {
            settle("rejected");
            throw new GraphQLError("Cancelled before execution");
          }
          let value: AfJson;
          let reported: Outcome | undefined;
          try {
            value = await invoke({
              namespace: mounted.namespace,
              fileId: mounted.fileId,
              version: mounted.version,
              operation: mutating ? "mutation" : "query",
              field: field.name,
              args: json<AfJsonObject>(args),
              principal: { ...principal },
              signal,
              reportOutcome: outcome => { reported=outcome; },
            });
          } catch (error) {
            const extensions = extensionsOf(error, owner);
            if (
              error instanceof FieldNotExecuted ||
              (error instanceof Error && error.name === "FieldNotExecuted")
            ) {
              settle("rejected");
              throw new GraphQLError(
                extensions?.code === "retryable"
                  ? "Backend busy: the runner's queue stayed full after retries; nothing ran, so retrying is safe"
                  : "Backend request rejected before execution",
                { extensions },
              );
            }
            settle("unknown");
            throw new GraphQLError("Backend execution failed", { extensions });
          }
          settle(reported ?? "committed");
          // Results are data only: no getters, functions or prototypes reach graphql-js.
          return json<AfJson>(value);
        };
        if (!mutating) return run();
        // Mutation fields run one at a time in the order written; graphql-js
        // calls nested resolvers synchronously in selection order.
        const next = chain.then(run);
        chain = next.catch(() => undefined);
        return next;
      };
    }
    return resolvers;
  };
  const roots = mutating ? compiled.mutation : compiled.query;
  const rootValue = Object.create(null) as Record<string, unknown>;
  for (const [name, mounted] of roots)
    rootValue[name] = namespaceValue(mounted);

  // Only own data properties (and our own resolver functions) are read; never inherited ones.
  const fieldResolver: GraphQLFieldResolver<unknown, unknown> = (
    source,
    args,
    context,
    info,
  ) => {
    if (
      !source ||
      typeof source !== "object" ||
      !Object.hasOwn(source, info.fieldName)
    )
      return undefined;
    const value = (source as Record<string, unknown>)[info.fieldName];
    return typeof value === "function" ? value(args, context, info) : value;
  };
  // Abstract types: a backend names its own types; map them into its namespace.
  const typeResolver: GraphQLTypeResolver<unknown, unknown> = (
    value,
    _context,
    _info,
    abstractType,
  ) => {
    const own =
      value && typeof value === "object"
        ? (value as Record<string, unknown>).__typename
        : undefined;
    if (typeof own !== "string") return undefined;
    for (const namespace of compiled.namespaces) {
      if (!abstractType.name.startsWith(namespace + SEPARATOR)) continue;
      const name = namespace + SEPARATOR + own;
      if (schema.getType(name)) return name;
    }
    return undefined;
  };

  const result = await execute({
    schema,
    document,
    rootValue,
    variableValues: variables,
    operationName: request.operationName ?? undefined,
    fieldResolver,
    typeResolver,
  });
  let data = (
    result.data === undefined ? null : json(result.data)
  ) as AfJsonObject | null;
  let errors = result.errors ? plainErrors(result.errors) : undefined;
  if (
    data &&
    new TextEncoder().encode(JSON.stringify(data)).length > PAGE_OPERATION_RESULT_BYTES
  ) {
    data = null;
    errors = [{ message: "The selected result is larger than 4 MiB" }];
  }
  const response: RemoteResponse = { data };
  if (errors?.length) response.errors = errors;
  if (mutating) response.extensions = { outcomes };
  return response;
}

/** Bounded preflight used by the HTTP archive guard; execution repeats validation. */
export function pageOperationKind(query:string,operationName?:string):'query'|'mutation'|null {
 try{const operation=getOperationAST(boundedDocument(query),operationName);return operation?.operation==='query'?'query':operation?.operation==='mutation'?'mutation':null;}catch{return null;}
}

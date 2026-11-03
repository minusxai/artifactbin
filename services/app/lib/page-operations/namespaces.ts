/**
 * Page-level GraphQL over linked backend files (contract:
 * ./af-namespace-contracts.ts). Pure: graphql-js only, no I/O.
 *
 * Composition renames every type a file declares to `<name>__<Type>` and
 * mounts the file's roots as `Query.<name>` / `Mutation.<name>`. The composed
 * SDL is self-describing: each namespace field carries
 * `@backend(file, version)`, so execution needs nothing but the SDL.
 *
 * A dataset link on the generated API (`dataset-hasura` source) is the
 * exception: its roots mount flat on Query/Mutation with
 * `@dataset(link, file, version, table, field)`, its types keep their names
 * (the shared prelude once), and they execute through the request's dataset
 * port (lib/dataset-graphql `loadPageDatasets`), a mutation whole.
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
  type FieldNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type GraphQLDirective,
  type GraphQLField,
  type GraphQLFieldResolver,
  type GraphQLObjectType,
  type GraphQLSchema,
  type GraphQLTypeResolver,
  type TypeNode,
} from "graphql";
import { DATASET_ROLES, datasetRoleAtLeast, type DatasetRole, type HtmlJson as AfJson, type HtmlJsonObject as AfJsonObject, type PageMutationOutcome as Outcome, type PageNamespaceSource as NamespaceSource, type PageSchema, type PageOperationResponse as RemoteResponse } from '@artifactbin/contracts';
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
/** A generated dataset root's mount (the counterpart of @backend): its link, dataset, version, table root and kind. */
const DATASET_DIRECTIVE =
  "directive @dataset(link: String!, file: String!, version: String!, table: String!, field: String!) on FIELD_DEFINITION\n";
/**
 * Legacy uppercase `@auth(role:)` values keep their original meaning for immutable published code:
 * `VIEWER` was any reader of the page (a guest on a public link included), so it is `anonymous`.
 */
const LEGACY_AUTH_ROLES: Readonly<Record<'OWNER' | 'EDITOR' | 'VIEWER', DatasetRole>> = Object.freeze({ OWNER: 'owner', EDITOR: 'editor', VIEWER: 'anonymous' });
const authRole = (value: unknown): DatasetRole | null =>
  typeof value !== 'string' ? null
    : Object.hasOwn(LEGACY_AUTH_ROLES, value) ? LEGACY_AUTH_ROLES[value as keyof typeof LEGACY_AUTH_ROLES]
    : (DATASET_ROLES as readonly string[]).includes(value) ? value as DatasetRole : null;

/**
 * THE RESOLVER FIELD DECISION: why a caller with this page role may not run a field carrying this
 * `@auth` rule, or null when it may. Every role means "at least" (anonymous < signed_in < viewer <
 * editor < owner); `signedIn: true` is at least `signed_in`; no directive is anonymous (any reader).
 * A caller without a page role, or a rule naming no known role, is refused.
 */
export function resolverFieldRefusal(
  role: DatasetRole | null,
  rule: { role?: unknown; signedIn?: unknown } | undefined,
): 'Sign in required' | 'Not allowed' | null {
  if (!role || !(DATASET_ROLES as readonly string[]).includes(role)) return 'Not allowed';
  const named = rule?.role === undefined || rule.role === null ? 'anonymous' : authRole(rule.role);
  if (!named) return 'Not allowed';
  const signIn = rule?.signedIn === true || named === 'signed_in';
  if (signIn && role === 'anonymous') return 'Sign in required';
  if (!datasetRoleAtLeast(role, named)) return 'Not allowed';
  return null;
}
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
  /** Generated dataset roots (flat), by field name → their link. */
  datasetQuery: Map<string, string>;
  datasetMutation: Map<string, string>;
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
  const generated = sources.filter((source) => source?.kind === "dataset-hasura");
  for (const source of sources) {
    if (source?.kind === "dataset-hasura") continue;
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
  if (generated.length) {
    parts.splice(2, 0, DATASET_DIRECTIVE);
    mountDatasets(generated, names, owners, parts, query, mutation);
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

/**
 * Mount the generated dataset sources flat: each root on Query/Mutation, nullable (one failure stays local), with
 * `@dataset`; each type once under its own name (the shared prelude repeats identically across links). A root
 * equal to a resolver link's name, or another link's root, refuses the page: `graphql_root_collision`.
 */
function mountDatasets(
  sources: readonly NamespaceSource[],
  names: string[],
  owners: Map<string, string>,
  parts: string[],
  query: string[],
  mutation: string[],
): void {
  const rootOwner = new Map<string, string>(names.map((name) => [name, name]));
  const types = new Map<string, string>();
  for (const source of sources) {
    const name = source.name;
    const label = JSON.stringify(String(name));
    if (typeof name !== "string" || !GRAPHQL_NAME.test(name) || name.startsWith(SEPARATOR))
      throw Error(`Dataset name ${label} is not a GraphQL name`);
    if (names.includes(name)) throw Error(`Backend name ${label} is used more than once`);
    if (typeof source.fileId !== "string" || !FILE_ID_PATTERN.test(source.fileId))
      throw Error(`Dataset ${name} has an invalid file ID`);
    if (typeof source.version !== "string" || !source.version)
      throw Error(`Dataset ${name} has no version`);
    names.push(name);
    let document: DocumentNode;
    try { document = parse(source.typeDefs); } catch (error) {
      throw Error(`Dataset ${name} has an invalid schema: ${messageOf(error)}`);
    }
    // Roots first, so a collision names the link that owns the name.
    const isRoot = (definition: DocumentNode["definitions"][number]) => definition.kind === Kind.OBJECT_TYPE_DEFINITION && (definition.name.value === "Query" || definition.name.value === "Mutation");
    for (const definition of [...document.definitions.filter(isRoot), ...document.definitions.filter((d) => !isRoot(d))]) {
      if (definition.kind === Kind.OBJECT_TYPE_DEFINITION && (definition.name.value === "Query" || definition.name.value === "Mutation")) {
        for (const field of definition.fields ?? []) {
          const root = field.name.value;
          if (root === "no_queries_available") continue;
          const other = rootOwner.get(root);
          if (other !== undefined)
            throw Error(`graphql_root_collision: link ${name} generates ${root}, which link ${other} also names`);
          rootOwner.set(root, name);
          const meta = source.roots?.[root];
          const mount = `@dataset(link: ${JSON.stringify(name)}, file: ${JSON.stringify(source.fileId)}, version: ${JSON.stringify(source.version)}, table: ${JSON.stringify(meta?.table ?? root)}, field: ${JSON.stringify(meta?.field ?? root)})`;
          const nullable = field.type.kind === Kind.NON_NULL_TYPE ? { ...field, type: field.type.type } : field;
          (definition.name.value === "Query" ? query : mutation).push(`  ${print(nullable)} ${mount}`);
        }
        continue;
      }
      if (!TYPE_DEFINITIONS.has(definition.kind) || !("name" in definition) || !definition.name)
        throw Error(`Dataset ${name} has an invalid schema`);
      const type = definition.name.value;
      const printed = print(definition);
      const prior = types.get(type);
      if (prior === printed) continue;
      const claimed = rootOwner.get(type);
      if (claimed !== undefined && claimed !== name)
        throw Error(`graphql_root_collision: link ${name} generates ${type}, which link ${claimed} also names`);
      if (prior !== undefined || owners.has(type) || SHARED_TYPES.has(type))
        throw Error(`graphql_root_collision: link ${name} generates the type ${type}, which another link also names`);
      types.set(type, printed);
      parts.push(printed);
    }
  }
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
  const dataset = schema.getDirective("dataset");
  const datasetMounts = (root: GraphQLObjectType | null | undefined) => {
    const mounted = new Map<string, string>();
    if (!dataset) return mounted;
    for (const field of Object.values(root?.getFields() ?? {})) {
      const meta = field.astNode ? getDirectiveValues(dataset, field.astNode) : undefined;
      if (meta) mounted.set(field.name, String(meta.link));
    }
    return mounted;
  };
  return { schema, auth, query, mutation, namespaces, datasetQuery: datasetMounts(schema.getQueryType()), datasetMutation: datasetMounts(schema.getMutationType()) };
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
  // A caller without a page role never reaches a resolver (refused first); anonymous is only the type's floor.
  const principal = { tenant: caller.pageId, subject: caller.subject, role: caller.role ?? "anonymous" as const };
  // The owner may read what their own backend said; nobody else learns more than the code.
  const owner = caller.role === "owner";
  const outcomes: Record<string, Outcome> = {};
  let chain: Promise<unknown> = Promise.resolve();

  /** Why this caller may not run a field, or null when it may. */
  const refusal = (field: GraphQLField<unknown, unknown>): string | null =>
    resolverFieldRefusal(
      caller.role,
      field.astNode ? getDirectiveValues(auth, field.astNode) : undefined,
    );

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
                  ? "Backend busy: the runner refused admission (busy or restarting) after retries; nothing ran, so retrying is safe"
                  : "Backend request rejected before execution",
                { extensions },
              );
            }
            settle("unknown");
            // A message the resolver threw (redacted by the invoker) is shown to every caller; any other failure is not.
            const shown = extensions ? boundedDetail((error as { shown?: unknown }).shown) : undefined;
            throw new GraphQLError(shown ?? "Backend execution failed", { extensions });
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

  // A mutation naming a generated dataset root goes whole through the dataset door: one dataset, one atomic step.
  const touched = mutating ? topLevelFields(document, operation).filter((field) => field.name.value !== "__typename") : [];
  if (touched.some((field) => compiled.datasetMutation.has(field.name.value))) {
    if (!touched.every((field) => compiled.datasetMutation.has(field.name.value)))
      return failure("A mutation that writes a linked dataset names only that dataset's fields");
    return datasetMutation(options, touched.map((field) => (field.alias ?? field.name).value));
  }
  for (const name of mutating ? [] : compiled.datasetQuery.keys())
    rootValue[name] = (args: unknown, context: unknown, info: unknown) => {
      if (!options.datasets) throw new GraphQLError("The linked dataset is unavailable");
      const resolve = options.datasets.queryRoots()[name];
      return typeof resolve === "function" ? resolve(args, context, info) : null;
    };

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

/** The operation's top-level fields, through inline fragments and fragment spreads. */
function topLevelFields(document: DocumentNode, operation: OperationDefinitionNode): FieldNode[] {
  const fragments = new Map(document.definitions.filter((node): node is FragmentDefinitionNode => node.kind === Kind.FRAGMENT_DEFINITION).map((node) => [node.name.value, node]));
  const walk = (set: SelectionSetNode, seen: ReadonlySet<string>): FieldNode[] => set.selections.flatMap((node) => {
    if (node.kind === Kind.FIELD) return [node];
    if (node.kind === Kind.INLINE_FRAGMENT) return walk(node.selectionSet, seen);
    const fragment = seen.has(node.name.value) ? undefined : fragments.get(node.name.value);
    return fragment ? walk(fragment.selectionSet, new Set([...seen, node.name.value])) : [];
  });
  return walk(operation.selectionSet, new Set());
}

/**
 * A mutation over generated dataset roots: the dataset door writes it as one step (validated, judged under the
 * caller's rules, idempotent under the request's key). Every field shares the step's outcome: committed when it
 * applied, unknown when its reply was lost, rejected otherwise.
 */
async function datasetMutation(options: ExecuteOptions, keys: readonly string[]): Promise<RemoteResponse> {
  if (!options.datasets) return failure("The linked dataset is unavailable");
  const reply = await options.datasets.mutate(options.request);
  const errors: RemoteError[] = (reply.errors ?? []).map((e) => ({
    message: e.message,
    ...(e.path ? { path: [...e.path] } : {}),
    ...(FIELD_ERROR_CODE.test(e.extensions.code) ? { extensions: { code: e.extensions.code } } : {}),
  }));
  let data = (reply.data === undefined ? null : json(reply.data)) as AfJsonObject | null;
  const outcome: Outcome = errors.some((e) => e.extensions?.code === "outcome_unknown") ? "unknown"
    : !errors.length || (data && Object.values(data).some((value) => value !== null)) ? "committed" : "rejected";
  if (data && new TextEncoder().encode(JSON.stringify(data)).length > PAGE_OPERATION_RESULT_BYTES) {
    data = null;
    errors.splice(0, errors.length, { message: "The selected result is larger than 4 MiB" });
  }
  const response: RemoteResponse = { data, extensions: { outcomes: Object.fromEntries(keys.map((key) => [key, outcome])) } };
  if (errors.length) response.errors = errors;
  return response;
}

/** Bounded preflight used by the HTTP archive guard; execution repeats validation. */
export function pageOperationKind(query:string,operationName?:string):'query'|'mutation'|null {
 try{const operation=getOperationAST(boundedDocument(query),operationName);return operation?.operation==='query'?'query':operation?.operation==='mutation'?'mutation':null;}catch{return null;}
}

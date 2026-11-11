/**
 * Page-level GraphQL (deprecated, lib/graphql-compat): the composed schema a page's GraphQL door executes. Pure:
 * graphql-js only, no I/O.
 *
 * A dataset link on the generated API (`dataset-hasura` source) mounts its roots flat on Query/Mutation with
 * `@dataset(link, file, version, table, field)`, its types keep their names (the shared prelude once), and they
 * execute through the request's dataset port (lib/graphql-compat `loadPageDatasets`), a mutation whole.
 *
 * Every page also answers the built-in `viewer` (contracts `PAGE_VIEWER_ROOT`) from the caller alone, and a page
 * that links a dataset the read-only `_sql` (contracts `PAGE_SQL_ROOT`) through the request's dataset port; no link
 * may be named, or generate, their roots or types.
 */
import {
  execute,
  getDirectiveValues,
  getOperationAST,
  getVariableValues,
  GraphQLError,
  Kind,
  parse,
  print,
  validate,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type GraphQLFieldResolver,
  type GraphQLObjectType,
  type GraphQLSchema,
} from "graphql";
import { PAGE_SQL_ROOT, PAGE_SQL_TYPES, PAGE_VIEWER_ROOT, PAGE_VIEWER_TYPE, SQL_READ_LIMITS, datasetRoleAtLeast, type Scalar, type HtmlJsonObject as AfJsonObject, type PageMutationOutcome as Outcome, type PageNamespaceSource as NamespaceSource, type PageSchema, type PageOperationResponse as RemoteResponse } from '@artifactbin/contracts';
import { PAGE_OPERATION_RESULT_BYTES, FIELD_ERROR_CODE, type ExecuteOptions, type RemoteError } from './contracts';
import { boundedDocument, boundedSchema } from "./execution-policy";
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const GRAPHQL_NAME = /^[_A-Za-z][_0-9A-Za-z]*$/;
const SEPARATOR = "__";
const SHARED_TYPES = new Set(["String", "Int", "Float", "Boolean", "ID"]);
/** A generated dataset root's mount (the counterpart of @backend): its link, dataset, version, table root and kind. */
const DATASET_DIRECTIVE =
  "directive @dataset(link: String!, file: String!, version: String!, table: String!, field: String!) on FIELD_DEFINITION\n";
/** The built-in viewer (contracts `PAGE_VIEWER_ROOT`): mounted on every page's Query, answered from the caller alone. */
const VIEWER_SDL = `type ${PAGE_VIEWER_TYPE} {\n  signedIn: Boolean!\n  id: ID\n  name: String\n  "May this viewer edit this page (its text regions)? Owner and shared editors only. Advisory: edits are still judged."\n  canEdit: Boolean!\n}\n`;
const BUILT_IN_VIEWER = "the built-in viewer query";
/** The read-only SQL door (contracts `PAGE_SQL_ROOT`): mounted on Query when the page links a dataset. */
const SQL_SDL = `"One read-only SQL answer: its columns in order, and its rows as objects keyed by column name."\ntype SqlResult {\n  columns: [SqlColumn!]!\n  rows: [JSON!]!\n}\ntype SqlColumn {\n  name: String!\n  type: String!\n}\n"Any JSON value."\nscalar JSON\n`;
const SQL_FIELD = `  "One read-only SQL statement over the page's linked datasets, as this reader: a single-table dataset is the table named like its link, a multi-table one <link>.<table>; each shows only the rows and columns the reader's rule shows. $name params bind values. A rule without allow_aggregations refuses it."\n  ${PAGE_SQL_ROOT}(sql: String!, params: JSON): SqlResult`;
const BUILT_IN_SQL = "the built-in read-only SQL query";
const SQL_PARAM = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
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

interface Compiled {
  schema: GraphQLSchema;
  /** Generated dataset roots (flat), by field name → their link. */
  datasetQuery: Map<string, string>;
  datasetMutation: Map<string, string>;
}
const compiledSchemas = new WeakMap<PageSchema, Compiled>();

export function composePageSchema(
  sources: readonly NamespaceSource[],
): PageSchema {
  if (!Array.isArray(sources) || sources.length > MAX_SOURCES)
    throw Error(`A page links at most ${MAX_SOURCES} datasets`);
  if (sources.some((source) => source?.kind !== "dataset-hasura"))
    throw Error("A page schema composes dataset links only");
  const names: string[] = [];
  const parts = [VIEWER_SDL];
  const query: string[] = [`  ${PAGE_VIEWER_ROOT}: ${PAGE_VIEWER_TYPE}!`];
  const mutation: string[] = [];
  if (sources.length) {
    parts.unshift(DATASET_DIRECTIVE, SQL_SDL);
    query.push(SQL_FIELD);
    mountDatasets(sources, names, parts, query, mutation);
  }
  parts.push(`type Query {\n${query.join("\n")}\n}`);
  if (mutation.length) parts.push(`type Mutation {\n${mutation.join("\n")}\n}`);
  const sdl = parts.join("\n");
  if (new TextEncoder().encode(sdl).length > MAX_COMPOSED_BYTES)
    throw Error("The page's dataset schemas are too large");
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
 * another link also generates refuses the page: `graphql_root_collision`.
 */
function mountDatasets(
  sources: readonly NamespaceSource[],
  names: string[],
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
    if (names.includes(name)) throw Error(`Dataset name ${label} is used more than once`);
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
          if (root === PAGE_VIEWER_ROOT)
            throw Error(`graphql_root_collision: link ${name} generates ${root}, ${BUILT_IN_VIEWER}`);
          if (root === PAGE_SQL_ROOT)
            throw Error(`graphql_root_collision: link ${name} generates ${root}, ${BUILT_IN_SQL}`);
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
      if (type === PAGE_VIEWER_TYPE)
        throw Error(`graphql_root_collision: link ${name} generates the type ${type}, ${BUILT_IN_VIEWER}`);
      if ((PAGE_SQL_TYPES as readonly string[]).includes(type))
        throw Error(`graphql_root_collision: link ${name} generates the type ${type}, ${BUILT_IN_SQL}`);
      const prior = types.get(type);
      if (prior === printed) continue;
      const claimed = rootOwner.get(type);
      if (claimed !== undefined && claimed !== name)
        throw Error(`graphql_root_collision: link ${name} generates ${type}, which link ${claimed} also names`);
      if (prior !== undefined || SHARED_TYPES.has(type))
        throw Error(`graphql_root_collision: link ${name} generates the type ${type}, which another link also names`);
      types.set(type, printed);
      parts.push(printed);
    }
  }
}

function compile(sdl: string): Compiled {
  const schema = boundedSchema(sdl, MAX_COMPOSED_BYTES);
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
  return { schema, datasetQuery: datasetMounts(schema.getQueryType()), datasetMutation: datasetMounts(schema.getMutationType()) };
}

const json = <T>(value: unknown): T =>
  value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);

function plainErrors(errors: readonly GraphQLError[]): RemoteError[] {
  return errors.map((error) => {
    const plain: RemoteError = { message: error.message };
    if (error.path) plain.path = [...error.path];
    // Only the code a dataset field's error carries.
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
  const { request } = options;
  let compiled: Compiled;
  try {
    compiled =
      compiledSchemas.get(options.schema) ?? compile(options.schema.sdl);
  } catch {
    return failure("The page's schema is unavailable");
  }
  const { schema } = compiled;
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
  const rootValue = Object.create(null) as Record<string, unknown>;
  if (!mutating) rootValue[PAGE_VIEWER_ROOT] = viewerValue(options);
  if (!mutating) rootValue[PAGE_SQL_ROOT] = (args: Record<string, unknown>) => pageSql(options, args, signal);

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
  const result = await execute({
    schema,
    document,
    rootValue,
    variableValues: variables,
    operationName: request.operationName ?? undefined,
    fieldResolver,
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
  if (mutating) response.extensions = { outcomes: {} };
  return response;
}

/**
 * The built-in viewer, from the caller alone: signed in when the caller's page role is at least `signed_in`. Then
 * `id` is the caller's account and `name` its display name, read through the port only when selected; anyone else
 * reads nulls. `canEdit` is the page edit check the live-region editor uses (the `canEdit` port), read only when
 * selected; false without one. Nothing else about the reader is here.
 */
function viewerValue({ caller, viewerName, canEdit }: ExecuteOptions): Record<string, unknown> {
  const subject = caller.subject;
  const editable = async () => (await canEdit?.()) === true;
  if (subject === null || !caller.role || !datasetRoleAtLeast(caller.role, "signed_in"))
    return { signedIn: false, id: null, name: null, canEdit: editable };
  return { signedIn: true, id: subject, name: async () => (await viewerName?.(subject)) ?? null, canEdit: editable };
}

const sqlFailure = (code: string, message: string) => new GraphQLError(message, { extensions: { code } });
/**
 * `_sql`: its arguments checked here, for every port alike (a statement of at most SQL_READ_LIMITS.sqlBytes; params an
 * object of at most SQL_READ_LIMITS.params scalars under identifiers), then run by the request's dataset port as
 * the caller. Failures keep the port's `extensions.code`.
 */
async function pageSql({ datasets }: ExecuteOptions, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  if (!datasets?.sql) throw sqlFailure("unavailable", "The linked datasets are unavailable");
  const sql = args.sql;
  if (typeof sql !== "string" || !sql.trim()) throw sqlFailure("validation_failed", "_sql takes one SQL statement");
  if (new TextEncoder().encode(sql).length > SQL_READ_LIMITS.sqlBytes) throw sqlFailure("input_too_large", `a statement is at most ${SQL_READ_LIMITS.sqlBytes} bytes`);
  const raw = args.params ?? {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw sqlFailure("validation_failed", "params must be an object of scalars");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > SQL_READ_LIMITS.params) throw sqlFailure("input_too_large", `at most ${SQL_READ_LIMITS.params} params`);
  const params: Record<string, Scalar> = {};
  for (const [key, value] of entries) {
    const scalar = value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    if (!SQL_PARAM.test(key) || !scalar) throw sqlFailure("validation_failed", `param ${key.slice(0, 64)} must be a string, number, boolean or null under an identifier`);
    params[key] = value as Scalar;
  }
  signal.throwIfAborted();
  return datasets.sql({ sql, params });
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

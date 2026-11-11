/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * THE DIRECT DATASET GRAPHQL API: one dataset's generated schema (./hasura-schema) for the caller's role, its
 * reads through the read compiler (./hasura-read) and the retained executor, which mounts the caller's role view
 * as every table, and its mutations through the mutation compiler (./hasura-write) and the one write path
 * (lib/document-data `mutateDataset`). The role is the dataset's own sharing (`direct`): no page audience.
 *
 * Reads: every engine statement goes through the retained port's `execute`, so the role view and the read fence
 * (role, policy revision and head identity) hold for each one; the fences retained while answering are checked
 * again before the reply leaves.
 *
 * Mutations: the operation's root fields (aliases, variables and directives resolved by graphql-js) compile to
 * row-addressed statements that run as ONE `mutateDataset` write: one version step, every statement judged
 * under the role's rule, the decision taken again under the row lock, the public-write rate limit, at most
 * DATASET_GRAPHQL_WRITE_LIMITS.rows changed rows. Like Hasura, a mutation applies to the current head: a lost
 * version CAS re-runs the statements on the new head (casRetries times), judged again each time. The
 * Idempotency-Key and the dataset name a durable receipt (lib/artifacts `durableMutation`, as the retained
 * `requestId` receipts): the reply is computed and saved in the transaction that commits, so a replay answers
 * exactly the first reply and writes nothing; generated `_id`s derive from it, so a re-run inserts the same rows.
 * `returning` and the `_one`/`_by_pk` row are the written rows as the role's select rule shows them.
 *
 * What the caller may change (`<root>_can`, a row's `_can`; ./can) comes from the same write decision the mutation
 * root is generated from: a rule's filter is decided in the statement that reads the rows, or in memory for the rows
 * a mutation returns. The answers are advisory; writes are judged as above.
 *
 * Errors carry `extensions.code` and never row data.
 */
import { createHash, randomUUID } from 'node:crypto';
import { buildSchema, getOperationAST, GraphQLError, parse, validate, execute, type DocumentNode, type ExecutionResult, type GraphQLResolveInfo, type GraphQLSchema, type OperationDefinitionNode } from 'graphql';
import {
  DATASET_GRAPHQL_READ_LIMITS,
  DATASET_GRAPHQL_WRITE_LIMITS,
  type DatasetGraphqlError,
  type DatasetGraphqlErrorCode,
  type DatasetGraphqlReply,
  type DatasetGraphqlRequest,
  type DatasetGraphqlSchemaReply,
  type HtmlDatasetLink,
  type Queryable,
} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { completeMutationReceipt, durableMutation, getArtifactById, getArtifactHeaderById, type ArtifactRow } from '@/lib/artifacts';
import { datasetWriteAccess, filterAdmits } from '@/lib/dataset-permissions';
import { isMutationRefused, mutateDataset, type MutationStep } from '@/lib/document-data';
import {
  authorityShape, columnsOf, datasetBindingCatalog, fenced, ID_COLUMN, linkedRoot, load, loadLinked, notFound, readAuthorityIn, refusal,
  resolveDatasetBinding, rowIdsForObject, rowsNow, runPageSql, shownRows, tableIdentity,
  type DatasetSnapshot, type DatasetStatement, type Loaded, type LoadedTable, type PageCommitGuard, type PageScope, type PageSqlAnswer,
  type PageSqlCall, type ReadAuthority, type WrittenOutcome,
} from '@/lib/dataset-access';
import { CAN_FIELD, hasuraSdl, type HasuraTableModel } from './hasura-schema';
import { askedCan, rowCan, tableCan, withCan } from './can';
import { hasuraGeneratedNames, hasuraNames, storedConfiguration } from './hasura-names';
import { compileRows, HasuraReadError, type HasuraReadArgs } from './hasura-read';
import { compileMutation, HasuraWriteError, mutationRoots, type HasuraMutationKind } from './hasura-write';

export type { PageCommitGuard };

/** Is this id a dataset (the route's branch)? Existence only: every answer below decides access itself. */
export async function isDatasetGraphqlTarget(id: string): Promise<boolean> {
  return (await getArtifactHeaderById(id))?.format === 'dataset';
}

/** GET: the caller's own SDL, the head revision and the role it was generated for. */
const directBinding = (datasetId: string): HtmlDatasetLink => ({ kind: 'dataset', name: 'data', datasetId, mode: 'live' });

export async function datasetGraphqlSchema(actor: AccessActor, datasetId: string, signal: AbortSignal): Promise<DatasetGraphqlSchemaReply> {
  const loaded = await load(actor, directBinding(datasetId), signal, { direct: true, fenced: true });
  const sdl = hasuraSdl(loaded.tables.map((t) => t.model));
  await fenced(loaded);
  if (loaded.snapshot) return { sdl, revision: loaded.snapshot.revision, role: loaded.snapshot.role! };
  const row = await getArtifactById(datasetId), decision = row && await datasetWriteAccess(row, actor, { throughPage: false });
  if (!row || !decision?.allowed) throw notFound();
  return { sdl, revision: String(row.version), role: decision.role };
}

const error = (message: string, code: DatasetGraphqlErrorCode, path?: readonly (string | number)[]): DatasetGraphqlError => ({ message, ...(path ? { path } : {}), extensions: { code } });

/** A resolver's failure as a client error: the compilers' own refusals keep their message; nothing else does. */
function classify(e: GraphQLError): DatasetGraphqlError {
  const cause = e.originalError;
  if (!cause) return error(e.message, 'validation_failed', e.path);
  if (cause instanceof HasuraReadError) return error(cause.message, 'validation_failed', e.path);
  if (cause instanceof HasuraWriteError) return error(cause.message, cause.code, e.path);
  if (cause.message === 'dataset_changed') return error('the dataset or your access changed during the request; retry', 'dataset_changed', e.path);
  if (cause instanceof GraphQLError) return error(cause.message, 'validation_failed', e.path);
  return error('the read failed', 'unexpected', e.path);
}

/** Root resolvers over the loaded tables: one engine statement per list and `_by_pk`; `budget` is shared by every dataset in one request. */
function rootValue(actor: AccessActor, loaded: Loaded, signal: AbortSignal, budget = { statements: 0 }, root: Record<string, unknown> = {}): Record<string, unknown> {
  const run = async (tableId: string, statement: DatasetStatement, window: { limit: number; offset: number }) => {
    if (++budget.statements > DATASET_GRAPHQL_READ_LIMITS.statements) throw new HasuraReadError(`a request runs at most ${DATASET_GRAPHQL_READ_LIMITS.statements} reads`);
    return loaded.port.execute(actor, loaded.snapshot!, tableId, statement, window, signal);
  };
  root.no_queries_available ??= () => 'There are no queries available to the current role.';
  for (const { model, tableId } of loaded.tables) {
    if (model.select === false) continue;
    // `info` says which `_can` fields the rows are asked for (./can): decided in the same statement as the rows.
    const rows = async (args: HasuraReadArgs, info?: GraphQLResolveInfo) => {
      const asked = askedCan(info), plan = compileRows(model, args, asked);
      return plan.window.limit === 0 ? [] : withCan(model, asked, await run(tableId, plan.statement, plan.window));
    };
    root[model.root] = (args: HasuraReadArgs, _: unknown, info?: GraphQLResolveInfo) => rows(args, info);
    root[`${model.root}_by_pk`] = async ({ _id }: { _id: string }, _: unknown, info?: GraphQLResolveInfo) => (await rows({ where: { _id: { _eq: _id } }, limit: 1 }, info))[0] ?? null;
    root[`${model.root}_can`] = () => tableCan(model);
  }
  return root;
}

const schemas = new Map<string, GraphQLSchema>();
/** Built schemas by SDL (a role's schema repeats across requests); bounded, least recently used out first. */
function schemaFor(sdl: string): GraphQLSchema {
  let schema = schemas.get(sdl);
  if (schema) { schemas.delete(sdl); schemas.set(sdl, schema); return schema; }
  schema = buildSchema(sdl);
  schemas.set(sdl, schema);
  if (schemas.size > 64) schemas.delete(schemas.keys().next().value!);
  return schema;
}

/** POST: run one query against the caller's schema. Throws `dataset_not_found` when the role reads nothing. */
export async function executeDatasetGraphql(actor: AccessActor, datasetId: string, request: DatasetGraphqlRequest, signal: AbortSignal): Promise<DatasetGraphqlReply> {
  // Parsed first only to know whether the reply is fenced (a query's is); a refusal still answers before any parse error.
  const parsed = parsedOperation(request);
  const loaded = await load(actor, directBinding(datasetId), signal, { direct: true, fenced: !('errors' in parsed) && parsed.operation.operation === 'query' });
  if ('errors' in parsed) return parsed;
  if (parsed.operation.operation === 'mutation') {
    const schema = schemaFor(hasuraSdl(loaded.tables.map((t) => t.model)));
    const invalid = validate(schema, parsed.document);
    if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
    return executeMutation(actor, [loaded], schema, parsed.document, request);
  }
  if (parsed.operation.operation !== 'query') return { errors: [error(`this dataset's schema has no ${parsed.operation.operation} root`, 'validation_failed')] };
  return run(actor, [loaded], parsed.document, request, signal, DATASET_GRAPHQL_READ_LIMITS.resultBytes);
}

/** Parse and pick the operation before validating, so a mutation is refused by kind rather than as a schema miss. */
function parsedOperation(request: DatasetGraphqlRequest): { document: DocumentNode; operation: OperationDefinitionNode } | { errors: DatasetGraphqlError[] } {
  let document: DocumentNode;
  try { document = parse(request.query, { maxTokens: 10_000 }); } catch (e) { return { errors: [error((e as Error).message, 'validation_failed')] }; }
  const operation = getOperationAST(document, request.operationName);
  if (!operation) return { errors: [error('name the operation to run (operationName)', 'validation_failed')] };
  return { document, operation };
}

/** Validate against the loaded tables' schema, run, fence every dataset, then bound the answer. */
async function run(actor: AccessActor, loaded: readonly Loaded[], document: DocumentNode, request: DatasetGraphqlRequest, signal: AbortSignal, resultBytes: number): Promise<DatasetGraphqlReply> {
  const schema = schemaFor(hasuraSdl(loaded.flatMap((l) => l.tables.map((t) => t.model))));
  const invalid = validate(schema, document);
  if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
  const budget = { statements: 0 }, root: Record<string, unknown> = {};
  for (const l of loaded) rootValue(actor, l, signal, budget, root);
  const result = await execute({ schema, document, rootValue: root, variableValues: request.variables ?? {}, ...(request.operationName ? { operationName: request.operationName } : {}) });
  // Results leave only if the role, policy and head the reads were decided for still hold.
  for (const l of loaded) await fenced(l);
  const errors = result.errors?.map(classify);
  if (result.data && new TextEncoder().encode(JSON.stringify(result.data)).length > resultBytes) {
    return { data: null, errors: [error(`the answer is larger than ${resultBytes} bytes; select fewer rows or columns`, 'result_too_large')] };
  }
  return { ...(result.data !== undefined ? { data: result.data as Record<string, unknown> | null } : {}), ...(errors?.length ? { errors } : {}) };
}


interface LinkedDatasetGraphqlOptions {
  /** The operation the caller asked for: mutations only when it is `mutation`. */
  operation: 'query' | 'mutation' | undefined;
  /** Serialized `data` bytes the answer may carry. */
  resultBytes: number;
  /** The page the call reads through (`X-Hasura-Page-Id`). */
  pageId?: string;
  /** A mutation commits only while the page holds (lib/page-doors `pageCommitGuard`). */
  commitGuard?: PageCommitGuard;
}

/**
 * A PAGE'S LINKED DATASETS AS ONE GENERATED API, run as the caller (never owner rights): reads always; writes only
 * when the call is a mutation, through the one generated mutation path under each dataset's rules for the caller's
 * role through the page.
 */
export async function executeLinkedDatasetGraphql(actor: AccessActor, links: readonly HtmlDatasetLink[], request: DatasetGraphqlRequest, options: LinkedDatasetGraphqlOptions, signal: AbortSignal): Promise<DatasetGraphqlReply> {
  const parsed = parsedOperation(request);
  if ('errors' in parsed) return parsed;
  const kind = parsed.operation.operation;
  if (kind === 'subscription') return { errors: [error('there is no subscription root', 'validation_failed')] };
  if (kind === 'mutation' && options.operation !== 'mutation') return { errors: [error('a dataset mutation runs only as a mutation call', 'permission_denied')] };
  let loaded: Loaded[];
  try { loaded = await loadLinked(actor, links, { ...(options.pageId ? { pageId: options.pageId } : {}), fenced: kind === 'query' }, signal); } catch (e) {
    if (e instanceof GraphQLError) return { errors: [error(e.message, 'validation_failed')] };
    throw e;
  }
  if (!loaded.length) return { errors: [error('no linked dataset is readable', 'dataset_not_found')] };
  if (kind === 'mutation') return linkedMutation(actor, loaded, parsed.document, request, options.pageId, options.commitGuard);
  return run(actor, loaded, parsed.document, request, signal, options.resultBytes);
}

/** A mutation over linked datasets: validated against their joint schema, written as one dataset's step. */
async function linkedMutation(actor: AccessActor, loaded: readonly Loaded[], document: DocumentNode, request: DatasetGraphqlRequest, pageId: string | undefined, commitGuard?: PageCommitGuard): Promise<DatasetGraphqlReply> {
  const schema = schemaFor(hasuraSdl(loaded.flatMap((l) => l.tables.map((t) => t.model))));
  const invalid = validate(schema, document);
  if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
  return executeMutation(actor, loaded, schema, document, request, pageId, commitGuard);
}

/**
 * Every root and type name a generated-API link would put in the page schema, from the dataset's declared tables
 * (role-independent, so publishing can refuse a collision no reader would otherwise see until their request).
 */
export async function pageDatasetRoots(actor: AccessActor, link: HtmlDatasetLink): Promise<string[]> {
  const row = await resolveDatasetBinding(actor, link);
  const declared = datasetBindingCatalog(row);
  const roots = hasuraNames(declared.tables, { title: row.title, configuration: storedConfiguration(row.dataset_policy) });
  return roots.flatMap(({ root }) => hasuraGeneratedNames(linkedRoot(link.name, roots.length, root)));
}

/** One link's publish-check schema (lib/page-operations `PageDocumentDataset`). */
export interface PageDatasetCheckSource {
  name: string;
  fileId: string;
  version: string;
  typeDefs: string;
  /** The dataset's own API names (its direct GraphQL) → this link's page names. */
  renames: Record<string, string>;
}

/**
 * THE PAGE'S DATASETS AS PUBLISH CHECKS SEE THEM: every link under its page name with every root, column and write
 * a role could be given (role-independent, from the declared tables, as `pageDatasetRoots`), so a document
 * valid for any reader is never refused; `sdl` is all of them as one API. Null when no dataset is linked.
 */
export async function pageDatasetCheckSources(actor: AccessActor, links: readonly HtmlDatasetLink[]): Promise<{ sdl: string; sources: PageDatasetCheckSource[] } | null> {
  if (!links.length) return null;
  const all: HasuraTableModel[] = [], sources: PageDatasetCheckSource[] = [];
  for (const link of links) {
    const row = await resolveDatasetBinding(actor, link);
    const declared = datasetBindingCatalog(row);
    const names = hasuraNames(declared.tables, { title: row.title, configuration: storedConfiguration(row.dataset_policy) });
    const models = declared.tables.map((table, i): HasuraTableModel => {
      const columns = columnsOf(table, names[i]!);
      return { root: linkedRoot(link.name, declared.tables.length, names[i]!.root), table: { schema: table.schema, name: table.name }, columns, write: { insert: columns, update: columns, delete: true } };
    });
    const renames: Record<string, string> = {};
    names.forEach(({ root }, i) => {
      const page = hasuraGeneratedNames(models[i]!.root);
      if (root !== models[i]!.root) hasuraGeneratedNames(root).forEach((own, j) => { renames[own] = page[j]!; });
    });
    all.push(...models);
    sources.push({ name: link.name, fileId: link.datasetId, version: link.mode === 'pinned' ? link.revision : 'live', typeDefs: hasuraSdl(models), renames });
  }
  return { sdl: hasuraSdl(all), sources };
}

/** One hasura link's composition source: its role's SDL, mounted flat at the top of the page schema. */
interface PageDatasetSource {
  name: string;
  fileId: string;
  version: string;
  typeDefs: string;
  /** Root field → the table root it reads or writes and its kind (the `@dataset` directive's `table` and `field`). */
  roots: Readonly<Record<string, { table: string; field: string }>>;
}

/** The page request's view of its hasura-linked datasets: composition sources, query roots and the mutation door. */
export interface PageDatasets {
  sources: readonly PageDatasetSource[];
  /** Query root resolvers by field name; failures carry `extensions.code` and never row data. */
  queryRoots(): Record<string, unknown>;
  /** One mutation operation over these datasets (all its fields one dataset's): one atomic, idempotent step. */
  mutate(request: DatasetGraphqlRequest): Promise<DatasetGraphqlReply>;
  /** The page's `_sql`: one read-only statement over these links as the reader (./page-sql); failures carry `extensions.code`. */
  sql(call: PageSqlCall): Promise<PageSqlAnswer>;
}

/** A failure inside a page query root as a GraphQL error the page passes on with its code. */
function codedError(e: unknown): GraphQLError {
  if (e instanceof GraphQLError && typeof e.extensions?.code === 'string') return e;
  const coded = e instanceof HasuraReadError ? error(e.message, 'validation_failed')
    : e instanceof Error && e.message === 'dataset_changed' ? error('the dataset or your access changed during the request; retry', 'dataset_changed')
    : e instanceof GraphQLError ? error(e.message, 'validation_failed')
    : error('the read failed', 'unexpected');
  return new GraphQLError(coded.message, { extensions: { code: coded.extensions.code } });
}
/** Every resolver function in a root value, its failures coded. */
function coded(value: unknown): unknown {
  if (typeof value === 'function') return async (...args: unknown[]) => { try { return coded(await (value as (...a: unknown[]) => unknown)(...args)); } catch (e) { throw codedError(e); } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, coded(v)]));
}

/**
 * THE PAGE COMPOSITION'S DATASET SIDE (Hasura PR 6): the hasura-api links of one page for one caller, loaded once
 * per request. Their roots mount flat in the page schema; reads run through the read compiler under the role's
 * select rules, writes through the one mutation path under its insert/update/delete rules, both with the page as
 * `X-Hasura-Page-Id`. A pinned link is read-only (no mutation roots).
 */

export async function loadPageDatasets(actor: AccessActor, links: readonly HtmlDatasetLink[], scope: PageScope & { idempotencyKey?: string; commitGuard?: PageCommitGuard }, signal: AbortSignal): Promise<PageDatasets> {
  // Only a page request that checks its read fences (a query) is fenced; its schema GET and mutations are not.
  const loaded = await loadLinked(actor, links, { ...scope, fenced: !!scope.retainReadFence }, signal);
  const sources = loaded.map((l): PageDatasetSource => {
    const link = l.link!;
    const models = l.tables.map((t) => t.model);
    const roots: Record<string, { table: string; field: string }> = {};
    for (const m of models) if (m.select !== false) {
      roots[m.root] = { table: m.root, field: 'select' };
      roots[`${m.root}_by_pk`] = { table: m.root, field: 'select_by_pk' };
      roots[`${m.root}_can`] = { table: m.root, field: 'select_can' };
    }
    for (const [field, { model, kind }] of mutationRoots(models)) roots[field] = { table: model.root, field: kind };
    return { name: link.name, fileId: link.datasetId, version: link.mode === 'pinned' ? link.revision : 'live', typeDefs: hasuraSdl(models), roots };
  });
  let root: Record<string, unknown> | undefined;
  return {
    sources,
    queryRoots() {
      if (!root) {
        const budget = { statements: 0 }, all: Record<string, unknown> = {};
        for (const l of loaded) rootValue(actor, l, signal, budget, all);
        root = coded(all) as Record<string, unknown>;
      }
      return root;
    },
    async mutate(request) {
      const parsed = parsedOperation(request);
      if ('errors' in parsed) return parsed;
      if (parsed.operation.operation !== 'mutation') return { errors: [error('not a mutation', 'validation_failed')] };
      return linkedMutation(actor, loaded, parsed.document, { ...request, ...(scope.idempotencyKey ? { idempotencyKey: scope.idempotencyKey } : {}) }, scope.pageId, scope.commitGuard);
    },
    sql: (call) => runPageSql(loaded.map((l) => ({ link: l.link!.name, snapshot: l.snapshot, tables: l.tables.map((t) => ({ tableId: t.tableId, selectable: t.model.select !== false })) })), call, signal),
  };
}

const reply = (result: ExecutionResult): DatasetGraphqlReply => {
  const errors = result.errors?.map(classify);
  return { ...(result.data !== undefined ? { data: result.data as Record<string, unknown> | null } : {}), ...(errors?.length ? { errors } : {}) };
};

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
/** Today's receipt key shape (lib/artifacts `durableMutation`): a client key is held to it too. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

interface Call { key: string; field: string; kind: HasuraMutationKind; table: LoadedTable; statement: DatasetStatement | null }

/** A receipt's outcome identity (./write-reply WrittenOutcome[]) and its authority marker; never part of a reply. */
const OUTCOME = '__afOutcome';
const READ_SHAPE = '__afReadShape';

/** The written rows of one statement as `authority` shows them, as GraphQL objects. */
function returned(authority: ReadAuthority | null, table: LoadedTable, kind: HasuraMutationKind, step: MutationStep | undefined): Array<Record<string, unknown>> {
  if (!step?.written.length || table.model.select === false) return [];
  // A deleted row as it was; an inserted or updated one as it is after its presets.
  const all = kind === 'delete' || kind === 'delete_by_pk' ? step.before : step.after;
  const visible = authority?.tables.find((t) => tableIdentity(t) === table.tableId);
  return shownRows(authority, table.declared, all, step.written).map((row) => graphqlRow(table, row, visible ? { columns: visible.columns } : null));
}

/** One stored-shape row as its GraphQL object: a column the authority hides is null, `_can` as the role's rules say. */
function graphqlRow(table: LoadedTable, row: Record<string, unknown>, visible: { columns: readonly { name: string }[] } | DatasetSnapshot | null): Record<string, unknown> {
  const columns = visible && 'catalog' in visible ? visible.catalog.tables.find((t) => tableIdentity(t) === table.tableId)?.columns ?? [] : visible?.columns ?? [];
  const shown = new Set(columns.map((c) => c.name));
  return Object.fromEntries([['_id', row[ID_COLUMN]], ...table.model.columns.map((c) => [c.field, shown.has(c.source) ? row[c.source] ?? null : null]), [CAN_FIELD, rowCan(table.model, row, filterAdmits)]]);
}

/**
 * A mutation operation: record its root fields, compile them, write once (durably, under the idempotency key),
 * and answer the selection from the committed steps.
 */
async function executeMutation(actor: AccessActor, datasets: readonly Loaded[], schema: GraphQLSchema, document: DocumentNode, request: DatasetGraphqlRequest, pageId?: string, commitGuard?: PageCommitGuard): Promise<DatasetGraphqlReply> {
  const roots = mutationRoots(datasets.flatMap((l) => l.tables.map((t) => t.model)));
  const options = { schema, document, variableValues: request.variables ?? {}, ...(request.operationName ? { operationName: request.operationName } : {}) };
  // Pass 1: each root field's coerced arguments, by response key; nothing is written.
  const recorded: Array<{ key: string; field: string; args: Record<string, unknown> }> = [];
  const recording = Object.fromEntries([...roots.keys()].map((field) => [field, (args: Record<string, unknown>, _: unknown, info: GraphQLResolveInfo) => { recorded.push({ key: String(info.path.key), field, args }); return null; }]));
  const first = await execute({ ...options, rootValue: recording });
  if (first.errors?.length) return reply({ errors: first.errors });
  if (!recorded.length) return reply(first);

  // The written dataset: every field one dataset's (one atomic version step).
  const owners = new Set(recorded.map((r) => datasets.find((l) => l.tables.some((t) => t.model === roots.get(r.field)!.model))!));
  if (owners.size > 1) return { errors: [error('one mutation writes one dataset; send one mutation per linked dataset', 'one_dataset_per_mutation')] };
  const [loaded] = [...owners] as [Loaded], datasetId = loaded.datasetId;
  const key = request.idempotencyKey ?? randomUUID();
  if (!IDEMPOTENCY_KEY.test(key)) return { errors: [error('the Idempotency-Key must be 16 to 128 letters, digits, - or _', 'validation_failed')] };
  // Directly and through each page the key names its own receipt.
  const seed = digest(pageId ? ['dataset-graphql', datasetId, key, pageId] : ['dataset-graphql', datasetId, key]);
  let calls: Call[];
  try {
    calls = recorded.map((r, i) => {
      const { model, kind } = roots.get(r.field)!;
      const table = loaded.tables.find((t) => t.model === model)!;
      return { key: r.key, field: r.field, kind, table, statement: compileMutation(model, kind, r.args, (j) => `r_${digest([seed, i, j])}`) };
    });
  } catch (e) {
    if (e instanceof HasuraWriteError) return { errors: [error(e.message, e.code)] };
    throw e;
  }
  const table = calls[0]!.table;
  if (calls.some((c) => c.table !== table)) return { errors: [error('one mutation writes one table of a dataset', 'validation_failed')] };

  // Pass 2: the request's own selection (aliases, fragments, every field) over each field's result, by response key.
  const select = async (result: (call: Call, index: number) => unknown): Promise<DatasetGraphqlReply> => {
    const results = new Map(calls.map((call, i) => [call.key, result(call, i)]));
    const resolve = (_: unknown, __: unknown, info: GraphQLResolveInfo) => results.get(String(info.path.key));
    return reply(await execute({ ...options, rootValue: Object.fromEntries([...roots.keys()].map((field) => [field, resolve])) }));
  };
  const multi = (kind: HasuraMutationKind) => kind === 'insert' || kind === 'update' || kind === 'delete';
  const fieldResult = (call: Call, affected: number, rows: Array<Record<string, unknown>>) => (multi(call.kind) ? { affected_rows: affected, returning: rows } : rows[0] ?? null);
  /** Each field's outcome identity from the committed steps: what the receipt keeps instead of rows. */
  const outcomes = (steps: readonly MutationStep[]): WrittenOutcome[] => {
    let s = 0;
    return calls.map((call) => { const step = call.statement ? steps[s++] : undefined; return { key: call.key, kind: call.kind, affected: step?.affected ?? 0, ids: (step?.written ?? []).map(String) }; });
  };
  const statements = calls.flatMap((c) => (c.statement ? [c.statement] : []));
  if (!statements.length) return select((call) => fieldResult(call, 0, []));

  let fresh: DatasetGraphqlReply | null = null;
  const payload = { datasetId, ...(pageId ? { pageId } : {}), query: request.query, variables: request.variables ?? null, operationName: request.operationName ?? null };
  const outcome = await durableMutation(actor, 'https://dataset.invalid', seed, payload, async (receipt) => {
    const head = await getArtifactById(datasetId);
    if (!head || head.format !== 'dataset') return { status: 200, body: { errors: [error('the dataset no longer exists', 'dataset_not_found')] } };
    const [firstStatement] = statements;
    const result = await mutateDataset(head, actor, firstStatement!.sql, firstStatement!.params, {
      target: { schema: table.model.table.schema, table: table.model.table.name },
      statements,
      ...(pageId ? { pagePolicy: pageId } : { directPolicy: true }),
      casRetries: DATASET_GRAPHQL_WRITE_LIMITS.casRetries,
      maxAffected: DATASET_GRAPHQL_WRITE_LIMITS.rows,
      trace: true,
      ...(commitGuard ? { commitCheck: async (tx: Queryable) => { await commitGuard(tx); return true; } } : {}),
      rowIdentity: {
        column: ID_COLUMN,
        tableId: table.tableId,
        ids: (current: ArtifactRow, objectKey: string, count: number) => rowIdsForObject(current.id, table.tableId, objectKey, count, (current.meta as { graphqlRowIds?: Record<string, unknown> }).graphqlRowIds?.[table.tableId]),
      },
      // Inside the commit: the reply's rows are shown under the read access that holds now, decided on `tx`; the
      // receipt keeps only the outcome identity, never rows.
      commitEffect: async (tx, applied) => {
        const steps = applied.steps ?? [], authority = await readAuthorityIn(tx, actor, datasetId, pageId);
        let s = 0;
        fresh = await select((call) => { const step = call.statement ? steps[s++] : undefined; return fieldResult(call, step?.affected ?? 0, returned(authority, call.table, call.kind, step)); });
        await completeMutationReceipt(tx, receipt, { status: 200, body: { [OUTCOME]: outcomes(steps), [READ_SHAPE]: authorityShape(authority) } });
      },
    });
    // A refused write (an exhausted conflict retry included) has no reply rows, whatever an aborted attempt built.
    if (isMutationRefused(result)) { fresh = null; return { status: 200, body: { data: null, errors: [refusal(result)] } }; }
    return { status: 200, body: { [OUTCOME]: outcomes(result.steps ?? []) } };
  });
  if (outcome.status === 200 && fresh) return fresh;
  if (outcome.status === 200) {
    const body = outcome.body as DatasetGraphqlReply & { [OUTCOME]?: WrittenOutcome[]; [READ_SHAPE]?: string };
    const recorded = body[OUTCOME];
    // A refusal's receipt holds no rows: replayed as it was.
    if (!recorded && !body.data) return body;
    const byKey = new Map((recorded ?? []).map((o) => [o.key, o]));
    // A replay is never executed again: its written rows are read now, under the reader's current role view.
    const signal = new AbortController().signal;
    const now = new Map<string, Array<Record<string, unknown>>>();
    for (const call of calls) {
      const o = byKey.get(call.key);
      const deleted = call.kind === 'delete' || call.kind === 'delete_by_pk';
      const rows = o && !deleted && call.table.model.select !== false ? await rowsNow(actor, loaded, call.table.tableId, o.ids, signal) : [];
      now.set(call.key, rows.map((row) => graphqlRow(call.table, row, loaded.snapshot)));
    }
    // The original counts only under the authority they were decided under. After an access change (or from a receipt
    // that records none, an older format: its rows are never shown) a replay reports only what the reader sees now:
    // each count is the recorded `_id`s currently visible, with no sign that anything was left out.
    const same = body[READ_SHAPE] !== undefined && body[READ_SHAPE] === authorityShape(loaded.snapshot ? { role: loaded.snapshot.role ?? null, view: loaded.snapshot.view ?? null } : null);
    const legacy = !recorded || body[READ_SHAPE] === undefined;
    return select((call) => fieldResult(call, same ? byKey.get(call.key)?.affected ?? 0 : (now.get(call.key) ?? []).length, legacy ? [] : now.get(call.key) ?? []));
  }
  const why = (outcome.body as { error?: string }).error;
  if (why === 'idempotency_mismatch') return { errors: [error('this Idempotency-Key was already used for a different request', 'validation_failed')] };
  if (why === 'operation_pending') return { errors: [error('a write with this Idempotency-Key is still running; retry the same request for its reply', 'outcome_unknown')] };
  return { errors: [error('this write has no confirmed reply; read the dataset before writing it again, and keep its Idempotency-Key', 'outcome_unknown')] };
}

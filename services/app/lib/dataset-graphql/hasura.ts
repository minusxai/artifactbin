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
  type DatasetBoolExp,
  type DatasetColumn,
  type DatasetGraphqlError,
  type DatasetGraphqlErrorCode,
  type DatasetGraphqlReply,
  type DatasetGraphqlRequest,
  type DatasetGraphqlSchemaReply,
  type HtmlDatasetLink,
} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { liveAccessFacts, memoAccessFacts, type AccessFacts } from '@/lib/artifact-access';
import { completeMutationReceipt, durableMutation, getArtifactById, getArtifactHeaderById, type ArtifactRow } from '@/lib/artifacts';
import { datasetWriteAccess, filterAdmits, tableMutationPolicy } from '@/lib/dataset-permissions';
import { isMutationRefused, mutateDataset, type MutationStep } from '@/lib/document-data';
import type { DatasetTable } from '@/lib/datasets';
import { ID_COLUMN, rowIdsForObject, tableIdentity } from './model';
import { retainedDatasetGraphqlPort } from './retained';
import { CAN_FIELD, hasuraSdl, type HasuraCan, type HasuraColumn, type HasuraRowCan, type HasuraScalar, type HasuraTableModel, type HasuraWriteModel } from './hasura-schema';
import { askedCan, rowCan, tableCan, withCan } from './can';
import { hasuraGeneratedNames, hasuraNames, storedConfiguration, type HasuraTableNames } from './hasura-names';
import { datasetBindingCatalog, DatasetBindingUnsupportedError, resolveDatasetBinding } from './authority';
import { compileRows, HasuraReadError, type HasuraReadArgs } from './hasura-read';
import { runPageSql, type PageSqlAnswer, type PageSqlCall } from './page-sql';
import { compileMutation, HasuraWriteError, mutationRoots, type HasuraMutationKind } from './hasura-write';
import type { DatasetSnapshot, DatasetStatement } from './types';
import { collaborativeColumns } from './cells';

/** Is this id a dataset (the route's branch)? Existence only: every answer below decides access itself. */
export async function isDatasetGraphqlTarget(id: string): Promise<boolean> {
  return (await getArtifactHeaderById(id))?.format === 'dataset';
}

const scalarOf = (type: DatasetColumn['type']): HasuraScalar => (type === 'number' ? 'Float' : type === 'boolean' ? 'Boolean' : 'String');

const notFound = () => new Error('dataset_not_found');

interface LoadedTable { model: HasuraTableModel; tableId: string; declared: DatasetTable }
interface Loaded {
  datasetId: string;
  /** Through a page: the link it was loaded for (its page name). */
  link?: HtmlDatasetLink;
  /** The caller's read snapshot, or null when the role selects nothing (it may still write). */
  snapshot: DatasetSnapshot | null;
  tables: LoadedTable[];
  port: ReturnType<typeof retainedDatasetGraphqlPort>;
  fences: Array<() => Promise<void>>;
}
type WriteDecision = Awaited<ReturnType<typeof datasetWriteAccess>>;

const NOTHING: HasuraCan = { insert: false, update: false, delete: false };

/**
 * The role's write rules for one table, as the columns each lets it name (presets excluded), and what they let it
 * change (`can`): an insert root it has, an update root or delete rule it has with that rule's filter (true for every
 * row when the filter is empty, the owner's and editors'). A rule the role may not use here (`backend_only`) is absent.
 */
function writeRules(decision: WriteDecision, table: DatasetTable, names: HasuraTableNames): { write?: HasuraWriteModel; can: HasuraCan } {
  if (!decision.allowed) return { can: NOTHING };
  const column = (c: DatasetColumn): HasuraColumn => ({ field: names.columns[c.name] ?? (() => { throw notFound(); })(), source: c.name, type: scalarOf(c.type) });
  if (decision.admin) {
    const all = table.columns.map(column);
    return { write: { insert: all, update: all, delete: true }, can: { insert: all.length > 0, update: all.length > 0, delete: true } };
  }
  let policy: ReturnType<typeof tableMutationPolicy>;
  try { policy = tableMutationPolicy(decision, table); } catch { return { can: NOTHING }; }
  if (!policy) return { can: NOTHING };
  const { table: rules, role, operations } = policy;
  const rule = <P>(op: 'insert' | 'update' | 'delete', entries: Array<{ role: string; permission: P }> | undefined) => (operations.includes(op) ? entries?.find((e) => e.role === role)?.permission : undefined);
  const named = (p: { columns?: '*' | string[]; set?: Record<string, unknown> }) =>
    table.columns.filter((c) => (p.columns === undefined || p.columns === '*' || p.columns.includes(c.name)) && !Object.hasOwn(p.set ?? {}, c.name)).map(column);
  const insert = rule('insert', rules.insert_permissions), update = rule('update', rules.update_permissions), del = rule('delete', rules.delete_permissions);
  const write: HasuraWriteModel = { ...(insert ? { insert: named(insert) } : {}), ...(update ? { update: named(update) } : {}), ...(del ? { delete: true } : {}) };
  const rows = (filter: DatasetBoolExp | undefined): HasuraRowCan => (!filter || !Object.keys(filter).length ? true : { filter, session: decision.session });
  return {
    write,
    can: {
      insert: !!write.insert?.length,
      update: update && write.update?.length ? rows(update.filter as DatasetBoolExp | undefined) : false,
      delete: del ? rows(del.filter as DatasetBoolExp | undefined) : false,
    },
  };
}

const columnsOf = (table: DatasetTable, names: HasuraTableNames, collaborative: readonly string[] = []): HasuraColumn[] =>
  table.columns.map((c) => ({ field: names.columns[c.name] ?? (() => { throw notFound(); })(), source: c.name, type: scalarOf(c.type), ...(c.type === 'string' && collaborative.includes(c.name) ? { collaborative: true } : {}) }));

/** How a load reaches the dataset: directly (its own sharing decides), or through a page (the page audience rule). */
interface LoadMode {
  direct: boolean;
  /** The caller checks the load's fences before anything read leaves: the load's one authorization holds until then. */
  fenced: boolean;
  /** The request's memo of the caller's access facts, shared by every dataset it loads; fences never read it. */
  facts?: AccessFacts;
  /** Through a page: the page the session names (`X-Hasura-Page-Id`). */
  pageId?: string;
  /** Through a page: each read fence is also handed to the page request's own final check. */
  retainReadFence?: (verify: () => Promise<void>) => void;
}

/**
 * The caller's read snapshot and write decision, and the table models they give. Directly the dataset's own
 * sharing decides the role; through a page (page GraphQL, a resolver's caps.query) the page audience rule applies
 * (a reader with no sharing of their own is signed_in or anonymous) and the session names the page. A pinned link
 * reads its recorded revision and never writes. Throws `dataset_not_found` when the role may neither read nor
 * write (the uniform 404). One authorization: the read and write decisions share the head and the request's facts.
 */
async function load(actor: AccessActor, binding: HtmlDatasetLink, signal: AbortSignal, mode: LoadMode): Promise<Loaded> {
  const fences: Array<() => Promise<void>> = [];
  const facts = mode.facts ?? memoAccessFacts(liveAccessFacts(actor));
  const port = retainedDatasetGraphqlPort({ direct: mode.direct, fenced: mode.fenced, facts, ...(mode.pageId ? { pageId: mode.pageId } : {}), retainReadFence: (verify) => { fences.push(verify); mode.retainReadFence?.(verify); } });
  if (binding.mode === 'pinned') {
    // A pinned link: reads only, exactly the tables of the snapshot its recorded revision resolves.
    const read = await port.snapshot(actor, binding, signal);
    const tables = read.catalog.tables.map((table): LoadedTable => {
      const tableId = tableIdentity(table), names = read.names?.[tableId] ?? (() => { throw notFound(); })();
      return { model: { root: names.root, table: { schema: table.schema, name: table.name }, columns: columnsOf(table, names) }, tableId, declared: table };
    });
    if (!tables.length) throw notFound();
    return { datasetId: binding.datasetId, snapshot: read, tables, port, fences };
  }
  let snapshot: DatasetSnapshot | null = null;
  try { snapshot = await port.snapshot(actor, binding, signal); } catch (e) { if (!(e instanceof Error) || e.message !== 'dataset_not_found') throw e; }
  const row = snapshot?.head ?? await getArtifactById(binding.datasetId);
  if (!row || row.format !== 'dataset') throw notFound();
  const decision = await datasetWriteAccess(row, actor, { ...writeOptions(mode), facts });
  // Nothing is said about a dataset the role can neither read nor write, not even that it is unsupported.
  if (!snapshot && !decision.allowed) throw notFound();
  const declared = datasetBindingCatalog(row);
  const derived = hasuraNames(declared.tables, { title: row.title, configuration: storedConfiguration(row.dataset_policy) });
  const tables = declared.tables.flatMap((table, i): LoadedTable[] => {
    const tableId = tableIdentity(table), names = snapshot?.names?.[tableId] ?? derived[i]!;
    const visible = snapshot?.catalog.tables.find((t) => tableIdentity(t) === tableId);
    const { write, can } = writeRules(decision, table, names);
    if (!visible && !write) return [];
    const model: HasuraTableModel = {
      root: names.root,
      table: { schema: table.schema, name: table.name },
      // A live link's text columns the owner made collaborative say so (a pinned link never opens one).
      columns: visible ? columnsOf(visible, names, collaborativeColumns(row, table)) : [],
      ...(visible ? {} : { select: false }),
      ...(write ? { write } : {}),
      can,
    };
    return [{ model, tableId, declared: table }];
  });
  if (!tables.length) throw notFound();
  return { datasetId: binding.datasetId, snapshot, tables, port, fences };
}

const writeOptions = (mode: LoadMode) => (mode.direct ? { throughPage: false } : { throughPage: true, ...(mode.pageId ? { pageId: mode.pageId } : {}) });

async function fenced(loaded: Loaded): Promise<void> {
  for (const verify of loaded.fences) await verify();
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

/** Where a page's datasets are read from: the page (its audience rule and `X-Hasura-Page-Id`) and its request's fences. */
interface PageScope {
  pageId?: string;
  retainReadFence?: (verify: () => Promise<void>) => void;
}

/**
 * THE PAGE'S DATASETS AS ONE GENERATED API: every given link under its page name (a single-table dataset's root
 * is the link name; a multi-table dataset's are `<name>_<table root>`), for the caller's role through the page. A
 * dataset the role can neither read nor write is absent, as if unlinked. Two links generating one name refuse the
 * page (`graphql_root_collision`; publishing refuses it first).
 */
export async function loadLinked(actor: AccessActor, links: readonly HtmlDatasetLink[], scope: PageScope & { fenced: boolean }, signal: AbortSignal): Promise<Loaded[]> {
  const loaded: Loaded[] = [];
  // One authorization per request: every link's decisions read the caller's facts once.
  const facts = memoAccessFacts(liveAccessFacts(actor));
  for (const link of links) {
    let one: Loaded;
    try { one = await load(actor, link, signal, { direct: false, ...scope, facts }); } catch (e) {
      if (e instanceof Error && (e.message === 'dataset_not_found' || e instanceof DatasetBindingUnsupportedError)) continue;
      throw e;
    }
    loaded.push({ ...one, link, tables: one.tables.map((t) => ({ ...t, model: { ...t.model, root: linkedRoot(link.name, one.tables.length, t.model.root) } })) });
  }
  const names = new Map<string, string>();
  for (const l of loaded) for (const { model } of l.tables) for (const name of hasuraGeneratedNames(model.root)) {
    const other = names.get(name);
    if (other !== undefined) throw new GraphQLError(`graphql_root_collision: links ${other} and ${l.link!.name} both generate ${name}; rename a link`);
    names.set(name, l.link!.name);
  }
  return loaded;
}

/** A linked table's root in the page: the link name for a single-table dataset, `<name>_<table root>` otherwise. */
const linkedRoot = (name: string, tables: number, root: string) => (tables === 1 ? name : `${name}_${root}`);

interface LinkedDatasetGraphqlOptions {
  /** The resolver operation the call runs inside: mutations only inside a mutation resolver. */
  operation: 'query' | 'mutation' | undefined;
  /** Serialized `data` bytes the answer may carry. */
  resultBytes: number;
  /** The page whose resolver calls (`X-Hasura-Page-Id`). */
  pageId?: string;
}

/**
 * THE PAGE'S DATASETS FOR A RESOLVER'S `caps.query`, run as the caller (never owner rights): reads always; writes
 * only inside a mutation resolver, through the one generated mutation path under each dataset's rules for the
 * caller's role through the page.
 */
export async function executeLinkedDatasetGraphql(actor: AccessActor, links: readonly HtmlDatasetLink[], request: DatasetGraphqlRequest, options: LinkedDatasetGraphqlOptions, signal: AbortSignal): Promise<DatasetGraphqlReply> {
  const parsed = parsedOperation(request);
  if ('errors' in parsed) return parsed;
  const kind = parsed.operation.operation;
  if (kind === 'subscription') return { errors: [error('caps.query has no subscription root', 'validation_failed')] };
  if (kind === 'mutation' && options.operation !== 'mutation') return { errors: [error('a dataset mutation runs only inside a mutation resolver', 'permission_denied')] };
  let loaded: Loaded[];
  try { loaded = await loadLinked(actor, links, { ...(options.pageId ? { pageId: options.pageId } : {}), fenced: kind === 'query' }, signal); } catch (e) {
    if (e instanceof GraphQLError) return { errors: [error(e.message, 'validation_failed')] };
    throw e;
  }
  if (!loaded.length) return { errors: [error('no linked dataset is readable', 'dataset_not_found')] };
  if (kind === 'mutation') return linkedMutation(actor, loaded, parsed.document, request, options.pageId);
  return run(actor, loaded, parsed.document, request, signal, options.resultBytes);
}

/** A mutation over linked datasets: validated against their joint schema, written as one dataset's step. */
async function linkedMutation(actor: AccessActor, loaded: readonly Loaded[], document: DocumentNode, request: DatasetGraphqlRequest, pageId: string | undefined): Promise<DatasetGraphqlReply> {
  const schema = schemaFor(hasuraSdl(loaded.flatMap((l) => l.tables.map((t) => t.model))));
  const invalid = validate(schema, document);
  if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
  return executeMutation(actor, loaded, schema, document, request, pageId);
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
  /** The dataset's own API names (its direct GraphQL, `graphql.mjs schema DATASET_ID`) → this link's page names. */
  renames: Record<string, string>;
}

/**
 * THE PAGE'S DATASETS AS PUBLISH CHECKS SEE THEM: every link under its page name with every root, column and write
 * a role could be given (role-independent, from the declared tables, as `pageDatasetRoots`), so a document
 * valid for any reader is never refused; `sdl` is all of them as one API, what a resolver's caps.query validates
 * against. Null when no dataset is linked.
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
export async function loadPageDatasets(actor: AccessActor, links: readonly HtmlDatasetLink[], scope: PageScope & { idempotencyKey?: string }, signal: AbortSignal): Promise<PageDatasets> {
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
      return linkedMutation(actor, loaded, parsed.document, { ...request, ...(scope.idempotencyKey ? { idempotencyKey: scope.idempotencyKey } : {}) }, scope.pageId);
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

/** One refused write as a GraphQL error: the code says what happened, the message never carries row data. */
function refusal(result: { reason: string; detail: string }): DatasetGraphqlError {
  switch (result.reason) {
    case 'too_many_rows': return error(`a mutation changes at most ${DATASET_GRAPHQL_WRITE_LIMITS.rows} rows; nothing was written`, 'too_many_rows');
    case 'policy_denied': return /failed its check/.test(result.detail) ? error('check constraint of an insert/update permission has failed; nothing was written', 'check_violation') : error(result.detail, 'permission_denied');
    case 'dataset_read_only': return error(result.detail, 'permission_denied');
    case 'contended': return error('the dataset is being written too quickly to apply this change; retry', 'dataset_changed');
    // A rule naming a session variable this caller lacks (X-Hasura-User-Id for anonymous) denies them.
    default: return /session variable is unavailable/.test(result.detail) ? error('this rule needs a signed-in session', 'permission_denied') : error(result.detail, 'validation_failed');
  }
}

/** The written rows of one statement as the role's select rule shows them, as GraphQL objects. */
function returned(loaded: Loaded, table: LoadedTable, kind: HasuraMutationKind, step: MutationStep | undefined): Array<Record<string, unknown>> {
  if (!step?.written.length || table.model.select === false) return [];
  // A deleted row as it was; an inserted or updated one as it is after its presets.
  const all = kind === 'delete' || kind === 'delete_by_pk' ? step.before : step.after;
  const view = loaded.snapshot?.view;
  // The role view over the whole table (its limit is a prefix of it), never cached: these rows have no stored object.
  const { objectKey: _stored, ...shape } = table.declared;
  const visible = view ? view.rows(shape, all) : all;
  const byId = new Map(visible.map((r) => [r[ID_COLUMN], r]));
  return step.written.flatMap((id) => {
    const row = byId.get(id);
    return row ? [Object.fromEntries([['_id', id], ...table.model.columns.map((c) => [c.field, row[c.source] ?? null]), [CAN_FIELD, rowCan(table.model, row, filterAdmits)]])] : [];
  });
}

/**
 * A mutation operation: record its root fields, compile them, write once (durably, under the idempotency key),
 * and answer the selection from the committed steps.
 */
async function executeMutation(actor: AccessActor, datasets: readonly Loaded[], schema: GraphQLSchema, document: DocumentNode, request: DatasetGraphqlRequest, pageId?: string): Promise<DatasetGraphqlReply> {
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

  // Pass 2: the selection over each field's committed step, by response key.
  const answer = async (steps: readonly MutationStep[]): Promise<DatasetGraphqlReply> => {
    const results = new Map<string, unknown>();
    let s = 0;
    for (const call of calls) {
      const step = call.statement ? steps[s++] : undefined;
      const rows = returned(loaded, call.table, call.kind, step);
      results.set(call.key, call.kind === 'insert' || call.kind === 'update' || call.kind === 'delete' ? { affected_rows: step?.affected ?? 0, returning: rows } : rows[0] ?? null);
    }
    const resolve = (_: unknown, __: unknown, info: GraphQLResolveInfo) => results.get(String(info.path.key));
    return reply(await execute({ ...options, rootValue: Object.fromEntries([...roots.keys()].map((field) => [field, resolve])) }));
  };
  const statements = calls.flatMap((c) => (c.statement ? [c.statement] : []));
  if (!statements.length) return answer([]);

  let committed: DatasetGraphqlReply | null = null;
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
      rowIdentity: {
        column: ID_COLUMN,
        tableId: table.tableId,
        ids: (current: ArtifactRow, objectKey: string, count: number) => rowIdsForObject(current.id, table.tableId, objectKey, count, (current.meta as { graphqlRowIds?: Record<string, unknown> }).graphqlRowIds?.[table.tableId]),
      },
      // The reply is part of the commit: a replay answers exactly it.
      commitEffect: async (tx, applied) => {
        committed = await answer(applied.steps ?? []);
        await completeMutationReceipt(tx, receipt, { status: 200, body: committed as Record<string, unknown> });
      },
    });
    if (isMutationRefused(result)) return { status: 200, body: { data: null, errors: [refusal(result)] } };
    return { status: 200, body: (committed ?? await answer(result.steps ?? [])) as Record<string, unknown> };
  });
  if (outcome.status === 200) return outcome.body as DatasetGraphqlReply;
  const why = (outcome.body as { error?: string }).error;
  if (why === 'idempotency_mismatch') return { errors: [error('this Idempotency-Key was already used for a different request', 'validation_failed')] };
  if (why === 'operation_pending') return { errors: [error('a write with this Idempotency-Key is still running; retry the same request for its reply', 'outcome_unknown')] };
  return { errors: [error('this write has no confirmed reply; read the dataset before writing it again, and keep its Idempotency-Key', 'outcome_unknown')] };
}

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
 * Errors carry `extensions.code` and never row data.
 */
import { createHash, randomUUID } from 'node:crypto';
import { buildSchema, getOperationAST, GraphQLError, parse, validate, execute, type DocumentNode, type ExecutionResult, type GraphQLResolveInfo, type GraphQLSchema, type OperationDefinitionNode } from 'graphql';
import {
  DATASET_GRAPHQL_READ_LIMITS,
  DATASET_GRAPHQL_WRITE_LIMITS,
  type DatasetColumn,
  type DatasetGraphqlError,
  type DatasetGraphqlErrorCode,
  type DatasetGraphqlReply,
  type DatasetGraphqlRequest,
  type DatasetGraphqlSchemaReply,
  type HtmlDatasetLink,
} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { completeMutationReceipt, durableMutation, getArtifactById, getArtifactHeaderById, type ArtifactRow } from '@/lib/artifacts';
import { datasetWriteAccess, tableMutationPolicy } from '@/lib/dataset-permissions';
import { isMutationRefused, mutateDataset, type MutationStep } from '@/lib/document-data';
import type { DatasetTable } from '@/lib/datasets';
import { ID_COLUMN, rowIdsForObject, tableIdentity } from './model';
import { retainedDatasetGraphqlPort } from './retained';
import { hasuraSdl, type HasuraColumn, type HasuraScalar, type HasuraTableModel, type HasuraWriteModel } from './hasura-schema';
import { hasuraGeneratedNames, hasuraNames, storedConfiguration, type HasuraTableNames } from './hasura-names';
import { datasetBindingCatalog, DatasetBindingUnsupportedError } from './authority';
import { compileAggregate, compileRows, HasuraReadError, type HasuraAggregate, type HasuraReadArgs } from './hasura-read';
import { compileMutation, HasuraWriteError, mutationRoots, type HasuraMutationKind } from './hasura-write';
import type { DatasetSnapshot, DatasetStatement } from './types';

/** Is this id a dataset (the route's branch)? Existence only: every answer below decides access itself. */
export async function isDatasetGraphqlTarget(id: string): Promise<boolean> {
  return (await getArtifactHeaderById(id))?.format === 'dataset';
}

const scalarOf = (type: DatasetColumn['type']): HasuraScalar => (type === 'number' ? 'Float' : type === 'boolean' ? 'Boolean' : 'String');

const notFound = () => new Error('dataset_not_found');

interface LoadedTable { model: HasuraTableModel; tableId: string; declared: DatasetTable }
interface Loaded {
  /** The caller's read snapshot, or null when the role selects nothing (it may still write). */
  snapshot: DatasetSnapshot | null;
  tables: LoadedTable[];
  port: ReturnType<typeof retainedDatasetGraphqlPort>;
  fences: Array<() => Promise<void>>;
}
type WriteDecision = Awaited<ReturnType<typeof datasetWriteAccess>>;

/** The role's write rules for one table, as the columns each lets it name (presets excluded). */
function writeModel(decision: WriteDecision, table: DatasetTable, names: HasuraTableNames): HasuraWriteModel | undefined {
  if (!decision.allowed) return undefined;
  const column = (c: DatasetColumn): HasuraColumn => ({ field: names.columns[c.name] ?? (() => { throw notFound(); })(), source: c.name, type: scalarOf(c.type) });
  if (decision.admin) { const all = table.columns.map(column); return { insert: all, update: all, delete: true }; }
  let policy: ReturnType<typeof tableMutationPolicy>;
  try { policy = tableMutationPolicy(decision, table); } catch { return undefined; }
  if (!policy) return undefined;
  const { table: rules, role, operations } = policy;
  const rule = <P>(op: 'insert' | 'update' | 'delete', entries: Array<{ role: string; permission: P }> | undefined) => (operations.includes(op) ? entries?.find((e) => e.role === role)?.permission : undefined);
  const named = (p: { columns?: '*' | string[]; set?: Record<string, unknown> }) =>
    table.columns.filter((c) => (p.columns === undefined || p.columns === '*' || p.columns.includes(c.name)) && !Object.hasOwn(p.set ?? {}, c.name)).map(column);
  const insert = rule('insert', rules.insert_permissions), update = rule('update', rules.update_permissions), del = rule('delete', rules.delete_permissions);
  return { ...(insert ? { insert: named(insert) } : {}), ...(update ? { update: named(update) } : {}), ...(del ? { delete: true } : {}) };
}

/**
 * The caller's read snapshot and, directly (`direct`: the dataset's own sharing decides the role), its write
 * decision, and the table models they give. Through a page (a resolver's caps.query) the page audience rule
 * applies (a reader with no sharing of their own is signed_in or anonymous) and only reads are generated (page
 * mutations arrive with the page composition). Throws `dataset_not_found` when the role may neither read nor
 * write (the uniform 404).
 */
const columnsOf = (table: DatasetTable, names: HasuraTableNames): HasuraColumn[] =>
  table.columns.map((c) => ({ field: names.columns[c.name] ?? (() => { throw notFound(); })(), source: c.name, type: scalarOf(c.type) }));

async function load(actor: AccessActor, binding: HtmlDatasetLink, signal: AbortSignal, direct: boolean): Promise<Loaded> {
  const fences: Array<() => Promise<void>> = [];
  const port = retainedDatasetGraphqlPort({ direct, retainReadFence: (verify) => { fences.push(verify); } });
  if (!direct) {
    // Through a page: reads only, exactly the tables of the snapshot the binding resolves (a pinned link's revision).
    const read = await port.snapshot(actor, binding, signal);
    const tables = read.catalog.tables.map((table): LoadedTable => {
      const tableId = tableIdentity(table), names = read.names?.[tableId] ?? (() => { throw notFound(); })();
      return { model: { root: names.root, table: { schema: table.schema, name: table.name }, columns: columnsOf(table, names), aggregations: read.aggregatable?.[tableId] ?? false }, tableId, declared: table };
    });
    if (!tables.length) throw notFound();
    return { snapshot: read, tables, port, fences };
  }
  let snapshot: DatasetSnapshot | null = null;
  try { snapshot = await port.snapshot(actor, binding, signal); } catch (e) { if (!(e instanceof Error) || e.message !== 'dataset_not_found') throw e; }
  const row = await getArtifactById(binding.datasetId);
  if (!row || row.format !== 'dataset') throw notFound();
  const decision = await datasetWriteAccess(row, actor, { throughPage: false });
  // Nothing is said about a dataset the role can neither read nor write, not even that it is unsupported.
  if (!snapshot && !decision.allowed) throw notFound();
  const declared = datasetBindingCatalog(row);
  const derived = hasuraNames(declared.tables, { title: row.title, configuration: storedConfiguration(row.dataset_policy) });
  const tables = declared.tables.flatMap((table, i): LoadedTable[] => {
    const tableId = tableIdentity(table), names = snapshot?.names?.[tableId] ?? derived[i]!;
    const visible = snapshot?.catalog.tables.find((t) => tableIdentity(t) === tableId);
    const write = writeModel(decision, table, names);
    if (!visible && !write) return [];
    const model: HasuraTableModel = {
      root: names.root,
      table: { schema: table.schema, name: table.name },
      columns: visible ? columnsOf(visible, names) : [],
      aggregations: !!visible && (snapshot?.aggregatable?.[tableId] ?? false),
      ...(visible ? {} : { select: false }),
      ...(write ? { write } : {}),
    };
    return [{ model, tableId, declared: table }];
  });
  if (!tables.length) throw notFound();
  return { snapshot, tables, port, fences };
}

async function fenced(loaded: Loaded): Promise<void> {
  for (const verify of loaded.fences) await verify();
}

/** GET: the caller's own SDL, the head revision and the role it was generated for. */
const directBinding = (datasetId: string): HtmlDatasetLink => ({ kind: 'dataset', name: 'data', datasetId, mode: 'live' });

export async function datasetGraphqlSchema(actor: AccessActor, datasetId: string, signal: AbortSignal): Promise<DatasetGraphqlSchemaReply> {
  const loaded = await load(actor, directBinding(datasetId), signal, true);
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

/** Root resolvers over the loaded tables: one engine statement per list, `_by_pk` and aggregate leaf; `budget` is shared by every dataset in one request. */
function rootValue(actor: AccessActor, loaded: Loaded, signal: AbortSignal, budget = { statements: 0 }, root: Record<string, unknown> = {}): Record<string, unknown> {
  const run = async (tableId: string, statement: DatasetStatement, window: { limit: number; offset: number }) => {
    if (++budget.statements > DATASET_GRAPHQL_READ_LIMITS.statements) throw new HasuraReadError(`a request runs at most ${DATASET_GRAPHQL_READ_LIMITS.statements} reads`);
    return loaded.port.execute(actor, loaded.snapshot!, tableId, statement, window, signal);
  };
  root.no_queries_available ??= () => 'There are no queries available to the current role.';
  for (const { model, tableId } of loaded.tables) {
    if (model.select === false) continue;
    const rows = async (args: HasuraReadArgs) => {
      const plan = compileRows(model, args);
      return plan.window.limit === 0 ? [] : run(tableId, plan.statement, plan.window);
    };
    root[model.root] = (args: HasuraReadArgs) => rows(args);
    root[`${model.root}_by_pk`] = async ({ _id }: { _id: string }) => (await rows({ where: { _id: { _eq: _id } }, limit: 1 }))[0] ?? null;
    if (!model.aggregations) continue;
    root[`${model.root}_aggregate`] = (args: HasuraReadArgs) => {
      const memo = new Map<string, Promise<Record<string, unknown> | null>>();
      const one = (aggregate: HasuraAggregate) => {
        const key = JSON.stringify(aggregate);
        if (!memo.has(key)) memo.set(key, run(tableId, compileAggregate(model, args, aggregate), { limit: 1, offset: 0 }).then((r) => r[0] ?? null));
        return memo.get(key)!;
      };
      return {
        aggregate: {
          count: async ({ columns, distinct }: { columns?: string[]; distinct?: boolean | null }) => Number((await one({ kind: 'count', ...(columns ? { columns } : {}), ...(distinct ? { distinct } : {}) }))?.value ?? 0),
          sum: () => one({ kind: 'sum' }),
          avg: () => one({ kind: 'avg' }),
          max: () => one({ kind: 'max' }),
          min: () => one({ kind: 'min' }),
        },
        nodes: () => rows(args),
      };
    };
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
  const loaded = await load(actor, directBinding(datasetId), signal, true);
  const parsed = parsedOperation(request);
  if ('errors' in parsed) return parsed;
  if (parsed.operation.operation === 'mutation') {
    const schema = schemaFor(hasuraSdl(loaded.tables.map((t) => t.model)));
    const invalid = validate(schema, parsed.document);
    if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
    return executeMutation(actor, datasetId, loaded, schema, parsed.document, request);
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
async function run(actor: AccessActor, loaded: readonly Loaded[], document: DocumentNode, request: DatasetGraphqlRequest, signal: AbortSignal, resultBytes: number, mutations?: HasuraMutationHook): Promise<DatasetGraphqlReply> {
  const models = loaded.flatMap((l) => l.tables.map((t) => t.model));
  const schema = schemaFor(hasuraSdl(models) + (mutations ? `\n${mutations.sdl(models)}` : ''));
  const invalid = validate(schema, document);
  if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
  const budget = { statements: 0 }, root: Record<string, unknown> = {};
  for (const l of loaded) rootValue(actor, l, signal, budget, root);
  // Through a page every loaded dataset was read (no write-only tables): its snapshot is present.
  if (mutations) Object.assign(root, mutations.root(actor, loaded.flatMap((l) => l.tables.map((t) => ({ ...t, snapshot: l.snapshot! }))), signal));
  const result = await execute({ schema, document, rootValue: root, variableValues: request.variables ?? {}, ...(request.operationName ? { operationName: request.operationName } : {}) });
  // Results leave only if the role, policy and head the reads were decided for still hold.
  for (const l of loaded) await fenced(l);
  const errors = result.errors?.map(classify);
  if (result.data && new TextEncoder().encode(JSON.stringify(result.data)).length > resultBytes) {
    return { data: null, errors: [error(`the answer is larger than ${resultBytes} bytes; select fewer rows or columns`, 'result_too_large')] };
  }
  return { ...(result.data !== undefined ? { data: result.data as Record<string, unknown> | null } : {}), ...(errors?.length ? { errors } : {}) };
}

/**
 * Where generated mutations plug in (Hasura PR 5): the mutation root's SDL for the linked tables and its resolvers,
 * which write as `actor` under each dataset's insert/update/delete rules. A resolver's caps.query runs outside any
 * transaction; the hook's own commits must keep the PGlite rule (no out-of-transaction query inside a transaction
 * callback) and notify after commit.
 */
interface HasuraMutationHook {
  sdl(tables: readonly HasuraTableModel[]): string;
  root(actor: AccessActor, tables: ReadonlyArray<{ model: HasuraTableModel; tableId: string; snapshot: DatasetSnapshot }>, signal: AbortSignal): Record<string, unknown>;
}

interface LinkedDatasetGraphqlOptions {
  /** The resolver operation the call runs inside: mutations only inside a mutation resolver. */
  operation: 'query' | 'mutation' | undefined;
  /** Serialized `data` bytes the answer may carry. */
  resultBytes: number;
  /** Generated mutations; absent until they ship, and a mutation is refused `mutations_unavailable`. */
  mutations?: HasuraMutationHook;
}

/**
 * THE PAGE'S DATASETS AS ONE HASURA-STYLE API, for a resolver's `caps.query`: every dataset the page links, under
 * its page name (a single-table dataset's root is the link name; a multi-table dataset's are `<name>_<table root>`).
 * The role is the page audience rule over each dataset's own sharing (never owner rights): a dataset the caller's
 * role reads nothing of is absent, as if unlinked.
 */
export async function executeLinkedDatasetGraphql(actor: AccessActor, links: readonly HtmlDatasetLink[], request: DatasetGraphqlRequest, options: LinkedDatasetGraphqlOptions, signal: AbortSignal): Promise<DatasetGraphqlReply> {
  const parsed = parsedOperation(request);
  if ('errors' in parsed) return parsed;
  const kind = parsed.operation.operation;
  if (kind === 'subscription') return { errors: [error('caps.query has no subscription root', 'validation_failed')] };
  if (kind === 'mutation' && options.operation !== 'mutation') return { errors: [error('a dataset mutation runs only inside a mutation resolver', 'permission_denied')] };
  if (kind === 'mutation' && !options.mutations) return { errors: [error('dataset mutations are not available to resolvers yet', 'mutations_unavailable')] };
  const loaded: Loaded[] = [];
  for (const link of links) {
    let one: Loaded;
    try { one = await load(actor, link, signal, false); } catch (e) {
      if (e instanceof Error && (e.message === 'dataset_not_found' || e instanceof DatasetBindingUnsupportedError)) continue;
      throw e;
    }
    const single = one.tables.length === 1;
    loaded.push({ ...one, tables: one.tables.map((t) => ({ ...t, model: { ...t.model, root: single ? link.name : `${link.name}_${t.model.root}` } })) });
  }
  const names = new Set<string>();
  for (const { model } of loaded.flatMap((l) => l.tables)) for (const name of hasuraGeneratedNames(model.root)) {
    if (names.has(name)) return { errors: [error(`two linked datasets generate the name ${name}; rename a link`, 'validation_failed')] };
    names.add(name);
  }
  if (!loaded.length) return { errors: [error('no linked dataset is readable', 'dataset_not_found')] };
  return run(actor, loaded, parsed.document, request, signal, options.resultBytes, kind === 'mutation' ? options.mutations : undefined);
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
    return row ? [Object.fromEntries([['_id', id], ...table.model.columns.map((c) => [c.field, row[c.source] ?? null])])] : [];
  });
}

/**
 * A mutation operation: record its root fields, compile them, write once (durably, under the idempotency key),
 * and answer the selection from the committed steps.
 */
async function executeMutation(actor: AccessActor, datasetId: string, loaded: Loaded, schema: GraphQLSchema, document: DocumentNode, request: DatasetGraphqlRequest): Promise<DatasetGraphqlReply> {
  const roots = mutationRoots(loaded.tables.map((t) => t.model));
  const options = { schema, document, variableValues: request.variables ?? {}, ...(request.operationName ? { operationName: request.operationName } : {}) };
  // Pass 1: each root field's coerced arguments, by response key; nothing is written.
  const recorded: Array<{ key: string; field: string; args: Record<string, unknown> }> = [];
  const recording = Object.fromEntries([...roots.keys()].map((field) => [field, (args: Record<string, unknown>, _: unknown, info: GraphQLResolveInfo) => { recorded.push({ key: String(info.path.key), field, args }); return null; }]));
  const first = await execute({ ...options, rootValue: recording });
  if (first.errors?.length) return reply({ errors: first.errors });
  if (!recorded.length) return reply(first);

  const key = request.idempotencyKey ?? randomUUID();
  if (!IDEMPOTENCY_KEY.test(key)) return { errors: [error('the Idempotency-Key must be 16 to 128 letters, digits, - or _', 'validation_failed')] };
  const seed = digest(['dataset-graphql', datasetId, key]);
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
  const payload = { datasetId, query: request.query, variables: request.variables ?? null, operationName: request.operationName ?? null };
  const outcome = await durableMutation(actor, 'https://dataset.invalid', seed, payload, async (receipt) => {
    const head = await getArtifactById(datasetId);
    if (!head || head.format !== 'dataset') return { status: 200, body: { errors: [error('the dataset no longer exists', 'dataset_not_found')] } };
    const [firstStatement] = statements;
    const result = await mutateDataset(head, actor, firstStatement!.sql, firstStatement!.params, {
      target: { schema: table.model.table.schema, table: table.model.table.name },
      statements,
      directPolicy: true,
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

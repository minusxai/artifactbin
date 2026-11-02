/**
 * THE DIRECT DATASET GRAPHQL API: one dataset's generated read schema (./hasura-schema) for the caller's
 * role, and its execution through the read compiler (./hasura-read) and the retained executor, which mounts the
 * caller's role view as every table. The role is the dataset's own sharing (`direct`): no page audience.
 *
 * Every engine statement goes through the retained port's `execute`, so the role view and the read fence
 * (role, policy revision and head identity) hold for each one; the fences retained while answering are
 * checked again before the reply leaves. Errors carry `extensions.code` and never row data.
 */
import { buildSchema, getOperationAST, GraphQLError, parse, validate, execute, type DocumentNode, type GraphQLSchema, type OperationDefinitionNode } from 'graphql';
import {
  DATASET_GRAPHQL_READ_LIMITS,
  type DatasetColumn,
  type DatasetGraphqlError,
  type DatasetGraphqlErrorCode,
  type DatasetGraphqlReply,
  type DatasetGraphqlRequest,
  type DatasetGraphqlSchemaReply,
  type HtmlDatasetLink,
} from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { getArtifactHeaderById } from '@/lib/artifacts';
import { tableIdentity } from './model';
import { retainedDatasetGraphqlPort } from './retained';
import { hasuraSdl, type HasuraScalar, type HasuraTableModel } from './hasura-schema';
import { hasuraGeneratedNames } from './hasura-names';
import { DatasetBindingUnsupportedError } from './authority';
import { compileAggregate, compileRows, HasuraReadError, type HasuraAggregate, type HasuraReadArgs } from './hasura-read';
import type { DatasetSnapshot, DatasetStatement } from './types';

/** Is this id a dataset (the route's branch)? Existence only: every answer below decides access itself. */
export async function isDatasetGraphqlTarget(id: string): Promise<boolean> {
  return (await getArtifactHeaderById(id))?.format === 'dataset';
}

const scalarOf = (type: DatasetColumn['type']): HasuraScalar => (type === 'number' ? 'Float' : type === 'boolean' ? 'Boolean' : 'String');

interface Loaded {
  snapshot: DatasetSnapshot;
  tables: Array<{ model: HasuraTableModel; tableId: string }>;
  port: ReturnType<typeof retainedDatasetGraphqlPort>;
  fences: Array<() => Promise<void>>;
}

/**
 * The caller's snapshot (throws `dataset_not_found` when the role reads nothing) and its table models. `direct`:
 * the dataset's own sharing decides the role; otherwise the page audience rule applies (a reader with no sharing
 * of their own is signed_in or anonymous).
 */
async function load(actor: AccessActor, binding: HtmlDatasetLink, signal: AbortSignal, direct: boolean): Promise<Loaded> {
  const fences: Array<() => Promise<void>> = [];
  const port = retainedDatasetGraphqlPort({ direct, retainReadFence: (verify) => { fences.push(verify); } });
  const snapshot = await port.snapshot(actor, binding, signal);
  const tables = snapshot.catalog.tables.map((table) => {
    const tableId = tableIdentity(table), names = snapshot.names?.[tableId];
    if (!names) throw new Error('dataset_not_found');
    const model: HasuraTableModel = {
      root: names.root,
      table: { schema: table.schema, name: table.name },
      columns: table.columns.map((c) => ({ field: names.columns[c.name] ?? (() => { throw new Error('dataset_not_found'); })(), source: c.name, type: scalarOf(c.type) })),
      aggregations: snapshot.aggregatable?.[tableId] ?? false,
    };
    return { model, tableId };
  });
  if (!tables.length) throw new Error('dataset_not_found');
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
  return { sdl, revision: loaded.snapshot.revision, role: loaded.snapshot.role! };
}

const error = (message: string, code: DatasetGraphqlErrorCode, path?: readonly (string | number)[]): DatasetGraphqlError => ({ message, ...(path ? { path } : {}), extensions: { code } });

/** A resolver's failure as a client error: the compiler's own refusals keep their message; nothing else does. */
function classify(e: GraphQLError): DatasetGraphqlError {
  const cause = e.originalError;
  if (!cause) return error(e.message, 'validation_failed', e.path);
  if (cause instanceof HasuraReadError) return error(cause.message, 'validation_failed', e.path);
  if (cause.message === 'dataset_changed') return error('the dataset or your access changed during the request; retry', 'dataset_changed', e.path);
  if (cause instanceof GraphQLError) return error(cause.message, 'validation_failed', e.path);
  return error('the read failed', 'unexpected', e.path);
}

/** Root resolvers over the loaded tables: one engine statement per list, `_by_pk` and aggregate leaf; `budget` is shared by every dataset in one request. */
function rootValue(actor: AccessActor, loaded: Loaded, signal: AbortSignal, budget = { statements: 0 }, root: Record<string, unknown> = {}): Record<string, unknown> {
  const run = async (tableId: string, statement: DatasetStatement, window: { limit: number; offset: number }) => {
    if (++budget.statements > DATASET_GRAPHQL_READ_LIMITS.statements) throw new HasuraReadError(`a request runs at most ${DATASET_GRAPHQL_READ_LIMITS.statements} reads`);
    return loaded.port.execute(actor, loaded.snapshot, tableId, statement, window, signal);
  };
  for (const { model, tableId } of loaded.tables) {
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
  if (mutations) Object.assign(root, mutations.root(actor, loaded.flatMap((l) => l.tables.map((t) => ({ ...t, snapshot: l.snapshot }))), signal));
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

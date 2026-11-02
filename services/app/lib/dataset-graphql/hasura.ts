/**
 * THE DIRECT DATASET GRAPHQL API: one dataset's generated read schema (./hasura-schema) for the caller's
 * role, and its execution through the read compiler (./hasura-read) and the retained executor, which mounts the
 * caller's role view as every table. The role is the dataset's own sharing (`direct`): no page audience.
 *
 * Every engine statement goes through the retained port's `execute`, so the role view and the read fence
 * (role, policy revision and head identity) hold for each one; the fences retained while answering are
 * checked again before the reply leaves. Errors carry `extensions.code` and never row data.
 */
import { buildSchema, getOperationAST, GraphQLError, parse, validate, execute, type DocumentNode, type GraphQLSchema } from 'graphql';
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

/** The caller's snapshot (throws `dataset_not_found` when the role reads nothing) and its table models. */
async function load(actor: AccessActor, datasetId: string, signal: AbortSignal): Promise<Loaded> {
  const fences: Array<() => Promise<void>> = [];
  const port = retainedDatasetGraphqlPort({ direct: true, retainReadFence: (verify) => { fences.push(verify); } });
  const binding: HtmlDatasetLink = { kind: 'dataset', name: 'data', datasetId, mode: 'live' };
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
export async function datasetGraphqlSchema(actor: AccessActor, datasetId: string, signal: AbortSignal): Promise<DatasetGraphqlSchemaReply> {
  const loaded = await load(actor, datasetId, signal);
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

/** Root resolvers over the loaded tables: one engine statement per list, `_by_pk` and aggregate leaf. */
function rootValue(actor: AccessActor, loaded: Loaded, signal: AbortSignal): Record<string, unknown> {
  let statements = 0;
  const run = async (tableId: string, statement: DatasetStatement, window: { limit: number; offset: number }) => {
    if (++statements > DATASET_GRAPHQL_READ_LIMITS.statements) throw new HasuraReadError(`a request runs at most ${DATASET_GRAPHQL_READ_LIMITS.statements} reads`);
    return loaded.port.execute(actor, loaded.snapshot, tableId, statement, window, signal);
  };
  const root: Record<string, unknown> = {};
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
  const loaded = await load(actor, datasetId, signal);
  const schema = schemaFor(hasuraSdl(loaded.tables.map((t) => t.model)));
  let document: DocumentNode;
  try { document = parse(request.query, { maxTokens: 10_000 }); } catch (e) { return { errors: [error((e as Error).message, 'validation_failed')] }; }
  const invalid = validate(schema, document);
  if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
  const operation = getOperationAST(document, request.operationName);
  if (!operation) return { errors: [error('name the operation to run (operationName)', 'validation_failed')] };
  if (operation.operation !== 'query') return { errors: [error(`this dataset's schema has no ${operation.operation} root`, 'validation_failed')] };
  const result = await execute({ schema, document, rootValue: rootValue(actor, loaded, signal), variableValues: request.variables ?? {}, ...(request.operationName ? { operationName: request.operationName } : {}) });
  // Results leave only if the role, policy and head the reads were decided for still hold.
  await fenced(loaded);
  const errors = result.errors?.map(classify);
  if (result.data && new TextEncoder().encode(JSON.stringify(result.data)).length > DATASET_GRAPHQL_READ_LIMITS.resultBytes) {
    return { data: null, errors: [error(`the answer is larger than ${DATASET_GRAPHQL_READ_LIMITS.resultBytes} bytes; select fewer rows or columns`, 'result_too_large')] };
  }
  return { ...(result.data !== undefined ? { data: result.data as Record<string, unknown> | null } : {}), ...(errors?.length ? { errors } : {}) };
}

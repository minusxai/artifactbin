/**
 * THE GENERATED API IN LOCAL PREVIEW: one local dataset (declared CSV/JSON files) on the generated Hasura-style
 * API, as the page's owner sees it (every column, aggregates, every write). Node-only: the rows live in an
 * in-memory `node:sqlite` database and the SAME compilers as the server (./hasura-read, ./hasura-write) produce
 * the statements, so where/order_by/aggregate/insert/update/delete answer as published pages do. Edits stay in
 * this session until the caller explicitly exports them; nothing touches the filesystem or the network.
 */
import { createHash } from 'node:crypto';
import { buildSchema, execute, getOperationAST, parse, validate, type DocumentNode, type GraphQLResolveInfo } from 'graphql';
import { DATASET_GRAPHQL_WRITE_LIMITS, type DatasetColumn, type DatasetGraphqlError, type DatasetGraphqlErrorCode, type DatasetGraphqlReply, type DatasetGraphqlRequest, type PageNamespaceSource } from '@artifactbin/contracts';
import { hasuraSdl, type HasuraColumn, type HasuraScalar, type HasuraTableModel } from './hasura-schema';
import { hasuraNames } from './hasura-names';
import { compileAggregate, compileRows, HasuraReadError, type HasuraAggregate, type HasuraReadArgs } from './hasura-read';
import { compileMutation, HasuraWriteError, mutationRoots, type HasuraMutationKind } from './hasura-write';
import { ID_COLUMN, initialRowIds, quote, tableIdentity } from './model';
import type { LocalDatasetTable } from './local-types';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const scalarOf = (type: DatasetColumn['type']): HasuraScalar => (type === 'number' ? 'Float' : type === 'boolean' ? 'Boolean' : 'String');
const sqlType = (type: HasuraScalar) => (type === 'Float' ? 'REAL' : type === 'Boolean' ? 'INTEGER' : 'TEXT');
const error = (message: string, code: DatasetGraphqlErrorCode): DatasetGraphqlError => ({ message, extensions: { code } });
/** node:sqlite binds no booleans: stored and compared as 0/1, answered as booleans again. */
const bindable = (params: Record<string, unknown>) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'boolean' ? Number(v) : v])) as Record<string, string | number | null>;

interface Table { model: HasuraTableModel; declared: LocalDatasetTable }
type Database = { exec(sql: string): void; prepare(sql: string): { all(params?: Record<string, unknown>): Record<string, unknown>[] } };

export interface LocalHasuraDataset {
  /** The composition source: the owner's generated SDL, roots flat. */
  source: PageNamespaceSource;
  /** Query root resolvers by field name. */
  queryRoots(): Record<string, unknown>;
  /** Root fields this dataset answers (queries and mutations). */
  owns(field: string): boolean;
  /** One mutation operation over this dataset: atomic, at most 100 changed rows, replayed under its Idempotency-Key. */
  mutate(request: DatasetGraphqlRequest): Promise<DatasetGraphqlReply>;
  revision(): string;
  export(): { revision: string; tables: LocalDatasetTable[] };
}

async function openDatabase(): Promise<Database> {
  let sqlite: { DatabaseSync: new (path: string) => Database };
  try { sqlite = await import('node:sqlite') as unknown as typeof sqlite; } catch { throw new Error('Local preview of the generated dataset API needs Node 22.13 or newer (node:sqlite); upgrade Node, or add data-af-api="legacy" to preview the generic API'); }
  return new sqlite.DatabaseSync(':memory:');
}

/** One local dataset under its page name `name` (a single table's root; `<name>_<table>` for several). */
export async function createLocalHasuraDataset(name: string, input: readonly LocalDatasetTable[]): Promise<LocalHasuraDataset> {
  const db = await openDatabase();
  const names = hasuraNames(input);
  const schemas = new Set(input.map((t) => t.schema).filter((s) => s !== 'main' && s !== 'temp'));
  for (const schema of schemas) db.exec(`ATTACH DATABASE ':memory:' AS ${quote(schema)}`);
  const tables: Table[] = input.map((declared, i) => {
    const tableNames = names[i]!;
    const columns: HasuraColumn[] = declared.columns.map((c) => ({ field: tableNames.columns[c.name]!, source: c.name, type: scalarOf(c.type) }));
    const model: HasuraTableModel = {
      root: input.length === 1 ? name : `${name}_${tableNames.root}`,
      table: { schema: declared.schema, name: declared.name },
      columns, aggregations: true,
      write: { insert: columns, update: columns, delete: true },
    };
    const target = `${quote(declared.schema)}.${quote(declared.name)}`;
    db.exec(`CREATE TABLE ${target} (${[`${quote(ID_COLUMN)} TEXT PRIMARY KEY`, ...columns.map((c) => `${quote(c.source)} ${sqlType(c.type)}`)].join(', ')})`);
    const ids = declared.rowIds ?? initialRowIds(name, tableIdentity(declared), hash(declared.rows), declared.rows.length);
    const insert = db.prepare(`INSERT INTO ${target} (${[ID_COLUMN, ...columns.map((c) => c.source)].map(quote).join(', ')}) VALUES (${['$id', ...columns.map((_, j) => `$c${j}`)].join(', ')})`);
    declared.rows.forEach((row, r) => insert.all(bindable({ id: ids[r]!, ...Object.fromEntries(columns.map((c, j) => [`c${j}`, row[c.source] ?? null])) })));
    return { model, declared };
  });
  const models = tables.map((t) => t.model);
  const sdl = hasuraSdl(models);
  const schema = buildSchema(sdl);
  const writes = mutationRoots(models);
  let revision = `local_${hash([name, input])}`;
  const receipts = new Map<string, { identity: string; reply: DatasetGraphqlReply }>();

  /** A stored row as its GraphQL object: `_id` and every column, booleans restored. */
  const shaped = (model: HasuraTableModel, row: Record<string, unknown>, keyed: 'field' | 'source') => Object.fromEntries([
    ['_id', row[keyed === 'field' ? '_id' : ID_COLUMN]],
    ...model.columns.map((c) => { const v = row[keyed === 'field' ? c.field : c.source] ?? null; return [c.field, c.type === 'Boolean' && v !== null ? !!v : v]; }),
  ]);
  const rows = (model: HasuraTableModel, args: HasuraReadArgs) => {
    const plan = compileRows(model, args);
    if (plan.window.limit === 0) return [];
    return db.prepare(`${plan.statement.sql} LIMIT $af_limit OFFSET $af_offset`).all(bindable({ ...plan.statement.params, af_limit: plan.window.limit, af_offset: plan.window.offset })).map((r) => shaped(model, r, 'field'));
  };
  const aggregate = (model: HasuraTableModel, args: HasuraReadArgs, what: HasuraAggregate) => {
    const statement = compileAggregate(model, args, what);
    return db.prepare(statement.sql).all(bindable(statement.params))[0] ?? null;
  };

  function queryRoots(): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    for (const { model } of tables) {
      root[model.root] = async (args: HasuraReadArgs) => rows(model, args);
      root[`${model.root}_by_pk`] = async ({ _id }: { _id: string }) => rows(model, { where: { _id: { _eq: _id } }, limit: 1 })[0] ?? null;
      root[`${model.root}_aggregate`] = async (args: HasuraReadArgs) => ({
        aggregate: {
          count: async ({ columns, distinct }: { columns?: string[]; distinct?: boolean | null }) => Number(aggregate(model, args, { kind: 'count', ...(columns ? { columns } : {}), ...(distinct ? { distinct } : {}) })?.value ?? 0),
          sum: async () => aggregate(model, args, { kind: 'sum' }),
          avg: async () => aggregate(model, args, { kind: 'avg' }),
          max: async () => aggregate(model, args, { kind: 'max' }),
          min: async () => aggregate(model, args, { kind: 'min' }),
        },
        nodes: async () => rows(model, args),
      });
    }
    return root;
  }

  async function mutate(request: DatasetGraphqlRequest): Promise<DatasetGraphqlReply> {
    let document: DocumentNode;
    try { document = parse(request.query); } catch (e) { return { errors: [error((e as Error).message, 'validation_failed')] }; }
    if (getOperationAST(document, request.operationName)?.operation !== 'mutation') return { errors: [error('not a mutation', 'validation_failed')] };
    const invalid = validate(schema, document);
    if (invalid.length) return { errors: invalid.slice(0, 20).map((e) => error(e.message, 'validation_failed')) };
    const options = { schema, document, variableValues: request.variables ?? {}, ...(request.operationName ? { operationName: request.operationName } : {}) };
    const key = request.idempotencyKey ?? `local_${hash([revision, request, receipts.size])}`;
    const identity = hash([request.query, request.variables ?? null, request.operationName ?? null]);
    const prior = receipts.get(key);
    if (prior) return prior.identity === identity ? structuredClone(prior.reply) : { errors: [error('this Idempotency-Key was already used for a different request', 'validation_failed')] };
    const recorded: Array<{ key: string; field: string; args: Record<string, unknown> }> = [];
    const first = await execute({ ...options, rootValue: Object.fromEntries([...writes.keys()].map((field) => [field, (args: Record<string, unknown>, _: unknown, info: GraphQLResolveInfo) => { recorded.push({ key: String(info.path.key), field, args }); return null; }])) });
    if (first.errors?.length) return { errors: first.errors.map((e) => error(e.message, 'validation_failed')) };
    const results = new Map<string, unknown>();
    db.exec('BEGIN');
    try {
      let changed = 0;
      for (const [i, call] of recorded.entries()) {
        const { model, kind } = writes.get(call.field)!;
        const statement = compileMutation(model, kind, call.args, (j) => `r_${hash([name, key, i, j])}`);
        const written = statement ? db.prepare(`${statement.sql} RETURNING *`).all(bindable(statement.params)).map((r) => shaped(model, r, 'source')) : [];
        changed += written.length;
        if (changed > DATASET_GRAPHQL_WRITE_LIMITS.rows) throw new HasuraWriteError('too_many_rows', `a mutation changes at most ${DATASET_GRAPHQL_WRITE_LIMITS.rows} rows; nothing was written`);
        results.set(call.key, isMany(kind) ? { affected_rows: written.length, returning: written } : written[0] ?? null);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      if (e instanceof HasuraWriteError || e instanceof HasuraReadError) return { data: null, errors: [error(e.message, e instanceof HasuraWriteError ? e.code : 'validation_failed')] };
      throw e;
    }
    if (recorded.length) revision = `local_${hash([revision, key])}`;
    const answer = await execute({ ...options, rootValue: Object.fromEntries([...writes.keys()].map((field) => [field, (_: unknown, __: unknown, info: GraphQLResolveInfo) => results.get(String(info.path.key))])) });
    const reply: DatasetGraphqlReply = { ...(answer.data !== undefined ? { data: answer.data as Record<string, unknown> | null } : {}), ...(answer.errors?.length ? { errors: answer.errors.map((e) => error(e.message, 'validation_failed')) } : {}) };
    if (receipts.size >= 1024) throw new Error('local_dataset_session_full');
    receipts.set(key, { identity, reply: structuredClone(reply) });
    return reply;
  }

  return {
    source: { name, fileId: `local_${name}`, version: 'live', typeDefs: sdl, kind: 'dataset-hasura' },
    queryRoots,
    owns: (field) => writes.has(field) || tables.some(({ model: m }) => field === m.root || field === `${m.root}_by_pk` || field === `${m.root}_aggregate`),
    mutate,
    revision: () => revision,
    export: () => ({
      revision,
      tables: tables.map(({ model, declared }) => {
        const stored = db.prepare(`SELECT * FROM ${quote(declared.schema)}.${quote(declared.name)} ORDER BY rowid`).all();
        return {
          schema: declared.schema, name: declared.name, columns: structuredClone(declared.columns),
          rowIds: stored.map((r) => String(r[ID_COLUMN])),
          rows: stored.map((r) => Object.fromEntries(model.columns.map((c) => { const v = r[c.source] ?? null; return [c.source, c.type === 'Boolean' && v !== null ? !!v : v]; }))),
        };
      }),
    }),
  };
}

const isMany = (kind: HasuraMutationKind) => kind === 'insert' || kind === 'update' || kind === 'delete';

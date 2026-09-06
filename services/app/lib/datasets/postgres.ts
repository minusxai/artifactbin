import {DATASET_ALLOW_PRIVATE_NETWORKS} from '@/lib/config';
import {resolvePostgresHost} from './network';
import {isIP} from 'node:net';
import pg from 'pg';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Scalar, TableResult } from '@/lib/story/dataflow';
import type { DiscoveredTable, PostgresConfig } from './types';

const MAX_ROWS = 10_000;
const MAX_TIMEOUT = 10_000;
const numericOids = new Set([20, 21, 23, 26, 700, 701, 1700]);
const dateOids = new Set([1082, 1083, 1114, 1184, 1266]);
function columnType(oid: number): DatasetColumn['type'] {
  return oid === 16 ? 'boolean' : numericOids.has(oid) ? 'number' : dateOids.has(oid) ? 'date' : 'string';
}
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min) throw new Error('Invalid Postgres query bounds');
  return Math.min(value, max);
}
/** One short-lived connection per operation. Server statement_timeout performs
 * actual cancellation; the client timeout additionally bounds a broken network. */
async function transaction<T>(config: PostgresConfig, timeoutMs: number, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const address=await resolvePostgresHost(config.host,DATASET_ALLOW_PRIVATE_NETWORKS);
  const client = new pg.Client({
    host: address, port: config.port, database: config.database, user: config.username, password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: true, ...(!isIP(config.host)?{servername:config.host}:{}) } : false,
    connectionTimeoutMillis: 5_000, query_timeout: timeoutMs + 1_000,
    statement_timeout: timeoutMs, application_name: 'artifactbin-dataset',
    types: { getTypeParser(oid, format) {
      // Do not inherit process-wide int8 coercion or host-local timestamp zones.
      if (format !== 'binary' && [20, 1700, 1082].includes(oid)) return (value: string) => value;
      if (format !== 'binary' && oid === 1114) return (value: string) => {
        const date = new Date(`${value}Z`);
        return Number.isNaN(date.getTime()) ? value : date;
      };
      return pg.types.getTypeParser(oid, format);
    } },
  });
  // Idle socket errors must not escape as uncaught EventEmitter errors.
  client.on('error', () => {});
  let connected = false;
  try {
    await client.connect(); connected = true;
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL search_path = pg_catalog");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code;
    // Never pass server messages through: values, credentials, hosts and SQL can occur there.
    throw new Error(!connected ? 'Postgres connection failed' : code === '57014' || (error as Error).message === 'Query read timeout' ? 'Postgres query timed out' : 'Postgres query failed');
  } finally {
    await client.end().catch(() => {});
  }
}
function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}

/** Executes compiler output only, with remote pagination and one lookahead row. */
export async function queryPostgres(config: PostgresConfig, sql: string, values: Scalar[], opts: { limit?: number; offset?: number; timeoutMs?: number } = {}): Promise<TableResult> {
  const limit = bounded(opts.limit, MAX_ROWS, 1, MAX_ROWS);
  const offset = bounded(opts.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const timeout = bounded(opts.timeoutMs, MAX_TIMEOUT, 1, MAX_TIMEOUT);
  return transaction(config, timeout, async client => {
    const result = await client.query(`SELECT * FROM (${sql}) AS "_dataset_result" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit + 1, offset]);
    const truncated = result.rows.length > limit;
    return {
      rows: result.rows.slice(0, limit).map(row => jsonSafe(row) as TableResult['rows'][number]),
      columns: result.fields.map(field => ({ name: field.name, type: columnType(field.dataTypeID) })),
      ...(truncated ? { truncated: true } : {}),
    };
  });
}

/** PostgreSQL privilege predicates include column-level grants and inherited roles. */
export async function discoverPostgres(config: PostgresConfig): Promise<DiscoveredTable[]> {
  return transaction(config, MAX_TIMEOUT, async client => {
    const result = await client.query<{ schema: string; name: string; column: string; oid: number }>(`
      SELECT n.nspname AS schema, c.relname AS name, a.attname AS column,
             COALESCE(NULLIF(t.typbasetype, 0), a.atttypid)::int AS oid
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
        AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname <> 'information_schema'
        AND pg_catalog.has_schema_privilege(n.oid, 'USAGE')
        AND pg_catalog.has_column_privilege(c.oid, a.attnum, 'SELECT')
      ORDER BY n.nspname, c.relname, a.attnum LIMIT 10001`);
    if (result.rows.length > 10_000) throw new Error('Postgres catalog is too large');
    const tables = new Map<string, DiscoveredTable>();
    for (const row of result.rows) {
      const key = JSON.stringify([row.schema, row.name]);
      let table = tables.get(key);
      if (!table) { table = { schema: row.schema, name: row.name, columns: [] }; tables.set(key, table); }
      table.columns.push({ name: row.column, type: columnType(row.oid) });
    }
    return [...tables.values()];
  });
}

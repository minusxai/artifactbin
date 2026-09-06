import {DATASET_ALLOW_PRIVATE_NETWORKS} from '@/lib/config';
import {resolvePostgresHost} from './network';
import {isIP} from 'node:net';
import {checkServerIdentity, type PeerCertificate} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import pg from 'pg';
import Cursor from 'pg-cursor';
import type { DatasetColumn } from '@/lib/story/dataset-shape';
import type { Scalar, TableResult } from '@/lib/story/dataflow';
import type { DiscoveredTable, PostgresConfig } from './types';

const MAX_ROWS = 10_000;
const MAX_TIMEOUT = 10_000;
const MAX_RESULT_BYTES = 8 * 1024 * 1024;
let activeConnections = 0;
const connectionQueue: Array<{ grant: () => void }> = [];
class ResultLimitError extends Error {}

/** Eight active connections and at most 32 waiting for up to one second. */
async function withConnectionSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeConnections < 8) activeConnections++;
  else {
    if (connectionQueue.length >= 32) throw new Error('Postgres is busy; retry later');
    await new Promise<void>((resolve, reject) => {
      const entry = { grant: () => { clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        const index = connectionQueue.indexOf(entry);
        if (index >= 0) connectionQueue.splice(index, 1);
        reject(new Error('Postgres query queue timed out'));
      }, 1000);
      connectionQueue.push(entry);
    });
  }
  try { return await work(); }
  finally {
    const waiting = connectionQueue.shift();
    if (waiting) waiting.grant();
    else activeConnections--;
  }
}

/** Client.end destroys an active query's socket, bounding broken networks as
 * well as execution time. Server statement_timeout remains the primary cancel. */
async function withDeadline<T>(client: pg.Client, timeoutMs: number, work: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ResultLimitError('Postgres query timed out'));
      void client.end().catch(() => {});
    }, timeoutMs);
  });
  try { return await Promise.race([work(), deadline]); }
  finally { clearTimeout(timer); }
}

// A cursor cannot finish its normal portal-close handshake on a broken socket.
// The transaction always ends the client after this bounded cleanup attempt.
async function closeCursor(cursor: Cursor): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([cursor.close().catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, 250); })]); }
  finally { clearTimeout(timer); }
}
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
/** IP SAN matching uses the certificate's DER directly. Node 22.23's TLS
 * hostname checker applies domainToASCII to IPv6 and loses the address.
 * TLS still verifies the chain and validity with rejectUnauthorized:true. */
function checkPostgresIdentity(host: string, certificate: PeerCertificate): Error | undefined {
  if (!isIP(host)) return checkServerIdentity(host, certificate);
  try {
    if (certificate.raw && new X509Certificate(certificate.raw).checkIP(host)) return undefined;
  } catch { /* A malformed or missing peer certificate must fail closed. */ }
  return Object.assign(new Error('Postgres server certificate does not match the configured IP address'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
}

/** One short-lived connection per operation. Server statement_timeout performs
 * actual cancellation; the client timeout additionally bounds a broken network. */
async function transaction<T>(config: PostgresConfig, timeoutMs: number, work: (client: pg.Client) => Promise<T>): Promise<T> {
  return withConnectionSlot(async () => {
    const address = await resolvePostgresHost(config.host, DATASET_ALLOW_PRIVATE_NETWORKS);
    const identityHost = config.host.startsWith('[') ? config.host.slice(1, -1) : config.host;
    const client = new pg.Client({
      host: address, port: config.port, database: config.database, user: config.username, password: config.password,
      ssl: config.ssl ? {
        rejectUnauthorized: true,
        ...(!isIP(identityHost) ? { servername: identityHost } : {}),
        // The socket is pinned to an IP. Verify the configured DNS name (or
        // literal IP SAN), never the pinned socket's/default TLS hostname.
        checkServerIdentity: (_host, certificate) => checkPostgresIdentity(identityHost, certificate),
      } : false,
      connectionTimeoutMillis: 5_000,
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
      return await withDeadline(client, timeoutMs + 1000, async () => {
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL search_path = pg_catalog");
        await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      // Never pass server messages through: values, credentials, hosts and SQL can occur there.
      if (error instanceof ResultLimitError) throw error;
      throw new Error(!connected ? 'Postgres connection failed' : code === '57014' || (error as Error).message === 'Query read timeout' ? 'Postgres query timed out' : 'Postgres query failed');
    } finally {
      await client.end().catch(() => {});
    }
  });
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
    const cursor = client.query(new Cursor<TableResult['rows'][number]>(
      `SELECT * FROM (${sql}) AS "_dataset_result" LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit + 1, offset],
      { types: { getTypeParser: client.getTypeParser.bind(client) } },
    ));
    const rows: TableResult['rows'] = [];
    let columns: DatasetColumn[] = [];
    let bytes = 2; // JSON array brackets.
    let batchSize = 1; // Measure the first row before requesting a larger batch.
    let largestRow = 1;
    let truncated = false;
    try {
      read: while (true) {
        const batch = await new Promise<pg.QueryResult>((resolve, reject) => {
          cursor.read(batchSize, (error, batchRows, result) => error ? reject(error) : resolve({ ...result, rows: batchRows }));
        });
        if (batch.fields) columns = batch.fields.map(field => ({ name: field.name, type: columnType(field.dataTypeID) }));
        for (const raw of batch.rows) {
          if (rows.length === limit) { truncated = true; break read; }
          const row = jsonSafe(raw) as TableResult['rows'][number];
          const size = Buffer.byteLength(JSON.stringify(row));
          if (size + 2 > MAX_RESULT_BYTES) throw new ResultLimitError('Postgres result row is too large');
          if (bytes + size + (rows.length ? 1 : 0) > MAX_RESULT_BYTES) { truncated = true; break read; }
          bytes += size + (rows.length ? 1 : 0); rows.push(row); largestRow = Math.max(largestRow, size);
        }
        if (batch.rows.length < batchSize) break;
        // At most 16 rows buffered; reduce batches for large payloads and leave
        // one lookahead row so exact row caps do not falsely report truncation.
        batchSize = Math.max(1, Math.min(16, limit + 1 - rows.length, Math.floor((MAX_RESULT_BYTES - bytes) / largestRow)));
      }
      return { rows, columns, ...(truncated ? { truncated: true } : {}) };
    } finally { await closeCursor(cursor); }
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

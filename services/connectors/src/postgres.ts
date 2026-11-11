/**
 * THE POSTGRES-PROTOCOL CONNECTOR (postgres.js), adapted from the runner's `caps.db` client
 * (services/runner/src/worker-database.mjs `postgresClient`). On the wire, exactly:
 *
 *  1. Startup, once per session (sessions are shared by viewers, one database each): TCP to the address ./network
 *     judged; SSLRequest and TLS (verify-full, TLS 1.2+, `ca` if configured) unless the install allows
 *     `tls: 'disable'`; StartupMessage 3.0 with `user` (the configured account), `database` (what followed `default:`,
 *     as written, else the configured database), `application_name=artifactbin`, `TimeZone=UTC`,
 *     `statement_timeout=<CONNECTOR_LIMITS.timeoutMs>` and `default_transaction_read_only=on`; the password as the
 *     server asks (cleartext inside TLS, MD5 or SCRAM).
 *  2. Each query, `schema()` and `test()`, on the session's one connection, in this order (postgres.js sends Parse,
 *     Describe and Flush, then Bind, Execute and Sync; a cursor's Execute carries a row count and is followed by Flush):
 *       Q          `BEGIN READ ONLY`
 *       P D H B E S  `SELECT set_config('app.viewer_id', $1, true), set_config('app.viewer_email', $2, true), set_config('app.viewer_groups', $3, true)`
 *                    with $1 the account ID, $2 the email, $3 the group IDs as sorted JSON array text (unnamed, untyped)
 *       P D H B E… S the statement, one, its values bound (`$name` → `$1`…), read by a cursor that stops one row past the
 *                    limit
 *       Q          `COMMIT`  (`ROLLBACK` after an error)
 *     A connection lost between the steps would reconnect in autocommit: its answer is discarded (the close count),
 *     and the session's default read-only transactions keep even that statement from writing.
 *
 * Types: postgres.js's own parsers, with dates and timestamps kept as the server's text (./answer has the rules).
 */
import { isIP } from 'node:net';
import postgres from 'postgres';
import type { ConnectionConfig, ConnectorAnswer, ConnectorColumn, ConnectorJson, ConnectorNetworkPolicy, ConnectorQuery, ConnectorSchema, ConnectorValueType } from '@artifactbin/contracts';
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { Collector, checkedNamespace, limitsOf, numberValue, plainValue, timestampValue, uniqueColumns, viewerValues, withinTime } from './answer';
import { connectionSecrets } from './config';
import { ConnectorFailure, driverFailure } from './errors';
import { connectTarget, targetOf, type NetworkSeams } from './network';
import { SessionPool } from './sessions';
import { bindStatement, readOnlyStatement } from './statement';
import type { ConnectorModule } from './module';

const NUMBER = new Set([20, 21, 23, 26, 700, 701, 1700]), DATE = 1082, TIMESTAMP = 1114, TIMESTAMPTZ = 1184;
const JSON_TYPES = new Set([114, 3802]);
function typeOf(oid: number): ConnectorValueType {
  if (oid === 16) return 'boolean';
  if (NUMBER.has(oid)) return 'number';
  if (oid === DATE) return 'date';
  if (oid === TIMESTAMP || oid === TIMESTAMPTZ) return 'timestamp';
  if (JSON_TYPES.has(oid)) return 'json';
  return 'text';
}
/** information_schema's `data_type` (schema listing), Postgres and MySQL spellings. */
export function typeOfName(name: string): ConnectorValueType {
  const n = name.toLowerCase();
  if (['smallint', 'integer', 'bigint', 'numeric', 'decimal', 'real', 'double precision', 'oid', 'tinyint', 'mediumint', 'int', 'float', 'double', 'year'].includes(n)) return 'number';
  if (n === 'boolean' || n === 'bit') return 'boolean';
  if (n === 'date') return 'date';
  if (n.startsWith('timestamp') || n === 'datetime') return 'timestamp';
  if (n === 'json' || n === 'jsonb' || n === 'array') return 'json';
  return 'text';
}
function cell(oid: number, value: unknown): ConnectorJson {
  if (value === null || value === undefined) return null;
  if (NUMBER.has(oid)) return numberValue(value);
  if (oid === TIMESTAMP || oid === TIMESTAMPTZ) return timestampValue(String(value), oid === TIMESTAMPTZ);
  if (oid === DATE) return String(value);
  return plainValue(value);
}
/** Postgres array types and anything parsed to an array are `json`. */
const columnType = (oid: number, sample: unknown): ConnectorValueType => Array.isArray(sample) ? 'json' : typeOf(oid);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = postgres.Sql<any>;
type Raw = { name: string; type: number }[];
const VIEWER_STATEMENT = "SELECT set_config('app.viewer_id', $1, true), set_config('app.viewer_email', $2, true), set_config('app.viewer_groups', $3, true)";

export const postgresConnector: ConnectorModule = {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams: NetworkSeams = {}) {
    const target = targetOf(config, policy);
    const secrets = connectionSecrets(config);
    let firstByte: number | undefined;
    const sessions = new SessionPool<{ sql: Sql; closes: number }>({
      async open(database) {
        const session = { closes: 0 } as { sql: Sql; closes: number };
        session.sql = postgres({
          host: target.host, port: target.port, database, username: String(config.user), password: typeof config.password === 'string' ? config.password : undefined,
          ssl: target.tls ? { ...target.tls, host: target.host, ...(isIP(target.host) ? {} : { servername: target.host }) } : false,
          // A server without TLS answers SSLRequest 'N' and postgres.js starts TLS anyway: that byte names the refusal.
          socket: async () => { const socket = await connectTarget(target, policy, seams); socket.once('data', (d: Buffer) => { firstByte = d[0]; }); return socket; },
          max: 1, connect_timeout: CONNECTOR_LIMITS.connectTimeoutMs / 1000, fetch_types: false, prepare: false,
          onnotice: () => {}, onparameter: () => {}, onclose: () => { session.closes++; }, debug: false,
          connection: { application_name: 'artifactbin', TimeZone: 'UTC', statement_timeout: String(CONNECTOR_LIMITS.timeoutMs), default_transaction_read_only: 'on' },
          types: { rawTime: { to: 1082, from: [1082, 1083, 1114, 1184, 1266], serialize: String, parse: (text: string) => text } },
        } as unknown as postgres.Options<Record<string, postgres.PostgresType>>) as Sql;
        return session;
      },
      close: (session) => session.sql.end({ timeout: 1 }),
    });
    const fail = (error: unknown) => {
      if (target.tls && firstByte === 78 && !(error instanceof ConnectorFailure)) return new ConnectorFailure('tls_unsupported', 'the database server does not offer TLS; enable TLS on the server');
      return driverFailure(error, secrets);
    };

    /** One statement in a read-only transaction, as the header says. `guarded`: the reader's, checked and bound. */
    async function run(query: ConnectorQuery, guarded: boolean): Promise<ConnectorAnswer> {
      if (guarded) readOnlyStatement('postgres', query.text);
      const bound = guarded ? bindStatement('postgres', query.text, query.params) : { text: query.text, values: Object.values(query.params) };
      const limits = limitsOf(query), viewer = viewerValues(query);
      const database = checkedNamespace('postgres', query.namespace) ?? String(config.database);
      return sessions.use(database, async (session, discard) => {
        const sql = session.sql;
        try {
          return await withinTime(limits.timeoutMs + 1000, query.signal, () => { discard(); void sql.end({ timeout: 0 }); }, async () => {
            const step = async <T>(work: Promise<T>, at: number) => { const out = await work; if (session.closes !== at) throw new ConnectorFailure('connect_failed', 'the connection was lost during the query'); return out; };
            const at = session.closes;
            await sql.unsafe('BEGIN READ ONLY');
            try {
              await step(sql.unsafe(VIEWER_STATEMENT, [viewer.id, viewer.email, viewer.groups], { simple: false } as never), at);
              let collector: Collector | undefined, oids: number[] = [], names: string[] = [];
              const begin = (columns: Raw, sample?: Record<string, unknown>) => {
                oids = columns.map((c) => c.type); names = columns.map((c) => c.name);
                collector = new Collector(limits, uniqueColumns(columns.map((c) => ({ name: c.name, type: columnType(c.type, sample?.[c.name]) }))));
              };
              const result = await step(sql.unsafe(bound.text, bound.values as never[], { simple: false } as never).cursor(Math.min(500, limits.rows + 1), (rows: Record<string, unknown>[]) => {
                // Only the first batch carries the columns.
                if (!collector) begin((rows as unknown as { columns?: Raw }).columns ?? [], rows[0]);
                for (const row of rows) if (!collector!.add(Object.fromEntries(names.map((name, i) => [name, cell(oids[i]!, row[name])])))) return sql.CLOSE;
                return undefined;
              }), at);
              if (!collector) begin((result as unknown as { columns?: Raw }).columns ?? []);
              await step(sql.unsafe('COMMIT'), at);
              return collector!.answer();
            } catch (error) {
              await sql.unsafe('ROLLBACK').catch(() => discard());
              throw error;
            }
          });
        } catch (error) {
          if (!(error instanceof ConnectorFailure) || error.code === 'timeout') discard();
          throw fail(error);
        }
      });
    }

    return {
      connector: 'postgres', dialect: 'postgres',
      query: (q) => run(q, true),
      async schema(options): Promise<ConnectorSchema> {
        const answer = await run({ viewer: options.viewer, ...(options.namespace ? { namespace: options.namespace } : {}), ...(options.signal ? { signal: options.signal } : {}), limits: { rows: CONNECTOR_LIMITS.rows },
          text: `SELECT c.table_schema AS ns, c.table_name AS name, t.table_type AS kind, c.column_name AS col, c.data_type AS type
            FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY c.table_schema, c.table_name, c.ordinal_position`, params: {} }, false);
        return tablesOf(answer, (r) => ({ namespace: String(r.ns), name: String(r.name), kind: r.kind === 'VIEW' ? 'view' : 'table', column: { name: String(r.col), type: typeOfName(String(r.type)) } }));
      },
      async test(options) {
        const started = Date.now();
        try { await run({ text: 'SELECT 1 AS ok', params: {}, viewer: options.viewer, ...(options.namespace ? { namespace: options.namespace } : {}), limits: { rows: 1 } }, false); return { ok: true, latencyMs: Date.now() - started }; }
        catch (error) { const e = fail(error); return { ok: false, error: { code: e.code, message: e.message } }; }
      },
      close: () => sessions.close(),
      sessions: () => sessions.count(),
    };
  },
};

/** Rows of (table, column) in table order → the schema, at most CONNECTOR_LIMITS.schemaTables tables. */
export function tablesOf(answer: ConnectorAnswer, row: (r: Readonly<Record<string, ConnectorJson>>) => { namespace: string; name: string; kind: 'table' | 'view'; column: ConnectorColumn }): ConnectorSchema {
  const tables: { namespace: string; name: string; kind: 'table' | 'view'; columns: ConnectorColumn[] }[] = [];
  let truncated = !!answer.truncated;
  for (const r of answer.rows) {
    const t = row(r), last = tables.at(-1);
    if (last && last.namespace === t.namespace && last.name === t.name) { last.columns.push(t.column); continue; }
    if (tables.length >= CONNECTOR_LIMITS.schemaTables) { truncated = true; break; }
    tables.push({ namespace: t.namespace, name: t.name, kind: t.kind, columns: [t.column] });
  }
  return { tables, ...(truncated ? { truncated: true as const } : {}) };
}

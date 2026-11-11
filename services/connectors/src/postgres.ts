/**
 * THE POSTGRES-PROTOCOL CONNECTOR (postgres.js), adapted from the runner's `caps.db` client
 * (services/runner/src/worker-database.mjs `postgresClient`). One session per viewer (./sessions); on the wire:
 *
 *  1. Startup (once per session; sessions are shared): the TCP socket goes to the address ./network judged; TLS
 *     (verify-full, TLS 1.2+) unless the install allows `tls: 'disable'`; startup parameters `user` and `database`
 *     (the configured ones), `application_name=artifactbin`, `TimeZone=UTC`.
 *  2. Each query, on one session: the simple-protocol `begin read only`; one extended-protocol statement (Parse,
 *     Describe, Bind, Execute, Sync, unnamed)
 *     `select set_config('statement_timeout', $1, true), set_config('TimeZone', 'UTC', true), set_config('app.viewer_id', $2, true),
 *      set_config('app.viewer_email', $3, true), set_config('app.viewer_groups', $4, true)` and, for a namespace,
 *     `, set_config('search_path', $5, true)` (`$5` is `"<namespace>"`, quoted);
 *     then the reader's statement, extended protocol (one statement, values bound, never spliced), read by a cursor
 *     that stops one row past the limit; then `ROLLBACK`, which also undoes any session setting the statement made.
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
import { bindStatement, quoteIdentifier, readOnlyStatement } from './statement';
import type { ConnectorModule, InternalRead } from './module';

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
function cell(oid: number, value: unknown): ConnectorJson {
  if (value === null || value === undefined) return null;
  if (NUMBER.has(oid)) return numberValue(value);
  if (oid === TIMESTAMP || oid === TIMESTAMPTZ) return timestampValue(String(value), oid === TIMESTAMPTZ);
  if (oid === DATE) return String(value);
  return plainValue(value);
}
/** Postgres array types and anything parsed to an array are `json`. */
const columnType = (oid: number, sample: unknown): ConnectorValueType => Array.isArray(sample) ? 'json' : typeOf(oid);

const ROLLBACK = Symbol('rollback');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = postgres.Sql<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = postgres.TransactionSql<any>;

export const postgresConnector: ConnectorModule = {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams: NetworkSeams = {}) {
    const target = targetOf(config, policy);
    const secrets = connectionSecrets(config);
    let firstByte: number | undefined;
    const sessions = new SessionPool<Sql>({
      async open() {
        return postgres({
          host: target.host, port: target.port, database: String(config.database), username: String(config.user), password: typeof config.password === 'string' ? config.password : undefined,
          ssl: target.tls ? { ...target.tls, host: target.host, ...(isIP(target.host) ? {} : { servername: target.host }) } : false,
          // A server without TLS answers SSLRequest 'N' and postgres.js starts TLS anyway: that byte names the refusal.
          socket: async () => { const socket = await connectTarget(target, policy, seams); socket.once('data', (d: Buffer) => { firstByte = d[0]; }); return socket; },
          max: 1, connect_timeout: CONNECTOR_LIMITS.connectTimeoutMs / 1000, fetch_types: false, prepare: false,
          onnotice: () => {}, onparameter: () => {}, debug: false,
          connection: { application_name: 'artifactbin', TimeZone: 'UTC' },
          types: { rawTime: { to: 1082, from: [1082, 1083, 1114, 1184, 1266], serialize: String, parse: (text: string) => text } },
        } as unknown as postgres.Options<Record<string, postgres.PostgresType>>) as Sql;
      },
      close: (sql) => sql.end({ timeout: 1 }),
    });
    const fail = (error: unknown) => {
      if (target.tls && firstByte === 78 && !(error instanceof ConnectorFailure)) return new ConnectorFailure('tls_unsupported', 'the database server does not offer TLS; enable TLS on the server');
      return driverFailure(error, secrets);
    };

    /** One read in a read-only transaction, as above. `guarded` statements are the reader's: checked and bound. */
    async function run(query: ConnectorQuery, guarded: boolean): Promise<ConnectorAnswer> {
      if (guarded) readOnlyStatement('postgres', query.text);
      const bound = guarded ? bindStatement('postgres', query.text, query.params) : { text: query.text, values: Object.values(query.params) };
      const limits = limitsOf(query), viewer = viewerValues(query), namespace = checkedNamespace('postgres', query.namespace);
      return sessions.use(async (sql, discard) => {
        try {
          return await withinTime(limits.timeoutMs + 1000, query.signal, () => { discard(); void sql.end({ timeout: 0 }); }, async () => {
            let answer: ConnectorAnswer | undefined;
            await sql.begin('read only', async (tx: Tx) => {
              const values: string[] = [String(limits.timeoutMs), viewer.id, viewer.email, viewer.groups];
              let text = `select set_config('statement_timeout', $1, true), set_config('TimeZone', 'UTC', true), set_config('app.viewer_id', $2, true), set_config('app.viewer_email', $3, true), set_config('app.viewer_groups', $4, true)`;
              if (namespace) { values.push(quoteIdentifier('postgres', namespace)); text += `, set_config('search_path', $5, true)`; }
              await tx.unsafe(text, values, { simple: false } as never);
              let collector: Collector | undefined;
              let oids: number[] = [], names: string[] = [];
              const begin = (columns: readonly { name: string; type: number }[], sample?: Record<string, unknown>) => {
                oids = columns.map((c) => c.type); names = columns.map((c) => c.name);
                collector = new Collector(limits, uniqueColumns(columns.map((c) => ({ name: c.name, type: columnType(c.type, sample?.[c.name]) }))));
              };
              const result = await tx.unsafe(bound.text, bound.values as never[], { simple: false } as never).cursor(Math.min(500, limits.rows + 1), (rows: Record<string, unknown>[]) => {
                // Only the first batch carries the columns.
                if (!collector) begin((rows as unknown as { columns?: { name: string; type: number }[] }).columns ?? [], rows[0]);
                for (const row of rows) {
                  if (!collector!.add(Object.fromEntries(names.map((name, i) => [name, cell(oids[i]!, row[name])])))) return sql.CLOSE;
                }
                return undefined;
              });
              if (!collector) begin((result as unknown as { columns?: { name: string; type: number }[] }).columns ?? []);
              answer = collector!.answer();
              throw ROLLBACK;
            }).catch((e) => { if (e !== ROLLBACK) throw e; });
            return answer!;
          });
        } catch (error) {
          if (!(error instanceof ConnectorFailure) || error.code === 'timeout') discard();
          throw fail(error);
        }
      });
    }

    const read: InternalRead = (text, params, limits) => run({ text, params, viewer: null, limits }, false);
    return {
      connector: 'postgres', dialect: 'postgres',
      query: (q) => run(q, true),
      async schema(options = {}): Promise<ConnectorSchema> {
        const namespace = checkedNamespace('postgres', options.namespace);
        const answer = await read(`select n.nspname as ns, c.relname as name, c.relkind as kind, a.attname as col, a.atttypid::int as oid
          from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          where c.relkind in ('r','v','m','p','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg\\_%'
            and has_table_privilege(c.oid, 'SELECT')${namespace ? ' and n.nspname = $1' : ''}
          order by 1, 2, a.attnum`, namespace ? { ns: namespace } : {}, { rows: CONNECTOR_LIMITS.rows });
        return tablesOf(answer, (r) => ({ namespace: String(r.ns), name: String(r.name), kind: r.kind === 'v' || r.kind === 'm' ? 'view' : 'table', column: { name: String(r.col), type: typeOf(Number(r.oid)) } }));
      },
      async test() {
        const started = Date.now();
        try { await read('select 1 as ok', {}, { rows: 1 }); return { ok: true, latencyMs: Date.now() - started }; }
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

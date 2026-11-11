/**
 * THE MYSQL-PROTOCOL CONNECTOR (mysql2), adapted from the runner's `caps.db` client
 * (services/runner/src/worker-database.mjs `mysqlClient`). On the wire:
 *
 *  1. Handshake, once per session (sessions are shared by viewers, one database each): TCP to the address ./network
 *     judged; TLS (verify-full, TLS 1.2+, `ca` if configured) unless the install allows `tls: 'disable'`;
 *     HandshakeResponse41 with `user` (the configured account) and `database` (what followed `default:`, as written,
 *     else the configured database), LOCAL INFILE and multiple statements off, connection attribute
 *     `program_name=artifactbin`; the password as the server asks (caching_sha2_password full authentication inside
 *     TLS). Then, best effort (a server that refuses them still serves): `SET time_zone = '+00:00'` and
 *     `SET SESSION max_execution_time = <CONNECTOR_LIMITS.timeoutMs>`.
 *  2. Each query, `schema()` and `test()`, on one session, each a COM_QUERY of its own unless it binds values:
 *       `START TRANSACTION READ ONLY`
 *       `SET @app.viewer_id='<id>', @app.viewer_email='<email>', @app.viewer_groups='<groups>'` (text, literals:
 *          each `\` doubled and each `'` doubled, so the value stays one literal with or without NO_BACKSLASH_ESCAPES)
 *       the statement, one (prepared with `?` when it binds values, COM_QUERY otherwise; never escaped into the
 *          text), read row by row up to one past the limit (a stopped read closes the session)
 *       `COMMIT` (`ROLLBACK` after an error)
 *       `SET @app.viewer_id='', @app.viewer_email='', @app.viewer_groups=''`
 *
 * A database can use the viewer in a view only through a function (MySQL views refuse user variables), e.g.
 * `CREATE FUNCTION app_viewer_id() RETURNS VARCHAR(255) DETERMINISTIC RETURN @app_viewer_id`.
 */
import mysql from 'mysql2';
import type { Connection as MysqlConnection, FieldPacket } from 'mysql2';
import type { ConnectionConfig, ConnectorAnswer, ConnectorJson, ConnectorNetworkPolicy, ConnectorQuery, ConnectorSchema, ConnectorValueType } from '@artifactbin/contracts';
import { CONNECTOR_LIMITS } from '@artifactbin/contracts';
import { Collector, checkedNamespace, limitsOf, numberValue, plainValue, timestampValue, uniqueColumns, viewerValues, withinTime } from './answer';
import { connectionSecrets } from './config';
import { ConnectorFailure, driverFailure } from './errors';
import { connectTarget, targetOf, type NetworkSeams } from './network';
import { tablesOf, typeOfName } from './postgres';
import { SessionPool } from './sessions';
import { bindStatement, readOnlyStatement } from './statement';
import type { ConnectorModule } from './module';

const NUMBER = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]), DATE = new Set([10, 14]), DATETIME = 12, TIMESTAMP = 7, JSON_TYPE = 245, BIT = 16;
function typeOf(field: FieldPacket): ConnectorValueType {
  const t = field.columnType ?? -1;
  if (t === BIT && field.columnLength === 1) return 'boolean';
  if (NUMBER.has(t)) return 'number';
  if (DATE.has(t)) return 'date';
  if (t === DATETIME || t === TIMESTAMP) return 'timestamp';
  if (t === JSON_TYPE) return 'json';
  return 'text';
}
function cell(field: FieldPacket, type: ConnectorValueType, value: unknown): ConnectorJson {
  if (value === null || value === undefined) return null;
  if (type === 'boolean') return value instanceof Uint8Array ? value[0] === 1 : !!value;
  if (type === 'number') return numberValue(value);
  if (type === 'timestamp') return timestampValue(String(value), field.columnType === TIMESTAMP);
  if (type === 'date') return String(value);
  return plainValue(value);
}
/** A MySQL string literal for any value: `\\` and `'` doubled, so it stays one literal whether or not
 * NO_BACKSLASH_ESCAPES is on (with it, a backslash in the value arrives doubled: changed, never escaping). */
export const mysqlLiteral = (value: string) => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const viewerStatement = (v: { id: string; email: string; groups: string }) => `SET @app.viewer_id=${mysqlLiteral(v.id)}, @app.viewer_email=${mysqlLiteral(v.email)}, @app.viewer_groups=${mysqlLiteral(v.groups)}`;
const CLEARED = "SET @app.viewer_id='', @app.viewer_email='', @app.viewer_groups=''";

const call = <T = unknown>(c: MysqlConnection, text: string, values?: unknown[]) => new Promise<T>((resolve, reject) => {
  const done = (error: unknown, result: unknown) => (error ? reject(error) : resolve(result as T));
  if (values?.length) c.execute(text, values as never[], done); else c.query(text, done);
});

export const mysqlConnector: ConnectorModule = {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams: NetworkSeams = {}) {
    const target = targetOf(config, policy);
    const secrets = connectionSecrets(config);
    const sessions = new SessionPool<MysqlConnection>({
      async open(database) {
        const socket = await connectTarget(target, policy, seams);
        const connection = mysql.createConnection({
          host: target.host, port: target.port, database, user: String(config.user), password: typeof config.password === 'string' ? config.password : undefined,
          ssl: target.tls ? { ...target.tls, verifyIdentity: true } as never : undefined,
          stream: () => socket,
          flags: ['-LOCAL_FILES', '-MULTI_STATEMENTS'], multipleStatements: false,
          supportBigNumbers: true, bigNumberStrings: true, dateStrings: true, decimalNumbers: false,
          connectTimeout: CONNECTOR_LIMITS.connectTimeoutMs, maxPreparedStatements: 64, debug: false, disableEval: true,
          connectAttributes: { program_name: 'artifactbin' },
        } as never);
        connection.on('error', () => {});
        await new Promise<void>((resolve, reject) => connection.connect((error) => (error ? (connection.destroy(), reject(error)) : resolve())));
        for (const setting of ['SET time_zone = \'+00:00\'', `SET SESSION max_execution_time = ${CONNECTOR_LIMITS.timeoutMs}`]) await call(connection, setting).catch(() => undefined);
        return connection;
      },
      async close(connection) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => { connection.destroy(); resolve(); }, 1000);
          connection.end(() => { clearTimeout(timer); resolve(); });
        });
      },
    });

    async function run(query: ConnectorQuery, guarded: boolean): Promise<ConnectorAnswer> {
      if (guarded) readOnlyStatement('mysql', query.text);
      const bound = guarded ? bindStatement('mysql', query.text, query.params) : { text: query.text, values: Object.values(query.params) };
      const limits = limitsOf(query), viewer = viewerValues(query);
      const database = checkedNamespace('mysql', query.namespace) ?? String(config.database);
      let open = false;
      return sessions.use(database, async (c, dropSession) => {
        let gone = false;
        const discard = () => { gone = true; dropSession(); };
        try {
          return await withinTime(limits.timeoutMs + 1000, query.signal, () => { discard(); c.destroy(); }, async () => {
            await call(c, 'START TRANSACTION READ ONLY');
            open = true;
            await call(c, viewerStatement(viewer));
            const answer = await new Promise<ConnectorAnswer>((resolve, reject) => {
              let collector: Collector | undefined, fields: FieldPacket[] = [], types: ConnectorValueType[] = [], stopped = false;
              const start = (f: FieldPacket[]) => { fields = f ?? []; types = fields.map(typeOf); collector = new Collector(limits, uniqueColumns(fields.map((x, i) => ({ name: x.name, type: types[i]! })))); };
              const command = bound.values.length ? c.execute(bound.text, bound.values as never[]) : c.query(bound.text);
              command.on('fields', (f: FieldPacket[]) => start(f));
              command.on('result', (row: Record<string, unknown>) => {
                if (stopped) return;
                if (!collector) start([]);
                try {
                  if (!collector!.add(Object.fromEntries(fields.map((f, i) => [f.name, cell(f, types[i]!, row[f.name])])))) {
                    // Full: stop reading. mysql2 cannot cancel a result set, so the session is closed, never reused.
                    stopped = true; discard(); c.destroy(); resolve(collector!.answer());
                  }
                } catch (error) { stopped = true; discard(); c.destroy(); reject(error); }
              });
              command.on('error', (error: unknown) => { if (!stopped) reject(error); });
              command.on('end', () => { if (stopped) return; if (!collector) start([]); resolve(collector!.answer()); });
            });
            await call(c, 'COMMIT');
            open = false;
            return answer;
          });
        } catch (error) {
          if (!(error instanceof ConnectorFailure) || error.code === 'timeout') discard();
          throw driverFailure(error, secrets);
        } finally {
          // Back to the session's own state before anyone else's query: no transaction, no viewer, its database.
          if (!gone) {
            try {
              if (open) await call(c, 'ROLLBACK');
              await call(c, CLEARED);
            } catch { discard(); }
          }
        }
      });
    }

    return {
      connector: 'mysql', dialect: 'mysql',
      query: (q) => run(q, true),
      async schema(options): Promise<ConnectorSchema> {
        const answer = await run({ viewer: options.viewer, ...(options.namespace ? { namespace: options.namespace } : {}), ...(options.signal ? { signal: options.signal } : {}), limits: { rows: CONNECTOR_LIMITS.rows },
          text: `SELECT c.table_schema AS ns, c.table_name AS name, t.table_type AS kind, c.column_name AS col, c.data_type AS type
            FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema = DATABASE() ORDER BY c.table_name, c.ordinal_position`, params: {} }, false);
        return tablesOf(answer, (r) => ({ namespace: String(r.ns), name: String(r.name), kind: r.kind === 'VIEW' ? 'view' : 'table', column: { name: String(r.col), type: typeOfName(String(r.type)) } }));
      },
      async test(options) {
        const started = Date.now();
        try { await run({ text: 'SELECT 1 AS ok', params: {}, viewer: options.viewer, ...(options.namespace ? { namespace: options.namespace } : {}), limits: { rows: 1 } }, false); return { ok: true, latencyMs: Date.now() - started }; }
        catch (error) { const e = driverFailure(error, secrets); return { ok: false, error: { code: e.code, message: e.message } }; }
      },
      close: () => sessions.close(),
      sessions: () => sessions.count(),
    };
  },
};

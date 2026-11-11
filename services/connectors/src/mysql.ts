/**
 * THE MYSQL-PROTOCOL CONNECTOR (mysql2), adapted from the runner's `caps.db` client
 * (services/runner/src/worker-database.mjs `mysqlClient`). On the wire:
 *
 *  1. Handshake (once per session; sessions are shared): the TCP socket goes to the address ./network judged; TLS
 *     (verify-full, TLS 1.2+) unless the install allows `tls: 'disable'`; the configured user and database; LOCAL
 *     INFILE and multiple statements off; connection attribute `program_name=artifactbin`. Then
 *     `SET time_zone = '+00:00'`.
 *  2. Each query, on one session, each a statement of its own: `SET SESSION max_execution_time = <ms>`;
 *     `SET @app_viewer_id = ?, @app_viewer_email = ?, @app_viewer_groups = ?` (prepared, bound); for a namespace
 *     `USE \`<namespace>\``; `START TRANSACTION READ ONLY`; the reader's statement (prepared with `?` when it binds
 *     values, a text query otherwise; never escaped into the text), read row by row up to one past the limit;
 *     `ROLLBACK`; `SET @app_viewer_id = NULL, @app_viewer_email = NULL, @app_viewer_groups = NULL`; and after a
 *     namespace `USE` the configured database again. A stopped read or a failed statement closes the session.
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
import { tablesOf } from './postgres';
import { SessionPool } from './sessions';
import { bindStatement, quoteIdentifier, readOnlyStatement } from './statement';
import type { ConnectorModule, InternalRead } from './module';

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
/** By information_schema's DATA_TYPE (schema listing). */
function typeOfName(name: string): ConnectorValueType {
  const n = name.toLowerCase();
  if (['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint', 'decimal', 'numeric', 'float', 'double', 'real', 'year'].includes(n)) return 'number';
  if (n === 'date') return 'date';
  if (n === 'datetime' || n === 'timestamp') return 'timestamp';
  if (n === 'json') return 'json';
  if (n === 'bit') return 'boolean';
  return 'text';
}

const call = <T = unknown>(c: MysqlConnection, text: string, values?: unknown[]) => new Promise<T>((resolve, reject) => {
  const done = (error: unknown, result: unknown) => (error ? reject(error) : resolve(result as T));
  if (values?.length) c.execute(text, values as never[], done); else c.query(text, done);
});

export const mysqlConnector: ConnectorModule = {
  open(config: ConnectionConfig, policy: ConnectorNetworkPolicy, seams: NetworkSeams = {}) {
    const target = targetOf(config, policy);
    const secrets = connectionSecrets(config);
    const database = String(config.database);
    const sessions = new SessionPool<MysqlConnection>({
      async open() {
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
        await call(connection, 'SET time_zone = \'+00:00\'');
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
      const limits = limitsOf(query), viewer = viewerValues(query), namespace = checkedNamespace('mysql', query.namespace);
      return sessions.use(async (c, dropSession) => {
        let gone = false;
        const discard = () => { gone = true; dropSession(); };
        try {
          return await withinTime(limits.timeoutMs + 1000, query.signal, () => { discard(); c.destroy(); }, async () => {
            await call(c, `SET SESSION max_execution_time = ${Math.floor(limits.timeoutMs)}`);
            await call(c, 'SET @app_viewer_id = ?, @app_viewer_email = ?, @app_viewer_groups = ?', [viewer.id, viewer.email, viewer.groups]);
            if (namespace) await call(c, `USE ${quoteIdentifier('mysql', namespace)}`);
            await call(c, 'START TRANSACTION READ ONLY');
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
            return answer;
          });
        } catch (error) {
          if (!(error instanceof ConnectorFailure) || error.code === 'timeout') discard();
          throw driverFailure(error, secrets);
        } finally {
          // Back to the session's own state before anyone else's query: no transaction, no viewer, its database.
          if (!gone) {
            try {
              await call(c, 'ROLLBACK');
              await call(c, 'SET @app_viewer_id = NULL, @app_viewer_email = NULL, @app_viewer_groups = NULL');
              if (namespace) await call(c, `USE ${quoteIdentifier('mysql', database)}`);
            } catch { discard(); }
          }
        }
      });
    }

    const read: InternalRead = (text, params, limits) => run({ text, params, viewer: null, limits }, false);
    return {
      connector: 'mysql', dialect: 'mysql',
      query: (q) => run(q, true),
      async schema(options = {}): Promise<ConnectorSchema> {
        const namespace = checkedNamespace('mysql', options.namespace);
        const answer = await read(`select c.table_schema as ns, c.table_name as name, t.table_type as kind, c.column_name as col, c.data_type as type
          from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema not in ('mysql', 'information_schema', 'performance_schema', 'sys')${namespace ? ' and c.table_schema = ?' : ''}
          order by c.table_schema, c.table_name, c.ordinal_position`, namespace ? { ns: namespace } : {}, { rows: CONNECTOR_LIMITS.rows });
        return tablesOf(answer, (r) => ({ namespace: String(r.ns), name: String(r.name), kind: r.kind === 'VIEW' ? 'view' : 'table', column: { name: String(r.col), type: typeOfName(String(r.type)) } }));
      },
      async test() {
        const started = Date.now();
        try { await read('select 1 as ok', {}, { rows: 1 }); return { ok: true, latencyMs: Date.now() - started }; }
        catch (error) { const e = driverFailure(error, secrets); return { ok: false, error: { code: e.code, message: e.message } }; }
      },
      close: () => sessions.close(),
      sessions: () => sessions.count(),
    };
  },
};

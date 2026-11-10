/**
 * `@afbin/offline-sql`: AN EXPORTED PAGE'S `sql`, answered in the file. A downloaded copy has no app to relay to, so
 * `sql` (./browser-client) imports this module, embedded only in an export that carries its reader's rows
 * (`<script data-af="offline-data">`, lib/dataset-access offlinePageSqlData), and runs each statement here: the
 * server's own SQLite engine (`@artifactbin/sql/core`, its wasm inlined), on the main thread, over those tables only.
 *
 * Nothing here touches the network: the wasm comes from this module's bytes and the tables from the document. The
 * answer has the page SQL door's shape (`{columns, rows}`, or `{error, message}`), with the door's read rules: one
 * statement, every `$name` bound, at most SQL_READ_LIMITS.rows rows. The copy is read-only, as an archived page is:
 * a write is refused, never applied to the embedded rows.
 *
 * Never imported by a hosted page or the reader: the engine is large, and only an export carries it (build.test).
 */
import { SQL_READ_LIMITS, isQueryFailure, type ColumnType, type Row, type RunInput } from '@artifactbin/contracts';
import { loadSqlite, PreparedCache, type SqliteEngine } from '@artifactbin/sql/core';

/** The engine's `sqlite3.wasm`, base64, defined by the build (build.server): a copy cannot fetch it. */
declare const __AF_SQLITE_WASM__: string;

interface OfflineTable { schema: string; name: string; columns: Array<{ name: string; type: ColumnType }>; rows: Row[] }
type Reply = { columns: Array<{ name: string; type: string }>; rows: Row[] } | { error: string; message: string };

let ready: Promise<{ engine: SqliteEngine; tables: OfflineTable[] }> | undefined;
// One database for the file's tables, built on the first read and kept: the rows never change in a copy.
const prepared = new PreparedCache();

function embedded(): OfflineTable[] {
  const block = document.querySelector('script[data-af="offline-data"]');
  const data = block?.textContent ? JSON.parse(block.textContent) as { tables?: unknown } : {};
  return Array.isArray(data.tables) ? data.tables as OfflineTable[] : [];
}

export async function runOfflineSql(request: { sql: string; params: Record<string, string | number | boolean | null> }): Promise<Reply> {
  const { engine, tables } = await (ready ??= loadSqlite(Uint8Array.from(atob(__AF_SQLITE_WASM__), (c) => c.charCodeAt(0))).then((engine) => ({ engine, tables: embedded() }), (error: unknown) => { ready = undefined; throw error; }));
  if (!tables.length) return { error: 'unavailable', message: 'this copy carries no data for sql; open the original page' };
  let analysis;
  try { analysis = engine.analyze(request.sql, tables.map((t) => ({ schema: t.schema, table: t.name, columns: t.columns }))); }
  catch (e) { return { error: 'validation_failed', message: e instanceof Error ? e.message : 'the statement was refused' }; }
  if (analysis.kind !== 'select') return { error: 'permission_denied', message: 'this copy is read-only: it reads, it never writes' };
  const missing = analysis.params.find((name) => !Object.hasOwn(request.params, name));
  if (missing) return { error: 'validation_failed', message: `Dataset SQL: undeclared parameter $${missing}` };
  const input: RunInput = {
    catalog: { defaultSchema: 'main', tables: tables.map((t, i) => ({ schema: t.schema, name: t.name, columns: t.columns, source: `offline_${i}`, key: `offline_${i}` })) },
    tables: Object.fromEntries(tables.map((t, i) => [`offline_${i}`, { rows: t.rows, columns: t.columns }])),
    queries: [{ name: 'result', sql: request.sql }],
    params: request.params,
  };
  const limit = SQL_READ_LIMITS.rows;
  const result = engine.run(input, { limit, pageLimit: limit, timeoutMs: SQL_READ_LIMITS.timeoutMs }, prepared).result;
  if (!result) return { error: 'unexpected', message: 'the statement answered nothing' };
  if (isQueryFailure(result)) return { error: result.timedOut ? 'timeout' : 'validation_failed', message: result.error };
  if (result.truncated) return { error: 'result_too_large', message: `a result is at most ${limit} rows; aggregate or filter in SQL` };
  return { columns: result.columns.map((c) => ({ name: c.name, type: c.type })), rows: result.rows };
}

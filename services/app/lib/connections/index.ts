/**
 * THE INSTALL'S DEFAULT CONNECTION (`DATASETS__DEFAULT_CONNECTION`, lib/platform): one connector configuration
 * (`@artifactbin/connectors`), optionally an envelope of named connectors (`default:alias:database`), open to every signed-in person, read-only, with no artifact, owner or sharing.
 * Server-only. The connectors run here, in the app's server process, which already holds the install's secrets;
 * the SQL service stays credential-free and network-free by design.
 *
 * THE SECRET stays in this module: boot validation names the setting, never the value; the status a person sees is
 * contracts `ConnectionSummary` (the connector and its `shown` fields); every error is the connector's own, with the
 * configuration's secrets removed.
 *
 * A PAGE reads it through the page SQL door (`pageConnectionSql`, lib/page-doors), after the door decided the reader
 * may read the page. THE NAME RULE: a page links it as `<link rel="af-dataset" data-af-name="NAME" href="default:DB">`,
 * and a statement names it as a qualifier, `NAME.table` (`NAME.schema.table` on Postgres). Such a statement runs WHOLLY
 * on the connection: the link selects the database the session opens (DB, passed through as written; empty: the
 * configured one) and each `NAME.` qualifier is removed, the rest of the text passed through in the database's own
 * dialect, every `${…}` a bound value. One statement may name several default-connection links of the same DB;
 * links of different DBs, or a stored dataset link too, are refused (one source per statement). Anonymous readers
 * are refused, as is a statement when the install has no default connection.
 *
 * AN AGENT reads it at `/api/default-connection/{schema,sql}` as its signed-in account (`agentConnectionSql`), its
 * statement passed through unchanged with an optional namespace.
 */
import { CONNECTORS, SQL_READ_LIMITS, type ConnectionSummary, type ConnectorDialect, type ConnectorError, type ConnectorSchema, type ConnectorTestResult, type ConnectorViewer, type HtmlPageLink, type Scalar } from '@artifactbin/contracts';
import { ConnectorFailure, checkedNamespace, connectionSummary, connectorError, leadingWords, mapQualifiers, openConnection, parseConnectionConfig, qualifierNames, type OpenConnection } from '@artifactbin/connectors';
import { getUserById, type AccessActor } from '@/lib/accounts';
import { listGroups } from '@/lib/groups';
import { datasetsAllowPrivateNetwork, defaultConnectionSetting } from '@/lib/platform';

const SETTING = 'DATASETS__DEFAULT_CONNECTION';
interface ConfiguredConnection { connection: OpenConnection; summary: ConnectionSummary; dialect: ConnectorDialect }
let current: { text: string; fallback: ConfiguredConnection; named: Map<string, ConfiguredConnection>; routed: boolean } | null = null;
const closeConfigured = async (c: typeof current) => {
  if (c) await Promise.all([c.fallback, ...c.named.values()].map(v => v.connection.close()));
};

/** A single connector or {default: connector, connections: {alias: connector}}. Aliases select with alias:database.
 * The envelope is explicit: legacy database names, including colons, remain untouched for a single connector.
 * All configurations are validated at boot and only sanitized summaries ever leave this module. */
function configured(): typeof current {
  const text = defaultConnectionSetting();
  if (!text) { void closeConfigured(current); current = null; return null; }
  if (current?.text === text) return current;
  const opened: ConfiguredConnection[] = [];
  try {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error('the configuration is not JSON'); }
    const envelope = raw && typeof raw === 'object' && !Array.isArray(raw) && 'default' in raw;
    const record = raw as Record<string, unknown>;
    if (envelope && Object.keys(record).some(k => k !== 'default' && k !== 'connections')) throw new Error('unknown routing configuration field');
    const open = (value: unknown): ConfiguredConnection => {
      const config = parseConnectionConfig(value);
      const item = {
        connection: openConnection(config, { allowPrivateNetwork: datasetsAllowPrivateNetwork() }),
        summary: connectionSummary(config), dialect: CONNECTORS.find(c => c.id === config.connector)!.dialect,
      };
      opened.push(item);
      return item;
    };
    const fallback = open(envelope ? record.default : raw), named = new Map<string, ConfiguredConnection>();
    if (envelope) {
      const entries = record.connections;
      if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 16) throw new Error('connections must be an object of at most 16 named connectors');
      for (const [name, value] of Object.entries(entries)) {
        if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) throw new Error('connection aliases must be lowercase names of at most 32 characters');
        named.set(name, open(value));
      }
    }
    void closeConfigured(current);
    current = { text, fallback, named, routed: !!envelope };
    return current;
  } catch (e) {
    for (const item of opened) void item.connection.close();
    throw new Error(`${SETTING} is not a valid connection: ${connectorError(e).message}`);
  }
}
function selected(namespace?: string): (ConfiguredConnection & { namespace?: string }) | null {
  const c = configured();
  if (!c) return null;
  if (c.routed && namespace?.includes(':')) {
    const at = namespace.indexOf(':'), alias = namespace.slice(0, at), target = c.named.get(alias);
    if (!target) throw new ConnectorFailure('invalid_query', 'unknown named default connection');
    return { ...target, namespace: namespace.slice(at + 1) || undefined };
  }
  return { ...c.fallback, namespace };
}

/** Run at boot (lib/deployment): a bad value stops the start, naming the setting. Opens no socket. */
export function validateDefaultConnection(): void { datasetsAllowPrivateNetwork(); configured(); }

/** What the settings page shows: whether there is one, its connector and shown fields (host, port, database). */
export function defaultConnectionStatus(): { configured: false } | ({ configured: true; connections?: Record<string, ConnectionSummary> } & ConnectionSummary) {
  const c = configured();
  return c ? { configured: true, ...c.fallback.summary, ...(c.routed ? { connections: Object.fromEntries([...c.named].map(([name, v]) => [name, v.summary])) } : {}) } : { configured: false };
}
export const hasDefaultConnection = (): boolean => !!defaultConnectionSetting();

/** "Test connection", run as the signed-in person who asked (a gateway answers nothing for nobody). */
export async function testDefaultConnection(actor: AccessActor & { userId: string }): Promise<ConnectorTestResult> {
  const c = configured();
  return c ? c.fallback.connection.test({ viewer: await viewerOf(actor) }) : { ok: false, error: { code: 'unavailable', message: 'this install has no default connection' } };
}

/** Closes the connection's sessions (process shutdown, tests). */
export async function closeDefaultConnection(): Promise<void> { const c = current; current = null; await closeConfigured(c); }

/** The person a query runs for: the account, its email and its groups' IDs, read now; nobody (null) without an account. */
export async function connectorViewer(actor: AccessActor): Promise<ConnectorViewer | null> { return actor.userId ? viewerOf(actor) : null; }
async function viewerOf(actor: AccessActor): Promise<ConnectorViewer> {
  const user = await getUserById(actor.userId!);
  const groups = (await listGroups(actor.userId!)).map((g) => g.id);
  return { id: actor.userId!, email: (user as { email?: string | null } | null)?.email ?? actor.email ?? null, groups };
}

export interface ConnectionSqlReply { status: number; body: Record<string, unknown> }
const reply = (status: number, error: string, message: string): ConnectionSqlReply => ({ status, body: { error, message } });

/** A connector error as the page SQL door's codes (the page's `SqlError`): the same codes stored datasets answer. */
function refused(e: ConnectorError): ConnectionSqlReply {
  switch (e.code) {
    case 'invalid_query': case 'database_error': return reply(400, 'validation_failed', e.message);
    case 'read_only': return reply(403, 'permission_denied', `the default connection is read-only: ${e.message}`);
    // The database refused this person: its own message (which says, for one, which database to name instead).
    case 'permission_denied': return reply(403, 'permission_denied', e.message);
    case 'timeout': return reply(408, 'timeout', e.message);
    case 'result_too_large': return reply(413, 'result_too_large', e.message);
    default: return reply(503, 'dataset_not_found', `the default connection is unavailable (${e.code}): ${e.message}`);
  }
}

async function run(actor: AccessActor, text: string, params: Readonly<Record<string, Scalar>>, namespace: string | undefined, signal: AbortSignal): Promise<ConnectionSqlReply> {
  try {
    const c = selected(namespace);
    if (!c) return reply(404, 'dataset_not_found', 'this install has no default connection');
    const answer = await c.connection.query({ text, params, viewer: await viewerOf(actor), ...(c.namespace ? { namespace: c.namespace } : {}), limits: { rows: SQL_READ_LIMITS.rows }, signal });
    return { status: 200, body: { columns: answer.columns, rows: answer.rows, ...(answer.truncated ? { truncated: true } : {}) } };
  } catch (e) {
    if (e instanceof ConnectorFailure) return refused(connectorError(e));
    throw e;
  }
}

function checkedCall(raw: { sql?: unknown; params?: unknown }): { sql: string; params: Record<string, Scalar> } | ConnectionSqlReply {
  const { sql, params = {} } = raw;
  if (typeof sql !== 'string' || !sql.trim()) return reply(400, 'validation_failed', 'sql takes one SQL statement');
  if (!params || typeof params !== 'object' || Array.isArray(params)) return reply(400, 'validation_failed', 'params must be an object of scalars');
  return { sql, params: params as Record<string, Scalar> };
}

/**
 * A page statement that names one of the page's default-connection links, answered here; null when it names none
 * (the stored-dataset door answers it). `actor` is the reader the page door already admitted to the page.
 */
export async function pageConnectionSql(actor: AccessActor, links: readonly HtmlPageLink[], raw: { sql?: unknown; params?: unknown }, signal: AbortSignal): Promise<ConnectionSqlReply | null> {
  const defaults = links.filter((l): l is Extract<HtmlPageLink, { kind: 'default-connection' }> => l.kind === 'default-connection');
  if (!defaults.length || typeof raw.sql !== 'string') return null;
  let dialect: ConnectorDialect = configured()?.fallback.dialect ?? 'postgres';
  const statement = raw.sql;
  let named = new Set<string>(), words = new Set<string>();
  // A statement the dialect cannot even read (an unclosed quote) names nothing here: the stored-dataset door refuses it.
  try { named = qualifierNames(dialect, raw.sql); words = leadingWords(dialect, raw.sql); } catch { /* A named connector may use a different dialect; try it below. */ }
  const used = defaults.filter(l => {
    try { return qualifierNames(selected(l.namespace)?.dialect ?? dialect, statement).has(l.name.toLowerCase()); }
    catch { return named.has(l.name.toLowerCase()); }
  });
  if (!used.length) return null;
  try { words = leadingWords(selected(used[0]!.namespace)?.dialect ?? dialect, raw.sql); } catch { /* selection errors are returned after access checks below */ }
  const stored = links.find((l) => (l.kind === 'dataset' || l.kind === 'live-dataset') && words.has(l.name.toLowerCase()));
  if (stored) return reply(400, 'validation_failed', `a statement reads one source: ${used[0]!.name} is the install's default connection and ${stored.name} ${stored.kind === 'dataset' ? 'a stored dataset' : 'a live dataset'}; query them separately`);
  if (!actor.userId) return reply(403, 'permission_denied', `sign in to read ${used[0]!.name}: the default connection answers signed-in people only`);
  const call = checkedCall(raw);
  if ('status' in call) return call;
  if (!configured()) return reply(404, 'dataset_not_found', `${used[0]!.name} reads the install's default connection, and this install has none`);
  const databases = [...new Set(used.map((l) => l.namespace))];
  if (databases.length > 1) return reply(400, 'validation_failed', `a statement reads one database: ${used.map((l) => `${l.name} is default:${l.namespace}`).join(', ')}; query them separately`);
  try {
    const target = selected(databases[0]);
    dialect = target?.dialect ?? dialect;
    checkedNamespace(dialect, target?.namespace);
  } catch (e) { return refused(connectorError(e)); }
  let text: string;
  try { text = mapQualifiers(dialect, call.sql, new Map(used.map((l) => [l.name.toLowerCase(), '']))); } catch (e) { return refused(connectorError(e)); }
  return run(actor, text, call.params, databases[0] || undefined, signal);
}

/** An agent's statement, as its signed-in account, passed through; `namespace` (what follows `default:`) the database. */
export async function agentConnectionSql(actor: AccessActor, raw: { sql?: unknown; params?: unknown; namespace?: unknown }, signal: AbortSignal): Promise<ConnectionSqlReply> {
  if (!actor.userId) return reply(403, 'permission_denied', 'sign in to read the default connection');
  const call = checkedCall(raw);
  if ('status' in call) return call;
  if (raw.namespace !== undefined && typeof raw.namespace !== 'string') return reply(400, 'validation_failed', 'namespace is what follows default:, a database name');
  return run(actor, call.sql, call.params, (raw.namespace as string | undefined) || undefined, signal);
}

/** The tables and columns a signed-in person can read in `namespace`'s database (absent: the configured one). */
export async function defaultConnectionSchema(actor: AccessActor, namespace: string | undefined, signal: AbortSignal): Promise<ConnectionSqlReply> {
  if (!actor.userId) return reply(403, 'permission_denied', 'sign in to read the default connection');
  try {
    const c = selected(namespace);
    if (!c) return reply(404, 'dataset_not_found', 'this install has no default connection');
    const schema: ConnectorSchema = await c.connection.schema({ viewer: await viewerOf(actor), ...(c.namespace ? { namespace: c.namespace } : {}), signal });
    return { status: 200, body: { connector: c.summary.connector, ...schema } };
  } catch (e) {
    if (e instanceof ConnectorFailure) return refused(connectorError(e));
    throw e;
  }
}

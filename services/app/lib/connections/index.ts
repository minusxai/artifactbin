/**
 * THE INSTALL'S DEFAULT CONNECTION (`DATASETS__DEFAULT_CONNECTION`, lib/platform): one connector configuration
 * (`@artifactbin/connectors`), open to every signed-in person, read-only, with no artifact, owner or sharing.
 * Server-only. The connectors run here, in the app's server process, which already holds the install's secrets;
 * the SQL service stays credential-free and network-free by design.
 *
 * THE SECRET stays in this module: boot validation names the setting, never the value; the status a person sees is
 * contracts `ConnectionSummary` (the connector and its `shown` fields); every error is the connector's own, with the
 * configuration's secrets removed.
 *
 * A PAGE reads it through the page SQL door (`pageConnectionSql`, lib/page-doors), after the door decided the reader
 * may read the page. THE NAME RULE: a page links it as `<link rel="af-dataset" data-af-name="NAME" href="default:NS">`,
 * and a statement names it as a qualifier, `NAME.table`. Such a statement runs WHOLLY on the connection, its text
 * passed through in the database's own dialect except that each `NAME.` becomes the link's namespace, quoted
 * (`"NS".table`), or is removed when the link names none (`default:`; the connection's own default schema). Every
 * `${…}` stays a bound value. One statement may name several default-connection links (one source); naming a stored
 * dataset link too is refused (no joins across sources). Anonymous readers are refused, as is a statement when the
 * install has no default connection.
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
let current: { text: string; connection: OpenConnection; summary: ConnectionSummary; dialect: ConnectorDialect } | null = null;

/** Parses the setting; a refusal names the setting and the connector's reason, never the value. */
function configured(): typeof current {
  const text = defaultConnectionSetting();
  if (!text) { void current?.connection.close(); current = null; return null; }
  if (current?.text === text) return current;
  let config;
  try { config = parseConnectionConfig(text); } catch (e) { throw new Error(`${SETTING} is not a valid connection: ${connectorError(e).message}`); }
  let connection: OpenConnection;
  try { connection = openConnection(config, { allowPrivateNetwork: datasetsAllowPrivateNetwork() }); } catch (e) { throw new Error(`${SETTING} is not a valid connection: ${connectorError(e).message}`); }
  void current?.connection.close();
  current = { text, connection, summary: connectionSummary(config), dialect: CONNECTORS.find((c) => c.id === config.connector)!.dialect };
  return current;
}

/** Run at boot (lib/deployment): a bad value stops the start, naming the setting. Opens no socket. */
export function validateDefaultConnection(): void { datasetsAllowPrivateNetwork(); configured(); }

/** What the settings page shows: whether there is one, its connector and shown fields (host, port, database). */
export function defaultConnectionStatus(): { configured: false } | ({ configured: true } & ConnectionSummary) {
  const c = configured();
  return c ? { configured: true, ...c.summary } : { configured: false };
}
export const hasDefaultConnection = (): boolean => !!defaultConnectionSetting();

export async function testDefaultConnection(): Promise<ConnectorTestResult> {
  const c = configured();
  return c ? c.connection.test() : { ok: false, error: { code: 'unavailable', message: 'this install has no default connection' } };
}

/** Closes the connection's sessions (process shutdown, tests). */
export async function closeDefaultConnection(): Promise<void> { const c = current; current = null; await c?.connection.close(); }

/** The person a query runs for: the account, its email and its groups' IDs, read now. */
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
    case 'timeout': return reply(408, 'timeout', e.message);
    case 'result_too_large': return reply(413, 'result_too_large', e.message);
    default: return reply(503, 'dataset_not_found', `the default connection is unavailable (${e.code}): ${e.message}`);
  }
}

async function run(actor: AccessActor, text: string, params: Readonly<Record<string, Scalar>>, namespace: string | undefined, signal: AbortSignal): Promise<ConnectionSqlReply> {
  const c = configured();
  if (!c) return reply(404, 'dataset_not_found', 'this install has no default connection');
  try {
    const answer = await c.connection.query({ text, params, viewer: await viewerOf(actor), ...(namespace ? { namespace } : {}), limits: { rows: SQL_READ_LIMITS.rows }, signal });
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
  const dialect = configured()?.dialect ?? 'postgres';
  let named: Set<string>, words: Set<string>;
  // A statement the dialect cannot even read (an unclosed quote) names nothing here: the stored-dataset door refuses it.
  try { named = qualifierNames(dialect, raw.sql); words = leadingWords(dialect, raw.sql); } catch { return null; }
  const used = defaults.filter((l) => named.has(l.name.toLowerCase()));
  if (!used.length) return null;
  const stored = links.find((l) => (l.kind === 'dataset') && words.has(l.name.toLowerCase()));
  if (stored) return reply(400, 'validation_failed', `a statement reads one source: ${used[0]!.name} is the install's default connection and ${stored.name} a stored dataset; query them separately`);
  if (!actor.userId) return reply(403, 'permission_denied', `sign in to read ${used[0]!.name}: the default connection answers signed-in people only`);
  const call = checkedCall(raw);
  if ('status' in call) return call;
  if (!configured()) return reply(404, 'dataset_not_found', `${used[0]!.name} reads the install's default connection, and this install has none`);
  for (const l of used) try { checkedNamespace(dialect, l.namespace); } catch (e) { return refused(connectorError(e)); }
  let text: string;
  try { text = mapQualifiers(dialect, call.sql, new Map(used.map((l) => [l.name.toLowerCase(), l.namespace]))); } catch (e) { return refused(connectorError(e)); }
  return run(actor, text, call.params, undefined, signal);
}

/** An agent's statement, as its signed-in account, passed through; `namespace` selects the schema. */
export async function agentConnectionSql(actor: AccessActor, raw: { sql?: unknown; params?: unknown; namespace?: unknown }, signal: AbortSignal): Promise<ConnectionSqlReply> {
  if (!actor.userId) return reply(403, 'permission_denied', 'sign in to read the default connection');
  const call = checkedCall(raw);
  if ('status' in call) return call;
  if (raw.namespace !== undefined && typeof raw.namespace !== 'string') return reply(400, 'validation_failed', 'namespace is a schema name');
  return run(actor, call.sql, call.params, (raw.namespace as string | undefined) || undefined, signal);
}

/** The tables and columns the connection's account can read (in `namespace`), for a signed-in person. */
export async function defaultConnectionSchema(actor: AccessActor, namespace: string | undefined, signal: AbortSignal): Promise<ConnectionSqlReply> {
  if (!actor.userId) return reply(403, 'permission_denied', 'sign in to read the default connection');
  const c = configured();
  if (!c) return reply(404, 'dataset_not_found', 'this install has no default connection');
  try {
    const schema: ConnectorSchema = await c.connection.schema({ ...(namespace ? { namespace } : {}), signal });
    return { status: 200, body: { connector: c.summary.connector, ...schema } };
  } catch (e) {
    if (e instanceof ConnectorFailure) return refused(connectorError(e));
    throw e;
  }
}

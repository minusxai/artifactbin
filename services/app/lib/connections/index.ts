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
 * A DECLARED QUERY on a default-connection link (`runDeclaredConnectionQuery`) runs as whom the page door chose: the
 * reader, or the page's group where an approval holds (lib/query-approvals).
 *
 * AN AGENT reads it at `/api/default-connection/{schema,sql}` as its signed-in account (`agentConnectionSql`), its
 * statement passed through unchanged with an optional namespace.
 */
import {readLifetime} from '@/lib/datasets';
import { SQL_FAILURE_FOR_CONNECTOR, liveSource, sqlReadFailure, type SqlFailureCode } from '@artifactbin/contracts';
import { CONNECTORS, SQL_READ_LIMITS, type ConnectionSummary, type ConnectorDialect, type ConnectorError, type ConnectorSchema, type ConnectorTestResult, type ConnectorViewer, type HtmlDeclaredQuery, type HtmlDefaultConnectionLink, type HtmlPageLink, type HtmlPageVersion, type Scalar } from '@artifactbin/contracts';
import { ConnectorFailure, checkedNamespace, colonParameters, connectionSummary, connectorError, leadingWords, mapQualifiers, openConnection, parseConnectionConfig, qualifierNames, type OpenConnection } from '@artifactbin/connectors';
import { getUserById, type AccessActor } from '@/lib/accounts';
import { listGroups } from '@/lib/groups';
import { QUERY_TIMEOUT_MS,datasetsAllowPrivateNetwork, defaultConnectionSetting } from '@/lib/platform';

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
        connection: openConnection(config, { allowPrivateNetwork: datasetsAllowPrivateNetwork() },undefined,{queryTimeoutMs:QUERY_TIMEOUT_MS}),
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

/**
 * Who a query runs for: the account, its email and its groups' IDs, read now; for a group's sign-in (lib/accounts
 * `GroupPrincipal`) no person, exactly its group and its level (contracts connectors `ConnectorViewer`); nobody
 * (null) otherwise.
 */
export async function connectorViewer(actor: AccessActor): Promise<ConnectorViewer | null> { return actor.userId || actor.principalGroup ? viewerOf(actor) : null; }
/** Whom the default connection answers: a signed-in person, or a group's sign-in. */
const reader = (actor: AccessActor): boolean => !!actor.userId || !!actor.principalGroup;
/** An agent signed in as `groupId` at `role` as a database sees it: no person, exactly that group, its level. */
export const groupViewer = (groupId: string, role: 'member' | 'editor'): ConnectorViewer => ({ id: '', email: null, groups: [groupId], groupRole: role });
async function viewerOf(actor: AccessActor): Promise<ConnectorViewer> {
  if (actor.principalGroup) return groupViewer(actor.principalGroup.id, actor.principalGroup.role);
  const user = await getUserById(actor.userId!);
  const groups = (await listGroups(actor.userId!)).map((g) => g.id);
  return { id: actor.userId!, email: (user as { email?: string | null } | null)?.email ?? actor.email ?? null, groups, groupRole: '' };
}

/** The reader values a declared query binds, filled by the server for every run; a caller never sends one. */
export const VIEWER_PARAMS = ['viewer_id', 'viewer_email', 'viewer_groups', 'viewer_group_role'] as const;
/**
 * Those values for `viewer`: a person's exactly as ever (`??`: an empty address stays empty); a group's sign-in (a
 * level) is no person; nobody (null) all null.
 */
export function viewerParams(viewer: ConnectorViewer | null): Record<(typeof VIEWER_PARAMS)[number], string | null> {
  return { viewer_id: viewer?.groupRole ? null : viewer?.id ?? null, viewer_email: viewer?.groupRole ? null : viewer?.email ?? null,
    viewer_groups: viewer ? JSON.stringify([...viewer.groups].sort()) : null, viewer_group_role: viewer ? viewer.groupRole ?? '' : null };
}

export interface ConnectionSqlReply { status: number; body: Record<string, unknown> }
/** An agent door's anonymous caller, as these doors have always answered it. */
const AGENT_SIGN_IN: ConnectionSqlReply = { status: 403, body: { error: 'permission_denied', message: 'sign in to read the default connection' } };
/** Every refusal here is of a read (contracts sql-failures): its code, reason and the reader's sentence. */
const reply = (error: SqlFailureCode, message: string): ConnectionSqlReply => sqlReadFailure(error, message);

/**
 * A connector error as the page SQL door's codes (contracts `SQL_FAILURE_FOR_CONNECTOR`): the same codes stored
 * datasets answer. The database's own refusal of this person is `permission_denied`, its message saying why (for one,
 * which database to name instead); a refused write is the write's refusal, with no sentence for a reader.
 */
function refused(e: ConnectorError): ConnectionSqlReply {
  const code = SQL_FAILURE_FOR_CONNECTOR[e.code];
  if (e.code === 'read_only') return { status: 403, body: { error: code, message: `the default connection is read-only: ${e.message}` } };
  return reply(code, code === 'unavailable' || e.code === 'invalid_config' ? `the default connection is unavailable (${e.code}): ${e.message}` : e.message);
}

async function run(reader: AccessActor | ConnectorViewer, text: string, params: Readonly<Record<string, Scalar>>, namespace: string | undefined, signal: AbortSignal): Promise<ConnectionSqlReply> {
  const life=readLifetime(signal);
  try {
    const c = selected(namespace);
    if (!c) return reply('dataset_not_found', 'this install has no default connection');
    const answer = await c.connection.query({ text, params, viewer: 'groups' in reader ? reader : await life.step(viewerOf(reader)), ...(c.namespace ? { namespace: c.namespace } : {}), limits: { rows: SQL_READ_LIMITS.rows }, signal:life.signal });
    life.check();
    return { status: 200, body: { columns: answer.columns, rows: answer.rows, ...(answer.truncated ? { truncated: true } : {}), source: liveSource() } };
  } catch (e) {
    if (e instanceof ConnectorFailure) return refused(connectorError(e));
    throw e;
  }finally{life.close();}
}

function checkedCall(raw: { sql?: unknown; params?: unknown }): { sql: string; params: Record<string, Scalar> } | ConnectionSqlReply {
  const { sql, params = {} } = raw;
  if (typeof sql !== 'string' || !sql.trim()) return reply('validation_failed', 'sql takes one SQL statement');
  if (!params || typeof params !== 'object' || Array.isArray(params)) return reply('validation_failed', 'params must be an object of scalars');
  return { sql, params: params as Record<string, Scalar> };
}

/**
 * A page statement that names one of the page's default-connection links, answered here; null when it names none
 * (the stored-dataset door answers it). `actor` is the reader the page door already admitted to the page.
 */
export async function pageConnectionSql(actor: AccessActor, links: readonly HtmlPageLink[], raw: { sql?: unknown; params?: unknown }, signal: AbortSignal, admission?:{step<T>(pending:Promise<T>):Promise<T>;dispatch(read:boolean):AbortSignal}): Promise<ConnectionSqlReply | null> {
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
  if (stored) return reply('validation_failed', `a statement reads one source: ${used[0]!.name} is the install's default connection and ${stored.name} ${stored.kind === 'dataset' ? 'a stored dataset' : 'a live dataset'}; query them separately`);
  if (!reader(actor)) return reply('sign_in_required', `sign in to read ${used[0]!.name}: the default connection answers signed-in people only`);
  const call = checkedCall(raw);
  if ('status' in call) return call;
  if (!configured()) return reply('dataset_not_found', `${used[0]!.name} reads the install's default connection, and this install has none`);
  const databases = [...new Set(used.map((l) => l.namespace))];
  if (databases.length > 1) return reply('validation_failed', `a statement reads one database: ${used.map((l) => `${l.name} is default:${l.namespace}`).join(', ')}; query them separately`);
  try {
    const target = selected(databases[0]);
    dialect = target?.dialect ?? dialect;
    checkedNamespace(dialect, target?.namespace);
  } catch (e) { return refused(connectorError(e)); }
  let text: string;
  try { text = mapQualifiers(dialect, call.sql, new Map(used.map((l) => [l.name.toLowerCase(), '']))); } catch (e) { return refused(connectorError(e)); }
  signal=admission?.dispatch(true)??signal;
  return run(actor, text, call.params, databases[0] || undefined, signal);
}

/** A version's declared query `name` on one of its default-connection links, with that link; null when it names none. */
export function declaredConnectionQuery(page: Pick<HtmlPageVersion, 'links' | 'queries'>, name: unknown): { query: HtmlDeclaredQuery; link: HtmlDefaultConnectionLink } | null {
  const query = typeof name === 'string' ? page.queries.find((q) => q.name === name) : undefined;
  const link = query && page.links.find((l): l is HtmlDefaultConnectionLink => l.kind === 'default-connection' && l.name === query.link);
  return query && link ? { query, link } : null;
}

/**
 * A DECLARED QUERY ON THE DEFAULT CONNECTION (`{query, params}` at the page SQL door), run as `viewer`, which the door
 * decided (lib/page-doors): the reader's own, unless an approval (lib/query-approvals) holds. The text is the version's
 * own, never the caller's: written like any statement on the link (`NAME.table` or plain), `:name` binding `params`
 * and the server's `:viewer_*` values, which a caller may not send.
 */
export async function runDeclaredConnectionQuery(viewer: ConnectorViewer, declared: { query: HtmlDeclaredQuery; link: HtmlDefaultConnectionLink }, params: unknown, signal: AbortSignal, admission?: { dispatch(read: boolean): AbortSignal }): Promise<ConnectionSqlReply> {
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) return reply('validation_failed', 'params must be an object of scalars');
  const sent = (params ?? {}) as Record<string, Scalar>;
  const filled = Object.keys(sent).find((name) => (VIEWER_PARAMS as readonly string[]).includes(name));
  if (filled) return reply('validation_failed', `${filled} is filled in by the server for the person reading; never send it`);
  if (!configured()) return reply('dataset_not_found', `${declared.link.name} reads the install's default connection, and this install has none`);
  let text: string;
  try {
    const target = selected(declared.link.namespace || undefined);
    const dialect = target?.dialect ?? configured()!.fallback.dialect;
    checkedNamespace(dialect, target?.namespace);
    text = mapQualifiers(dialect, colonParameters(dialect, declared.query.sql).text, new Map([[declared.link.name.toLowerCase(), '']]));
  } catch (e) { return refused(connectorError(e)); }
  signal = admission?.dispatch(true) ?? signal;
  return run(viewer, text, { ...sent, ...viewerParams(viewer) }, declared.link.namespace || undefined, signal);
}

/** An agent's statement, as its signed-in account, passed through; `namespace` (what follows `default:`) the database. */
export async function agentConnectionSql(actor: AccessActor, raw: { sql?: unknown; params?: unknown; namespace?: unknown }, signal: AbortSignal): Promise<ConnectionSqlReply> {
  if (!reader(actor)) return AGENT_SIGN_IN;
  const call = checkedCall(raw);
  if ('status' in call) return call;
  if (raw.namespace !== undefined && typeof raw.namespace !== 'string') return reply('validation_failed', 'namespace is what follows default:, a database name');
  return run(actor, call.sql, call.params, (raw.namespace as string | undefined) || undefined, signal);
}

/** The tables and columns a signed-in person can read in `namespace`'s database (absent: the configured one). */
export async function defaultConnectionSchema(actor: AccessActor, namespace: string | undefined, signal: AbortSignal): Promise<ConnectionSqlReply> {
  if (!reader(actor)) return AGENT_SIGN_IN;
  try {
    const c = selected(namespace);
    if (!c) return reply('dataset_not_found', 'this install has no default connection');
    const schema: ConnectorSchema = await c.connection.schema({ viewer: await viewerOf(actor), ...(c.namespace ? { namespace: c.namespace } : {}), signal });
    return { status: 200, body: { connector: c.summary.connector, ...schema } };
  } catch (e) {
    if (e instanceof ConnectorFailure) return refused(connectorError(e));
    throw e;
  }
}

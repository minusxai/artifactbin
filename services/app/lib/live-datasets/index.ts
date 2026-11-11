/**
 * LIVE DATASETS: a dataset artifact whose content is a database connection (a connector configuration,
 * `@artifactbin/connectors`), queried in place. Server-only; the connectors run in this process, as the default
 * connection's do (lib/connections).
 *
 * WHAT ONE IS. An ordinary `format: 'dataset'` row (ID, owner person or group, sharing, trash, transfer) whose `meta`
 * holds `connection` (contracts `ConnectionSummary`: the connector and its shown fields) and no catalog; its full
 * configuration lives in `dataset_connections`, the secret fields sealed (lib/platform `datasetConnectionCipher`, its own
 * key label, the dataset ID in the context). Created through the ordinary create door (`POST /api/artifacts`
 * with `connection`); changed only here (`updateLiveConnection`, owner and editors). No secret value leaves this
 * module: answers carry the summary, an editor also the non-secret fields and the NAMES of the secrets set; connector
 * errors already have the secrets removed.
 *
 * CHANGING A CONNECTION. Omitted secret fields keep the stored ones, but only while every non-secret field (where the
 * secret is sent: host, port, database, the account, TLS, the CA; a project) stays as stored: change any of them and
 * the secrets must be sent again, so a stored secret can never be redirected to another server.
 *
 * WHO QUERIES. The role is the dataset's own (lib/dataset-permissions). Owner and editors run any SQL (the page's
 * `sql` naming the link, `POST /api/artifacts/ID/query`). Every other role runs ONLY the queries a published page
 * declares on it (`sql.query(name, params)`), and only when the rules document admits that role (a select entry on
 * `public.queries`, lib/datasets live-rules). SQL is the database's dialect; parameters are bound, written `:name`
 * (or `$name`); `:viewer_id`, `:viewer_email` and `:viewer_groups` (JSON array text of group IDs) are filled by the
 * server for every query and a caller may not send them; anonymous: null. The connector also sets them on the
 * session (contracts connectors header).
 *
 * DECLARED QUERIES are recorded per page version by publish (`livePageDeclarations`), which refuses one on a live
 * dataset the publisher cannot edit; a reader names the query of the version it has open (the page door's revision).
 */
import { CONNECTORS, SQL_READ_LIMITS, type ConnectionConfig, type ConnectorDialect, type ConnectorError, type ConnectorScalar, type ConnectorTestResult, type ConnectorViewer, type DatasetRole, type HtmlDatasetLink, type HtmlDeclaredQuery, type HtmlLiveDatasetLink, type HtmlPageVersion, type Queryable } from '@artifactbin/contracts';
import { ConnectorFailure, colonParameters, connectionSummary, connectorError, connectorList, leadingWords, mapQualifiers, openConnection, parseConnectionConfig, qualifierNames, type NetworkSeams, type OpenConnection } from '@artifactbin/connectors';
import type { AccessActor } from '@/lib/accounts';
import { canReadArtifact, getArtifactById, setLiveDatasetSummary, type LiveConnectionInsert } from '@/lib/artifacts';
import { lockAuthorization, transactionAccessFacts, type ArtifactRow } from '@/lib/artifact-access';
import { connectorViewer } from '@/lib/connections';
import { liveConnectionOf, liveQueryRoles } from '@/lib/datasets';
import { datasetReadAccess, datasetRole, storedPolicy } from '@/lib/dataset-permissions';
import { datasetConnectionCipher, datasetsAllowPrivateNetwork, getDb } from '@/lib/platform';

const PURPOSE = 'dataset-connection';
const VIEWER_PARAMS = ['viewer_id', 'viewer_email', 'viewer_groups'] as const;

/** A refusal with its HTTP status and code, answered as `{error: code, message}`. */
export class LiveDatasetRefusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'LiveDatasetRefusal'; }
  get body() { return { error: this.code, message: this.message }; }
}
export interface LiveSqlReply { status: number; body: Record<string, unknown> }

const specOf = (id: string) => CONNECTORS.find((c) => c.id === id)!;
const network = () => ({ allowPrivateNetwork: datasetsAllowPrivateNetwork() });
let seams: NetworkSeams | undefined;
/** Tests: how host names resolve (the rebinding and private-address checks). */
export function setLiveDatasetNetworkSeams(next: NetworkSeams | undefined): void { seams = next; }

/** A checked configuration's non-secret fields and its secrets. */
function split(config: ConnectionConfig): { open: Record<string, ConnectorScalar>; secrets: Record<string, string> } {
  const open: Record<string, ConnectorScalar> = { connector: config.connector }, secrets: Record<string, string> = {};
  for (const field of specOf(config.connector).fields) {
    const v = config[field.name];
    if (v === undefined || v === null) continue;
    if (field.secret) secrets[field.name] = String(v); else open[field.name] = v;
  }
  return { open, secrets };
}

/** The configuration checked, its connector runnable here and its address and TLS allowed (no socket opens). */
function checkedConfig(input: unknown): ConnectionConfig {
  let config: ConnectionConfig;
  try {
    config = parseConnectionConfig(input);
    if (!connectorList().find((c) => c.id === config.connector)?.available) throw new ConnectorFailure('unavailable', `${specOf(config.connector).label} is not available yet`);
    void openConnection(config, network(), seams).close();
  } catch (e) {
    const error = connectorError(e);
    throw new LiveDatasetRefusal(400, error.code === 'unavailable' ? 'connector_unavailable' : 'invalid_connection', error.message);
  }
  return config;
}

/** `input` with the connector's secret fields removed: what a creation's idempotency fingerprint may hash. */
export function withoutSecrets(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const spec = CONNECTORS.find((c) => c.id === (input as { connector?: unknown }).connector);
  return Object.fromEntries(Object.entries(input).filter(([name]) => !spec?.fields.some((f) => f.secret && f.name === name)));
}

/**
 * THE CREATE DOOR'S CONTENT for `{connection}`: the row's content (a dataset with the summary and no rows) and the
 * connection the creation stores with it. Throws LiveDatasetRefusal.
 */
export function prepareLiveDataset(input: unknown): { content: { format: 'dataset'; source: null; meta: Record<string, unknown>; derivedTitle: null }; connection: LiveConnectionInsert } {
  const config = checkedConfig(input);
  const { open, secrets } = split(config);
  return {
    content: { format: 'dataset', source: null, meta: { connection: connectionSummary(config), columns: [] }, derivedTitle: null },
    connection: { config: open, seal: (id) => (Object.keys(secrets).length ? datasetConnectionCipher().seal(JSON.stringify(secrets), [PURPOSE, id]) : null) },
  };
}

interface StoredConnection { config: Record<string, ConnectorScalar>; sealed: string | null; revision: number }
async function stored(id: string, q?: Queryable, lock = false): Promise<StoredConnection | null> {
  const db = q ?? await getDb();
  return (await db.query<StoredConnection>(`SELECT config, sealed, revision FROM dataset_connections WHERE dataset_id = $1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0] ?? null;
}
/**
 * The stored secrets, or null when they no longer open (the install's AUTH__SECRET changed): the connection then needs
 * them entered again by an owner or editor, and nothing else about it changes.
 */
function sealedSecrets(id: string, row: StoredConnection): Record<string, string> | null {
  if (!row.sealed) return {};
  try { return JSON.parse(datasetConnectionCipher().open(row.sealed, [PURPOSE, id])) as Record<string, string>; } catch { return null; }
}
const secretsOf = (id: string, row: StoredConnection): Record<string, string> => sealedSecrets(id, row) ?? {};
const UNSEALED = 'its stored secret no longer opens (this install\'s AUTH__SECRET changed): an owner or editor enters it again';

/** One open connection per live dataset, reused while its stored revision holds. */
const open = new Map<string, { revision: number; connection: OpenConnection; dialect: ConnectorDialect }>();
async function connectionOf(id: string): Promise<{ revision: number; connection: OpenConnection; dialect: ConnectorDialect }> {
  const row = await stored(id);
  if (!row) throw new LiveDatasetRefusal(404, 'dataset_not_found', 'this live dataset has no connection');
  const cached = open.get(id);
  if (cached?.revision === row.revision) return cached;
  if (cached) { open.delete(id); void cached.connection.close(); }
  if (!sealedSecrets(id, row)) throw new LiveDatasetRefusal(503, 'dataset_not_found', `the live dataset is unavailable: ${UNSEALED}`);
  let entry: { revision: number; connection: OpenConnection; dialect: ConnectorDialect };
  try {
    const config = parseConnectionConfig({ ...row.config, ...secretsOf(id, row) });
    entry = { revision: row.revision, connection: openConnection(config, network(), seams), dialect: specOf(config.connector).dialect };
  } catch (e) {
    const error = e instanceof ConnectorFailure ? connectorError(e) : { code: 'unavailable', message: 'the stored connection could not be opened' };
    throw new LiveDatasetRefusal(503, 'dataset_not_found', `the live dataset is unavailable (${error.code}): ${error.message}`);
  }
  open.set(id, entry);
  return entry;
}
function evict(id: string): void { const entry = open.get(id); open.delete(id); void entry?.connection.close(); }
/** Closes every open connection (process shutdown, tests). */
export async function closeLiveDatasetConnections(): Promise<void> {
  const entries = [...open.values()]; open.clear();
  await Promise.all(entries.map((e) => e.connection.close()));
}

/** The live dataset row, or null when `id` names no live dataset. */
async function liveRow(id: string): Promise<ArtifactRow | null> {
  const row = await getArtifactById(id);
  return row && row.format === 'dataset' && liveConnectionOf(row.meta) ? row : null;
}
const isAdmin = (role: DatasetRole | null) => role === 'owner' || role === 'editor';
const NOT_FOUND = () => new LiveDatasetRefusal(404, 'not_found', 'not found');
/** The live dataset `actor` owns or edits; the uniform 404 when they cannot read it, 403 when they only read it. */
async function editableLive(actor: AccessActor, id: string): Promise<ArtifactRow> {
  const row = await liveRow(id);
  if (!row) throw NOT_FOUND();
  const role = await datasetRole(row, actor);
  if (!role) throw NOT_FOUND();
  if (!isAdmin(role)) throw new LiveDatasetRefusal(403, 'permission_denied', 'only the live dataset\'s owner and editors may do this');
  return row;
}

/** Bound viewer values (every query has them; a caller never sends them) and the statement in `$name` form. */
function boundStatement(dialect: ConnectorDialect, text: string, params: unknown, viewer: ConnectorViewer | null): { text: string; params: Record<string, ConnectorScalar> } {
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) throw new LiveDatasetRefusal(400, 'validation_failed', 'params must be an object of scalars');
  const sent = (params ?? {}) as Record<string, ConnectorScalar>;
  const filled = Object.keys(sent).find((name) => (VIEWER_PARAMS as readonly string[]).includes(name));
  if (filled) throw new LiveDatasetRefusal(400, 'validation_failed', `${filled} is filled in by the server for the person reading; never send it`);
  let rewritten: string;
  try { rewritten = colonParameters(dialect, text).text; } catch (e) { throw new LiveDatasetRefusal(400, 'validation_failed', connectorError(e).message); }
  return {
    text: rewritten,
    params: { ...sent, viewer_id: viewer?.id ?? null, viewer_email: viewer?.email ?? null, viewer_groups: viewer ? JSON.stringify([...viewer.groups].sort()) : null },
  };
}

/** A connector error as the page SQL door's codes (the page's `SqlError`). */
function refused(name: string, e: ConnectorError): LiveSqlReply {
  const reply = (status: number, error: string, message: string) => ({ status, body: { error, message } });
  switch (e.code) {
    case 'invalid_query': case 'database_error': return reply(400, 'validation_failed', e.message);
    case 'read_only': return reply(403, 'permission_denied', `${name} is a live dataset, read-only: ${e.message}`);
    case 'permission_denied': return reply(403, 'permission_denied', e.message);
    case 'timeout': return reply(408, 'timeout', e.message);
    case 'result_too_large': return reply(413, 'result_too_large', e.message);
    default: return reply(503, 'dataset_not_found', `${name} is unavailable (${e.code}): ${e.message}`);
  }
}

/** Runs one statement on the dataset's connection as `viewer`. */
async function run(id: string, name: string, text: string, params: unknown, viewer: ConnectorViewer | null, signal?: AbortSignal): Promise<LiveSqlReply> {
  try {
    const { connection, dialect } = await connectionOf(id);
    const bound = boundStatement(dialect, text, params, viewer);
    const answer = await connection.query({ text: bound.text, params: bound.params, viewer, limits: { rows: SQL_READ_LIMITS.rows }, ...(signal ? { signal } : {}) });
    return { status: 200, body: { columns: answer.columns, rows: answer.rows, ...(answer.truncated ? { truncated: true } : {}) } };
  } catch (e) {
    if (e instanceof LiveDatasetRefusal) return { status: e.status, body: e.body };
    if (e instanceof ConnectorFailure) return refused(name, connectorError(e));
    throw e;
  }
}
const refusal = (e: unknown): LiveSqlReply => { if (e instanceof LiveDatasetRefusal) return { status: e.status, body: e.body }; throw e; };

// ── the dataset's own doors ─────────────────────────────────────────────────────────────────────────────────────

/**
 * GET: what a reader of the dataset may see of its connection (connector, shown fields), the roles its rules admit to
 * declared queries and the pages that declare queries on it (those the caller can read); an owner or editor also
 * gets the non-secret fields and the NAMES of the secrets stored.
 */
export async function liveConnectionDetails(actor: AccessActor, id: string): Promise<LiveSqlReply> {
  const row = await liveRow(id);
  const role = row ? await datasetRole(row, actor) : null;
  if (!row || !role) return refusal(NOT_FOUND());
  const summary = liveConnectionOf(row.meta)!;
  let roles: string[] = [];
  try { roles = liveQueryRoles(storedPolicy({ policy: row.dataset_policy, tables: [], live: true }).policy); } catch { /* an unreadable policy admits nobody */ }
  const editor = isAdmin(role) ? await stored(id) : null;
  const config = editor ? { ...editor.config } : null;
  return {
    status: 200,
    body: {
      id, role, connection: summary, declaredQueryRoles: roles, pages: await declaringPages(actor, id),
      ...(config ? { config, secrets: Object.keys(secretsOf(id, editor!)).sort() } : {}),
    },
  };
}

/** The pages (the caller can read) whose head declares queries on dataset `id`, with those queries' names. */
async function declaringPages(actor: AccessActor, id: string): Promise<Array<{ id: string; title: string | null; queries: string[] }>> {
  const rows = (await (await getDb()).query<Pick<ArtifactRow, 'id' | 'title' | 'visibility' | 'user_id' | 'link_role' | 'group_id' | 'format' | 'meta'>>(
    `SELECT id, title, visibility, user_id, link_role, group_id, format, meta FROM artifacts WHERE deleted_at IS NULL AND format = 'html' AND meta->'htmlLinks' @> $1::jsonb ORDER BY updated_at DESC LIMIT 100`,
    [JSON.stringify([{ kind: 'live-dataset', datasetId: id }])])).rows;
  const out: Array<{ id: string; title: string | null; queries: string[] }> = [];
  for (const page of rows) {
    if (!await canReadArtifact(page, actor)) continue;
    const links = new Set(((page.meta.htmlLinks ?? []) as HtmlLiveDatasetLink[]).filter((l) => l.kind === 'live-dataset' && l.datasetId === id).map((l) => l.name));
    out.push({ id: page.id, title: page.title, queries: ((page.meta.htmlQueries ?? []) as HtmlDeclaredQuery[]).filter((q) => links.has(q.link)).map((q) => q.name) });
  }
  return out;
}

/**
 * PATCH: change the connection (owner and editors). `input` is the connector's fields; an omitted secret keeps the
 * stored one only while every other field is unchanged. Decided inside one transaction holding the row FOR UPDATE.
 */
export async function updateLiveConnection(actor: AccessActor, id: string, input: unknown): Promise<LiveSqlReply> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refusal(new LiveDatasetRefusal(400, 'invalid_connection', 'send the connection\'s fields as one JSON object'));
  try {
    const summary = await (await getDb()).transaction(async (tx) => {
      // LOCK ORDER (lib/artifact-access locks.ts): the dataset row FOR UPDATE, then the facts the decision reads.
      await lockAuthorization(tx, { write: id });
      const row = (await tx.query<ArtifactRow>('SELECT * FROM artifacts WHERE id = $1 AND deleted_at IS NULL', [id])).rows[0];
      if (!row || row.format !== 'dataset' || !liveConnectionOf(row.meta)) throw NOT_FOUND();
      const role = await datasetRole(row, actor, { facts: transactionAccessFacts(actor, tx) });
      if (!role) throw NOT_FOUND();
      if (!isAdmin(role)) throw new LiveDatasetRefusal(403, 'permission_denied', 'only the live dataset\'s owner and editors may change its connection');
      const current = await stored(id, tx, true);
      if (!current) throw NOT_FOUND();
      const sent = input as Record<string, unknown>;
      const connector = (sent.connector ?? current.config.connector) as string;
      if (connector !== current.config.connector) throw new LiveDatasetRefusal(400, 'invalid_connection', 'a live dataset keeps its connector: create a new dataset for another kind of database');
      const spec = specOf(connector);
      const secretNames = spec.fields.filter((f) => f.secret).map((f) => f.name);
      const sentSecrets = secretNames.filter((name) => sent[name] !== undefined && sent[name] !== null && sent[name] !== '');
      // The non-secret fields as they will be: what was stored, overwritten by what was sent (null clears one).
      const next: Record<string, unknown> = { ...current.config, ...Object.fromEntries(Object.entries(sent).filter(([name]) => !secretNames.includes(name))) };
      for (const [name, v] of Object.entries(next)) if (v === null || v === '') delete next[name];
      const prior = parseConnectionConfig({ ...current.config, ...secretsOf(id, current) });
      const unsealed = sealedSecrets(id, current);
      if (!unsealed && !sentSecrets.length) throw new LiveDatasetRefusal(400, 'secret_required', `send ${secretNames.join(' and ')} again: ${UNSEALED}`);
      const keptSecrets = unsealed ?? {};
      const candidate = checkedConfig({ ...next, ...keptSecrets, ...Object.fromEntries(sentSecrets.map((name) => [name, sent[name]])) });
      const moved = spec.fields.filter((f) => !f.secret && JSON.stringify(candidate[f.name] ?? null) !== JSON.stringify(prior[f.name] ?? null)).map((f) => f.name);
      const kept = secretNames.filter((name) => keptSecrets[name] !== undefined && !sentSecrets.includes(name));
      if (moved.length && kept.length) throw new LiveDatasetRefusal(400, 'secret_required', `changing ${moved.join(', ')} needs ${kept.join(' and ')} again: a stored secret is never sent to a changed connection`);
      const { open: config, secrets } = split(candidate);
      const sealed = Object.keys(secrets).length ? datasetConnectionCipher().seal(JSON.stringify(secrets), [PURPOSE, id]) : null;
      await tx.query('UPDATE dataset_connections SET config = $2::jsonb, sealed = $3, revision = revision + 1, updated_at = now() WHERE dataset_id = $1', [id, JSON.stringify(config), sealed]);
      const summary = connectionSummary(candidate);
      await setLiveDatasetSummary(tx, id, summary as unknown as Record<string, unknown>);
      return summary;
    });
    evict(id);
    return { status: 200, body: { id, connection: summary } };
  } catch (e) { return refusal(e); }
}

/** "Test connection" on a saved live dataset (owner and editors), as the person asking. Never throws for the database. */
export async function testLiveConnection(actor: AccessActor, id: string): Promise<LiveSqlReply> {
  try {
    await editableLive(actor, id);
    const { connection } = await connectionOf(id);
    return { status: 200, body: { ...await connection.test({ viewer: await connectorViewer(actor) }) } };
  } catch (e) { return refusal(e); }
}

/** "Test connection" on the new-dataset form: a configuration not saved yet, opened, tested and closed. */
export async function testConnectionConfig(actor: AccessActor, input: unknown): Promise<LiveSqlReply> {
  let config: ConnectionConfig;
  try { config = checkedConfig(input); } catch (e) { const r = refusal(e); return { status: 200, body: { ok: false, error: { code: 'invalid_config', message: String(r.body.message) } } }; }
  const connection = openConnection(config, network(), seams);
  try { return { status: 200, body: { ...await connection.test({ viewer: await connectorViewer(actor) }) } satisfies ConnectorTestResult & Record<string, unknown> }; }
  finally { void connection.close(); }
}

/** The tables and columns the connection's account reads (owner and editors). */
export async function liveSchema(actor: AccessActor, id: string, signal?: AbortSignal): Promise<LiveSqlReply> {
  try {
    const row = await editableLive(actor, id);
    const { connection } = await connectionOf(id);
    try {
      const schema = await connection.schema({ viewer: await connectorViewer(actor), ...(signal ? { signal } : {}) });
      return { status: 200, body: { connector: liveConnectionOf(row.meta)!.connector, ...schema } };
    } catch (e) { if (e instanceof ConnectorFailure) return refused(row.title ?? id, connectorError(e)); throw e; }
  } catch (e) { return refusal(e); }
}

/** An owner's or editor's own statement on the dataset (`POST /api/artifacts/ID/query`, `sql.mjs query ID`). */
export async function liveDatasetSql(actor: AccessActor, id: string, raw: { sql?: unknown; params?: unknown }, signal?: AbortSignal): Promise<LiveSqlReply> {
  try {
    const row = await liveRow(id);
    const role = row ? await datasetRole(row, actor) : null;
    if (!row || !role) throw NOT_FOUND();
    if (!isAdmin(role)) throw new LiveDatasetRefusal(403, 'permission_denied', 'only a live dataset\'s owner and editors write SQL on it; everyone else runs the queries its pages declare');
    if (typeof raw.sql !== 'string' || !raw.sql.trim()) throw new LiveDatasetRefusal(400, 'validation_failed', 'sql takes one SQL statement');
    return run(id, row.title ?? id, raw.sql, raw.params, await connectorViewer(actor), signal);
  } catch (e) { return refusal(e); }
}

// ── pages ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * PUBLISH: the page's dataset links with every link to a live dataset recorded as one (`live-dataset`: never pinned),
 * readable by `reader` (whom the stored links are authorized as: the page's owner on a replace), and its declared
 * queries, each on a live link the PUBLISHER (the person saving, never the page's owner) owns or edits. Throws
 * LiveDatasetRefusal; a stored link is left as it was (its own checks follow).
 */
export async function livePageDeclarations(reader: AccessActor, publisher: AccessActor, links: readonly HtmlDatasetLink[], queries: readonly HtmlDeclaredQuery[]): Promise<{ links: (HtmlDatasetLink | HtmlLiveDatasetLink)[]; queries: HtmlDeclaredQuery[] }> {
  const out: (HtmlDatasetLink | HtmlLiveDatasetLink)[] = [], live = new Map<string, ArtifactRow>();
  for (const link of links) {
    const row = await liveRow(link.datasetId);
    if (!row) { out.push(link); continue; }
    if (link.mode === 'pinned') throw new LiveDatasetRefusal(400, 'live_dataset_not_pinnable', `link "${link.name}" pins a live dataset: a connection has no row revisions; drop data-af-mode and data-af-revision`);
    if (!await canReadArtifact(row, reader)) throw new LiveDatasetRefusal(400, 'dataset_not_found', `link "${link.name}" names a dataset you cannot read`);
    out.push({ kind: 'live-dataset', name: link.name, datasetId: link.datasetId });
    live.set(link.name, row);
  }
  for (const query of queries) {
    const row = live.get(query.link);
    if (!row) throw new LiveDatasetRefusal(400, 'invalid_declared_query', `declared query ${query.name} runs on data-af-dataset="${query.link}", which is not a live dataset link on this page`);
    if (!isAdmin(await datasetRole(row, publisher))) throw new LiveDatasetRefusal(403, 'declared_query_not_permitted', `declared query ${query.name} runs on ${query.link}, a live dataset you do not own or edit: only its owner and editors may declare queries on it`);
    const dialect = specOf(liveConnectionOf(row.meta)!.connector).dialect;
    try { colonParameters(dialect, query.sql); } catch (e) { throw new LiveDatasetRefusal(400, 'invalid_declared_query', `declared query ${query.name}: ${connectorError(e).message}`); }
  }
  return { links: out, queries: [...queries] };
}

/** Forking a page carries its declared queries only for someone who may declare them (as publish requires). */
export async function assertDeclaredQueriesCopyable(actor: AccessActor, page: { meta: Record<string, unknown> }): Promise<void> {
  const links = ((page.meta.htmlLinks ?? []) as HtmlLiveDatasetLink[]).filter((l) => l.kind === 'live-dataset');
  for (const query of (page.meta.htmlQueries ?? []) as HtmlDeclaredQuery[]) {
    const link = links.find((l) => l.name === query.link), row = link ? await liveRow(link.datasetId) : null;
    if (!row || !isAdmin(await datasetRole(row, actor))) throw new LiveDatasetRefusal(403, 'declared_query_not_permitted', `this page declares query ${query.name} on a live dataset you do not own or edit, so it cannot be copied by you`);
  }
}

const LIVE_HINT = 'readers run the queries the page declares: sql.query(name, params)';
/**
 * THE PAGE SQL DOOR'S LIVE PART (lib/page-doors, after the door admitted the reader to the page and chose the
 * revision `page`): `{query, params}` runs that version's declared query; `{sql}` naming a live link (`NAME.table`)
 * runs wholly on that dataset's connection, for its owner and editors only. Null: the statement names no live link
 * (the default connection's and the stored datasets' doors answer it).
 */
export async function pageLiveDatasetSql(actor: AccessActor, page: HtmlPageVersion, raw: { sql?: unknown; params?: unknown; query?: unknown }, signal?: AbortSignal): Promise<LiveSqlReply | null> {
  const lives = page.links.filter((l): l is HtmlLiveDatasetLink => l.kind === 'live-dataset');
  try {
    if (raw.query !== undefined) {
      if (typeof raw.query !== 'string' || raw.sql !== undefined) throw new LiveDatasetRefusal(400, 'validation_failed', 'send {query, params} (a declared query\'s name) or {sql, params}, not both');
      const query = page.queries.find((q) => q.name === raw.query);
      const link = query && lives.find((l) => l.name === query.link);
      if (!query || !link) throw new LiveDatasetRefusal(404, 'unknown_query', `this version of the page declares no query named ${JSON.stringify(raw.query.slice(0, 64))}`);
      const row = await liveRow(link.datasetId);
      if (!row) throw new LiveDatasetRefusal(404, 'dataset_not_found', `${link.name} names a live dataset that is gone`);
      const decision = await datasetReadAccess(row, actor, { pageId: page.pageId });
      if (!decision.allowed) throw new LiveDatasetRefusal(403, 'permission_denied', `${link.name}'s rules do not let your role run its declared queries${actor.userId ? '' : '; sign in, or ask its owner to allow anonymous readers'}`);
      return await run(row.id, link.name, query.sql, raw.params, await connectorViewer(actor), signal);
    }
    if (typeof raw.sql !== 'string' || !lives.length) return null;
    const rows = await Promise.all(lives.map(async (link) => ({ link, row: await liveRow(link.datasetId) })));
    const used: typeof rows = [];
    let words = new Set<string>();
    for (const entry of rows) {
      const dialect = entry.row ? specOf(liveConnectionOf(entry.row.meta)!.connector).dialect : 'postgres';
      let named: Set<string>;
      try { named = leadingWords(dialect, raw.sql); } catch { return null; }
      if (named.has(entry.link.name.toLowerCase())) { used.push(entry); words = named; }
    }
    if (!used.length) return null;
    const first = used[0]!;
    if (used.length > 1) throw new LiveDatasetRefusal(400, 'validation_failed', `a statement reads one source: ${used.map((u) => u.link.name).join(' and ')} are two live datasets; query them separately`);
    const other = page.links.find((l) => l.name !== first.link.name && words.has(l.name.toLowerCase()));
    if (other) throw new LiveDatasetRefusal(400, 'validation_failed', `a statement reads one source: ${first.link.name} is a live dataset and ${other.name} another source; query them separately`);
    if (!first.row) throw new LiveDatasetRefusal(404, 'dataset_not_found', `${first.link.name} names a live dataset that is gone`);
    const dialect = specOf(liveConnectionOf(first.row.meta)!.connector).dialect;
    if (!qualifierNames(dialect, raw.sql).has(first.link.name.toLowerCase())) throw new LiveDatasetRefusal(400, 'validation_failed', `${first.link.name} is a live dataset: name its tables as ${first.link.name}.table (or ${first.link.name}.schema.table)`);
    const decision = await datasetReadAccess(first.row, actor, { pageId: page.pageId });
    if (!decision.allowed || !decision.admin) throw new LiveDatasetRefusal(403, 'permission_denied', `only ${first.link.name}'s owner and editors write SQL on it; ${LIVE_HINT}`);
    let text: string;
    try { text = mapQualifiers(dialect, raw.sql, new Map([[first.link.name.toLowerCase(), '']])); } catch (e) { throw new LiveDatasetRefusal(400, 'validation_failed', connectorError(e).message); }
    return await run(first.row.id, first.link.name, text, raw.params, await connectorViewer(actor), signal);
  } catch (e) { return refusal(e); }
}


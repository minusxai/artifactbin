/**
 * A PAGE'S LIVE REGIONS AS PAGE STORAGE: the region rows (lib/platform/schema region_states, region_updates,
 * region_snapshots) as every head-bumping write of an HTML page has to keep them. The session side (opening a region,
 * accepting validated updates, streaming them) is lib/region-sessions; what a new page version does to the rows is
 * here, beside the writes that make versions (store.ts):
 *
 *  - SAVING ("compaction"): the merged live text of every region with unsaved edits is written into the saved
 *    source (lib/live-regions compactRegion), which becomes one new version; the id write-back is logged, the state
 *    folded, and each region's snapshot stored with that version.
 *  - A WHOLE-PAGE WRITE (an author's or agent's PUT from the head): each live region is merged three-way from the
 *    head's snapshot (applyRegionRevision), so editors' unsaved typing survives, and the merged text is what is stored.
 *    A region the write removes, or whose kind it changes, is closed: its rows are deleted.
 *  - Every new version carries a snapshot of EVERY live region (a clean one's is copied forward), because the next
 *    whole-page write merges from the head's.
 *
 * Lock order (as every page write): the artifacts row first (store.ts lockArtifactWrite, FOR UPDATE), then the
 * region rows, FOR UPDATE. Wakeups are `pg_notify(regionsChannel)` inside the transaction, delivered at commit.
 */
import * as Y from 'yjs';
import { regionsChannel } from '@artifactbin/contracts';
import { applyRegionRevision, compactRegion, editableRegions, LiveRegionRefusal, openRegionDoc, type RegionKind } from '@/lib/live-regions';
import type { HtmlIdentityLedger } from '../html-page';
import type { AccessActor } from '@/lib/accounts';
import { editorScope, type ArtifactRow } from '@/lib/artifact-access';
import type { Queryable } from '../platform';
import { json } from '../http';

/** Snapshots are kept for the last 50 versions or 7 days, whichever keeps more; logged updates for 30 days. */
const SNAPSHOT_VERSIONS_KEPT = 50;

export interface RegionRow {
  region_id: string;
  kind: RegionKind;
  state: Uint8Array;
  state_seq: number;
  last_seq: number;
  saved_version: number;
  dirty_since: string | null;
  last_update_at: string | null;
  created_at: string;
}

const ROW_COLUMNS = 'region_id, kind, state, state_seq::int AS state_seq, last_seq::int AS last_seq, saved_version, dirty_since, last_update_at, created_at';
/** Postgres hands BYTEA back as a Buffer, PGLite as a Uint8Array; Yjs reads either. */
const bytes = (value: Uint8Array): Buffer => Buffer.from(value.buffer, value.byteOffset, value.byteLength);

/** True when an update carries no struct and no delete. */
function isEmptyUpdate(update: Uint8Array): boolean {
  const { structs, ds } = Y.decodeUpdate(update);
  return !structs.length && ![...ds.clients.values()].some((ranges) => ranges.length);
}
/** The client id an update's structs are written under; 0 for a delete-only update. */
const clientOf = (update: Uint8Array): number => Y.decodeUpdate(update).structs[0]?.id.client ?? 0;

/** The region rows of a page, locked, in one order (region id) so two writers never lock them crosswise. */
export async function lockedRegionRows(tx: Queryable, artifactId: string, regionId?: string): Promise<RegionRow[]> {
  return (await tx.query<RegionRow>(
    `SELECT ${ROW_COLUMNS} FROM region_states WHERE artifact_id = $1 ${regionId ? 'AND region_id = $2' : ''} ORDER BY region_id FOR UPDATE`,
    regionId ? [artifactId, regionId] : [artifactId],
  )).rows;
}

/** The logged updates after `seq`, in order (at most `limit`). */
export async function regionUpdatesAfter(q: Queryable, artifactId: string, regionId: string, seq: number, limit = 1000): Promise<{ seq: number; update: Uint8Array }[]> {
  return (await q.query<{ seq: number; update: Uint8Array }>(
    'SELECT seq::int AS seq, "update" FROM region_updates WHERE artifact_id = $1 AND region_id = $2 AND seq > $3 ORDER BY seq LIMIT $4',
    [artifactId, regionId, seq, limit],
  )).rows;
}

/** A region's live document: its folded state and every update logged after it. */
export async function liveRegionDoc(q: Queryable, artifactId: string, row: Pick<RegionRow, 'region_id' | 'state' | 'state_seq' | 'last_seq'>): Promise<Y.Doc> {
  const doc = openRegionDoc(row.state);
  if (row.last_seq > row.state_seq) for (const { update } of await regionUpdatesAfter(q, artifactId, row.region_id, row.state_seq, row.last_seq - row.state_seq)) Y.applyUpdate(doc, update);
  return doc;
}

/** One logged update, attributed. */
export async function logRegionUpdate(tx: Queryable, artifactId: string, regionId: string, seq: number, clientId: number, update: Uint8Array, actor: Pick<AccessActor, 'userId' | 'tokenId'>): Promise<void> {
  await tx.query(
    'INSERT INTO region_updates (artifact_id, region_id, seq, client_id, "update", actor_user_id, actor_token_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [artifactId, regionId, seq, clientId, bytes(update), actor.userId, actor.tokenId || null],
  );
}

/** Wakes the page's region streams (a pointer: they catch up from the rows). */
export async function notifyRegions(tx: Queryable, artifactId: string, payload: string): Promise<void> {
  await tx.query('SELECT pg_notify($1, $2)', [regionsChannel(artifactId), payload]);
}

/**
 * The page as its editors see it for live editing: the head's id, version, format and (asked for) source, when the
 * actor may edit it (the platform's editor scope, trash gate included), optionally locked: FOR SHARE (`true`: an
 * update to a region), or FOR UPDATE (`'update'`: a write that then saves a version, so it never upgrades a share
 * lock another writer also holds).
 */
export interface EditablePage { id: string; version: number; format: string; source: string | null }
export async function editablePage(q: Queryable, actor: AccessActor, id: string, options: { lock?: boolean | 'update'; source?: boolean } = {}): Promise<EditablePage | null> {
  const scope = editorScope(actor);
  const lock = options.lock === 'update' ? ' FOR UPDATE' : options.lock ? ' FOR SHARE' : '';
  return (await q.query<EditablePage>(
    `SELECT id, version, format${options.source ? ', source' : ''} FROM artifacts WHERE id = $1 AND ${scope.where('$2')}${lock}`,
    [id, scope.val],
  )).rows[0] ?? null;
}

/** A region as a save or a whole-page write leaves it: its document, the updates to log and the new snapshot. */
interface RegionOutcome { row: RegionRow; doc: Y.Doc; updates: Uint8Array[]; snapshot: Uint8Array }

/** A page source and ledger to publish, and the region rows' writes for the version it becomes. */
export interface RegionPlan {
  html: string;
  ledger: HtmlIdentityLedger;
  /** After publishing (`version` the new head) or, null, when nothing was published. */
  commit(tx: Queryable, version: number | null, actor: Pick<AccessActor, 'userId' | 'tokenId'>): Promise<Record<string, number>>;
}

/** Compacts each outcome's document into the source, in order; their write-backs become updates to log. */
function compactAll(outcomes: RegionOutcome[], html: string, ledger: HtmlIdentityLedger) {
  for (const outcome of outcomes) {
    const compaction = compactRegion({ savedHtml: html, ledger, regionId: outcome.row.region_id, state: Y.encodeStateAsUpdate(outcome.doc) });
    if (!isEmptyUpdate(compaction.update)) { Y.applyUpdate(outcome.doc, compaction.update); outcome.updates.push(compaction.update); }
    outcome.snapshot = compaction.snapshot;
    html = compaction.html;
    ledger = compaction.ledger;
  }
  return { html, ledger };
}

/** The rows' writes for a new version: outcomes folded and snapshotted, clean regions' snapshots carried forward. */
function planCommit(artifactId: string, outcomes: RegionOutcome[], clean: RegionRow[], closed: string[], previousVersion: number): RegionPlan['commit'] {
  return async (tx, version, actor) => {
    const seqs: Record<string, number> = {};
    for (const { row, doc, updates, snapshot } of outcomes) {
      let seq = row.last_seq;
      for (const update of updates) await logRegionUpdate(tx, artifactId, row.region_id, ++seq, clientOf(update), update, actor);
      await tx.query(
        `UPDATE region_states SET state = $3, state_seq = $4, last_seq = $4, dirty_since = NULL${version === null ? '' : ', saved_version = $5'}
         WHERE artifact_id = $1 AND region_id = $2`,
        [artifactId, row.region_id, bytes(Y.encodeStateAsUpdate(doc)), seq, ...(version === null ? [] : [version])],
      );
      if (version !== null) await tx.query('INSERT INTO region_snapshots (artifact_id, region_id, version, snapshot) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [artifactId, row.region_id, version, bytes(snapshot)]);
      seqs[row.region_id] = seq;
    }
    if (version !== null) {
      for (const row of clean) {
        await tx.query(
          `INSERT INTO region_snapshots (artifact_id, region_id, version, snapshot)
           SELECT artifact_id, region_id, $3, snapshot FROM region_snapshots WHERE artifact_id = $1 AND region_id = $2 AND version = $4 ON CONFLICT DO NOTHING`,
          [artifactId, row.region_id, version, row.saved_version],
        );
        await tx.query('UPDATE region_states SET saved_version = $3 WHERE artifact_id = $1 AND region_id = $2', [artifactId, row.region_id, version]);
        seqs[row.region_id] = row.last_seq;
      }
      await tx.query(
        `DELETE FROM region_snapshots WHERE artifact_id = $1 AND version < $2 AND created_at < now() - interval '7 days'`,
        [artifactId, version - SNAPSHOT_VERSIONS_KEPT],
      );
      await tx.query(
        `DELETE FROM region_updates u USING region_states s WHERE u.artifact_id = $1 AND s.artifact_id = u.artifact_id AND s.region_id = u.region_id
           AND u.seq <= s.state_seq AND u.created_at < now() - interval '30 days'`,
        [artifactId],
      );
    }
    if (closed.length) await deleteRegionRows(tx, artifactId, closed);
    if (outcomes.length || closed.length || version !== null) await notifyRegions(tx, artifactId, version === null ? 'saved' : `saved:${version}:${previousVersion}`);
    return seqs;
  };
}

/** Deletes a page's region rows (every region, or the named ones). */
async function deleteRegionRows(tx: Queryable, artifactId: string, regionIds?: readonly string[]): Promise<void> {
  for (const table of ['region_updates', 'region_snapshots', 'region_states']) {
    await tx.query(`DELETE FROM ${table} WHERE artifact_id = $1${regionIds ? ' AND region_id = ANY($2::text[])' : ''}`, regionIds ? [artifactId, [...regionIds]] : [artifactId]);
  }
}

/**
 * SAVING: the plan for the version that holds every region's unsaved edits, or null when no region has any (or, with
 * `idleBefore`, when none has been idle since then: the backstop saves only then, and then saves every dirty region).
 * The caller holds the artifacts row FOR UPDATE.
 */
export async function planRegionSave(tx: Queryable, current: ArtifactRow, ledger: HtmlIdentityLedger, options: { idleBefore?: string } = {}): Promise<RegionPlan | null> {
  const rows = await lockedRegionRows(tx, current.id);
  const dirty = rows.filter((row) => row.dirty_since !== null);
  if (!dirty.length) return null;
  if (options.idleBefore !== undefined && !dirty.some((row) => row.last_update_at !== null && Date.parse(row.last_update_at) <= Date.parse(options.idleBefore!))) return null;
  const declared = new Set(editableRegions(current.source ?? '').filter((region) => rows.some((row) => row.region_id === region.id && row.kind === region.kind)).map((region) => region.id));
  const outcomes: RegionOutcome[] = [];
  for (const row of dirty) {
    if (!declared.has(row.region_id)) continue;
    outcomes.push({ row, doc: await liveRegionDoc(tx, current.id, row), updates: [], snapshot: new Uint8Array() });
  }
  const closed = rows.filter((row) => !declared.has(row.region_id)).map((row) => row.region_id);
  const page = compactAll(outcomes, current.source ?? '', ledger);
  const clean = rows.filter((row) => row.dirty_since === null && declared.has(row.region_id));
  return { ...page, commit: planCommit(current.id, outcomes, clean, closed, current.version) };
}

/**
 * A WHOLE-PAGE WRITE's plan: each live region of the head merged three-way into the written page (canonical `page`),
 * so the stored text holds both the write's changes and editors' unsaved typing. Refusals are the route's answers:
 * 409 `region_snapshot_missing` (no snapshot of the head to merge from), 422 `unsupported_content` (the write puts
 * something in a live region its kind cannot hold).
 */
export async function planRegionMerge(tx: Queryable, current: ArtifactRow, page: { html: string; ledger: HtmlIdentityLedger }): Promise<RegionPlan | Response> {
  const rows = await lockedRegionRows(tx, current.id);
  if (!rows.length) return { ...page, commit: async () => ({}) };
  const declared = new Map(editableRegions(page.html).map((region) => [region.id, region]));
  const outcomes: RegionOutcome[] = [];
  const closed: string[] = [];
  for (const row of rows) {
    const region = declared.get(row.region_id);
    if (!region || region.kind !== row.kind) { closed.push(row.region_id); continue; }
    const saved = (await tx.query<{ snapshot: Uint8Array }>('SELECT snapshot FROM region_snapshots WHERE artifact_id = $1 AND region_id = $2 AND version = $3', [current.id, row.region_id, current.version])).rows[0];
    if (!saved) return json({ error: 'region_snapshot_missing', regionId: row.region_id }, 409);
    const doc = await liveRegionDoc(tx, current.id, row);
    let revision: { update: Uint8Array };
    try { revision = applyRegionRevision({ kind: row.kind, live: Y.encodeStateAsUpdate(doc), savedSnapshot: saved.snapshot, html: region.inner }); }
    catch (error) {
      if (!(error instanceof LiveRegionRefusal)) throw error;
      if (error.code === 'unsupported_content') return json({ error: 'unsupported_content', regionId: row.region_id, details: error.details }, 422);
      return json({ error: 'region_snapshot_missing', regionId: row.region_id }, 409);
    }
    const updates: Uint8Array[] = [];
    if (!isEmptyUpdate(revision.update)) { Y.applyUpdate(doc, revision.update); updates.push(revision.update); }
    outcomes.push({ row, doc, updates, snapshot: new Uint8Array() });
  }
  const merged = compactAll(outcomes, page.html, page.ledger);
  return { ...merged, commit: planCommit(current.id, outcomes, [], closed, current.version) };
}

/** Closes every live region of a page (a revert or a change of format replaced the whole page): rows deleted, editors told. */
export async function closeLiveRegions(tx: Queryable, artifactId: string): Promise<void> {
  const rows = await lockedRegionRows(tx, artifactId);
  if (!rows.length) return;
  await deleteRegionRows(tx, artifactId);
  await notifyRegions(tx, artifactId, 'closed');
}


/**
 * LIVE DATASET TEXT CELLS on the server (contract: @artifactbin/contracts region-sessions CellScope): a cell is a
 * session scope beside a page region, kept in the same rows (artifact_id = the DATASET, region_id =
 * `cell:<row _id>:<source column>`, kind `text`), opened, updated and streamed through the same core (./sessions
 * sessionCore). What differs is who may and what a save is.
 *
 *  - WHO: a signed-in reader of the page, through a live link of the page's saved head, whose dataset role through
 *    the page and the policy's update rule admit that row and column (lib/dataset-permissions canUpdateCell), on a
 *    column the owner made collaborative. Decided before every open and update (outside the transaction: the
 *    decision reads the dataset rows) and on every stream wakeup (./cell-stream); anything else is the uniform 404.
 *  - RECONCILE: every other write to the dataset (GraphQL, SQL, an upload, a revert) moves its version. Whenever a
 *    cell's row was last reconciled at another version, the value the dataset now holds is merged three-way into the
 *    live text from the value the cell last saw (its snapshot, kept as version 0) — so typing survives — or, when the
 *    row is gone, the cell's rows are deleted and its editors told (`closed`, `removed`).
 *  - SAVE: the merged text of every dirty cell the caller may write is written through the dataset's one write path
 *    (lib/dataset-graphql writeDatasetCells: one dataset version, the caller's rules, guarded on the head the merge
 *    was made from; a write landing first is merged in and the save tried again). The rows are marked saved inside
 *    that commit.
 */
import * as Y from 'yjs';
import { parseCellKey, REGION_UPDATE_MAX_BYTES, type CellScope, type HtmlDatasetLink, type HtmlPageLink, type RegionOpenReply, type RegionUpdateReply } from '@artifactbin/contracts';
import { applyCellRevision, cellValue, createCellState, snapshotValue } from '@/lib/live-regions';
import { canReadArtifact, getArtifactById, liveRegionDoc, lockedRegionRows, logRegionUpdate, notifyRegions, type ArtifactRow, type RegionRow } from '@/lib/artifacts';
import { canUpdateCell, datasetWriteAccess } from '@/lib/dataset-permissions';
import { locateDatasetCell, writeDatasetCells, type DatasetCell } from '@/lib/dataset-graphql';
import type { AccessActor } from '@/lib/accounts';
import { ID_RE, type Db, type Queryable } from '@/lib/platform';
import { base64, NOT_FOUND, refuse, type RegionAnswer, type SessionCore, type Tx } from './sessions';

/** The row key of a cell in its dataset. */
const cellStorageId = (rowId: string, source: string): string => `cell:${rowId}:${source}`;
const STORAGE = /^cell:(r_[A-Za-z0-9_-]{1,128}):([\s\S]+)$/;
const parseCellStorage = (regionId: string): { rowId: string; source: string } | null => {
  const match = STORAGE.exec(regionId);
  return match ? { rowId: match[1]!, source: match[2]! } : null;
};

/** The server's attribution of a merged-in dataset write: nobody's client. */
const SYSTEM = { userId: null, tokenId: null };
const SAVE_ATTEMPTS = 4;
const bytes = (value: Uint8Array): Buffer => Buffer.from(value.buffer, value.byteOffset, value.byteLength);
const clientOf = (update: Uint8Array): number => Y.decodeUpdate(update).structs[0]?.id.client ?? 0;

export interface CellAccess {
  page: ArtifactRow;
  dataset: ArtifactRow;
  cell: DatasetCell;
  /** The row key (region_id) in the dataset. */
  storage: string;
}
export type CellRefusal = 'not_found' | 'access' | 'removed';

/** The live dataset links of a page's saved head. */
export const liveDatasetLinks = (page: ArtifactRow): HtmlDatasetLink[] =>
  ((page.meta as { htmlLinks?: HtmlPageLink[] }).htmlLinks ?? []).filter((link): link is HtmlDatasetLink => link.kind === 'dataset' && link.mode === 'live');

/** The page as a cell writer reaches it: html, readable by a signed-in actor. */
export async function cellPage(actor: AccessActor, pageId: string): Promise<ArtifactRow | null> {
  if (!actor.userId || !ID_RE.test(pageId)) return null;
  const page = await getArtifactById(pageId);
  return page && page.format === 'html' && await canReadArtifact(page, actor) ? page : null;
}

/** May `actor` write this cell of `dataset` through `page`? The decision every door and wakeup asks. */
async function cellAccess(actor: AccessActor, page: ArtifactRow, dataset: ArtifactRow, rowId: string, column: { field: string } | { source: string }): Promise<CellAccess | CellRefusal> {
  if (dataset.format !== 'dataset') return 'not_found';
  const cell = await locateDatasetCell(dataset, rowId, column);
  if (cell === 'no_row') return 'removed';
  if (cell === 'no_column' || !cell.collaborative) return 'not_found';
  const decision = await datasetWriteAccess(dataset, actor, { pageId: page.id });
  if (!canUpdateCell(decision, cell.table, cell.source, cell.row)) return 'access';
  return { page, dataset, cell, storage: cellStorageId(rowId, cell.source) };
}

/** A cell key through a page: the page's link of that name, live, to a dataset; then cellAccess. */
export async function resolveCell(actor: AccessActor, pageId: string, scope: CellScope, page?: ArtifactRow | null): Promise<CellAccess | CellRefusal> {
  const reader = page === undefined ? await cellPage(actor, pageId) : page;
  if (!reader) return 'not_found';
  const link = liveDatasetLinks(reader).find((candidate) => candidate.name === scope.dataset);
  if (!link) return 'not_found';
  const dataset = await getArtifactById(link.datasetId);
  if (!dataset) return 'removed';
  return cellAccess(actor, reader, dataset, scope.rowId, { field: scope.column });
}

/** The dataset head's version, locked FOR SHARE (a dataset write holds it FOR UPDATE at commit); null when gone. */
async function datasetVersion(tx: Queryable, datasetId: string): Promise<number | null> {
  return (await tx.query<{ version: number }>('SELECT version FROM artifacts WHERE id = $1 AND deleted_at IS NULL FOR SHARE', [datasetId])).rows[0]?.version ?? null;
}

async function deleteCellRows(tx: Queryable, datasetId: string, regionId: string): Promise<void> {
  for (const table of ['region_updates', 'region_snapshots', 'region_states']) await tx.query(`DELETE FROM ${table} WHERE artifact_id = $1 AND region_id = $2`, [datasetId, regionId]);
  await notifyRegions(tx, datasetId, `closed:${regionId}`);
}

async function snapshotOf(tx: Queryable, datasetId: string, regionId: string): Promise<Uint8Array | null> {
  return (await tx.query<{ snapshot: Uint8Array }>('SELECT snapshot FROM region_snapshots WHERE artifact_id = $1 AND region_id = $2 AND version = 0', [datasetId, regionId])).rows[0]?.snapshot ?? null;
}
async function keepSnapshot(tx: Queryable, datasetId: string, regionId: string, snapshot: Uint8Array): Promise<void> {
  await tx.query(
    `INSERT INTO region_snapshots (artifact_id, region_id, version, snapshot) VALUES ($1, $2, 0, $3)
     ON CONFLICT (artifact_id, region_id, version) DO UPDATE SET snapshot = EXCLUDED.snapshot, created_at = now()`,
    [datasetId, regionId, bytes(snapshot)],
  );
}

/**
 * RECONCILE a locked cell row with the dataset at `version`, whose cell holds `value`: the value merged three-way
 * from the cell's last seen value (logged as one update, attributed to nobody, and woken), or only the version noted
 * when the value is the one it saw. Returns the live document and the row's sequence after it.
 */
async function reconcileCell(tx: Queryable, datasetId: string, row: RegionRow, value: string, version: number, doc?: Y.Doc): Promise<{ doc: Y.Doc; seq: number }> {
  const live = doc ?? await liveRegionDoc(tx, datasetId, row);
  if (row.saved_version === version) return { doc: live, seq: row.last_seq };
  const saved = await snapshotOf(tx, datasetId, row.region_id);
  if (saved && snapshotValue(live, saved) === value) {
    await tx.query('UPDATE region_states SET saved_version = $3 WHERE artifact_id = $1 AND region_id = $2', [datasetId, row.region_id, version]);
    return { doc: live, seq: row.last_seq };
  }
  const revision = applyCellRevision({ live: Y.encodeStateAsUpdate(live), savedSnapshot: saved, value });
  const seq = row.last_seq + 1;
  Y.applyUpdate(live, revision.update);
  await logRegionUpdate(tx, datasetId, row.region_id, seq, clientOf(revision.update), revision.update, SYSTEM);
  await tx.query('UPDATE region_states SET last_seq = $3, saved_version = $4 WHERE artifact_id = $1 AND region_id = $2', [datasetId, row.region_id, seq, version]);
  await keepSnapshot(tx, datasetId, row.region_id, revision.snapshot);
  await notifyRegions(tx, datasetId, `${row.region_id}:${seq}`);
  return { doc: live, seq };
}

export interface CellStore {
  open(actor: AccessActor, pageId: string, key: string): Promise<RegionAnswer<RegionOpenReply>>;
  update(actor: AccessActor, pageId: string, key: string, request: { clientId: number; update: Uint8Array }): Promise<RegionAnswer<RegionUpdateReply>>;
  /**
   * Saves the dirty cells `actor` may write, of every dataset the page links live (or, with `idleBefore`, only when
   * one of a dataset's dirty cells has been quiet since then). Answers how many dataset versions it made.
   */
  flush(actor: AccessActor, pageId: string, options?: { idleBefore?: string }): Promise<RegionAnswer<{ saved: number }>>;
  /** Brings one cell's rows to its dataset's head (a stream wakeup): reconciled, or closed when its row is gone. */
  reconcile(access: CellAccess): Promise<void>;
}

export function cellStore(db: () => Promise<Db>, core: SessionCore): CellStore {
  /**
   * Runs `work` on the cell's locked row at the dataset version `access` was decided at, reconciled first. A dataset
   * that moved meanwhile is decided again (a few times), so the merge always uses the value of the version it locks.
   */
  async function atHead<T>(actor: AccessActor, pageId: string, scope: CellScope, work: (tx: Tx, access: CellAccess, row: RegionRow | undefined, doc: Y.Doc | undefined) => Promise<{ answer: RegionAnswer<T>; after?: () => void }>): Promise<RegionAnswer<T>> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const access = await resolveCell(actor, pageId, scope);
      if (typeof access === 'string') return NOT_FOUND;
      let raced = false;
      const answer = await core.transact<T>(async (tx) => {
        if (await datasetVersion(tx, access.dataset.id) !== access.dataset.version) { raced = true; return { answer: NOT_FOUND }; }
        const [row] = await lockedRegionRows(tx, access.dataset.id, access.storage);
        if (!row) return work(tx, access, undefined, undefined);
        const reconciled = row.saved_version === access.dataset.version ? undefined : await reconcileCell(tx, access.dataset.id, row, access.cell.value, access.dataset.version);
        if (reconciled) core.forget(access.dataset.id, row.region_id);
        const current = reconciled ? { ...row, last_seq: reconciled.seq, saved_version: access.dataset.version } : row;
        return work(tx, access, current, reconciled?.doc);
      });
      if (!raced) return answer;
    }
    return refuse('out_of_order');
  }

  async function saveDataset(actor: AccessActor, page: ArtifactRow, datasetId: string, idleBefore?: string): Promise<number> {
    const base = await db();
    const dirty = (await base.query<{ region_id: string; last_update_at: string | null }>(
      "SELECT region_id, last_update_at FROM region_states WHERE artifact_id = $1 AND region_id LIKE 'cell:%' AND dirty_since IS NOT NULL ORDER BY region_id", [datasetId],
    )).rows;
    if (!dirty.length) return 0;
    if (idleBefore !== undefined && !dirty.some((row) => row.last_update_at !== null && Date.parse(row.last_update_at) <= Date.parse(idleBefore))) return 0;
    let saved = 0;
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const dataset = await getArtifactById(datasetId);
      if (!dataset) return saved;
      const writable: CellAccess[] = [];
      for (const { region_id } of dirty) {
        const at = parseCellStorage(region_id);
        if (!at) continue;
        const access = await cellAccess(actor, page, dataset, at.rowId, { source: at.source });
        if (access === 'removed') await core.transact(async (tx) => { await reconcileGone(tx, datasetId, region_id); return { answer: NOT_FOUND }; });
        else if (typeof access !== 'string') writable.push(access);
      }
      if (!writable.length) return saved;
      // One table per dataset step (a step writes one table); the first table's cells now, the rest on the next pass.
      const table = writable[0]!.cell.tableId;
      const batch = writable.filter((access) => access.cell.tableId === table);
      /** Each cell's merged text at the sequence it was read at, reconciled with this head. */
      const merged: { access: CellAccess; doc: Y.Doc; seq: number; value: string }[] = [];
      const read = await core.transact<null>(async (tx) => {
        if (await datasetVersion(tx, datasetId) !== dataset.version) return { answer: refuse('out_of_order') };
        for (const access of batch) {
          const [row] = await lockedRegionRows(tx, datasetId, access.storage);
          if (!row || row.dirty_since === null) continue;
          const { doc, seq } = await reconcileCell(tx, datasetId, row, access.cell.value, dataset.version);
          const value = cellValue(doc);
          if (value === access.cell.value && seq === row.last_seq) {
            // Typed back to what is stored: nothing to write, the cell is clean.
            await tx.query('UPDATE region_states SET state = $3, state_seq = $4, dirty_since = NULL WHERE artifact_id = $1 AND region_id = $2', [datasetId, row.region_id, bytes(Y.encodeStateAsUpdate(doc)), seq]);
            await keepSnapshot(tx, datasetId, row.region_id, Y.encodeSnapshot(Y.snapshot(doc)));
            continue;
          }
          merged.push({ access, doc, seq, value });
        }
        return { answer: { status: 200, body: null } };
      });
      if (read.status !== 200) continue;
      if (!merged.length) return saved;
      const outcome = await writeDatasetCells(actor, dataset, page.id, batch[0]!.cell, merged.map(({ access, value }) => ({ rowId: access.cell.rowId, source: access.cell.source, value })), async (commit, written) => {
        const tx = commit as unknown as Queryable;
        for (const { access, doc, seq } of merged) {
          await lockedRegionRows(tx, datasetId, access.storage);
          await tx.query(
            `UPDATE region_states SET state = CASE WHEN state_seq <= $3 THEN $4 ELSE state END, state_seq = GREATEST(state_seq, $3), saved_version = $5,
               dirty_since = CASE WHEN last_seq > $3 THEN dirty_since ELSE NULL END
             WHERE artifact_id = $1 AND region_id = $2`,
            [datasetId, access.storage, seq, bytes(Y.encodeStateAsUpdate(doc)), written.version],
          );
          await keepSnapshot(tx, datasetId, access.storage, Y.encodeSnapshot(Y.snapshot(doc)));
          core.forget(datasetId, access.storage);
        }
        // Live cells the write did not touch hold the value they saw: they are at the new version too.
        await tx.query("UPDATE region_states SET saved_version = $3 WHERE artifact_id = $1 AND region_id LIKE 'cell:%' AND saved_version = $2", [datasetId, dataset.version, written.version]);
        await notifyRegions(tx, datasetId, `saved:${written.version}`);
      });
      if ('written' in outcome) { saved++; if (writable.length === batch.length) return saved; continue; }
      if (outcome.refused !== 'row_changed') { console.warn('[region-sessions] a cell save was refused:', outcome.detail); return saved; }
    }
    return saved;
  }

  /** A cell whose row is gone: its rows deleted and its editors told. */
  async function reconcileGone(tx: Queryable, datasetId: string, regionId: string): Promise<void> {
    const [row] = await lockedRegionRows(tx, datasetId, regionId);
    if (row) await deleteCellRows(tx, datasetId, regionId);
  }

  return {
    async open(actor, pageId, key) {
      const scope = parseCellKey(key);
      if (!scope) return NOT_FOUND;
      return atHead<RegionOpenReply>(actor, pageId, scope, async (tx, access, row, reconciled) => {
        const datasetId = access.dataset.id;
        let locked = row;
        if (!locked) {
          const initial = createCellState(access.cell.value);
          await tx.query(
            'INSERT INTO region_states (artifact_id, region_id, kind, state, saved_version) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [datasetId, access.storage, 'text', bytes(initial.state), access.dataset.version],
          );
          await keepSnapshot(tx, datasetId, access.storage, initial.snapshot);
          [locked] = await lockedRegionRows(tx, datasetId, access.storage);
        }
        const doc = reconciled ?? await core.documentOf(tx, datasetId, locked!);
        const { clientId, seq, after } = await core.issue(tx, datasetId, locked!, doc, actor);
        return { answer: { status: 200, body: { regionId: key, kind: 'text', clientId, seq, state: base64(Y.encodeStateAsUpdate(doc)), savedVersion: access.dataset.version } }, after };
      });
    },

    async update(actor, pageId, key, request) {
      const scope = parseCellKey(key);
      if (!scope) return NOT_FOUND;
      if (request.update.byteLength > REGION_UPDATE_MAX_BYTES) return refuse('too_large');
      return atHead<RegionUpdateReply>(actor, pageId, scope, async (tx, access, row) => {
        if (!row) return { answer: refuse('region_not_found') };
        return core.accept(tx, access.dataset.id, row, request, actor);
      });
    },

    async flush(actor, pageId, options = {}) {
      const page = await cellPage(actor, pageId);
      if (!page) return NOT_FOUND;
      let saved = 0;
      for (const datasetId of new Set(liveDatasetLinks(page).map((link) => link.datasetId))) saved += await saveDataset(actor, page, datasetId, options.idleBefore);
      return { status: 200, body: { saved } };
    },

    async reconcile(access) {
      await core.transact<null>(async (tx) => {
        if (await datasetVersion(tx, access.dataset.id) !== access.dataset.version) return { answer: NOT_FOUND };
        const [row] = await lockedRegionRows(tx, access.dataset.id, access.storage);
        if (row && row.saved_version !== access.dataset.version) {
          await reconcileCell(tx, access.dataset.id, row, access.cell.value, access.dataset.version);
          core.forget(access.dataset.id, row.region_id);
        }
        return { answer: NOT_FOUND };
      });
    },
  };
}

/** Closes a cell whose row the dataset no longer holds (a stream wakeup found it removed). */
export async function closeRemovedCell(db: () => Promise<Db>, datasetId: string, regionId: string): Promise<void> {
  await (await db()).transaction(async (tx) => {
    const [row] = await lockedRegionRows(tx, datasetId, regionId);
    if (row) await deleteCellRows(tx, datasetId, regionId);
  });
}

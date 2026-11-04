/**
 * THE CELL STREAM (`GET /api/artifacts/:id/regions/stream?after=cell:<link>:<row>:<field>:<seq>,...`): the regions
 * stream's frames (contract RegionStreamFrame `updates`, `reset`, `closed`) for the dataset text cells one reader of a
 * page follows. Wakeups are pointers, as for regions: each dataset's regions channel (an update, a save, a merged-in
 * write) and artifact channel (any write, a sharing or policy change), and the page's artifact channel (a new head
 * may drop a link). Every wakeup decides again, for each cell: lost authority is `closed` `access`, a row the dataset
 * no longer holds `closed` `removed`, and a dataset that moved is reconciled into the cell before catching up.
 *
 * Saving on events (./stream's membership under `cells:<page id>`): each reader leaving saves the cells it may write
 * (after the grace), and the idle backstop saves a dataset's quiet dirty cells as any member allowed to.
 */
import * as Y from 'yjs';
import { artifactChannel, parseCellKey, regionsChannel, type CellScope, type RegionStreamFrame } from '@artifactbin/contracts';
import { liveRegionDoc, regionUpdatesAfter, type RegionRow } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import { base64 } from './sessions';
import { cellPage, closeRemovedCell, liveDatasetLinks, resolveCell, type CellStore } from './cells';
import type { RegionStreamAnswer, RegionStreamOptions, StreamMembership } from './stream';

interface CellFollow { key: string; scope: CellScope; seq: number; opening: boolean; datasetId?: string; storage?: string; createdAt?: string }

const STATE_COLUMNS = 'region_id, kind, state_seq::int AS state_seq, last_seq::int AS last_seq, saved_version, created_at';
const BATCH = 500;

export async function openCellStream(store: CellStore, options: RegionStreamOptions & StreamMembership, actor: AccessActor, pageId: string, cursors: Map<string, number>, signal?: AbortSignal): Promise<RegionStreamAnswer> {
  const { clock } = options;
  const page = await cellPage(actor, pageId);
  if (!page) return { status: 'not_found' };
  const db = await options.db();
  const follows = new Map<string, CellFollow>([...cursors].map(([key, seq]) => [key, { key, scope: parseCellKey(key)!, seq, opening: true }]));
  const named = new Set([...follows.values()].map((follow) => follow.scope.dataset));
  const datasets = [...new Set(liveDatasetLinks(page).filter((link) => named.has(link.name)).map((link) => link.datasetId))];

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  let closed = false;
  const write = (text: string) => writer.write(encoder.encode(text)).catch(() => void close());
  const send = (frame: RegionStreamFrame) => write(`data: ${JSON.stringify(frame)}\n\n`);
  const watchKey = `cells:${pageId}`;
  const member = { actor };
  const unsubscribes: (() => Promise<void>)[] = [];
  let keepalive: unknown;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clock.clearInterval(keepalive);
    for (const drop of unsubscribes) await drop().catch(() => {});
    options.leave(watchKey, member);
    await writer.close().catch(() => {});
  }

  async function catchUp(): Promise<void> {
    const reader = await cellPage(actor, pageId);
    if (!reader) {
      for (const key of follows.keys()) await send({ type: 'closed', regionId: key, reason: 'access' });
      return close();
    }
    for (const [key, follow] of follows) {
      if (closed) return;
      const access = await resolveCell(actor, pageId, follow.scope, reader);
      if (typeof access === 'string') {
        follows.delete(key);
        if (access === 'removed' && follow.datasetId && follow.storage) await closeRemovedCell(options.db, follow.datasetId, follow.storage);
        await send({ type: 'closed', regionId: key, reason: access === 'removed' ? 'removed' : 'access' });
        continue;
      }
      const datasetId = access.dataset.id;
      let row = (await db.query<Omit<RegionRow, 'state' | 'dirty_since' | 'last_update_at'>>(`SELECT ${STATE_COLUMNS} FROM region_states WHERE artifact_id = $1 AND region_id = $2`, [datasetId, access.storage])).rows[0];
      if (row && row.saved_version !== access.dataset.version) {
        await store.reconcile(access);
        row = (await db.query<Omit<RegionRow, 'state' | 'dirty_since' | 'last_update_at'>>(`SELECT ${STATE_COLUMNS} FROM region_states WHERE artifact_id = $1 AND region_id = $2`, [datasetId, access.storage])).rows[0];
      }
      if (!row || (follow.createdAt !== undefined && (row.created_at !== follow.createdAt || datasetId !== follow.datasetId))) {
        follows.delete(key);
        await send({ type: 'closed', regionId: key, reason: 'removed' });
        continue;
      }
      follow.datasetId = datasetId;
      follow.storage = access.storage;
      follow.createdAt = row.created_at;
      let reset = (follow.opening && follow.seq < row.state_seq) || follow.seq > row.last_seq;
      follow.opening = false;
      while (!reset && follow.seq < row.last_seq) {
        const logged = await regionUpdatesAfter(db, datasetId, access.storage, follow.seq, BATCH);
        if (!logged.length) break;
        if (logged[0]!.seq !== follow.seq + 1) { reset = true; break; }
        await send({ type: 'updates', regionId: key, from: logged[0]!.seq, to: logged.at(-1)!.seq, updates: logged.map(({ update }) => base64(update)) });
        follow.seq = logged.at(-1)!.seq;
        if (logged.length < BATCH) break;
      }
      if (reset) {
        const full = (await db.query<RegionRow>(`SELECT ${STATE_COLUMNS}, state FROM region_states WHERE artifact_id = $1 AND region_id = $2`, [datasetId, access.storage])).rows[0];
        if (!full) continue;
        const doc = await liveRegionDoc(db, datasetId, full);
        follow.seq = full.last_seq;
        await send({ type: 'reset', regionId: key, seq: full.last_seq, state: base64(Y.encodeStateAsUpdate(doc)) });
      }
    }
  }

  let running: Promise<void> | null = null, again = false;
  const wake = (): void => {
    if (closed) return;
    if (running) { again = true; return; }
    running = (async () => {
      do { again = false; await catchUp(); } while (again && !closed);
    })().catch((error) => { console.warn('[region-sessions] cell stream catch-up failed', error); void close(); }).finally(() => { running = null; });
  };

  const lost = () => void close();
  try {
    unsubscribes.push(await options.subscribe(artifactChannel(pageId), wake, lost));
    for (const datasetId of datasets) {
      unsubscribes.push(await options.subscribe(regionsChannel(datasetId), wake, lost));
      unsubscribes.push(await options.subscribe(artifactChannel(datasetId), wake, lost));
    }
  } catch {
    for (const drop of unsubscribes) await drop().catch(() => {});
    return { status: 'busy' };
  }
  options.join(watchKey, member, { save: (who, saveOptions) => store.flush(who, pageId, saveOptions), eachLeaves: true });
  keepalive = clock.setInterval(() => { void write(options.keepaliveFrame()); wake(); }, options.keepaliveMs);
  signal?.addEventListener('abort', () => void close(), { once: true });
  void writer.closed.catch(() => void close());
  wake();
  return { status: 'open', stream: readable };
}

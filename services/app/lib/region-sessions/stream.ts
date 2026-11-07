/**
 * THE EDITORS' STREAM (`GET /api/artifacts/:id/regions/stream?after=<regionId>:<seq>,...`): one Server-Sent-Events
 * stream per page per editor, carrying the regions it names (contract RegionStreamFrame). A NOTIFY on the page's
 * regions channel or its artifact channel is only a pointer: every wakeup catches up from the rows, so a missed one
 * costs nothing, and the keepalive tick wakes it too.
 *
 *  - Catch-up: the updates logged after the stream's position, in order. An opening cursor older than the folded
 *    state (or ahead of the log) is answered with `reset` (the whole state); later, only a hole in the log is.
 *  - `saved` when the page's version moves (each region's sequence the version holds); `closed` when a region's rows
 *    went (removed, or its kind changed) or, for every region, when the editor lost edit access (the stream ends).
 *  - Saving on events: when the last editor stream of a page in this process closes (after a short grace, so a
 *    reconnect is not a leave) its unsaved edits are saved; while streams are open, a region dirty and quiet for
 *    REGION_IDLE_SAVE_MS is saved by the idle backstop (typing that never pauses is never cut: readers follow the live
 *    text itself, lib/artifacts current-page). Both go through the store's save, which locks the page FOR UPDATE: a
 *    second process racing it finds nothing left to save.
 */
import { artifactChannel, isCellKey, regionsChannel, type RegionStreamFrame } from '@artifactbin/contracts';
import { editableRegions, isRegionId, type RegionKind } from '@/lib/live-regions';
import { editablePage, liveRegionDoc, regionUpdatesAfter, type RegionRow, type SaveDue } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import { ID_RE, type Db } from '@/lib/platform';
import * as Y from 'yjs';
import { base64, type RegionStore } from './sessions';
import { openCellStream } from './cell-stream';
import type { CellStore } from './cells';

/** Timers and time, injectable so a test can drive the idle backstop. */
export interface RegionClock {
  now(): number;
  setInterval(work: () => void, ms: number): unknown;
  clearInterval(timer: unknown): void;
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface RegionStreamOptions {
  db: () => Promise<Db>;
  /** One shared LISTEN per channel (lib/publish subscribeChannel); throws when the process watches too many. */
  subscribe(channel: string, handler: (payload: string) => void, onLost: () => void): Promise<() => Promise<void>>;
  /** The live doors' heartbeat frame (lib/http liveKeepaliveFrame). */
  keepaliveFrame(): string;
  clock: RegionClock;
  keepaliveMs: number;
  idleSaveMs: number;
  idleCheckMs: number;
  leaveGraceMs: number;
}

export type RegionStreamAnswer = { status: 'not_found' } | { status: 'invalid' } | { status: 'busy' } | { status: 'open'; stream: ReadableStream<Uint8Array> };

/** `r1:12,r2:40` → cursors; null when any entry is malformed. */
function parseCursors(after: string | null): Map<string, number> | null {
  const cursors = new Map<string, number>();
  if (!after) return cursors;
  for (const entry of after.split(',')) {
    const at = entry.lastIndexOf(':');
    const regionId = entry.slice(0, at), seq = Number(entry.slice(at + 1));
    if (at < 1 || !(isRegionId(regionId) || isCellKey(regionId)) || !Number.isSafeInteger(seq) || seq < 0 || cursors.has(regionId)) return null;
    cursors.set(regionId, seq);
  }
  // A stream follows regions or cells, never both (a cell's reader need not edit the page).
  const cells = [...cursors.keys()].filter(isCellKey).length;
  return cursors.size <= 64 && (cells === 0 || cells === cursors.size) ? cursors : null;
}

interface Follow { seq: number; opening: boolean; kind?: RegionKind; createdAt?: string }
/** What a watched page saves on leave and on idle: its regions, or (`cells:<id>`) the cells its readers type in. */
export interface WatchSaver {
  save(actor: AccessActor, options?: { due?: SaveDue }): Promise<{ status: number }>;
  /** Anything due (lib/artifacts saveIsDue)? (default: ask the save) */
  isDue?(due: SaveDue): Promise<boolean>;
  /** Save as each member leaves (its cells may be ones nobody else may write), not only as the last. */
  eachLeaves?: boolean;
}
interface PageWatch { streams: Set<{ actor: AccessActor }>; idle?: unknown; leave?: unknown; saver: WatchSaver; leaving?: Set<unknown> }
export interface StreamMembership {
  join(key: string, member: { actor: AccessActor }, saver: WatchSaver): void;
  leave(key: string, member: { actor: AccessActor }): void;
}

const STATE_COLUMNS = 'region_id, kind, state_seq::int AS state_seq, last_seq::int AS last_seq, saved_version, created_at';
const BATCH = 500;

export function regionStreams(store: RegionStore, options: RegionStreamOptions, cells?: CellStore) {
  const { clock } = options;
  const pages = new Map<string, PageWatch>();
  /** Background saves still running (a test awaits them through `settle`). */
  const background = new Set<Promise<unknown>>();
  const inBackground = (work: () => Promise<unknown>) => {
    const running = work().catch((error) => console.warn('[region-sessions] background save failed', error)).finally(() => background.delete(running));
    background.add(running);
  };

  /** The idle backstop: one check per page per process while any of its streams is open. */
  /** A page's regions: dirty and quiet rows of the page itself, saved by any editor. */
  const regionSaver = (artifactId: string): WatchSaver => ({
    save: (actor, saveOptions) => store.flush(actor, artifactId, saveOptions),
    async isDue(due) {
      const db = await options.db();
      return (await db.query('SELECT 1 FROM region_states WHERE artifact_id = $1 AND dirty_since IS NOT NULL AND last_update_at <= $2 LIMIT 1', [artifactId, due.quietBefore])).rows.length > 0;
    },
  });

  async function idleSave(artifactId: string): Promise<void> {
    const watch = pages.get(artifactId);
    if (!watch?.streams.size) return;
    const due: SaveDue = { quietBefore: new Date(clock.now() - options.idleSaveMs).toISOString() };
    if (watch.saver.isDue && !await watch.saver.isDue(due)) return;
    for (const { actor } of [...watch.streams]) if ((await watch.saver.save(actor, { due })).status === 200 && !watch.saver.eachLeaves) return;
  }

  function join(artifactId: string, member: { actor: AccessActor }, saver: WatchSaver = regionSaver(artifactId)): void {
    let watch = pages.get(artifactId);
    if (!watch) pages.set(artifactId, watch = { streams: new Set(), saver });
    if (watch.leave !== undefined) { clock.clearTimeout(watch.leave); watch.leave = undefined; }
    watch.streams.add(member);
    watch.idle ??= clock.setInterval(() => inBackground(() => idleSave(artifactId)), options.idleCheckMs);
  }

  const sameActor = (a: AccessActor, b: AccessActor) => a.userId === b.userId && (a.tokenId || '') === (b.tokenId || '');
  function leave(artifactId: string, member: { actor: AccessActor }): void {
    const watch = pages.get(artifactId);
    if (!watch?.streams.delete(member)) return;
    if (watch.streams.size) {
      if (!watch.saver.eachLeaves) return;
      // Cells: a member leaving saves what it may write, unless it comes back (or has another stream) within the grace.
      const timer = clock.setTimeout(() => {
        watch.leaving?.delete(timer);
        if ([...watch.streams].some((other) => sameActor(other.actor, member.actor))) return;
        inBackground(() => watch.saver.save(member.actor));
      }, options.leaveGraceMs);
      (watch.leaving ??= new Set()).add(timer);
      return;
    }
    clock.clearInterval(watch.idle);
    watch.idle = undefined;
    watch.leave = clock.setTimeout(() => {
      if (pages.get(artifactId) !== watch || watch.streams.size) return;
      pages.delete(artifactId);
      inBackground(() => watch.saver.save(member.actor));
    }, options.leaveGraceMs);
  }

  async function open(actor: AccessActor, artifactId: string, after: string | null, signal?: AbortSignal): Promise<RegionStreamAnswer> {
    if (!ID_RE.test(artifactId)) return { status: 'not_found' };
    const cursors = parseCursors(after);
    if (!cursors) return { status: 'invalid' };
    if (cursors.size && isCellKey(cursors.keys().next().value)) {
      if (!cells) return { status: 'not_found' };
      return openCellStream(cells, { ...options, join, leave }, actor, artifactId, cursors, signal);
    }
    const db = await options.db();
    const initial = await editablePage(db, actor, artifactId);
    if (!initial || initial.format !== 'html') return { status: 'not_found' };

    const follows = new Map<string, Follow>([...cursors].map(([regionId, seq]) => [regionId, { seq, opening: true }]));
    let lastVersion = initial.version;
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let closed = false;
    const write = (text: string) => writer.write(encoder.encode(text)).catch(() => void close());
    const send = (frame: RegionStreamFrame) => write(`data: ${JSON.stringify(frame)}\n\n`);

    const unsubscribes: (() => Promise<void>)[] = [];
    const member = { actor };
    let keepalive: unknown;
    async function close(): Promise<void> {
      if (closed) return;
      closed = true;
      clock.clearInterval(keepalive);
      for (const drop of unsubscribes) await drop().catch(() => {});
      leave(artifactId, member);
      await writer.close().catch(() => {});
    }

    /** Why a followed region's rows are gone: the head no longer declares it, or declares it with another kind. */
    let declared: Map<string, RegionKind> | null = null;
    const reasonFor = async (regionId: string, kind: RegionKind | undefined): Promise<'removed' | 'kind_changed'> => {
      if (!declared) {
        const page = await editablePage(db, actor, artifactId, { source: true });
        declared = new Map(page?.format === 'html' ? editableRegions(page.source ?? '').map((region) => [region.id, region.kind]) : []);
      }
      const now = declared.get(regionId);
      return now && kind && now !== kind ? 'kind_changed' : 'removed';
    };

    async function catchUp(): Promise<void> {
      const head = await editablePage(db, actor, artifactId);
      if (!head) {
        for (const regionId of follows.keys()) await send({ type: 'closed', regionId, reason: 'access' });
        return close();
      }
      declared = null;
      const rows = new Map((await db.query<Omit<RegionRow, 'state' | 'dirty_since' | 'last_update_at'>>(
        `SELECT ${STATE_COLUMNS} FROM region_states WHERE artifact_id = $1 AND region_id = ANY($2::text[])`, [artifactId, [...follows.keys()]],
      )).rows.map((row) => [row.region_id, row]));
      for (const [regionId, follow] of follows) {
        if (closed) return;
        const row = rows.get(regionId);
        if (!row || (follow.createdAt !== undefined && (row.created_at !== follow.createdAt || row.kind !== follow.kind))) {
          follows.delete(regionId);
          await send({ type: 'closed', regionId, reason: row && row.kind !== follow.kind ? 'kind_changed' : await reasonFor(regionId, follow.kind) });
          continue;
        }
        follow.kind = row.kind;
        follow.createdAt = row.created_at;
        let reset = (follow.opening && follow.seq < row.state_seq) || follow.seq > row.last_seq;
        follow.opening = false;
        while (!reset && follow.seq < row.last_seq) {
          const logged = await regionUpdatesAfter(db, artifactId, regionId, follow.seq, BATCH);
          if (!logged.length) break;
          if (logged[0]!.seq !== follow.seq + 1) { reset = true; break; }
          await send({ type: 'updates', regionId, from: logged[0]!.seq, to: logged.at(-1)!.seq, updates: logged.map(({ update }) => base64(update)) });
          follow.seq = logged.at(-1)!.seq;
          if (logged.length < BATCH) break;
        }
        if (reset) {
          const full = (await db.query<RegionRow>(`SELECT ${STATE_COLUMNS}, state FROM region_states WHERE artifact_id = $1 AND region_id = $2`, [artifactId, regionId])).rows[0];
          if (!full) continue;
          const doc = await liveRegionDoc(db, artifactId, full);
          follow.seq = full.last_seq;
          await send({ type: 'reset', regionId, seq: full.last_seq, state: base64(Y.encodeStateAsUpdate(doc)) });
        }
      }
      if (head.version > lastVersion) {
        lastVersion = head.version;
        const saved = (await db.query<{ region_id: string; state_seq: number }>(
          'SELECT region_id, state_seq::int AS state_seq FROM region_states WHERE artifact_id = $1 AND saved_version = $2', [artifactId, head.version],
        )).rows;
        await send({ type: 'saved', version: head.version, regions: Object.fromEntries(saved.map((row) => [row.region_id, row.state_seq])) });
      }
    }

    /** Wakeups coalesce: one catch-up at a time, and one more if anything woke it meanwhile. */
    let running: Promise<void> | null = null, again = false;
    const wake = (): void => {
      if (closed) return;
      if (running) { again = true; return; }
      running = (async () => {
        do { again = false; await catchUp(); } while (again && !closed);
      })().catch((error) => { console.warn('[region-sessions] stream catch-up failed', error); void close(); }).finally(() => { running = null; });
    };

    const lost = () => void close();
    try {
      unsubscribes.push(await options.subscribe(regionsChannel(artifactId), wake, lost));
      unsubscribes.push(await options.subscribe(artifactChannel(artifactId), wake, lost));
    } catch {
      for (const drop of unsubscribes) await drop().catch(() => {});
      return { status: 'busy' };
    }
    join(artifactId, member);
    keepalive = clock.setInterval(() => { void write(options.keepaliveFrame()); wake(); }, options.keepaliveMs);
    signal?.addEventListener('abort', () => void close(), { once: true });
    void writer.closed.catch(() => void close());
    // A heartbeat first: a reader that takes the stream in finite windows (a browser session's scripted browser,
    // services/browser forwardSessionFetch) always gets a complete frame, and reopens from its cursor.
    void write(options.keepaliveFrame());
    wake();
    return { status: 'open', stream: readable };
  }

  return {
    open,
    /** Resolves once every background save started so far has finished. */
    async settle(): Promise<void> { while (background.size) await Promise.all([...background]); },
    /** Stops every timer (tests, shutdown). */
    dispose(): void {
      for (const watch of pages.values()) { clock.clearInterval(watch.idle); clock.clearTimeout(watch.leave); for (const timer of watch.leaving ?? []) clock.clearTimeout(timer); }
      pages.clear();
    },
  };
}


/**
 * REGION SESSIONS: live co-editing of a page's declared regions, on the server (contract: @artifactbin/contracts
 * region-sessions; merge core: lib/live-regions; the region rows as page storage and the save as a version:
 * lib/artifacts).
 *
 *   open    a region: its row created once from the saved HTML (with the saved version's snapshot), a fresh client
 *           id assigned and the full state answered;
 *   update  validated (lib/live-regions validateRegionUpdate) before it is stored or relayed; a retry is a duplicate;
 *   flush   every region with unsaved edits saved as one new page version;
 *   stream  the editors' SSE stream of a page (stream.ts), which also drives the saves on leave and on idle.
 *
 * Only people with edit access to the page (the platform's editor scope) get anything; everyone else is the uniform
 * not-found. The database is the truth and two app processes serialize on its rows; wakeups cross processes through
 * NOTIFY. Composition (the shared LISTEN registry and the heartbeat frame) is the caller's: the routes pass them in.
 */
import { REGION_IDLE_SAVE_MS } from '@artifactbin/contracts';
import type { AccessActor } from '@/lib/accounts';
import { regionStore, type RegionStore } from './sessions';
import { regionStreams, type RegionClock, type RegionStreamAnswer, type RegionStreamOptions } from './stream';

export type { RegionAnswer } from './sessions';

export interface RegionSessionDeps extends Pick<RegionStreamOptions, 'db' | 'subscribe' | 'keepaliveFrame'> {
  clock?: RegionClock;
  keepaliveMs?: number;
  idleSaveMs?: number;
  /** How often open streams look for a quiet dirty region (default a quarter of the idle time). */
  idleCheckMs?: number;
  /** How long a page with no editor stream left waits before saving (a reconnect within it is not a leave). */
  leaveGraceMs?: number;
}

export interface RegionSessions extends RegionStore {
  stream(actor: AccessActor, artifactId: string, after: string | null, signal?: AbortSignal): Promise<RegionStreamAnswer>;
  /** Resolves once the background saves started so far have finished. */
  settle(): Promise<void>;
  dispose(): void;
}

const SYSTEM_CLOCK: RegionClock = {
  now: () => Date.now(),
  setInterval: (work, ms) => setInterval(work, ms),
  clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
  setTimeout: (work, ms) => setTimeout(work, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

/** One process's region sessions over one database. Two instances over one database behave as two app processes. */
export function createRegionSessions(deps: RegionSessionDeps): RegionSessions {
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const idleSaveMs = deps.idleSaveMs ?? REGION_IDLE_SAVE_MS;
  const store = regionStore(deps.db, () => clock.now());
  const streams = regionStreams(store, {
    db: deps.db, subscribe: deps.subscribe, keepaliveFrame: deps.keepaliveFrame, clock,
    keepaliveMs: deps.keepaliveMs ?? 15_000, idleSaveMs, idleCheckMs: deps.idleCheckMs ?? idleSaveMs / 4, leaveGraceMs: deps.leaveGraceMs ?? 5_000,
  });
  return { ...store, stream: streams.open, settle: streams.settle, dispose: streams.dispose };
}

/**
 * Live document wakeups — the down-sync half of concurrent editing.
 *
 * The
 * durable rows are the truth and NOTIFY is only a POINTER saying "go look".
 * Every wakeup triggers a catch-up read, so a NOTIFY lost while nobody is
 * listening changes nothing — correctness comes from the read, never from
 * delivery. One LISTEN per artifact is shared by all subscribers in this
 * process and fans out in memory; the last unsubscribe closes it.
 */
import { annotationsChannel, artifactChannel } from '@artifactbin/contracts';
import { wakeups } from './wakeup';

/** Payload of a wakeup: the artifact's new head pointer. */
type LiveHandler = (editId: string) => void;

interface ChannelSub {
  handlers: Set<LiveHandler>;
  /** Each subscriber's "your subscription died" callback, keyed by its handler. */
  lost: Map<LiveHandler, () => void>;
  /** The adapter-level LISTEN teardown, resolved once. */
  unlisten: () => Promise<void>;
}

// Intentionally process-global: the per-artifact LISTEN fan-out registry,
// bounded by live SSE connections and fully rebuildable (the DB is the truth).
const channels = new Map<string, ChannelSub>();

/**
 * Ceiling on concurrently watched documents in this process. The events
 * endpoint is reachable by anyone who may read the document and long-lived, so
 * without a bound one host could pin an unbounded number of channels and
 * timers. Refusing to watch degrades to "reload to see changes" — it never
 * denies READING the document, which is the part that matters.
 */
export const MAX_LIVE_CHANNELS = 500;

/** Thrown when the process is already watching as many documents as it will. */
export class TooManyLiveChannels extends Error {
  constructor() { super('too many live channels'); }
}


/**
 * Subscribe to an artifact's wakeups. The first subscriber opens the DB
 * LISTEN; the last to leave closes it. Returns an async unsubscribe.
 * `onLost` fires when the LISTEN connection is gone: the subscription will
 * never hear again, so the caller ends its stream (its client reconnects and
 * catches up) — see `subscribeChannel`.
 */
export function subscribeToArtifact(artifactId: string, handler: LiveHandler, onLost?: () => void): Promise<() => Promise<void>> {
  return subscribeChannel(artifactChannel(artifactId), handler, onLost);
}

/** Same machinery, the annotations channel — owner connections only (the route decides that). */
export function subscribeToAnnotations(artifactId: string, handler: LiveHandler, onLost?: () => void): Promise<() => Promise<void>> {
  return subscribeChannel(annotationsChannel(artifactId), handler, onLost);
}

/**
 * One shared LISTEN per channel, fanned out in memory.
 *
 * WHEN THE LISTEN CONNECTION IS LOST the channel's entry is removed AT ONCE
 * and every subscriber is told: otherwise the stale entry would stay, a new
 * subscriber (a reload while another tab holds the document) would join it
 * and never issue a new LISTEN, and every stream on it would keep sending
 * keepalives while no wakeup could ever arrive.
 */
export async function subscribeChannel(channel: string, handler: LiveHandler, onLost?: () => void): Promise<() => Promise<void>> {
  let sub = channels.get(channel);
  if (!sub) {
    // Only a NEW channel can push us over: extra watchers of a document we
    // already follow are just entries in an in-memory Set.
    if (channels.size >= MAX_LIVE_CHANNELS) throw new TooManyLiveChannels();
    const handlers = new Set<LiveHandler>();
    const lost = new Map<LiveHandler, () => void>();
    let created: ChannelSub | undefined;
    const unlisten = await wakeups().subscribe(
      channel,
      (payload) => {
        // Snapshot: a handler may unsubscribe while we iterate.
        for (const h of [...handlers]) {
          try { h(payload); } catch { /* one dead reader must not break the others */ }
        }
      },
      () => {
        if (created && channels.get(channel) === created) channels.delete(channel);
        const told = [...lost.values()];
        handlers.clear();
        lost.clear();
        for (const tell of told) {
          try { tell(); } catch { /* one dead reader must not break the others */ }
        }
      },
    );
    // Another subscriber may have created the entry while this one awaited its LISTEN.
    const raced = channels.get(channel);
    if (raced) {
      try { await unlisten(); } catch { /* ignore */ }
      sub = raced;
    } else {
      sub = created = { handlers, lost, unlisten };
      channels.set(channel, sub);
    }
  }
  const mine = sub;
  mine.handlers.add(handler);
  if (onLost) mine.lost.set(handler, onLost);

  return async () => {
    if (!mine.handlers.delete(handler)) return;
    mine.lost.delete(handler);
    if (mine.handlers.size === 0) {
      if (channels.get(channel) === mine) channels.delete(channel);
      try { await mine.unlisten(); } catch { /* connection already gone */ }
    }
  };
}

/** How many documents this process is currently watching (test/observability seam). */
export const liveChannelCount = (): number => channels.size;

/** Test seam: drop every subscription so a suite can assert on a clean registry. */
export async function resetLiveSubscriptions(): Promise<void> {
  const subs = [...channels.values()];
  channels.clear();
  for (const s of subs) {
    try { await s.unlisten(); } catch { /* ignore */ }
  }
}

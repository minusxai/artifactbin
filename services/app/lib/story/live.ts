/**
 * Live document wakeups — the down-sync half of concurrent editing.
 *
 * Ported in shape from minusx `lib/chat/conversation-stream.server.ts`: the
 * durable rows are the truth and NOTIFY is only a POINTER saying "go look".
 * Every wakeup triggers a catch-up read, so a NOTIFY lost while nobody is
 * listening changes nothing — correctness comes from the read, never from
 * delivery. One LISTEN per artifact is shared by all subscribers in this
 * process and fans out in memory; the last unsubscribe closes it.
 */
import { wakeups } from './wakeup';
import type { JsxNode } from '@/lib/jsx';
import type { StoryIslandDataflow } from '@/lib/story-runtime/contract';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

/**
 * A DATA wakeup: a dataset this document reads was written, so the queries
 * that read it must re-run. Declared here for the same reason as the frame
 * type below.
 */
export interface ArtifactDataEvent {
  /** Dataset artifact ids (today always exactly one — the one that was written). */
  datasets: string[];
  /** The version that dataset reached, for a client that wants to drop a repeat. */
  version: number;
}

/**
 * ONE FRAME OF THE STREAM — the wire contract app/a/[id]/events sends and
 * lib/story/use-live-artifact reads.
 *
 * Both wire types live here, next to the subscription that wakes them,
 * because the reader side is a lib module and a route handler is no place to
 * declare a shape that lib/ must import — that dependency runs backwards and
 * is quietly untestable.
 */
/** What the stream sends on a version: the head's identity, nothing else. */
export interface ArtifactVersionPing {
  editId: string;
  version: number;
  /** The handle of the account that made this version, or null. */
  by: string | null;
}

export interface ArtifactLiveEvent {
  editId: string;
  version: number;
  /**
   * The handle of the account that made this version, or null (a token, an
   * unnamed account, a version that predates attribution). A collaborator's
   * open document can say WHO moved it under them.
   */
  by: string | null;
  format: string;
  title: string | null;
  /** markup source (the document tier) — null for other tiers. */
  source: string | null;
  /**
   * dataset/viz content, which the page previews inline. image is
   * deliberately absent: it renders straight from ./raw, so the client only
   * needs to know the document changed (the editId) to refetch.
   */
  content: string | null;
  /**
   * OMITTED when it has not changed since the last frame on this connection.
   * The compiled stylesheet is ~65KB and changes only when new Tailwind
   * classes appear, so sending it with every keystroke-sized edit would
   * dominate the stream. `null` still means "there is none"; absent means
   * "keep what you have".
   */
  compiledCss?: string | null;
  /**
   * The authored DESIGN, sent on every frame (all three are tiny scalars next
   * to the source they accompany). Without them a watcher renders new content
   * under the design it first loaded with — the start-flow moment, where a
   * themeless placeholder becomes a themed deck, arrives unthemed until a
   * reload. `colorMode` is the AUTHOR's default mode; a reader who flipped the
   * mode toggle keeps their override (document-update skips the mode class
   * while one is active) — the rest of the design still applies.
   * `template` never reaches the render — it travels so that entering edit mode
   * after a live change seeds the editor with the genre actually stored.
   */
  theme: StoryThemeName | null;
  colorMode: 'light' | 'dark' | null;
  template: string | null;
  /**
   * The document's BODY, parsed — what a reader's already-open document
   * re-renders itself from (lib/story-runtime/contract StoryDocumentUpdate).
   * The runtime ships no JSX parser, so the nodes are made here, through the
   * same door that builds the served document.
   */
  nodes?: JsxNode[];
  /** The author's own <Helmet> <style>, on the same absent/null rule as compiledCss. */
  authorCss?: string | null;
  authorScript?: string | null;
  /**
   * The data declarations and their freshly run state — sent ONLY when the
   * declarations changed. A prose edit needs no query engine, and running a
   * document's SQL for every sentence an agent writes would put a DuckDB run
   * behind each one. Absent means "the data is as you have it".
   */
  dataflow?: StoryIslandDataflow;
}


/** Payload of a wakeup: the artifact's new head pointer. */
export type LiveHandler = (editId: string) => void;

interface ChannelSub {
  handlers: Set<LiveHandler>;
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
 * File ids are [a-zA-Z0-9]+, safe as channel identifiers — but LOWERCASED
 * here and at both pg_notify sites (lib/artifacts.ts), because unquoted
 * LISTEN folds the channel name to lowercase (PGLite always emits it
 * unquoted) while pg_notify's payload is exact text: with a mixed-case id
 * the notification would silently never reach the listener in dev/CI while
 * working on production Postgres. Two ids differing only in case sharing a
 * channel is harmless — every wakeup is a catch-up read keyed by the real id.
 */
export const channelFor = (artifactId: string) => `artifact_${artifactId.toLowerCase()}`;

/** The annotations sidecar notifies on its OWN channel — a comment must not wake every reader's document catch-up. */
export const channelForAnnotations = (artifactId: string) => `annotations_${artifactId.toLowerCase()}`;

/**
 * Subscribe to an artifact's wakeups. The first subscriber opens the DB
 * LISTEN; the last to leave closes it. Returns an async unsubscribe.
 */
export function subscribeToArtifact(artifactId: string, handler: LiveHandler): Promise<() => Promise<void>> {
  return subscribeChannel(channelFor(artifactId), handler);
}

/** Same machinery, the annotations channel — owner connections only (the route decides that). */
export function subscribeToAnnotations(artifactId: string, handler: LiveHandler): Promise<() => Promise<void>> {
  return subscribeChannel(channelForAnnotations(artifactId), handler);
}

async function subscribeChannel(channel: string, handler: LiveHandler): Promise<() => Promise<void>> {
  let sub = channels.get(channel);
  if (!sub) {
    // Only a NEW channel can push us over: extra watchers of a document we
    // already follow are just entries in an in-memory Set.
    if (channels.size >= MAX_LIVE_CHANNELS) throw new TooManyLiveChannels();
    const handlers = new Set<LiveHandler>();
    const unlisten = await wakeups().subscribe(channel, (payload) => {
      // Snapshot: a handler may unsubscribe while we iterate.
      for (const h of [...handlers]) {
        try { h(payload); } catch { /* one dead reader must not break the others */ }
      }
    });
    sub = { handlers, unlisten };
    channels.set(channel, sub);
  }
  sub.handlers.add(handler);

  return async () => {
    const current = channels.get(channel);
    if (!current) return;
    current.handlers.delete(handler);
    if (current.handlers.size === 0) {
      channels.delete(channel);
      try { await current.unlisten(); } catch { /* connection already gone */ }
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

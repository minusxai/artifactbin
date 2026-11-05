/**
 * LIVE TEXT REACHES READERS WITHOUT A SAVE: a page's region rows changing (an editor's or an agent's update, NOTIFY on
 * the page's regions channel, lib/region-sessions) wakes its document streams (./document-events), which send the
 * reader the same content-free ping a version sends, with the page's live revision (lib/artifacts current-page). The
 * reader's frame then re-fetches its own address, now the current page, and draws it in place.
 *
 * ONE FOLLOWER PER PAGE PER PROCESS, however many readers have it open: it holds the one subscription, and THROTTLES to
 * one tick every `intervalMs` (leading and trailing: the first change goes at once, a burst of keystrokes ends with one
 * more tick), and each tick's head (`load`: the current page's identity and title) is read once and shared by every
 * reader's stream. Each stream still decides its own reader's access before it sends anything.
 *
 * Only a region UPDATE (`<regionId>:<seq>`) wakes it: a save (`saved…`) or a close (`closed`) is a new version, which
 * the document's own channel announces.
 */
import { regionsChannel } from '@artifactbin/contracts';

/** At most one live ping per page this often (a typist's burst becomes about three a second). */
export const LIVE_PING_MS = 300;

interface LivePingClock {
  now(): number;
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

/** One reader's stream: `head` is the tick's shared read (null when the page went), `lost` the subscription died. */
export interface LiveFollower<H> { tick(head: () => Promise<H>): void; lost(): void }

interface PageFollow<H> {
  followers: Set<LiveFollower<H>>;
  unsubscribe: Promise<(() => Promise<void>) | null>;
  timer?: unknown;
  pending: boolean;
}

const UPDATE = /^[A-Za-z][\w-]*:\d+$/;

export interface LivePingDeps<H> {
  subscribe(channel: string, handler: (payload: string) => void, onLost: () => void): Promise<() => Promise<void>>;
  /** The page's head as a live ping names it, read once per tick. */
  load(id: string): Promise<H>;
  clock?: LivePingClock;
  intervalMs?: number;
}

const SYSTEM: LivePingClock = {
  now: () => Date.now(),
  setTimeout: (work, ms) => setTimeout(work, ms),
  clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function livePings<H>(deps: LivePingDeps<H>) {
  const clock = deps.clock ?? SYSTEM;
  const intervalMs = deps.intervalMs ?? LIVE_PING_MS;
  const pages = new Map<string, PageFollow<H>>();

  const emit = (id: string, page: PageFollow<H>) => {
    let read: Promise<H> | undefined;
    const head = () => (read ??= deps.load(id));
    for (const follower of [...page.followers]) follower.tick(head);
    page.timer = clock.setTimeout(() => {
      page.timer = undefined;
      if (!page.pending || pages.get(id) !== page) return;
      page.pending = false;
      emit(id, page);
    }, intervalMs);
  };
  const wake = (id: string, payload: string) => {
    const page = pages.get(id);
    if (!page || !UPDATE.test(payload)) return;
    if (page.timer !== undefined) { page.pending = true; return; }
    emit(id, page);
  };
  const drop = (id: string, page: PageFollow<H>) => {
    if (pages.get(id) !== page) return;
    pages.delete(id);
    if (page.timer !== undefined) clock.clearTimeout(page.timer);
    void page.unsubscribe.then((stop) => stop?.()).catch(() => {});
  };

  return {
    /**
     * Follow a page's live text; resolves to the teardown. Throws what `subscribe` throws (no room for another live
     * channel): the reader's stream then goes on without live text, as it does without data wakeups.
     */
    async follow(id: string, follower: LiveFollower<H>): Promise<() => void> {
      let page = pages.get(id);
      if (!page) {
        const created: PageFollow<H> = { followers: new Set(), pending: false, unsubscribe: Promise.resolve(null) };
        created.unsubscribe = deps.subscribe(regionsChannel(id), (payload) => wake(id, payload), () => {
          const followers = [...created.followers];
          drop(id, created);
          for (const each of followers) each.lost();
        });
        pages.set(id, page = created);
        try { await created.unsubscribe; } catch (error) { drop(id, created); throw error; }
      } else await page.unsubscribe;
      const joined = page;
      joined.followers.add(follower);
      return () => {
        joined.followers.delete(follower);
        if (!joined.followers.size) drop(id, joined);
      };
    },
    /** Pages followed now (tests, diagnostics). */
    followed: (): number => pages.size,
  };
}

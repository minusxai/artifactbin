/**
 * A COMPILED READER'S NEW VERSION — the one update path (docs/phase2-architecture.md §2.4, §7.2).
 *
 * Every compiled page that learns of a new version calls this, whoever holds the stream: the page's own
 * stream (./live) on `/raw` and on `/a/:id` before the app adopts it, and the adopted page
 * (components/IslandStory) once the app holds it. It is what today's React reader does on a write — the
 * new version drawn in place, no navigation — for a page the browser never compiles:
 *
 *   the new version's story fragment (`/a/:id/story`, the same assembler output as the page) is fetched
 *   and the served story MORPHED into it in place by the standalone engine (./morph/engine): unchanged
 *   nodes and unchanged islands stay the same nodes, changed islands are disposed and hydrated from the
 *   new page, and the store, the reader's values and the snapshot rows survive.
 *
 * Anything the morph cannot do (a private document's fragment from an opaque origin, a deploy that
 * changed the island build under the page, a deck) ends in the reload a compiled page did before this
 * path existed: the reader's place parked in `window.name` and put back by the page (lib/islands/page).
 *
 * Framework-free and small: it is in the page behaviour's closure (./page → ./live) and in the app's
 * bundle. The engine is a lazy STANDALONE bundle (scripts/build-islands `STANDALONE_LAZY`), so the
 * shared runtime's rt+boot closure carries none of it. Its in-flight state lives on the window, not in
 * this module: the app's bundle holds a second copy of this module over the same page.
 */
import { currentAnchor } from '@/lib/story-runtime/anchor';
import type { ScrollAnchor } from '@/lib/story/scroll-anchor';
import { writeReloadAnchor } from '@/lib/story-runtime/reader-mode';

export interface StoryUpdateOptions {
  /**
   * The reader's own colour override when the page holds one (the adopted app's toggle); the
   * `window.name` envelope's (lib/story-runtime/reader-mode) otherwise. A new version never stomps it.
   */
  mode?: () => 'light' | 'dark' | null;
  /** The app holds the page (components/IslandStory): its title and chrome are the app's, never the fragment's. */
  adopted?: boolean;
}

/** What `updateCompiledStory` settled as: drawn in place, or a reload was asked for. */
export type StoryUpdateOutcome = 'morphed' | 'reloaded';

/** Where the in-flight update lives: on the window, shared by every copy of this module over one page. */
const STATE_KEY = '__mxStoryUpdate';
interface UpdateState { running: Promise<StoryUpdateOutcome> | null; again: boolean }

/** The fallback: reload the compiled page, keeping the reader's place (put back by lib/islands/page). */
export function reloadKeepingPlace(win: Window, preUnmountAnchor?: ScrollAnchor | null): void {
  const anchor = preUnmountAnchor ?? currentAnchor(win);
  if (anchor) writeReloadAnchor(win, anchor);
  win.location.reload();
}

/**
 * Bring the page to the document's newest version. Calls while one runs coalesce into one more pass
 * after it (the fragment is always the head, so one pass catches up with any number of writes).
 */
export function updateCompiledStory(win: Window, options: StoryUpdateOptions = {}): Promise<StoryUpdateOutcome> {
  const hooks = win as unknown as Record<string, UpdateState | undefined>;
  const state = (hooks[STATE_KEY] ??= { running: null, again: false });
  if (state.running) {
    state.again = true;
    return state.running;
  }
  const run = async (): Promise<StoryUpdateOutcome> => {
    const { morphStory } = await import('./morph/engine');
    do {
      state.again = false;
      await morphStory(win, options);
    } while (state.again);
    return 'morphed';
  };
  const running = run().catch((error: unknown) => {
    console.warn('[islands] the new version could not be drawn in place; reloading', error);
    reloadKeepingPlace(win);
    return 'reloaded' as const;
  }).finally(() => { state.running = null; });
  state.running = running;
  return running;
}

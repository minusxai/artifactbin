/**
 * THE EDIT LIFECYCLE: enter → ready → (drafts) → done → restored, one owner.
 *
 * Editing is a MODE of the document's one address, mirrored in `#edit` (and accepted as `/edit`). This module owns
 * that mode's whole life, so the page only draws what the phase says:
 *
 * - `enter` pushes exactly one `#edit` entry; Back and Done both leave through one `leave`, which flushes the editor
 *   ONCE, bounded by FLUSH_BOUND_MS (a flush that hangs never holds the reader in a dead editor). Done drops `#edit`
 *   from the address before that flush, so a reload during it reads; the pushed entry is popped after it.
 * - Leaving sends the document ONE `mx:edit-mode {on:false}` (nothing else ends the session: the editor's own
 *   edit-mode toggle only pauses it for a version preview) and waits for the controller's `restored` — the saved
 *   version drawn in place over the running islands. A version this page cannot draw reloads, keeping the place.
 * - A changed install setting (the PWA manifest is in the served page) leaves by a replace navigation instead.
 *
 * Phases: `reading` → `entering` (the editor is loading) → `editing` (it is editable) → `leaving` (the flush) →
 * `restoring` (the saved version is being drawn) → `reading`. A new entry during `restoring` wins over that restore.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { DocumentGraph } from '@artifactbin/contracts';
import { STORY_EDIT_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import type { IslandStoryController } from '@/lib/story-runtime/island-controller';
import { reloadKeepingPlace } from '@/lib/islands/live-update';

export type EditPhase = 'reading' | 'entering' | 'editing' | 'leaving' | 'restoring';

/** How long a way out of edit mode waits for the editor's last save before leaving anyway. */
export const FLUSH_BOUND_MS = 3000;

export interface EditLifecycleOptions {
  editable: Accessor<boolean>;
  /** The install setting changed while editing: the served page is stale, so leaving navigates. */
  pwaChanged: Accessor<boolean>;
  /** The document's controller: the one edit-off goes to it, and it says when the page reads again. */
  controller: () => Pick<IslandStoryController, 'send' | 'restored'> | null;
  win?: Window;
}

export interface EditLifecycle {
  phase: Accessor<EditPhase>;
  /** The editor is on screen: entering, editing or flushing on the way out. */
  editing: Accessor<boolean>;
  /** The block the edit was opened on (the selection bubble's Edit), cleared on leaving. */
  selectionPath: Accessor<string | null>;
  enter(selectionPath?: string | null): void;
  /** The editor reports the document editable (or shown in a view that needs no editing session). */
  ready(): void;
  done(): Promise<'restored' | 'reloaded'>;
  /** The editor's drain (commit typed text, save); returns its unregister. */
  registerFlush(flush: () => Promise<void>): () => void;
  /** Follow the address (hashchange, and once at mount). */
  sync(): void;
}

export function createEditLifecycle(options: EditLifecycleOptions): EditLifecycle {
  const win = options.win ?? window;
  const [phase, setPhase] = createSignal<EditPhase>('reading');
  const [selectionPath, setSelectionPath] = createSignal<string | null>(null);
  const flushes = new Set<() => Promise<void>>();
  /** This page pushed the `#edit` entry it is on, so leaving pops it. */
  let pushed = false;
  let readingRestoration: ScrollRestoration | null = null;
  /** The one way out in progress; Done, Back and the hashchange Done's own `back()` causes all share it. */
  let leaving: Promise<'restored' | 'reloaded'> | null = null;
  /** Bumped by every entry: a restore finishing for an older session leaves a newer one alone. */
  let generation = 0;

  const onEditRoute = () => /\/edit\/?$/.test(win.location.pathname) || win.location.hash === '#edit';
  const readingAddress = () => win.location.pathname.replace(/\/edit\/?$/, '') + win.location.search;
  const inEditor = (now: EditPhase) => now === 'entering' || now === 'editing' || now === 'leaving';

  const open = (path: string | null) => {
    generation++;
    leaving = null;
    setSelectionPath(path);
    if (phase() !== 'editing') setPhase('entering');
  };

  const flushBounded = async () => {
    if (!flushes.size) return;
    const all = Promise.all([...flushes].map((flush) => flush().catch((error: unknown) => console.warn('[document] the editor did not flush', error))));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([all, new Promise<void>((resolve) => { timer = setTimeout(resolve, FLUSH_BOUND_MS); })]);
    clearTimeout(timer);
  };

  const leave = (popAddress: boolean): Promise<'restored' | 'reloaded'> => leaving ??= (async () => {
    const session = generation;
    // The address reads again AT ONCE, before the flush: the flush may cross into the document's frame and back, and
    // a reload (or a copied link) in that window must not come back in edit mode. replaceState fires no hashchange.
    const pop = popAddress && onEditRoute();
    if (pop) win.history.replaceState(win.history.state, '', readingAddress());
    setPhase('leaving');
    await flushBounded();
    if (session !== generation) return 'restored';
    if (options.pwaChanged()) { win.location.replace(readingAddress()); return 'reloaded'; }
    setSelectionPath(null);
    // Back over the entry this page pushed (already the reading address, so no hashchange): Back leaves the document.
    if (pop && pushed) { pushed = false; win.history.back(); }
    setPhase('restoring');
    const controller = options.controller();
    if (!controller) { setPhase('reading'); return 'restored'; }
    controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
    try {
      await controller.restored();
    } catch (error) {
      // A version this page cannot draw in place (another island build, islands where it runs none, a compile that
      // never came): the compiled page again, at the reader's place.
      console.warn('[document] could not return to reading in place; reloading', error);
      reloadKeepingPlace(win);
      return 'reloaded';
    }
    if (session === generation) { setPhase('reading'); leaving = null; }
    return 'restored';
  })();

  return {
    phase,
    editing: () => inEditor(phase()),
    selectionPath,
    enter(path = null) {
      if (!options.editable() || win.location.hash === '#edit' || inEditor(phase())) return;
      // The reading entry would remember the scroll from BEFORE the edit bar was compensated, and going back to it
      // (Done, the back button) would put that back for a frame: a bar's height of jump. The page keeps the reader's
      // place itself, so the reading entry restores nothing (the mode is the entry's own; it returns on the way back).
      readingRestoration = win.history.scrollRestoration;
      win.history.scrollRestoration = 'manual';
      win.history.pushState(win.history.state, '', win.location.pathname + win.location.search + '#edit');
      win.history.scrollRestoration = readingRestoration;
      pushed = true;
      open(path);
    },
    ready() { if (phase() === 'entering') setPhase('editing'); },
    done: () => (inEditor(phase()) || leaving ? leave(true) : Promise.resolve('restored')),
    registerFlush(flush) {
      flushes.add(flush);
      return () => { flushes.delete(flush); };
    },
    sync() {
      if (onEditRoute()) {
        if (options.editable() && !inEditor(phase())) open(null);
        return;
      }
      if (readingRestoration) { win.history.scrollRestoration = readingRestoration; readingRestoration = null; }
      pushed = false;
      if (phase() === 'entering' || phase() === 'editing') void leave(false);
    },
  };
}

/** THE EDITOR'S DOOR (lib/artifact-page `?part=editor`): what only writing needs. */
export interface EditorPart { editId: string; version: number; source: string; document?: DocumentGraph; compiledCss: string | null; authorCss: string | null }

/** Fetched on idle for a writer, or the moment edit mode opens; concurrent loads share one request, a failure retries. */
export function createEditorPartLoader(id: string | null, editable: Accessor<boolean>) {
  const [part, setPart] = createSignal<EditorPart | null>(null);
  const [failed, setFailed] = createSignal(false);
  let request: Promise<EditorPart | null> | null = null;
  return {
    part,
    failed,
    load(): Promise<EditorPart | null> {
      if (!id || !editable()) return Promise.resolve(null);
      return request ??= fetch(`/api/page/artifact/${encodeURIComponent(id)}?part=editor`, { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.json() as Promise<EditorPart> : null))
        .catch(() => null)
        .then((loaded) => {
          if (loaded) { setPart(loaded); setFailed(false); }
          else { request = null; setFailed(true); }
          return loaded;
        });
    },
    /** The next edit opens on the version just saved, not the part this session opened on. */
    reset() { request = null; setPart(null); },
  };
}

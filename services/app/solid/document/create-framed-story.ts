
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js';
import { createFrameBridgeParent, type FrameBridgeParent } from '@/lib/html-reader/frame-bridge/parent';
import { withUrlValuesOf } from '@/lib/dataflow/url-values';
import { STORY_URL_VALUES_MESSAGE, type IslandStoryController } from '@/lib/html-reader/contract';
import { commentAfterRegionSave, type RegionCommentSubject } from '@/lib/annotations/region-comment';
import type { RegionEditing, RegionToolbarState, startRegionEditing } from './region-editing';
import type { CellEditing, startCellEditing } from './cell-editing';
import { CELL_READONLY, isCellKey } from '@artifactbin/contracts';

/** Region editing (live co-editing of the page's editable regions) is an intentional lazy browser chunk: it carries Yjs, for editors only. */
export type RegionEditingLoader = () => Promise<{ startRegionEditing: typeof startRegionEditing }>;
const loadRegionEditing: RegionEditingLoader = () => import('./region-editing');
/** Live dataset text cells (@afbin/collab) are an intentional lazy browser chunk too: loaded when a signed-in reader's frame first asks for one. */
export type CellEditingLoader = () => Promise<{ startCellEditing: typeof startCellEditing }>;
const loadCellEditing: CellEditingLoader = () => import('./cell-editing');

// The frame's light helpers live in ./frame-src, which the document page and the consent bar import without this module.
import { framedDocumentFor, DOCUMENT_FRAME_SELECTOR, type FramedDocument } from './frame-src';
import { freshFrameSrc } from '@/lib/html-reader/frame-src';
import { keepFrameSession } from '@/lib/html-reader/frame-session';
export { framedDocumentFor, freshFrameSrc, DOCUMENT_FRAME_SELECTOR };

/**
 * The framed document's link moved (its `route.set`, lib/html-runtime/page-route → STORY_URL_VALUES_MESSAGE): this
 * page's address takes exactly its `$` params — the path, the hash and every other param kept, replaced, or pushed when
 * the page asked — so the address bar, a copied link, a reload and Back carry the reader's screen (the server forwards
 * the page's `$` params into the frame's first URL, lib/document-serving/artifact-page).
 */
export function followFramedValues(win: Window, values: string, push = false): void {
  const { pathname, search, hash } = win.location;
  const next = withUrlValuesOf(search, values);
  if (next === search) return;
  win.history[push ? 'pushState' : 'replaceState'](win.history.state, '', `${pathname}${next}${hash}`);
}

/** The `$` params alone of an address's search (`''` for none): what the frame is told after Back or Forward. */
const dollarValuesOf = (search: string): string => withUrlValuesOf('', search);

/**
 * The framed document's node tree (the page's NODES door, `?part=nodes`): a request of its own because the page draws nothing
 * from it — it is only relayed to the frame's edit controller — and on a large document it is most of the page's bytes.
 * `search` carries an archived version's `?version=N`, so the tree is that version's. A restart is ridden out by the shared
 * policy (lib/http/retry-lazily); a refusal is not. Null when it never arrives: the frame then has no edit controller, and says so nowhere.
 */
interface FramedStoryOptions {
  id: string;
  framed: FramedDocument;
  /** The head pointer drafts are previewed against, and the source the editor opened on (read live; sent on change). */
  editId: () => string;
  source: () => string | null;
  /** Trusted saved HTML revision and archive policy from the platform bootstrap. */
  htmlContext?: Parameters<typeof createFrameBridgeParent>[0]['htmlContext'];
  /**
   * Whether this browser edits live (the session payload's `liveEditor`: an account session, or a browser session's
   * scripted browser). Its dataset cells are relayed to the server, which decides; otherwise (absent, signed out) the
   * frame is told `readonly` for every cell, with no request made and no chunk loaded.
   */
  liveEditor?: Accessor<boolean>;
  /** How the cell relay loads (tests); default the lazy chunk. */
  loadCells?: CellEditingLoader;
  /**
   * Live editing of the page's editable regions, for a reader who may edit this page (never a viewer or commenter):
   * once the frame's controller runs, the saved page names its regions and the frame is told them (region-editing).
   */
  regions?: {
    enabled: Accessor<boolean>;
    /** The saved head's HTML, as an editor reads it (ArtifactBackend.load). */
    loadHtml: () => Promise<string | null>;
    onSaved?: (version: number) => void;
    /** A doc: its region opens for this editor as the page loads, with the focus (region-editing `autoOpen`). */
    autoOpen?: boolean;
    /** With `autoOpen`: whether that first open takes the focus (not when the page opened to show a comment). */
    autoFocus?: boolean;
    load?: RegionEditingLoader;
  };
}

/**
 * The editing chrome's inputs (solid/document/RegionToolbar): this person's region editor and what it asked for. Geometry
 * is the PAGE's viewport (the frame's box added). Always present; it stays empty for anyone without region editing.
 */
export interface RegionUi {
  /** The toolbar's state while this person has a region editor, else null. */
  toolbar: Accessor<RegionToolbarState | null>;
  /** The slash menu: where the caret's line ends (page viewport), while it is open. */
  slash: Accessor<{ regionId: string; left: number; top: number } | null>;
  /** The link dialog asked for by Mod-K, with the link at the caret. */
  link: Accessor<{ regionId: string; href: string | null } | null>;
  /** A toolbar or menu command for the editor. */
  command(name: string, args?: Record<string, unknown>): void;
  closeSlash(): void;
  closeLink(): void;
}

/**
 * The page's address opens a comment (`?comment=`, `?thread=`, or the comment intent): the comment takes the focus, so a
 * doc's auto-open still opens its region but leaves the focus alone.
 */
export function opensComment(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('comment') || params.has('thread') || params.get('intent') === 'comment';
}

export interface FramedStory {
  /** The bridge's stand-in for the document's controller: the page's runtimeRef, edit lifecycle, annotation layer and editor use it. */
  controller: Accessor<IslandStoryController | null>;
  /** The frame controller's secret, once it runs (null again while a reloaded frame's new controller starts). */
  nonce: Accessor<string | null>;
  frame: HTMLIFrameElement;
  /** How far the page's bars reach over the frame's top edge: the document reserves it without moving (bridge `inset`). */
  setTopInset(px: number): void;
  /**
   * A new comment's subject, ready to send: inside an editable region, unsaved region text is saved first and the
   * anchor names that version (lib/annotations/region-comment); otherwise the subject as it is.
   */
  beforeComment<T extends RegionCommentSubject>(subject: T): Promise<T>;
  regionUi: RegionUi;
}

export function createFramedStory(options: FramedStoryOptions): FramedStory {
  const { frame, origin } = options.framed;
  const [nonce, setNonce] = createSignal<string | null>(null);
  const [current, setCurrent] = createSignal<FrameBridgeParent | null>(null);
  /** The bars' reach over the frame's top edge, kept for a bridge made after it was set. */
  let inset = 0;
  const start = () => {
    const bridge = createFrameBridgeParent({
      win: window, frame, frameOrigin: origin, id: options.id,
      editId: options.editId, source: options.source, htmlContext: options.htmlContext,
      onReady: (next) => setNonce(next || null),
      onClosed: (reason) => { if (reason !== 'disposed') console.warn(`[frame-bridge] ${reason}`); },
      onUrlValues: (values, push) => followFramedValues(window, values, push),
    });
    setCurrent(bridge);
    if (inset) bridge.setTopInset(inset);
    if(options.htmlContext)createEffect(()=>{options.htmlContext!();bridge.refreshUploadContext();});
    createEffect(on([options.editId, options.source], ([editId, source]) => bridge.setContext(editId, source), { defer: true }));

  };
  // The reader's Back or Forward over entries the page pushed: the frame's route follows what this address holds now.
  const onHistory = () => { try { frame.contentWindow?.postMessage({ type: STORY_URL_VALUES_MESSAGE, search: dollarValuesOf(window.location.search) }, origin); } catch { /* the frame went away */ } };
  window.addEventListener('popstate', onHistory);
  onCleanup(() => window.removeEventListener('popstate', onHistory));
  // A frame whose session ran out (or that a redirect took off its origin) gets a fresh ticket (keepFrameSession).
  onCleanup(keepFrameSession({ win: window, frame, origin, id: options.id, remint: (id) => freshFrameSrc(id) }));
  start();
  let editing: RegionEditing | null = null;
  const [toolbar, setToolbar] = createSignal<RegionToolbarState | null>(null, { equals: false });
  const [slash, setSlash] = createSignal<{ regionId: string; left: number; top: number } | null>(null);
  const [link, setLink] = createSignal<{ regionId: string; href: string | null } | null>(null);
  const regionUi: RegionUi = {
    toolbar, slash, link,
    // The frame takes the focus first, so its editor can take it back from a menu or dialog on this page. Not when
    // it has it (a toolbar press keeps it): focusing a focused frame would move its own focus off the editor.
    command: (name, args) => { if (editing?.command(name, args) && document.activeElement !== frame) frame.focus({ preventScroll: true }); },
    closeSlash: () => setSlash(null),
    closeLink: () => setLink(null),
  };
  const regions = options.regions;
  if (regions) {
    let loading = false;
    let stopped = false;
    const stopEditing = () => { editing?.dispose(); editing = null; };
    // A controller that runs (again) under an editor: region editing starts once, and each new document is told its regions.
    createEffect(on([nonce, regions.enabled], ([signed, enabled]) => {
      if (!enabled) { stopEditing(); return; }
      if (!signed) return;
      if (editing) { editing.attached(); return; }
      if (loading) return;
      loading = true;
      void (regions.load ?? loadRegionEditing)().then(({ startRegionEditing }) => {
        loading = false;
        const bridge = current();
        if (stopped || !bridge || !regions.enabled() || editing) return;
        editing = startRegionEditing({
          id: options.id, bridge, loadHtml: regions.loadHtml, onSaved: regions.onSaved,
          autoOpen: regions.autoOpen, autoFocus: regions.autoFocus, focusFrame: () => frame.focus({ preventScroll: true }),
          onToolbar: (state) => { setToolbar(state); if (!state) setLink(null); },
          onSlash: (at) => {
            if (!at) { setSlash(null); return; }
            const box = current()?.getViewportRect();
            setSlash(box ? { regionId: at.regionId, left: box.left + at.x, top: box.top + at.y } : null);
          },
          onLink: setLink,
        });
        if (nonce()) editing.attached();
      }, () => { loading = false; });
    }));
    onCleanup(() => { stopped = true; stopEditing(); });
  }
  // Live dataset text cells, for any reader of the page: a frame whose browser does not edit live (signed out) is told
  // `readonly` here, with no request made and no chunk loaded; a live editor's cells are relayed by cell-editing, whose
  // server decides.
  let cells: CellEditing | null = null, cellsLoading: Promise<void> | null = null, cellsStopped = false;
  const signedIn = () => options.liveEditor?.() === true;
  createEffect(on(current, (bridge) => {
    if (!bridge) return;
    onCleanup(bridge.subscribeRegion((message) => {
      if (message.kind !== 'region-open' || !isCellKey(message.regionId) || cells) return;
      if (!signedIn()) { bridge.sendRegion({ kind: 'region-closed', regionId: message.regionId, reason: CELL_READONLY }); return; }
      const key = message.regionId;
      cellsLoading ??= (options.loadCells ?? loadCellEditing)().then(({ startCellEditing }) => {
        if (!cellsStopped && !cells && current()) cells = startCellEditing({ id: options.id, bridge: current()! });
      }, () => { cellsLoading = null; });
      void cellsLoading?.then(() => cells?.open(key));
    }));
  }));
  // A document that goes (the frame reloads) ends its cells' sessions; the next one opens its own.
  createEffect(on(nonce, (signed) => { if (!signed) cells?.attached(); }, { defer: true }));
  onCleanup(() => { cellsStopped = true; cells?.dispose(); cells = null; });
  onCleanup(() => {
    const bridge = current();
    setCurrent(null);
    setNonce(null);
    bridge?.dispose();
  });
  return {
    controller: current, nonce, frame,
    setTopInset: (px) => { inset = px; current()?.setTopInset(px); },
    beforeComment: (subject) => editing ? commentAfterRegionSave(subject, editing) : Promise.resolve(subject),
    regionUi,
  };
}

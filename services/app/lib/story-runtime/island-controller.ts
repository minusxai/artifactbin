/**
 * THE ADOPTED COMPILED DOCUMENT'S CONTROLLER, framework-free (docs/phase2-architecture.md §7.2–§7.5).
 *
 * The page's private handle on the served story root: comments, selections, reader mode, data
 * wakeups, in-place editing (lib/story-runtime/edit/session over the compiled DOM, mounted by
 * solid/editor/dom-mounter) and new versions morphed in place (lib/islands/live-update). A page
 * shell (the Solid document page) moves the root into its tree (`moveInto`), creates this
 * controller, and hands its `nonce` to the page's annotation and editor chrome.
 */
import type { IslandDocument } from '@/lib/islands/contract';
import { serializeJsx } from '@/lib/jsx/serialize';
import type { JsxNode } from '@/lib/jsx/types';
import type { StoryController } from '@/lib/story-runtime/contract';
import type { FrameEditSession } from '@/lib/story-runtime/edit/session';
import type { FrameAnnotateSession } from '@/lib/story-runtime/edit/annotate';
import type { FrameSelectionActions } from '@/lib/story-runtime/edit/selection-actions';
import type { RuntimeChannel } from '@/lib/story-runtime/pristine';
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { isStoryDocumentUpdate } from '@/lib/story-runtime/document-update';
import { applyColorMode } from '@/lib/story-runtime/reader-mode';
import { updateCompiledStory } from '@/lib/islands/live-update';
import { storyFragmentUrl } from '@/lib/compiled-page/story-fragment';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import {
  STORY_ANNOTATIONS_MESSAGE, type StoryDocumentUpdate, STORY_DATA_HOOK, STORY_DATA_MESSAGE, STORY_READER_MODE_MESSAGE,
  STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECT_MESSAGE, isEditParentMessage,
  STORY_EDIT_MODE_MESSAGE,
} from '@/lib/story-runtime/contract';

type Movable = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };

/** Move `story` under `host` keeping its state (iframes, focus, animations) where the browser can. */
export function moveInto(host: HTMLElement, story: HTMLElement): void {
  if (story.parentElement === host) return;
  const move = (host as Movable).moveBefore;
  if (typeof move === 'function' && story.isConnected && host.isConnected) {
    try { move.call(host, story, null); return; } catch { /* a cross-document or disconnected move: append instead */ }
  }
  host.appendChild(story);
}

/** Stop island behavior for editing while retaining its last painted DOM as the compiled draft. */
export function freezeIslandPaint(root: HTMLElement, islands: IslandDocument | null): void {
  if (!islands) return;
  const painted = [...root.querySelectorAll<HTMLElement>('[data-hk], [aria-label="Question embed"]')]
    .filter((element) => !element.parentElement?.closest('[data-hk], [aria-label="Question embed"]'))
    .map((element) => {
      const copy = element.cloneNode(true) as HTMLElement;
      const originals = element.querySelectorAll('canvas');
      const canvases = copy.querySelectorAll('canvas');
      for (let index = 0; index < originals.length; index++) {
        const original = originals[index], canvas = canvases[index];
        if (!original || !canvas) continue;
        canvas.width = original.width;
        canvas.height = original.height;
        try { canvas.getContext('2d')?.drawImage(original, 0, 0); } catch { /* a tainted canvas keeps its frame */ }
      }
      return { element, parent: element.parentNode, next: element.nextSibling, html: element.innerHTML,
        drawing: !!element.querySelector('svg.marks, [aria-label="Question embed"] svg, [aria-label="Question embed"] canvas'), copy };
    });
  islands.setMode('edit');
  for (const { element, parent, next, html, drawing, copy } of painted) {
    // A chart controller may clear its *root* after disposal. Detach that whole
    // root from the edited document so a delayed cleanup owns only the old node.
    if (drawing && parent) {
      if (element.parentNode === parent) parent.replaceChild(copy, element);
      else parent.insertBefore(copy, next?.isConnected ? next : null);
    } else {
      if (!element.isConnected && parent) parent.insertBefore(element, next?.isConnected ? next : null);
      if (element.innerHTML !== html) element.replaceChildren(...copy.childNodes);
    }
  }
}

const CHART = '[aria-label="Question embed"]';
const CHART_DRAWING = 'svg.marks, canvas';
/** How long a chart's last drawing may stand in for it while its island hydrates and draws again. */
const CHART_HOLD_MS = 3000;

/**
 * Keep every chart's last drawing on screen while the islands under it hydrate again (a chart redraws a moment
 * after its island mounts): a copy of each drawing sits over it, beside the story, until the chart at the same
 * AST path has drawn again (or a few seconds pass). The copies are the drawings alone — explicit sizes and inline
 * colours — and take no layout.
 */
export function holdChartDrawings(win: Window, root: HTMLElement): { release(): void } {
  const host = root.parentElement;
  if (!host || win.getComputedStyle(host).position === 'static') return { release() {} };
  const hostRect = host.getBoundingClientRect();
  const held: Array<{ path: string | null; copy: Element }> = [];
  for (const chart of root.querySelectorAll<HTMLElement>(CHART)) {
    const path = chart.getAttribute(AST_PATH_ATTR);
    for (const drawing of chart.querySelectorAll<SVGElement | HTMLCanvasElement>(CHART_DRAWING)) {
      const rect = drawing.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const copy = drawing.cloneNode(true) as SVGElement | HTMLCanvasElement;
      if (drawing instanceof HTMLCanvasElement && copy instanceof HTMLCanvasElement) {
        copy.width = drawing.width; copy.height = drawing.height;
        try { copy.getContext('2d')?.drawImage(drawing, 0, 0); } catch { /* a tainted canvas keeps its frame */ }
      }
      copy.setAttribute('aria-hidden', 'true');
      copy.setAttribute('data-mx-chart-hold', '');
      Object.assign(copy.style, {
        position: 'absolute', left: `${rect.left - hostRect.left}px`, top: `${rect.top - hostRect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, margin: '0', pointerEvents: 'none', zIndex: '1',
      });
      host.append(copy);
      held.push({ path, copy });
    }
  }
  const drawn = (path: string | null) => {
    const chart = path ? [...root.querySelectorAll<HTMLElement>(CHART)].find((el) => el.getAttribute(AST_PATH_ATTR) === path) : null;
    return !chart || [...chart.querySelectorAll<Element>(CHART_DRAWING)].some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  };
  return {
    release() {
      if (!held.length) return;
      const deadline = win.performance.now() + CHART_HOLD_MS;
      const check = () => {
        for (let i = held.length - 1; i >= 0; i--) {
          const item = held[i]!;
          if (win.performance.now() > deadline || drawn(item.path)) { item.copy.remove(); held.splice(i, 1); }
        }
        if (held.length) win.requestAnimationFrame(check);
      };
      check();
    },
  };
}

export interface IslandControllerInput {
  win: Window;
  root: HTMLElement;
  islands: IslandDocument | null;
  nodes: JsxNode[];
  id: string;
  editId: () => string;
  initialSource: () => string | null;
  portal: { current: HTMLElement | null };
}

/**
 * The page's private handle on the adopted document: what the inline runtime's controller does
 * for comments, selections, reader mode and data wakeups, over the island DOM.
 * The compiled editor mounts by AST path; a new reader version morphs in place.
 */
/** How often, and how far apart, a saved version still compiling is asked for again after Done (about 10 s in all). */
const RESTORE_RETRIES = 12;
const RESTORE_DELAY_MS = 250;

export interface IslandStoryController extends StoryController {
  selectionReady(): void;
  /**
   * Settles once the page reads again IN PLACE after editing: the saved version drawn on the running islands
   * and the islands back in read mode (lib/islands/boot). Resolves at once when editing never froze them;
   * rejects when the version cannot be drawn here (the caller reloads, keeping the reader's place).
   */
  restored(): Promise<void>;
}

export function createIslandController({ win, root, islands, nodes: served, portal, id, editId, initialSource }: IslandControllerInput): IslandStoryController {
  let nodes = served;
  /** The reader's own mode, as the app last set it: a new version never stomps it. */
  let mode: 'light' | 'dark' | null = null;
  let disposed = false;
  const listeners = new Set<(event: unknown) => void>();
  const nonce = runtimeId();
  const emit = (event: unknown) => { if (!disposed) for (const listener of [...listeners]) listener(event); };
  const channel: RuntimeChannel = { nonce, post: (event) => queueMicrotask(() => emit(event)), innerHtmlOf: (element) => element.innerHTML };
  let annotate: FrameAnnotateSession | null = null;
  let annotationCommand: Parameters<FrameAnnotateSession['update']>[0] | null = null;
  let annotationLoading = false;
  let selection: FrameSelectionActions | null = null;
  let selectionFactory: typeof import('@/lib/story-runtime/edit/selection-actions').createFrameSelectionActions | null = null;
  let selectionCommand: Parameters<FrameSelectionActions['update']>[0] | null = null;
  let selectionLoading = false;
  let edit: FrameEditSession | null = null;
  let editRequested = false;
  /** The islands were frozen for editing: from then on the page draws drafts (and versions) from the server compiler. */
  let frozen = false;
  const drafting = () => editRequested || frozen;
  /** A saved version is shown for reading while editing is paused (version history): Done returns to the head. */
  let previewing = false;
  let editLoading = false;
  let draftSequence = 0;
  /**
   * One draft compile on the server at a time. Typing sends a draft per keystroke; each one supersedes the
   * last at once (the sequence), but only the newest waiting draft is compiled once the current compile answers.
   */
  let compiling = false;
  let queuedCompile: (() => void) | null = null;
  /** The last draw that completed, by sequence: a restore waits for ITS draw, not an earlier one. */
  let drawnSequence = -1;
  /** The newest source the editor sent: after Done, what the saved version was written from. */
  let latestSource: string | null = null;
  /** The source the saved version is drawn against (every component the draft shows unchanged stays put). */
  let restoreSource: string | null = null;
  let restoreWait: { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void } | null = null;
  const restoreSettled = () => {
    if (!restoreWait) {
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
      restoreWait = { promise, resolve, reject };
    }
    return restoreWait;
  };
  /** The authored tree the page shows now: what the next draw decides stability against. */
  let lastDrawn: JsxNode[] | null = null;
  /** What the last draw put on screen, hydrated and running: its compiled module and the source it was compiled from. */
  let shown: { module: string | null; source: string | null } | null = null;
  let quietDraftTimer: number | null = null;
  let pendingDraft: { document: Document; root: HTMLElement; sheet: HTMLStyleElement | null; nodes: JsxNode[]; source: string | null; sequence: number } | null = null;
  const componentIds = (source: JsxNode[]): Map<string, string> => {
    const found = new Map<string, string>();
    const visit = (items: JsxNode[]) => { for (const item of items) {
      if (item.type !== 'element') continue;
      const id = item.attributes.find((attribute) => attribute.name === 'id')?.value;
      if (item.isComponent && id?.static && typeof id.json === 'string') found.set(id.json, serializeJsx([item]));
      visit(item.children);
    } };
    visit(source);
    return found;
  };
  const stableIdsFor = (next: JsxNode[], previous = nodes): Set<string> => {
    const before = componentIds(previous), after = componentIds(next);
    return new Set([...after].filter(([id, value]) => before.get(id) === value).map(([id]) => id));
  };
  const componentPaths = (source: JsxNode[]): Map<string, string> => {
    const found = new Map<string, string>();
    const visit = (items: JsxNode[], parent = '') => { items.forEach((item, index) => {
      if (item.type !== 'element') return;
      const path = [parent, index].filter((part) => part !== '').join('.');
      if (item.isComponent) found.set(path, serializeJsx([item]));
      visit(item.children, path);
    }); };
    visit(source);
    return found;
  };
  const stablePathsFor = (next: JsxNode[], previous = nodes): Set<string> => {
    const before = componentPaths(previous), after = componentPaths(next);
    return new Set([...after].filter(([path, text]) => before.get(path) === text).map(([path]) => path));
  };
  const focusedRegion = () => {
    const active = win.document.activeElement;
    return active instanceof HTMLElement && root.contains(active) && !!active.closest('[data-mx-edit-region]');
  };
  /**
   * One draft is drawn at a time. The draw spans awaits (the engine, the draft's island module), and a
   * second draw inside that window would hydrate the root twice and remount the editor over a half-
   * morphed DOM; a newer draft that lands meanwhile is drawn once the current one is done.
   */
  let drawing: Promise<void> | null = null;
  let drawAgain: boolean | null = null;
  const applyDraft = (allowFocused = false): Promise<void> => {
    if (drawing) { drawAgain = (drawAgain ?? false) || allowFocused; return drawing; }
    drawing = drawDraft(allowFocused).finally(() => {
      drawing = null;
      const again = drawAgain;
      drawAgain = null;
      if (again !== null && !disposed) void applyDraft(again);
    });
    return drawing;
  };
  const drawDraft = async (allowFocused: boolean) => {
    const pending = pendingDraft;
    if (!pending || (focusedRegion() && (!allowFocused || !edit?.canApplyDraft())) || disposed || !drafting() || pending.sequence !== draftSequence) return;
    const [{ disposeChangedDraftIslands, hydrateDraftIslands, loadDraftModule, morphDraftDom, versionModuleUrl }, { storyUpdateParts }] = await Promise.all([
      import('@/lib/islands/morph/engine'), import('@/lib/story/update-parts'),
    ]);
    if (disposed || !drafting() || pending.sequence !== draftSequence || pendingDraft !== pending) return;
    // Fetch the draft's module while the editor is still mounted. From here to the remount nothing
    // awaits: a keystroke typed during a slow module fetch otherwise lands on no editor, and the
    // caret comes back where it was when the fetch began (mid-word).
    const module = await loadDraftModule(win, root, pending.document);
    if (disposed || !drafting() || pending.sequence !== draftSequence || pendingDraft !== pending) return;
    if (focusedRegion() && (!allowFocused || !edit?.canApplyDraft())) return;
    pendingDraft = null;
    if (quietDraftTimer !== null) { win.clearTimeout(quietDraftTimer); quietDraftTimer = null; }
    // What stays is decided against the draft the page shows NOW. The served AST may carry resolved
    // assets or generated properties, so compare two parses of the authored source for component
    // identity; both use the same body-relative paths as the compiled DOM.
    // A saved version drawn after Done has no source: its served nodes stand in (fewer components match, never a wrong one).
    const baseline = initialSource();
    const before = lastDrawn ?? (baseline ? storyUpdateParts(baseline)?.nodes : null) ?? nodes;
    const after = (pending.source !== null ? storyUpdateParts(pending.source)?.nodes : null) ?? pending.nodes;
    const stableIds = stableIdsFor(after, before), stablePaths = stablePathsFor(after, before);
    const sheet = docSheet(win.document);
    if (pending.sheet && sheet) sheet.textContent = pending.sheet.textContent;
    edit?.unmountCompiledDom();
    disposeChangedDraftIslands(root, stableIds, stablePaths);
    morphDraftDom(root, pending.root, stableIds, stablePaths);
    await hydrateDraftIslands(win, root, pending.document, stableIds, stablePaths, undefined, module);
    nodes = pending.nodes;
    lastDrawn = after;
    shown = { module: versionModuleUrl(pending.document), source: pending.source };
    drawnSequence = pending.sequence;
    edit?.setNodes(nodes);
    await edit?.mountCompiledDom();
    annotate?.setNodes(nodes);
    selection?.setNodes(nodes);
  };
  /** Parse a compiled page and queue it as the draft to draw (the newest wins). */
  const queueDraw = async (html: string, nodes: JsxNode[], source: string | null, sequence: number) => {
    const next = new DOMParser().parseFromString(html, 'text/html');
    if (disposed || sequence !== draftSequence || !drafting()) return;
    const nextRoot = next.querySelector<HTMLElement>('[data-mx-inline-story]');
    if (!nextRoot) throw new Error('draft preview carried no story');
    pendingDraft = { document: next, root: nextRoot, sheet: next.querySelector<HTMLStyleElement>('style[data-mx-story-css]'), nodes, source, sequence };
    await applyDraft();
  };
  /**
   * BACK TO READING IN PLACE (Done): the saved version's served story is drawn exactly as a draft is — on the
   * running islands, every component the last draft shows unchanged keeping its DOM (a chart stays drawn) — and
   * the islands then return to read mode. Until the version has compiled the last draft (the same content) stays
   * on screen. A newer call (a version landing meanwhile) supersedes this one; the newest settles `restored`.
   */
  const restoreRead = (nextNodes?: JsxNode[]) => {
    const sequence = ++draftSequence;
    pendingDraft = null;
    if (quietDraftTimer !== null) { win.clearTimeout(quietDraftTimer); quietDraftTimer = null; }
    const wait = restoreSettled();
    const current = () => !disposed && !editRequested && frozen && sequence === draftSequence;
    const run = async (): Promise<void> => {
      let next: Document | null = null;
      for (let attempt = 0; !next; attempt++) {
        if (!current()) return;
        const response = await win.fetch(storyFragmentUrl(id, win.location.search, 'app'), { credentials: 'same-origin', cache: 'no-store' });
        if (!current()) return;
        // Compiled off the write's path: a version this fresh may still be compiling.
        if (response.status === 409 && attempt < RESTORE_RETRIES) {
          await new Promise((resolve) => win.setTimeout(resolve, RESTORE_DELAY_MS * Math.min(attempt + 1, 4)));
          continue;
        }
        if (!response.ok) throw new Error(`story fragment answered ${response.status}`);
        next = new DOMParser().parseFromString(await response.text(), 'text/html');
      }
      const { adoptVersionRecord, readRestoreBlocker, versionModuleUrl } = await import('@/lib/islands/morph/engine');
      if (!current()) return;
      const blocked = readRestoreBlocker(root, win.document, next);
      if (blocked) throw new Error(blocked);
      if (!current()) return;
      while (drawing) await drawing;
      if (!current()) return;
      // The last draft drawn IS the saved version (compiled from the same source; the two compiles' modules differ
      // only in what they record, not in what they draw) and its islands run already: nothing is drawn again, so no
      // chart is re-hydrated and none redraws.
      const alreadyShown = !!shown && shown.source !== null && shown.source === restoreSource && !!shown.module === !!versionModuleUrl(next);
      if (alreadyShown) {
        if (nextNodes) nodes = nextNodes;
        annotate?.setNodes(nodes);
        selection?.setNodes(nodes);
      } else {
        const nextRoot = next.querySelector<HTMLElement>('[data-mx-inline-story]')!;
        pendingDraft = { document: next, root: nextRoot, sheet: next.querySelector<HTMLStyleElement>('style[data-mx-story-css]'), nodes: nextNodes ?? nodes, source: restoreSource, sequence };
        // The islands hydrate again under the charts: their last drawings stay on screen until each has redrawn.
        const hold = holdChartDrawings(win, root);
        try {
          await applyDraft();
          while (drawing) await drawing;
        } finally { hold.release(); }
        if (!current()) return;
        if (drawnSequence !== sequence) throw new Error('the saved version was not drawn');
      }
      adoptVersionRecord(win.document, next);
      // The version's compiled colour never replaces the reader's own choice (as the reader's morph keeps it).
      applyColorMode(root, mode);
      frozen = false;
      restoreSource = null;
      islands?.setMode('read');
      restoreWait = null;
      wait.resolve();
    };
    void run().catch((error: unknown) => {
      if (!current()) return;
      restoreWait = null;
      wait.reject(error);
    });
  };
  const onFocusOut = () => { queueMicrotask(() => { void applyDraft(); }); };
  win.document.addEventListener('focusout', onFocusOut, true);
  // The module, the grant and the protected portal may arrive in any order (as in the inline runtime).
  const ensureSelection = () => {
    if (disposed || selection || !selectionFactory || !portal.current || !selectionCommand || (!selectionCommand.edit && !selectionCommand.annotate)) return;
    selection = selectionFactory({ win, root, portal: portal.current,
      onAction: (action, selected) => emit({ type: STORY_SELECTION_ACTION_MESSAGE, nonce, action, selection: selected }) });
    selection.setNodes(nodes);
    selection.update(selectionCommand);
  };
  const controller = {
    nonce,
    selectionReady: ensureSelection,
    restored: () => {
      // Done while a version preview is on screen: nothing else asks for the saved head back.
      if (previewing && frozen && !editRequested) { previewing = false; restoreSource = latestSource ?? initialSource(); restoreRead(); }
      return frozen && !editRequested ? restoreSettled().promise : Promise.resolve();
    },
    send(command: unknown) {
      if (disposed || !command || typeof command !== 'object') return;
      if (isStoryDocumentUpdate(command)) { controller.update(command); return; }
      const message = command as { type?: string; datasets?: unknown; mode?: unknown };
      if (message.type === STORY_DATA_MESSAGE && Array.isArray(message.datasets)) { controller.invalidate(message.datasets as string[]); return; }
      if (message.type === STORY_READER_MODE_MESSAGE && (message.mode === 'light' || message.mode === 'dark')) {
        // The story root carries the document's mode as its class (lib/story/inline-story-html).
        mode = message.mode;
        applyColorMode(root, mode);
        return;
      }
      if (!isEditParentMessage(command)) return;
      if (command.type === STORY_EDIT_MODE_MESSAGE) {
        const wasEditing = editRequested;
        editRequested = command.on;
        if (!command.on) {
          // The editor and the page both say so on Done: the first ends the session and starts the return to reading.
          if (!wasEditing) return;
          edit?.dispose(); edit = null;
          // Editing paused to preview a version: that version draws on, and Done (`restored`) returns to the head.
          if (previewing) return;
          draftSequence++; pendingDraft = null; if (quietDraftTimer !== null) win.clearTimeout(quietDraftTimer); quietDraftTimer = null;
          if (frozen) { restoreSource = latestSource ?? initialSource(); restoreRead(); }
          return;
        }
        previewing = false;
        if (edit || editLoading) return;
        editLoading = true;
        if (!frozen) freezeIslandPaint(root, islands);
        frozen = true;
        void Promise.all([import('@/lib/story-runtime/edit/session'), import('@/solid/editor/dom-mounter')]).then(async ([{ createFrameEditSession }, { mountCompiledEditRegions }]) => {
          if (disposed || !editRequested) return;
          edit = createFrameEditSession({ win, root, channel, requestRender: () => {}, mountCompiled: mountCompiledEditRegions });
          edit.setNodes(nodes);
          await edit.mountCompiledDom();
        }).catch((error) => { if (!disposed) console.error('Failed to mount compiled editor', error); }).finally(() => { editLoading = false; });
        return;
      }
      if (edit) {
        edit.onParentMessage(command);
        if (command.type !== STORY_ANNOTATIONS_MESSAGE && command.type !== STORY_SELECTION_ACTIONS_MESSAGE
          && command.type !== STORY_SELECT_MESSAGE) return;
      }
      if (command.type === STORY_ANNOTATIONS_MESSAGE) {
        annotationCommand = command;
        if (annotate) { annotate.update(command); return; }
        if (command.mode === 'off' || annotationLoading) return;
        annotationLoading = true;
        void import('@/lib/story-runtime/edit/annotate').then(({ createFrameAnnotateSession }) => {
          if (disposed) return;
          annotate = createFrameAnnotateSession({ win, root, channel, isEditing: () => editRequested });
          annotate.setNodes(nodes);
          if (annotationCommand) annotate.update(annotationCommand);
        }).catch((error) => { if (!disposed) console.error('Failed to load artifact annotations', error); }).finally(() => { annotationLoading = false; });
        return;
      }
      if (command.type === STORY_SELECTION_ACTIONS_MESSAGE) {
        selectionCommand = command;
        if (selection) { selection.update(command); return; }
        if (selectionFactory) { ensureSelection(); return; }
        if ((!command.edit && !command.annotate) || selectionLoading) return;
        selectionLoading = true;
        void import('@/lib/story-runtime/edit/selection-actions').then(({ createFrameSelectionActions }) => {
          selectionFactory = createFrameSelectionActions;
          ensureSelection();
        }).catch((error) => { if (!disposed) console.error('Failed to load artifact selection actions', error); }).finally(() => { selectionLoading = false; });
        return;
      }
      if (command.type === STORY_SELECT_MESSAGE) annotate?.select(command.path);
      // The compiled root remains mounted while the editor attaches controls.
    },
    update(command: StoryDocumentUpdate) {
      if (disposed) return;
      if (command.source !== undefined && (editRequested || command.preview)) {
        const sequence = ++draftSequence;
        const source = command.source;
        // A previewed version is drawn like a draft but is not what Done saves: the head comes back after it.
        previewing = !!command.preview;
        if (previewing && !frozen) { freezeIslandPaint(root, islands); frozen = true; }
        if (!previewing) latestSource = source;
        const compile = () => {
          // Superseded while it waited (a newer draft queued itself instead, or Done moved on): nothing to compile.
          if (disposed || sequence !== draftSequence) return;
          compiling = true;
          // Frees THIS compile's slot once (after its answer is read, or on failure), never the next one's.
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            compiling = false;
            const next = queuedCompile;
            queuedCompile = null;
            next?.();
          };
          void win.fetch(`/a/${encodeURIComponent(id)}/draft-preview`, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ editId: command.editId ?? editId(), source, theme: command.theme, colorMode: command.colorMode, search: win.location.search }),
          }).then(async (response) => {
            // A failed or superseded compile leaves the last good preview in place.
            if (response.status === 422 || disposed || sequence !== draftSequence) return;
            if (!response.ok) throw new Error(`draft preview answered ${response.status}`);
            const payload = await response.json() as { html: string };
            // The server is free for the next draft while this one is drawn.
            release();
            await queueDraw(payload.html, command.nodes, source, sequence);
            if (pendingDraft?.sequence === sequence && quietDraftTimer === null) {
              quietDraftTimer = win.setTimeout(() => { quietDraftTimer = null; void applyDraft(true); }, 500);
            }
          }).catch((error) => { if (!disposed) console.error('Failed to compile editor draft', error); }).finally(release);
        };
        if (compiling) queuedCompile = compile; else compile();
        return;
      }
      previewing = false;
      if (frozen) {
        // Editing froze the islands and the page has not finished returning to reading: a version that lands
        // now (Done's own save, another writer) is what the page returns to.
        restoreRead(command.nodes);
        return;
      }
      // The version's source nodes, for the comments and selections classified against them — re-stamped
      // once the morph has drawn the version they describe.
      if (command.nodes) nodes = command.nodes;
      void updateCompiledStory(win, { mode: () => mode, adopted: true }).then(() => {
        if (disposed) return;
        annotate?.setNodes(nodes);
        selection?.setNodes(nodes);
      });
    },
    invalidate(datasets: string[]) {
      if (disposed) return;
      // The islands' own stream re-runs these already (lib/islands/boot installs the data hook while it holds it).
      if (typeof (win as unknown as Record<string, unknown>)[STORY_DATA_HOOK] === 'function') return;
      islands?.store?.invalidateDatasets(datasets);
    },
    subscribe(listener: (event: unknown) => void) { if (!disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    getViewportRect: () => new DOMRect(0, 0, win.innerWidth, win.innerHeight),
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      annotate?.dispose(); annotate = null;
      selection?.dispose(); selection = null;
      edit?.dispose(); edit = null;
      if (quietDraftTimer !== null) win.clearTimeout(quietDraftTimer);
      win.document.removeEventListener('focusout', onFocusOut, true);
    },
  };
  return controller;
}

export const docSheet = (doc: Document): HTMLStyleElement | null => doc.querySelector('style[data-mx-story-css]');

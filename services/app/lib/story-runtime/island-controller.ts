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
import { nextTask, parseHtmlInSlices } from '@/lib/story-runtime/sliced-parse';
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
/** A draft that must redraw the document waits until typing has paused this long: the typed region is never redrawn under the caret. */
export const TYPING_QUIET_MS = 1000;

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
  /** A draft that must redraw waits for typing to pause (TYPING_QUIET_MS) or for a pending host commit. */
  let quietDraftTimer: number | null = null;
  /** The last input inside the document (typing, composition, paste): what a redraw waits out. */
  let lastInputAt = -Infinity;
  /** One compile in flight; the newest draft that arrived meanwhile is sent when it answers (older ones never are). */
  let compiling = false;
  let nextCompile: (() => void) | null = null;
  /**
   * A draft since the last full draw carried more than typing (a panel, a paste, undo, a remote document, a
   * theme): the next compile is drawn, never only reconciled into the editor.
   */
  let redrawOwed = false;
  /** This editor session's name for its drafts' order (`X-Draft-Sequence`), and how many it has sent. */
  const draftSession = runtimeId().replace(/[^\w-]/g, '').slice(0, 64) || 'editor';
  let draftsSent = 0;
  let updateParts: typeof import('@/lib/story/document/update-parts') | null = null;
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
  /**
   * One draft is drawn at a time. The draw spans awaits (the engine, the draft's island module), and a
   * second draw inside that window would hydrate the root twice and remount the editor over a half-
   * morphed DOM; a newer draft that lands meanwhile is drawn once the current one is done.
   */
  let drawing: Promise<void> | null = null;
  let drawAgain: boolean | null = null;
  const applyDraft = (): Promise<void> => {
    if (drawing) { drawAgain = true; return drawing; }
    drawing = drawDraft().finally(() => {
      drawing = null;
      const again = drawAgain;
      drawAgain = null;
      if (again && !disposed) void applyDraft();
    });
    return drawing;
  };
  const retryDraw = (delay: number) => {
    if (quietDraftTimer !== null) win.clearTimeout(quietDraftTimer);
    quietDraftTimer = win.setTimeout(() => { quietDraftTimer = null; void applyDraft(); }, Math.max(0, delay));
  };
  /** Why a full draw must wait now (and for how long), or null: never under typing, a pending host commit or a composition. */
  const drawBlockedFor = (): number | null => {
    if (!editRequested) return null;
    const now = win.performance.now();
    const quiet = now - lastInputAt;
    if (quiet < TYPING_QUIET_MS) return TYPING_QUIET_MS - quiet;
    if (edit && !edit.canApplyDraft()) return 250;
    return null;
  };
  const drawDraft = async () => {
    const pending = pendingDraft;
    if (!pending || disposed || !drafting() || pending.sequence !== draftSequence) return;
    // The page's SHARED parse (update-parts storyUpdatePartsShared): the draft's source was parsed at the hand-over
    // that sent it, and the source on screen at the one before, so neither is parsed whole again when the reply lands.
    const [{ disposeChangedDraftIslands, hydrateDraftIslands, loadDraftModule, morphDraftDom, versionModuleUrl }, { storyUpdatePartsShared: storyUpdateParts }] = await Promise.all([
      import('@/lib/islands/morph/engine'), import('@/lib/story/document/update-parts'),
    ]);
    if (disposed || !drafting() || pending.sequence !== draftSequence || pendingDraft !== pending) return;
    // What stays is decided against the draft the page shows NOW. The served AST may carry resolved
    // assets or generated properties, so compare two parses of the authored source for component
    // identity; both use the same body-relative paths as the compiled DOM.
    // A saved version drawn after Done has no source: its served nodes stand in (fewer components match, never a wrong one).
    const before = shownTree((source) => storyUpdateParts(source)?.nodes);
    const afterParts = pending.source !== null ? storyUpdateParts(pending.source) : null;
    const after = afterParts?.nodes ?? pending.nodes;
    // Anything else redraws: never while typing (the region would be rebuilt under the caret), never over a host
    // commit or composition. It waits, and a newer draft that lands meanwhile replaces it.
    const wait = drawBlockedFor();
    if (wait !== null) { retryDraw(wait); return; }
    // Which components stay is decided from the two trees alone, before the draw's own tasks.
    const stableIds = stableIdsFor(after, before), stablePaths = stablePathsFor(after, before);
    // Fetch the draft's module while the editor is still mounted. From the hold to the remount nothing
    // awaits but one yield the hold is undone across when input lands in it: a keystroke typed during a slow
    // module fetch otherwise lands on no editor, and the caret comes back where it was when the fetch began.
    const module = await loadDraftModule(win, root, pending.document);
    const stale = () => disposed || !drafting() || pending.sequence !== draftSequence || pendingDraft !== pending;
    if (stale()) return;
    const late = drawBlockedFor();
    if (late !== null) { retryDraw(late); return; }
    // Editors whose region this draft draws exactly as it is stay mounted (focus, caret and history with them) and
    // the morph puts them where the draft has them; only the regions it changed are rebuilt.
    const keptEditors = edit?.holdUnchanged(pending.nodes, pending.root) ?? new Map<string, HTMLElement>();
    // The hold is its own task, the morph and remount the next: together they were one long task at slow CPUs.
    // Typing, a newer draft or leaving meanwhile undoes the hold (the editors run on as they were).
    await nextTask(win);
    if (stale()) { edit?.releaseHeld(); return; }
    const blocked = drawBlockedFor();
    if (blocked !== null) { edit?.releaseHeld(); retryDraw(blocked); return; }
    pendingDraft = null;
    if (quietDraftTimer !== null) { win.clearTimeout(quietDraftTimer); quietDraftTimer = null; }
    redrawOwed = false;
    shownSource = pending.source;
    shownParts = afterParts ? partsKey(afterParts) : null;
    const sheet = docSheet(win.document);
    // Written only when it changed: rewriting the same sheet re-styles the whole page, which the editors' removal
    // below then paid at once (most of a reply's apply on a table-heavy page).
    if (pending.sheet && sheet && sheet.textContent !== pending.sheet.textContent) sheet.textContent = pending.sheet.textContent;
    edit?.unmountCompiledDom();
    disposeChangedDraftIslands(root, stableIds, stablePaths);
    morphDraftDom(root, pending.root, stableIds, stablePaths, keptEditors);
    await hydrateDraftIslands(win, root, pending.document, stableIds, stablePaths, undefined, module, keptEditors);
    nodes = pending.nodes;
    lastDrawn = after;
    shown = { module: versionModuleUrl(pending.document), source: pending.source };
    drawnSequence = pending.sequence;
    edit?.setNodes(nodes);
    await edit?.mountCompiledDom();
    annotate?.setNodes(nodes);
    selection?.setNodes(nodes);
  };
  /** What the page shows now, as the authored tree: what a draft is drawn (or reconciled) against. */
  const shownTree = (parse: (source: string) => JsxNode[] | undefined): JsxNode[] => {
    const baseline = initialSource();
    return lastDrawn ?? (baseline ? parse(baseline) : undefined) ?? nodes;
  };
  /** What the tree on screen was parsed from, and its non-body parts (queries, author CSS and script). */
  let shownSource: string | null = null;
  let shownParts: string | null = null;
  const partsKey = (parts: { declarations: string; authorCss: string | null; authorScript: string | null }) =>
    JSON.stringify([parts.declarations, parts.authorCss, parts.authorScript]);
  /**
   * A draft whose only differences from the page are prose, adopted by the live editors in place — typed prose
   * they already show, or (`sync`) prose the source moved under them: an undo, a command, a remote document. No
   * compile, no morph, no remount. False when anything else changed: it is compiled and drawn.
   */
  const reconcileLocal = (after: JsxNode[], afterSource: string, afterParts: string, next: JsxNode[], parse: (text: string) => { nodes: JsxNode[]; declarations: string; authorCss: string | null; authorScript: string | null } | null): boolean => {
    if (!editRequested || redrawOwed || !edit) return false;
    if (lastDrawn === null) {
      const baseline = initialSource();
      const parts = baseline ? parse(baseline) : null;
      shownSource = baseline;
      shownParts = parts ? partsKey(parts) : null;
    }
    if (shownParts !== afterParts) return false;
    const before = lastDrawn ?? (shownSource ? parse(shownSource)?.nodes : undefined) ?? nodes;
    if (!edit.reconcileDraft(before, after, next, null, { sync: edit.canApplyDraft(), beforeSource: shownSource ?? undefined, afterSource })) return false;
    shownSource = afterSource;
    nodes = next;
    lastDrawn = after;
    edit.setNodes(nodes);
    annotate?.setNodes(nodes);
    selection?.setNodes(nodes);
    return true;
  };
  /** Parse a compiled page and queue it as the draft to draw (the newest wins). */
  const queueDraw = async (html: string, nodes: JsxNode[], source: string | null, sequence: number) => {
    // Parsed in slices: one parse of a table-heavy page was a single long task right as the reply landed.
    const next = await parseHtmlInSlices(win, html, () => !disposed && sequence === draftSequence && drafting());
    if (!next || disposed || sequence !== draftSequence || !drafting()) return;
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
  const onInput = () => { lastInputAt = win.performance.now(); };
  for (const type of ['beforeinput', 'input', 'compositionupdate'] as const) root.addEventListener(type, onInput, true);
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
          draftSequence++; pendingDraft = null; nextCompile = null; if (quietDraftTimer !== null) win.clearTimeout(quietDraftTimer); quietDraftTimer = null;
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
        // A new look (theme, colour mode) or a previewed version is a page the editors cannot show by themselves.
        if (previewing || ('redraw' in command && command.redraw === true)) redrawOwed = true;
        const compile = (retried = false) => {
          compiling = true;
          // The compile slot frees once the answer is read (before it is drawn): the newest draft that waited goes out.
          const release = () => {
            if (!compiling) return;
            compiling = false;
            const next = nextCompile;
            nextCompile = null;
            next?.();
          };
          void win.fetch(`/a/${encodeURIComponent(id)}/draft-preview`, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            // The server compiles one draft per editor session and answers an older one `superseded` (409).
            headers: { 'Content-Type': 'application/json', 'X-Draft-Sequence': `${draftSession}.${++draftsSent}` },
            body: JSON.stringify({ editId: command.editId ?? editId(), source, theme: command.theme, colorMode: command.colorMode, search: win.location.search }),
          }).then(async (response) => {
            // A failed or superseded compile leaves the last good preview in place: nothing to apply.
            if (response.status === 422 || response.status === 409 || disposed || sequence !== draftSequence) return;
            if (response.status === 429) {
              // Every compiler is busy: the newest draft is sent once more after the server's pause, never a storm.
              const wait = Math.min(10, Number(response.headers.get('Retry-After')) || 2) * 1000;
              if (!retried) win.setTimeout(() => { if (!disposed && sequence === draftSequence) { if (compiling) nextCompile = () => compile(true); else compile(true); } }, wait);
              return;
            }
            if (!response.ok) throw new Error(`draft preview answered ${response.status}`);
            const payload = await response.json() as { html: string };
            release();
            await queueDraw(payload.html, command.nodes, source, sequence);
          }).catch((error) => { if (!disposed) console.error('Failed to compile editor draft', error); }).finally(release);
        };
        // One compile at a time, newest wins: a draft that waits is replaced by any newer one.
        const request = () => { if (compiling) nextCompile = compile; else compile(); };
        if (redrawOwed || !edit) { request(); return; }
        // Prose needs no compile at all: typed, it is on screen already; moved by the source (undo, a command, a
        // remote document), the editor takes it in place. Only when the tree says otherwise (a component, a block
        // ahead of one, a query) is it compiled and drawn.
        // The shared parse: the editor that sent this draft parsed the same source a moment ago (lib/jsx/parse-shared).
        const local = ({ storyUpdatePartsShared }: typeof import('@/lib/story/document/update-parts')) => {
          if (disposed || sequence !== draftSequence) return;
          const parts = storyUpdatePartsShared(source);
          if (parts && reconcileLocal(parts.nodes, source, partsKey(parts), command.nodes, storyUpdatePartsShared)) { pendingDraft = null; return; }
          request();
        };
        // Once loaded, synchronously: an undo's caret, restored right after its source, lands on the adopted prose.
        if (updateParts) { local(updateParts); return; }
        void import('@/lib/story/document/update-parts').then((module) => { updateParts = module; local(module); })
          .catch((error: unknown) => { if (!disposed) console.error('Failed to reconcile editor draft', error); });
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
      for (const type of ['beforeinput', 'input', 'compositionupdate'] as const) root.removeEventListener(type, onInput, true);
      nextCompile = null;
    },
  };
  return controller;
}

export const docSheet = (doc: Document): HTMLStyleElement | null => doc.querySelector('style[data-mx-story-css]');

'use client';
/**
 * THE ADOPTED COMPILED DOCUMENT (docs/phase2-architecture.md §7.2–§7.5).
 *
 * On the HTML-first reader page the document is already on screen, its islands hydrated by the
 * island runtime (lib/islands/boot) and running on their own store. The app does not draw it
 * again: this component MOVES that very element into the app's tree (state-preserving
 * `moveBefore` where the browser has it) and renders nothing of the story itself. The page's
 * chrome around it, its comments and its selection bubble are the app's; they reach the document
 * through the same private controller the inline runtime hands the page (`StoryController`),
 * implemented here over the island DOM — comments and selections anchor on the `data-mx-ast`
 * paths the compiler keeps verbatim, classified against the version's SOURCE nodes.
 *
 * A new version is drawn IN PLACE, as the reader's own page does it before the app arrives: the one
 * update path (lib/islands/live-update) fetches the version's compiled story and morphs this element
 * into it — the React interpreter is never mounted for a reader. The reader's mode (the app's toggle)
 * and the version's source nodes (for comments and selections) follow.
 *
 * Leaving: the page swaps in the interpreter (components/ArtifactSurface) for edit mode, and on
 * navigation away. Either way the islands go: `dispose()` (their live stream, store and roots), then
 * the element, a microtask after the commit that replaced them — after the page has put them in `edit`
 * when the editor is what replaces them. A StrictMode replay keeps them.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
import { islandDocumentOf } from '@/lib/islands/handover';
import { updateCompiledStory } from '@/lib/islands/live-update';
import {
  STORY_ADOPT_HOOK, STORY_ANNOTATIONS_MESSAGE, type StoryDocumentUpdate, STORY_DATA_HOOK, STORY_DATA_MESSAGE, STORY_READER_MODE_MESSAGE,
  STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECT_MESSAGE, isEditParentMessage,
  STORY_EDIT_MODE_MESSAGE,
} from '@/lib/story-runtime/contract';
import { TrustedUi, useTrustedPortalContainer } from '@/components/TrustedUi';
import { adoptInitialStory, initialDocumentStory } from '@/web/initial-story';

export interface IslandStoryProps {
  id?: string;
  /** The compiled story root, as web/initial-story hands it over (`adoptInitialStory`). */
  story: HTMLElement;
  /** Its live island document, or null for a page whose module never booted (no islands). */
  islands: IslandDocument | null;
  /** The version's SOURCE nodes (the served runtime's), which comments and selections are classified against. */
  nodes: JsxNode[];
  source?: string | null;
  editId?: string;
  editing?: boolean;
  onController(controller: StoryController | null): void;
}

function SelectionPortal({ ready }: { ready: (element: HTMLElement | null) => void }) {
  const portal = useTrustedPortalContainer();
  useLayoutEffect(() => { ready(portal ?? null); return () => ready(null); }, [portal, ready]);
  return null;
}

type Movable = HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };

/** Move `story` under `host` keeping its state (iframes, focus, animations) where the browser can. */
function moveInto(host: HTMLElement, story: HTMLElement): void {
  if (story.parentElement === host) return;
  const move = (host as Movable).moveBefore;
  if (typeof move === 'function' && story.isConnected && host.isConnected) {
    try { move.call(host, story, null); return; } catch { /* a cross-document or disconnected move: append instead */ }
  }
  host.appendChild(story);
}

/** Stop island behavior for editing while retaining its last painted DOM as the compiled draft. */
function freezeIslandPaint(root: HTMLElement, islands: IslandDocument | null): void {
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

interface IslandControllerInput {
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
function createIslandController({ win, root, islands, nodes: served, portal, id, editId, initialSource }: IslandControllerInput): StoryController & { selectionReady(): void } {
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
  let editLoading = false;
  let draftSequence = 0;
  let lastDraftSource: string | null = null;
  let quietDraftTimer: number | null = null;
  let pendingDraft: { document: Document; root: HTMLElement; sheet: HTMLStyleElement | null; nodes: JsxNode[]; source: string; stableIds: Set<string>; stablePaths: Set<string>; sequence: number } | null = null;
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
  const applyDraft = async (allowFocused = false) => {
    const pending = pendingDraft;
    if (!pending || (focusedRegion() && (!allowFocused || !edit?.canApplyDraft())) || disposed || !editRequested || pending.sequence !== draftSequence) return;
    const { disposeChangedDraftIslands, hydrateDraftIslands, morphDraftDom } = await import('@/lib/islands/morph/engine');
    if (disposed || !editRequested || pending.sequence !== draftSequence || pendingDraft !== pending) return;
    pendingDraft = null;
    if (quietDraftTimer !== null) { win.clearTimeout(quietDraftTimer); quietDraftTimer = null; }
    const sheet = docSheet(win.document);
    if (pending.sheet && sheet) sheet.textContent = pending.sheet.textContent;
    edit?.unmountCompiledDom();
    disposeChangedDraftIslands(root, pending.stableIds, pending.stablePaths);
    morphDraftDom(root, pending.root, pending.stableIds, pending.stablePaths);
    await hydrateDraftIslands(win, root, pending.document, pending.stableIds, pending.stablePaths);
    nodes = pending.nodes;
    lastDraftSource = pending.source;
    edit?.setNodes(nodes);
    await edit?.mountCompiledDom();
    annotate?.setNodes(nodes);
    selection?.setNodes(nodes);
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
    send(command: unknown) {
      if (disposed || !command || typeof command !== 'object') return;
      if (isStoryDocumentUpdate(command)) { controller.update(command); return; }
      const message = command as { type?: string; datasets?: unknown; mode?: unknown };
      if (message.type === STORY_DATA_MESSAGE && Array.isArray(message.datasets)) { controller.invalidate(message.datasets as string[]); return; }
      if (message.type === STORY_READER_MODE_MESSAGE && (message.mode === 'light' || message.mode === 'dark')) {
        // The story root carries the document's mode as its class (lib/story/inline-story-html).
        mode = message.mode;
        root.classList.toggle('dark', message.mode === 'dark');
        root.classList.toggle('light', message.mode !== 'dark');
        return;
      }
      if (!isEditParentMessage(command)) return;
      if (command.type === STORY_EDIT_MODE_MESSAGE) {
        editRequested = command.on;
        if (!command.on) { draftSequence++; pendingDraft = null; if (quietDraftTimer !== null) win.clearTimeout(quietDraftTimer); quietDraftTimer = null; edit?.dispose(); edit = null; return; }
        if (edit || editLoading) return;
        editLoading = true;
        freezeIslandPaint(root, islands);
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
      if (editRequested && command.source !== undefined) {
        const sequence = ++draftSequence;
        const source = command.source;
        void win.fetch(`/a/${encodeURIComponent(id)}/draft-preview`, {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ editId: command.editId ?? editId(), source, theme: command.theme, colorMode: command.colorMode }),
        }).then(async (response) => {
          if (response.status === 422) return;
          if (!response.ok) throw new Error(`draft preview answered ${response.status}`);
          const payload = await response.json() as { html: string };
          const next = new DOMParser().parseFromString(payload.html, 'text/html');
          if (disposed || sequence !== draftSequence || !editRequested) return;
          const nextRoot = next.querySelector<HTMLElement>('[data-mx-inline-story]');
          if (!nextRoot) throw new Error('draft preview carried no story');
          // The served AST may carry resolved assets or generated properties.
          // Compare two parses of the authored source for component identity;
          // both use the same body-relative paths as the compiled DOM.
          const baseline = lastDraftSource ?? initialSource();
          const { storyUpdateParts } = await import('@/lib/story/update-parts');
          const before = baseline ? storyUpdateParts(baseline)?.nodes ?? nodes : nodes;
          const after = storyUpdateParts(source)?.nodes ?? command.nodes;
          pendingDraft = { document: next, root: nextRoot, sheet: next.querySelector<HTMLStyleElement>('style[data-mx-story-css]'), nodes: command.nodes, source,
            stableIds: stableIdsFor(after, before), stablePaths: stablePathsFor(after, before), sequence };
          await applyDraft();
          if (pendingDraft?.sequence === sequence && quietDraftTimer === null) {
            quietDraftTimer = win.setTimeout(() => { quietDraftTimer = null; void applyDraft(true); }, 500);
          }
        }).catch((error) => { if (!disposed) console.error('Failed to compile editor draft', error); });
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

const docSheet = (doc: Document): HTMLStyleElement | null => doc.querySelector('style[data-mx-story-css]');

export function IslandStory({ id, story, islands, nodes, source, editId, editing = false, onController }: IslandStoryProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<StoryController | null>(null);
  const portal = useRef<HTMLElement | null>(null);
  const selectionReady = useRef<(() => void) | null>(null);
  const [portalReady] = useState(() => (element: HTMLElement | null) => {
    portal.current = element;
    selectionReady.current?.();
  });
  const latest = useRef({ onController, editId, source });
  latest.current = { onController, editId, source };
  /** A leave waiting one microtask, so a StrictMode replay can keep the document. */
  const leaving = useRef<{ kept: boolean } | null>(null);
  useLayoutEffect(() => {
    if (leaving.current) { leaving.current.kept = true; leaving.current = null; }
    // Out of the served page (its chrome goes, the app's root shows), into this tree — in one step.
    if (initialDocumentStory() === story) adoptInitialStory();
    moveInto(host.current!, story);
    const hooks = window as unknown as Record<string, unknown>;
    /*
     * The islands' own live stream (lib/story-runtime/live-entry) reloads the page on a new version
     * unless a runtime adopts it. The app holds this document's stream now (lib/story/use-live-artifact)
     * and hands a new version to this controller, so a reload under it would lose the page.
     */
    const adoptedByPage = () => {};
    const ownsAdopt = hooks[STORY_ADOPT_HOOK] === undefined;
    if (ownsAdopt) hooks[STORY_ADOPT_HOOK] = adoptedByPage;
    const controller = createIslandController({ win: window, root: story, islands, nodes, portal,
      id: id ?? document.body.getAttribute('data-mx-live-id') ?? '', editId: () => latest.current.editId ?? '',
      initialSource: () => latest.current.source ?? null });
    controllerRef.current = controller;
    selectionReady.current = controller.selectionReady;
    latest.current.onController(controller);
    return () => {
      if (selectionReady.current === controller.selectionReady) selectionReady.current = null;
      latest.current.onController(null);
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (ownsAdopt && hooks[STORY_ADOPT_HOOK] === adoptedByPage) delete hooks[STORY_ADOPT_HOOK];
      const leave = { kept: false };
      leaving.current = leave;
      queueMicrotask(() => {
        if (leave.kept) return;
        if (leaving.current === leave) leaving.current = null;
        // The document running on the element now: a version that brought the page its first islands booted a new one.
        (islandDocumentOf(story) ?? islands)?.dispose();
        story.remove();
      });
    };
  }, [story, islands]);
  useEffect(() => {
    // The editor hook subscribes before it sends `on: true`. Mounting from this
    // route prop would expose an editable textbox before it can receive edits.
    if (!editing) controllerRef.current?.send({ type: STORY_EDIT_MODE_MESSAGE, on: false });
  }, [editing, story, islands]);
  return <>
    <TrustedUi overlay layer="selection"><SelectionPortal ready={portalReady} /></TrustedUi>
    <div ref={host} data-mx-story-host="" style={{ display: 'contents' }} />
  </>;
}

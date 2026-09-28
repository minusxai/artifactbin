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
 * Leaving: the page swaps in the interpreter (components/ArtifactSurface) for edit mode or a new
 * version — the islands are not recompiled in the browser — and on navigation away. Either way the
 * islands go: `dispose()` (their live stream, store and roots), then the element, a microtask after
 * the commit that replaced them — after the page has put them in `edit` when the editor is what
 * replaces them. A StrictMode replay keeps them.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { IslandDocument } from '@/lib/islands/contract';
import type { JsxNode } from '@/lib/jsx';
import type { StoryController } from '@/lib/story-runtime/EditorStoryRuntime';
import type { FrameAnnotateSession } from '@/lib/story-runtime/edit/annotate';
import type { FrameSelectionActions } from '@/lib/story-runtime/edit/selection-actions';
import type { RuntimeChannel } from '@/lib/story-runtime/pristine';
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { isStoryDocumentUpdate } from '@/lib/story-runtime/document-update';
import {
  STORY_ADOPT_HOOK, STORY_ANNOTATIONS_MESSAGE, STORY_DATA_HOOK, STORY_DATA_MESSAGE, STORY_READER_MODE_MESSAGE,
  STORY_SELECTION_ACTIONS_MESSAGE, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECT_MESSAGE, isEditParentMessage,
} from '@/lib/story-runtime/contract';
import { TrustedUi, useTrustedPortalContainer } from '@/components/TrustedUi';
import { adoptInitialStory, initialDocumentStory } from '@/web/initial-story';

export interface IslandStoryProps {
  /** The compiled story root, as web/initial-story hands it over (`adoptInitialStory`). */
  story: HTMLElement;
  /** Its live island document, or null for a page whose module never booted (no islands). */
  islands: IslandDocument | null;
  /** The version's SOURCE nodes (the served runtime's), which comments and selections are classified against. */
  nodes: JsxNode[];
  onController(controller: StoryController | null): void;
  /** Something asked this document to become another version: the page swaps in the interpreter. */
  onStale(): void;
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

interface IslandControllerInput {
  win: Window;
  root: HTMLElement;
  islands: IslandDocument | null;
  nodes: JsxNode[];
  portal: { current: HTMLElement | null };
  onStale(): void;
}

/**
 * The page's private handle on the adopted document: what the inline runtime's controller does
 * for comments, selections, reader mode and data wakeups, over the island DOM. Editing and new
 * versions are the interpreter's, so an update asks the page to hand over (`onStale`).
 */
function createIslandController({ win, root, islands, nodes, portal, onStale }: IslandControllerInput): StoryController & { selectionReady(): void } {
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
      if (isStoryDocumentUpdate(command)) { controller.update(); return; }
      const message = command as { type?: string; datasets?: unknown; mode?: unknown };
      if (message.type === STORY_DATA_MESSAGE && Array.isArray(message.datasets)) { controller.invalidate(message.datasets as string[]); return; }
      if (message.type === STORY_READER_MODE_MESSAGE && (message.mode === 'light' || message.mode === 'dark')) {
        // The story root carries the document's mode as its class (lib/story/story-element).
        root.classList.toggle('dark', message.mode === 'dark');
        root.classList.toggle('light', message.mode !== 'dark');
        return;
      }
      if (!isEditParentMessage(command)) return;
      if (command.type === STORY_ANNOTATIONS_MESSAGE) {
        annotationCommand = command;
        if (annotate) { annotate.update(command); return; }
        if (command.mode === 'off' || annotationLoading) return;
        annotationLoading = true;
        void import('@/lib/story-runtime/edit/annotate').then(({ createFrameAnnotateSession }) => {
          if (disposed) return;
          annotate = createFrameAnnotateSession({ win, root, channel, isEditing: () => false });
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
      // Edit mode is the interpreter's: the page swaps it in before the editor asks for it.
    },
    update() { if (!disposed) onStale(); },
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
    },
  };
  return controller;
}

export function IslandStory({ story, islands, nodes, onController, onStale }: IslandStoryProps): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const portal = useRef<HTMLElement | null>(null);
  const selectionReady = useRef<(() => void) | null>(null);
  const [portalReady] = useState(() => (element: HTMLElement | null) => {
    portal.current = element;
    selectionReady.current?.();
  });
  const latest = useRef({ onController, onStale });
  latest.current = { onController, onStale };
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
     * and hands a new version to the interpreter itself, so a reload under it would lose the page.
     */
    const adoptedByPage = () => {};
    const ownsAdopt = hooks[STORY_ADOPT_HOOK] === undefined;
    if (ownsAdopt) hooks[STORY_ADOPT_HOOK] = adoptedByPage;
    const controller = createIslandController({ win: window, root: story, islands, nodes, portal, onStale: () => latest.current.onStale() });
    selectionReady.current = controller.selectionReady;
    latest.current.onController(controller);
    return () => {
      if (selectionReady.current === controller.selectionReady) selectionReady.current = null;
      latest.current.onController(null);
      controller.dispose();
      if (ownsAdopt && hooks[STORY_ADOPT_HOOK] === adoptedByPage) delete hooks[STORY_ADOPT_HOOK];
      const leave = { kept: false };
      leaving.current = leave;
      queueMicrotask(() => {
        if (leave.kept) return;
        if (leaving.current === leave) leaving.current = null;
        islands?.dispose();
        story.remove();
      });
    };
  }, [story, islands]);
  return <>
    <TrustedUi overlay layer="selection"><SelectionPortal ready={portalReady} /></TrustedUi>
    <div ref={host} data-mx-story-host="" style={{ display: 'contents' }} />
  </>;
}

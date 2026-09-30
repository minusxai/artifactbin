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
import type { JsxNode } from '@/lib/jsx/types';
import type { StoryController } from '@/lib/story-runtime/contract';
import { islandDocumentOf } from '@/lib/islands/handover';
import { STORY_ADOPT_HOOK, STORY_EDIT_MODE_MESSAGE } from '@/lib/story-runtime/contract';
import { createIslandController, moveInto } from '@/lib/story-runtime/island-controller';
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

/**
 * THE CONTROLLER-ESTABLISHING MOUNT (components/IslandStory in SOLID).
 *
 * The compiled story root the server drew is already on screen, its islands hydrated. This adopts
 * THAT element — never drawing it again — and establishes the page's private controller over it
 * (lib/story-runtime/island-controller): comments and the selection bubble anchor on its
 * `data-mx-ast` paths, `window.mx` edits and in-place editing reach it through
 * lib/story-runtime/document-endpoint, and a new version is morphed into it in place.
 *
 * The page's chrome learns the controller's secret (`nonce`) from the returned accessors; the
 * controller is never posted and never on `window`.
 *
 * Holding the document: the islands' own live stream (lib/islands/live) would reload the page on a
 * new version, so this claims STORY_ADOPT_HOOK for its lifetime and the page feeds new versions to
 * `controller.update` itself. Leaving disposes the islands and removes the element a microtask after
 * cleanup, as the React mount did.
 */
import { createSignal, onCleanup, type Accessor } from 'solid-js';
import type { IslandDocument } from '@/lib/islands/contract';
import type { JsxNode } from '@/lib/jsx/types';
import { islandDocumentOf } from '@/lib/islands/handover';
import { STORY_ADOPT_HOOK, STORY_EDIT_MODE_MESSAGE, type StoryController } from '@/lib/story-runtime/contract';
import { stopIslandLive } from '@/lib/islands/live';
import { createIslandController, moveInto } from '@/lib/story-runtime/island-controller';
import { createTrustedOverlayHost } from '@/lib/story-runtime/trusted-overlay-host';

export interface IslandStoryOptions {
  id: string;
  host: HTMLElement;
  story: HTMLElement;
  islands: IslandDocument | null;
  /** The version's SOURCE nodes, which comments and selections are classified against. */
  nodes: JsxNode[];
  /** The head pointer drafts are previewed against (read live). */
  editId: () => string;
  /** The authored source the editor opened on, once it has it (read live). */
  source: () => string | null;
}

export interface IslandStory {
  controller: Accessor<StoryController | null>;
  nonce: Accessor<string | null>;
  /**
   * Leave edit mode in the document (the editor turns it on itself, after it subscribes). Settles once the page
   * reads again in place (the controller's `restored`); a rejection means it cannot, and the caller reloads.
   */
  stopEditing(): Promise<void>;
}

export function createIslandStory(options: IslandStoryOptions): IslandStory {
  const { host, story, islands } = options;
  moveInto(host, story);
  const hooks = window as unknown as Record<string, unknown>;
  const adoptedByPage = () => {};
  const ownsAdopt = hooks[STORY_ADOPT_HOOK] === undefined;
  if (ownsAdopt) hooks[STORY_ADOPT_HOOK] = adoptedByPage;
  // The app holds the document's stream now (solid/pages/Document): one stream per tab, not two.
  stopIslandLive(window);
  const overlay = createTrustedOverlayHost({ overlay: true, layer: 'selection' });
  const portal = { current: overlay.portal as HTMLElement | null };
  const controller = createIslandController({
    win: window, root: story, islands, nodes: options.nodes, portal,
    id: options.id, editId: options.editId, initialSource: options.source,
  });
  controller.selectionReady();
  const [current, setCurrent] = createSignal<StoryController | null>(controller);
  const [nonce, setNonce] = createSignal<string | null>(controller.nonce);
  onCleanup(() => {
    setCurrent(null);
    setNonce(null);
    controller.dispose();
    overlay.dispose();
    if (ownsAdopt && hooks[STORY_ADOPT_HOOK] === adoptedByPage) delete hooks[STORY_ADOPT_HOOK];
    queueMicrotask(() => {
      (islandDocumentOf(story) ?? islands)?.dispose();
      story.remove();
    });
  });
  return {
    controller: current,
    nonce,
    stopEditing: () => { controller.send({ type: STORY_EDIT_MODE_MESSAGE, on: false }); return controller.restored(); },
  };
}

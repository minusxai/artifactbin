/**
 * THE COMMENT LAYER, WITHOUT THE RUNTIME AROUND IT.
 *
 * Commenting needs the FRAME — only the document can see a Selection at an
 * opaque origin, measure a node, or find an anchor — but it does not need the
 * EDITOR. It was getting one anyway: a commenter's frame is asked for
 * `?edit=1`, which makes the document "hydrate", which ships the whole ~1.3 MB
 * hydration runtime so a page of prose can draw a tint. Tolerable for a handful
 * of invited collaborators; absurd once anyone with the link may comment
 * (lib/share-roles, general access).
 *
 * So this is a THIRD entry beside `entry.tsx` and `anchor-entry.ts`, and it is
 * a peer of the latter in size: the channel, the annotate session and the
 * view-mode selection surface, all DOM-only, no React anywhere in the cone.
 *
 * What it deliberately does NOT do, and why each is safe to drop:
 *  - hydrate      — nothing here re-renders; the SSR markup is the document.
 *  - adopt        — it never announces `mx:adopts`, so a live update reloads
 *                   the frame exactly as it does for any prose document today.
 *  - edit         — `isEditing` is a constant false. A document served to a
 *                   commenter has no editor to hand a click to, so the layer
 *                   may always swallow one to focus its thread.
 *  - run queries  — a document with data hydrates, so it never lands here.
 *
 * THE ISLAND IS REQUIRED. `describeSelection(el, nodes)` classifies the
 * selection against the SOURCE and returns null without it — so a DOM-only
 * version of this file would report no selection at all and commenting would
 * silently do nothing. The island is not the expensive part; the runtime is.
 */
import {
  STORY_ANNOTATIONS_MESSAGE, STORY_HELLO_MESSAGE, STORY_ISLAND_ID, STORY_SELECT_MESSAGE,
  STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, STORY_SESSION_MESSAGE,
  isEditParentMessage, type StoryAnnotationsMessage, type StoryIslandData, type StorySelectionActionsMessage,
} from './contract';
import { capturePristine } from './pristine';
import { createFrameAnnotateSession, type FrameAnnotateSession } from './edit/annotate';
import { createFrameSelectionActions, type FrameSelectionActions } from './edit/selection-actions';
import type { JsxNode } from '@/lib/jsx';

/** The document's own origin is opaque, so the app's is taken from where THIS module was fetched. */
const appOrigin = new URL(import.meta.url).origin;

function islandNodes(): JsxNode[] {
  const el = document.getElementById(STORY_ISLAND_ID);
  if (!el?.textContent) return [];
  try {
    return (JSON.parse(el.textContent) as StoryIslandData).nodes ?? [];
  } catch {
    return [];
  }
}

try {
  const channel = capturePristine(window, appOrigin);
  // No parent, or a parent at another origin: a shared reader's document is
  // served TOP-LEVEL and has nobody to talk to. Nothing below can apply.
  if (channel) {
    const nodes = islandNodes();

    /*
     * The SAME handshake the runtime performs, because the page verifies this
     * nonce on everything the frame sends — an unsigned annotation report is
     * dropped. Repeat briefly rather than announce once: the page may hydrate
     * after this document has painted, and a single announcement is a burst
     * with an end that it can miss entirely.
     */
    const announce = () => channel.post({ type: STORY_SESSION_MESSAGE, nonce: channel.nonce });
    announce();
    let left = 12;
    const beat = setInterval(() => { announce(); if (--left <= 0) clearInterval(beat); }, 200);

    let annotate: FrameAnnotateSession | null = null;
    let selectionActions: FrameSelectionActions | null = null;

    /*
     * Both sessions are constructed on the FIRST message that needs them
     * rather than up front: the whole module is one small chunk, so there is
     * nothing to code-split, but a document whose viewer turns comments OFF
     * (`mode: 'off'`, the hide-comments switch) should install no listeners
     * and mark no nodes.
     */
    const setAnnotations = (message: StoryAnnotationsMessage) => {
      if (!annotate) {
        if (message.mode === 'off') return;
        annotate = createFrameAnnotateSession({ win: window, channel, isEditing: () => false });
        annotate.setNodes(nodes);
      }
      annotate.update(message);
    };

    const setSelectionActions = (message: StorySelectionActionsMessage) => {
      if (!selectionActions) {
        // A viewer is sent two false flags and gets no surface at all.
        if (!message.edit && !message.annotate) return;
        selectionActions = createFrameSelectionActions({
          win: window,
          onAction: (action, selection) => channel.post({
            type: STORY_SELECTION_ACTION_MESSAGE, nonce: channel.nonce, action, selection,
          }),
        });
        selectionActions.setNodes(nodes);
      }
      selectionActions.update(message);
    };

    window.addEventListener('message', (event: MessageEvent) => {
      // The same three conditions the runtime applies: a REAL event, from the
      // window that frames us, at the app's own origin. A synthetic
      // MessageEvent can spoof `source`, which is what would otherwise let an
      // author's script hand itself the parent's authority.
      if (!event.isTrusted) return;
      if (!channel.isFromParent(event)) return;
      if (event.data === STORY_HELLO_MESSAGE) { announce(); return; }
      if (!isEditParentMessage(event.data)) return;
      if (event.data.type === STORY_ANNOTATIONS_MESSAGE) { setAnnotations(event.data); return; }
      if (event.data.type === STORY_SELECTION_ACTIONS_MESSAGE) { setSelectionActions(event.data); return; }
      if (event.data.type === STORY_SELECT_MESSAGE) annotate?.select(event.data.path);
    });
  }
} catch (err) {
  // A failed comment layer must never take the document with it: the SSR
  // markup IS the document, and a reader who cannot comment can still read.
  console.error('[story-comment] the comment layer failed to start:', err);
}

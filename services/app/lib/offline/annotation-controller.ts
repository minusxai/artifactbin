/** Local comment capability over the existing compiled DOM. No transport, auth or document engine. */
import type { JsxNode } from '@/lib/jsx';
import { runtimeId } from '@/lib/story-runtime/runtime-id';
import { createFrameAnnotateSession } from '@/lib/story-runtime/edit/annotate';
import { createFrameSelectionActions } from '@/lib/story-runtime/edit/selection-actions';
import { isEditParentMessage, STORY_ANNOTATIONS_MESSAGE, STORY_SELECT_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, type StoryController, type StoryEditSelection } from '@/lib/story-runtime/contract';

export function createFileAnnotationController(input: { root: HTMLElement; nodes: JsxNode[]; portal: HTMLElement; editing: () => boolean; onComment: (selection: StoryEditSelection) => void }): StoryController {
  const listeners = new Set<(event: unknown) => void>();
  const nonce = runtimeId();
  let disposed = false;
  const channel = { nonce, post: (event: unknown) => queueMicrotask(() => { if (!disposed) for (const listener of listeners) listener(event); }), innerHtmlOf: (element: HTMLElement) => element.innerHTML };
  const annotate = createFrameAnnotateSession({ win: window, root: input.root, channel, isEditing: input.editing });
  const selection = createFrameSelectionActions({ win: window, root: input.root, portal: input.portal, onAction: (action, picked) => { if (action === 'annotate') input.onComment(picked); } });
  annotate.setNodes(input.nodes); selection.setNodes(input.nodes);
  selection.update({ type: STORY_SELECTION_ACTIONS_MESSAGE, edit: false, annotate: true });
  return {
    nonce,
    send(command) {
      if (disposed || !isEditParentMessage(command)) return;
      if (command.type === STORY_ANNOTATIONS_MESSAGE) annotate.update(command);
      if (command.type === STORY_SELECTION_ACTIONS_MESSAGE) selection.update(command);
      if (command.type === STORY_SELECT_MESSAGE) annotate.select(command.path);
    },
    update(command) { if (!disposed && command.nodes) { annotate.setNodes(command.nodes); selection.setNodes(command.nodes); } },
    invalidate() { /* snapshot queries are deliberately local and fixed */ },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getViewportRect: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
    dispose() { disposed = true; listeners.clear(); annotate.dispose(); selection.dispose(); },
  };
}

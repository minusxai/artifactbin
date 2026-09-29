/* @jsxImportSource solid-js */
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { isEditFrameMessage, STORY_SELECTION_ACTION_MESSAGE, STORY_SELECTION_ACTIONS_MESSAGE, type StoryEditSelection, type StorySelectionActionsMessage } from '@/lib/story-runtime/contract';

export interface SelectionActionsProps {
  runtimeRef: DocumentRuntimeRef; nonce: string | null; canEdit: boolean; canAnnotate: boolean; editing: boolean;
  onEdit: (path: string) => void; onAnnotate: (selection: StoryEditSelection) => void;
}
/** The page grants and rechecks selection actions; the document runtime is never an authority. */
export function SelectionActions(props: SelectionActionsProps): JSX.Element {
  const capabilities = () => ({ edit: !!props.nonce && props.canEdit && !props.editing, annotate: !!props.nonce && props.canAnnotate && !props.editing });
  createEffect(() => {
    if (!props.nonce) return;
    sendDocument({ runtimeRef: props.runtimeRef }, { type: STORY_SELECTION_ACTIONS_MESSAGE, ...capabilities() } satisfies StorySelectionActionsMessage);
  });
  onMount(() => {
    const unsubscribe = subscribeDocument({ runtimeRef: props.runtimeRef }, event => {
      if (!props.nonce || !isEditFrameMessage(event.data, props.nonce) || event.data.type !== STORY_SELECTION_ACTION_MESSAGE) return;
      if (event.data.action === 'edit' && capabilities().edit) props.onEdit(event.data.selection.path);
      if (event.data.action === 'annotate' && capabilities().annotate) props.onAnnotate(event.data.selection);
    });
    onCleanup(unsubscribe);
  });
  return null;
}

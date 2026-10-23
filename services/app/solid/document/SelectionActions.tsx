/* @jsxImportSource solid-js */
import { createEffect, onCleanup, onMount, type JSX } from 'solid-js';
import { sendDocument, subscribeDocument, type DocumentRuntimeRef } from '@/lib/story-runtime/document-endpoint';
import { isEditFrameMessage, type StoryEditSelection, type StorySelectionActionsMessage } from '@/lib/edit-protocol';

interface SelectionActionsProps {
  runtimeRef: DocumentRuntimeRef; nonce: string | null; canAnnotate: boolean;
  onAnnotate: (selection: StoryEditSelection) => void;
}
/** The page grants and rechecks selection actions; the document runtime is never an authority. */
export function SelectionActions(props: SelectionActionsProps): JSX.Element {
  const capabilities = () => ({ edit: false, annotate: !!props.nonce && props.canAnnotate });
  createEffect(() => {
    if (!props.nonce) return;
    sendDocument({ runtimeRef: props.runtimeRef }, { type: 'mx:selection-actions', ...capabilities() } satisfies StorySelectionActionsMessage);
  });
  onMount(() => {
    const unsubscribe = subscribeDocument({ runtimeRef: props.runtimeRef }, event => {
      if (!props.nonce || !isEditFrameMessage(event.data, props.nonce) || event.data.type !== 'mx:selection-action') return;
      if (event.data.action === 'annotate' && capabilities().annotate) props.onAnnotate(event.data.selection);
    });
    onCleanup(unsubscribe);
  });
  return null;
}

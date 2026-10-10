/* @jsxImportSource solid-js */
/**
 * THE ONE REPLY BOX a thread has, wherever it is answered from: the rail's open thread and the
 * expanded hover card. One field (mentions, @agent tagging, ⌘↵), one send, one failure message —
 * so anything the field learns (attachments, say) arrives on both surfaces at once.
 *
 * The draft is the caller's: the rail keeps it on the thread, the hover card keeps it per thread
 * on the layer so closing the card cannot lose it.
 */
import { createSignal, Show, type JSX } from 'solid-js';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { CommentSubmitHint } from './CommentMarkdown';
import { CommentMarkdownField } from './LazyCommentField';

const REPLY_FAILED = 'Could not send reply. Your draft is saved here.';

export interface AnnotationReplyBoxProps {
  backend: ArtifactBackend;
  artifactId: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  /** Resolves true once the reply is saved; the box then empties. */
  onSend: (body: string) => Promise<boolean>;
  /** Called after a reply is saved. */
  onSent?: () => void;
  rows?: number;
  placeholder?: string;
  /** What sits beside Send — the rail's cancel. */
  actions?: JSX.Element;
}

export function AnnotationReplyBox(props: AnnotationReplyBoxProps): JSX.Element {
  let sending = false;
  const [error, setError] = createSignal('');
  // ONE send for the button and for ⌘↵ — the field owns the key, the box owns whether there is anything to send.
  const send = async () => {
    if (props.busy || sending || !hasReplyText(props.value)) return;
    sending = true; setError('');
    try {
      if (!await props.onSend(props.value)) throw new Error(REPLY_FAILED);
      props.onChange('');
      props.onSent?.();
    } catch { setError(REPLY_FAILED); }
    finally { sending = false; }
  };
  return <>
    <CommentMarkdownField backend={props.backend} artifactId={props.artifactId}
      label="Reply to annotation" quickAgents placeholder={props.placeholder}
      value={props.value} onChange={props.onChange} onSubmit={() => void send()}
      rows={props.rows ?? 3} />
    <Show when={error()}><p role="alert" class="text-xs text-red-500">{error()}</p></Show>
    <div data-reply-actions class="flex items-center justify-end gap-2">
      <CommentSubmitHint action="reply" />
      {props.actions}
      <button type="button" aria-label="Send reply" disabled={props.busy || !hasReplyText(props.value)} onClick={() => void send()}
        class="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40">reply</button>
    </div>
  </>;
}

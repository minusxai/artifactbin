/* @jsxImportSource solid-js */
/**
 * THE ONE REPLY BOX a thread has, wherever it is answered from: the rail's open thread and the
 * expanded hover card. One field (mentions, @agent tagging, ⌘↵), one send, one failure message —
 * so anything the field learns arrives on both surfaces at once — its one image (paste, drop or Attach
 * image, CommentImageAttach) included: staged at send, carried by the reply, kept with the words when
 * sending fails.
 *
 * The draft is the caller's: the rail keeps it on the thread, the hover card keeps it per thread
 * on the layer so closing the card cannot lose it.
 */
import { createSignal, Show, type JSX } from 'solid-js';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { CommentSubmitHint } from './CommentMarkdown';
import { CommentMarkdownField } from './LazyCommentField';
import { createCommentImageDraft, type CommentImageAttachment, type CommentImageDraft } from './CommentImageAttach';

const REPLY_FAILED = 'Could not send reply. Your draft is saved here.';

export interface AnnotationReplyBoxProps {
  backend: ArtifactBackend;
  artifactId: string;
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  /**
   * Resolves true once the reply is saved; the box then empties. `attachment` is the staged image when the
   * box has one. A BackendRequestError for the image (`invalid_attachment`, `stale`) is shown as is.
   */
  onSend: (body: string, attachment?: CommentImageAttachment) => Promise<boolean>;
  /** Called after a reply is saved. */
  onSent?: () => void;
  rows?: number;
  placeholder?: string;
  /** Put the caret in the field as it mounts (someone pressed a Reply that opened it). */
  autoFocus?: boolean;
  /** What sits beside Send — the rail's cancel. */
  actions?: JSX.Element;
  /**
   * The box's image draft, when it must outlive the box (the thread's, the hover card's). Absent, the box
   * makes its own from the layer's CommentImagesProvider; null, the box takes no image.
   */
  image?: CommentImageDraft | null;
}

export function AnnotationReplyBox(props: AnnotationReplyBoxProps): JSX.Element {
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal('');
  const image = props.image === undefined ? createCommentImageDraft() : props.image;
  const imageBusy = () => !!image?.capture.busy();
  // ONE send for the button and for ⌘↵ — the field owns the key, the box owns whether there is anything to send.
  const send = async () => {
    if (props.busy || sending() || imageBusy() || !hasReplyText(props.value)) return;
    setSending(true); setError('');
    try {
      let attachment: CommentImageAttachment | undefined;
      try { attachment = await image?.stage(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : REPLY_FAILED); return; }
      if (!await props.onSend(props.value, attachment)) throw new Error(REPLY_FAILED);
      props.onChange('');
      image?.capture.reset();
      props.onSent?.();
    } catch (cause) {
      // The image was refused (the document moved, or the stage is no longer usable): say so, keep the
      // words and the picture, and upload it afresh on the next send.
      if (cause instanceof BackendRequestError && (cause.code === 'invalid_attachment' || cause.code === 'stale')) {
        image?.capture.unstage();
        setError(cause.message);
      } else setError(REPLY_FAILED);
    } finally { setSending(false); }
  };
  return <>
    <CommentMarkdownField backend={props.backend} artifactId={props.artifactId}
      label="Reply to annotation" quickAgents placeholder={props.placeholder} image={image} busy={props.busy || sending()}
      value={props.value} onChange={props.onChange} onSubmit={() => void send()}
      rows={props.rows ?? 3} autoFocus={props.autoFocus} />
    <Show when={error()}><p role="alert" class="text-xs text-red-500">{error()}</p></Show>
    <div data-reply-actions class="flex items-center justify-end gap-2">
      <CommentSubmitHint action="reply" />
      {props.actions}
      <button type="button" aria-label="Send reply" disabled={props.busy || sending() || imageBusy() || !hasReplyText(props.value)} onClick={() => void send()}
        class="cursor-pointer rounded-[4px] border border-accent bg-accent px-2 py-1 font-semibold text-bg hover:brightness-110 disabled:cursor-default disabled:opacity-40">reply</button>
    </div>
  </>;
}

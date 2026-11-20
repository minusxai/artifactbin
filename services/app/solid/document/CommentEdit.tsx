/* @jsxImportSource solid-js */
/**
 * EDITING ONE COMMENT IN PLACE, in a rail thread (AnnotationThread): the edit's state, kept for this tab, and the
 * editor that stands in for the comment's body while it is rewritten.
 */
import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import type { AnnotationCommentWire } from '@artifactbin/contracts/annotation-comment';
import type { ArtifactBackend } from '@/lib/artifact-backend';
import { BackendRequestError } from '@/lib/artifact-backend/errors';
import { hasReplyText } from '@/lib/annotations/remote-reply';
import { Button } from '../ui/Button';
import { readDraft, writeDraft } from '../lib/draft-store';
import { CommentSubmitHint } from './CommentMarkdown';
import { CommentMarkdownField } from './LazyCommentField';

const EDIT_FAILED = 'Could not save your edit. It is still here; try again.';

/**
 * ONE comment of a thread is edited at a time, in place of its body; the draft survives a refused save. The comment
 * being rewritten and its words are kept for this tab under `key`: a reload reopens the edit where it was. Starting an
 * edit opens the thread (`open`).
 */
export function createCommentEdit(key: string, thread: { onEdit: () => ((commentId: string, body: string) => Promise<void>) | undefined; open: () => void }) {
  const kept = (() => { try { return JSON.parse(readDraft(key) || 'null') as { comment?: unknown; body?: unknown } | null; } catch { return null; } })();
  const [editing, setEditing] = createSignal<string | null>(typeof kept?.comment === 'string' && typeof kept.body === 'string' ? kept.comment : null);
  const [draft, setDraft] = createSignal(editing() ? String(kept?.body) : '');
  createEffect(() => { const comment = editing(); writeDraft(key, comment ? JSON.stringify({ comment, body: draft() }) : ''); });
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const cancel = () => { if (saving()) return; setEditing(null); setDraft(''); setError(''); };
  return {
    editing, draft, setDraft, error, saving, cancel,
    start: (comment: AnnotationCommentWire) => { setDraft(comment.body); setError(''); setEditing(comment.id); thread.open(); },
    save: async (comment: AnnotationCommentWire) => {
      const body = draft();
      const onEdit = thread.onEdit();
      if (saving() || !onEdit || !hasReplyText(body)) return;
      if (body === comment.body) { cancel(); return; }
      setSaving(true); setError('');
      try { await onEdit(comment.id, body); setEditing(null); setDraft(''); }
      catch (cause) { setError(cause instanceof BackendRequestError && cause.code === 'annotation_conflict' ? cause.message : EDIT_FAILED); }
      finally { setSaving(false); }
    },
  };
}

/** The editor in place of a comment's body: Escape or cancel puts it away, ⌘↵ or save sends it. */
export function CommentEditor(props: { edit: ReturnType<typeof createCommentEdit>; comment: AnnotationCommentWire; backend: ArtifactBackend; artifactId: string }): JSX.Element {
  const edit = props.edit;
  // Escape cancels, from anywhere in the editor (a native listener: the rail may sit in a shadow root). The
  // editor's own keymap claims Escape (select parent node), so its defaultPrevented says nothing here; an
  // open mention picker stops the key before it bubbles this far.
  return <div data-comment-editor on:keydown={(event) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); edit.cancel(); }}>
    <CommentMarkdownField backend={props.backend} artifactId={props.artifactId} label="Edit comment" busy={edit.saving()}
      value={edit.draft()} onChange={edit.setDraft} onSubmit={() => void edit.save(props.comment)} rows={3} autoFocus />
    <Show when={edit.error()}><p role="alert" class="text-xs text-danger">{edit.error()}</p></Show>
    <div class="mt-2 flex items-center justify-end gap-2">
      <CommentSubmitHint action="save" />
      <Button type="button" variant="ghost" size="sm" aria-label="Cancel edit" disabled={edit.saving()} onClick={edit.cancel}>cancel</Button>
      <Button type="button" size="sm" aria-label="Save edit" disabled={edit.saving() || !hasReplyText(edit.draft())} onClick={() => void edit.save(props.comment)}>save</Button>
    </div>
  </div>;
}

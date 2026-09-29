/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { parseMarkdownLite, wrapSelection, type MdInline, type MdMarker, type MdNode } from '@/lib/markdown-lite';
import { mentionDraft } from '@/lib/mention-draft';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { CommentMentionPicker, type MentionKeyboard } from './CommentMentionPicker';

function inline(nodes: MdInline[]): JSX.Element {
  return <For each={nodes}>{node => {
    switch (node.kind) {
      case 'text': return node.text;
      case 'break': return <br />;
      case 'strong': return <strong class="font-semibold text-fg">{inline(node.children)}</strong>;
      case 'em': return <em class="italic">{inline(node.children)}</em>;
      case 'code': return <code class="break-all rounded bg-raised px-1 py-0.5 font-mono">{node.text}</code>;
      case 'link': return <a href={node.href} target="_blank" rel="noopener noreferrer" class="break-words text-accent underline">{inline(node.children)}</a>;
    }
  }}</For>;
}

function block(node: MdNode): JSX.Element {
  switch (node.kind) {
    case 'paragraph': return <p class="leading-normal">{inline(node.children)}</p>;
    case 'code_block': return <pre class="min-w-0 max-w-full overflow-x-auto rounded border border-edge bg-raised p-2 font-mono text-xs"><code>{node.text}</code></pre>;
    case 'list': return node.ordered
      ? <ol class="min-w-0 list-decimal pl-5"><For each={node.items}>{item => <li>{item.children.map(block)}</li>}</For></ol>
      : <ul class="min-w-0 list-disc pl-5"><For each={node.items}>{item => <li>{item.children.map(block)}</li>}</For></ul>;
    case 'quote': return <blockquote class="min-w-0 border-l-2 border-edge pl-2.5 text-muted">{node.children.map(block)}</blockquote>;
  }
}

/** Strict markdown-lite AST to elements: authored HTML is always text. */
export function CommentMarkdown(props: { text: string; label?: string; class?: string }): JSX.Element {
  return <div data-markdown aria-label={props.label} class={`flex min-w-0 flex-col gap-2 font-sans leading-normal ${props.class ?? ''}`}>
    {parseMarkdownLite(props.text).map(block)}
  </div>;
}

const MARKERS = [
  ['bold', 'Bold'], ['italic', 'Italic'], ['code', 'Code'], ['link', 'Link'], ['list', 'List'],
] as const;
const KEYS: Record<string, MdMarker> = { b: 'bold', i: 'italic', e: 'code' };

/** A controlled plain-text field; the toolbar edits the source and the preview only renders it. */
export function CommentMarkdownField(props: {
  label: string; value: string; onChange: (value: string) => void; onSubmit?: () => void;
  placeholder?: string; rows?: number; previewLabel?: string; previewToggleLabel?: string;
  backend?: ArtifactBackend; artifactId?: string;
}): JSX.Element {
  let field: HTMLTextAreaElement | undefined;
  let keyboard: MentionKeyboard | null = null;
  const [previewing, setPreviewing] = createSignal(false);
  const [mention, setMention] = createSignal<{ start: number; end: number; query: string } | null>(null);
  const canMention = () => props.backend && !(props.backend.unavailable('remoteSessions') && props.backend.unavailable('mentions'));
  const chooseMention = (text: string) => {
    const current = mention();
    if (!current) return;
    const next = props.value.slice(0, current.start) + text + props.value.slice(current.end);
    props.onChange(next);
    setMention(null);
    queueMicrotask(() => { field?.focus(); const at = mentionDraft(next).toDisplay(current.start + text.length); field?.setSelectionRange(at, at); });
  };
  const apply = (marker: MdMarker) => {
    if (!field) return;
    const projected = mentionDraft(props.value);
    const next = wrapSelection(props.value, projected.toRaw(field.selectionStart), projected.toRaw(field.selectionEnd, 'end'), marker);
    props.onChange(next.text);
    queueMicrotask(() => { field?.focus(); const nextDraft = mentionDraft(next.text); field?.setSelectionRange(nextDraft.toDisplay(next.start), nextDraft.toDisplay(next.end)); });
  };
  return <div class="min-w-0">
    <div role="toolbar" aria-label={`${props.label} formatting`} class="mb-1 flex gap-1">
      <For each={MARKERS}>{([marker, name]) => <button type="button" aria-label={name} disabled={previewing()} onMouseDown={event => event.preventDefault()} onClick={() => apply(marker)}>{name}</button>}</For>
      <button type="button" aria-label={props.previewToggleLabel ?? 'Preview comment'} aria-pressed={previewing()} onClick={() => setPreviewing(value => !value)}>{previewing() ? 'edit' : 'preview'}</button>
    </div>
    <Show when={mention()}>{current => props.backend && <CommentMentionPicker backend={props.backend} artifactId={props.artifactId} query={current().query} onSelect={chooseMention} onReady={handle => { keyboard = handle; }} />}</Show>
    <Show when={previewing()} fallback={<textarea ref={field} aria-label={props.label} value={mentionDraft(props.value).text} rows={props.rows ?? 3} placeholder={props.placeholder}
      onInput={event => {
        const display = event.currentTarget.value, caret = event.currentTarget.selectionStart;
        const draft = mentionDraft(props.value);
        const raw = draft.edit(display, caret);
        props.onChange(raw);
        const match = display.slice(0, caret).match(/(?:^|\s)@([^\s@\[\]]*)$/);
        setMention(canMention() && match ? { start: mentionDraft(raw).toRaw(caret - match[1].length - 1), end: mentionDraft(raw).toRaw(caret, 'end'), query: match[1] } : null);
      }}
      onKeyDown={event => {
        if (mention() && !(event.metaKey || event.ctrlKey)) {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
          if (keyboard?.keyDown(event.key)) { event.preventDefault(); event.stopPropagation(); return; }
        }
        if (!(event.metaKey || event.ctrlKey)) return;
        if (event.key === 'Enter') { event.preventDefault(); props.onSubmit?.(); }
        else { const marker = KEYS[event.key.toLowerCase()]; if (marker) { event.preventDefault(); apply(marker); } }
      }}
      class="w-full rounded border border-edge bg-bg p-2 text-sm" />}>
      <CommentMarkdown text={props.value} label={props.previewLabel ?? 'Comment preview'} class="min-h-12 rounded border border-edge bg-surface p-2" />
    </Show>
  </div>;
}

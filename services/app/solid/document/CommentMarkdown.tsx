/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { parseMarkdownLite, wrapSelection, type MdInline, type MdMarker, type MdNode } from '@/lib/markdown-lite';
import { mentionDraft } from '@/lib/mention-draft';

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
}): JSX.Element {
  let field: HTMLTextAreaElement | undefined;
  const [previewing, setPreviewing] = createSignal(false);
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
    <Show when={previewing()} fallback={<textarea ref={field} aria-label={props.label} value={mentionDraft(props.value).text} rows={props.rows ?? 3} placeholder={props.placeholder}
      onInput={event => { const draft = mentionDraft(props.value); props.onChange(draft.edit(event.currentTarget.value, event.currentTarget.selectionStart)); }}
      onKeyDown={event => { if (!(event.metaKey || event.ctrlKey)) return; if (event.key === 'Enter') { event.preventDefault(); props.onSubmit?.(); } else { const marker = KEYS[event.key.toLowerCase()]; if (marker) { event.preventDefault(); apply(marker); } } }}
      class="w-full rounded border border-edge bg-bg p-2 text-sm" />}>
      <CommentMarkdown text={props.value} label={props.previewLabel ?? 'Comment preview'} class="min-h-12 rounded border border-edge bg-surface p-2" />
    </Show>
  </div>;
}

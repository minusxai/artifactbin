/* @jsxImportSource solid-js */
/**
 *
 *
 * READING: the parsed markdown-lite tree as elements, and only elements — the parser refuses raw
 * HTML, so what an agent wrote reaches the app's origin as characters. Prose takes the sans face;
 * mono is spent on inline code and fenced blocks. A `<pre>` scrolls inside itself so it never
 * widens the rail; inline code breaks anywhere because it has no box of its own to scroll.
 *
 * WRITING: a textarea, a light toolbar over it, and a Preview that swaps the two. It holds no draft
 * of its own — the value belongs to whoever mounts it, so what ⌘↵ sends is the same plain text that
 * was in the field. A toolbar button never takes the caret (mousedown is prevented), and after a
 * press the caret is put back on the WORDS, so bold-then-code nests the way editors do.
 */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import Bold from 'lucide-solid/icons/bold';
import Code from 'lucide-solid/icons/code';
import Italic from 'lucide-solid/icons/italic';
import Link2 from 'lucide-solid/icons/link-2';
import List from 'lucide-solid/icons/list';
import { parseMarkdownLite, wrapSelection, type MdInline, type MdMarker, type MdNode } from '@/lib/annotations/markdown-lite';
import { mentionDraft } from '@/lib/annotations/mention-draft';
import { isPersonMentionHref } from '@/lib/annotations/person-mentions';
import { isSessionMentionHref } from '@/lib/annotations/session-mentions';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { REMOTE_COLOR_CSS, remoteColor } from '../../../contracts/src/remote';
import { Tooltip } from '../components/Tooltip';
import { CommentMentionPicker, type MentionKeyboard } from './CommentMentionPicker';
import { PersonMention } from './PersonMention';

const CODE_CLASS = 'break-all rounded-[3px] bg-raised px-1 py-0.5 font-mono text-[0.92em] text-fg';

function inline(nodes: MdInline[]): JSX.Element {
  return <For each={nodes}>{(node) => {
    switch (node.kind) {
      case 'text': return node.text;
      case 'break': return <br />;
      case 'strong': return <strong class="font-semibold text-fg">{inline(node.children)}</strong>;
      case 'em': return <em class="italic">{inline(node.children)}</em>;
      case 'code': return <code class={CODE_CLASS}>{node.text}</code>;
      case 'link':
        if (isPersonMentionHref(node.href)) return <PersonMention href={node.href} class="text-accent">{inline(node.children)}</PersonMention>;
        if (isSessionMentionHref(node.href)) return (
          <Tooltip content="Open agent session"><a href={node.href} target="_blank" rel="noopener noreferrer"
            style={{ color: REMOTE_COLOR_CSS[remoteColor(node.href.split('=')[1] ?? '')] }} data-agent-mention=""
            class="inline-flex max-w-full items-center rounded-md border border-accent/20 bg-accent-soft px-1.5 py-0.5 align-baseline text-[0.9em] font-medium text-accent no-underline hover:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            {inline(node.children)}
          </a></Tooltip>
        );
        return <a href={node.href} target="_blank" rel="noopener noreferrer" class="break-words text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid">{inline(node.children)}</a>;
    }
  }}</For>;
}

function block(node: MdNode): JSX.Element {
  switch (node.kind) {
    case 'paragraph': return <p class="leading-normal">{inline(node.children)}</p>;
    case 'code_block': return <pre class="min-w-0 max-w-full overflow-x-auto rounded-[4px] border border-edge bg-raised p-2 font-mono text-[11px] leading-snug text-fg"><code>{node.text}</code></pre>;
    case 'list': {
      const items = () => <For each={node.items}>{(item) => <li class="min-w-0 leading-normal"><For each={item.children}>{block}</For></li>}</For>;
      return node.ordered
        ? <ol class="min-w-0 pl-5 list-decimal marker:text-faint">{items()}</ol>
        : <ul class="min-w-0 pl-5 list-disc marker:text-faint">{items()}</ul>;
    }
    case 'quote': return <blockquote class="min-w-0 border-l-2 border-edge pl-2.5 text-muted"><For each={node.children}>{block}</For></blockquote>;
  }
}

/** One comment body, read. `label` names the rendering where it stands in for a field (the composer's preview). */
export function CommentMarkdown(props: { text: string; label?: string; class?: string }): JSX.Element {
  return <div data-markdown aria-label={props.label} class={`flex min-w-0 flex-col gap-2 font-sans leading-normal text-fg/90 ${props.class ?? ''}`}>
    <For each={parseMarkdownLite(props.text)}>{block}</For>
  </div>;
}

/** ⌘B / ⌘I / ⌘E — the three every editor binds, and nothing beyond them. */
const KEYS: Record<string, MdMarker> = { b: 'bold', i: 'italic', e: 'code' };
const TOOLBAR = [
  { marker: 'bold', label: 'Bold', hint: 'bold (⌘B)', Icon: Bold },
  { marker: 'italic', label: 'Italic', hint: 'italic (⌘I)', Icon: Italic },
  { marker: 'code', label: 'Code', hint: 'code (⌘E)', Icon: Code },
  { marker: 'link', label: 'Link', hint: 'link', Icon: Link2 },
  { marker: 'list', label: 'List', hint: 'list', Icon: List },
] satisfies Array<{ marker: MdMarker; label: string; hint: string; Icon: typeof Bold }>;
const toolButton = 'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-surface hover:text-fg';

export interface CommentMarkdownFieldProps {
  /** The textarea's own accessible name. */
  label: string;
  /** The rendered draft's accessible name while Preview is on. */
  previewLabel?: string;
  /** "Preview comment" / "Preview reply" — the toggle's own name. */
  previewToggleLabel?: string;
  value: string;
  onChange: (value: string) => void;
  /** ⌘↵. The caller decides whether the draft is sendable at all. */
  onSubmit?: () => void;
  /** Controlled by the caller when given (a reply resets it after sending); otherwise held here. */
  previewing?: boolean;
  onPreviewingChange?: (previewing: boolean) => void;
  rows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  class?: string;
  /** Mentions look people and agents up here; without it `@` is just a character. */
  backend?: ArtifactBackend;
  artifactId?: string;
  /** Anything ABOVE the toolbar — the composer's breadcrumb, which says what is being commented on. */
  children?: JSX.Element;
}

export function CommentMarkdownField(props: CommentMarkdownFieldProps): JSX.Element {
  let field: HTMLTextAreaElement | undefined;
  let keyboard: MentionKeyboard | null = null;
  const [ownPreviewing, setOwnPreviewing] = createSignal(false);
  const previewing = () => props.previewing ?? ownPreviewing();
  const setPreviewing = (value: boolean) => { if (props.onPreviewingChange) props.onPreviewingChange(value); else setOwnPreviewing(value); };
  const [mention, setMention] = createSignal<{ start: number; end: number; query: string } | null>(null);
  // Where no one can be mentioned (an offline file), "@" is just a character.
  const canMention = () => !props.backend || !(props.backend.unavailable('remoteSessions') && props.backend.unavailable('mentions'));
  /** After the value is on the element, never before: a range into it means nothing until then. */
  const restore = (start: number, end: number) => queueMicrotask(() => {
    if (!field?.isConnected) return;
    const draft = mentionDraft(props.value);
    field.focus();
    field.setSelectionRange(draft.toDisplay(start), draft.toDisplay(end));
  });
  const apply = (marker: MdMarker) => {
    if (!field) return;
    const projected = mentionDraft(props.value);
    const next = wrapSelection(props.value, projected.toRaw(field.selectionStart), projected.toRaw(field.selectionEnd, 'end'), marker);
    props.onChange(next.text);
    restore(next.start, next.end);
  };
  const chooseMention = (text: string) => {
    const current = mention();
    if (!current) return;
    const caret = current.start + text.length;
    props.onChange(props.value.slice(0, current.start) + text + props.value.slice(current.end));
    setMention(null);
    restore(caret, caret);
  };
  onMount(() => { if (props.autoFocus) field?.focus(); });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (mention() && !event.metaKey && !event.ctrlKey) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
      if (keyboard?.keyDown(event.key)) { event.preventDefault(); event.stopPropagation(); return; }
    }
    if (!event.metaKey && !event.ctrlKey) return;
    if (event.key === 'Enter') { event.preventDefault(); props.onSubmit?.(); return; }
    const marker = KEYS[event.key.toLowerCase()];
    if (!marker) return;
    // Prevented so the browser's own bold/italic never reaches the field.
    event.preventDefault();
    apply(marker);
  };
  return <div class={`min-w-0 ${props.class ?? ''}`}>
    {props.children}
    <div role="toolbar" aria-label={`${props.label} formatting`} class="mb-1 flex items-center gap-0.5">
      <For each={TOOLBAR}>{(tool) => (
        <Tooltip content={tool.hint}>
          <button type="button" aria-label={tool.label} disabled={previewing()} onMouseDown={(event) => event.preventDefault()} onClick={() => apply(tool.marker)}
            class={`${toolButton} disabled:cursor-default disabled:opacity-40`}>
            <tool.Icon size={13} strokeWidth={1.8} />
          </button>
        </Tooltip>
      )}</For>
      <Tooltip content={previewing() ? 'back to writing' : 'preview markdown'}>
        <button type="button" aria-label={props.previewToggleLabel ?? 'Preview comment'} aria-pressed={previewing()}
          onMouseDown={(event) => event.preventDefault()} onClick={() => { setMention(null); setPreviewing(!previewing()); }}
          class={`ml-auto cursor-pointer rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] ${previewing() ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-surface hover:text-fg'}`}>
          {previewing() ? 'edit' : 'preview'}
        </button>
      </Tooltip>
    </div>
    <Show when={previewing()} fallback={
      <textarea ref={field} aria-label={props.label} value={mentionDraft(props.value).text} rows={props.rows ?? 3} placeholder={props.placeholder}
        onInput={(event) => {
          const text = event.currentTarget.value, end = event.currentTarget.selectionStart;
          const raw = mentionDraft(props.value).edit(text, end);
          const next = mentionDraft(raw);
          const match = text.slice(0, end).match(/(?:^|\s)@([^\s@\[\]]*)$/);
          setMention(canMention() && props.backend && match ? { start: next.toRaw(end - match[1]!.length - 1), end: next.toRaw(end, 'end'), query: match[1]! } : null);
          props.onChange(raw);
        }}
        onClick={() => setMention(null)}
        onKeyDown={onKeyDown}
        class="mb-2 min-h-24 w-full resize-y rounded-md border border-edge bg-surface p-3 font-sans text-sm leading-relaxed placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/10" />
    }>
      <CommentMarkdown text={props.value} label={props.previewLabel ?? 'Comment preview'} class="mb-2 min-h-[3rem] w-full rounded-[4px] border border-edge bg-surface p-2 text-sm" />
    </Show>
    <Show when={!previewing() && mention() && props.backend}>
      <CommentMentionPicker backend={props.backend!} artifactId={props.artifactId} query={mention()!.query} onSelect={chooseMention} onReady={(handle) => { keyboard = handle; }} />
    </Show>
    <Show when={!previewing() && !mention() && canMention()}>
      <p class="mb-2 text-[10px] text-muted">Type @ to mention an agent</p>
    </Show>
  </div>;
}

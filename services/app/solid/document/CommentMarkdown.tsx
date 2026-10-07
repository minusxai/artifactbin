/* @jsxImportSource solid-js */
import { children as resolveChildren, createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import Bold from 'lucide-solid/icons/bold';
import Code from 'lucide-solid/icons/code';
import Italic from 'lucide-solid/icons/italic';
import Link2 from 'lucide-solid/icons/link-2';
import List from 'lucide-solid/icons/list';
import { parseMarkdownLite, type MdInline, type MdMarker, type MdNode } from '@/lib/annotations/markdown-lite';
import { mountCommentEditor, type MentionQuery } from './comment-editor';
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
    case 'heading': return <div role="heading" aria-level={node.level} class="comment-heading" data-level={node.level}>{inline(node.children)}</div>;
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

/** Read-only rendering of the same Markdown format used by the editor. */
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
  /** The editable root's accessible name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** ⌘↵. The caller decides whether the draft is sendable at all. */
  onSubmit?: () => void;
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
  const context = resolveChildren(() => props.children);
  let mount!: HTMLDivElement;
  let editor: ReturnType<typeof mountCommentEditor> | undefined;
  let keyboard: MentionKeyboard | null = null;
  const [mention,setMention] = createSignal<MentionQuery|null>(null);
  const [linkOpen,setLinkOpen] = createSignal(false), [href,setHref] = createSignal('https://');
  const canMention = () => !props.backend || !(props.backend.unavailable('remoteSessions') && props.backend.unavailable('mentions'));
  const apply = (marker:MdMarker) => { if(marker==='link'){setLinkOpen(value=>!value);return;} editor?.format(marker); };
  onMount(() => {
    editor=mountCommentEditor(mount,{value:()=>props.value,label:props.label,placeholder:props.placeholder,onChange:props.onChange,
      onMention:query=>setMention(canMention()&&props.backend?query:null),
      onKey:event=>{
        if(event.isComposing)return false;
        if(mention()&&!event.metaKey&&!event.ctrlKey){
          if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMention(null);return true;}
          if(keyboard?.keyDown(event.key)){event.preventDefault();event.stopPropagation();return true;}
        }
        if(!event.metaKey&&!event.ctrlKey)return false;
        if(event.key==='Enter'){event.preventDefault();props.onSubmit?.();return true;}
        const marker=KEYS[event.key.toLowerCase()];if(!marker)return false;
        event.preventDefault();apply(marker);return true;
      }});
    if(props.autoFocus)editor.view.focus();
  });
  createEffect(()=>{const value=props.value;editor?.sync(value);});
  onCleanup(()=>editor?.destroy());
  return <div class={`min-w-0 ${props.class??''}`}>
    <div class="comment-editor-tools" classList={{'has-context': !!context()}}>
    <Show when={context()}><div class="comment-editor-context">{context()}</div></Show>
    <div role="toolbar" aria-label={`${props.label} formatting`} class="comment-editor-toolbar">
      <For each={TOOLBAR}>{tool=><Tooltip content={tool.hint}><button type="button" aria-label={tool.label} onMouseDown={event=>event.preventDefault()} onClick={()=>apply(tool.marker)} class={toolButton}><tool.Icon size={13} strokeWidth={1.8}/></button></Tooltip>}</For>
    </div>
    </div>
    <Show when={linkOpen()}><div class="mb-2 flex gap-2"><input aria-label="Link URL" value={href()} onInput={event=>setHref(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(editor?.link(href()))setLinkOpen(false);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setLinkOpen(false);editor?.view.focus();}}} class="min-w-0 flex-1 rounded border border-edge bg-surface p-1 text-xs"/><button type="button" class="text-xs text-accent" onClick={()=>{if(editor?.link(href()))setLinkOpen(false);}}>Apply link</button></div></Show>
    <div ref={mount} style={{'--comment-min-height':`${Math.max(props.rows??3,2)*1.5+1.5}rem`}} />
    <Show when={mention()&&props.backend}><CommentMentionPicker backend={props.backend!} artifactId={props.artifactId} query={mention()!.query} onSelect={text=>{const range=mention();setMention(null);if(range)editor?.mention(range,text);}} onReady={handle=>{keyboard=handle;}}/></Show>
    <Show when={!mention()&&canMention()}><p class="mb-2 text-[10px] text-muted">Type @ to mention an agent</p></Show>
  </div>;
}

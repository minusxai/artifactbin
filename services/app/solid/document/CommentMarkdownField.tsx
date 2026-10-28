/* @jsxImportSource solid-js */
/**
 * The comment composer: a ProseMirror editor with a formatting toolbar and mentions.
 * Loaded on demand (see LazyCommentField) so readers who never compose a comment
 * never download ProseMirror; CommentMarkdown.tsx keeps the read-only rendering.
 */
import { children as resolveChildren, createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import Bold from 'lucide-solid/icons/bold';
import Code from 'lucide-solid/icons/code';
import Italic from 'lucide-solid/icons/italic';
import Link2 from 'lucide-solid/icons/link-2';
import List from 'lucide-solid/icons/list';
import type { MdMarker } from '@/lib/annotations/markdown-lite';
import { mountCommentEditor, type MentionQuery } from './comment-editor';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { Tooltip } from '../ui/Tooltip';
import { CommentMentionPicker, type MentionKeyboard } from './CommentMentionPicker';
import { AttachImageButton, CommentImageDraftView, createImageDropTarget, ImageDropTarget, type CommentImageDraft } from './CommentImageAttach';

/** ⌘B / ⌘I / ⌘E — the three every editor binds, and nothing beyond them. */
const KEYS: Record<string, MdMarker> = { b: 'bold', i: 'italic', e: 'code' };
const TOOLBAR = [
  { marker: 'bold', label: 'Bold', hint: 'bold (⌘B)', Icon: Bold },
  { marker: 'italic', label: 'Italic', hint: 'italic (⌘I)', Icon: Italic },
  { marker: 'code', label: 'Code', hint: 'code (⌘E)', Icon: Code },
  { marker: 'link', label: 'Link', hint: 'link', Icon: Link2 },
  { marker: 'list', label: 'List', hint: 'list', Icon: List },
] satisfies Array<{ marker: MdMarker; label: string; hint: string; Icon: typeof Bold }>;

export interface CommentMarkdownFieldProps {
  /** The editable root's accessible name. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** ⌘↵. The caller decides whether the draft is sendable at all. */
  onSubmit?: () => void;
  rows?: number;
  autoFocus?: boolean;
  class?: string;
  /** Mentions look people up here; without it `@` is just a character. */
  backend?: ArtifactBackend;
  artifactId?: string;
  /** Overrides the empty field's hint. */
  placeholder?: string;
  /** Anything ABOVE the toolbar — the composer's breadcrumb, which says what is being commented on. */
  children?: JSX.Element;
  /** This box takes one image (paste, drop, Attach image), drawn above it; absent: words only. */
  image?: CommentImageDraft | null;
  /** The comment is being sent: the image's brush holds still. */
  busy?: boolean;
}

export function CommentMarkdownField(props: CommentMarkdownFieldProps): JSX.Element {
  const context = resolveChildren(() => props.children);
  let mount!: HTMLDivElement;
  let editor: ReturnType<typeof mountCommentEditor> | undefined;
  let keyboard: MentionKeyboard | null = null;
  const insertMention = (text: string) => {
    if (!editor) return;
    const range = mention() ?? {...editor.view.state.selection, from: editor.view.state.selection.from, to: editor.view.state.selection.to, query: ''};
    setMention(null);
    editor.mention(range, text);
  };
  const [mention,setMention] = createSignal<MentionQuery|null>(null);
  const [linkOpen,setLinkOpen] = createSignal(false), [href,setHref] = createSignal('https://');
  const canMention = () => !!props.backend && !!props.artifactId && !props.backend.unavailable('mentions');
  const apply = (marker:MdMarker) => { if(marker==='link'){setLinkOpen(value=>!value);return;} editor?.format(marker); };
  onMount(() => {
    const placeholder = props.placeholder ?? (canMention() ? 'Protip: Use @ to mention people' : 'Write a comment ...');
    editor=mountCommentEditor(mount,{value:()=>props.value,label:props.label,placeholder,onChange:props.onChange,
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
  const drop = createImageDropTarget(() => props.image);
  return <div ref={drop.ref} class={`relative min-w-0 ${props.class??''}`}>
    <ImageDropTarget over={drop.over()} />
    <Show when={props.image}>{image => <CommentImageDraftView image={image()} busy={props.busy} />}</Show>
    {/* The context (the composer's breadcrumb) shares the row with the toolbar: it takes what the six 32px tools leave. */}
    <div class="comment-editor-tools gap-2">
    <Show when={context()}><div class="comment-editor-context min-w-0 flex-1">{context()}</div></Show>
    <div role="toolbar" aria-label={`${props.label} formatting`} class="comment-editor-toolbar shrink-0">
      <For each={TOOLBAR}>{tool=><Tooltip content={tool.hint}><Button type="button" variant="ghost" size="sm" icon aria-label={tool.label} onMouseDown={event=>event.preventDefault()} onClick={()=>apply(tool.marker)}><tool.Icon size={13} strokeWidth={1.8}/></Button></Tooltip>}</For>
      <Show when={props.image}>{image => <AttachImageButton image={image()} />}</Show>
    </div>
    </div>
    <Show when={linkOpen()}><div class="mb-2 flex gap-2"><Input size="sm" aria-label="Link URL" value={href()} onInput={event=>setHref(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(editor?.link(href()))setLinkOpen(false);}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setLinkOpen(false);editor?.view.focus();}}} class="flex-1"/><Button type="button" variant="secondary" size="sm" onClick={()=>{if(editor?.link(href()))setLinkOpen(false);}}>Apply link</Button></div></Show>
    <div ref={mount} style={{'--comment-min-height':`${Math.max(props.rows??3,2)*1.5+1.5}rem`}} />
    <Show when={mention()&&props.backend}><CommentMentionPicker backend={props.backend!} artifactId={props.artifactId} query={mention()!.query} onSelect={insertMention} onReady={handle=>{keyboard=handle;}}/></Show>
  </div>;
}

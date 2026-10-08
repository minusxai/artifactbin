/* @jsxImportSource solid-js */
/**
 * The comment composer: a ProseMirror editor with a formatting toolbar and mentions.
 * Loaded on demand (see LazyCommentField) so readers who never compose a comment
 * never download ProseMirror; CommentMarkdown.tsx keeps the read-only rendering.
 */
import { children as resolveChildren, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import Bold from 'lucide-solid/icons/bold';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import Code from 'lucide-solid/icons/code';
import Italic from 'lucide-solid/icons/italic';
import Link2 from 'lucide-solid/icons/link-2';
import List from 'lucide-solid/icons/list';
import type { MdMarker } from '@/lib/annotations/markdown-lite';
import { commentDocument, mountCommentEditor, type MentionQuery } from './comment-editor';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { Tooltip } from '../components/Tooltip';
import { remoteMention } from '@/lib/annotations/remote-reply';
import { agentNameColor } from '../lib/agent-identity';
import type { RemoteSessionInfo } from '../../../contracts/src/remote';
import { canTagAgent, CommentMentionPicker, type MentionKeyboard } from './CommentMentionPicker';

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
  autoFocus?: boolean;
  class?: string;
  /** Mentions look people and agents up here; without it `@` is just a character. */
  backend?: ArtifactBackend;
  artifactId?: string;
  quickAgents?: boolean;
  /** Anything ABOVE the toolbar — the composer's breadcrumb, which says what is being commented on. */
  children?: JSX.Element;
}

export function CommentMarkdownField(props: CommentMarkdownFieldProps): JSX.Element {
  const context = resolveChildren(() => props.children);
  let mount!: HTMLDivElement;
  let editor: ReturnType<typeof mountCommentEditor> | undefined;
  let keyboard: MentionKeyboard | null = null;
  const [agents,setAgents] = createSignal<RemoteSessionInfo[]>([]);
  const untaggedAgents = createMemo(() => {
    const tagged = new Set<string>();
    commentDocument(props.value).descendants(node => {
      if (node.type.name === 'mention') tagged.add(String(node.attrs.href));
    });
    return agents().filter(agent => !tagged.has(`/chat?session=${agent.id}`));
  });
  const insertMention = (text: string) => {
    if (!editor) return;
    const range = mention() ?? {...editor.view.state.selection, from: editor.view.state.selection.from, to: editor.view.state.selection.to, query: ''};
    setMention(null);
    editor.mention(range, text);
  };
  const showAgents = () => {
    if (!editor) return;
    const {from,to} = editor.view.state.selection;
    editor.view.focus();
    setMention({from,to,query:''});
  };
  const [mention,setMention] = createSignal<MentionQuery|null>(null);
  const [linkOpen,setLinkOpen] = createSignal(false), [href,setHref] = createSignal('https://');
  const canMention = () => !props.backend || !(props.backend.unavailable('remoteSessions') && props.backend.unavailable('mentions'));
  const apply = (marker:MdMarker) => { if(marker==='link'){setLinkOpen(value=>!value);return;} editor?.format(marker); };
  onMount(() => {
    const placeholder = canMention() ? 'Protip: Use @ to tag friends or agents' : 'Write a comment ...';
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
    if (props.quickAgents && props.backend && !props.backend.unavailable('remoteSessions')) {
      const abort = new AbortController();
      void props.backend.remoteSessions({signal:abort.signal}).then(answer=>{
        if(abort.signal.aborted)return;
        const eligible=(answer.sessions??[]).filter(canTagAgent);
        setAgents(eligible);
      }).catch(()=>{});
      onCleanup(()=>abort.abort());
    }
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
    <Show when={mention()&&props.backend}><CommentMentionPicker backend={props.backend!} artifactId={props.artifactId} query={mention()!.query} onSelect={insertMention} onReady={handle=>{keyboard=handle;}}/></Show>
    <Show when={props.quickAgents && canMention()}>
      <div class="comment-agents" role="group" aria-label="Tag agent">
        <div class="comment-agent-choices">
        <Show when={untaggedAgents().length}><span>Tag agent</span></Show>
        <For each={untaggedAgents().slice(0,2)}>{agent=><button type="button" aria-label={`Tag ${agent.name}`} class="comment-agent-choice" style={{'--mention-color':agentNameColor(agent.name)}} onMouseDown={event=>event.preventDefault()} onClick={()=>insertMention(remoteMention(agent))}><span aria-hidden="true">●</span> {agent.name}</button>}</For>
        <Show when={untaggedAgents().length>2}><button type="button" class="comment-agent-more" aria-expanded={!!mention()} onMouseDown={event=>event.preventDefault()} onClick={showAgents}>+{untaggedAgents().length-2} {untaggedAgents().length===3?'other':'others'}</button></Show>
        <Show when={!agents().length}><span>No agents available</span></Show>
        <Show when={agents().length && !untaggedAgents().length}><span>All agents tagged</span></Show>
        </div>
        <a class="comment-agents-manage" aria-label={agents().length ? 'Manage agents' : 'Add agent'} href="/chat" target="_blank" rel="noopener noreferrer">{agents().length ? 'Manage' : 'Add agent'}<ArrowUpRight size={12} aria-hidden="true" /></a>
      </div>
    </Show>
  </div>;
}

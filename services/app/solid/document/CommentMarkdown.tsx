/* @jsxImportSource solid-js */
import { For, type JSX } from 'solid-js';
import { parseMarkdownLite, plainText, type MdInline, type MdNode } from '@/lib/annotations/markdown-lite';
import { isPersonMentionHref } from '@/lib/document/person-mentions';
import { isSessionMentionHref } from '@/lib/remote/session-mentions';
import { Tooltip } from '../components/Tooltip';
import { agentNameColor } from '../lib/agent-identity';
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
            style={{ '--mention-color': agentNameColor(plainText([{kind:'paragraph',children:node.children}]).replace(/^@/, '')) }} data-agent-mention=""
            class="comment-agent-mention max-w-full no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
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

/** Shared footer hint keeps new comments and replies visually consistent. */
export function CommentSubmitHint(props: { action: 'comment' | 'reply' }): JSX.Element {
  return <span class="mr-auto hidden items-center gap-1.5 font-sans text-[11px] text-muted sm:inline-flex" aria-label={`Keyboard shortcut to send ${props.action}`}><kbd class="rounded border border-edge bg-surface px-1.5 py-0.5 font-sans text-[10px]">{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd><span aria-hidden="true">+</span><kbd class="rounded border border-edge bg-surface px-1.5 py-0.5 font-sans text-[10px]">Enter</kbd><span class="ml-1">to {props.action}</span></span>;
}

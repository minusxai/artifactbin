/* @jsxImportSource solid-js */
/**
 * A comment body, read-only: lib/markdown's one HTML writer (./comment-display, a lazy chunk), dressed in the
 * thread's compact look and with its mention links hydrated into the mention components. The markup is the module's
 * (escaped text, fixed elements, refused links and raw HTML as typed); this file only adds today's classes, opens
 * plain links in a new tab, wraps code blocks in the comment code frame and swaps classified links for
 * PersonMention and the agent-session badge, inside this component's owner so their context and tooltips work.
 */
import { createRenderEffect, useContext, type JSX } from 'solid-js';
import { insert } from 'solid-js/web';
import { Tooltip } from '../ui/Tooltip';
import { agentNameColor } from '../lib/agent-identity';
import { PersonMention } from './PersonMention';
import { CommentDocument, commentHtml } from './comment-display';

// Inline code takes the paragraph's size (the mono face already reads smaller beside the sans body).
const CODE_CLASS = 'break-all rounded-chip bg-raised px-1 py-0.5 font-mono text-fg';
const LINK_CLASS = 'break-words text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid';
const SESSION_CLASS = 'comment-agent-mention max-w-full no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
/** Today's look, element by element. */
const LOOK: ReadonlyArray<readonly [string, string]> = [
  ['p', 'leading-normal'],
  ['strong', 'font-semibold text-fg'],
  ['em', 'italic'],
  [':not(pre) > code', CODE_CLASS],
  ['ul:not(.mx-md-check-list)', 'min-w-0 pl-5 list-disc marker:text-faint'],
  ['ol', 'min-w-0 pl-5 list-decimal marker:text-faint'],
  ['li', 'min-w-0 leading-normal'],
  ['blockquote', 'min-w-0 border-l-2 border-edge pl-2.5 text-muted'],
  ['h1, h2, h3, h4, h5, h6', 'comment-heading'],
];

function dress(root: HTMLElement): void {
  for (const [selector, classes] of LOOK) for (const element of root.querySelectorAll(selector)) element.className = classes;
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) heading.setAttribute('data-level', heading.tagName.slice(1));
  for (const pre of root.querySelectorAll('pre')) {
    const frame = document.createElement('div');
    frame.className = 'comment-code-highlight min-w-0';
    pre.replaceWith(frame);
    frame.append(pre);
  }
}

/** Each link: a mention component for a classified one, else a plain link opening in a new tab. */
function hydrateLinks(root: HTMLElement): void {
  for (const link of Array.from(root.querySelectorAll('a'))) {
    const href = link.getAttribute('href');
    const kind = link.getAttribute('data-mx-link');
    if (!href || !kind) {
      if (href) Object.assign(link, { target: '_blank', rel: 'noopener noreferrer', className: LINK_CLASS });
      continue;
    }
    const label = Array.from(link.childNodes);
    const color = agentNameColor((link.textContent ?? '').replace(/^@/, ''));
    insert(link.parentNode!, kind === 'person'
      ? <PersonMention href={href} class="text-accent">{label}</PersonMention>
      : <Tooltip content="Open agent session"><a href={href} target="_blank" rel="noopener noreferrer" style={{ '--mention-color': color }} data-agent-mention="" class={SESSION_CLASS}>{label}</a></Tooltip>,
    link);
    link.remove();
  }
}

/** Read-only rendering of the same Markdown format the comment box edits. */
export function CommentMarkdown(props: { text: string; label?: string; class?: string }): JSX.Element {
  const artifactId = useContext(CommentDocument);
  const root = <div data-markdown aria-label={props.label} class={`flex min-w-0 flex-col gap-2 font-sans leading-normal text-fg/90 ${props.class ?? ''}`} /> as HTMLDivElement;
  createRenderEffect(() => {
    const html = commentHtml(props.text, artifactId);
    root.innerHTML = html ?? '';
    if (html === null) return;
    dress(root);
    hydrateLinks(root);
  });
  return root;
}

/** Shared footer hint keeps new comments and replies visually consistent. */
export function CommentSubmitHint(props: { action: 'comment' | 'reply' | 'save' }): JSX.Element {
  return <span class="mr-auto hidden items-center gap-1.5 font-sans text-2xs text-muted sm:inline-flex" aria-label={props.action === 'save' ? 'Keyboard shortcut to save' : `Keyboard shortcut to send ${props.action}`}><kbd class="rounded-chip border border-edge bg-surface px-1.5 py-0.5 font-sans text-micro">{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd><span aria-hidden="true">+</span><kbd class="rounded-chip border border-edge bg-surface px-1.5 py-0.5 font-sans text-micro">Enter</kbd><span class="ml-1">to {props.action}</span></span>;
}

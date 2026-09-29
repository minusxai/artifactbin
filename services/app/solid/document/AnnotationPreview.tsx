/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import type { AnnotationCommentWire, AnnotationWire } from '@/lib/annotations';
import type { StoryEditRect } from '@/lib/story-runtime/contract';
import { parseMarkdownLite, plainText } from '@/lib/markdown-lite';
import { remoteWorkLabel } from '@/lib/remote-reply';
import { Avatar } from '../components/Avatar';
import { ChatGPTIcon, ClaudeAIIcon, ClaudeCodeIcon, CodexIcon } from '../components/brand-icons';
import { Tooltip } from '../components/Tooltip';

type Author = AnnotationCommentWire['author'];
const labelOf = (author: Author) => author.label?.trim() || (author.kind === 'human' ? 'You' : 'Agent');
const previewText = (text: string) => plainText(parseMarkdownLite(text));
const participantKey = (author: Author) => `${author.kind}:${labelOf(author).toLowerCase()}`;
export function replyParticipants(thread: AnnotationCommentWire[]): Author[] {
  const seen = new Set<string>();
  return thread.slice(1).flatMap(({ author }) => {
    const key = participantKey(author);
    if (seen.has(key)) return [];
    seen.add(key);
    return [author];
  });
}

export function AuthorMark(props: { author: Author; compact?: boolean; decorative?: boolean }): JSX.Element {
  const label = () => labelOf(props.author);
  const icon = () => {
    switch (label().toLowerCase()) {
      case 'codex': return <CodexIcon size={props.compact ? 13 : 17} />;
      case 'chatgpt': return <ChatGPTIcon size={props.compact ? 12 : 16} />;
      case 'claude code': return <ClaudeCodeIcon size={props.compact ? 12 : 16} />;
      case 'claude': return <ClaudeAIIcon size={props.compact ? 12 : 16} />;
      default: return <span aria-hidden="true">✦</span>;
    }
  };
  return <Show when={props.author.kind === 'agent'} fallback={<Avatar image={props.author.image} initial={label()} userId={props.author.user_id ?? `label:${label()}`} size={props.compact ? 18 : 22} />}>
    <span aria-label={props.decorative ? undefined : `${label()} agent`} aria-hidden={props.decorative || undefined} class="inline-flex size-[22px] items-center justify-center rounded-full border border-edge bg-surface">{icon()}</span>
  </Show>;
}

export function AuthorIdentity(props: { author: Author }): JSX.Element {
  const label = () => labelOf(props.author);
  return <span class="flex min-w-0 items-center gap-2">
    <span aria-label={`${label()} avatar`} class="inline-flex size-[22px] shrink-0"><AuthorMark author={props.author} /></span>
    <Show when={props.author.sessionId} fallback={props.author.kind === 'human' && props.author.label
      ? <a href={`/@${encodeURIComponent(props.author.label)}`} aria-label={`View @${props.author.label} profile`} class="text-xs font-semibold">{label()}</a>
      : <span class="text-xs font-semibold">{label()}</span>}>
      {sessionId => <a href={`/chat?session=${sessionId()}`} target="_blank" rel="noopener noreferrer" class="text-xs font-semibold">@{label()}</a>}
    </Show>
    <Show when={props.author.kind === 'agent' && props.author.transport && props.author.transport !== 'unknown'}><span aria-label={`Transport ${props.author.transport?.toUpperCase()}`} class="font-mono text-[9px] uppercase text-faint">· {props.author.transport}</span></Show>
  </span>;
}

export function CommentTime(props: { iso: string }): JSX.Element {
  const date = () => new Date(props.iso);
  const valid = () => !Number.isNaN(date().getTime());
  const day = () => date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(date().getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
  const time = () => date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const exact = () => date().toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'long' });
  return <Show when={valid()}><Tooltip content={exact()}><time dateTime={props.iso} aria-label={exact()} tabIndex={0} class="font-mono text-[10px] text-faint">{day()} · {time()}</time></Tooltip></Show>;
}

export function positionedComments(annotations: AnnotationWire[], rects: Record<string, StoryEditRect>,
  frame: Pick<DOMRect, 'top' | 'height'>, viewportHeight: number): Array<{ annotation: AnnotationWire; top: number }> {
  const visible = annotations.flatMap(annotation => {
    const rect = rects[annotation.id];
    if (!rect || rect.y + rect.height < 0 || rect.y > frame.height) return [];
    return [{ annotation, target: frame.top + rect.y }];
  }).sort((a, b) => a.target - b.target);
  if (!visible.length) return [];
  const minimum = frame.top + 12;
  let cursor = minimum;
  const placed = visible.map(({ annotation, target }) => {
    const top = Math.max(target, cursor);
    cursor = top + 42;
    return { annotation, top };
  });
  const overflow = placed.at(-1)!.top + 120 - viewportHeight;
  const shift = Math.max(0, Math.min(overflow, placed[0]!.top - minimum));
  return shift ? placed.map(item => ({ ...item, top: item.top - shift })) : placed;
}

/** A quiet author mark expands to a preview at its anchored document y. */
export function AnnotationPreview(props: { row: AnnotationWire; top: number; remaining?: number; hovered: boolean; onHover: (id: string | null) => void; onOpen: () => void }): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const first = () => props.row.thread[0];
  const name = () => first() ? labelOf(first()!.author) : 'Unknown';
  const count = () => props.row.thread.length;
  const preview = () => first() ? previewText(first()!.body) : '';
  const [hoverReplies, setHoverReplies] = createSignal(false);
  createEffect(() => {
    if (!props.hovered || !hoverReplies()) { setExpanded(false); return; }
    const timer = window.setTimeout(() => setExpanded(true), 600);
    onCleanup(() => clearTimeout(timer));
  });
  const agents = () => (props.row.remote_work ?? []).filter((work, index, rows) => !rows.slice(index + 1).some(next => next.sessionId === work.sessionId));
  const work = () => agents().filter(item => item.connection === 'online' && ['queued', 'dispatching', 'delivered', 'acknowledged'].includes(item.phase) && item.activity !== 'unknown').at(-1) ?? agents().at(-1);
  const participants = () => replyParticipants(props.row.thread);
  return <article data-annotation-id={props.row.id} data-hovered={props.hovered ? 'true' : undefined}
    onMouseEnter={() => props.onHover(props.row.id)} onMouseLeave={() => { props.onHover(null); setHoverReplies(false); }}
    onFocus={() => props.onHover(props.row.id)}
    class={`pointer-events-auto fixed right-3 overflow-hidden border bg-raised shadow-md ${props.hovered ? 'z-10 border-edge-bright bg-comment-hover px-3 py-2.5' : 'border-transparent'}`}
    style={{ top: `${props.top}px`, width: props.hovered ? '288px' : `${count() > 9 ? 48 : count() > 1 ? 44 : 36}px`, height: props.hovered ? expanded() ? 'auto' : '108px' : '36px', 'border-radius': props.hovered ? '5px' : '50% 50% 50% 3px', 'max-width': 'calc(100vw - 24px)' }}>
    <button type="button" aria-label={`Open annotation conversation by ${name()}, ${count()} message${count() === 1 ? '' : 's'}`} onClick={props.onOpen} class="absolute inset-0 z-0 w-full" />
    <Show when={props.remaining !== undefined}><span role="status" class="sr-only motion-reduce:not-sr-only">Resolved · {Math.ceil((props.remaining ?? 0) / 1000)} seconds</span></Show>
    <Show when={props.row.status === 'resolved'}><span aria-label="Resolved" class="pointer-events-none absolute bottom-0 right-0 text-accent">✓</span></Show>
    <Show when={work()}>{current => <span class="sr-only">{remoteWorkLabel(current())}</span>}</Show>
    <Show when={props.hovered && agents().length > 1}><span class="absolute right-2 top-1 text-[10px] text-muted">{agents().length} agents</span></Show>
    <Show when={first()}>{comment => <Show when={props.hovered} fallback={<span class="pointer-events-none absolute inset-0 flex items-center justify-start pl-[7px]"><span class="relative"><AuthorMark author={comment().author} compact decorative /><Show when={props.remaining !== undefined}><svg aria-hidden="true" class="pointer-events-none absolute -left-1 -top-1 h-[30px] w-[30px] motion-reduce:hidden" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="2" pathLength="100" stroke-dasharray={`${(props.remaining ?? 0) / 100} 100`} transform="rotate(-90 20 20)" /></svg></Show></span><Show when={count() > 1}><span data-thread-count aria-hidden="true" class="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[9px] font-bold text-fg">{count() > 9 ? '9+' : count()}</span></Show></span>}>
      <div class="pointer-events-none relative z-10 flex h-full flex-col">
        <div class="flex items-center justify-between gap-2"><AuthorIdentity author={comment().author} /><CommentTime iso={comment().created_at} /></div>
        <p class="mt-1.5 line-clamp-2 font-sans text-sm">{preview()}</p>
        <div class="mt-auto flex items-center justify-between text-xs">
          <Show when={count() > 1} fallback={<span>1 message</span>}><button type="button" aria-label="Expand replies" aria-expanded={expanded()} onMouseEnter={() => setHoverReplies(true)} onMouseLeave={() => setHoverReplies(false)} onClick={() => setExpanded(true)} class="pointer-events-auto"><Show when={participants().length}><span aria-label={`Reply participants: ${participants().map(labelOf).join(', ')}`} class="inline-flex -space-x-1"><For each={participants().slice(0, 3)}>{author => <AuthorMark author={author} compact decorative />}</For></span></Show>+{count() - 1} more</button></Show>
          <span>open →</span>
        </div>
        <Show when={expanded()}><div role="list" aria-label="Thread replies" class="pointer-events-auto mt-2 border-t border-edge pt-2"><For each={props.row.thread.slice(1)}>{reply => <div role="listitem"><AuthorIdentity author={reply.author} /><p>{previewText(reply.body)}</p></div>}</For></div></Show>
      </div>
    </Show>}</Show>
  </article>;
}

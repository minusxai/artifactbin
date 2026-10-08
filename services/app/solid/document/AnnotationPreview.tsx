/* @jsxImportSource solid-js */
/**
 * The comment layer's IDENTITIES and its AMBIENT surface, from components/AnnotationLayer in SOLID.
 *
 * Google-Docs-shaped attribution: a person is their face (picture, else their initial on the colour
 * their ACCOUNT id picks), an agent is its product mark. The floating marks are one identity per
 * open thread at its anchor's y over the document's right edge; one widens into a preview on hover
 * or focus and opens the rail on click, so annotations stay ambient without becoming a second
 * reading column.
 */
import { createContext, createEffect, createSignal, For, onCleanup, Show, useContext, type JSX } from 'solid-js';
import type { AnnotationCommentWire, AnnotationWire } from '@/lib/annotations/store';
import type { StoryEditRect } from '@/lib/story-runtime/contract';
import { parseMarkdownLite, plainText } from '@/lib/annotations/markdown-lite';
import { remoteWorkLabel } from '@/lib/annotations/remote-reply';
import { agentNameColor } from '../lib/agent-identity';
import Ghost from 'lucide-solid/icons/ghost';
import { Avatar } from '../components/Avatar';
import { ChatGPTIcon, ClaudeAIIcon, ClaudeCodeIcon, CodexIcon, PiIcon, OpenCodeIcon } from '../components/brand-icons';
import { Tooltip } from '../components/Tooltip';
import { useOptionalInbox } from '../lib/notifications';

type Author = AnnotationCommentWire['author'];

export const VIEW_COMMENT_COLLAPSED_W = 36;
export const VIEW_COMMENT_COUNTED_W = 44;
export const VIEW_COMMENT_MANY_W = 48;
export const VIEW_COMMENT_COLLAPSED_H = 36;
export const VIEW_COMMENT_EXPANDED_H = 108;
export const VIEW_COMMENT_GAP = 6;
export const VIEW_COMMENT_INSET = 12;

/** Offline, a name is a label someone typed, not a profile to visit. */
export const CommentsOffline = createContext(false);

/** What a clamped surface shows: the plain text, never two lines spent on a fence or a bullet. */
export const previewText = (body: string) => plainText(parseMarkdownLite(body));
/** What a folded comment or thread keeps: the sentence it opens with. */
export const firstLine = (body: string) => previewText(body).split('\n', 1)[0] ?? '';

export const authorLabel = (author: Author) => author.label?.trim() || (author.kind === 'human' ? 'You' : 'Agent');
/** Prefer connected-session identity; legacy named authors still get their known logo. */
const agentProgram = (author: Author): string => {
  const names: Record<string,string> = {claude:'Claude Code','claude-code':'Claude Code','claude code':'Claude Code','claude-web':'Claude',codex:'Codex',pi:'Pi',opencode:'OpenCode',chatgpt:'ChatGPT'};
  return names[(author.harness ?? author.label ?? '').toLowerCase()] ?? 'Agent';
};
const authorKey = (author: Author) => `${author.kind}:${authorLabel(author).toLowerCase()}`;

/** Distinct people/agents who replied, oldest first. The root author is already named above. */
export function replyParticipants(thread: AnnotationCommentWire[]): Author[] {
  const seen = new Set<string>();
  return thread.slice(1).flatMap(({ author }) => {
    const key = authorKey(author);
    if (seen.has(key)) return [];
    seen.add(key);
    return [author];
  });
}

/** A person's face: only a person with no account falls back to their label as the colour key. */
function PersonFace(props: { author: Author; size: number }): JSX.Element {
  const label = () => authorLabel(props.author);
  return <Avatar image={props.author.image ?? null} initial={label()} userId={props.author.user_id ?? `label:${label()}`} size={props.size} />;
}

function AgentMark(props: { label: string; compact?: boolean; decorative?: boolean; borderless?: boolean }): JSX.Element {
  const icon = () => {
    switch (props.label.toLowerCase()) {
      case 'pi': return <PiIcon size={props.compact ? 13 : 17} />;
      case 'opencode': return <OpenCodeIcon size={props.compact ? 13 : 17} />;
      case 'codex': return <CodexIcon size={props.compact ? 13 : 17} />;
      case 'chatgpt': return <ChatGPTIcon size={props.compact ? 12 : 16} />;
      case 'claude code': return <ClaudeCodeIcon size={props.compact ? 12 : 16} />;
      case 'claude': return <ClaudeAIIcon size={props.compact ? 12 : 16} />;
      default: return <Ghost size={props.compact ? 13 : 17} strokeWidth={1.8} aria-hidden="true" style={{color:agentNameColor(props.label)}} />;
    }
  };
  return <span aria-label={props.decorative ? undefined : `${props.label} agent`} aria-hidden={props.decorative || undefined}
    class={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface text-fg ${props.borderless ? '' : 'border border-edge'} ${props.compact ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]'}`}>
    {icon()}
  </span>;
}

/** Google-Docs-shaped attribution: a profile avatar for people, a product mark for agents. */
export function AuthorIdentity(props: { author: Author }): JSX.Element {
  const label = () => authorLabel(props.author);
  const offline = useContext(CommentsOffline);
  return <span class="flex min-w-0 items-center gap-2">
    <Show when={props.author.kind === 'human'} fallback={<AgentMark label={agentProgram(props.author)} />}>
      <span aria-label={`${label()} avatar`} class="inline-flex h-[22px] w-[22px] shrink-0 rounded-full"><PersonFace author={props.author} size={22} /></span>
    </Show>
    <Show when={props.author.sessionId} fallback={
      <Show when={props.author.kind === 'human' && props.author.label && !offline} fallback={
        <span style={props.author.kind === 'agent' ? {color:agentNameColor(label())} : undefined} class={`truncate text-[11px] font-semibold ${props.author.kind === 'agent' ? 'text-accent' : 'text-fg'}`}>{label()}</span>
      }>
        <a href={`/@${encodeURIComponent(props.author.label!)}`} aria-label={`View @${props.author.label} profile`}
          class="pointer-events-auto truncate text-[11px] font-semibold text-fg underline-offset-2 hover:text-accent hover:underline">{label()}</a>
      </Show>
    }>{(sessionId) => (
      <a href={`/chat?session=${sessionId()}`} target="_blank" rel="noopener noreferrer" class="truncate text-[11px] font-semibold"
        style={{ color: agentNameColor(label()) }}>@{label()}</a>
    )}</Show>
    <Show when={props.author.kind === 'agent'}>
      <span aria-label={`Agent type ${agentProgram(props.author)}`} class="shrink-0 font-sans text-[10px] text-faint">· {agentProgram(props.author)}</span>
    </Show>
  </span>;
}

function ParticipantMark(props: { author: Author }): JSX.Element {
  // Bare, not wrapped: the stack's ring lands on its direct children.
  return <Show when={props.author.kind === 'agent'} fallback={<PersonFace author={props.author} size={18} />}>
    <AgentMark label={agentProgram(props.author)} compact decorative />
  </Show>;
}

/** A thread's continuation cue: reply identities plus a count relative to the root comment. */
export function ThreadContinuation(props: { thread: AnnotationCommentWire[] }): JSX.Element {
  const replyCount = () => Math.max(0, props.thread.length - 1);
  const participants = () => replyParticipants(props.thread);
  return <span class="flex min-w-0 items-center gap-1.5">
    <Show when={participants().length > 0}>
      <span aria-label={`Reply participants: ${participants().map(authorLabel).join(', ')}`} class="flex shrink-0 -space-x-1 [&>*]:ring-1 [&>*]:ring-raised">
        <For each={participants().slice(0, 3)}>{(author) => <ParticipantMark author={author} />}</For>
      </span>
    </Show>
    <span class="truncate">{replyCount() > 0 ? `+${replyCount()} more` : '1 message'}</span>
  </span>;
}

function CompactAuthorMark(props: { author: Author }): JSX.Element {
  return <Show when={props.author.kind === 'agent'} fallback={<PersonFace author={props.author} size={22} />}>
    <AgentMark label={agentProgram(props.author)} compact decorative borderless />
  </Show>;
}

/** Local time with an exact, keyboard-reachable timestamp in a tooltip — never a native title. */
export function CommentTimestamp(props: { iso: string; class?: string }): JSX.Element {
  const date = () => new Date(props.iso);
  const valid = () => !Number.isNaN(date().getTime());
  const day = () => date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(date().getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
  const time = () => date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const exact = () => date().toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'long' });
  return <Show when={valid()}><Tooltip content={exact()}><time dateTime={props.iso} aria-label={exact()} tabIndex={0} class={props.class}>{day()} · {time()}</time></Tooltip></Show>;
}

/** Stack the visible threads at their anchors, spaced, and keep a short cluster inside the viewport. */
export function positionedComments(annotations: AnnotationWire[], rects: Record<string, StoryEditRect>,
  frame: Pick<DOMRect, 'top' | 'height'>, viewportHeight: number): Array<{ annotation: AnnotationWire; top: number }> {
  const visible = annotations.flatMap((annotation) => {
    const rect = rects[annotation.id];
    if (!rect || rect.y + rect.height < 0 || rect.y > frame.height) return [];
    return [{ annotation, target: frame.top + rect.y }];
  }).sort((a, b) => a.target - b.target);
  if (!visible.length) return [];
  const minTop = frame.top + VIEW_COMMENT_INSET;
  let cursor = minTop;
  const placed = visible.map(({ annotation, target }) => {
    const top = Math.max(target, cursor);
    cursor = top + VIEW_COMMENT_COLLAPSED_H + VIEW_COMMENT_GAP;
    return { annotation, top };
  });
  // Leave room for the last marker to expand inside the viewport.
  const overflow = placed.at(-1)!.top + VIEW_COMMENT_EXPANDED_H + VIEW_COMMENT_INSET - viewportHeight;
  const shift = Math.max(0, Math.min(overflow, placed[0]!.top - minTop));
  return shift > 0 ? placed.map((item) => ({ ...item, top: item.top - shift })) : placed;
}

const ACTIVE_PHASES = ['queued', 'dispatching', 'delivered', 'acknowledged'];

/** A quiet identity mark until intent is shown; then enough context to choose. */
export function AnnotationPreview(props: {
  row: AnnotationWire; top: number; remaining?: number; hovered: boolean;
  /** Room taken on the right (the edit panel): the mark sits beside it, never under it. */
  rightInset?: number;
  onOpen: () => void; onHover: (id: string | null) => void;
}): JSX.Element {
  const [repliesExpanded, setRepliesExpanded] = createSignal(false);
  const [continuation, setContinuation] = createSignal<HTMLButtonElement>();
  // The preview owns the delay; leaving or unmounting always cancels it.
  createEffect(() => {
    if (!props.hovered) { setRepliesExpanded(false); return; }
    const button = continuation();
    if (!button) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { clearTimeout(timer); };
    const enter = () => { cancel(); timer = setTimeout(() => setRepliesExpanded(true), 600); };
    button.addEventListener('mouseenter', enter);
    button.addEventListener('mouseleave', cancel);
    onCleanup(() => { cancel(); button.removeEventListener('mouseenter', enter); button.removeEventListener('mouseleave', cancel); });
  });
  const first = () => props.row.thread[0];
  const label = () => first() ? authorLabel(first()!.author) : 'Unknown';
  const messages = () => props.row.thread.length;
  const agents = () => (props.row.remote_work ?? []).filter((work, index, all) => !all.slice(index + 1).some((next) => next.sessionId === work.sessionId));
  const activeAgents = () => agents().filter((work) => work.connection === 'online' && ACTIVE_PHASES.includes(work.phase) && work.activity !== 'unknown');
  const work = () => activeAgents().at(-1) ?? agents().at(-1);
  const inbox = useOptionalInbox();
  const unread = () => inbox?.state()?.notifications.some((n) => !n.read_at && n.source === `comment:${props.row.id}`);
  const working = () => activeAgents().length > 0;
  const compactWidth = () => messages() > 9 ? VIEW_COMMENT_MANY_W : messages() > 1 ? VIEW_COMMENT_COUNTED_W : VIEW_COMMENT_COLLAPSED_W;
  const radius = () => props.hovered ? '5px' : '50% 50% 50% 3px';
  return <article
    onMouseEnter={() => props.onHover(props.row.id)}
    onMouseLeave={() => props.onHover(null)}
    onFocusIn={() => props.onHover(props.row.id)}
    onFocusOut={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onHover(null); }}
    data-annotation-id={props.row.id}
    data-hovered={props.hovered ? 'true' : undefined}
    class={`${working() ? 'motion-safe:animate-pulse' : ''} group pointer-events-auto overflow-hidden border text-left shadow-md transition-[top,width,height,border-color,background-color,box-shadow] duration-150 ${props.hovered ? 'z-10 border-edge-bright bg-comment-hover px-3 py-2.5 shadow-xl' : 'border-transparent bg-raised hover:bg-raised'}`}
    style={{
      position: 'fixed',
      outline: work() ? `2px solid ${agentNameColor(work()!.name)}` : undefined,
      top: `${props.top}px`,
      right: `${(props.rightInset ?? 0) + VIEW_COMMENT_INSET}px`,
      width: `${props.hovered ? 288 : compactWidth()}px`,
      'max-width': `calc(100vw - ${(props.rightInset ?? 0) + VIEW_COMMENT_INSET * 2}px)`,
      height: props.hovered ? (repliesExpanded() ? 'auto' : `${VIEW_COMMENT_EXPANDED_H}px`) : `${VIEW_COMMENT_COLLAPSED_H}px`,
      'max-height': props.hovered && repliesExpanded() ? `calc(100dvh - ${props.top + VIEW_COMMENT_INSET}px)` : undefined,
      'overflow-y': props.hovered && repliesExpanded() ? 'auto' : undefined,
      'border-radius': radius(),
    }}>
    <button type="button" aria-label={`Open annotation conversation by ${label()}, ${messages()} message${messages() === 1 ? '' : 's'}`} onClick={() => props.onOpen()}
      class="absolute inset-0 z-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent" style={{ 'border-radius': radius() }} />
    <Show when={unread()}><span aria-label="Unread reply" class="pointer-events-none absolute right-0 top-0 z-10 h-2 w-2 rounded-full bg-accent" /></Show>
    <Show when={props.row.status === 'resolved'}><span aria-label="Resolved" class="pointer-events-none absolute bottom-0 right-0 z-10 text-xs text-accent">✓</span></Show>
    <Show when={work()}>{(current) => <span class="sr-only">{remoteWorkLabel(current())}{agents().length > 1 ? ` · ${agents().length} agents` : null}</span>}</Show>
    <Show when={props.hovered && agents().length > 1}><span class="absolute right-2 top-1 text-[10px] text-muted">{agents().length} agents</span></Show>
    <Show when={props.remaining !== undefined}><span role="status" class="sr-only motion-reduce:not-sr-only">Resolved · {Math.ceil((props.remaining ?? 0) / 1000)} seconds</span></Show>
    <Show when={first() && !props.hovered}>
      <span class="pointer-events-none absolute inset-0 flex items-center justify-start pl-[7px]">
        <span class="relative flex h-[22px] w-[22px] shrink-0 items-center justify-center">
          <Show when={props.remaining !== undefined}>
            <svg aria-hidden="true" class="pointer-events-none absolute -left-1 -top-1 h-[30px] w-[30px] motion-reduce:hidden" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" stroke-width="2" pathLength="100" stroke-dasharray={`${(props.remaining ?? 0) / 100} 100`} transform="rotate(-90 20 20)" /></svg>
          </Show>
          <CompactAuthorMark author={first()!.author} />
        </span>
        <Show when={messages() > 1}>
          <span data-thread-count aria-hidden="true" class="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[9px] font-bold leading-none text-fg">{messages() > 9 ? '9+' : messages()}</span>
        </Show>
      </span>
    </Show>
    <Show when={first() && props.hovered}>
      <span class="pointer-events-none relative z-10 flex h-full animate-[rise_.12s_ease-out] flex-col">
        <span class="flex items-center justify-between gap-2">
          <AuthorIdentity author={first()!.author} />
          <CommentTimestamp iso={first()!.created_at} class="font-mono text-[10px] text-faint" />
        </span>
        <span class="mt-1.5 line-clamp-2 block font-sans text-sm leading-snug text-fg/90">{previewText(first()!.body)}</span>
        <span class="mt-auto flex items-center justify-between font-mono text-[10px] text-faint">
          <Show when={messages() > 1} fallback={<ThreadContinuation thread={props.row.thread} />}>
            <button ref={setContinuation} type="button" aria-label="Expand replies" aria-expanded={repliesExpanded()} onClick={() => setRepliesExpanded(true)}
              class="pointer-events-auto cursor-pointer rounded-sm text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"><ThreadContinuation thread={props.row.thread} /></button>
          </Show>
          <span class="transition-colors group-hover:text-accent">open →</span>
        </span>
        <Show when={repliesExpanded()}>
          <span role="list" aria-label="Thread replies" class="pointer-events-auto mt-2 flex flex-col gap-3 border-t border-edge pt-2">
            <For each={props.row.thread.slice(1)}>{(reply) => (
              <span role="listitem" class="block">
                <AuthorIdentity author={reply.author} />
                <span class="mt-1 block whitespace-pre-wrap break-words font-sans text-sm leading-snug text-fg/90">{previewText(reply.body)}</span>
              </span>
            )}</For>
          </span>
        </Show>
      </span>
    </Show>
  </article>;
}

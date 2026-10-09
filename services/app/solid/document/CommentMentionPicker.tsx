/* @jsxImportSource solid-js */
/**
 * The people and agents a comment draft can @mention.
 * Both are looked up on the server; without either, its section says why. The textarea keeps the
 * keyboard — this list answers ArrowUp/ArrowDown/Enter/Tab through `onReady`'s handle.
 */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import X from 'lucide-solid/icons/x';
import type { ArtifactBackend, MemberPerson } from '@/lib/artifact-backend/types';
import { personMention } from '@/lib/document/person-mentions';
import { remoteMention } from '@/lib/annotations/remote-reply';
import { type RemoteSessionInfo } from '../../../contracts/src/remote';
import { agentNameColor } from '../lib/agent-identity';
import { Tooltip } from '../components/Tooltip';
const agentLabel = (name: string) => (({ claude: 'Claude Code', codex: 'Codex', pi: 'Pi', opencode: 'OpenCode' } as Record<string, string>)[name] ?? name);
/** Hosted native generations own the comment relay; raw run terminals do not.
 * Shared by quick choices and the full picker, including requests queued before login. */
export const canTagAgent = (session: RemoteSessionInfo) => (!session.runId || !!session.hostedGeneration) && (session.managed ? session.exitCode === null && session.activity !== 'stopped' : session.online);
export interface MentionKeyboard { keyDown: (key: string) => boolean }

export function CommentMentionPicker(props: {
  backend: ArtifactBackend; artifactId?: string; query: string; onSelect: (text: string) => void;
  onReady?: (keyboard: MentionKeyboard | null) => void;
}): JSX.Element {
  const [sessions, setSessions] = createSignal<RemoteSessionInfo[]>([]);
  const [people, setPeople] = createSignal<MemberPerson[]>([]);
  const [active, setActive] = createSignal(0);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal('');
  const [removing, setRemoving] = createSignal<string | null>(null);
  const sessionsUnavailable = props.backend.unavailable('remoteSessions');
  const peopleUnavailable = props.backend.unavailable('mentions');
  const matches = () => sessions().filter((session) =>
    canTagAgent(session)
    && `${session.name} ${session.harness}`.toLowerCase().includes(props.query.toLowerCase()));
  const choose = (session: RemoteSessionInfo) => props.onSelect(remoteMention(session));
  const keyboard: MentionKeyboard = { keyDown(key) {
    const count = people().length + matches().length;
    if (!count) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp') { setActive((index) => (index + (key === 'ArrowDown' ? 1 : count - 1)) % count); return true; }
    if (key === 'Enter' || key === 'Tab') {
      const index = active() % count;
      const person = people()[index];
      if (person) props.onSelect(personMention(person));
      else { const session = matches()[index - people().length]; if (session) choose(session); }
      return true;
    }
    return false;
  } };
  onMount(() => {
    props.onReady?.(keyboard);
    onCleanup(() => props.onReady?.(null));
    if (sessionsUnavailable) return;
    const abort = new AbortController();
    void props.backend.remoteSessions({ signal: abort.signal })
      .then((answer) => { setSessions((answer.sessions ?? []) as RemoteSessionInfo[]); setLoaded(true); })
      .catch(() => setLoaded(true));
    onCleanup(() => abort.abort());
  });
  createEffect(() => {
    const query = props.query;
    setActive(0);
    if (!props.artifactId || peopleUnavailable) return;
    const abort = new AbortController();
    void props.backend.members(query, { signal: abort.signal })
      .then((answer) => answer ?? { people: [] })
      .then((answer) => setPeople(answer.people ?? []))
      .catch(() => {});
    onCleanup(() => abort.abort());
  });
  const remove = async (id: string) => {
    setRemoving(id); setError('');
    try {
      await props.backend.deleteRemoteSession(id);
      setSessions((items) => items.filter((item) => item.id !== id));
      setActive(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove agent. Try again.'); }
    finally { setRemoving(null); }
  };
  const keep = (event: MouseEvent) => event.preventDefault();
  return <div aria-label="Agent sessions" class="mb-2 overflow-hidden rounded-lg border border-edge bg-surface p-1.5 font-sans text-sm shadow-lg">
    <Show when={props.artifactId}>
      <p class="px-2 py-1.5 text-xs font-medium text-muted">Mention a person</p>
      <For each={people()}>{(person, index) => (
        <button type="button" aria-label={`Mention @${person.username}`} class={`block w-full rounded-md px-2 py-2 text-left ${index() === active() ? 'bg-accent-soft' : 'hover:bg-bg'}`}
          onMouseDown={keep} onMouseEnter={() => setActive(index())} onClick={() => props.onSelect(personMention(person))}>
          @{person.username}<span class="ml-2 text-xs text-muted">{person.name}</span>
        </button>
      )}</For>
      <Show when={peopleUnavailable} fallback={<Show when={!people().length}><p class="px-2 py-1 text-xs text-muted">No matching followers or members.</p></Show>}>
        <p role="note" class="px-2 py-1 text-xs text-muted">{peopleUnavailable}</p>
      </Show>
    </Show>
    <p class="px-2 py-1.5 text-xs font-medium text-muted">Mention an agent</p>
    <For each={matches()}>{(session, index) => (
      <div class="flex items-center">
        <button type="button" aria-label={`Mention ${session.name} (${session.harness})`}
          class={`flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors ${index() + people().length === active() ? 'bg-accent-soft' : 'hover:bg-bg'}`}
          onMouseEnter={() => setActive(index() + people().length)} onMouseDown={keep} onClick={() => choose(session)}>
          <span aria-hidden="true" style={{ color: agentNameColor(session.name) }} class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-semibold text-accent">@</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-fg">{session.name}</span>
            <span class="block truncate text-xs text-muted">{agentLabel(session.harness)} · {session.machine}</span>
          </span>
          <span class="flex shrink-0 items-center gap-1 text-[10px] text-muted"><span class={`h-1.5 w-1.5 rounded-full ${session.online ? 'bg-green-500' : 'bg-muted'}`} />{session.online ? (session.activity ?? 'Online') : 'Offline'}</span>
        </button>
        <Show when={!session.online}>
          <Tooltip content="Remove agent">
            <button type="button" aria-label={`Remove ${session.name}`} disabled={removing() !== null}
              class="rounded-md p-2 text-muted hover:text-fg disabled:opacity-40" onMouseDown={keep} onClick={() => void remove(session.id)}>
              <X size={14} aria-hidden="true" />
            </button>
          </Tooltip>
        </Show>
      </div>
    )}</For>
    <Show when={error()}><p role="alert" class="px-2 py-1.5 text-sm text-muted">{error()}</p></Show>
    <Show when={sessionsUnavailable}><p role="note" class="px-2 py-1.5 text-xs text-muted">{sessionsUnavailable}</p></Show>
    <Show when={!sessionsUnavailable}>
      <div class="flex flex-wrap items-center gap-2 px-2 py-1.5 font-sans text-xs text-muted">
        <Show when={!matches().length}><p>{loaded() ? 'No matching agents.' : 'Loading sessions…'}</p></Show>
        <Show when={loaded()}>
          <a class="comment-agents-manage" href="/chat" target="_blank" rel="noopener noreferrer">Manage agents<ArrowUpRight size={12} aria-hidden="true" /></a>
        </Show>
      </div>
    </Show>
  </div>;
}

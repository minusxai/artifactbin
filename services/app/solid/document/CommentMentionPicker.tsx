/* @jsxImportSource solid-js */
/**
 * The people and agents a comment draft can @mention.
 * Both are looked up on the server; without either, its section says why. The textarea keeps the
 * keyboard — this list answers ArrowUp/ArrowDown/Enter/Tab through `onReady`'s handle.
 */
import { createEffect, createSignal, createUniqueId, onCleanup, onMount, Show, type JSX } from 'solid-js';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import X from 'lucide-solid/icons/x';
import type { ArtifactBackend, MemberPerson } from '@/lib/artifact-backend/types';
import { personMention } from '@/lib/document/person-mentions';
import { remoteMention } from '@/lib/annotations/remote-reply';
import { type RemoteSessionInfo } from '../../../contracts/src/remote';
import { agentNameColor } from '../lib/agent-identity';
import { Button } from '../ui/Button';
import { ComboboxList, createListNavigation } from '../ui/Combobox';
import { Panel } from '../ui/Panel';
import { Tooltip } from '../ui/Tooltip';
const agentLabel = (name: string) => (({ claude: 'Claude Code', codex: 'Codex', pi: 'Pi', opencode: 'OpenCode' } as Record<string, string>)[name] ?? name);
/** Hosted native generations own the comment relay; raw run terminals do not.
 * Shared by quick choices and the full picker, including requests queued before login. */
export const canTagAgent = (session: RemoteSessionInfo) => (!session.runId || !!session.hostedGeneration) && (session.managed ? session.exitCode === null && session.activity !== 'stopped' : session.online);
export interface MentionKeyboard { keyDown: (key: string) => boolean }

export function CommentMentionPicker(props: {
  backend: ArtifactBackend; artifactId?: string; query: string; onSelect: (text: string) => void;
  onReady?: (keyboard: MentionKeyboard | null) => void;
}): JSX.Element {
  const id = createUniqueId();
  const [sessions, setSessions] = createSignal<RemoteSessionInfo[]>([]);
  const [people, setPeople] = createSignal<MemberPerson[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal('');
  const [removing, setRemoving] = createSignal<string | null>(null);
  const sessionsUnavailable = props.backend.unavailable('remoteSessions');
  const peopleUnavailable = props.backend.unavailable('mentions');
  const matches = () => sessions().filter((session) =>
    canTagAgent(session)
    && `${session.name} ${session.harness}`.toLowerCase().includes(props.query.toLowerCase()));
  const choose = (session: RemoteSessionInfo) => props.onSelect(remoteMention(session));
  // One list navigation over both sections: the people first, then the agents.
  const nav = createListNavigation({
    count: () => people().length + matches().length,
    onSelect: (index) => {
      const person = people()[index];
      if (person) props.onSelect(personMention(person));
      else { const session = matches()[index - people().length]; if (session) choose(session); }
    },
  });
  const keyboard: MentionKeyboard = { keyDown: nav.keyDown };
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
    nav.setActive(0);
    if (!props.artifactId || peopleUnavailable) return;
    const abort = new AbortController();
    void props.backend.members(query, { signal: abort.signal })
      .then((answer) => answer ?? { people: [] })
      .then((answer) => setPeople(answer.people ?? []))
      .catch(() => {});
    onCleanup(() => abort.abort());
  });
  const remove = async (sessionId: string) => {
    setRemoving(sessionId); setError('');
    try {
      await props.backend.deleteRemoteSession(sessionId);
      setSessions((items) => items.filter((item) => item.id !== sessionId));
      nav.setActive(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove agent. Try again.'); }
    finally { setRemoving(null); }
  };
  return <Panel label="Agent sessions" padding="none" class="mb-2 overflow-hidden p-1.5 font-sans text-sm shadow-lg">
    <Show when={props.artifactId}>
      <p class="px-2 py-1.5 text-xs font-medium text-muted">Mention a person</p>
      <Show when={people().length}>
        <ComboboxList id={`${id}-people`} label="People" options={people()} optionKey={(person) => person.user_id}
          active={nav.active()} onActive={nav.setActive} onSelect={(person) => props.onSelect(personMention(person))}
          renderOption={(person) => (
            <span aria-label={`Mention @${person.username}`} class="flex w-full min-w-0 items-baseline gap-2 text-left"><span class="text-sm text-fg">@{person.username}</span><span class="truncate text-xs text-muted">{person.name}</span></span>
          )} />
      </Show>
      <Show when={peopleUnavailable} fallback={<Show when={!people().length}><p class="px-2 py-1 text-xs text-muted">No matching followers or members.</p></Show>}>
        <p role="note" class="px-2 py-1 text-xs text-muted">{peopleUnavailable}</p>
      </Show>
    </Show>
    <p class="px-2 py-1.5 text-xs font-medium text-muted">Mention an agent</p>
    <Show when={matches().length}>
      <ComboboxList id={`${id}-agents`} label="Agents" options={matches()} optionKey={(session) => session.id}
        active={nav.active() - people().length} onActive={(index) => nav.setActive(index + people().length)} onSelect={choose}
        renderOption={(session) => (
          <span class="flex items-center gap-2">
            <span aria-label={`Mention ${session.name} (${session.harness})`} class="flex min-w-0 flex-1 items-center gap-2">
              <span aria-hidden="true" style={{ color: agentNameColor(session.name) }} class="flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-soft font-semibold text-accent">@</span>
              <span class="min-w-0 flex-1 text-left font-sans">
                <span class="block truncate text-sm font-medium text-fg">{session.name}</span>
                <span class="block truncate text-xs text-muted">{agentLabel(session.harness)} · {session.machine}</span>
              </span>
              <span class="flex shrink-0 items-center gap-1 font-sans text-micro text-muted"><span class={`h-1.5 w-1.5 rounded-full ${session.online ? 'bg-accent' : 'bg-muted'}`} />{session.online ? (session.activity ?? 'Online') : 'Offline'}</span>
            </span>
            <Show when={!session.online}>
              <Tooltip content="Remove agent">
                <Button type="button" variant="ghost" size="sm" icon aria-label={`Remove ${session.name}`} disabled={removing() !== null}
                  onClick={(event) => { event.stopPropagation(); void remove(session.id); }}>
                  <X size={14} aria-hidden="true" />
                </Button>
              </Tooltip>
            </Show>
          </span>
        )} />
    </Show>
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
  </Panel>;
}

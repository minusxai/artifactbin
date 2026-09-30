/* @jsxImportSource solid-js */
import { createEffect, createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import type { ArtifactBackend, MemberPerson } from '@/lib/artifact-backend/types';
import { personMention } from '@/lib/person-mentions';
import { remoteMention } from '@/lib/remote-reply';
import type { RemoteSessionInfo } from '../../../contracts/src/remote';

const REQUEST = 'Connect to afbin remote so I can @mention you in artifact comments.';
export interface MentionKeyboard { keyDown: (key: string) => boolean }

/** A scoped picker for attributed person and agent mentions in comment drafts. */
export function CommentMentionPicker(props: {
  backend: ArtifactBackend; artifactId?: string; query: string; onSelect: (text: string) => void;
  onReady?: (keyboard: MentionKeyboard | null) => void;
}): JSX.Element {
  const [sessions, setSessions] = createSignal<RemoteSessionInfo[]>([]);
  const [people, setPeople] = createSignal<MemberPerson[]>([]);
  const [active, setActive] = createSignal(0);
  const [loaded, setLoaded] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal<'idle' | 'copied' | 'error'>('idle');
  const [error, setError] = createSignal('');
  const [removing, setRemoving] = createSignal<string | null>(null);
  const remoteUnavailable = props.backend.unavailable('remoteSessions');
  const peopleUnavailable = props.backend.unavailable('mentions');
  const matches = () => sessions().filter(session =>
    (session.managed ? session.exitCode === null && session.activity !== 'stopped' : session.online)
    && `${session.name} ${session.harness}`.toLowerCase().includes(props.query.toLowerCase()));
  const choose = (session: RemoteSessionInfo) => props.onSelect(remoteMention(session));
  const keyboard: MentionKeyboard = { keyDown(key) {
    const count = people().length + matches().length;
    if (!count) return false;
    if (key === 'ArrowDown' || key === 'ArrowUp') { setActive(index => (index + (key === 'ArrowDown' ? 1 : count - 1)) % count); return true; }
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
    if (remoteUnavailable) return;
    const controller = new AbortController();
    void props.backend.remoteSessions({ signal: controller.signal }).then(answer => {
      if (!controller.signal.aborted) { setSessions(answer.sessions ?? []); setLoaded(true); }
    }).catch(() => { if (!controller.signal.aborted) setLoaded(true); });
    onCleanup(() => controller.abort());
  });
  createEffect(() => {
    void props.query;
    setActive(0);
    if (!props.artifactId || peopleUnavailable) return;
    const controller = new AbortController();
    void props.backend.members(props.query, { signal: controller.signal }).then(answer => {
      if (!controller.signal.aborted) setPeople(answer?.people ?? []);
    }).catch(() => {});
    onCleanup(() => controller.abort());
  });
  const remove = async (session: RemoteSessionInfo) => {
    setRemoving(session.id); setError('');
    try { await props.backend.deleteRemoteSession(session.id); setSessions(current => current.filter(item => item.id !== session.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove agent. Try again.'); }
    finally { setRemoving(null); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(REQUEST); setCopyStatus('copied'); }
    catch { setCopyStatus('error'); }
  };
  return <div aria-label="Agent sessions" class="mb-2 overflow-hidden rounded border border-edge bg-surface p-2 text-sm shadow-lg">
    <Show when={props.artifactId}><p>Mention a person</p><For each={people()}>{person => <button type="button" aria-label={`Mention @${person.username}`} onMouseDown={event => event.preventDefault()} onClick={() => props.onSelect(personMention(person))}>@{person.username}</button>}</For>
      <Show when={peopleUnavailable}><p role="note">{peopleUnavailable}</p></Show>
      <Show when={!peopleUnavailable && people().length === 0}><p>No matching followers or members.</p></Show>
    </Show>
    <p class="text-xs uppercase">Mention an agent</p>
    <For each={matches()}>{session => <div class="flex items-center"><button type="button" aria-label={`Mention ${session.name} (${session.harness})`} onMouseDown={event => event.preventDefault()} onClick={() => choose(session)} class="min-w-0 flex-1 text-left">@{session.name} · {session.harness} · {session.machine}</button>
      <Show when={!session.online}><button type="button" aria-label={`Remove ${session.name}`} disabled={removing() !== null} onMouseDown={event => event.preventDefault()} onClick={() => void remove(session)}>×</button></Show>
    </div>}</For>
    <Show when={error()}><p role="alert">{error()}</p></Show>
    <Show when={loaded() && matches().length > 0}><button type="button" aria-label="Add another agent" aria-expanded={expanded()} onMouseDown={event => event.preventDefault()} onClick={() => setExpanded(value => !value)}>Add another agent</button></Show>
    <Show when={remoteUnavailable}><p role="note">{remoteUnavailable}</p></Show>
    <Show when={!remoteUnavailable && (!matches().length || expanded())}><div class="mt-2">
      <Show when={!matches().length}><p>{loaded() ? 'No matching agents.' : 'Loading sessions…'}</p></Show>
      <Show when={loaded()}><p>Ask your agent to connect:</p><p>{REQUEST}</p><button type="button" aria-label="Copy connection request" onMouseDown={event => event.preventDefault()} onClick={() => void copy()}>copy</button><p role="status">{copyStatus() === 'copied' ? 'Copied — paste into your agent.' : copyStatus() === 'error' ? 'Could not copy. Select and copy the request above.' : ''}</p></Show>
    </div></Show>
  </div>;
}

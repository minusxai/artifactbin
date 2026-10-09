/* @jsxImportSource solid-js */
/**
 * One membership-status read per comment surface (the layer
 * mounts one provider, not one per rendered body): only explicitly saved mentions come back, never
 * private invite details, and a mention of someone who has not accepted yet reads "· Pending".
 */
import { createContext, createSignal, onCleanup, onMount, Show, useContext, type Accessor, type JSX } from 'solid-js';
import type { MembershipStatus } from '@artifactbin/contracts';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { isPersonMentionHref } from '@/lib/document/person-mentions';

const MentionStatuses = createContext<Accessor<Record<string, MembershipStatus>>>(() => ({}));

export function PersonMentionProvider(props: { artifactId?: string; backend?: ArtifactBackend; children: JSX.Element }): JSX.Element {
  const [statuses, setStatuses] = createSignal<Record<string, MembershipStatus>>({});
  onMount(() => {
    const backend = props.backend;
    if (!props.artifactId || !backend || backend.unavailable('mentions') || window.location.pathname.endsWith('/raw')) return;
    const abort = new AbortController();
    const refresh = () => {
      void backend.members(undefined, { signal: abort.signal })
        .then((answer) => { if (answer && !abort.signal.aborted) setStatuses(answer.mentions ?? {}); })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    onCleanup(() => { abort.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); });
  });
  return <MentionStatuses.Provider value={statuses}>{props.children}</MentionStatuses.Provider>;
}

export function PersonMention(props: { href: string; class?: string; children: JSX.Element }): JSX.Element {
  const statuses = useContext(MentionStatuses);
  const status = () => isPersonMentionHref(props.href) ? statuses()[props.href.slice('/people/'.length)] : undefined;
  return <a href={props.href} class={props.class}>{props.children}<Show when={status() === 'pending'}><span class="ml-1 text-xs text-muted-foreground" aria-label="Invitation pending">· Pending</span></Show></a>;
}

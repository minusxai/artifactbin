/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { Bell, Check } from 'lucide-solid';
import { isMutationNotification, type InboxItem, type MemberNotificationItem, type MutationNotificationView } from '@artifactbin/contracts';
import { timeAgo } from '../ui/ui';
import { Button } from '../ui/Button';
import { StatusMessage } from '../ui/StatusMessage';
import { useInbox } from '../lib/notifications';
import { apiFetch } from '../lib/api';

const ACTION: Record<string, string> = { request: 'asked to join', invitation: 'invited you to', joined: 'added you to', follow: 'followed you', like: 'liked', reply_resolved: 'replied and resolved your comment in', reply: 'replied in', resolved: 'resolved a comment in', reopened: 'reopened a comment in' };
function senderLabel(item: MemberNotificationItem): string { return item.agent_label ? item.agent_label === 'Agent' ? 'Agent' : `@${item.agent_label.replace(/^@/, '')}` : `@${item.username ?? 'someone'}`; }
function destination(item: MemberNotificationItem): string {
  if (item.kind === 'follow') return `/people/${item.sender_id}`;
  const tail = item.source?.startsWith('node:') ? `#${item.source.slice(5)}` : item.source?.startsWith('comment:') ? `?thread=${item.source.slice(8)}${item.first_update_id ? `&comment=${encodeURIComponent(item.first_update_id)}` : ''}` : '';
  return `/a/${item.artifact_id}${tail}`;
}

/**
 * The inbox's failure, with a Retry that visibly retries: disabled as "Retrying…" while the read is
 * in flight, the error gone on success, and a fresh attempt time when it fails again.
 */
export function InboxAlert(props: { message?: string; dismiss?: () => void; class?: string }): JSX.Element {
  const inbox = useInbox();
  const message = () => props.message || inbox.error();
  const retry = () => { props.dismiss?.(); void inbox.load(); };
  return <Show when={message()}><StatusMessage kind="error" class={props.class}
    action={<Button size="sm" variant="secondary" disabled={inbox.loading()} onClick={retry}>{inbox.loading() ? 'Retrying…' : 'Retry'}</Button>}>
    {message()}
    <Show when={!props.message && inbox.failedAt()}>{at => <time dateTime={new Date(at()).toISOString()} class="ml-2 text-xs text-muted">Tried {new Date(at()).toLocaleTimeString()}</time>}</Show>
  </StatusMessage></Show>;
}

export function PeopleInbox(props: { compact?: boolean; close?: () => void }): JSX.Element {
  const inbox = useInbox();
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal('');
  const items = () => props.compact ? inbox.state()?.notifications.slice(0, 6) ?? [] : inbox.state()?.notifications ?? [];
  const markRead = (item: InboxItem) => { void inbox.load({ read: item.id, revision: item.revision }); props.close?.(); };
  const markAllRead = async () => {
    if (busy()) return;
    setBusy(true); setActionError('');
    try { await inbox.load({ readAll: true }); }
    finally { setBusy(false); }
  };
  const respond = async (item: InboxItem, action: 'accept' | 'approve' | 'dismiss') => {
    if (isMutationNotification(item) || !item.artifact_id) return;
    setBusy(true); setActionError('');
    try {
      const response = await apiFetch(`/api/my/artifacts/${encodeURIComponent(item.artifact_id)}/members`, 'POST', { action, ...(item.direction === 'request' ? { userId: item.user_id } : {}) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.detail ?? 'Could not update invitation'); }
      await inbox.load({ read: item.id, revision: item.revision });
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update invitation'); }
    finally { setBusy(false); }
  };
  const mutationSummary = (item: MutationNotificationView) => <a href={`/a/${item.artifact_id}`} onClick={() => markRead(item)} class="block break-words text-sm"><For each={item.messages}>{message => <span class="block">{message}</span>}</For></a>;
  const memberSummary = (item: MemberNotificationItem) => <>
    <a class="block break-words text-sm leading-5 text-fg hover:text-accent" href={destination(item)} onClick={() => markRead(item)}><span class="font-semibold">{senderLabel(item)}</span> {ACTION[item.kind] ?? 'mentioned you in'} <span class="font-semibold">{item.title ?? 'Untitled artifact'}</span></a>
    <Show when={item.created_at}><time dateTime={item.created_at} class="mt-1 block text-xs text-muted">{timeAgo(item.created_at!)}</time></Show>
    <Show when={item.status === 'pending' && ['invitation', 'request', 'joined'].includes(item.kind)}><div class="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={busy()} onClick={() => void respond(item, item.direction === 'request' ? 'approve' : 'accept')}>{item.direction === 'request' ? 'Approve request' : 'Accept invitation'}</Button><Button size="sm" variant="secondary" disabled={busy()} onClick={() => void respond(item, 'dismiss')}>Dismiss</Button></div></Show>
    <Show when={item.status === 'accepted' && ['invitation', 'request', 'joined'].includes(item.kind)}><p role="status" class="mt-2 text-xs text-accent"><Check size={14} class="inline" /> Invitation accepted</p></Show>
  </>;
  return <section aria-label="Notification list" class="font-sans">
    <Show when={inbox.state()?.unread}><div class="flex justify-end border-b border-edge px-3 py-2"><Button size="sm" variant="secondary" disabled={busy()} onClick={() => void markAllRead()}>Mark all as read</Button></div></Show>
    <InboxAlert message={actionError()} dismiss={() => setActionError('')} class="p-3" />
    <Show when={inbox.reconnecting() && inbox.state()}><p role="status" aria-label="Live updates" class="px-3 pt-2 text-xs text-muted">Live updates paused. Reconnecting…</p></Show>
    <Show when={!inbox.state() && !inbox.error()}><StatusMessage kind="loading" class="p-4">Loading notifications…</StatusMessage></Show>
    <Show when={inbox.state() && !items().length}><div class="px-6 py-10 text-center"><Bell size={24} class="mx-auto mb-3 text-muted" /><p class="text-sm font-medium">You’re all caught up.</p><p class="mt-1 text-xs leading-5 text-muted">Invitations, replies and activity will appear here.</p></div></Show>
    <ul class="m-0 list-none divide-y divide-edge p-0"><For each={items()}>{item => <li data-notification-id={item.id} class={`relative flex gap-3 px-3 py-3.5 ${item.read_at ? '' : 'bg-accent-soft/40'}`}>
      <div class="min-w-0 flex-1">{isMutationNotification(item) ? mutationSummary(item) : memberSummary(item)}</div>
      <Show when={!item.read_at}><span aria-label="Unread" class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /></Show>
    </li>}</For></ul>
    <Show when={!props.compact && inbox.state()?.next != null}><div class="border-t border-edge p-3 text-center"><Button size="sm" variant="secondary" onClick={() => void inbox.loadMore()}>Load more</Button></div></Show>
  </section>;
}

/* @jsxImportSource solid-js */
import { createSignal, For, Show, type JSX } from 'solid-js';
import { Bell, Check } from 'lucide-solid';
import type { InboxItem, LegacyInboxItem } from '@/components/notification-context';
import { timeAgo } from './ui';
import { useInbox } from '../web/notifications';

const ACTION: Record<string, string> = { request: 'asked to join', invitation: 'invited you to', joined: 'added you to', follow: 'followed you', like: 'liked', reply_resolved: 'replied and resolved your comment in', reply: 'replied in', resolved: 'resolved a comment in', reopened: 'reopened a comment in' };
function destination(item: LegacyInboxItem): string {
  if (item.kind === 'follow') return `/people/${item.sender_id}`;
  const tail = item.source?.startsWith('node:') ? `#${item.source.slice(5)}` : item.source?.startsWith('comment:') ? `?thread=${item.source.slice(8)}${item.first_update_id ? `&comment=${encodeURIComponent(item.first_update_id)}` : ''}` : '';
  return `/a/${item.artifact_id}${tail}`;
}

export function PeopleInbox(props: { compact?: boolean; close?: () => void }): JSX.Element {
  const inbox = useInbox();
  const [busy, setBusy] = createSignal(false);
  const [actionError, setActionError] = createSignal('');
  const items = () => props.compact ? inbox.state()?.notifications.slice(0, 6) ?? [] : inbox.state()?.notifications ?? [];
  const markRead = (item: InboxItem) => { void inbox.load({ read: item.id, revision: item.revision }); props.close?.(); };
  const respond = async (item: InboxItem, action: 'accept' | 'approve' | 'dismiss') => {
    if (!item.artifact_id || 'actor' in item) return;
    setBusy(true); setActionError('');
    try {
      const response = await fetch(`/api/my/artifacts/${encodeURIComponent(item.artifact_id)}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...(item.direction === 'request' ? { userId: item.user_id } : {}) }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.detail ?? 'Could not update invitation'); }
      await inbox.load({ read: item.id, revision: item.revision });
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update invitation'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Notification list" class="font-sans">
    <Show when={inbox.error() || actionError()}><p role="alert" class="p-3 text-sm text-danger">{actionError() || inbox.error()} <button onClick={() => void inbox.load()}>Retry</button></p></Show>
    <Show when={!inbox.state() && !inbox.error()}><p role="status" class="p-4 text-sm text-muted">Loading notifications…</p></Show>
    <Show when={inbox.state() && !items().length}><div class="px-6 py-10 text-center"><Bell size={24} class="mx-auto mb-3 text-muted" /><p class="text-sm font-medium">You’re all caught up.</p><p class="mt-1 text-xs leading-5 text-muted">Invitations, replies and activity will appear here.</p></div></Show>
    <ul class="m-0 list-none divide-y divide-edge p-0"><For each={items()}>{item => <li data-notification-id={item.id} class={`relative flex gap-3 px-3 py-3.5 ${item.read_at ? '' : 'bg-accent-soft/40'}`}>
      <div class="min-w-0 flex-1"><Show when={'actor' in item} fallback={<>
        <a class="block break-words text-sm leading-5 text-fg hover:text-accent" href={destination(item as LegacyInboxItem)} onClick={() => markRead(item)}><span class="font-semibold">@{(item as LegacyInboxItem).username ?? 'someone'}</span> {ACTION[item.kind] ?? 'mentioned you in'} <span class="font-semibold">{(item as LegacyInboxItem).title ?? 'Untitled artifact'}</span></a>
        <Show when={item.created_at}><time dateTime={item.created_at} class="mt-1 block text-xs text-muted">{timeAgo(item.created_at!)}</time></Show>
        <Show when={(item as LegacyInboxItem).status === 'pending' && ['invitation', 'request', 'joined'].includes(item.kind)}><div class="mt-2 flex gap-2"><button type="button" disabled={busy()} onClick={() => void respond(item, (item as LegacyInboxItem).direction === 'request' ? 'approve' : 'accept')} class="rounded-[4px] border border-fg bg-fg px-2 py-1 text-xs text-bg">{(item as LegacyInboxItem).direction === 'request' ? 'Approve request' : 'Accept invitation'}</button><button type="button" disabled={busy()} onClick={() => void respond(item, 'dismiss')}>Dismiss</button></div></Show>
        <Show when={(item as LegacyInboxItem).status === 'accepted'}><p role="status" class="mt-2 text-xs text-accent"><Check size={14} class="inline" /> Invitation accepted</p></Show>
      </>}><a href={`/a/${item.artifact_id}`} onClick={() => markRead(item)} class="block break-words text-sm"><For each={('messages' in item ? item.messages : [])}>{message => <span class="block">{message}</span>}</For></a></Show></div>
      <Show when={!item.read_at}><span aria-label="Unread" class="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" /></Show>
    </li>}</For></ul>
    <Show when={!props.compact && inbox.state()?.next != null}><div class="border-t border-edge p-3 text-center"><button onClick={() => void inbox.loadMore()}>Load more</button></div></Show>
  </section>;
}

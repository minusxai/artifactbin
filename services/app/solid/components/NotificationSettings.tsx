/* @jsxImportSource solid-js */
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { useInbox } from '../web/notifications';

type EmailPreferences = { invitations: boolean; comments: boolean; activity: boolean };
const KEYS = ['invitations', 'comments', 'activity'] as const;
const LABELS = { invitations: 'Invitations', comments: 'Unread comment updates', activity: 'Likes and follows' };

export function NotificationSettings(): JSX.Element {
  const inbox = useInbox();
  const [email, setEmail] = createSignal<EmailPreferences | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  onMount(() => { void fetch('/api/my/people/email').then(response => response.ok ? response.json() : null).then((data: { enabled?: boolean; preferences?: EmailPreferences } | null) => { if (data?.enabled && data.preferences) setEmail(data.preferences); }).catch(() => {}); });
  const saveEmail = async (preferences: EmailPreferences) => {
    setSaving(true); setNotice('');
    try { const response = await fetch('/api/my/people/email', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preferences) }); if (!response.ok) throw new Error(); const data = await response.json() as { preferences: EmailPreferences }; setEmail(data.preferences); setNotice('Saved'); }
    catch { setNotice('Could not save email preferences. Try again.'); }
    finally { setSaving(false); }
  };
  return <section id="notifications" aria-label="Notification settings" class="rounded-lg border border-edge bg-surface p-5 font-sans"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-base font-semibold">Notification settings</h2><a href="/notifications" class="text-sm text-muted hover:text-fg">All notifications</a></div><p class="mt-1 text-sm text-muted">Choose how invitations and updates reach you.</p>
    <Show when={inbox.error()}><p role="alert" class="mt-3 text-sm text-danger">{inbox.error()} <button onClick={() => void inbox.load()}>Retry</button></p></Show>
    <Show when={inbox.state()}><div class="mt-5 border-t border-edge pt-4"><h3 class="mb-3 text-sm font-medium">Invitations</h3><label class="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" class="mt-1 accent-accent" checked={inbox.state()?.autoAccept} onChange={event => void inbox.load({ autoAccept: event.currentTarget.checked })} /><span>Automatically accept invitations from people I follow.<span class="mt-1 block text-xs leading-5 text-muted">You can review invitations from everyone else before joining.</span></span></label></div></Show>
    <Show when={email()}><fieldset disabled={saving()} class="mt-5 space-y-3 border-t border-edge pt-4"><legend class="text-sm font-medium">Email notifications</legend><For each={KEYS}>{key => <label class="flex cursor-pointer items-start gap-3 text-sm"><input type="checkbox" class="mt-1 accent-accent" checked={email()?.[key]} onChange={event => void saveEmail({ ...email()!, [key]: event.currentTarget.checked })} /><span>{LABELS[key]}</span></label>}</For></fieldset></Show>
    <Show when={notice()}><p role="status" class="mt-3 text-xs text-muted">{notice()}</p></Show>
    <Show when={inbox.state()?.blocks.length}><div class="mt-5 border-t border-edge pt-4"><h3 class="mb-2 text-sm font-medium">Blocked people</h3><For each={inbox.state()?.blocks}>{block => <div class="flex items-center justify-between py-2"><span class="text-sm">@{block.username ?? block.user_id}</span><button type="button" onClick={() => void inbox.load({ unblock: block.user_id })}>Unblock</button></div>}</For></div></Show>
  </section>;
}

/* @jsxImportSource solid-js */
import { retryingFetch } from '@/lib/http/retry-lazily';
import { createSignal, For, onMount, Show, type JSX } from 'solid-js';
import { useInbox } from '../lib/notifications';
import { InboxAlert } from '../components/PeopleInbox';
import { apiFetch } from '../lib/api';
import { Button } from '../ui/Button';
import { Checkbox } from '../ui/Checkbox';
import { Panel } from '../ui/Panel';
import { StatusMessage } from '../ui/StatusMessage';

type EmailPreferences = { invitations: boolean; comments: boolean; activity: boolean };
const KEYS = ['invitations', 'comments', 'activity'] as const;
const LABELS = { invitations: 'Invitations', comments: 'Unread comment updates', activity: 'Likes and follows' };

export function NotificationSettings(): JSX.Element {
  const inbox = useInbox();
  const [email, setEmail] = createSignal<EmailPreferences | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal('');
  onMount(() => { void retryingFetch('/api/my/people/email').then(response => response.ok ? response.json() : null).then((data: { enabled?: boolean; preferences?: EmailPreferences } | null) => { if (data?.enabled && data.preferences) setEmail(data.preferences); }).catch(() => {}); });
  const saveEmail = async (preferences: EmailPreferences) => {
    setSaving(true); setNotice('');
    try { const response = await apiFetch('/api/my/people/email', 'PATCH', preferences); if (!response.ok) throw new Error(); const data = await response.json() as { preferences: EmailPreferences }; setEmail(data.preferences); setNotice('Saved'); }
    catch { setNotice('Could not save email preferences. Try again.'); }
    finally { setSaving(false); }
  };
  return <div id="notifications"><Panel label="Notification settings" title="Notification settings" actions={<a href="/notifications" class="text-sm text-muted hover:text-fg">All notifications</a>} class="font-sans"><p class="text-sm text-muted">Choose how invitations and updates reach you.</p>
    <InboxAlert class="mt-3" />
    <Show when={inbox.state()}><div class="mt-5 border-t border-edge pt-4"><h3 class="mb-3 text-sm font-medium">Invitations</h3><Checkbox label="Automatically accept invitations from people I follow." description="You can review invitations from everyone else before joining." checked={!!inbox.state()?.autoAccept} onChange={checked => void inbox.load({ autoAccept: checked })} /></div></Show>
    <Show when={email()}><fieldset disabled={saving()} class="mt-5 space-y-3 border-t border-edge pt-4"><legend class="text-sm font-medium">Email notifications</legend><For each={KEYS}>{key => <Checkbox label={LABELS[key]} checked={!!email()?.[key]} onChange={checked => void saveEmail({ ...email()!, [key]: checked })} />}</For></fieldset></Show>
    <Show when={notice()}><StatusMessage kind="notice" class="mt-3">{notice()}</StatusMessage></Show>
    <Show when={inbox.state()?.blocks.length}><div class="mt-5 border-t border-edge pt-4"><h3 class="mb-2 text-sm font-medium">Blocked people</h3><For each={inbox.state()?.blocks}>{block => <div class="flex items-center justify-between py-2"><span class="text-sm">@{block.username ?? block.user_id}</span><Button variant="secondary" type="button" onClick={() => void inbox.load({ unblock: block.user_id })}>Unblock</Button></div>}</For></div></Show>
  </Panel></div>;
}

/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { Settings } from 'lucide-solid';
import { useSession } from '../web/session';
import { PeopleInbox } from '../components/PeopleInbox';

export function NotificationsPage(): JSX.Element {
  const { session } = useSession();
  const runId = new URLSearchParams(window.location.search).get('run');
  return <Show when={!session() || session()?.kind === 'account'} fallback={<Navigate href={`/login?callbackUrl=${encodeURIComponent(`/notifications${runId ? `?run=${encodeURIComponent(runId)}` : ''}`)}`} />}>
    <main class="mx-auto max-w-2xl px-4 py-8 sm:px-6"><div class="mb-5 flex items-center justify-between gap-4"><div><h1 class="text-xl font-semibold">Notifications</h1><p class="mt-1 text-sm text-muted">Invitations, conversations and activity.</p></div><a href="/account#notifications" class="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><Settings size={16} />Settings</a></div>
      <div class="overflow-hidden rounded-lg border border-edge bg-surface"><PeopleInbox /></div>
    </main>
  </Show>;
}

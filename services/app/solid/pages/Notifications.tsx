import WorkspaceHeading from '../components/WorkspaceHeading';
/* @jsxImportSource solid-js */
import { Show, type JSX } from 'solid-js';
import { Navigate } from '@solidjs/router';
import { useSession } from '../lib/session';
import { PeopleInbox } from '../components/PeopleInbox';

export function NotificationsPage(): JSX.Element {
  const { session } = useSession();
  const runId = new URLSearchParams(window.location.search).get('run');
  return <Show when={!session() || session()?.kind === 'account'} fallback={<Navigate href={`/login?callbackUrl=${encodeURIComponent(`/notifications${runId ? `?run=${encodeURIComponent(runId)}` : ''}`)}`} />}>
    <main class="workspace-page"><WorkspaceHeading title="Notifications" description="Invitations, conversations and activity." />
      <div class="overflow-hidden rounded-lg border border-edge bg-surface"><PeopleInbox /></div>
    </main>
  </Show>;
}

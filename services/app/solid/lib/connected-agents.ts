import { createEffect, onCleanup, type Accessor } from 'solid-js';
import type { RemoteSessionInfo } from '../../../contracts/src/remote';
import { usePageData } from './use-page-data';
import { useSession } from './session';

/** The sidebar and agent list agree on which connections are current. */
export const isConnectedAgent = (session: RemoteSessionInfo): boolean =>
  (session.online || !!session.runId && ['queued','starting','stopping'].includes(session.activity ?? '')) && session.exitCode == null;

/** Connection and harness readiness are independent; every agent surface uses this label. */
export function connectedAgentStatus(session: RemoteSessionInfo): string {
  if (session.exitCode != null || session.activity === 'stopped') return 'Ended';
  if (session.activity === 'stopping') return 'Stopping';
  if (session.activity === 'queued') return 'Waiting for capacity';
  if (!session.online) return session.activity === 'starting' ? 'Starting' : 'Offline';
  switch (session.activity) {
    case 'starting': return 'Online · Starting';
    case 'listening': return 'Online · Ready';
    case 'working': return 'Online · Running';
    case 'blocked': return 'Online · Waiting for approval';
    case 'unknown': return 'Online · Waiting for readiness';
    default: return 'Online';
  }
}

/** Shares the agent page's session-scoped resource; its faster poll owns updates while open. */
export function useConnectedAgentCount(agentPageOpen: Accessor<boolean>): Accessor<number | null> {
  const { session } = useSession();
  const enabled = () => session()?.kind === 'account';
  const page = usePageData<{ sessions: RemoteSessionInfo[] }>('/api/remote/sessions', { enabled });
  createEffect(() => {
    if (!enabled()) return;
    const refresh = () => { if (document.visibilityState === 'visible') void page.refresh(); };
    const timer = setInterval(() => { if (!agentPageOpen()) refresh(); }, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    onCleanup(() => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    });
  });
  return () => {
    const sessions = page.data()?.sessions;
    return enabled() && !page.error() && Array.isArray(sessions) ? sessions.filter(isConnectedAgent).length : null;
  };
}

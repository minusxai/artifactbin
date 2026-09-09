import type { AccountWorkspaceCore, AccountWorkspaceInsights } from '@/lib/workspace';
import type { SessionState } from '@/web/session';
import type { ShelfRow } from '@/components/Shelf';

export type HomeCore = ({ signedIn: true; accountId: string } & AccountWorkspaceCore)
  | { signedIn: false; drafts?: ShelfRow[] };
type Insights = AccountWorkspaceInsights & { signedIn: true; accountId: string };
interface Snapshot { core: HomeCore | null; insights: Insights | null; pending: boolean; error: boolean; insightsError: boolean }
const empty = (): Snapshot => ({ core: null, insights: null, pending: false, error: false, insightsError: false });

/** One provider owns one snapshot, not a global cache of private accounts. */
export function createHomeResource() {
  let state = empty(); let identity: string | null = null; let generation = 0;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  let identityReady: (() => void) | null = null;
  const publish = (next: Snapshot) => { state = next; listeners.forEach((fn) => fn()); };
  const reset = () => { generation++; controller?.abort(); controller = null; identityReady?.(); identityReady = null; publish(empty()); };
  const authorized = (data: { signedIn: boolean; accountId?: string }) =>
    data.signedIn ? data.accountId === identity : identity === 'none' || identity === 'anon';
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => state,
    reset,
    sessionFailed() { reset(); publish({ ...empty(), error: true }); },
    identity(session: SessionState | null) {
      const next = session ? (session.user?.id ?? session.kind) : null;
      if (identity !== next) {
        const firstIdentity = identity === null && next !== null;
        identity = next;
        if (!firstIdentity) reset();
        identityReady?.(); identityReady = null;
      }
    },
    async refresh() {
      const run = ++generation; controller?.abort(); controller = new AbortController();
      const signal = controller.signal;
      publish({ ...state, pending: true, error: false, insightsError: false });
      const current = () => generation === run;
      try {
        const response = await fetch('/api/page/home?part=core', { credentials: 'same-origin', signal });
        if (!current()) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) publish(empty());
          throw new Error('workspace unavailable');
        }
        const core = await response.json() as HomeCore;
        if (!identity && current()) await new Promise<void>((resolve) => { identityReady = resolve; });
        if (!current()) return;
        // The authenticated endpoint is authoritative, even if the older
        // chrome/session request still thinks this cookie is signed in.
        if (!core.signedIn) { publish({ ...empty(), core }); return; }
        if (!authorized(core)) { publish({ ...empty(), error: true }); return; }
        publish({ ...state, core, pending: false });
        try {
          const response = await fetch('/api/page/home?part=insights', { credentials: 'same-origin', signal });
          if (!current()) return;
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) { publish({ ...empty(), error: true }); return; }
            throw new Error('insights unavailable');
          }
          const insights = await response.json() as Insights;
          if (!current()) return;
          if (!insights.signedIn || !authorized(insights)) { publish({ ...empty(), error: true }); return; }
          publish({ ...state, insights, insightsError: false });
        } catch { if (current()) publish({ ...state, insightsError: true }); }
      } catch { if (current()) publish({ ...state, pending: false, error: true }); }
    },
  };
}

/* @jsxImportSource solid-js */
/** One live inbox for the bell, panel and notification page. */
import { createContext, createEffect, createSignal, onCleanup, useContext, type Accessor, type JSX } from 'solid-js';
import type { InboxState } from '@/lib/notifications/inbox';
import { useSession } from './session';
import { openLiveStream } from '@/lib/http/live-stream';

interface InboxContext {
  state: Accessor<InboxState | null>;
  error: Accessor<string>;
  load(input?: object): Promise<void>;
  loadMore(): Promise<void>;
}
const Context = createContext<InboxContext>();

export function InboxProvider(props: { children: JSX.Element }): JSX.Element {
  const { session } = useSession();
  const [state, setState] = createSignal<InboxState | null>(null);
  const [error, setError] = createSignal('');
  let generation = 0;
  let limit = 50;
  let lastRead = 0;
  const load = async (input?: object) => {
    const own = session()?.kind === 'account' ? session()?.user?.id : null;
    if (!own) return;
    const seq = ++generation;
    lastRead = Date.now();
    try {
      const response = await fetch('/api/my/people', input ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) } : undefined);
      if (!response.ok) throw new Error('Could not load notifications');
      const result = await response.json() as InboxState;
      if (!Array.isArray(result.notifications) || !Array.isArray(result.blocks)) throw new Error('Could not load notifications');
      while (result.next != null && result.notifications.length < limit) {
        const next = await fetch(`/api/my/people?offset=${result.next}`);
        if (!next.ok) throw new Error('Could not load notifications');
        const page = await next.json() as InboxState;
        result.notifications.push(...page.notifications); result.next = page.next;
      }
      lastRead = Date.now();
      if (seq === generation && session()?.user?.id === own) { setState(result); setError(''); }
    } catch { if (seq === generation) setError('Could not load notifications. Try again.'); }
  };
  // Wakeups (the stream's first frame, focus, visibility) arrive in bursts right after a load: one fresh read covers them.
  const refreshSoon = () => { if (Date.now() - lastRead > 1500) void load(); };
  const loadMore = async () => { limit += 50; await load(); };
  createEffect(() => {
    const user = session()?.kind === 'account' ? session()?.user?.id : null;
    generation++; limit = 50; setState(null); setError('');
    if (!user) return;
    void load();
    if (typeof EventSource === 'undefined') return;
    // Reconnecting with backoff and a heartbeat watchdog (lib/live-stream); its first frame after a reopen re-reads.
    const source = openLiveStream({ url: '/api/my/people/events', onMessage: refreshSoon, onError: () => setError('Connection interrupted. Retrying…') });
    const refresh = () => { if (document.visibilityState === 'visible') refreshSoon(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    onCleanup(() => { source.close(); generation++; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); });
  });
  return <Context.Provider value={{ state, error, load, loadMore }}>{props.children}</Context.Provider>;
}

/** The inbox where the page has one (a document opened outside the app shell has none). */
export function useOptionalInbox(): InboxContext | undefined {
  return useContext(Context);
}

export function useInbox(): InboxContext {
  const value = useContext(Context);
  if (!value) throw new Error('InboxProvider missing');
  return value;
}

/**
 * The session the pages share: one fetch of /api/page/session per mount,
 * exposed by context. Pages that need more fetch their own /api/page/*.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRefreshable } from '@/lib/navigation';
import { createPageDataStore, type PageDataStore } from '@/web/page-data-store';
import { PAGE_DATA_CHANGED } from '@/web/page-data-events';

export interface SessionState {
  user: { id: string; email: string | null } | null;
  kind: 'account' | 'anon' | 'none';
  mixpanel: { token: string | null; host: string };
}

const Ctx = createContext<{ session: SessionState | null; reload: () => void; pages: PageDataStore | null; sessionError: Error | null }>({ session: null, reload: () => {}, pages: null, sessionError: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [nonce, setNonce] = useState(0);
  const [pages] = useState(createPageDataStore);
  const [sessionError, setSessionError] = useState<Error | null>(null);
  const reload = useCallback(() => { pages.setScope(null); pages.clear(); setSession(null); setSessionError(null); setNonce((n) => n + 1); }, [pages]);
  // Something changed who this browser is (a claim, a token adopted): re-read.
  useRefreshable(useCallback(() => { pages.expire(); setNonce((n) => n + 1); }, [pages]));
  useEffect(() => {
    let alive = true;
    void fetch('/api/page/session', { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('session unavailable'); return r.json(); }).then((s: SessionState) => { if (alive) { pages.setScope(s.user?.id ?? s.kind); setSessionError(null); setSession(s); } }).catch(() => { if (alive) { pages.setScope(null); pages.clear(); setSessionError(new Error('Could not load session')); setSession(null); } });
    return () => { alive = false; };
  }, [nonce, pages]);
  useEffect(() => () => pages.clear(), [pages]);
  useEffect(() => { const expire = () => pages.expire(); window.addEventListener(PAGE_DATA_CHANGED, expire); return () => window.removeEventListener(PAGE_DATA_CHANGED, expire); }, [pages]);
  return <Ctx.Provider value={{ session, reload, pages, sessionError }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

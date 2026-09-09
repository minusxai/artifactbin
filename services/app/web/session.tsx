/**
 * The session the pages share: one fetch of /api/page/session per mount,
 * exposed by context. Pages that need more fetch their own /api/page/*.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRefreshable } from '@/lib/navigation';
import { createHomeResource } from '@/web/home-resource';

export interface SessionState {
  user: { id: string; email: string | null } | null;
  kind: 'account' | 'anon' | 'none';
  mixpanel: { token: string | null; host: string };
}

const Ctx = createContext<{ session: SessionState | null; reload: () => void; home: ReturnType<typeof createHomeResource> | null }>({ session: null, reload: () => {}, home: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [nonce, setNonce] = useState(0);
  const [home] = useState(createHomeResource);
  const reload = useCallback(() => { home.identity(null); setSession(null); setNonce((n) => n + 1); }, [home]);
  // Something changed who this browser is (a claim, a token adopted): re-read.
  useRefreshable(useCallback(() => setNonce((n) => n + 1), []));
  useEffect(() => {
    let alive = true;
    void fetch('/api/page/session', { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('session unavailable'); return r.json(); }).then((s: SessionState) => { if (alive) { home.identity(s); setSession(s); } }).catch(() => { if (alive) { home.identity(null); home.sessionFailed(); setSession(null); } });
    return () => { alive = false; };
  }, [nonce, home]);
  useEffect(() => () => home.reset(), [home]);
  return <Ctx.Provider value={{ session, reload, home }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

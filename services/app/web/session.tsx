/**
 * The session the pages share: one fetch of /api/page/session per mount,
 * exposed by context. Pages that need more fetch their own /api/page/*.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRefreshable } from '@/lib/navigation';

export interface SessionState {
  /**
   * The account, when a session names one. `username` is the PUBLIC handle the
   * masthead links to (`/@handle`) and is null only until the lazy backfill
   * assigns one at login — the header falls back to the email for that gap.
   */
  user: { id: string; email: string | null; username: string | null } | null;
  kind: 'account' | 'anon' | 'none';
  stats: { total: number; formats: Record<string, number> } | null;
  mixpanel: { token: string | null; host: string };
}

const Ctx = createContext<{ session: SessionState | null; reload: () => void }>({ session: null, reload: () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [nonce, setNonce] = useState(0);
  // Something changed who this browser is (a claim, a token adopted): re-read.
  useRefreshable(useCallback(() => setNonce((n) => n + 1), []));
  useEffect(() => {
    let alive = true;
    void fetch('/api/page/session', { credentials: 'same-origin' }).then((r) => r.json()).then((s: SessionState) => { if (alive) setSession(s); }).catch(() => null);
    return () => { alive = false; };
  }, [nonce]);
  return <Ctx.Provider value={{ session, reload: () => setNonce((n) => n + 1) }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

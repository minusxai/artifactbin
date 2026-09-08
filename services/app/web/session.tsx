/**
 * The session the pages share: one fetch of /api/page/session per mount,
 * exposed by context. Pages that need more fetch their own /api/page/*.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRefreshable } from '@/lib/navigation';
import {pageBootstrap,invalidateBootstrap,validSession} from './bootstrap';
import {pageJson} from './page-data';

export interface SessionState {
  user: { id: string; email: string | null } | null;
  kind: 'account' | 'anon' | 'none';
  mixpanel: { token: string | null; host: string };
}

/** Credential-changing UI awaits this before navigating; failures stay unresolved. */
export interface SessionContext {
  session: SessionState | null;
  error: string | null;
  reload: () => Promise<boolean>;
  refreshAuth: () => Promise<boolean>;
}
const Ctx = createContext<SessionContext>({session:null,error:null,reload:async()=>true,refreshAuth:async()=>true});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState | null>(() => pageBootstrap(window.location.pathname)?.session ?? null);
  const [error,setError] = useState<string|null>(null);
  const initial = useRef(session);
  const request = useRef<AbortController|null>(null);
  const reload = useCallback(async (): Promise<boolean> => {
    invalidateBootstrap();
    request.current?.abort();
    const pending = new AbortController();request.current=pending;setError(null);
    try {
      const next = await pageJson<SessionState>('/api/page/session',pending.signal);
      if (!validSession(next)) throw new Error('Could not verify your session. Please retry.');
      if (pending.signal.aborted) return false;
      setSession(next);return true;
    } catch (cause) {
      if (!pending.signal.aborted) {setSession(null);setError(cause instanceof Error ? cause.message : 'Could not verify your session. Please retry.');}
      return false;
    }
  }, []);
  const refreshAuth = useCallback(async () => {setSession(null);return reload();},[reload]);
  useRefreshable(useCallback(()=>{void reload();},[reload]));
  useEffect(() => {
    if (!initial.current) void reload();
    return () => { request.current?.abort(); };
  }, [reload]);
  return <Ctx.Provider value={{session,error,reload,refreshAuth}}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

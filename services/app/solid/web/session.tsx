/* @jsxImportSource solid-js */
/**
 * The Solid twin of web/session.tsx: one fetch of /api/page/session per mount, exposed by context,
 * with the same page-data store (web/page-data-store, unchanged) and the same window events.
 *
 * The difference a port must carry: React's context VALUE is re-read on every render, so a
 * `session` field there is always current. A Solid context value is read once by each consumer, so
 * the changing parts are ACCESSORS (`session()`, `sessionError()`); `pages` never changes per
 * provider and stays a plain value.
 */
import { createContext, createEffect, createSignal, on, onCleanup, useContext, type Accessor, type JSX } from 'solid-js';
import { createPageDataStore, type PageDataStore } from '@/web/page-data-store';
import { PAGE_DATA_CHANGED, PROFILE_CHANGED } from '@/web/page-data-events';
import { REFRESH_EVENT } from '../shared/page-data';

export interface SessionState {
  user: { id: string; email: string | null; username: string | null; image: string | null } | null;
  kind: 'account' | 'anon' | 'none';
  onboarded: boolean;
}

export interface SessionContext {
  session: Accessor<SessionState | null>;
  reload: () => void;
  pages: PageDataStore | null;
  sessionError: Accessor<Error | null>;
}

const Ctx = createContext<SessionContext>({ session: () => null, reload: () => {}, pages: null, sessionError: () => null });

/** `window.addEventListener` for the owner's lifetime. */
export function listen(type: string, handler: () => void): void {
  window.addEventListener(type, handler);
  onCleanup(() => window.removeEventListener(type, handler));
}

export function SessionProvider(props: { children: JSX.Element }): JSX.Element {
  const [session, setSession] = createSignal<SessionState | null>(null);
  const [sessionError, setSessionError] = createSignal<Error | null>(null);
  const [nonce, setNonce] = createSignal(0);
  const pages = createPageDataStore();
  const reload = () => { pages.setScope(null); pages.clear(); setSession(null); setSessionError(null); setNonce((n) => n + 1); };
  createEffect(on(nonce, () => {
    let alive = true;
    void fetch('/api/page/session', { credentials: 'same-origin' })
      .then((r) => { if (!r.ok) throw new Error('session unavailable'); return r.json(); })
      .then((s: SessionState) => { if (alive) { pages.setScope(s.user?.id ?? s.kind); setSessionError(null); setSession(s); } })
      .catch(() => { if (alive) { pages.setScope(null); pages.clear(); setSessionError(new Error('Could not load session')); setSession(null); } });
    onCleanup(() => { alive = false; });
  }));
  onCleanup(() => pages.clear());
  listen(REFRESH_EVENT, () => { pages.expire(); setNonce((n) => n + 1); });
  listen(PAGE_DATA_CHANGED, () => pages.expire());
  listen(PROFILE_CHANGED, () => { pages.expire(); setNonce((n) => n + 1); });
  return <Ctx.Provider value={{ session, reload, pages, sessionError }}>{props.children}</Ctx.Provider>;
}

export const useSession = (): SessionContext => useContext(Ctx);

/* @jsxImportSource solid-js */
/**
 * The session context: one fetch of /api/page/session per mount, with the page-data store
 * (solid/lib/page-data-store) and the window events that expire it.
 *
 * A Solid context value is read once by each consumer, so the changing parts are ACCESSORS
 * (`session()`, `sessionError()`); `pages` never changes per provider and stays a plain value.
 */
import { createContext, createEffect, createSignal, on, onCleanup, useContext, type Accessor, type JSX } from 'solid-js';
import { createPageDataStore, type PageDataStore } from '@/solid/lib/page-data-store';
import { PAGE_DATA_CHANGED, PROFILE_CHANGED, REFRESH_EVENT } from '@/solid/lib/page-data-events';

interface SessionState {
  user: { id: string; email: string | null; username: string | null; image: string | null } | null;
  kind: 'account' | 'none';
  onboarded: boolean;
}

interface SessionContext {
  session: Accessor<SessionState | null>;
  reload: () => void;
  pages: PageDataStore | null;
  sessionError: Accessor<Error | null>;
}

const Ctx = createContext<SessionContext>({ session: () => null, reload: () => {}, pages: null, sessionError: () => null });

/** `window.addEventListener` for the owner's lifetime. */
function listen(type: string, handler: () => void): void {
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
  // A history restore resumes this provider without remounting it. Data may have
  // changed while the page was frozen (for example, a newly created artifact).
  const restore = (event: PageTransitionEvent) => { if (event.persisted) window.dispatchEvent(new Event(REFRESH_EVENT)); };
  window.addEventListener('pageshow', restore);
  onCleanup(() => window.removeEventListener('pageshow', restore));
  return <Ctx.Provider value={{ session, reload, pages, sessionError }}>{props.children}</Ctx.Provider>;
}

export const useSession = (): SessionContext => useContext(Ctx);

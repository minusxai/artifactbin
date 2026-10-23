/* @jsxImportSource solid-js */
/** One live inbox for the bell, panel and notification page. */
import { createContext, createEffect, createSignal, getOwner, onCleanup, runWithOwner, useContext, type Accessor, type JSX } from 'solid-js';
import type { InboxState } from '@/lib/notifications/inbox';
import { useSession } from './session';

export interface InboxContext {
  state: Accessor<InboxState | null>;
  /** Why the last read or write failed; already-loaded notifications stay in `state`. */
  error: Accessor<string>;
  /** When that failure happened (ms), so a failed retry reads as a fresh attempt. */
  failedAt: Accessor<number | null>;
  /** A read or write is in flight. */
  loading: Accessor<boolean>;
  /** The live stream dropped and is reconnecting; never an error over good content. */
  reconnecting: Accessor<boolean>;
  load(input?: object): Promise<void>;
  loadMore(): Promise<void>;
}
const Context = createContext<InboxContext>();
/** The context remains mounted while its account-only implementation loads. */
export type InboxControllerLoader = () => Promise<{createInboxController(owner: Accessor<string | null>): InboxContext}>;
const loadInbox: InboxControllerLoader = () => import('./create-inbox');
export function InboxProvider(props: { children: JSX.Element; loadController?: InboxControllerLoader }): JSX.Element {
  const {session} = useSession();
  const ownerId = () => session()?.kind === 'account' ? session()?.user?.id ?? null : null;
  const owner = getOwner();
  const [controller,setController] = createSignal<InboxContext | null>(null);
  const [loadError,setLoadError] = createSignal('');
  let pending: Promise<InboxContext | null> | undefined;
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const ensure = () => pending ??= (props.loadController ?? loadInbox)().then(module => {
    if (disposed) return null;
    const next = runWithOwner(owner, () => module.createInboxController(ownerId))!;
    setLoadError('');
    setController(next);
    return next;
  }).catch(() => { pending = undefined; if(!disposed) setLoadError('Could not load notifications. Try again.'); return null; });
  createEffect(() => { if(ownerId()) void ensure(); });
  const value: InboxContext = {
    state: () => controller()?.state() ?? null,
    error: () => controller()?.error() ?? loadError(),
    failedAt: () => controller()?.failedAt() ?? null,
    loading: () => controller()?.loading() ?? false,
    reconnecting: () => controller()?.reconnecting() ?? false,
    load: input => { if(!ownerId())return Promise.resolve(); const current=controller(); return current ? current.load(input) : ensure().then(next=>next?.load(input)); },
    loadMore: () => { if(!ownerId())return Promise.resolve(); const current=controller(); return current ? current.loadMore() : ensure().then(next=>next?.loadMore()); },
  };
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
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

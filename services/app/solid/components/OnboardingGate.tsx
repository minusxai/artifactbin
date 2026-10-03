/* @jsxImportSource solid-js */
import { createMemo, createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { Navigate, useLocation } from '@solidjs/router';
import { readIntent } from '@/lib/http/intent';
import { useSession } from '../lib/session';

const EXEMPT = new Set(['/welcome', '/login', '/start']);

/**
 * True once the page the reader asked for has finished loading, a task after its `load` event: a document's app page
 * is still loading its frame when the session answers, and onboarding takes over from the arrived page, never from
 * one torn down mid-load (a fork lands on its copy, then meets the welcome page).
 */
function pageArrived(): () => boolean {
  const [arrived, setArrived] = createSignal(document.readyState === 'complete');
  if (!arrived()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onLoad = () => { timer = setTimeout(() => setArrived(true), 0); };
    window.addEventListener('load', onLoad, { once: true });
    onCleanup(() => { window.removeEventListener('load', onLoad); clearTimeout(timer); });
  }
  return arrived;
}

/** A pending document instruction keeps its route until the user leaves it. */
export function OnboardingGate(props: { children: JSX.Element }): JSX.Element {
  const { session } = useSession();
  const location = useLocation();
  const arrived = pageArrived();
  let carryingOut: string | null = null;
  const destination = createMemo(() => {
    const pathname = location.pathname;
    const search = location.search;
    const hash = location.hash;
    const current = session();
    if (readIntent(search)) carryingOut = pathname;
    else if (carryingOut !== pathname) carryingOut = null;
    const path = pathname.replace(/\/+$/, '') || '/';
    if (!current?.user || current.onboarded !== false || EXEMPT.has(path) || carryingOut === pathname || !arrived()) return null;
    return `/welcome?callbackUrl=${encodeURIComponent(`${pathname}${search}${hash}`)}`;
  });
  return <Show when={!destination()} fallback={<Navigate href={destination()!} />}>{props.children}</Show>;
}

/* @jsxImportSource solid-js */
import { createMemo, Show, type JSX } from 'solid-js';
import { Navigate, useLocation } from '@solidjs/router';
import { readIntent } from '@/lib/intent';
import { useSession } from '../lib/session';

const EXEMPT = new Set(['/welcome', '/login', '/start']);

/** A pending document instruction keeps its route until the user leaves it. */
export function OnboardingGate(props: { children: JSX.Element }): JSX.Element {
  const { session } = useSession();
  const location = useLocation();
  let carryingOut: string | null = null;
  const destination = createMemo(() => {
    const pathname = location.pathname;
    const search = location.search;
    const hash = location.hash;
    const current = session();
    if (readIntent(search)) carryingOut = pathname;
    else if (carryingOut !== pathname) carryingOut = null;
    const path = pathname.replace(/\/+$/, '') || '/';
    if (!current?.user || current.onboarded !== false || EXEMPT.has(path) || carryingOut === pathname) return null;
    return `/welcome?callbackUrl=${encodeURIComponent(`${pathname}${search}${hash}`)}`;
  });
  return <Show when={!destination()} fallback={<Navigate href={destination()!} />}>{props.children}</Show>;
}

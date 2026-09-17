/**
 * The address of /login that comes back to where the person was: path, query
 * and hash. The query is carried byte for byte because a document's own `$`
 * selections live in it (`lib/intent` explains why), and `lib/safe-redirect`
 * is what admits the target on the way back.
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { withIntent, type Intent } from '@/lib/intent';

type Address = { pathname: string; search: string; hash: string };

export function loginHref(at: Address, intent?: Intent): string {
  if (!intent && (at.pathname === '/' || at.pathname === '/login')) return '/login';
  const search = intent ? withIntent(at.search, intent) : at.search;
  return `/login?callbackUrl=${encodeURIComponent(at.pathname + search + at.hash)}`;
}

/**
 * For a link that may be server rendered: the bare /login until mounted, then
 * this address — and read again on click, since a document rewrites its own
 * query as the reader makes selections.
 */
export function useLoginHref(intent?: Intent): { href: string; onClick: (event: MouseEvent<HTMLAnchorElement>) => void } {
  const [href, setHref] = useState('/login');
  useEffect(() => { setHref(loginHref(window.location, intent)); }, [intent]);
  return { href, onClick: (event) => { event.currentTarget.href = loginHref(window.location, intent); } };
}

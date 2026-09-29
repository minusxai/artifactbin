/**
 * SPLIT from lib/login-href.ts (probe): `loginHref` is framework-free, but its module imports React
 * for `useLoginHref`. The Solid half of the hook lives beside the one page that uses it.
 */
import { withIntent, type Intent } from '@/lib/intent';

type Address = { pathname: string; search: string; hash: string };

export function loginHref(at: Address, intent?: Intent): string {
  if (!intent && (at.pathname === '/' || at.pathname === '/login')) return '/login';
  const search = intent ? withIntent(at.search, intent) : at.search;
  return `/login?callbackUrl=${encodeURIComponent(at.pathname + search + at.hash)}`;
}

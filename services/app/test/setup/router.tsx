/**
 * The app's components navigate (lib/navigation over react-router), so a test
 * that renders one needs a router in scope. Rather than wrap every render,
 * the ui project stubs the three hooks the components use — the same three
 * `next/navigation` gave them — with a recording double a test can read.
 */
import { vi } from 'vitest';

export const router = { pushed: [] as string[], replaced: [] as string[], refreshed: 0, path: '/', search: new URLSearchParams() };

export function resetRouter(): void {
  router.pushed = []; router.replaced = []; router.refreshed = 0; router.path = '/'; router.search = new URLSearchParams();
}

vi.mock('@/lib/navigation', async (importOriginal) => ({
  // Only the ROUTER hooks are stubbed; the refresh plumbing is the app's own
  // and must keep working (a page that stops re-reading is a page that shows
  // stale data, which is exactly what these tests are for).
  ...(await importOriginal<typeof import('@/lib/navigation')>()),
  useRouter: () => ({
    push: (to: string) => router.pushed.push(to),
    replace: (to: string) => router.replaced.push(to),
    back: () => {},
    refresh: () => { router.refreshed += 1; },
  }),
  usePathname: () => router.path,
  useSearchParams: () => router.search,
}));

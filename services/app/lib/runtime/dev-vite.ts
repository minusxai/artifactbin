import path from 'node:path';
/** Development-only Vite settings for the app's web root. */
export function developmentViteOptions(appRoot: string, port: number) {
  return { cacheDir: path.join(appRoot, 'node_modules/.vite', `dev-${port}`), optimizeDeps: { entries: ['solid-entry.tsx', 'solid-spa-idle.ts'] } };
}

/**
 * Every document on its own origin in development (APP__PAGES_HOST, CONTRIBUTING.md): Vite fronts the
 * listener, and its DNS-rebinding guard answers only hosts it knows, so it is told the pages domain (its
 * apex and every document label) and the app's own host; its own CORS headers stay off, because the app's
 * origin gate (server/pages-host) decides who may call what. Unset: nothing changes.
 */
export function developmentPagesHosts(pagesHost: string | null, publicBaseUrl: string): { allowedHosts?: string[]; cors?: false } {
  if (!pagesHost) return {};
  return { allowedHosts: [`.${pagesHost}`, new URL(publicBaseUrl).hostname], cors: false };
}

import path from 'node:path';

/**
 * DEVELOPMENT VITE, in middleware mode in front of the listener (server.ts): it serves the SPA's modules, HMR and
 * the index transform, and calls next() for everything else.
 * - Its HMR socket defaults to 24678 for every project on the machine, and its optimized dependencies to one cache
 *   directory: both derive from our own port, so two checkouts never fight over them.
 * - Every document is on its own origin in development (APP__PAGES_HOST, SETUP.md), and Vite's DNS-rebinding guard
 *   answers only hosts it knows, so it is told the pages domain (its apex and every document label) and the app's own
 *   host; its own CORS headers stay off, because the app's origin gate (server/pages-host) decides who may call what.
 * - It pre-bundles what the SPA imports; the server-only trees (vega, sqlite-wasm, playwright, PGLite) are the app's,
 *   never the browser's.
 */
export function developmentViteConfig(o: { configFile: string; appRoot: string; port: number; hmrPort: number; pagesHost: string; publicBaseUrl: string }) {
  return {
    configFile: o.configFile,
    server: { middlewareMode: true, ws: { port: o.hmrPort }, allowedHosts: [`.${o.pagesHost}`, new URL(o.publicBaseUrl).hostname], cors: false as const },
    appType: 'custom' as const,
    cacheDir: path.join(o.appRoot, 'node_modules/.vite', `dev-${o.port}`),
    optimizeDeps: { entries: ['solid-entry.tsx'] },
  };
}

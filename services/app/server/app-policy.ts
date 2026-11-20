/**
 * THE APP PAGES' POLICY: one strict Content-Security-Policy for every app page, where no document ever runs.
 * `appPagePolicyAt(url, o)` is the policy the app page at that address carries, built in one pass: the pages origins
 * it frames (`pagesFrameSources`), who may frame it (the app alone; `/local/connect` its local hosts; a document's
 * address also EMBED__TRUSTED_ORIGINS, its embedded view those ONLY; a custom shell's embedded chat also those), and in
 * development Vite's socket. `appPagePolicy(site)` is the production policy of an ordinary app page; `APP_CSP` the policy
 * before any pages origin is named; `APP_SECURITY_HEADERS` the other headers every app page carries.
 */
import { ASSETS_ORIGIN, embedTrustedOrigins } from '@/lib/platform';
import { THEME_BOOTSTRAP_HASH } from '@/lib/page-styles';
import type { PagesSite } from '@/lib/http';

// Inline scripts emitted by our source HTML. Keeping the hashes explicit preserves the production policy.
export const APP_INLINE_SCRIPT_HASHES = [
  THEME_BOOTSTRAP_HASH, // theme bootstrap (web/solid-app.html — lib/page-styles/theme-bootstrap, pinned by lib/__tests__/app-page-csp)
].join(' ');

/**
 * `frames` are the pages origins (APP__PAGES_HOST) the app page frames documents on — every document label under the
 * pages host, and nothing else (the apex is not a document and is never framed). `ancestors` may frame the page;
 * `socket` is development's Vite socket.
 */
function appCsp({ frames = [], ancestors = ["'self'"], socket }: { frames?: readonly string[]; ancestors?: readonly string[]; socket?: string } = {}): string {
  return [
    // 'wasm-unsafe-eval' lets the page COMPILE WebAssembly — the SQLite engine a
    // reader's document runs its queries on (lib/islands/page-sqlite) —
    // and nothing else: no eval, no Function, no string timers.
    "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' ${APP_INLINE_SCRIPT_HASHES}`, "style-src 'self' 'unsafe-inline'",
    // Listing thumbnails redirect from /a/:id/export to the configured asset
    // origin. Admit that destination for images; local posters remain same-origin.
    `img-src 'self' data: blob:${ASSETS_ORIGIN ? ` ${ASSETS_ORIGIN}` : ''}`,
    "font-src 'self' data:",
    // `media-src` has no default of its own either, so without this line every
    // <video> and <audio> on an app page is refused by `default-src 'none'`.
    // `'self'` is a stored file played back from /a/<id>/raw; `blob:` is the
    // upload page previewing a file BEFORE it is sent (web/pages/FileUpload).
    // GLTFLoader also fetches embedded textures through local blob URLs.
    // Frame and worker policies stay same-origin; blobs are data here.
    "media-src 'self' blob:",
    ['connect-src', "'self'", ...(socket ? [socket] : []), 'blob:'].join(' '),
    "manifest-src 'self'", ['frame-src', "'self'", ...frames].join(' '), ['frame-ancestors', ...ancestors].join(' '),
    // `worker-src` has no default of its own: it falls back through `child-src`
    // to `default-src 'none'`, so a worker would be refused by a directive nobody
    // wrote, silently. The one worker the product starts — MapLibre's, for a
    // `<DeckGL>` street basemap — is a same-origin module script
    // (/basemap/worker.mjs, app/basemap), and Vite emits workers as same-origin
    // assets, so `'self'` is the whole permission — NOT `blob:`, which would
    // reopen script-from-a-string.
    "worker-src 'self'",
    "form-action 'self'", "object-src 'none'", "base-uri 'self'",
  ].join('; ');
}
/** The strict app policy, before the pages origins it frames are named (pagesFrameSources). */
export const APP_CSP = appCsp();
/** The policy every app page carries on a deployment whose documents are served under `site` (production adds no more). */
export const appPagePolicy = (site: PagesSite): string => appCsp({ frames: pagesFrameSources(site) });
/** The pages origins an app page may frame (lib/http/pages-origin): every document label under the pages host. */
export function pagesFrameSources(site: PagesSite): string[] {
  const port = site.port ? `:${site.port}` : '';
  return [`${site.scheme}//*.${site.host}${port}`];
}

/**
 * Who may frame the app page at `url`: the app alone; `/local/connect` its local hosts; a document's address (`/a/<id>`,
 * its `/app/` form) also the deployment's trusted embedders (EMBED__TRUSTED_ORIGINS, empty by default); and that
 * address's EMBEDDED view (`?embed=1`, the page without the app's bar, solid/lib/embedded) the trusted embedders
 * ONLY, no one when there are none, so the bar can be hidden only inside a frame they draw. A custom shell's EMBEDDED
 * chat (`/conversations?embed=1`, `shell`: the shell draws the chat alone there) may also be framed by the trusted
 * embedders, beside the app itself; every other screen keeps the app alone.
 */
function ancestorsAt(url: URL, shell: boolean): readonly string[] {
  if (url.pathname === '/local/connect') return ['file:', 'http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'];
  const embedded = url.searchParams.get('embed') === '1';
  if (/^\/a\/[^/]+(?:\/app)?\/?$/.test(url.pathname)) {
    const embedders = embedTrustedOrigins();
    return embedded ? (embedders.length ? embedders : ["'none'"]) : ["'self'", ...embedders];
  }
  return shell && embedded && /^\/conversations\/?$/.test(url.pathname) ? ["'self'", ...embedTrustedOrigins()] : ["'self'"];
}

/**
 * The policy the app page (or, `shell`, the custom shell's screen) at `url` carries. Only the development socket joins
 * connect-src; production uses the policy unchanged. The socket is on the host the page was addressed by (`pageOrigin`:
 * forwarded host and protocol first), because Vite's client dials the host its module loaded from: a server-browser
 * session reaches this process over loopback and names the public host it browsed in `x-forwarded-host`.
 */
export function appPagePolicyAt(url: URL, o: { site: PagesSite; pageOrigin: string; devHmrPort?: number; shell?: boolean }): string {
  let socket: string | undefined;
  if (o.devHmrPort !== undefined) {
    const at = new URL(o.pageOrigin);
    at.protocol = at.protocol === 'https:' ? 'wss:' : 'ws:';
    at.port = String(o.devHmrPort);
    socket = at.origin;
  }
  return appCsp({ frames: pagesFrameSources(o.site), ancestors: ancestorsAt(url, o.shell ?? false), socket });
}

export const APP_SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/**
 * A CUSTOM SHELL (`APP__SHELL_FILE`, off by default): one HTML file the operator supplies, served in place of the
 * app's own screens, so a deployment can put its own face on Artifactbin and route client-side (deep links and
 * reloads land on the same file). With the setting unset nothing here runs and every response is as before.
 *
 * WHAT THE FILE ANSWERS (server/app): every GET or HEAD the app would otherwise answer with one of its own screens:
 * `/`, `/docs-human`, `/getting-started`, `/local/publish`, every static app page (lib/http/app-pages) and every
 * address nothing else serves (the app's 404 page). Always 200: the file draws its own not-found.
 *
 * WHAT STAYS ARTIFACTBIN'S, unchanged:
 *  - the API (`/api/*`, including sign-in `/api/auth/*`, the token endpoints and every refusal JSON), OAuth and
 *    discovery (`/oauth/*`, `/.well-known/*`, the consent page), `/llms*`, `/skills/*`, and every static or built
 *    asset tree (`/assets`, `/islands`, `/libraries`, `/fonts`, `/geojson`, the public directory);
 *  - the identity screens: `/login` (sign-in, and where sign-in sends a signed-out caller) and `/welcome` (the
 *    first sign-in's handle step), drawn by the app as today. Sign-out is the API (`POST /api/auth/sign-out`);
 *  - document serving: `/a/<id>` and everything under `/a/`, the `/@handle` profile and its pretty document
 *    addresses, and `/local/connect` (the local-file broker): shared links, exports and captures keep working;
 *  - every other host (pages origins, user pages hosts, the assets origin): their boundaries answer first.
 * The app's other screens (home, account, groups, trash, new-file pages) are not reachable at all: there is no
 * second prefix for them.
 *
 * POSTURE: the app page's own CSP (script, style, connect and frame sources `'self'`, frame-ancestors `'self'`),
 * its security headers and `cache-control: no-store`, so the file loads the app's modules and stylesheets and calls
 * the JSON API same-origin with the session cookie. The one substitution: every `__CSP_NONCE__` in the file becomes a
 * fresh nonce per response, admitted by `script-src` (inline style is already allowed); a file without it gets the
 * policy unchanged. Nothing else is templated. Documents still run only on their own origin and trust the app's.
 * Read once at boot: a missing or unreadable file stops the boot, naming the setting.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The placeholder replaced with the response's CSP nonce. */
const SHELL_NONCE_PLACEHOLDER = '__CSP_NONCE__';
/** The app screens a custom shell leaves to Artifactbin: sign-in and the first sign-in's handle step. */
const IDENTITY_SCREENS: ReadonlySet<string> = new Set(['/login', '/welcome']);

/** Does the app keep this address, which would otherwise fall through to the custom shell (the list above)? */
export const keptFromShell = (pathname: string): boolean =>
  IDENTITY_SCREENS.has(pathname) || pathname === '/a' || pathname.startsWith('/a/') || pathname.startsWith('/@') || pathname === '/local/connect';

export interface CustomShell { html: string; nonced: boolean }

/** The operator's file, read now; throws naming APP__SHELL_FILE when it cannot be. */
export function loadCustomShell(file: string): CustomShell {
  let html: string;
  try { html = readFileSync(file, 'utf8'); } catch (error) {
    throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'}): set it to an HTML file this process can read, or unset it.`);
  }
  if (!html.trim()) throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} is empty.`);
  return { html, nonced: html.includes(SHELL_NONCE_PLACEHOLDER) };
}

/** The shell's response under `csp` (the app page's policy) and `headers` (the app page's security headers). */
export function customShellResponse(shell: CustomShell, method: string, csp: string, headers: Record<string, string>): Response {
  const nonce = shell.nonced ? randomBytes(16).toString('base64') : null;
  const body = nonce ? shell.html.replaceAll(SHELL_NONCE_PLACEHOLDER, nonce) : shell.html;
  const policy = nonce ? csp.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`) : csp;
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers, 'content-security-policy': policy,
  } });
}

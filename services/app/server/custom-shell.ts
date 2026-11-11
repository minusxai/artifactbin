/**
 * A CUSTOM SHELL (`APP__SHELL_FILE`, off by default): one HTML file the operator supplies, served in place of the
 * app's own screens, so a deployment can put its own face on Artifactbin and route client-side (deep links and
 * reloads land on the same file). With the setting unset nothing here runs and every response is as before.
 *
 * WHAT THE FILE ANSWERS (server/app, `shellAnswers`): every GET or HEAD for a SCREEN, always 200 (the file decides
 * what to show and what is not found):
 *  - `/` and every app screen (home, account, groups, group settings, trash, new-file pages, `/docs-human`,
 *    `/getting-started`, `/local/publish`) and every address nothing else serves;
 *  - the page and handle screens: `/a/<id>`, `/a/<id>/edit`, `/@<handle>` and `/@<handle>/<slug…>`. The file shows a
 *    document itself (the hosted host module, `/af/host.js`) from the JSON doors: `GET /api/page/profile/@<handle>/
 *    <path>` resolves a pretty address (`{kind: "artifact", id}`, `{kind: "redirect", to}`, a profile, or 404),
 *    `GET /api/page/artifact/<id>` is the access decision (404 for a reader who may not read it) with the title and
 *    description, and `GET /api/page/frame/<id>` the frame's first URL with its one-time ticket.
 *
 * WHAT STAYS ARTIFACTBIN'S, unchanged:
 *  - the API (`/api/*`, including sign-in `/api/auth/*`, the token endpoints and every refusal JSON), OAuth and
 *    discovery (`/oauth/*`, `/.well-known/*`, the consent page), `/llms*`, `/skills/*`, `/af/*`, and every static or
 *    built asset tree (`/assets`, `/islands`, `/libraries`, `/fonts`, `/geojson`, the public directory);
 *  - the identity screens `/login` and `/welcome`, the agent handoff and create door `/start`, and `/local/connect`
 *    (the local-file broker). Sign-out is the API (`POST /api/auth/sign-out`);
 *  - everything that is data or files under a page: `/a/<id>/{raw,story,export,download,assets,resolve,fetch,query,
 *    mutate,events,events/frame,events/authorize,css,tables,datasets/…}`, any other address under `/a/<id>/`, and a
 *    page address carrying an export key (`?key=`: the exporter photographs the app's own page);
 *  - the installed-app identity `/a/<id>/app/` and everything under it: its page carries the app's manifest and icons,
 *    which a shell cannot name for it;
 *  - every other host (pages origins, user pages hosts, the assets origin): their boundaries answer first.
 * The app's other screens are not reachable at all: there is no second prefix for them.
 *
 * POSTURE: the policy the app page at that address would carry (the app CSP: script, style, connect and frame sources
 * `'self'`; frame-ancestors `'self'`, or a document address's trusted embedders), its security headers,
 * `cache-control: no-store`, and `Link: <origin/llms.txt>; rel="help"` (the agent pointer the app page carries in its
 * head). Two placeholders, nothing else is templated:
 *  - every `__CSP_NONCE__` becomes a fresh nonce per response, admitted by `script-src` (inline style is already
 *    allowed); a file without it gets the policy unchanged;
 *  - `__HEAD_TAGS__` becomes, on a document screen whose document an ANONYMOUS reader may read, that document's own
 *    `<title>`, description, Open Graph card and canonical link (what a link-preview bot fetching it would see on
 *    the app page), and nothing otherwise. A shell without it carries no per-document head: no social preview.
 * Read once at boot: a missing or unreadable file stops the boot, naming the setting.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const NONCE_PLACEHOLDER = '__CSP_NONCE__';
const HEAD_PLACEHOLDER = '__HEAD_TAGS__';
/** Screens the app keeps: sign-in, the first sign-in's handle step, the agent handoff, the local-file broker. */
const KEPT: ReadonlySet<string> = new Set(['/login', '/welcome', '/start', '/local/connect']);
/** A page's own screen and its editor; every other address under `/a/` is a door, a file or the installed app. */
const PAGE_SCREEN = /^\/a\/[^/]+(?:\/edit)?\/?$/;

/** Is this GET a screen the custom shell answers (the table above), rather than one the app keeps? */
export function shellAnswers(url: URL): boolean {
  const path = url.pathname;
  if (KEPT.has(path)) return false;
  if (path === '/a' || path.startsWith('/a/')) return PAGE_SCREEN.test(path) && !url.searchParams.has('key');
  return true;
}

/** A screen that names one document (`__HEAD_TAGS__` is filled there): a page address or a pretty one. */
export const namesDocument = (url: URL): boolean => PAGE_SCREEN.test(url.pathname) || /^\/@[^/]+\/./.test(url.pathname);

export interface CustomShell { html: string; nonced: boolean; headed: boolean }

/** The operator's file, read now; throws naming APP__SHELL_FILE when it cannot be. */
export function loadCustomShell(file: string): CustomShell {
  let html: string;
  try { html = readFileSync(file, 'utf8'); } catch (error) {
    throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'}): set it to an HTML file this process can read, or unset it.`);
  }
  if (!html.trim()) throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} is empty.`);
  return { html, nonced: html.includes(NONCE_PLACEHOLDER), headed: html.includes(HEAD_PLACEHOLDER) };
}

/**
 * The shell's response under `csp` (the app page's policy at this address), `headers` (its security headers and agent
 * pointer) and `headTags` (the document's anonymous head, or nothing).
 */
export function customShellResponse(shell: CustomShell, method: string, csp: string, headers: Record<string, string>, headTags = ''): Response {
  const nonce = shell.nonced ? randomBytes(16).toString('base64') : null;
  let body = nonce ? shell.html.replaceAll(NONCE_PLACEHOLDER, nonce) : shell.html;
  // A function replacement: a title's `$&` stays literal.
  if (shell.headed) body = body.replaceAll(HEAD_PLACEHOLDER, () => headTags);
  const policy = nonce ? csp.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`) : csp;
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers, 'content-security-policy': policy,
  } });
}

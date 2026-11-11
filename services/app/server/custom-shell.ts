/**
 * A CUSTOM SHELL (`APP__SHELL_FILE`, off by default): one HTML file the operator supplies, served in place of the
 * app's own screens, so a deployment can put its own face on Artifactbin and route client-side (deep links and
 * reloads land on the same file). With the setting unset nothing here runs and every response is as before.
 *
 * WHAT THE FILE ANSWERS (server/app, `shellAnswers`): every GET or HEAD for an address the URL map calls a SCREEN
 * (contracts url-space `isScreenPath`, also published at `/af/url-space.json`), always 200 (the file decides what to
 * show and what is not found):
 *  - `/` and every app screen (home, account, groups, group settings, trash, new-file pages, `/docs-human`,
 *    `/getting-started`, `/local/publish`) and every address nothing else serves;
 *  - the page and handle screens: `/a/<id>`, `/a/<id>/edit`, `/@<handle>` and `/@<handle>/<slug…>`. The file shows a
 *    document itself (the hosted host module, `/af/host.js`) from the JSON doors: `GET /api/page/profile/@<handle>/
 *    <path>` resolves a pretty address (`{kind: "artifact", id}`, `{kind: "redirect", to}`, a profile, or 404),
 *    `GET /api/page/artifact/<id>` is the access decision (404 for a reader who may not read it) with the title and
 *    description, and `GET /api/page/frame/<id>` the frame's first URL with its one-time ticket.
 *
 * WHAT STAYS ARTIFACTBIN'S, unchanged: everything the map does not call a screen —
 *  - the API (`/api/*`, including sign-in `/api/auth/*`, the token endpoints and every refusal JSON), `/af/*`, the old
 *    addresses (the map's `legacy`), and every fixed path: OAuth and discovery, `/llms*`, `/skills/*`, stored bytes,
 *    and the screens the product draws itself, `/login`, `/welcome` (the first sign-in's handle step), `/start` (the
 *    create door and agent handoff) and `/local/connect` (the local-file helper). Sign-out is the API;
 *  - everything that is data or files under a page (its doors), and the installed-app entry `/a/<id>/app` and
 *    `/a/<id>/app/` (`page-app`: its page carries the app's manifest and icons, which a shell cannot name for it);
 *  - a page screen carrying an export key (`?key=`: the exporter photographs the app's own page);
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
import { classifyPath, isScreenPath } from '@artifactbin/contracts';

const NONCE_PLACEHOLDER = '__CSP_NONCE__';
const HEAD_PLACEHOLDER = '__HEAD_TAGS__';

/** Is this GET a screen the custom shell answers (the map's screens), rather than an address the app keeps? */
export function shellAnswers(url: URL): boolean {
  const path = url.pathname;
  return isScreenPath(path) && !(classifyPath(path) === 'page-screen' && url.searchParams.has('key'));
}

/** A screen that names one document (`__HEAD_TAGS__` is filled there): a page screen or a pretty address. */
export const namesDocument = (url: URL): boolean => classifyPath(url.pathname) === 'page-screen' || /^\/@[^/]+\/./.test(url.pathname);

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

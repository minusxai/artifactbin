/**
 * A CUSTOM SHELL (`APP__SHELL_FILE`, off by default): one HTML file the operator supplies, served in place of the
 * app's own screens, so a deployment can put its own face on Artifactbin and route client-side (deep links and
 * reloads land on the same file). With the setting unset nothing here runs and every response is as before.
 *
 * WHAT THE FILE ANSWERS (server/app, `shellAnswers`): every GET or HEAD for an address the URL map calls a SCREEN
 * (contracts url-space `isScreenPath`, also published at `/af/url-space.json`), always 200 (the file decides what to
 * show and what is not found):
 *  - `/` and every app screen (home, account, groups, group settings, trash, new-file pages, `/docs-human`,
 *    `/getting-started`, `/local/publish`) and every address nothing else serves, for every caller (a fetch tool reads
 *    the agent pointer in the head);
 *  - the page and handle screens: `/a/<id>`, `/a/<id>/edit`, `/@<handle>` and `/@<handle>/<slug…>`. The file shows a
 *    document itself (the hosted host module, `/af/host.js`) from the JSON doors: `GET /api/page/profile/@<handle>/
 *    <path>` resolves a pretty address (`{kind: "artifact", id}`, `{kind: "redirect", to}`, a profile, or 404),
 *    `GET /api/page/artifact/<id>` is the access decision (404 for a reader who may not read it) with the title and
 *    description, and `GET /api/page/frame/<id>` the frame's first URL with its one-time ticket;
 *  - the sign-in screen `/login` (with its query, e.g. `callbackUrl`), for a browser WITHOUT a session (the map's fixed
 *    path marked `shell`). The file signs the person in through the JSON sign-in API at this origin (`POST
 *    /api/auth/email-otp/send-verification-otp`, then `POST /api/auth/sign-in/email-otp`) and then loads `/login` again:
 *    a browser WITH a session is never given the file there but sent (302) to its `callbackUrl`, same-origin only
 *    (lib/http/safe-redirect `loginRedirectTarget`; anything else is `/`), so the file never follows the address itself.
 *
 * WHAT STAYS ARTIFACTBIN'S, unchanged: everything the map does not call a screen —
 *  - the API (`/api/*`, including sign-in `/api/auth/*`, the token endpoints and every refusal JSON), `/af/*`, the old
 *    addresses (the map's `legacy`), and every other fixed path: OAuth and discovery (the consent page included),
 *    `/llms*`, `/skills/*`, stored bytes, and the screens the product draws itself, `/welcome` (the first sign-in's
 *    handle step), `/start` (the create door and agent handoff) and `/local/connect` (the local-file helper). Sign-out
 *    is the API;
 *  - everything that is data or files under a page (its doors), and the installed-app entry `/a/<id>/app` and
 *    `/a/<id>/app/` (`page-app`: its page carries the app's manifest and icons, which a shell cannot name for it);
 *  - a page screen carrying an export key (`?key=`: the exporter photographs the app's own page);
 *  - every other host (pages origins, user pages hosts, the assets origin): their boundaries answer first.
 * The app's other screens are not reachable at all: there is no second prefix for them.
 *
 * POSTURE: the policy the app page at that address would carry (the app CSP: script, style, connect and frame sources
 * `'self'`; frame-ancestors `'self'`, or a document address's trusted embedders), its security headers,
 * `cache-control: no-store`, and `Link: <origin/llms.txt>; rel="help"` (the agent pointer the app page carries in its
 * head). Two placeholders, nothing else is templated, located once at boot by a small HTML scan:
 *  - `__CSP_NONCE__` is a slot wherever it stands inside an attribute value of a start tag, quoted or not
 *    (`<script nonce="__CSP_NONCE__">`, `<meta name="af-style-nonce" content="__CSP_NONCE__">`); each becomes the
 *    response's one fresh nonce, admitted by `script-src` (inline style is already allowed). A file without a slot gets
 *    the policy unchanged;
 *  - `__HEAD_TAGS__` is a slot at its FIRST occurrence as markup inside the file's own `<head>` element (after `<head>`,
 *    before `</head>` or `<body>`). It becomes, on every screen, the agent pointer the app page's head carries (its
 *    `<link rel="help">` and `<meta name="agents">`, lib/agent-copy `agentDiscoveryHead`), followed, on a document
 *    screen whose document an ANONYMOUS reader may read, by that document's own `<title>`, description, Open Graph card
 *    and canonical link (what a link-preview bot fetching it would see on the app page). A shell without the slot
 *    carries neither (the `Link` header still points agents to the guide).
 *  Every other occurrence stays literal: in text or the body, in a comment, in the body of a raw-text element (script,
 *  style, title, textarea and the like), in a tag outside an attribute value, or a second `__HEAD_TAGS__`.
 * Read once at boot: a missing or unreadable file stops the boot, naming the setting.
 *
 * ITS OWN SCRIPTS AND STYLES: the file stays small (it can never be cached: a fresh nonce per response) by naming its
 * code and styles as files beside it, `src="/af/shell/<name>.js"` or `href="/af/shell/<name>.css"` (an attribute value,
 * exactly; anywhere else the text stays literal). Each is read with the file at boot (one it names but that cannot be
 * read stops the boot, naming it), and the attribute becomes the file's content address, `/af/shell/<sha256>/<name>`,
 * served immutable (`CACHE_CONTROL.immutable`, a year) with Brotli made once at boot: a browser fetches it again only
 * when a new file changes its address. Nothing else beside the shell is served, and no other version.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { CACHE_CONTROL, classifyPath, isScreenPath } from '@artifactbin/contracts/url-space';
import { negotiateEncoding } from './content-encoding';

const NONCE_PLACEHOLDER = '__CSP_NONCE__';
const HEAD_PLACEHOLDER = '__HEAD_TAGS__';

/** Is this GET a screen the custom shell answers (the map's screens), rather than an address the app keeps? */
export function shellAnswers(url: URL): boolean {
  const path = url.pathname;
  return isScreenPath(path) && !(classifyPath(path) === 'page-screen' && url.searchParams.has('key'));
}

/** A screen that names one document (`__HEAD_TAGS__` is filled there): a page screen or a pretty address. */
export const namesDocument = (url: URL): boolean => classifyPath(url.pathname) === 'page-screen' || /^\/@[^/]+\/./.test(url.pathname);

const NONCE = Symbol('nonce');
const HEAD = Symbol('head');
type Piece = string | typeof NONCE | typeof HEAD;
/** Elements whose content is text up to their end tag: a placeholder inside is never markup. */
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
const TAG = /<(\/?)([a-zA-Z][^\s/>]*)/y;

/** The file cut at its slots (the rule above): text pieces with NONCE and HEAD between them. */
function slotsOf(html: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0, at = 0, inHead = false, headSeen = false, headFilled = false;
  const cut = (from: number, to: number, slot: Piece) => { pieces.push(html.slice(last, from), slot); last = to; };
  const nonces = (from: number, to: number) => {
    for (let i = html.indexOf(NONCE_PLACEHOLDER, from); i !== -1 && i + NONCE_PLACEHOLDER.length <= to; i = html.indexOf(NONCE_PLACEHOLDER, i + 1)) cut(i, i + NONCE_PLACEHOLDER.length, NONCE);
  };
  while (at < html.length) {
    const lt = html.indexOf('<', at);
    const textEnd = lt === -1 ? html.length : lt;
    if (inHead && !headFilled) {
      const i = html.indexOf(HEAD_PLACEHOLDER, at);
      if (i !== -1 && i + HEAD_PLACEHOLDER.length <= textEnd) { cut(i, i + HEAD_PLACEHOLDER.length, HEAD); headFilled = true; }
    }
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt + 4); at = end === -1 ? html.length : end + 3; continue; }
    TAG.lastIndex = lt;
    const tag = TAG.exec(html);
    if (!tag) {
      // `<!doctype>`, `<?…>` and `</…` without a name are skipped to their `>`; any other `<` is text.
      const bogus = html[lt + 1] === '!' || html[lt + 1] === '?' || html[lt + 1] === '/';
      at = bogus ? (html.indexOf('>', lt) + 1 || html.length) : lt + 1;
      continue;
    }
    const closing = tag[1] === '/', name = tag[2]!.toLowerCase();
    let i = TAG.lastIndex;
    while (i < html.length && html[i] !== '>') {
      if (html[i] !== '=') { i++; continue; }
      i++;
      while (/\s/.test(html[i] ?? '')) i++;
      const quote = html[i] === '"' || html[i] === "'" ? html[i]! : null;
      const from = quote ? i + 1 : i;
      let to = from;
      if (quote) { to = html.indexOf(quote, from); if (to === -1) to = html.length; } else while (to < html.length && !/[\s>]/.test(html[to]!)) to++;
      if (!closing) nonces(from, to);
      i = quote ? to + 1 : to;
    }
    at = i + 1;
    if (!closing && name === 'head' && !headSeen) { inHead = true; headSeen = true; }
    if ((closing && name === 'head') || (!closing && name === 'body')) inHead = false;
    if (!closing && RAW_TEXT.has(name)) {
      const end = html.slice(at).search(new RegExp(`</${name}[\\s/>]`, 'i'));
      at = end === -1 ? html.length : at + end;
    }
  }
  pieces.push(html.slice(last));
  return pieces;
}

/** One script or stylesheet the shell names, as read at boot. */
interface ShellFile { type: string; body: Buffer; brotli: Buffer }
const SHELL_FILE_TYPES: Readonly<Record<string, string>> = { js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };
/** `src="/af/shell/<name>"` or `href="…"`: a name beside the file, a script or a stylesheet, nothing else. */
const NAMED_FILE = /\b(src|href)=(["'])\/af\/shell\/([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(js|css))\2/g;
const SHELL_FILE_PATH = /^\/af\/shell\/([a-f0-9]{64}\/[^/]+)$/;

/** The file and its slots; `nonced` and `headed` say whether it has a nonce slot and a head slot; `files` what it names, by content address. */
export interface CustomShell { html: string; pieces: readonly Piece[]; nonced: boolean; headed: boolean; files: ReadonlyMap<string, ShellFile> }

/** The operator's file, read now; throws naming APP__SHELL_FILE when it cannot be. */
export function loadCustomShell(file: string): CustomShell {
  let html: string;
  try { html = readFileSync(file, 'utf8'); } catch (error) {
    throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} cannot be read (${(error as NodeJS.ErrnoException).code ?? 'error'}): set it to an HTML file this process can read, or unset it.`);
  }
  if (!html.trim()) throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} is empty.`);
  const files = new Map<string, ShellFile>();
  html = html.replace(NAMED_FILE, (_attribute, name: string, quote: string, base: string, extension: string) => {
    let body: Buffer;
    try { body = readFileSync(join(dirname(file), base)); } catch (error) {
      throw new Error(`[boot] APP__SHELL_FILE ${JSON.stringify(file)} names /af/shell/${base}, which cannot be read beside it (${(error as NodeJS.ErrnoException).code ?? 'error'}).`);
    }
    const address = `${createHash('sha256').update(body).digest('hex')}/${base}`;
    files.set(address, { type: SHELL_FILE_TYPES[extension]!, body, brotli: brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }) });
    return `${name}=${quote}/af/shell/${address}${quote}`;
  });
  const pieces = slotsOf(html);
  return { html, pieces, nonced: pieces.includes(NONCE), headed: pieces.includes(HEAD), files };
}

/**
 * The shell's response under `csp` (the app page's policy at this address), `headers` (its security headers and agent
 * pointer) and `headTags` (the document's anonymous head, or nothing).
 */
export function customShellResponse(shell: CustomShell, method: string, csp: string, headers: Record<string, string>, headTags = ''): Response {
  const nonce = shell.nonced ? randomBytes(16).toString('base64') : null;
  const body = shell.pieces.map((piece) => (piece === NONCE ? nonce! : piece === HEAD ? headTags : piece)).join('');
  const policy = nonce ? csp.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`) : csp;
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers, 'content-security-policy': policy,
  } });
}

/** A script or stylesheet the shell names, at its content address (`/af/shell/<sha256>/<name>`); null for anything else. */
export function shellFileResponse(shell: CustomShell | null, request: Request, pathname: string): Response | null {
  const address = SHELL_FILE_PATH.exec(pathname)?.[1];
  const found = address ? shell?.files.get(address) : undefined;
  if (!found) return null;
  const brotli = request.method !== 'HEAD' && negotiateEncoding(request.headers.get('accept-encoding'), ['br']) === 'br';
  const body = brotli ? found.brotli : found.body;
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers: {
    'content-type': found.type, 'cache-control': CACHE_CONTROL.immutable, 'x-content-type-options': 'nosniff', vary: 'Accept-Encoding',
    'content-length': String(body.byteLength), ...(brotli ? { 'content-encoding': 'br' } : {}),
  } });
}

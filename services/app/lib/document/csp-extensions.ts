/**
 * What a document asks of the network beyond the default document policy, declared in its Helmet the
 * way fonts are (lib/page-styles/document-fonts):
 *
 *   <meta name="csp-connect" content="https://api.open-meteo.com https://api.example.com" />
 *   <meta name="csp-script"  content="https://cdn.plot.ly" />
 *   <meta name="csp-style"   content="https://cdn.example.com" />
 *   <meta name="csp-img"     content="https://images.example.com" />
 *   <meta name="csp-frame"   content="https://www.youtube-nocookie.com" />
 *   <meta name="csp-media"   content="https://media.example.com" />
 *
 * Fonts ride on `csp-style` (a stylesheet host serves its faces too): it extends both style-src and
 * font-src. The others map one to one: connect-src, script-src, img-src, frame-src, media-src.
 *
 * PURE and dependency-light on purpose: local validation imports it, so a local check
 * refuses what publish refuses, with the same messages and spans. Nothing is stored beside the source:
 * each version's source IS its declaration (edits commit client-prepared patches, so a stored copy would
 * drift), and serving re-reads it (lib/trust/document-trust) to append the hosts a reader published or
 * allowed.
 *
 * The grammar is deliberately narrow because every value lands in a response header: https origins
 * only, no path, query, fragment or credentials, and a wildcard only as a whole leading `*.` label
 * over at least a registrable-looking name. Nothing that passes can carry `;`, `'` or whitespace.
 */
interface ValidationError {message:string;tag?:string;attr?:string;start?:number;end?:number}

/** The directives a document may extend, as https origins appended per directive. */
export interface CspExtensions {
  connect: string[];
  script: string[];
  /** style-src and font-src. */
  style: string[];
  img: string[];
  frame: string[];
  media: string[];
}
export type CspDirective = keyof CspExtensions;

/** What the app page tells the consent bar (lib/trust/document-trust cspRequestFor answers it). */
export interface CspRequest {
  /** Everything the document declares. */
  extensions: CspExtensions;
  /** What this reader is asked about: the declared hosts they did not publish themselves. Empty unless blocked. */
  asking: CspExtensions;
  /**
   * publisher: every host was added by this reader's own publish · allowed: a grant covers the rest ·
   * blocked: only the reader's own hosts apply, the rest wait on the bar · none: the document asks nothing.
   */
  status: 'publisher' | 'allowed' | 'blocked' | 'none';
  /** The reader said Never: the bar collapses to a note. Only ever true while `status` is 'blocked'. */
  denied: boolean;
  /**
   * What the reader could approve for a whole group instead (lib/trust/group-trust): present only while the bar asks,
   * group approvals are on (TRUST__GROUP_APPROVALS), the asked set holds an exact connect, img or media origin, and the
   * reader edits at least one group. `eligible` is that part of `asking`; the rest still needs a per-page answer.
   */
  group?: { eligible: CspExtensions; groups: CspApprovalGroup[] };
}

/** A group the reader may approve addresses for (one they directly edit). */
export interface CspApprovalGroup { id: string; handle: string; name: string }

export const CSP_DIRECTIVES: readonly CspDirective[] = ['connect', 'script', 'style', 'img', 'frame', 'media'];
export const EMPTY_CSP_EXTENSIONS: CspExtensions = Object.freeze({ connect: [], script: [], style: [], img: [], frame: [], media: [] }) as CspExtensions;
/** A fresh, mutable empty set. */
export const emptyCspExtensions = (): CspExtensions => ({ connect: [], script: [], style: [], img: [], frame: [], media: [] });
const MAX_CSP_ORIGINS_PER_DIRECTIVE = 10;

const META_PREFIX = 'csp-';
const metaName = (directive: CspDirective): string => `${META_PREFIX}${directive}`;

interface CspExtensionError extends ValidationError {
  /** The offending value as written (one origin, or the whole content for a directive-level fault). */
  value: string;
}

/** On refusal, `extensions` still holds the origins that did validate (what a reader of an unvalidated edit may be asked about). */
type CspExtensionsResult =
  | { ok: true; extensions: CspExtensions }
  | { ok: false; errors: CspExtensionError[]; extensions: CspExtensions };

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const ORIGIN_RE = new RegExp(`^https://(\\*\\.)?(${LABEL}(?:\\.${LABEL})*)(:\\d{1,5})?$`);

/** One written origin → its canonical form, or why it is refused. */
export function parseCspOrigin(written: string): { ok: true; origin: string } | { ok: false; reason: string } {
  const value = written.endsWith('/') && /^https:\/\/[^/]+\/$/i.test(written) ? written.slice(0, -1) : written;
  if (!/^https:\/\//i.test(value)) return { ok: false, reason: 'must be an https:// origin' };
  const rest = value.slice('https://'.length);
  if (/[/?#]/.test(rest)) return { ok: false, reason: 'must be an origin only: no path, query or fragment' };
  if (rest.includes('@')) return { ok: false, reason: 'must not carry credentials' };
  const lower = `https://${rest.toLowerCase()}`;
  const match = ORIGIN_RE.exec(lower);
  if (!match) {
    return { ok: false, reason: rest.includes('*') ? 'a wildcard is only allowed as a whole leading label, as in https://*.example.com' : 'is not a valid host' };
  }
  const [, wildcard, host, port] = match;
  if (wildcard && host!.split('.').length < 2) return { ok: false, reason: 'a wildcard must cover a subdomain of a named site, as in https://*.example.com' };
  if (port && Number(port.slice(1)) > 65535) return { ok: false, reason: 'has an invalid port' };
  return { ok: true, origin: lower };
}

export function cspExtensionsOf(content: {meta:Array<{name:string;content:string}>}): CspExtensionsResult {
  const errors: CspExtensionError[] = [];
  const extensions = emptyCspExtensions();
  for (const meta of content.meta) {
    if (!meta.name.startsWith(META_PREFIX)) continue;
    const directive = meta.name.slice(META_PREFIX.length) as CspDirective;

    if (!CSP_DIRECTIVES.includes(directive)) {
      errors.push({ message: `the native head meta ${meta.name} is not a policy a document can extend — use ${CSP_DIRECTIVES.map(metaName).join(', ')}`, tag: 'meta', attr: 'name', value: meta.name });
      continue;
    }
    const written = meta.content.trim().split(/\s+/).filter(Boolean);
    if (written.length === 0) {
      errors.push({ message: `the native head meta ${meta.name} lists no origins — name each https origin, separated by spaces`, tag: 'meta', attr: 'content', value: meta.content });
      continue;
    }
    const origins: string[] = [];
    for (const value of written) {
      const parsed = parseCspOrigin(value);
      if (!parsed.ok) errors.push({ message: `the native head meta ${meta.name}: "${value}" ${parsed.reason}`, tag: 'meta', attr: 'content', value });
      else if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
    }
    if (origins.length > MAX_CSP_ORIGINS_PER_DIRECTIVE) {
      errors.push({ message: `the native head meta ${meta.name} names ${origins.length} origins; the cap is ${MAX_CSP_ORIGINS_PER_DIRECTIVE}`, tag: 'meta', attr: 'content', value: meta.content });
    }
    extensions[directive] = origins.slice(0, MAX_CSP_ORIGINS_PER_DIRECTIVE);
  }
  return errors.length ? { ok: false, errors, extensions } : { ok: true, extensions };
}

/**
 * Does a declared origin (as `parseCspOrigin` writes it) admit `origin` (a URL's `.origin`)? Exact, or for
 * `https://*.example.com[:port]` any subdomain at any depth on the same port — what a CSP host-source matches.
 */
export function cspOriginMatches(declared: string, origin: string): boolean {
  if (declared === origin) return true;
  const wild = /^https:\/\/\*\.([^/:]+)(:\d+)?$/.exec(declared);
  if (!wild) return false;
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.protocol !== 'https:' || url.origin !== origin) return false;
  return url.hostname.endsWith(`.${wild[1]}`) && (url.port ? `:${url.port}` : '') === (wild[2] ?? '');
}

/**
 * The directives a GROUP may approve: the ones that call or load data. Script, style (and fonts) and frame run or embed
 * code, so they stay a per-page answer and are never granted by a group.
 */
export const GROUP_CSP_DIRECTIVES: readonly CspDirective[] = ['connect', 'img', 'media'];

/** The part of a set a group may approve: its exact origins (never a wildcard) under `GROUP_CSP_DIRECTIVES`. */
export function groupEligibleCspExtensions(extensions: CspExtensions): CspExtensions {
  const out = emptyCspExtensions();
  for (const d of GROUP_CSP_DIRECTIVES) out[d] = extensions[d].filter((origin) => !origin.includes('*'));
  return out;
}

/** Does this set ask for anything at all? */
export const hasCspExtensions = (extensions: CspExtensions): boolean => CSP_DIRECTIVES.some((d) => extensions[d].length > 0);

/** Is every origin `wanted` asks for already in `granted`? (A grant covers a set, never "anything".) */
export function coversCspExtensions(granted: CspExtensions, wanted: CspExtensions): boolean {
  return CSP_DIRECTIVES.every((d) => wanted[d].every((origin) => granted[d].includes(origin)));
}

/** The union of two sets, per directive, order kept. */
export function mergeCspExtensions(a: CspExtensions, b: CspExtensions): CspExtensions {
  const out = emptyCspExtensions();
  for (const d of CSP_DIRECTIVES) out[d] = [...new Set([...a[d], ...b[d]])];
  return out;
}

/** What `a` asks for that `b` does not hold, per directive. */
export function subtractCspExtensions(a: CspExtensions, b: CspExtensions): CspExtensions {
  const out = emptyCspExtensions();
  for (const d of CSP_DIRECTIVES) out[d] = a[d].filter((origin) => !b[d].includes(origin));
  return out;
}

/**
 * A stored set (a `document_trust` row) read back defensively: anything that is not a list of origins this parser would accept
 * is dropped, so a hand-edited or legacy meta can never put a foreign token into a header.
 */
export function storedCspExtensions(raw: unknown): CspExtensions {
  const out = emptyCspExtensions();
  if (!raw || typeof raw !== 'object') return out;
  for (const d of CSP_DIRECTIVES) {
    const list = (raw as Record<string, unknown>)[d];
    if (!Array.isArray(list)) continue;
    for (const value of list.slice(0, MAX_CSP_ORIGINS_PER_DIRECTIVE)) {
      if (typeof value !== 'string') continue;
      const parsed = parseCspOrigin(value);
      if (parsed.ok && parsed.origin === value && !out[d].includes(value)) out[d].push(value);
    }
  }
  return out;
}

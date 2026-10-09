/**
 * What a document asks of the network beyond the default document policy, declared in its Helmet the
 * way fonts are (lib/story/styles/document-fonts):
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
 * PURE and dependency-light on purpose: the CLI bundles it through local-validation, so `afbin validate`
 * refuses what publish refuses, with the same messages and spans. Nothing is stored beside the source:
 * each version's source IS its declaration (edits commit client-prepared patches, so a stored copy would
 * drift), and serving re-reads it (lib/trust/document-trust) to append the hosts a reader published or
 * allowed.
 *
 * The grammar is deliberately narrow because every value lands in a response header: https origins
 * only, no path, query, fragment or credentials, and a wildcard only as a whole leading `*.` label
 * over at least a registrable-looking name. Nothing that passes can carry `;`, `'` or whitespace.
 */
import type { JsxElement, ValidationError } from '@/lib/jsx';
import type { HelmetContent } from './helmet';

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
}

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
export type CspExtensionsResult =
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

/** The `<meta name="csp-…">` element in the Helmet, for spans. */
function metaElement(helmet: JsxElement | null | undefined, name: string): JsxElement | null {
  for (const child of helmet?.children ?? []) {
    if (child.type !== 'element' || child.tag.toLowerCase() !== 'meta') continue;
    const attr = child.attributes.find((a) => a.name.toLowerCase() === 'name');
    if (attr?.value.static && attr.value.json === name) return child;
  }
  return null;
}

function spanOf(helmet: JsxElement | null | undefined, name: string): { start?: number; end?: number } {
  const element = metaElement(helmet, name);
  if (!element) return {};
  const content = element.attributes.find((a) => a.name.toLowerCase() === 'content');
  return content ? { start: content.start, end: content.end } : { start: element.start, end: element.end };
}

/**
 * Read and validate the four `csp-*` metas of a split Helmet. `helmet` (the split's element) only
 * supplies spans; the values come from `content.meta`, which the Helmet grammar already collected.
 */
export function cspExtensionsOf(content: Pick<HelmetContent, 'meta'>, helmet?: JsxElement | null): CspExtensionsResult {
  const errors: CspExtensionError[] = [];
  const extensions = emptyCspExtensions();
  for (const meta of content.meta) {
    if (!meta.name.startsWith(META_PREFIX)) continue;
    const directive = meta.name.slice(META_PREFIX.length) as CspDirective;
    const span = spanOf(helmet, meta.name);
    if (!CSP_DIRECTIVES.includes(directive)) {
      errors.push({ message: `the Helmet meta ${meta.name} is not a policy a document can extend — use ${CSP_DIRECTIVES.map(metaName).join(', ')}`, tag: 'meta', attr: 'name', value: meta.name, ...span });
      continue;
    }
    const written = meta.content.trim().split(/\s+/).filter(Boolean);
    if (written.length === 0) {
      errors.push({ message: `the Helmet meta ${meta.name} lists no origins — name each https origin, separated by spaces`, tag: 'meta', attr: 'content', value: meta.content, ...span });
      continue;
    }
    const origins: string[] = [];
    for (const value of written) {
      const parsed = parseCspOrigin(value);
      if (!parsed.ok) errors.push({ message: `the Helmet meta ${meta.name}: "${value}" ${parsed.reason}`, tag: 'meta', attr: 'content', value, ...span });
      else if (!origins.includes(parsed.origin)) origins.push(parsed.origin);
    }
    if (origins.length > MAX_CSP_ORIGINS_PER_DIRECTIVE) {
      errors.push({ message: `the Helmet meta ${meta.name} names ${origins.length} origins; the cap is ${MAX_CSP_ORIGINS_PER_DIRECTIVE}`, tag: 'meta', attr: 'content', value: meta.content, ...span });
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

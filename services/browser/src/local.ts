export { sessionEnvNamesRead, sessionProcessPaths } from './session-config';
import { createBrowserSessions } from './sessions';
import { createSessionProcess } from './session-process';
import { renderSandboxChoice, type BrowserSessionOptions, type RenderSandboxChoice } from './session-config';
/**
 * CHROMIUM, IN THIS PROCESS. The only entry of this package that loads
 * Playwright; import it from a composition root only. TWO browsers, each
 * launched on first use and closed after a minute idle (./browser-holder owns
 * that lifecycle): one draws exports (render, upload, harvest), the other
 * checks (inspect), so no check ever waits on or delays an export, and a check
 * browser that is wedged or replaced never fails an export in flight. Each
 * lane is SERIALISED (one page at a time bounds memory); the check lane admits
 * a bounded few by ./check-admission. A render's deadline closes its own page
 * (its own context), never the browser.
 *
 * Every render has its own context behind its own egress proxy (./egress): it
 * reaches exactly the origins it may load, nothing else, by any protocol; each
 * browser is launched behind a proxy that refuses everything, with no name
 * resolution, no unproxied WebRTC UDP and no QUIC (EGRESS_ARGS), with only the
 * environment Chromium needs (never this process's secrets), and, when
 * BROWSER__RENDER_SANDBOX=chromium, inside Chromium's own sandbox
 * (./session-config renderSandboxChoice). Its renderers are held to
 * ./render-limits.
 */
import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import sharp from 'sharp';
import {admittedUploadUrl,uploadImage,type UploadOptions} from './upload';
import {browserUploadOptions} from './upload-config';
import type { BrowserService, BrowserSessions, HarvestedSvg, PageImage, PageInspectRequest, PageInspection, PageProblem, PageRequest, RenderRequest, RenderResult, SvgHarvestRequest, SvgHarvestResult } from '@artifactbin/contracts';
import { ELEMENT_CAPTURE, PAGE_IMAGE_LIMITS, PAGE_PROBLEM_LIMITS, SVG_HARVEST_LIMITS, type NoElement } from '@artifactbin/contracts';
import { internalAssetResponse, internalPageResponse } from './internal-assets';
import { BrowserUnavailable, createBrowserHolder } from './browser-holder';
import { EGRESS_ARGS, openEgress, type Egress } from './egress';
import { CHECK_LANE, createCheckAdmission } from './check-admission';
import { RENDER_LIMIT_POLL_MS, RENDER_LIMITS, processTable, rendererPastLimits, type RenderLimits } from './render-limits';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_500;
// The editor can display the overview at ~850 CSS px on a 2x screen. Keeping
// canonical horizontal resolution avoids enlarging a thumbnail while the
// height cap still bounds unusually tall documents.
const PREVIEW_WIDTH = 1_600;
const PREVIEW_MAX_HEIGHT = 4_096;
/** A timed-out page that will not close within this is a wedged browser, which is then retired. */
const PAGE_CLOSE_WAIT_MS = 5_000;

/**
 * A page's own data reads: its GraphQL, SQL, query and function doors on the render URL's origin. Each answers and ends
 * (the app bounds them); a long-lived stream (`regions/stream`, events) is not one, so it never holds a capture.
 */
const DATA_READ_PATH = /^\/api\/artifacts\/[^/]+\/(?:graphql|sql|query|fn\/[^/]+)$/;
/** After the last data read ends, how long the page gets to draw what it read before readiness goes on. */
const DATA_QUIET_MS = 500;
function isDataRead(target: string, pageOrigin: string): boolean {
  try { const url = new URL(target); return url.origin === pageOrigin && DATA_READ_PATH.test(url.pathname); } catch { return false; }
}

class NavigationError extends Error {}
// The one slide drawn, whatever the deck's own CSS shows: the same rule as toolbox-check-capture.mjs's.
const SLIDE_REVEAL_CSS = '[data-af-slide]{transition:none!important;animation:none!important}'
  + '[data-af-slide]:not([data-af-slide-shot]){visibility:hidden!important;opacity:0!important}'
  + '[data-af-slide-shot]{visibility:visible!important;opacity:1!important}';
class NoSlideError extends Error { constructor(readonly slides: number) { super(`document has ${slides} slides`); } }
class NoElementError extends Error { constructor(readonly verdict: NoElement) { super(`element ${verdict.why}`); } }
/** Generated deck chrome stays out of a slide's or an element's picture: hidden, with nothing animating. */
const DECK_CHROME_HIDDEN = '[data-af-deck-chrome],[data-af-deck-chrome] *,[data-af-deck-chrome]::before,[data-af-deck-chrome]::after,[data-af-deck-chrome] *::before,[data-af-deck-chrome] *::after{visibility:hidden!important;transition:none!important;animation:none!important}';
/** The mark an element capture puts on its match, so the shot is taken by this name and never by the author's selector. */
const ELEMENT_SHOT = 'data-af-element-shot';

/**
 * Serialized into Chromium: the first element under `root` that the author's selector matches, through the document's
 * own `querySelector` (the selector is an argument, never code, and no Playwright engine reads it), marked to be shot.
 * Answers why not when there is no match, a match with no size or not visible, a selector that is not CSS, or a match
 * larger than the capture allows. Self-contained and synchronous.
 */
type Marked = { why: 'none' | 'hidden' | 'invalid' } | { why: 'too_large'; width: number; height: number } | { why?: never; width: number; height: number };
function markElement(root: Element, input: { selector: string; mark: string; max: number }): Marked {
  let found: Element | null;
  try { found = root.querySelector(input.selector); } catch { return { why: 'invalid' }; }
  if (!found) return { why: 'none' };
  const box = found.getBoundingClientRect();
  if (box.width < 1 || box.height < 1 || !found.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return { why: 'hidden' };
  const width = Math.ceil(box.width), height = Math.ceil(box.height);
  if (width > input.max || height > input.max) return { why: 'too_large', width, height };
  found.setAttribute(input.mark, '');
  return { width, height };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function requestOriginAllowed(target:string,pageOrigin:string,allowedOrigins:string[]=[]):boolean {
  if(target.startsWith('data:')||target.startsWith('blob:'))return true;
  try{return new Set([pageOrigin,...allowedOrigins]).has(new URL(target).origin);}catch{return false;}
}

/** Serialized into Chromium: keep this predicate synchronous and self-contained. */
function chartsSettled(selector:string):boolean {
 const root=document.querySelector(selector);
 // A hosted <af-chart> is aria-busy while it loads its engine, rows or draws; an <af-data-table sql> until its read answers.
 const busy='[data-mx-chart-state="pending"],af-chart[aria-busy="true"],af-data-table[aria-busy="true"]';
 return !!root&&!root.matches(busy)&&!root.querySelector(busy);
}

/**
 * Serialized into Chromium BEFORE the page's own scripts (an init script): which script component mounts the page has
 * rendered. The page runtime (app lib/islands/page-runtime) takes a mount's server fallback out (`replaceChildren()`)
 * and renders the component in the same task, and the parser never removes a node, so a removal from a mount means it
 * was rendered; a mount whose children differ from the ones it had when parsing finished was rendered too (an empty
 * fallback). Self-contained, no nested named functions.
 */
function watchMounts(): void {
  const state = { taken: new WeakSet<Element>(), parsed: new WeakMap<Element, Node[]>() };
  (window as unknown as { __mxMounts: typeof state }).__mxMounts = state;
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element;
      if (record.removedNodes.length && target.nodeType === 1 && target.hasAttribute('data-mx-mount')) state.taken.add(target);
    }
  }).observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', () => {
    for (const mount of document.querySelectorAll('[data-mx-mount]')) state.parsed.set(mount, [...mount.childNodes]);
  });
}

/** Serialized into Chromium: every mount under the surface rendered (see watchMounts). Synchronous. */
function mountsRendered(selector: string): boolean {
  const root = document.querySelector(selector);
  const state = (window as unknown as { __mxMounts?: { taken: WeakSet<Element>; parsed: WeakMap<Element, Node[]> } }).__mxMounts;
  if (!root || !state) return true;
  return [...root.querySelectorAll('[data-mx-mount]')].every((mount) => {
    if (state.taken.has(mount)) return true;
    const parsed = state.parsed.get(mount);
    return !!parsed && (parsed.length !== mount.childNodes.length || parsed.some((node, i) => node !== mount.childNodes[i]));
  });
}

/**
 * Serialized into Chromium: every `collect` element under the surface whose
 * `<img>` holds an SVG `data:` URL — its own `data-*` attributes, the image's
 * width/height attributes and the URL. Self-contained, synchronous, and with
 * no nested function: a bundler's name-keeping helper would not exist there.
 */
function collectDrawings(input: { selector: string; collect: string; limit: number }) {
  const root = document.querySelector(input.selector);
  if (!root) return [];
  const out: Array<{ attributes: Record<string, string>; width: number | null; height: number | null; src: string }> = [];
  for (const element of root.querySelectorAll(input.collect)) {
    const img = element.querySelector('img');
    const src = img?.getAttribute('src') ?? '';
    if (!img || !src.startsWith('data:image/svg+xml')) continue;
    const attributes: Record<string, string> = {};
    for (const attribute of element.attributes) if (attribute.name.startsWith('data-')) attributes[attribute.name] = attribute.value.slice(0, 512);
    const width = Number(img.getAttribute('width')), height = Number(img.getAttribute('height'));
    out.push({ attributes, width: img.hasAttribute('width') && Number.isFinite(width) ? width : null, height: img.hasAttribute('height') && Number.isFinite(height) ? height : null, src });
    if (out.length >= input.limit) break;
  }
  return out;
}

/** The SVG text of an `image/svg+xml` data URL (percent-encoded or base64). */
function svgFromDataUrl(src: string): string {
  const comma = src.indexOf(',');
  const head = src.slice(0, comma);
  if (comma < 0 || !/^data:image\/svg\+xml(;charset=utf-8)?(;base64)?$/i.test(head)) throw new Error('Not an SVG data URL');
  const body = src.slice(comma + 1);
  return head.toLowerCase().endsWith(';base64') ? Buffer.from(body, 'base64').toString('utf8') : decodeURIComponent(body);
}

/**
 * Serialized into Chromium: every native component under the surface that failed (`[data-af-error]`, lib/html-component-specs
 * read-failure), with the sentence its status line shows: the same contract the author check reads
 * (skills/artifactbin/scripts/toolbox-check-*.mjs). Self-contained and synchronous.
 */
function collectFailures(input: { selector: string; limit: number }) {
  const root = document.querySelector(input.selector) ?? document.documentElement;
  const out: Array<{ kind: 'component'; element: string; code: string; label: string; message: string }> = [];
  for (const element of root.querySelectorAll('[data-af-error]')) {
    const status = element.querySelector('[role="status"]');
    const said = (status?.textContent || element.textContent || '').replace(/\s+/g, ' ').trim();
    out.push({ kind: 'component', element: element.localName, code: element.getAttribute('data-af-error') ?? '', label: (element.getAttribute('label') || element.getAttribute('aria-label') || '').trim(), message: said || 'failed' });
    if (out.length >= input.limit) break;
  }
  return out;
}

/**
 * Serialized into Chromium: a page wider than its window (`overflow`, contracts PageProblem), naming the outermost
 * elements past its right edge (up to three), as the author check says it. Self-contained and synchronous.
 */
function collectOverflow() {
  const html = document.documentElement, width = html.clientWidth;
  const content = Math.max(html.scrollWidth, document.body?.scrollWidth ?? 0);
  if (content <= width + 1) return [];
  const past = (element: Element | null) => !!element && element.getBoundingClientRect().right > width + 1;
  const name = (element: Element) => element.localName + (element.id ? '#' + element.id : '')
    + (typeof element.className === 'string' && element.className.trim() ? '.' + element.className.trim().split(/\s+/)[0] : '');
  const wide = [...(document.body?.querySelectorAll('*') ?? [])].filter((element) => past(element) && !(element.parentElement !== document.body && past(element.parentElement)));
  const named = wide.slice(0, 3).map(name);
  return [{ kind: 'overflow' as const, ...(named[0] ? { element: named[0] } : {}),
    message: `the page is ${content - width}px wider than its ${width}px window${named.length ? `: ${named.join(', ')} stick${named.length === 1 ? 's' : ''} out` : ''}` }];
}

/**
 * Serialized into Chromium: shown text too faint to read (`contrast`, contracts PageProblem), one problem per pair of
 * colours with how many elements draw it and the first of them. A colour is read as the page computed it (oklch,
 * color-mix and the rest: a canvas turns each into sRGB), against the solid backgrounds behind it laid over white;
 * text over an image or gradient, over a layer that is not its ancestor (a hero's tint or picture, found by what is
 * drawn under its middle), in an SVG, or not shown is never judged. Text drawn in one of the theme's surface colours
 * (a shadcn background token: --muted, --card, --accent, --secondary) is told so. Self-contained and total.
 */
function collectUnreadable(input: { selector: string; floor: number; limit: number }) {
  const out: Array<{ kind: 'contrast'; element: string; message: string }> = [];
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const paint = canvas.getContext('2d', { willReadFrequently: true });
    if (!paint) return out;
    const rgba = (value: string) => {
      paint.clearRect(0, 0, 1, 1); paint.fillStyle = 'rgba(0,0,0,0)'; paint.fillStyle = value; paint.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
      return { r: r!, g: g!, b: b!, a: a! / 255 };
    };
    type Rgba = ReturnType<typeof rgba>;
    const over = (top: Rgba, under: Rgba): Rgba => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    const luminance = (c: Rgba) => {
      const f = (x: number) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    /** The solid colour behind `element` and what it was written as, or null over an image or gradient. */
    const behind = (element: Element): { color: Rgba; said: string } | null => {
      const layers: Array<{ color: Rgba; said: string }> = [];
      for (let at: Element | null = element; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== 'none') return null;
        const color = rgba(style.backgroundColor);
        if (color.a > 0) { layers.push({ color, said: style.backgroundColor }); if (color.a >= 1) break; }
      }
      let color: Rgba = { r: 255, g: 255, b: 255, a: 1 }, said = 'rgb(255, 255, 255)';
      for (const layer of layers.reverse()) { color = over(layer.color, color); said = layer.said; }
      return { color, said };
    };
    const name = (el: Element) => el.localName + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '');
    const groups = new Map<string, { count: number; ratio: number; element: string; words: string; color: string; background: string; token?: string }>();
    const same = (a: Rgba, b: Rgba) => a.a === b.a && a.r === b.r && a.g === b.g && a.b === b.b;
    const theme = getComputedStyle(document.documentElement);
    const surfaces = ['--muted', '--card', '--accent', '--secondary'].flatMap((token) => {
      const value = theme.getPropertyValue(token).trim();
      return value ? [{ token, color: rgba(value) }] : [];
    });
    /** Something other than its own ancestors is drawn right under the middle of `el` (a positioned tint, a picture). */
    const overLayer = (el: Element) => {
      const x = scrollX, y = scrollY;
      try {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const box = el.getBoundingClientRect();
        for (const under of document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2)) {
          if (under === el || el.contains(under)) continue;
          return !under.contains(el);
        }
        return false;
      } finally { scrollTo(x, y); }
    };
    const root = document.querySelector(input.selector) ?? document.body;
    const seen = new Set<Element>(), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement, words = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!el || seen.has(el) || words.length < 2) continue;
      seen.add(el);
      if (el.closest('svg') || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || style.backgroundClip === 'text' || style.webkitTextFillColor !== style.color) continue;
      const back = behind(el);
      if (!back) continue;
      let color = rgba(style.color);
      if (color.a === 0) continue;
      if (color.a < 1) color = over(color, back.color);
      const [hi, lo] = [luminance(color), luminance(back.color)].sort((x, y) => y - x);
      const ratio = Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
      if (ratio >= input.floor || overLayer(el)) continue;
      const key = `${style.color}|${back.said}`, group = groups.get(key);
      if (group) group.count++;
      else {
        const token = surfaces.find((surface) => same(surface.color, rgba(style.color)))?.token;
        groups.set(key, { count: 1, ratio, element: name(el), words: words.length > 40 ? words.slice(0, 39) + '…' : words, color: style.color, background: back.said, ...(token ? { token } : {}) });
      }
    }
    for (const g of groups.values()) {
      out.push({ kind: 'contrast', element: g.element, message: `unreadable text: ${g.count} element${g.count === 1 ? '' : 's'} (the first ${g.element} "${g.words}") draw${g.count === 1 ? 's' : ''} ${g.color} on ${g.background}, a contrast of ${g.ratio}:1 (text needs at least ${input.floor}:1)${g.token ? `. That is the theme's ${g.token}, a background colour: write text in --foreground or --muted-foreground` : ''}` });
      if (out.length >= input.limit) break;
    }
  } catch { /* a page this cannot read is judged by the rest of the check */ }
  return out;
}

/** Text under this contrast against its background is unreadable, not merely below a guideline: said as a problem. */
const READABLE_CONTRAST = 2;

/** A page's problems, each said once, cut to PAGE_PROBLEM_LIMITS. */
function problemList() {
  const L = PAGE_PROBLEM_LIMITS, seen = new Set<string>(), problems: PageProblem[] = [];
  let truncated = false;
  const cut = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  return {
    add(problem: PageProblem) {
      const one: PageProblem = { kind: problem.kind, message: cut(problem.message.trim() || problem.kind, L.message),
        ...(problem.element ? { element: cut(problem.element, L.element) } : {}), ...(problem.code ? { code: cut(problem.code, L.code) } : {}),
        ...(problem.label ? { label: cut(problem.label, L.label) } : {}) };
      const key = JSON.stringify(one);
      if (seen.has(key)) return;
      seen.add(key);
      if (problems.length >= L.problems) truncated = true; else problems.push(one);
    },
    result: () => ({ problems, truncated }),
  };
}

/** A request's address as its author reads it: the path on the page's own origin, else origin and path; never a query. */
function said(target: string, pageOrigin: string): string {
  try { const url = new URL(target); return url.origin === pageOrigin ? url.pathname : url.origin + url.pathname; } catch { return target.slice(0, 200); }
}

/**
 * The only environment a render browser is started with: what Chromium needs to find its files, fonts and locale.
 * Everything else this process holds (the internal service secret, upload and session credentials) stays here.
 */
const CHROMIUM_ENV = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'SystemRoot', 'WINDIR', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE'] as const;
export function chromiumEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(CHROMIUM_ENV.flatMap((name) => source[name] !== undefined ? [[name, source[name]!]] : []));
}
/** A renderer's V8 heap, in MB: past it the page's script runs out of memory inside the page (./render-limits). */
const RENDERER_HEAP_MB = 1024;

/**
 * Serialized into every frame of a render BEFORE its scripts (an init script), defence beneath the egress proxy: a
 * page's RTCPeerConnection is given no ICE server (it still constructs, so a page that only makes one is unchanged).
 * Self-contained.
 */
function quietPeerConnections(): void {
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection'] as const) {
    const scope = window as unknown as Record<string, unknown>;
    const Original = scope[name] as (new (config?: RTCConfiguration) => RTCPeerConnection) | undefined;
    if (typeof Original !== 'function') continue;
    const set = Original.prototype.setConfiguration;
    Original.prototype.setConfiguration = function (this: RTCPeerConnection, config?: RTCConfiguration) { return set.call(this, { ...(config ?? {}), iceServers: [] }); };
    const Quiet = function (config?: RTCConfiguration) { return new Original({ ...(config ?? {}), iceServers: [] }); } as unknown as typeof Original;
    Quiet.prototype = Original.prototype;
    Object.defineProperty(Original.prototype, 'constructor', { value: Quiet, writable: true, configurable: true });
    Object.setPrototypeOf(Quiet, Original);
    scope[name] = Quiet;
  }
}

/** A page's renderer stopped: past ./render-limits, or crashed on its own. */
class RendererStopped extends Error {}

/**
 * `launch` replaces Playwright's own launch (and so ignores `executablePath`, the sandbox and the egress launch); tests
 * count and hold browsers with it. `sandbox` defaults to BROWSER__RENDER_SANDBOX; `limits` to RENDER_LIMITS.
 */
export function createBrowser(opts: { idleShutdownMs?: number; executablePath?: () => Promise<string>; launch?: (timeoutMs: number) => Promise<Browser>; sessions?: BrowserSessionOptions; upload?:UploadOptions; sandbox?: RenderSandboxChoice; limits?: Partial<RenderLimits> } = {}): BrowserService & { close(): Promise<void>; start(): Promise<void> } {
  const upload=opts.upload??browserUploadOptions(process.env);
  const sandbox = opts.sandbox ?? renderSandboxChoice(process.env);
  const limits: RenderLimits = { ...RENDER_LIMITS, ...opts.limits };
  if (sandbox.mode === 'warn') console.warn('[browser] WARNING: renders run Chromium WITHOUT its sandbox (BROWSER__RENDER_SANDBOX is unset). Set BROWSER__RENDER_SANDBOX=chromium where the host allows unprivileged user namespaces (SETUP.md), or =none to accept running unsandboxed.');
  let executablePath: string | undefined;
  const timer = (run: () => void, ms: number) => { const timer = setTimeout(run, ms); timer.unref?.(); return () => clearTimeout(timer); };

  /** One browser and its serial queue. The marker names its process for ./render-limits. */
  function lane(name: 'exports' | 'checks') {
    const marker = `--artifactbin-render-lane=${name}`;
    const holder = createBrowserHolder<Browser>({
      idleMs: opts.idleShutdownMs ?? 60_000,
      launch: async (timeoutMs) => {
        if (opts.launch) return opts.launch(timeoutMs);
        // The browser's own proxy refuses everything: a context opened without its render's proxy reaches nothing.
        const refuseAll: Egress = await openEgress([]);
        try {
          const browser = await chromium.launch({ headless: true, timeout: timeoutMs, chromiumSandbox: sandbox.mode === 'chromium', env: chromiumEnv(process.env),
            proxy: { server: refuseAll.server }, args: [...EGRESS_ARGS, `--js-flags=--max-old-space-size=${RENDERER_HEAP_MB}`, marker], ...(executablePath ? { executablePath } : {}) });
          browser.on('disconnected', () => { void refuseAll.close(); });
          return browser;
        } catch (error) { await refuseAll.close(); throw error; }
      },
      timer,
    });
    let busy = 0, polling: ReturnType<typeof setInterval> | undefined;
    /** While a page of this lane is open, its renderers are measured; one past a limit is killed. */
    const watch = () => {
      if (busy++ > 0) return;
      let measuring = false;
      polling = setInterval(() => {
        if (measuring) return;
        measuring = true;
        void processTable().then((rows) => {
          for (const row of rendererPastLimits(rows, marker, limits, process.pid)) { try { process.kill(row.pid, 'SIGKILL'); } catch { /* already gone */ } }
        }).finally(() => { measuring = false; });
      }, RENDER_LIMIT_POLL_MS);
      polling.unref?.();
    };
    const unwatch = () => { if (--busy === 0) clearInterval(polling); };
    return { holder, chain: Promise.resolve() as Promise<unknown>, watch, unwatch };
  }
  const exportsLane = lane('exports'), checksLane = lane('checks');
  type Lane = typeof exportsLane;
  const admission = createCheckAdmission();

  /** Closes this page's context; one that will not close in time means its browser is wedged, so that browser is retired. */
  const closePage = async (on: Lane, context: BrowserContext, browser: Browser) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const closed = await Promise.race([context.close().then(() => true, () => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), PAGE_CLOSE_WAIT_MS); })]);
    clearTimeout(timer);
    if (!closed) await on.holder.retire(browser);
  };

  /**
   * ONE PAGE, LOADED AND SETTLED — what every operation that looks at a page
   * shares: the deadline, the per-request page with service workers blocked,
   * the context-wide admission/forwarding route, navigation, and every
   * readiness wait (diagrams, managed frames, the settle, charts). `use` sees
   * the ready page; the page is closed after, whatever happened.
   */
  async function withReadyPage<T>(on: Lane, req: PageRequest & { internalOrigin?: string }, deviceScaleFactor: number, use: (ready: { page: Page; surface: Locator; timeout: number; remaining: () => number; waitForCharts: () => Promise<void> }) => Promise<T>, watch?: { page(page: Page): void; refused(url: string): void }): Promise<T> {
    const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
    const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw new Error('Render deadline');return ms;};
    const lease = await on.holder.acquire(remaining());
    on.watch();
    let egress: Egress | undefined;
    // The deadline closes THIS page (with its own context), never the browser another render may be using.
    let context: BrowserContext | undefined;
    let crashed = false;
    let expired = false;
    let deadlineClose: Promise<void> | undefined;
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    // The deadline closing the page, or Playwright's own timeout, rejects navigation too: that is the render's
    // budget running out (a 'failed' render, like a late success), never a page that could not be reached.
    const deadlineElapsed=(e:unknown)=>expired||e instanceof errors.TimeoutError;
    const forwarding = new AbortController();
    const pending = new Set<Promise<void>>();
    try {
      // What this render may reach over the network: nothing when everything it loads is fetched from the internal
      // origin (an inspection), else its own origin and the ones it was allowed. Everything else is refused (./egress).
      egress = await openEgress(req.internalOrigin ? [] : [new URL(req.url).origin, ...(req.allowedOrigins ?? [])]);
      renderTimer = setTimeout(() => { expired = true; if (context) deadlineClose = closePage(on, context, lease.browser); }, remaining());
      // reducedMotion: the motion kit never arms scroll reveals under it, so a capture always sees the finished page.
      context = await lease.browser.newContext({ viewport: req.viewport, reducedMotion: 'reduce', deviceScaleFactor, serviceWorkers: 'block', proxy: { server: egress.server } });
      if (expired) { deadlineClose = closePage(on, context, lease.browser); throw new Error('Render deadline'); }
      await context.addInitScript(quietPeerConnections);
      const page = await context.newPage();
      if (expired) throw new Error('Render deadline');
      page.on('crash', () => { crashed = true; });
      watch?.page(page);
      const timeout = remaining();
      if (req.sameOriginOnly || req.assetOrigin || req.internalOrigin) {
        const origin = new URL(req.url).origin;
        // Context routing also covers popup first requests. Service workers are
        // disabled above so no worker can bypass this admission/forwarding seam.
        await page.context().route('**/*', route => {
          const run = (async () => {
            const request = route.request();
            try {
              if (req.assetOrigin && new URL(request.url()).origin === req.assetOrigin) {
                const signal = AbortSignal.any([forwarding.signal, AbortSignal.timeout(Math.min(timeout, DEFAULT_TIMEOUT_MS))]);
                const response = await internalAssetResponse(request.url(), request.method(), req.assetOrigin, origin, signal);
                await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
              } else if (req.internalOrigin && !/^(?:data|blob):/.test(request.url()) && requestOriginAllowed(request.url(), origin, req.allowedOrigins)) {
                // Inspection: the page's own and allowed origins are fetched from the app itself (contracts PageInspectRequest).
                const signal = AbortSignal.any([forwarding.signal, AbortSignal.timeout(Math.min(timeout, DEFAULT_TIMEOUT_MS))]);
                const response = await internalPageResponse(request.url(), request.method(), req.internalOrigin, origin, signal);
                await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
              } else if (!req.sameOriginOnly || requestOriginAllowed(request.url(), origin, req.allowedOrigins)) await route.continue();
              else { watch?.refused(request.url()); await route.abort(); }
            } catch { await route.abort().catch(() => {}); }
          })();
          pending.add(run); void run.finally(() => pending.delete(run));
          return run;
        });
      }
      if (req.waitForMountsMs) await page.addInitScript(watchMounts);
      // Data reads in flight, and when the last one ended: a capture waits until the page's data has arrived and drawn.
      const reads = new Set<unknown>(), pageOrigin = new URL(req.url).origin;
      let lastRead = 0;
      page.on('request', request => { if (isDataRead(request.url(), pageOrigin)) reads.add(request); });
      const ended = (request: unknown) => { if (reads.delete(request)) lastRead = Date.now(); };
      page.on('requestfinished', ended); page.on('requestfailed', ended);
      await page.goto(req.url, { waitUntil: 'load', timeout }).catch((e) => { throw deadlineElapsed(e) ? new Error('Render deadline') : new NavigationError((e as Error).message); });
      if (req.injectCss) await page.addStyleTag({ content: req.injectCss }).catch(() => {});
      const surface = page.locator(req.selector).first();
      // A slide capture counts what the page drew. A deck whose script drew no slide leaves an empty body (its fixed
      // chrome takes no height), which never becomes visible: waiting for that spent the whole deadline and answered
      // `failed`, where the answer is no_slide with a count of 0.
      const slideCapture = 'capture' in req && typeof req.capture === 'object' && req.capture !== null && 'slide' in req.capture && !!req.capture.slide;
      await surface.waitFor({ timeout, state: slideCapture ? 'attached' : 'visible' });
      // SSR emits pending diagram markers before hydration. Wait through the
      // lazy engine and image decode; a handled syntax error is also settled.
      await page.waitForFunction(selector => {
        const root = document.querySelector(selector);
        return !!root && !root.matches('[data-mx-mermaid-state="pending"]') && !root.querySelector('[data-mx-mermaid-state="pending"]');
      }, req.selector, { timeout });
      if(req.waitForManagedFrames)await page.waitForFunction(selector=>{
        const root=document.querySelector(selector);if(!root)return false;
        return [...root.querySelectorAll('[data-mx-managed-frame]')].every(host=>host.querySelector('iframe[data-mx-author-ready]'));
      },req.selector,{timeout});
      // The page's script renders its components a moment after load; a mount still on its fallback at the cap is
      // photographed as it stands (never a failure: the fallback is a page, a component that never mounts is the author's).
      if (req.waitForMountsMs) await page.waitForFunction(mountsRendered, req.selector, { timeout: Math.min(req.waitForMountsMs, remaining()) }).catch(() => { remaining(); });
      await page.waitForTimeout(req.settleMs ?? DEFAULT_SETTLE_MS);
      // A page drawn from its data (sql, GraphQL, functions) is ready once no read is in flight and the last one ended a
      // moment ago. A read that never ends runs into the deadline: a failed render, never an image without its data.
      for (;;) {
        const wait = reads.size ? DATA_QUIET_MS : lastRead + DATA_QUIET_MS - Date.now();
        if (wait <= 0) break;
        await page.waitForTimeout(Math.min(wait, remaining()));
        remaining();
      }
      // Readiness covers lazy placeholders and Vega's asynchronous work. Two
      // frames ensure an app handoff cannot expose a transient empty state.
      const waitForCharts=async()=>{
        for(;;){
          // Playwright treats a returned Promise as truthy; the polled predicate
          // must be synchronous. Await animation frames separately, then recheck.
          await page.waitForFunction(chartsSettled,req.selector,{timeout:remaining()});
          await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
          if(await page.evaluate(chartsSettled,req.selector))return;
          remaining();
        }
      };
      await waitForCharts();
      return await use({ page, surface, timeout, remaining, waitForCharts });
    } catch (error) {
      if (crashed) throw new RendererStopped(`the page was stopped: it used more than ${Math.round(limits.bytes / 1048576)} MB of memory or ${limits.threads} threads (each worker is one), or its renderer crashed`);
      throw error;
    } finally {
      forwarding.abort();
      await Promise.allSettled(pending);
      clearTimeout(renderTimer);
      if (context) await (deadlineClose ?? closePage(on, context, lease.browser));
      on.unwatch();
      await egress?.close();
      lease.release();
    }
  }

  async function shoot(req: RenderRequest): Promise<{ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }> {
    const requestedCrop = typeof req.capture === 'object' && 'card' in req.capture ? req.capture.card : null;
    // A crop narrower than the output must be RASTERIZED at the corresponding
    // density. Scaling a 637px screenshot to 1600px only enlarges its pixels.
    const cardDensity = requestedCrop
      ? clamp(req.viewport.width / Math.max(1, requestedCrop.width), 1, 4)
      : 1;
    const element = typeof req.capture === 'object' && 'element' in req.capture ? req.capture : null;
    // An element is drawn at twice its CSS pixels, so a chart dropped into a slide stays sharp (see ELEMENT_CAPTURE).
    return withReadyPage(exportsLane, req, element ? ELEMENT_CAPTURE.density : cardDensity, async ({ page, surface, timeout, waitForCharts }) => {
      const shotOpts = { timeout, ...(req.format === 'jpg' ? { type: 'jpeg' as const, quality: req.quality ?? 85 } : { type: 'png' as const }) };
      const mime = req.format === 'jpg' ? 'image/jpeg' as const : 'image/png' as const;
      const slideNumber = typeof req.capture === 'object' && 'slide' in req.capture ? req.capture.slide ?? 0 : 0;
      let slide: Locator | null = null;
      if (slideNumber > 0) {
        // Number the slides the author check counts (toolbox-check-capture.mjs and toolbox-check-slides.mjs, pinned
        // alike by a stacked deck in contract.test.ts and session-pages.test.ts): laid out and outside deck chrome,
        // so the hidden rail miniatures bare readers keep for hydration take no number. A stacked deck hides all but
        // its active slide; the slide is marked and revealed alone, the others hidden, as the check draws it.
        const slides = surface.locator('[data-af-slide]');
        const laid = await slides.evaluateAll(els => els.flatMap((el, i) => {
          const box = el.getBoundingClientRect();
          return !el.closest('[data-af-deck-chrome]') && box.width > 1 && box.height > 1 ? [i] : [];
        }));
        if (slideNumber > laid.length) throw new NoSlideError(laid.length);
        slide = slides.nth(laid[slideNumber - 1]!);
        await slide.evaluate(el => el.setAttribute('data-af-slide-shot', ''));
        await page.addStyleTag({ content: SLIDE_REVEAL_CSS });
        await slide.scrollIntoViewIfNeeded({ timeout });
      }
      if (element) {
        // Matched under the slide when one was asked for, else under the surface; shot by the mark, at 1x past half the cap.
        const marked = await (slide ?? surface).evaluate(markElement, { selector: element.element, mark: ELEMENT_SHOT, max: ELEMENT_CAPTURE.maxCssPx });
        if (marked.why) throw new NoElementError({ ok: false, reason: 'no_element', ...marked });
        const one = page.locator(`[${ELEMENT_SHOT}]`).first();
        await one.scrollIntoViewIfNeeded({ timeout });
        await waitForCharts();
        const dense = Math.max(marked.width, marked.height) * ELEMENT_CAPTURE.density <= ELEMENT_CAPTURE.maxCssPx;
        return { mime, bytes: new Uint8Array(await one.screenshot({ ...shotOpts, style: DECK_CHROME_HIDDEN, ...(dense ? {} : { scale: 'css' as const }) })) };
      }
      if (slide) {
        await waitForCharts();
        return { mime, bytes: new Uint8Array(await slide.screenshot({ ...shotOpts, style: DECK_CHROME_HIDDEN })) };
      }
      if (req.capture === 'full') return { mime, bytes: new Uint8Array(await surface.screenshot(shotOpts)) };
      if (req.capture === 'preview' || typeof req.capture === 'object') {
        const { width: outputWidth, height: outputHeight } = req.viewport;
        const box = (await surface.boundingBox()) ?? { x: 0, y: 0, width: outputWidth, height: outputHeight };
        const crop = requestedCrop;
        const sourceWidth = crop
          ? clamp(crop.width, 1, Math.max(1, box.width))
          : Math.min(Math.max(1, box.width), outputWidth);
        const sourceHeight = crop
          ? sourceWidth * outputHeight / outputWidth
          : Math.max(1, box.height);
        const x = crop ? clamp(crop.x, 0, Math.max(0, box.width - sourceWidth)) : 0;
        const y = crop ? clamp(crop.y, 0, Math.max(0, box.height - sourceHeight)) : 0;
        if (crop) {
          // page.screenshot honors deviceScaleFactor; CDP clip.scale does not
          // increase raster density and produced a visibly enlarged bitmap.
          const initialScrollY = await page.evaluate(() => window.scrollY);
          const documentY = initialScrollY + box.y + y;
          await page.evaluate((top) => window.scrollTo(0, top), documentY);
          const scrollY = await page.evaluate(() => window.scrollY);
          await waitForCharts();
          const bytes = await page.screenshot({
            // Keep the high-density intermediate lossless. JPEG is encoded
            // once, after the fractional clip is normalized to exact output.
            type: 'png',
            timeout,
            clip: { x: box.x + x, y: documentY - scrollY, width: sourceWidth, height: sourceHeight },
          });
          // Fractional clip edges round at device pixels. The public contract
          // remains exact even when the chosen width is not a clean divisor.
          const exactPipeline = sharp(bytes).resize(outputWidth, outputHeight, { fit: 'fill' });
          const exact = req.format === 'jpg'
            ? await exactPipeline.jpeg({ quality: req.quality ?? 85 }).toBuffer()
            : await exactPipeline.png().toBuffer();
          return { mime, bytes: new Uint8Array(exact) };
        }
        const client = await page.context().newCDPSession(page);
        try {
          const scale = Math.min(PREVIEW_WIDTH / sourceWidth, PREVIEW_MAX_HEIGHT / sourceHeight);
          await waitForCharts();
          const captured = await client.send('Page.captureScreenshot', {
            format: req.format === 'jpg' ? 'jpeg' : 'png',
            ...(req.format === 'jpg' ? { quality: req.quality ?? 85 } : {}),
            fromSurface: true,
            captureBeyondViewport: true,
            clip: {
              x: box.x + x,
              y: box.y + y,
              width: sourceWidth,
              height: sourceHeight,
              scale,
            },
          });
          const bytes = Buffer.from(captured.data, 'base64');
          return { mime, bytes: new Uint8Array(bytes) };
        } finally {
          await client.detach().catch(() => {});
        }
      }
      // card: clip the PAGE to the surface's top stage; grow the viewport by the surface's offset so the clip is full height.
      const { width, height } = req.viewport;
      let box = (await surface.boundingBox()) ?? { x: 0, y: 0, width, height };
      await page.setViewportSize({ width, height: Math.ceil(box.y) + height });
      box = (await surface.boundingBox()) ?? box;
      await waitForCharts();
      const bytes = await page.screenshot({ clip: { x: box.x, y: box.y, width: Math.min(box.width, width) || width, height }, ...shotOpts });
      return { mime, bytes: new Uint8Array(bytes) };
    });
  }

  /** One load's drawings, bounded (SVG_HARVEST_LIMITS); the page is the ready page above. */
  async function harvestOnce(req: SvgHarvestRequest): Promise<HarvestedSvg[]> {
    return withReadyPage(exportsLane, req, 1, async ({ page }) => {
      const found = await page.evaluate(collectDrawings, { selector: req.selector, collect: req.collect, limit: SVG_HARVEST_LIMITS.images + 1 });
      if (found.length > SVG_HARVEST_LIMITS.images) throw new Error('Too many drawings');
      let total = 0;
      return found.map(({ attributes, width, height, src }) => {
        const svg = svgFromDataUrl(src);
        total += svg.length;
        if (svg.length > SVG_HARVEST_LIMITS.imageBytes || total > SVG_HARVEST_LIMITS.totalBytes) throw new Error('Drawings too large');
        return { attributes, width, height, svg };
      });
    });
  }

  /** One load's problems (PageInspectRequest): listened for from the first request, components read once it is ready. */
  async function inspectOnce(req: PageInspectRequest): Promise<{ problems: PageProblem[]; truncated: boolean; image?: PageImage }> {
    const found = problemList(), refused = new Set<string>(), pageOrigin = new URL(req.url).origin;
    let image: PageImage | undefined;
    try {
      await withReadyPage(checksLane, req, 1, async ({ page, timeout }) => {
        for (const failure of await page.evaluate(collectFailures, { selector: req.selector, limit: PAGE_PROBLEM_LIMITS.problems + 1 })) found.add(failure);
        for (const faint of await page.evaluate(collectUnreadable, { selector: req.selector, floor: READABLE_CONTRAST, limit: PAGE_PROBLEM_LIMITS.problems + 1 }).catch(() => [])) found.add(faint);
        if (req.overflow) for (const wide of await page.evaluate(collectOverflow).catch(() => [])) found.add(wide);
        if (!req.screenshot) return;
        // The top of the page as it stood once read, unscaled, each side capped; a quality that fits the bound, else no picture.
        const tall = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
        const height = Math.max(1, Math.min(Math.ceil(tall), PAGE_IMAGE_LIMITS.height)), width = Math.min(req.viewport.width, PAGE_IMAGE_LIMITS.width);
        for (const quality of [75, 50, 30]) {
          const bytes = await page.screenshot({ type: 'jpeg', quality, fullPage: true, clip: { x: 0, y: 0, width, height }, timeout });
          if (bytes.length <= PAGE_IMAGE_LIMITS.bytes) { image = { mime: 'image/jpeg', width, height, bytes: bytes.length, data: bytes.toString('base64') }; break; }
        }
      }, {
        refused: url => refused.add(url),
        page: page => {
          page.on('pageerror', error => found.add({ kind: 'script', message: error.message }));
          // A failed load is said once, as its request (below), not again as Chromium's console line about it.
          page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) found.add({ kind: 'console', message: message.text() }); });
          // A request this browser refused by its own rule (sameOriginOnly) may load for a reader: never the page's problem.
          page.on('requestfailed', request => { if (!refused.has(request.url())) found.add({ kind: 'request', message: `${request.method()} ${said(request.url(), pageOrigin)} failed: ${request.failure()?.errorText ?? 'no answer'}` }); });
          page.on('response', response => { if (response.status() >= 400) found.add({ kind: 'request', message: `${response.request().method()} ${said(response.url(), pageOrigin)} answered ${response.status()}` }); });
        },
      });
    } catch (error) {
      if (error instanceof NavigationError || error instanceof BrowserUnavailable) throw error;
      // What it showed until then is kept: a page stopped for what it used, or that never finishes drawing, is itself a problem.
      if (error instanceof RendererStopped) found.add({ kind: 'script', message: error.message });
      else found.add({ kind: 'timeout', message: 'the page did not finish loading and drawing in time' });
    }
    return { ...found.result(), ...(image ? { image } : {}) };
  }

  const started = createBrowserSessions(actor => {
    if (!opts.sessions) throw new Error('Browser session forwarding is not configured');
    return createSessionProcess(actor, opts.sessions);
  }, opts.sessions?.capacity);
  /*
   * SAID OUT LOUD, TWICE. `BROWSER__SANDBOX=none` is a development escape hatch, so the
   * boot says so once in the log for whoever started this process, and every session
   * result carries `sandbox:'none'` for whoever is reading over HTTP — a gate asserting
   * OS containment must be able to see that there is none and skip those checks by name
   * instead of being rewritten into something weaker.
   */
  const unsandboxed = opts.sessions?.sandbox?.mode === 'none';
  if (unsandboxed) console.warn('[browser] BROWSER__SANDBOX=none — browser sessions run as plain child processes with NO OS containment (development only)');
  const sessions: BrowserSessions = unsandboxed
    ? { close: () => started.close(), async request(input) { return { ...await started.request(input), sandbox: 'none' }; } }
    : started;
  const service:BrowserService & {close():Promise<void>;start():Promise<void>} = {
    sessions,
    async render(req): Promise<RenderResult> {
      if(opts.executablePath){try{executablePath=await opts.executablePath();}catch(error){return {ok:false,reason:'unavailable',detail:(error as Error).message};}}
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      const run = exportsLane.chain.then(() => {const remaining=deadline-Date.now();if(remaining<=0)throw new Error("Render timed out in queue");return shoot({...req,timeoutMs:remaining});}).then(
        (r): RenderResult => Date.now()>deadline ? {ok:false,reason:'failed',detail:'Render deadline'} : { ok: true, ...r, ...(typeof req.capture === 'object' && 'element' in req.capture ? { element: true as const } : {}) },
        (e): RenderResult => {
          if (e instanceof NoSlideError) return { ok: false, reason: 'no_slide', slides: e.slides };
          if (e instanceof NoElementError) return e.verdict;
          if (e instanceof NavigationError) return { ok: false, reason: 'navigation', detail: e.message };
          if (e instanceof BrowserUnavailable) return { ok: false, reason: 'unavailable', detail: e.message };
          return { ok: false, reason: 'failed', detail: (e as Error).message };
        },
      );
      exportsLane.chain = run;
      return run;
    },
    /**
     * THE DRAWINGS, AS TEXT (SvgHarvestRequest): the same ready page a render
     * photographs, on the same serialized chain and deadline, loaded `loads`
     * times in fresh pages; each load's drawings are bounded.
     */
    async harvestSvg(req): Promise<SvgHarvestResult> {
      if(opts.executablePath){try{executablePath=await opts.executablePath();}catch(error){return {ok:false,reason:'unavailable',detail:(error as Error).message};}}
      const loads = Math.min(Math.max(Math.trunc(req.loads ?? 1), 1), SVG_HARVEST_LIMITS.loads);
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      const run = exportsLane.chain.then(async () => {
        const answers: HarvestedSvg[][] = [];
        for (let load = 0; load < loads; load++) {
          const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Harvest timed out in queue');
          answers.push(await harvestOnce({ ...req, timeoutMs: remaining }));
        }
        return answers;
      }).then(
        (answers): SvgHarvestResult => Date.now()>deadline ? {ok:false,reason:'failed',detail:'Harvest deadline'} : { ok: true, loads: answers },
        (e): SvgHarvestResult => {
          if (e instanceof NavigationError) return { ok: false, reason: 'navigation', detail: e.message };
          if (e instanceof BrowserUnavailable) return { ok: false, reason: 'unavailable', detail: e.message };
          return { ok: false, reason: 'failed', detail: (e as Error).message };
        },
      );
      exportsLane.chain = run;
      return run;
    },
    /**
     * THE PAGE'S OWN PROBLEMS (PageInspectRequest): the same ready page, in the check browser, on its own serialized
     * chain and deadline, admitted first by its charges and the lane's room (./check-admission): `busy` or
     * `rate_limited` at once, never a queue past CHECK_LANE.
     */
    async inspect(req): Promise<PageInspection> {
      if(opts.executablePath){try{executablePath=await opts.executablePath();}catch(error){return {ok:false,reason:'unavailable',detail:(error as Error).message};}}
      const deadline=Date.now()+(req.timeoutMs??DEFAULT_TIMEOUT_MS);
      const admitted = admission.admit(Array.isArray(req.charge) ? req.charge : []);
      if (admitted === 'busy') return { ok: false, reason: 'busy', detail: `at most ${CHECK_LANE.running} check runs and ${CHECK_LANE.waiting} wait, and one of each caller's` };
      if (admitted === 'rate_limited') return { ok: false, reason: 'rate_limited' };
      const run = checksLane.chain.then(() => {const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Inspect timed out in queue');return inspectOnce({...req,timeoutMs:remaining});}).finally(() => admitted.release()).then(
        (found): PageInspection => ({ ok: true, ...found }),
        (e): PageInspection => {
          if (e instanceof NavigationError) return { ok: false, reason: 'navigation', detail: e.message };
          if (e instanceof BrowserUnavailable) return { ok: false, reason: 'unavailable', detail: e.message };
          return { ok: false, reason: 'failed', detail: (e as Error).message };
        },
      );
      checksLane.chain = run;
      return run;
    },
    /**
     * Ready to render, or why not: with BROWSER__RENDER_SANDBOX=chromium the export browser is launched once inside
     * its sandbox, and a host that cannot give it one is refused here, at boot, by name (never a silent fallback).
     */
    async start() {
      if (sandbox.mode !== 'chromium') return;
      if(opts.executablePath)executablePath=await opts.executablePath();
      try { (await exportsLane.holder.acquire(30_000)).release(); }
      catch (error) { throw new Error(`BROWSER__RENDER_SANDBOX=chromium, but Chromium could not start inside its sandbox (${(error as Error).message.split('\n')[0]}). The host must allow unprivileged user namespaces (SETUP.md, "On a server"); set BROWSER__RENDER_SANDBOX=none to accept rendering without it.`); }
    },
    async close() { await sessions.close(); await Promise.all([exportsLane.holder.close(), checksLane.holder.close()]); },
  };
  if(upload)service.renderAndUpload=async request=>{
    try{
      admittedUploadUrl(request.upload.url,upload);
      const deadline=Date.now()+(request.render.timeoutMs??DEFAULT_TIMEOUT_MS);
      if(request.upload.contentType!==(request.render.format==='jpg'?'image/jpeg':'image/png'))throw new Error('Mismatched upload format');
      const result=await service.render(request.render);if(!result.ok)return result;
      const metadata=await sharp(result.bytes).metadata();
      await uploadImage(request.upload,result.bytes,upload,deadline-Date.now());
      return {ok:true,mime:result.mime,bytes:result.bytes.byteLength,width:metadata.width!,height:metadata.height!,...(result.element?{element:true as const}:{})};
    }catch{return {ok:false,reason:'failed',detail:'Export upload failed'};}
  };
  return service;
}

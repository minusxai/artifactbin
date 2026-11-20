/**
 * WHAT WENT WRONG IN A PAGE (PageInspectRequest): `inspectOnce(lane, req)` loads the page once on a render lane and
 * says its problems, each once and cut to PAGE_PROBLEM_LIMITS: failed components, script errors and console errors,
 * failed requests, text too faint to read, overflow when asked, and a page that never finished (`timeout`) or was
 * stopped for what it used. A page that could not be reached, or no browser, is thrown, not said as a problem.
 */
import type { PageImage, PageInspectRequest, PageProblem } from '@artifactbin/contracts/browser';
import { PAGE_IMAGE_LIMITS } from '@artifactbin/contracts/browser';
import { BrowserUnavailable } from './browser-holder';
import { NavigationError, RendererStopped, type RenderLane } from './render-lane';

const PAGE_PROBLEM_LIMITS = { problems: 20, message: 500, element: 40, code: 64, label: 120 } as const;

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

/** One load's problems (PageInspectRequest) on `lane`: listened for from the first request, components read once it is ready. */
export async function inspectOnce(lane: RenderLane, req: PageInspectRequest): Promise<{ problems: PageProblem[]; truncated: boolean; image?: PageImage }> {
  const found = problemList(), refused = new Set<string>(), pageOrigin = new URL(req.url).origin;
  let image: PageImage | undefined;
  try {
    await lane.readyPage(req, 1, async ({ page, timeout }) => {
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

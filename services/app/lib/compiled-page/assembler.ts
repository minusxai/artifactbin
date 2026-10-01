/**
 * THE READER PAGE ASSEMBLER (docs/phase2-architecture.md §2.2, §8, §9; contract AssembleInput).
 *
 * ONE pure function turns a compiled version plus one request's overlay into
 * the whole HTML document every reader path serves: `/a/:id` (server-rendered
 * reader chrome, the Solid app loaded on idle), `/raw` (neither), and the
 * domain post, export, offline file and CLI preview that are one or the other.
 * No I/O, no database, no clock: the same input is the same bytes.
 *
 * What it adds to the stored, per-version parts is what one request decides:
 *   - the story element (lib/story/inline-story-html) around `input.story` —
 *     the serve path's render, placed verbatim and never re-rendered here —
 *     with the snapshot's server-drawn charts put into their slots;
 *   - the island data as `<script type="application/json" id="mx-story-data">`,
 *     every `<`, `>`, U+2028 and U+2029 escaped, only on a page that boots — the
 *     version's author script among it, as data for the sandboxed author frame;
 *   - the per-document module, its shared closure preloaded, and the idle SPA
 *     entry — every script a same-origin `src`, so the page runs under
 *     `script-src 'self'` with NO inline script at all;
 *   - link hints: never eager — every one (`prefetch`'s full list, `prerender`'s
 *     first few) waits for hover or press intent inside ONE speculation-rules
 *     file, named by the `Speculation-Rules` header the page returns (never an
 *     inline `<link rel="prefetch">`, which the parser would fetch on load).
 *
 * Head order: fonts first (they block text), then the page's own module
 * closure, then the styles. The SPA's preloads go last, at the end of the
 * body: the app is the reader's second screen, and its bytes must never race
 * the ones the first screen paints with.
 */
import { agentDiscoveryHead, agentDiscoveryTail } from '@/lib/serving/agent-discovery';
import type { IslandPageData } from '@/lib/islands/contract';
import { STORY_CHROME_CSS } from '@/lib/story-runtime/chrome-css';
import type { OutlineEntry } from '@/lib/story-runtime/outline';
import { STORY_ROOT_ID } from '@/lib/story-runtime/contract';
import { fontPreloadTags } from '@/lib/story/styles';
import { inlineStoryElement } from '@/lib/compiled-page/story-element';
import { escapeHtml, scriptJson } from '@artifactbin/utils/escape';
import { renderReaderChrome } from '@/lib/story/reader';
import { APP_BAR_H } from '@/lib/story/reader';
import { APP_FONT_FACES, APP_SHELL_FONT_PRELOADS } from '@/lib/serving/app-fonts';
import { DOCUMENT_ROOT_CSS } from '@/lib/story/styles';
import {
  CHART_SLOT_ATTR, CHART_STATE_ATTR, ISLAND_DATA_ID, SIGNED_IN_HINT_ATTR, SPA_IDLE_ATTR, SPECULATION_RULES_HEADER,
  type AssembleHead, type AssembleInput, type AssembleReaderPage, type AssembledPage, type CompilerBuild, type DrawnChart,
} from './contract';
import { splitCarriers, withStoredCarriers } from './carriers';
import { bindModuleRef } from './runtime-binding';
import { speculationRulesOf } from './speculation';

/** The first-paint outline has no event handlers; the app attaches navigation after adoption. */
function renderOutlineRail(entries: readonly OutlineEntry[]): string {
  let section = 0;
  const rows = entries.map((entry) => {
    if (entry.level === 2) section++;
    const label = entry.level === 2 ? `Go to section ${section}: ${entry.title}` : `Go to ${entry.title}`;
    const cls = entry.level === 3 ? 'mx-outline-row mx-outline-sub' : 'mx-outline-row';
    return `<button type="button" class="${cls}" aria-label="${escapeHtml(label)}" data-mx-target="${escapeHtml(entry.path)}">${escapeHtml(entry.title)}</button>`;
  }).join('');
  return `<nav class="mx-outline" aria-label="Contents"><div class="mx-outline-label">Contents</div>${rows}</nav>`;
}

export const assembleReaderPage: AssembleReaderPage = (input: AssembleInput): AssembledPage => {
  const { compiled, overlay, chrome, spa, build } = input;
  const help = input.head?.help ?? null;
  // The stored module names the runtime by specifier; its URL and preload closure are this build's.
  const module = compiled.module ? bindModuleRef(compiled.module, build) : null;

  // Request-specific SSR replaces visible HTML, while immutable browser carriers still belong
  // to the compiled module and may exist only in its stored first render.
  const { story: storySource, moduleData, literals } = splitCarriers(withStoredCarriers(input.story, compiled.html));
  const storyHtml = fillChartSlots(storySource, input.snapshot?.drawings ?? {});
  const withOutline = input.documentChrome !== false && compiled.outline?.length
    ? `<div class="${compiled.outlinePlan ? 'mx-reading mx-reading--plan' : 'mx-reading'}">${renderOutlineRail(compiled.outline)}${storyHtml}</div>`
    : storyHtml;
  const story = storyElement(withOutline, input.colorMode, input.theme);

  const islandPreloads = module ? unique([module.url, ...module.imports]) : [];
  const behaviorSrcs = unique(compiled.behaviors.map((behavior) => behaviorUrl(build, behavior)).filter((url): url is string => !!url));
  const rules = speculationRulesOf(compiled.links);
  // The app shell normally defines this body face in shell.css. A compiled first paint
  // runs before that stylesheet, while Mermaid measures sequence labels against body.
  const appMonoFaces = spa ? APP_FONT_FACES.filter((face) => face.family === 'JetBrains Mono Variable' && face.style === 'normal')
    .map((face) => `@font-face{font-family:"${face.family}";font-style:${face.style};font-display:${face.display};font-weight:${face.weight};src:url("${face.url}") format("${face.format}");${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`).join('') : '';

  const head =
    '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    // The agent pointer ahead of every preload and style, as server/app's withAgentDiscovery places it:
    // a shell tool that keeps only a page's first few kilobytes still sees it.
    + (help ? agentDiscoveryHead(help) : '')
    // A chrome-less page is the framed or standalone copy (/raw): its links leave the frame, as today's.
    + (chrome ? '' : '<base target="_top">')
    + `<title>${escapeHtml(input.title)}</title>`
    + headMetadata(input.head)
    + fontPreloadTags(unique([...input.fontPreloads, ...(spa ? APP_SHELL_FONT_PRELOADS : [])]), Boolean(spa))
    + islandPreloads.map(modulePreload).join('')
    + (input.sheets
      // Today's standalone document's sheets, exactly (lib/story/styles/document-styles).
      ? `<style>${DOCUMENT_ROOT_CSS}</style>` + input.sheets.map((sheet) => styleTag(sheet.attr, sheet.css)).join('')
      : `<style>${appMonoFaces}:root{--mx-vh:100vh${spa ? ';--font-mono:"JetBrains Mono Variable",ui-monospace,"SF Mono",Menlo,monospace' : ''}}body{margin:0${spa ? ';font-size:14px;font-family:var(--font-mono)' : ''}}</style>`)
    + (chrome ? styleTag('data-mx-chrome', STORY_CHROME_CSS) : '')
    // The page the app adopts (/a/:id): its bar is the top of the page from a phone's width up, so the
    // story reserves it before first paint and the app's arrival moves nothing. On <body>: the story
    // root is the body's own child (a rule on the root itself does not hold).
    // Its ground too: the document's own (solid/pages/Document DOCUMENT_GROUND), never the app's dotted
    // page, so a reload (leaving edit mode) does not flash the dots in the margins before the app adopts it.
    + (spa ? styleTag('data-mx-app-reserve', `@media(min-width:640px){body:has(> [data-mx-inline-story]){padding-top:${APP_BAR_H}px}}`
      + 'body:has(> [data-mx-inline-story]){background:#ffffff;background-image:none}body:has(> [data-mx-inline-story].dark){background:#0b0b0c}') : '')
    + (input.css && !input.sheets ? styleTag('data-mx-story-css', input.css) : '')
    + (input.footer?.css ? styleTag('data-mx-footer-css', input.footer.css) : '');

  const body =
    story
    + literals
    + (chrome ? renderReaderChrome(chrome) : '')
    // Page furniture after the story root, never inside it: the hydrated tree never sees it.
    + (input.footer?.html ?? '')
    + (module ? `<script type="application/json" id="${ISLAND_DATA_ID}">${scriptJson({ ...islandData(input), ...(moduleData ? { moduleData } : {}) })}</script>` : '')
    + behaviorSrcs.map((src) => moduleScript(src)).join('')
    + (module ? moduleScript(module.url) : '')
    + (spa ? unique(spa.preload).map(modulePreload).join('') + moduleScript(spa.entry, ` ${SPA_IDLE_ATTR}=""`) : '')
    // The pointer again as the page's LAST line, for a reader that keeps only the tail (lib/agent-discovery).
    + (help ? agentDiscoveryTail(help) : '');

  const html =
    `<!doctype html><html class="${escapeHtml(input.colorMode)}"`
    // The standalone document's sheets name the theme on the DOCUMENT element (`:root:where([data-theme])`).
    + (input.sheets && input.theme ? ` data-theme="${escapeHtml(input.theme)}"` : '')
    + `${overlay.signedIn ? ` ${SIGNED_IN_HINT_ATTR}=""` : ''}>`
    + `<head>${head}</head><body${liveAttrs(input.live ?? null)}>${body}</body></html>`;

  const headers: Record<string, string> = {};
  if (rules) headers[SPECULATION_RULES_HEADER] = `"${rules.url}"`;
  // The same pointer as a header, for a fetch that reads no body (as /a/:id and /raw answer today).
  if (help) headers.Link = `<${help.url}>; rel="help"`;
  return { html, headers };
};

/* ──────────────────────────────────────────────────────────────────────────
 * The pieces
 * ────────────────────────────────────────────────────────────────────────── */

const unique = (urls: readonly string[]): string[] => [...new Set(urls)];

/** The document's live identity on `<body>`, which the island runtime's boot opens the live stream from. */
const liveAttrs = (live: AssembleInput['live']): string =>
  (live ? ` data-mx-live-id="${escapeHtml(live.id)}" data-mx-live-edit="${escapeHtml(live.editId)}"` : '');

/**
 * `crossorigin` on every module fetch, script and preload alike: a `/raw` copy
 * has an OPAQUE origin, so its module fetches are cross-origin (the /islands
 * routes answer ACAO for it), and a preload whose mode differs from its script
 * warms an entry the script cannot use.
 */
const modulePreload = (href: string): string => `<link rel="modulepreload" href="${escapeHtml(href)}" crossorigin>`;
const moduleScript = (src: string, attrs = ''): string => `<script type="module" src="${escapeHtml(src)}" crossorigin${attrs}></script>`;

/**
 * The description, canonical link and social card the reader paths emit today
 * (server/app withInitialStory, lib/story/document): `og:description` falls
 * back to the page description, as the app page's does.
 */
function headMetadata(head: AssembleHead | null): string {
  if (!head) return '';
  const { description = null, canonical = null, social = null } = head;
  const socialDescription = social?.description ?? description;
  return (canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : '')
    + (description ? `<meta name="description" content="${escapeHtml(description)}">` : '')
    + (social
      ? `<meta property="og:title" content="${escapeHtml(social.title)}">`
        + (socialDescription ? `<meta property="og:description" content="${escapeHtml(socialDescription)}">` : '')
        + `<meta property="og:image" content="${escapeHtml(social.image)}">`
        + '<meta name="twitter:card" content="summary_large_image">'
      : '');
}

/** `</style` inside CSS would close the element early; CSS has no use for the sequence (lib/story/document's rule). */
const styleTag = (attr: string, css: string): string => `<style ${attr}>${css.replace(/<\/style/gi, '')}</style>`;

/** A behaviour chunk by its specifier in the shared manifest (`@mx/deck`), or by its short name (`deck`). */
function behaviorUrl(build: CompilerBuild, behavior: string): string | null {
  return build.manifest[behavior] ?? build.manifest[`@mx/${behavior}`] ?? null;
}

/** The story element, carrying the id the island runtime and the SPA find it by. */
function storyElement(body: string, colorMode: string, theme: string | null): string {
  const element = inlineStoryElement(body, colorMode, theme);
  if (!element.startsWith('<div ')) throw new Error('assembler: the story element is not a <div>');
  return `<div id="${STORY_ROOT_ID}" ${element.slice('<div '.length)}`;
}

function islandData(input: AssembleInput): IslandPageData {
  const { overlay } = input;
  return {
    values: overlay.values,
    ...(input.compiled.templateBrBytes != null ? { templateBrBytes: input.compiled.templateBrBytes } : {}),
    ...(overlay.state ? { state: overlay.state } : {}),
    results: input.snapshot?.results ?? null,
    appPage: input.spa !== null,
    ...(overlay.doors ?? {}),
    ...((overlay.assetsUrl ?? overlay.doors?.assetsUrl) ? { assetsUrl: overlay.assetsUrl ?? overlay.doors?.assetsUrl } : {}),
    ...(overlay.managedAssets ? { managedAssets: overlay.managedAssets } : {}),
    signedIn: overlay.signedIn,
    hold: [...(overlay.hold ?? [])],
    ...(overlay.sqliteWasm ? { sqliteWasm: overlay.sqliteWasm } : {}),
    ...(overlay.quickjsWasm ? { quickjsWasm: overlay.quickjsWasm } : {}),
    mermaidImages: overlay.mermaidImages,
    readOnly: overlay.readOnly ?? null,
    // The version's author script rides as DATA (escaped by scriptJson), for boot's lazy author realm to
    // run in its interpreter; it is never a script of this page (contract CompiledPage.authorScript).
    ...(input.compiled.authorScript ? { authorScript: input.compiled.authorScript } : {}),
  };
}

/**
 * JSON that is inert inside `<script type="application/json">`: no `<` or `>`
 * survives, so no `</script>` or `<!--` in any value can end or bend the
 * element, and U+2028/9 are escaped so the text stays valid if anything ever
 * evaluates it as script.
 */
export { scriptJson };

/* ──────────────────────────────────────────────────────────────────────────
 * Chart slots
 *
 * The compiled story is serializer output (Solid and React SSR), so a small
 * tag scanner that honours quoted attribute values, comments and raw-text
 * elements finds a slot and its matching close reliably without parsing the
 * whole document into a tree and re-serialising it (which would change bytes
 * the parity gate compares). Only the slot's INNER HTML is replaced; the story
 * outside it is copied through unchanged.
 * ────────────────────────────────────────────────────────────────────────── */

interface Attr { name: string; value: string | null; start: number; end: number }
interface Tag { name: string; start: number; end: number; closing: boolean; selfClosing: boolean; attrs: Attr[] }

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const SPACE = /[\t\n\f\r ]/;

/** The tag whose `<` is at `at`, or null when that `<` opens no tag (it is text) or never closes. */
function tagAt(html: string, at: number): Tag | null {
  let i = at + 1;
  const closing = html[i] === '/';
  if (closing) i++;
  if (!/[A-Za-z]/.test(html[i] ?? '')) return null;
  const nameStart = i;
  while (i < html.length && !/[\t\n\f\r />]/.test(html[i]!)) i++;
  const name = html.slice(nameStart, i).toLowerCase();
  const attrs: Attr[] = [];
  let selfClosing = false;
  while (i < html.length) {
    const ch = html[i]!;
    if (SPACE.test(ch)) { i++; continue; }
    if (ch === '>') return { name, start: at, end: i + 1, closing, selfClosing, attrs };
    if (ch === '/') { selfClosing = html[i + 1] === '>'; i++; continue; }
    const start = i;
    // The first character is part of the name whatever it is (even `=`), as the HTML tokenizer has it.
    i++;
    while (i < html.length && !/[\t\n\f\r />=]/.test(html[i]!)) i++;
    const attrName = html.slice(start, i).toLowerCase();
    let j = i;
    while (SPACE.test(html[j] ?? '')) j++;
    let value: string | null = null;
    if (html[j] === '=') {
      j++;
      while (SPACE.test(html[j] ?? '')) j++;
      const quote = html[j];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, j + 1);
        if (close < 0) return null;
        value = html.slice(j + 1, close);
        j = close + 1;
      } else {
        const valueStart = j;
        while (j < html.length && !/[\t\n\f\r >]/.test(html[j]!)) j++;
        value = html.slice(valueStart, j);
      }
      i = j;
    }
    attrs.push({ name: attrName, value, start, end: i });
  }
  return null;
}

/**
 * Every tag in document order; comments and doctypes are stepped over, and so
 * is raw-text content (a `<style>`'s CSS) unless `rawText` is false — which a
 * drawing is scanned with, since inside an <svg> the parser reads a `<title>`
 * or `<style>` as ordinary elements and a `</svg>` in one WOULD close the root.
 */
function tagsOf(html: string, rawText = true): Tag[] {
  const tags: Tag[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      if (close < 0) break;
      i = close + 3;
      continue;
    }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') {
      const close = html.indexOf('>', lt);
      if (close < 0) break;
      i = close + 1;
      continue;
    }
    const tag = tagAt(html, lt);
    if (!tag) { i = lt + 1; continue; }
    tags.push(tag);
    i = tag.end;
    if (rawText && !tag.closing && !tag.selfClosing && RAW_TEXT.has(tag.name)) {
      const end = new RegExp(`</${tag.name}[\\t\\n\\f\\r />]`, 'ig');
      end.lastIndex = i;
      const found = end.exec(html);
      if (!found) break;
      i = found.index;
    }
  }
  return tags;
}

/** The index in `tags` of the close matching the open tag at `open`, or -1. */
function matchingClose(tags: readonly Tag[], open: number): number {
  const name = tags[open]!.name;
  let depth = 1;
  for (let k = open + 1; k < tags.length; k++) {
    const tag = tags[k]!;
    if (tag.name !== name) continue;
    if (tag.closing) { if (--depth === 0) return k; } else if (!tag.selfClosing && !VOID.has(name)) depth++;
  }
  return -1;
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
/** An attribute value as the browser reads it, for the entities a serializer writes; any other entity is kept verbatim. */
function decodeAttr(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? whole;
    const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** Each chart slot with a stored drawing gets it as its content and `data-mx-chart-state="ready"`; every other slot keeps its skeleton. */
function fillChartSlots(html: string, drawings: Readonly<Record<string, DrawnChart>>): string {
  if (!Object.keys(drawings).length || !html.includes(CHART_SLOT_ATTR)) return html;
  const tags = tagsOf(html);
  let out = '';
  let copied = 0;
  for (let k = 0; k < tags.length; k++) {
    const tag = tags[k]!;
    if (tag.closing || tag.selfClosing || VOID.has(tag.name)) continue;
    const slot = tag.attrs.find((attr) => attr.name === CHART_SLOT_ATTR);
    if (!slot?.value) continue;
    const id = decodeAttr(slot.value);
    const drawing = Object.hasOwn(drawings, id) ? drawings[id] : undefined;
    if (!drawing || !isInertSvg(drawing.svg)) continue;
    const close = matchingClose(tags, k);
    if (close < 0) continue;
    const state = tag.attrs.find((attr) => attr.name === CHART_STATE_ATTR);
    const ready = `${CHART_STATE_ATTR}="ready"`;
    const open = state
      ? html.slice(tag.start, state.start) + ready + html.slice(state.end, tag.end)
      : `${html.slice(tag.start, tag.end - 1)} ${ready}>`;
    out += html.slice(copied, tag.start) + open + drawing.svg.trim();
    copied = tags[close]!.start;
    k = close;
  }
  return out + html.slice(copied);
}

/*
 * A drawing is inserted as markup, so it must be one inert <svg> and nothing
 * else: the elements a chart renderer draws with, no event handler, no link
 * that is not http(s), a same-page fragment or an image. Anything outside that
 * (a script, a foreignObject, an animation that could rewrite an href, text
 * after the root) is not placed: the slot keeps its skeleton and the island
 * draws the chart itself.
 */
const DRAWING_TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath',
  'image', 'defs', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'a', 'title', 'desc',
]);
const SAFE_LINK = /^(?:https?:|\/(?!\/)|#|data:image\/(?:png|jpe?g|gif|webp);)/i;

export function isInertSvg(svg: string): boolean {
  const text = svg.trim();
  if (!text.startsWith('<svg') || text.includes('<!') || text.includes('<?')) return false;
  const tags = tagsOf(text, false);
  if (tags[0]?.name !== 'svg' || tags[0].start !== 0 || tags[0].closing) return false;
  const last = tags[tags.length - 1]!;
  if (!last.closing || last.name !== 'svg' || last.end !== text.length) return false;
  // Balanced, and the root closes last: nothing is auto-closed or left open for the parser to repair.
  const open: string[] = [];
  for (const [k, tag] of tags.entries()) {
    if (tag.closing) {
      if (open.pop() !== tag.name || (!open.length && k !== tags.length - 1)) return false;
    } else if (!tag.selfClosing) open.push(tag.name);
    if (!DRAWING_TAGS.has(tag.name)) return false;
    for (const attr of tag.attrs) {
      if (attr.name.startsWith('on')) return false;
      if (attr.name === 'href' || attr.name.endsWith(':href')) {
        const link = decodeAttr(attr.value ?? '').replace(/[\u0000-\u0020]/g, '');
        if (/&[a-z0-9#]+;/i.test(link) || !SAFE_LINK.test(link)) return false;
      }
    }
  }
  return open.length === 0;
}

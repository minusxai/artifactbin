/**
 * THE APP PAGE'S HTML: `renderAppPage(shell, parts)` turns the app shell (web/solid-app.html) into the page served at
 * one address: the agent pointer first in the head and last in the body, the first screen's fonts, a document's frame
 * and head (or the generic social card), the canonical link, the build, and the page's data (`withBootstrap`, at
 * BOOTSTRAP_ID), with the head reordered so code never starves what paints the story. Pure string work.
 */
import { agentDiscovery, agentDiscoveryBody, agentDiscoveryHead, withAgentDiscoveryTail } from '@/lib/agent-copy';
import { escapeHtml } from '@artifactbin/utils/escape';
import { type ArtifactRow } from '@/lib/artifacts';
import { withArtifactAppHead, DOCUMENT_FRAME_CSS, documentFrameFallback, documentFrameHtml, documentHeadTags, type DocumentFrame } from '@/lib/document-serving';
import { APP_BUILD_META } from '@/lib/http';
import { APP_SHELL_FONT_PRELOADS, fontPreloadTags } from '@/lib/page-styles';
import { listingPage, type ListingPage } from './reader-preloads';
import type { Bootstrap } from './document-address';

/**
 * The `<link rel="help">` and agent metadata an agent that fetched any page reads, on the caller's
 * base — FIRST in the head, ahead of every preload and stylesheet link Vite stamps into the shell, so a
 * shell tool that keeps only the first few kilobytes of a page still sees them. A page with no `<head>`
 * at all gets them before `</head>`.
 */
function withAgentDiscovery(html: string, origin: string): string {
  const help = agentDiscovery(origin);
  const tags = agentDiscoveryHead(help);
  // Paint a product loading state before app JavaScript arrives. The app replaces
  // it on mount; agent discovery remains in the head, tail and noscript help.
  html = html.replace(/<div id="root">/i, (open) => `${open}${agentDiscoveryBody(help)}`);
  const open = /<head(?:\s[^>]*)?>/i.exec(html);
  if (open) return `${html.slice(0, open.index + open[0].length)}${tags}${html.slice(open.index + open[0].length)}`;
  return html.replace('</head>', () => `${tags}</head>`);
}

/**
 * The generic unfurl card, for an address with no document of its own to
 * photograph — the home page, login, a profile. Absolute against the request's
 * origin for the same reason the artifact tag below is: a relative og:image is
 * resolved by some scrapers against the page URL and by others not at all.
 * `public/og.png` is written by `npm run generate:og`.
 */
function withGenericSocial(html: string, origin: string): string {
  const tags = `<meta property="og:image" content="${escapeHtml(origin)}/og.png"><meta name="twitter:card" content="summary_large_image">`;
  return html.replace('</head>', () => `${tags}</head>`);
}

/**
 * The frame's one new connection, started from the head: its first URL is on the document's own origin, which spends
 * the ticket and serves the document in one response. The origin comes from the frame the server drew
 * (lib/document-serving/artifact-page), never from the request. It follows the agent pointer, which stays the head's first element.
 */
function withPreconnects(html: string, frame: DocumentFrame): string {
  let origin: string;
  try { origin = new URL(frame.src).origin; } catch { return html; }
  const tags = `<link rel="preconnect" href="${escapeHtml(origin)}">`;
  const after = /<meta name="cli"[^>]*>/i.exec(html) ?? /<head(?:\s[^>]*)?>/i.exec(html);
  return after ? `${html.slice(0, after.index + after[0].length)}${tags}${html.slice(after.index + after[0].length)}` : html;
}

/**
 * THE APP PAGE FOR A DOCUMENT: the shell, named in its head as the document (its title, description and social
 * card replace the shell's), with the document's frame as the body's first element — drawn by the server, so the
 * document loads with the page, not after the app's code (lib/document-serving/document-frame; solid/pages/Document adopts it).
 */
function withDocumentFrame(html: string, frame: DocumentFrame): string {
  const head = withPreconnects(html, frame)
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta name="description"[^>]*>/i, '')
    .replace('</head>', () => `${documentHeadTags(frame.head)}<style data-mx-frame-css>${DOCUMENT_FRAME_CSS}</style></head>`);
  return head.replace(/<body([^>]*)>/i, (open) => `${open}${documentFrameHtml(frame)}`)
    .replace(/<div id="root">/i, (open) => `${open}${documentFrameFallback(frame)}`);
}

/** The shell's first-screen face (lib/app-fonts), preloaded on a page with no document of its own. */
const withShellFonts = (html: string): string => html.replace('</head>', () => `${fontPreloadTags(APP_SHELL_FONT_PRELOADS)}</head>`);

/** Where the server hands the SPA a page's data so its FIRST paint is its final one. */
export const BOOTSTRAP_ID = 'mx-page-data';
/** `<` is the only character that can end a script element early; JSON never needs it. */
const safeJson = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
/**
 * The page's data rides at the END of the body — after the story the server
 * rendered, as the body's own last element — so the first paint never waits
 * for it to download. Still read before the app's first render: the SPA's
 * module runs after the document is parsed (solid/pages/bootstrap reads exactly this
 * element, a direct child of body, which no authored id inside the story can be).
 */
export const withBootstrap = (html: string, data: unknown): string => {
  // A function replacement keeps JavaScript's special replacement tokens in
  // user-authored JSON literal instead of expanding them with the HTML shell.
  const tag = `<script type="application/json" id="${BOOTSTRAP_ID}">${safeJson(data)}</script>`;
  const at = html.lastIndexOf('</body>');
  return at < 0 ? html.replace('</head>', () => `${tag}</head>`) : `${html.slice(0, at)}${tag}${html.slice(at)}`;
};

/**
 * THE HEAD IN THE ORDER A READER NEEDS IT. The story is readable before any
 * JavaScript runs, so code must not starve what paints it: the charset and
 * viewport, the render-blocking CSS, then the fonts the first screen paints —
 * at high priority — and only then the app's modules and their preloads,
 * which Vite writes early in the shell and the preloaders add at its end.
 */
// Every module script — inline ones too, so modules keep their relative (execution) order.
const MODULE_TAG = /<script\b[^>]*\btype=["']module["'][^>]*>[\s\S]*?<\/script>|<link\b[^>]*\brel=["']modulepreload["'][^>]*>/gi;
const FONT_PRELOAD = /<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']font["'][^>]*>/gi;
const STYLESHEET = /<link\b[^>]*\brel=["'](?:stylesheet|preload)["'][^>]*\bas=["']style["'][^>]*>|<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi;
/** `text` with every match of `pattern` taken out, and the matches, in order — a MOVE, never a filter. */
function lift(text: string, pattern: RegExp): { rest: string; lifted: string[] } {
  const lifted: string[] = [];
  let rest = '', at = 0;
  for (const m of text.matchAll(pattern)) { rest += text.slice(at, m.index); lifted.push(m[0]); at = m.index! + m[0].length; }
  return { rest: rest + text.slice(at), lifted };
}
/** Where the fonts go: after the render-blocking CSS, else the viewport, the charset, the agent pointer (always first), the head. */
function fontSlot(head: string): number {
  let cut = -1;
  for (const m of head.matchAll(STYLESHEET)) cut = m.index! + m[0].length;
  if (cut >= 0) return cut;
  for (const tag of [/<meta\b[^>]*name=["']viewport["'][^>]*>/i, /<meta\b[^>]*charset=[^>]*>/i, /<meta\b[^>]*name=["']cli["'][^>]*>/i, /<head\b[^>]*>/i]) {
    const m = tag.exec(head);
    if (m) return m.index + m[0].length;
  }
  return 0;
}
function withReaderHeadOrder(html: string): string {
  const end = html.indexOf('</head>');
  if (end < 0) return html;
  const code = lift(html.slice(0, end), MODULE_TAG);
  const faces = lift(code.rest, FONT_PRELOAD);
  const fonts = faces.lifted.map((tag) => (/\bfetchpriority=/i.test(tag) ? tag : `<link fetchpriority="high"${tag.slice('<link'.length)}`));
  const cut = fontSlot(faces.rest);
  return `${faces.rest.slice(0, cut)}${fonts.join('')}${faces.rest.slice(cut)}${code.lifted.join('')}${html.slice(end)}`;
}

/** What one address's page is made of; `preloadListing` adds a listing page's entry preloads. */
export interface PageParts {
  /** The caller's base (lib/http `baseUrl`), on which the agent pointer and social card are absolute. */
  origin: string;
  data: Bootstrap['data'] | null;
  frame: DocumentFrame | null;
  /** The address search engines index a document under (lib/user-pages canonicalDocumentUrl). */
  canonical?: string;
  /** The build this page is (lib/http/app-build), which the page compares with what the server says later. */
  build: string | null;
  appRow: ArtifactRow | null;
  preloadListing: (html: string, page: ListingPage) => string;
}

export function renderAppPage(html: string, p: PageParts): string {
  // The agent pointer is injected here, on the request base, for EVERY shell
  // — the static web/solid-app.html carries none, so there is one source (lib/compiled-page/agent-discovery).
  const discovered = withAgentDiscovery(html, p.origin);
  const listing = listingPage(p.data);
  const fonted = withShellFonts(listing ? p.preloadListing(discovered, listing) : discovered);
  const shell = p.frame ? withDocumentFrame(fonted, p.frame) : withGenericSocial(fonted, p.origin);
  const linked = p.canonical ? shell.replace('</head>', () => `<link rel="canonical" href="${escapeHtml(p.canonical!)}"></head>`) : shell;
  const indexed = p.build ? linked.replace('</head>', () => `<meta name="${APP_BUILD_META}" content="${p.build}"></head>`) : linked;
  const ordered = withReaderHeadOrder(p.appRow ? withArtifactAppHead(indexed, p.appRow) : indexed);
  // Last, so the pointer is the page's final line whatever else was inlined.
  return withAgentDiscoveryTail(p.data ? withBootstrap(ordered, p.data) : ordered, agentDiscovery(p.origin));
}

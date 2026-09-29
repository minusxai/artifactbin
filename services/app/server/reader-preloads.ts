import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from 'vite';
import type { LazyCode } from '@/lib/story/lazy-code';

/** Build-owned reader discovery. Hints never execute code or change access. */
type ReaderPreloader = (html: string) => string;

const READER_ENTRIES = ['pages/Profile.tsx', 'pages/Artifact.tsx'];
interface Hint { href: string; style: boolean; as?: 'image' }

const readManifest = (webDir: string): Manifest => JSON.parse(readFileSync(path.join(webDir, '.vite/manifest.json'), 'utf8'));

/** The entries' files, CSS and static dependencies, in discovery order. */
function closureHints(manifest: Manifest, entries: readonly string[]): Hint[] {
  const visited = new Set<string>(), hints = new Map<string, Hint>();
  const add = (file: string, style = false) => {
    if (!(style ? /^assets\/[\w.-]+\.css$/ : /^assets\/[\w.-]+\.js$/).test(file)) throw Error('Invalid reader asset path');
    hints.set(file, { href: '/' + file, style });
  };
  const visit = (key: string) => {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw Error('Missing reader manifest entry');
    add(chunk.file);
    for (const file of chunk.css ?? []) add(file, true);
    // Static dependencies may contain cycles. Dynamic descendants stay lazy:
    // chart/editor code must not become a prerequisite of reader startup.
    for (const dependency of chunk.imports ?? []) visit(dependency);
  };
  entries.forEach(visit);
  return [...hints.values()];
}

const readHints = (webDir: string, entries: readonly string[]): Hint[] => closureHints(readManifest(webDir), entries);

/** Head links for `hints`, skipping any href the head already names. */
function inject(html: string, hints: readonly Hint[]): string {
  const head = html.split('</head>')[0];
  const existing = new Set([...head.matchAll(/\bhref=["']([^"']+)["']/g)].map(match => match[1]));
  const seen = new Set<string>();
  const links = hints.filter(hint => !existing.has(hint.href) && !seen.has(hint.href) && seen.add(hint.href)).map(({ href, style, as }) =>
    as === 'image' ? `<link rel="preload" href="${href}" as="image">`
      : style ? `<link rel="preload" href="${href}" as="style" crossorigin>` : `<link rel="modulepreload" href="${href}" crossorigin>`).join('');
  return links ? html.replace('</head>', () => links + '</head>') : html;
}

/** Cache the production manifest per server; dev supplies its own HTML. */
export function createReaderPreloader(webDir: string): ReaderPreloader {
  return createEntryPreloader(webDir, READER_ENTRIES);
}

/**
 * A folder's listing is a separate React chunk, kept out of document readers.
 * The public profile index uses the Solid entry and its own route chunk.
 */
const LISTING_ENTRIES = {
  folder: ['pages/Profile.tsx', 'pages/Artifact.tsx', 'pages/Folder.tsx'],
} as const;
export type ListingPage = keyof typeof LISTING_ENTRIES;

/** Which listing page the server's inlined answer (server/app `bootstrapFor`) draws, if any. */
export function listingPage(data: { profile?: unknown; artifact?: unknown } | null): ListingPage | null {
  if ((data?.artifact as { folder?: unknown } | undefined)?.folder) return 'folder';
  return null;
}

export function createListingPreloader(webDir: string): (html: string, page: ListingPage) => string {
  const folder = createEntryPreloader(webDir, LISTING_ENTRIES.folder);
  return (html, _page) => folder(html);
}

/** Preload only a page’s selected entries and their static dependencies. */
export function createEntryPreloader(webDir: string, entries: readonly string[]): ReaderPreloader {
  let cached: Hint[] | undefined;
  return html => {
    if (!cached) {
      try { cached = readHints(webDir, entries); }
      catch {
        // A missing build hint must not take a readable document down. The
        // production browser gate verifies that the shipped manifest exists.
        console.warn('[reader] preload manifest unavailable; using lazy discovery');
        cached = [];
      }
    }
    return inject(html, cached);
  };
}

/** What a document's lazy code resolves to in the app's build. */
interface DocumentHints { chart: Hint[]; mermaid: Record<string, Hint[]> }

const CHART_MODULE = 'components/viz/VegaChart.tsx';
const MERMAID_ENGINE = 'components/kit/mermaid-render.ts';

/**
 * The Mermaid modules each diagram kind loads, recorded by the runtime build
 * (scripts/build-server-reader.mjs) beside the SSR bundle: Mermaid's dispatch
 * is read from the installed package there, and the kinds from the kit.
 */
const MERMAID_MODULES_FILE = path.resolve('lib/build-assets/mermaid-modules.json');

function readDocumentHints(webDir: string, mermaidModulesFile: string): DocumentHints {
  const manifest = readManifest(webDir);
  const keys = Object.keys(manifest);
  const keyFor = (suffix: string) => keys.find(key => key.endsWith(suffix));
  const chartKey = keyFor('/' + CHART_MODULE);
  const chart = chartKey ? closureHints(manifest, [chartKey]) : [];
  let kinds: Record<string, string[]> = {};
  try { kinds = (JSON.parse(readFileSync(mermaidModulesFile, 'utf8')) as { kinds?: Record<string, string[]> }).kinds ?? {}; }
  catch { console.warn('[reader] Mermaid module record unavailable; diagrams load by discovery'); }
  const engine = keyFor('/' + MERMAID_ENGINE);
  const mermaid: Record<string, Hint[]> = {};
  for (const [kind, modules] of Object.entries(kinds)) {
    // Recorded by their path below node_modules/, which is how a Vite manifest key ends too.
    const moduleKeys = Array.isArray(modules) ? modules.map(module => keyFor('/node_modules/' + module)) : [];
    // All or nothing: a kind whose modules this build cannot place is left to
    // load by discovery rather than preloaded in part.
    if (!engine || !moduleKeys.length || moduleKeys.some(key => !key)) continue;
    mermaid[kind] = closureHints(manifest, [engine, ...moduleKeys as string[]]);
  }
  return { chart, mermaid };
}

/**
 * Per DOCUMENT: the lazy code this document will run (lib/story/lazy-code) —
 * the chart module when it draws a chart, each Mermaid kind's engine, diagram
 * and layout closure for the kinds it draws — and never code it will not run.
 * Resolved once per server from the Vite manifest; a document with none gets
 * its HTML back unchanged.
 */
export function createDocumentPreloader(webDir: string, mermaidModulesFile = MERMAID_MODULES_FILE): (html: string, needs: LazyCode) => string {
  let cached: DocumentHints | undefined;
  return (html, needs) => {
    // A stored diagram drawing is the page's own paint: the first is asked for beside the code.
    const first = needs.mermaidImages?.[0];
    const image = first ? [{ href: first, style: false, as: 'image' as const }] : [];
    if (!needs.chart && !needs.mermaid.length) return image.length ? inject(html, image) : html;
    if (!cached) {
      try { cached = readDocumentHints(webDir, mermaidModulesFile); }
      catch {
        console.warn('[reader] preload manifest unavailable; using lazy discovery');
        cached = { chart: [], mermaid: {} };
      }
    }
    const { chart, mermaid } = cached;
    return inject(html, [...(needs.chart ? chart : []), ...needs.mermaid.flatMap(kind => mermaid[kind] ?? []), ...image]);
  };
}

/**
 * THE HTML-FIRST PAGE'S APP ENTRY (docs/phase2-architecture.md §2.2, §7): the small module the
 * compiled reader page tags `data-mx-spa-idle` (web/spa-idle.ts, its own Vite entry), which loads
 * the app only when it is wanted, and its static closure to `modulepreload`. Null when this build has
 * no such entry: the page is then the document and its islands without the app.
 */
export const SPA_IDLE_ENTRY = 'spa-idle.ts';
export const SOLID_SPA_IDLE_ENTRY = 'solid-spa-idle.ts';
export function createSpaEntry(webDir: string, key = SPA_IDLE_ENTRY): () => { entry: string; preload: string[] } | null {
  let cached: { entry: string; preload: string[] } | null | undefined;
  return () => {
    if (cached !== undefined) return cached;
    try {
      const manifest = readManifest(webDir);
      const chunk = manifest[key];
      if (!chunk) throw Error('no app idle entry');
      const hints = closureHints(manifest, [key]).filter((hint) => !hint.style);
      cached = { entry: `/${chunk.file}`, preload: hints.map((hint) => hint.href).filter((href) => href !== `/${chunk.file}`) };
    } catch {
      console.warn('[reader] the app idle entry is not in the build manifest; compiled pages load no app');
      cached = null;
    }
    return cached;
  };
}

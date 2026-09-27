import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from 'vite';
import type { LazyCode } from '@/lib/story/lazy-code';

/** Build-owned reader discovery. Hints never execute code or change access. */
type ReaderPreloader = (html: string) => string;

const READER_ENTRIES = ['pages/Profile.tsx', 'pages/Artifact.tsx', '../lib/story-runtime/InlineStoryRuntime.tsx'];
interface Hint { href: string; style: boolean }

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
  const links = hints.filter(hint => !existing.has(hint.href) && !seen.has(hint.href) && seen.add(hint.href)).map(({ href, style }) =>
    style ? `<link rel="preload" href="${href}" as="style" crossorigin>` : `<link rel="modulepreload" href="${href}" crossorigin>`).join('');
  return links ? html.replace('</head>', () => links + '</head>') : html;
}

/** Cache the production manifest per server; dev supplies its own HTML. */
export function createReaderPreloader(webDir: string): ReaderPreloader {
  return createEntryPreloader(webDir, READER_ENTRIES);
}

/**
 * The LISTING pages behind the same addresses: a folder (`/a/<id>` answered
 * with a listing) and a profile's index (`/@handle`). Their pages are chunks of
 * their own so a document's reader never downloads them; when the server
 * already knows the address is one of these, it preloads that chunk beside the
 * route instead of letting the browser discover it a round trip later.
 */
const LISTING_ENTRIES = {
  folder: ['pages/Profile.tsx', 'pages/Artifact.tsx', 'pages/Folder.tsx'],
  'profile-index': ['pages/Profile.tsx', 'pages/ProfileIndex.tsx'],
} as const;
export type ListingPage = keyof typeof LISTING_ENTRIES;

/** Which listing page the server's inlined answer (server/app `bootstrapFor`) draws, if any. */
export function listingPage(data: { profile?: unknown; artifact?: unknown } | null): ListingPage | null {
  if ((data?.artifact as { folder?: unknown } | undefined)?.folder) return 'folder';
  if (!data?.artifact && (data?.profile as { kind?: unknown } | undefined)?.kind === 'public-profile') return 'profile-index';
  return null;
}

export function createListingPreloader(webDir: string): (html: string, page: ListingPage) => string {
  const folder = createEntryPreloader(webDir, LISTING_ENTRIES.folder);
  const profile = createEntryPreloader(webDir, LISTING_ENTRIES['profile-index']);
  return (html, page) => (page === 'folder' ? folder : profile)(html);
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
 * (scripts/build-story-runtime.mjs) beside the SSR bundle: Mermaid's dispatch
 * is read from the installed package there, and the kinds from the kit.
 */
const MERMAID_MODULES_FILE = path.resolve('lib/story-runtime/dist/mermaid-modules.json');

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
    if (!needs.chart && !needs.mermaid.length) return html;
    if (!cached) {
      try { cached = readDocumentHints(webDir, mermaidModulesFile); }
      catch {
        console.warn('[reader] preload manifest unavailable; using lazy discovery');
        cached = { chart: [], mermaid: {} };
      }
    }
    const { chart, mermaid } = cached;
    return inject(html, [...(needs.chart ? chart : []), ...needs.mermaid.flatMap(kind => mermaid[kind] ?? [])]);
  };
}

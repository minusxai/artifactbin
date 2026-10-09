import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from 'vite';

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
 * A folder's listing is a separate route chunk, kept out of document readers.
 * The public profile index uses the Solid entry and its own route chunk.
 */
const LISTING_ENTRIES = {
  folder: ['pages/Profile.tsx', 'pages/Artifact.tsx', 'pages/Folder.tsx'],
} as const;
type ListingPage = keyof typeof LISTING_ENTRIES;

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

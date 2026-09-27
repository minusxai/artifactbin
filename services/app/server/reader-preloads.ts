import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from 'vite';

/** Build-owned reader discovery. Hints never execute code or change access. */
type ReaderPreloader = (html: string) => string;

const READER_ENTRIES = ['pages/Profile.tsx', 'pages/Artifact.tsx', '../lib/story-runtime/InlineStoryRuntime.tsx'];
interface Hint { href: string; style: boolean }

function readHints(webDir: string, entries: readonly string[]): Hint[] {
  const manifest: Manifest = JSON.parse(readFileSync(path.join(webDir, '.vite/manifest.json'), 'utf8'));
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
    const head = html.split('</head>')[0];
    const existing = new Set([...head.matchAll(/\bhref=["']([^"']+)["']/g)].map(match => match[1]));
    const links = cached.filter(hint => !existing.has(hint.href)).map(({ href, style }) =>
      style ? `<link rel="preload" href="${href}" as="style" crossorigin>` : `<link rel="modulepreload" href="${href}" crossorigin>`).join('');
    return html.replace('</head>', () => links + '</head>');
  };
}

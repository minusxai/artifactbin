import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from 'vite';

/** Build-owned reader discovery. Hints never execute code or change access. */
export type ReaderPreloader = (html: string) => string;

const READER_ENTRIES = ['pages/Profile.tsx', 'pages/Artifact.tsx', '../lib/story-runtime/InlineStoryRuntime.tsx'];
interface Hint { href: string; style: boolean }

function readHints(webDir: string): Hint[] {
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
  READER_ENTRIES.forEach(visit);
  return [...hints.values()];
}

/** Cache the production manifest per server; dev supplies its own HTML. */
export function createReaderPreloader(webDir: string): ReaderPreloader {
  let cached: Hint[] | undefined;
  return html => {
    if (!cached) {
      try { cached = readHints(webDir); }
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

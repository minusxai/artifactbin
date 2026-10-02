import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createReaderPreloader, createEntryPreloader, createListingPreloader, listingPage } from '../reader-preloads';

const dirs: string[] = [];
const shell = '<html><head><link rel="modulepreload" href="/assets/shared-abc.js"></head><body></body></html>';
function fixture(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reader-preloads-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, '.vite'));
  writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({
    'pages/Profile.tsx': { file: 'assets/Profile-abc.js', imports: ['shared'] },
    'pages/Artifact.tsx': { file: 'assets/Artifact-abc.js', imports: ['shared'], dynamicImports: ['editor'] },
    '../lib/story-runtime/EditorStoryRuntime.tsx': { file: 'assets/EditorStoryRuntime-abc.js', imports: ['shared'], dynamicImports: ['chart'] },
    shared: { file: 'assets/shared-abc.js', imports: ['pages/Artifact.tsx'], css: ['assets/reader-abc.css'] },
    editor: { file: 'assets/ArtifactEditor-abc.js' },
    chart: { file: 'assets/VegaChart-abc.js' },
    ...overrides,
  }));
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('discovers all reader stages and static dependencies in the head without loading lazy descendants', () => {
  const html = createReaderPreloader(fixture())(shell);
  const dom = new JSDOM(html);
  expect([...dom.window.document.head.querySelectorAll('link[rel="modulepreload"]')].map(link => link.getAttribute('href')).sort()).toEqual([
    '/assets/Artifact-abc.js', '/assets/Profile-abc.js', '/assets/shared-abc.js',
  ]);
  expect(dom.window.document.head.querySelector('link[rel="preload"][as="style"]')?.getAttribute('href')).toBe('/assets/reader-abc.css');
  expect(html).not.toContain('ArtifactEditor');
  expect(html).not.toContain('VegaChart');
  expect(dom.window.document.querySelector('script')).toBeNull();
  dom.window.close();
});

it('reuses the manifest snapshot across requests', () => {
  const dir = fixture(), preload = createReaderPreloader(dir);
  const first = preload(shell);
  rmSync(path.join(dir, '.vite/manifest.json'));
  expect(first).toContain('/assets/Artifact-abc.js');
  expect(first).not.toContain('/assets/EditorStoryRuntime-abc.js');
  expect(preload(shell)).toBe(first);
});

it('keeps readable HTML when the manifest is missing or contains unsafe asset paths', () => {
  const dir = fixture({ shared: { file: '//external.test/inject.js' } });
  expect(createReaderPreloader(dir)(shell)).toBe(shell);
  rmSync(path.join(dir, '.vite/manifest.json'));
  expect(createReaderPreloader(dir)(shell)).toBe(shell);
});

it('can warm the workshop entry and its static renderer dependencies without running them', () => {
  const html = createEntryPreloader(fixture({
    '../components/living-workshop/workshop-renderer.ts': { file: 'assets/workshop-abc.js', imports: ['three'] },
    three: { file: 'assets/three-abc.js' },
  }), ['../components/living-workshop/workshop-renderer.ts'])(shell);
  expect(html).toContain('rel="modulepreload" href="/assets/workshop-abc.js"');
  expect(html).toContain('rel="modulepreload" href="/assets/three-abc.js"');
  expect(html).not.toContain('ArtifactEditor');
  expect(html).not.toContain('<script');
});

it('keeps the listing pages out of the reader, and preloads them only for the listing they are', () => {
  const dir = fixture({
    'pages/Artifact.tsx': { file: 'assets/Artifact-abc.js', imports: ['shared'], dynamicImports: ['pages/Folder.tsx', 'share'] },
    'pages/Profile.tsx': { file: 'assets/Profile-abc.js', imports: ['shared'] },
    'pages/Folder.tsx': { file: 'assets/Folder-abc.js', imports: ['shelf'], isDynamicEntry: true },
    shelf: { file: 'assets/Shelf-abc.js', imports: ['share'] },
    share: { file: 'assets/ShareLink-abc.js' },
  });
  const reader = createReaderPreloader(dir)(shell);
  for (const lazy of ['Folder', 'Shelf', 'ShareLink']) expect(reader).not.toContain(`/assets/${lazy}-abc.js`);
  const listing = createListingPreloader(dir);
  const folder = listing(shell, 'folder');
  expect(folder).toContain('rel="modulepreload" href="/assets/Folder-abc.js"');
  expect(folder).toContain('rel="modulepreload" href="/assets/Shelf-abc.js"');
  expect(folder).toContain('rel="modulepreload" href="/assets/ShareLink-abc.js"');
});

it('names the listing page only from what the server inlined', () => {
  expect(listingPage({ artifact: { folder: { id: 'f' } } })).toBe('folder');
  expect(listingPage({ profile: { kind: 'artifact', id: 'f' }, artifact: { folder: { id: 'f' } } })).toBe('folder');
  expect(listingPage({ profile: { kind: 'public-profile' } })).toBeNull();
  expect(listingPage({ profile: { kind: 'artifact', id: 'd' }, artifact: { surface: {} } })).toBeNull();
  expect(listingPage({ artifact: { surface: {} } })).toBeNull();
  expect(listingPage(null)).toBeNull();
});

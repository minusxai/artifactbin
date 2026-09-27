import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createReaderPreloader, createEntryPreloader, createListingPreloader, createDocumentPreloader, listingPage } from '../reader-preloads';

const dirs: string[] = [];
const shell = '<html><head><link rel="modulepreload" href="/assets/shared-abc.js"></head><body></body></html>';
function fixture(overrides: Record<string, unknown> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reader-preloads-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, '.vite'));
  writeFileSync(path.join(dir, '.vite/manifest.json'), JSON.stringify({
    'pages/Profile.tsx': { file: 'assets/Profile-abc.js', imports: ['shared'] },
    'pages/Artifact.tsx': { file: 'assets/Artifact-abc.js', imports: ['shared'], dynamicImports: ['editor'] },
    '../lib/story-runtime/InlineStoryRuntime.tsx': { file: 'assets/InlineStoryRuntime-abc.js', imports: ['shared'], dynamicImports: ['chart'] },
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
    '/assets/Artifact-abc.js', '/assets/InlineStoryRuntime-abc.js', '/assets/Profile-abc.js', '/assets/shared-abc.js',
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
  expect(first).toContain('/assets/InlineStoryRuntime-abc.js');
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
    'pages/Profile.tsx': { file: 'assets/Profile-abc.js', imports: ['shared'], dynamicImports: ['pages/ProfileIndex.tsx'] },
    'pages/Folder.tsx': { file: 'assets/Folder-abc.js', imports: ['shelf'], isDynamicEntry: true },
    'pages/ProfileIndex.tsx': { file: 'assets/ProfileIndex-abc.js', imports: ['shelf'], isDynamicEntry: true },
    shelf: { file: 'assets/Shelf-abc.js', imports: ['share'] },
    share: { file: 'assets/ShareLink-abc.js' },
  });
  const reader = createReaderPreloader(dir)(shell);
  for (const lazy of ['Folder', 'ProfileIndex', 'Shelf', 'ShareLink']) expect(reader).not.toContain(`/assets/${lazy}-abc.js`);
  const listing = createListingPreloader(dir);
  const folder = listing(shell, 'folder');
  expect(folder).toContain('rel="modulepreload" href="/assets/Folder-abc.js"');
  expect(folder).toContain('rel="modulepreload" href="/assets/Shelf-abc.js"');
  expect(folder).toContain('rel="modulepreload" href="/assets/ShareLink-abc.js"');
  expect(folder).not.toContain('ProfileIndex');
  const profile = listing(shell, 'profile-index');
  expect(profile).toContain('rel="modulepreload" href="/assets/ProfileIndex-abc.js"');
  expect(profile).not.toContain('/assets/Folder-abc.js');
});

it('names the listing page only from what the server inlined', () => {
  expect(listingPage({ artifact: { folder: { id: 'f' } } })).toBe('folder');
  expect(listingPage({ profile: { kind: 'artifact', id: 'f' }, artifact: { folder: { id: 'f' } } })).toBe('folder');
  expect(listingPage({ profile: { kind: 'public-profile' } })).toBe('profile-index');
  expect(listingPage({ profile: { kind: 'artifact', id: 'd' }, artifact: { surface: {} } })).toBeNull();
  expect(listingPage({ artifact: { surface: {} } })).toBeNull();
  expect(listingPage(null)).toBeNull();
});

/*
 * PER DOCUMENT. The reader page above warms what EVERY document needs; the
 * lazy code only some documents run — the chart module, a Mermaid kind's
 * engine, diagram and layout — is named per document, from what its body
 * draws (lib/story/lazy-code), so it downloads beside the runtime instead of
 * three imports later. Never for a document that will not run it.
 */
const MERMAID = '../../../node_modules/mermaid/dist/chunks/mermaid.core';
const M = 'mermaid/dist/chunks/mermaid.core';
function documentFixture(modules: unknown = { kinds: { flowchart: [`${M}/flowDiagram-K.mjs`, `${M}/elk-E.mjs`], sequence: [`${M}/sequenceDiagram-S.mjs`] } }) {
  const dir = fixture({
    '../components/viz/VegaChart.tsx': { file: 'assets/VegaChart-abc.js', src: '../components/viz/VegaChart.tsx', isDynamicEntry: true, imports: ['_d3.js', 'shared'] },
    '_d3.js': { file: 'assets/d3-abc.js' },
    '../components/kit/mermaid-render.ts': { file: 'assets/mermaid-render-abc.js', src: '../components/kit/mermaid-render.ts', isDynamicEntry: true, imports: ['_mermaid-core.js'], dynamicImports: [`${MERMAID}/flowDiagram-K.mjs`, `${MERMAID}/sequenceDiagram-S.mjs`] },
    '_mermaid-core.js': { file: 'assets/mermaid-core-abc.js', imports: ['shared'] },
    [`${MERMAID}/flowDiagram-K.mjs`]: { file: 'assets/flowDiagram-K-abc.js', src: `${MERMAID}/flowDiagram-K.mjs`, isDynamicEntry: true, imports: ['_mermaid-core.js', '_flow-shared.js'] },
    '_flow-shared.js': { file: 'assets/flow-shared-abc.js' },
    [`${MERMAID}/elk-E.mjs`]: { file: 'assets/elk-E-abc.js', src: `${MERMAID}/elk-E.mjs`, isDynamicEntry: true, imports: ['_mermaid-core.js'] },
    [`${MERMAID}/sequenceDiagram-S.mjs`]: { file: 'assets/sequenceDiagram-S-abc.js', src: `${MERMAID}/sequenceDiagram-S.mjs`, isDynamicEntry: true, imports: ['_mermaid-core.js'] },
  });
  const file = path.join(dir, 'mermaid-modules.json');
  if (modules !== null) writeFileSync(file, JSON.stringify(modules));
  return { dir, file };
}
const hinted = (html: string) => [...html.split('</head>')[0].matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);

it('a flowchart document names the Mermaid engine, the flowchart module and its layout engine — and nothing else lazy', () => {
  const { dir, file } = documentFixture();
  const html = createDocumentPreloader(dir, file)(shell, { chart: false, mermaid: ['flowchart'] });
  expect(hinted(html)).toEqual([
    '/assets/shared-abc.js',
    '/assets/mermaid-render-abc.js', '/assets/mermaid-core-abc.js', '/assets/Artifact-abc.js',
    '/assets/flowDiagram-K-abc.js', '/assets/flow-shared-abc.js', '/assets/elk-E-abc.js',
  ]);
  expect(html).not.toContain('sequenceDiagram');
  expect(html).not.toContain('VegaChart');
  expect(html).not.toContain('<script');
});

it('a chart document names the chart module and its static chunks, and no diagram engine', () => {
  const { dir, file } = documentFixture();
  const html = createDocumentPreloader(dir, file)(shell, { chart: true, mermaid: [] });
  expect(hinted(html)).toEqual(['/assets/shared-abc.js', '/assets/VegaChart-abc.js', '/assets/d3-abc.js', '/assets/Artifact-abc.js']);
  expect(html).not.toContain('mermaid');
});

it('each chunk is named once, however many kinds share it', () => {
  const { dir, file } = documentFixture();
  const links = hinted(createDocumentPreloader(dir, file)(shell, { chart: false, mermaid: ['flowchart', 'sequence'] }));
  expect(links).toEqual([...new Set(links)]);
  expect(links).toContain('/assets/sequenceDiagram-S-abc.js');
});

it('a document with no lazy code is left exactly as it was', () => {
  const { dir, file } = documentFixture();
  expect(createDocumentPreloader(dir, file)(shell, { chart: false, mermaid: [] })).toBe(shell);
});

it('a kind the build did not record, or a missing record, names no diagram code — the chart still preloads', () => {
  const { dir, file } = documentFixture(null);
  expect(createDocumentPreloader(dir, file)(shell, { chart: false, mermaid: ['flowchart'] })).toBe(shell);
  expect(createDocumentPreloader(dir, file)(shell, { chart: true, mermaid: ['flowchart'] })).toContain('/assets/VegaChart-abc.js');
  const recorded = documentFixture();
  expect(createDocumentPreloader(recorded.dir, recorded.file)(shell, { chart: false, mermaid: ['gantt'] })).toBe(shell);
});

it('keeps readable HTML when the Vite manifest is missing or names an unsafe path', () => {
  const { dir, file } = documentFixture();
  rmSync(path.join(dir, '.vite/manifest.json'));
  expect(createDocumentPreloader(dir, file)(shell, { chart: true, mermaid: ['flowchart'] })).toBe(shell);
  const unsafe = fixture({ '../components/viz/VegaChart.tsx': { file: '//external.test/inject.js' } });
  expect(createDocumentPreloader(unsafe, file)(shell, { chart: true, mermaid: [] })).toBe(shell);
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { createReaderPreloader } from '../reader-preloads';

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

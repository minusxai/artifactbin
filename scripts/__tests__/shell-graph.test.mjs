import { describe, expect, it } from 'vitest';
import { shellScripts } from '../lib/shell-graph.mjs';

const manifest = {
  'solid-app.html': { file: 'assets/solid-app-1.js', isEntry: true, imports: ['_solid-2.js'], dynamicImports: ['../solid/pages/Document.tsx'] },
  '_solid-2.js': { file: 'assets/solid-2.js' },
  '../solid/pages/Document.tsx': { file: 'assets/Document-3.js', imports: ['_reader-4.js', 'solid-app.html'], dynamicImports: ['../solid/document/create-framed-story.ts'], css: ['assets/Document-3.css'] },
  '_reader-4.js': { file: 'assets/reader-4.js', imports: ['_icon-5.js'] },
  '_icon-5.js': { file: 'assets/icon-5.js' },
  '../solid/document/create-framed-story.ts': { file: 'assets/create-framed-story-6.js', imports: ['_runtime-id-7.js'] },
  '_runtime-id-7.js': { file: 'assets/runtime-id-7.js' },
  '../solid/pages/Home.tsx': { file: 'assets/Home-8.js', imports: ['_solid-2.js'] },
};

describe('app shell eager scripts', () => {
  it('is the entry and the document page with their static imports, never a dynamically imported chunk or another page', () => {
    expect([...shellScripts(manifest)].sort()).toEqual(['/assets/Document-3.js', '/assets/icon-5.js', '/assets/reader-4.js', '/assets/solid-2.js', '/assets/solid-app-1.js']);
  });
  it('refuses a build without the document page', () => {
    expect(() => shellScripts({ 'solid-app.html': { file: 'assets/a.js', isEntry: true } })).toThrow(/no chunk/);
  });
});

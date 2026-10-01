// DESTINATION: services/app/lib/compiled-page/__tests__/flip.test.ts
/**
 * THE FLIP (docs/phase2-architecture.md §10): the compiled reader is the default, and the legacy
 * reader — two runtimes, two assemblers, the browser CSS work — is gone in the same PR.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const APP = path.resolve(process.cwd());
const ROOT = path.resolve(APP, '../..');

describe('the default', () => {
  it('serves compiled pages without a deployment switch or reader query override', () => {
    expect(readFileSync(path.join(ROOT, '.env.example'), 'utf8')).not.toContain('FLAG__COMPILED_READER');
    expect(readFileSync(path.join(APP, 'lib/config.ts'), 'utf8')).not.toContain('FLAG__COMPILED_READER');
  });
});

describe('what the compiled reader replaced is deleted', () => {
  const gone = [
    'lib/story/document.ts', 'lib/story/inline-story-html.ts', 'lib/story-runtime/entry.tsx', 'lib/story-runtime/InlineStoryRuntime.tsx',
    'lib/story-runtime/live-entry.ts', 'lib/story-runtime/inline-sheet.ts', 'lib/story/runtime-asset.ts', 'scripts/build-story-runtime.mjs',
    'lib/compiled-page/reader-mode.ts',
  ];
  for (const file of gone) it(`${file} no longer exists`, () => expect(existsSync(path.join(APP, file))).toBe(false));
  it('the story runtime build is gone from the package scripts and the ignore list; the island build took its place', () => {
    const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8'));
    expect(pkg.scripts['build:runtime']).toBeUndefined();
    expect(pkg.scripts['build:islands']).toBeTruthy();
    // `build` no longer names `build-islands.mjs` directly — it delegates the pre-vite steps
    // (server-reader assets, the island build and the route table) to build-prep.mjs, which runs
    // them concurrently. The island build must still be one of them.
    expect(readFileSync(path.join(APP, 'scripts/build-prep.mjs'), 'utf8')).toContain('build-islands.mjs');
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).not.toContain('public/story/');
  });
  it('the reader\'s runtime class merging is gone: no reader chunk imports tailwind-merge or class-variance-authority', () => {
    const src = ['lib/islands/rt.tsx', 'lib/islands/boot.ts'].map((f) => readFileSync(path.join(APP, f), 'utf8')).join('\n');
    expect(src).not.toMatch(/tailwind-merge|class-variance-authority|clsx/);
  });
});

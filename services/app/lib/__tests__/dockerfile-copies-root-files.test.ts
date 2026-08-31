/**
 * The image must carry every ROOT file the build needs.
 *
 * The builder copies source by DIRECTORY (`app`, `components`, `lib`, …) but
 * root files one by one, so a new root file is invisible to the image until
 * someone remembers to add it. `proxy.ts` was: the whole reader/owner split
 * built and passed locally, shipped green through CI (which builds from a
 * whole checkout), and was simply ABSENT in production — `/a/<id>` served the
 * app shell to everyone, with no error anywhere to notice.
 *
 * A root file that Next compiles is part of the app; this pins that the
 * Dockerfile knows it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Root files Next reads at build time — every one must reach the image. */
const APP_ROOT_FILES = ['services/app/auth.ts', 'server.ts', 'vite.config.mts', 'services/app/postcss.config.mjs', 'tsconfig.json'];
const ROOT = path.resolve(import.meta.dirname, '../../../..');

describe('Dockerfile', () => {
  const dockerfile = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const copied = dockerfile
    .split('\n')
    .filter((l) => /^COPY /.test(l) && !l.includes('--from='))
    .join(' ');

  it.each(APP_ROOT_FILES)('copies %s into the builder', (file) => {
    expect(copied).toContain(file);
  });

  it('knows about every root-level source file that exists', () => {
    // A new root .ts/.mjs file is a build input until proven otherwise — if
    // this fails, either copy it in the Dockerfile or add it here with a
    // reason. Config for tooling that does not run in the image is fine to
    // exclude; a file Next compiles is not.
    const EXCLUDED = new Set([
      'vitest.config.ts', 'eslint.config.mjs', 'next-env.d.ts', 'playwright.config.ts',
      // Retired split-shape entrypoints remain temporarily at the root, but
      // the full image has server.ts as its only composition entrypoint.
      'server.mts', 'proxy-standalone.mts', 'app-only.mts',
    ]);
    const rootSources = readdirSync(ROOT)
      // `.mts` too: Vite's root config is a build input.
      .filter((f) => /\.(ts|mts|cts|mjs)$/.test(f) && !f.endsWith('.d.ts') && !EXCLUDED.has(f));
    for (const file of rootSources) {
      expect(copied, `${file} is a root source file the image never receives`).toContain(file);
    }
  });
});

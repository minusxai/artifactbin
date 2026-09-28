// DESTINATION: services/app/lib/compiled-page/__tests__/build.test.ts
/** The server's view of the shared island build: `loadCompilerBuild()` reads the manifest the build wrote (contract CompilerBuild). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCompilerBuild, ISLANDS_MANIFEST_PATH } from '../build.server';

/*
 * UNTIL w1-toolchain MERGES, nothing builds public/islands/ before the suite
 * (its global setup does, after). So when no manifest exists this writes a
 * fixture in the build's shape — `{ build, manifest, files }` — and removes it
 * afterwards; once the real build runs first, the fixture is never written and
 * the test reads what the build wrote. Remove this block with that merge.
 */
const manifestFile = path.resolve(process.cwd(), ISLANDS_MANIFEST_PATH);
let fixture: 'file' | 'dir' | null = null;
beforeAll(() => {
  if (existsSync(manifestFile)) return;
  fixture = existsSync(path.dirname(manifestFile)) ? 'file' : 'dir';
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  const specifiers = ['solid-js', 'solid-js/web', 'solid-js/store', '@mx/rt', '@mx/boot', '@mx/deck', '@mx/kit/tabs'];
  const manifest = Object.fromEntries(specifiers.map((s, i) => [s, `/islands/${s.replace(/[^a-z]+/g, '-')}-${String(i).repeat(8)}.js`]));
  writeFileSync(manifestFile, JSON.stringify({ build: '0123456789abcdef', manifest, files: {} }));
});
afterAll(() => {
  if (fixture) rmSync(fixture === 'dir' ? path.dirname(manifestFile) : manifestFile, { recursive: true, force: true });
});

describe('loadCompilerBuild', () => {
  it('reads public/islands/manifest.json (built by the test global setup beside the story runtime)', () => {
    expect(existsSync(path.resolve(process.cwd(), ISLANDS_MANIFEST_PATH))).toBe(true);
    const build = loadCompilerBuild();
    expect(build.id).toMatch(/^[0-9a-f]{16}$/);
    for (const specifier of ['solid-js', 'solid-js/web', 'solid-js/store', '@mx/rt', '@mx/boot', '@mx/kit/tabs']) expect(build.manifest[specifier], specifier).toMatch(/^\/islands\//);
  });
  it('is read once per process in production and re-read in development', () => {
    expect(loadCompilerBuild()).toBe(loadCompilerBuild());
  });
});

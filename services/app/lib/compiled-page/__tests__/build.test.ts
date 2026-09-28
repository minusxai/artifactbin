// DESTINATION: services/app/lib/compiled-page/__tests__/build.test.ts
/** The server's view of the shared island build: `loadCompilerBuild()` reads the manifest the build wrote (contract CompilerBuild). */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadCompilerBuild, ISLANDS_MANIFEST_PATH } from '../build.server';

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

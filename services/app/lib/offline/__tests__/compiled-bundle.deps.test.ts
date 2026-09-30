// The production runtime image ships only services/app's declared
// "dependencies" (artifactbin-server scripts/build-source.mjs
// runtimeDependencies): those are the packages left external (unbundled) when
// the app is bundled to ESM for the app container. Anything imported only as
// a devDependency gets inlined into that single-file bundle instead, which
// breaks a package like esbuild that resolves its own native binary through
// __filename/__dirname at require time (ReferenceError: __filename is not
// defined) — production 502s the offline download for any dataset-backed
// dashboard because lib/offline/compiled-bundle.server.ts calls esbuild.build()
// at request time, in-process, to pack the compiled module for the file.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(process.cwd());
const OFFLINE_DIR = path.join(APP, 'lib/offline');

/** Bare (npm) import specifiers a `.server.ts` file names — relative, `@/`-aliased and `node:` imports never ship separately. */
function bareImports(source: string): string[] {
  const specifiers = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g), ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => m[1]!)
    .filter((spec) => !spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('node:'));
  // A scoped package `@scope/name/sub/path` or a plain `name/sub/path` both resolve as their first one or two segments.
  return [...new Set(specifiers.map((spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!)))];
}

describe('lib/offline server modules ship their runtime imports', () => {
  const pkg = JSON.parse(readFileSync(path.join(APP, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  const serverFiles = readdirSync(OFFLINE_DIR).filter((f) => f.endsWith('.server.ts'));

  for (const file of serverFiles) {
    it(`${file}'s npm imports are production dependencies, not devDependencies-only`, () => {
      const source = readFileSync(path.join(OFFLINE_DIR, file), 'utf8');
      for (const name of bareImports(source)) {
        expect(pkg.dependencies, `${name} (imported by lib/offline/${file}) must be in "dependencies": a devDependency is inlined into the production bundle instead of shipped, which breaks packages like esbuild that resolve themselves via __filename at runtime`).toHaveProperty(name);
      }
    });
  }
});

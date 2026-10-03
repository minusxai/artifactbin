/**
 * THE SERVER'S RUNTIME DEPENDENCIES ARE DECLARED AS SUCH. A deployment installs `services/app/package.json`'s
 * `dependencies` beside the server bundle and bundles everything else into it (scripts/build/build-server.mjs
 * externalizes the native and self-locating packages; a downstream image externalizes exactly the dependencies).
 * A package a server module imports from `devDependencies` is therefore inlined into an ES module, where a
 * CommonJS package that reads its own location fails — esbuild's `lib/main.js` evaluates `__filename` on load,
 * and production's publish compiler died with "__filename is not defined" while esbuild sat in devDependencies.
 *
 * Every bare package a server-only module imports (`*.server.ts` under lib, everything under server/) must be a
 * runtime dependency of the app or of a workspace package it depends on, or be one of the few deliberately bundled.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SERVICES = path.join(ROOT, 'services');

/** Pure JavaScript the server bundle carries inline on purpose, with no own-location reads: tailwindcss compiles the
 * stored CSS from the sheets build-server.mjs defines into the bundle (`__MX_TAILWIND_*_CSS__`). */
const BUNDLED = new Set(['tailwindcss']);

const manifest = (service) => JSON.parse(readFileSync(path.join(SERVICES, service, 'package.json'), 'utf8'));
/** The app's runtime dependencies and those of the workspace packages it depends on, as an image installs them. */
function runtimeDependencies() {
  const names = new Set();
  const seen = new Set();
  const include = (service) => {
    if (seen.has(service)) return;
    seen.add(service);
    for (const name of Object.keys(manifest(service).dependencies ?? {})) {
      if (name.startsWith('@artifactbin/')) include(name.slice('@artifactbin/'.length));
      else names.add(name);
    }
  };
  include('app');
  return names;
}

const walk = (dir, keep, out = []) => {
  for (const entry of readdirSync(dir)) {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) { if (entry !== '__tests__' && entry !== 'node_modules') walk(file, keep, out); }
    else if (keep(file)) out.push(file);
  }
  return out;
};
const source = (file) => /\.tsx?$/.test(file) && !/\.d\.ts$/.test(file);
/** The modules only the server runs: lib's `*.server.ts` and the server tree. */
const serverModules = () => [
  ...walk(path.join(SERVICES, 'app/lib'), (file) => source(file) && /\.server\.tsx?$/.test(file)),
  ...walk(path.join(SERVICES, 'app/server'), source),
];

// Value imports only: `import type` resolves to nothing at runtime, and a type-only import of esbuild is how the
// publish compiler defers loading it to its first build.
const IMPORTS = /(?:^|\n)\s*import\s+(?!type\s)[^;]*?\s+from\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
const packageOf = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
const external = (specifier) => !specifier.startsWith('.') && !specifier.startsWith('@/') && !specifier.startsWith('node:') && !specifier.startsWith('@artifactbin/') && !builtinModules.includes(specifier);

/** Every bare package each server module imports at runtime, by package. */
function serverImports() {
  const byPackage = new Map();
  for (const file of serverModules()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(IMPORTS)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier || !external(specifier)) continue;
      const name = packageOf(specifier);
      if (!byPackage.has(name)) byPackage.set(name, []);
      byPackage.get(name).push(path.relative(ROOT, file));
    }
  }
  return byPackage;
}

describe('server runtime dependencies', () => {
  it('sees the publish compiler load esbuild, so the check below is not vacuous', () => {
    expect(serverImports().get('esbuild')).toContain('services/app/lib/story/document/author-module.server.ts');
  });

  it('every package a server module imports is a runtime dependency, or deliberately bundled', () => {
    const declared = runtimeDependencies();
    const undeclared = [...serverImports()].filter(([name]) => !declared.has(name) && !BUNDLED.has(name))
      .map(([name, files]) => `${name} ← ${[...new Set(files)].join(', ')}`);
    expect(undeclared, 'move these to services/app/package.json dependencies').toEqual([]);
  });

  it('the bundled exemptions are still imported, so none outlives its reason', () => {
    for (const name of BUNDLED) expect(serverImports().has(name), `${name} is no longer imported by a server module`).toBe(true);
  });
});

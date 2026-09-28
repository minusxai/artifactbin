// DESTINATION: scripts/__tests__/build-islands.test.mjs
/**
 * The shared island build (scripts/build-islands.mjs): once per deploy, Solid 1.9, the runtime and
 * every kit family become content-addressed chunks under services/app/public/islands with a
 * manifest and a build id (docs/phase2-architecture.md §1, §3; lib/compiled-page/contract CompilerBuild).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildIslands, ISLAND_SPECIFIERS } from '../build-islands.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const KIT_FAMILIES = ['basic', 'tabs', 'accordion', 'dialog', 'disclosure', 'controls', 'data', 'files', 'people', 'mermaid'];

describe('the toolchain', () => {
  it('pins Solid 1.9 and a matching babel preset', () => {
    const solid = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/solid-js/package.json'), 'utf8'));
    expect(solid.version).toMatch(/^1\.9\./);
    const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const preset = lock.packages['node_modules/babel-preset-solid'];
    expect(preset, 'babel-preset-solid is pinned in the lockfile').toBeTruthy();
    expect(preset.version).toMatch(/^1\.9\./);
  });
});

describe('buildIslands', () => {
  it('names every specifier a compiled page may import', () => {
    expect(ISLAND_SPECIFIERS).toEqual(expect.arrayContaining(['@mx/rt', '@mx/boot', '@mx/deck', ...KIT_FAMILIES.map((f) => `@mx/kit/${f}`)]));
    expect(ISLAND_SPECIFIERS.filter((s) => s.startsWith('solid-js')), 'generated code reaches Solid only through @mx/rt').toEqual([]);
  });

  it('writes content-addressed chunks, a manifest and a 16-hex build id, deterministically', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'islands-build-'));
    const first = await buildIslands({ outDir });
    expect(first.build).toMatch(/^[0-9a-f]{16}$/);
    for (const specifier of ISLAND_SPECIFIERS) {
      const url = first.manifest[specifier];
      expect(url, specifier).toMatch(/^\/islands\/[\w-]+-[0-9a-f]{8,}\.js$/);
      expect(existsSync(path.join(outDir, url.slice('/islands/'.length))), `${specifier} → ${url} exists`).toBe(true);
    }
    expect(JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))).toEqual({ build: first.build, manifest: first.manifest, files: expect.any(Object) });
    // Exactly one Solid: its DOM runtime (the event-delegation key is a string literal in solid-js/web) is in one chunk.
    const withSolidWeb = Object.keys(first.files).filter((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes('_$DX_DELEGATE'));
    expect(withSolidWeb).toHaveLength(1);
    const again = await buildIslands({ outDir: mkdtempSync(path.join(tmpdir(), 'islands-build-')) });
    expect(again.build).toBe(first.build);
    expect(again.manifest).toEqual(first.manifest);
  });

  it('keeps the shared runtime under the interactive budget: solid + rt + store bridge ≤ 28 KB brotli', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'islands-build-'));
    const { manifest, files, closure } = await buildIslands({ outDir });
    const bytes = closure([manifest['@mx/rt'], manifest['@mx/boot']]).reduce((n, url) => n + files[url].br, 0);
    // Internal sub-budget. esbuild tree-shakes across the whole build but splits by file, so the Solid
    // helpers any kit family uses land in the shared chunk that rt's closure includes; they load on every
    // interactive page anyway. The owner's target 2 (≤ 85 KB before ready on interactive pages) is the
    // real check, in scripts/size-targets.mjs.
    expect(bytes).toBeLessThanOrEqual(28 * 1024);
  });
});

// DESTINATION: scripts/__tests__/build-islands.test.mjs
/**
 * The shared island build (scripts/build-islands.mjs): once per deploy, Solid 1.9, the runtime and
 * every kit family become content-addressed chunks under services/app/public/islands with a
 * manifest and a build id (docs/phase2-architecture.md §1, §3; lib/compiled-page/contract CompilerBuild).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildIslands, ISLAND_SPECIFIERS } from '../build-islands.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const KIT_FAMILIES = ['basic', 'tabs', 'accordion', 'dialog', 'disclosure', 'controls', 'data', 'files', 'people', 'mermaid', 'embed', 'cells', 'static'];

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
  // ONE build shared by every case: a full island build costs ~15 s in CI, and three of them made this
  // file the slowest in its shard. Determinism is checked against the build the test setup already
  // wrote (services/app/public/islands, build-runtime.global.ts), from the same sources.
  let outDir;
  let first;
  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'islands-build-'));
    writeFileSync(path.join(outDir, 'prior-0000000000000000.js'), 'prior build');
    first = await buildIslands({ outDir });
  }, 120_000);
  it('names every specifier a compiled page may import', () => {
    expect(readFileSync(path.join(outDir, 'prior-0000000000000000.js'), 'utf8')).toBe('prior build');
    expect(ISLAND_SPECIFIERS).toEqual(expect.arrayContaining(['@mx/rt', '@mx/boot', '@mx/deck', '@mx/row-class', '@mx/kit/image', ...KIT_FAMILIES.map((f) => `@mx/kit/${f}`)]));
    expect(ISLAND_SPECIFIERS.filter((s) => s.startsWith('solid-js')), 'generated code reaches Solid only through @mx/rt').toEqual([]);
  });

  it('writes content-addressed chunks, a manifest and a 16-hex build id, deterministically', async () => {
    expect(first.build).toMatch(/^[0-9a-f]{16}$/);
    for (const specifier of ISLAND_SPECIFIERS) {
      const url = first.manifest[specifier];
      expect(url, specifier).toMatch(/^\/islands\/[\w-]+-[0-9a-f]{8,}\.js$/);
      expect(existsSync(path.join(outDir, url.slice('/islands/'.length))), `${specifier} → ${url} exists`).toBe(true);
    }
    expect(JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))).toEqual({ build: first.build, manifest: first.manifest, files: expect.any(Object), ssr: first.ssr, sqliteWasm: expect.stringMatching(/^\/islands\/sqlite3-[0-9a-f]{16}\.wasm$/) });
    // Exactly one Solid: its DOM runtime (the event-delegation key is a string literal in solid-js/web) is in one chunk.
    const withSolidWeb = Object.keys(first.files).filter((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes('_$DX_DELEGATE'));
    expect(withSolidWeb).toHaveLength(1);
    const setupManifest = path.join(ROOT, 'services/app/public/islands/manifest.json');
    const again = existsSync(setupManifest)
      ? JSON.parse(readFileSync(setupManifest, 'utf8'))
      : await buildIslands({ outDir: mkdtempSync(path.join(tmpdir(), 'islands-build-')) });
    expect(again.build).toBe(first.build);
    expect(again.manifest).toEqual(first.manifest);
    expect(again.ssr).toEqual(first.ssr);
  });

  it('ships an optional, content-addressed glyph catalog without React in the reader graph', () => {
    const url = first.manifest['@mx/glyphs'];
    expect(url).toMatch(/^\/islands\/glyphs-[0-9a-f]{16}\.js$/);
    expect(first.files[url].imports).toEqual([]);
    const source = readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8');
    expect(source).toContain('CircleQuestionMark');
    expect(source).toContain('Check');
  });

  it('writes the server half: one file, a namespace per runtime and kit specifier, only Solid external, no lazy engine', () => {
    const { ssr } = first;
    expect(ssr.url).toMatch(/^\/islands\/ssr-[0-9a-f]{16}\.js$/);
    expect(Object.keys(ssr.exports).sort()).toEqual(['@mx/rt', '@mx/row-class', '@mx/kit/image', ...KIT_FAMILIES.map((f) => `@mx/kit/${f}`)].sort());
    const text = readFileSync(path.join(outDir, ssr.url.slice('/islands/'.length)), 'utf8');
    const specifiers = [...new Set([...text.matchAll(/^import\s[^;]*?from\s*["']([^"']+)["']/gm)].map((m) => m[1]))].sort();
    expect(specifiers.every((s) => /^solid-js(\/web|\/store)?$/.test(s)), specifiers.join(', ')).toBe(true);
    for (const name of Object.values(ssr.exports)) expect(text, name).toMatch(new RegExp(`\\b${name}\\b`));
    // The lazy engines (Vega, Mermaid, React behind them) are browser-only stubs here.
    expect(text.length).toBeLessThan(512 * 1024);
  });

  it('bundles the managed frame\'s behaviour alone: its own file, no imports, no Solid, loaded by the embed family by content address', () => {
    const { manifest, files } = first;
    const engines = Object.keys(files).filter((url) => /\/frame-engine-[0-9a-f]{16}\.js$/.test(url));
    expect(engines).toHaveLength(1);
    const engine = engines[0];
    expect(files[engine].imports).toEqual([]);
    const code = readFileSync(path.join(outDir, engine.slice('/islands/'.length)), 'utf8');
    expect(code).not.toMatch(/\$DX_DELEGATE|_\$HY/);
    // Some chunk of the embed family's closure asks for it by its file name, lazily.
    const name = engine.slice('/islands/'.length);
    const reach = (urls, seen = new Set()) => { for (const u of urls) { if (seen.has(u)) continue; seen.add(u); reach(files[u].imports, seen); } return seen; };
    expect([...reach([manifest['@mx/kit/embed']])].some((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes(`import("./${name}")`))).toBe(true);
    // …and nothing the data family loads does: a page with a table never carries the frame's door.
    expect([...reach([manifest['@mx/kit/data']])].some((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes(name))).toBe(false);
    // …and nothing in the shared runtime's closure does.
    expect([...reach([manifest['@mx/rt'], manifest['@mx/boot']])].some((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes(name))).toBe(false);
  });

  it('bundles the author script host alone: its own file, no imports, no Solid, loaded by boot by content address and only there', () => {
    const { manifest, files } = first;
    const hosts = Object.keys(files).filter((url) => /\/author-host-[0-9a-f]{16}\.js$/.test(url));
    expect(hosts).toHaveLength(1);
    const host = hosts[0];
    expect(files[host].imports).toEqual([]);
    const code = readFileSync(path.join(outDir, host.slice('/islands/'.length)), 'utf8');
    expect(code).not.toMatch(/\$DX_DELEGATE|_\$HY/);
    expect(code, 'today\'s wrapper and sandbox').toContain('/author-frame');
    const name = host.slice('/islands/'.length);
    const text = (url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8');
    const reach = (urls, seen = new Set()) => { for (const u of urls) { if (seen.has(u)) continue; seen.add(u); reach(files[u].imports, seen); } return seen; };
    const runtime = [...reach([manifest['@mx/rt'], manifest['@mx/boot']])];
    // Boot asks for it lazily, by file name; nothing in the runtime's closure carries its code.
    expect(runtime.some((url) => text(url).includes(`import("./${name}")`))).toBe(true);
    expect(runtime.some((url) => text(url).includes('mx:author:init'))).toBe(false);
    expect(runtime).not.toContain(host);
  });

  it('bundles the page\'s SQLite engine alone: its own file, no imports, no Solid, the core inlined, loaded by boot by content address', () => {
    const { manifest, files } = first;
    const engines = Object.keys(files).filter((url) => /\/sqlite-engine-[0-9a-f]{16}\.js$/.test(url));
    expect(engines).toHaveLength(1);
    const engine = engines[0];
    expect(files[engine].imports).toEqual([]);
    const name = engine.slice('/islands/'.length);
    const code = readFileSync(path.join(outDir, name), 'utf8');
    expect(code).not.toMatch(/\$DX_DELEGATE|_\$HY/);
    // `@artifactbin/sql/core` is bundled in (a lazy import left in would be a bare specifier the browser cannot load).
    expect(code).not.toMatch(/import\(\s*["']@artifactbin/);
    const reach = (urls, seen = new Set()) => { for (const u of urls) { if (seen.has(u)) continue; seen.add(u); reach(files[u].imports, seen); } return seen; };
    const runtime = [...reach([manifest['@mx/rt'], manifest['@mx/boot']])];
    expect(runtime.some((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes(`import("./${name}")`)), 'boot asks for it lazily').toBe(true);
    // The engine's own modules stay out of the runtime's closure: only the lazy request names it.
    expect(runtime.some((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes('the page engine is not loaded'))).toBe(false);
  });

  it('keeps the editing cells in their own family: nothing the data family loads carries them', () => {
    const { manifest, files } = first;
    const reach = (urls, seen = new Set()) => { for (const u of urls) { if (seen.has(u)) continue; seen.add(u); reach(files[u].imports, seen); } return seen; };
    const carries = (spec) => [...reach([manifest[spec]])].some((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes('Expected a JSON array of strings.'));
    expect(carries('@mx/kit/cells')).toBe(true);
    expect(carries('@mx/kit/data')).toBe(false);
  });

  it('keeps the shared runtime under the interactive budget: solid + rt + store bridge ≤ 28 KB brotli', async () => {
    const { manifest, files, closure } = first;
    const bytes = closure([manifest['@mx/rt'], manifest['@mx/boot']]).reduce((n, url) => n + files[url].br, 0);
    // Internal sub-budget. esbuild tree-shakes across the whole build but splits by file, so the Solid
    // helpers any kit family uses land in the shared chunk that rt's closure includes; they load on every
    // interactive page anyway. The owner's target 2 (≤ 85 KB before ready on interactive pages) is the
    // real check, in scripts/size-targets.mjs.
    expect(bytes).toBeLessThanOrEqual(27_979);
  });

  it('keeps framed transport, comment target parsing and event contracts out of rt+boot', () => {
    const { manifest, closure, outputInputs } = first;
    const modules = closure([manifest['@mx/rt'], manifest['@mx/boot']]).flatMap((url) => outputInputs[url]);
    for (const name of ['story-runtime/relay-transport.ts', 'story/comment-target.ts', 'contracts/src/events.ts']) {
      expect(modules.some((input) => input.endsWith(name)), name).toBe(false);
    }
  });

  it('keeps every kit family inside the ready-time static budget, with the map and frame engines behind dynamic imports', () => {
    const { manifest, files, closure } = first;
    const staticUrls = closure([manifest['@mx/boot'], ...KIT_FAMILIES.map(family => manifest[`@mx/kit/${family}`])]);
    const staticBytes = staticUrls.reduce((sum, url) => sum + files[url].br, 0);
    expect(staticBytes).toBeLessThanOrEqual(80 * 1024);
    const withImage = closure([manifest['@mx/kit/image'], ...staticUrls]);
    expect(withImage.reduce((sum, url) => sum + files[url].br, 0)).toBeLessThanOrEqual(85 * 1024);
    const dataCode = staticUrls.map(url => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8')).join('\n');
    const dynamic = [...dataCode.matchAll(/import\("\.\/([\w-]+\.js)"\)/g)].map(match => `/islands/${match[1]}`);
    expect(dynamic.some(url => /frame-engine-[0-9a-f]{16}\.js$/.test(url))).toBe(true);
    expect(dynamic.some(url => files[url]?.gz > 100 * 1024)).toBe(true);
    expect(dynamic.every(url => !staticUrls.includes(url))).toBe(true);
  });

  it('loads tooltip placement only when a tooltip opens', () => {
    const { manifest, files, closure } = first;
    const staticUrls = closure([manifest['@mx/kit/disclosure']]);
    const code = staticUrls.map(url => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8')).join('\n');
    const lazy = [...code.matchAll(/import\("\.\/([\w-]+\.js)"\)/g)].map(match => `/islands/${match[1]}`);
    expect(lazy.some(url => files[url]?.br > 4 * 1024 && !staticUrls.includes(url))).toBe(true);
  });
});

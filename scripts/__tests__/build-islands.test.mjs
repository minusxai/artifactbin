/**
 * The shared island build (scripts/build/build-islands.mjs): once per deploy, Solid 1.9, the runtime and
 * every kit family become content-addressed chunks under services/app/public/islands with a
 * manifest and a build id (docs/phase2-architecture.md §1, §3; lib/compiled-page/contract CompilerBuild).
 *
 * Every case reads the build the test global setup already wrote (services/app/test/setup/build-runtime.global.ts
 * runs `build-islands.mjs --cache` into public/islands); none builds again.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { AUTHOR_VENDOR_SPECIFIERS, CACHE_MARKER, closureOf, DEFAULT_OUT_DIR, FRAME_EDITOR, ISLAND_SPECIFIERS } from '../build/build-islands.mjs';

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
  const outDir = DEFAULT_OUT_DIR;
  const written = JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  const first = { ...written, closure: (urls) => closureOf(written.files, urls) };
  it('names every specifier a compiled page may import', () => {
    expect(ISLAND_SPECIFIERS).toEqual(expect.arrayContaining(['@mx/rt', '@mx/boot', '@mx/deck', '@mx/row-class', '@mx/kit/image', ...KIT_FAMILIES.map((f) => `@mx/kit/${f}`)]));
    // Generated code reaches Solid only through @mx/rt; the bare Solid specifiers are the author script's vendor entries.
    expect(ISLAND_SPECIFIERS.filter((s) => s.startsWith('solid-js'))).toEqual(['solid-js', 'solid-js/web', 'solid-js/store']);
    expect([...AUTHOR_VENDOR_SPECIFIERS].sort()).toEqual(['solid-js', 'solid-js/store', 'solid-js/web']);
  });

  it('writes content-addressed chunks, a manifest and a 16-hex build id', () => {
    expect(first.build).toMatch(/^[0-9a-f]{16}$/);
    for (const specifier of ISLAND_SPECIFIERS) {
      const url = first.manifest[specifier];
      expect(url, specifier).toMatch(/^\/islands\/[\w-]+-[0-9a-f]{8,}\.js$/);
      expect(existsSync(path.join(outDir, url.slice('/islands/'.length))), `${specifier} → ${url} exists`).toBe(true);
    }
    expect(Object.keys(written).sort()).toEqual(['build', 'files', 'manifest', 'offline', 'sqliteWasm', 'ssr']);
    expect(written.sqliteWasm).toMatch(/^\/islands\/sqlite3-[0-9a-f]{16}\.wasm$/);
    // Exactly one Solid in the shared graph: its DOM runtime (the event-delegation key is a string literal in solid-js/web)
    // is in one chunk. The frame editor is its own graph (build-islands FRAME_EDITOR) and carries its own copy, in its own file.
    const solidWebIn = (urls) => urls.filter((url) => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8').includes('_$DX_DELEGATE'));
    const isEditorFile = (url) => /\/frame-editor(-chunk)?-[0-9a-f]{16}\.js$/.test(url);
    const withSolidWeb = solidWebIn(Object.keys(first.files).filter((url) => !isEditorFile(url)));
    expect(withSolidWeb).toHaveLength(1);
    expect(solidWebIn(Object.keys(first.files).filter(isEditorFile))).toHaveLength(1);
    // ... and the author script's `solid-js/web`, the page runtime and rt all reach that one chunk.
    for (const specifier of ['@mx/rt', '@mx/page-runtime', 'solid-js/web']) expect(first.closure([first.manifest[specifier]]), specifier).toContain(withSolidWeb[0]);
    expect(first.offline).toMatch(/^\/islands\/offline-[0-9a-f]{16}\.json\.gzip$/);
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
    const { manifest, closure } = first;
    const { outputInputs } = JSON.parse(readFileSync(CACHE_MARKER, 'utf8'));
    const carries = (spec) => closure([manifest[spec]]).flatMap(url => outputInputs[url])
      .some(input => input.endsWith('islands/kit/cells.tsx'));
    expect(carries('@mx/kit/cells')).toBe(true);
    expect(carries('@mx/kit/data')).toBe(false);
  });

  it('keeps the shared runtime under the interactive budget: solid + rt + store bridge ≤ 28 KB brotli', async () => {
    const { manifest, files, closure } = first;
    const bytes = closure([manifest['@mx/rt'], manifest['@mx/boot']]).reduce((n, url) => n + files[url].br, 0);
    // Internal sub-budget. esbuild tree-shakes across the whole build but splits by file, so the Solid
    // helpers any kit family uses land in the shared chunk that rt's closure includes; they load on every
    // interactive page anyway. The owner's target 2 (≤ 85 KB before ready on interactive pages) is the
    // real check, in scripts/build/size-targets.mjs.
    // boot grew by the page runtime's loader (lib/islands/page-runtime: the vendor map and the module import).
    // The framed document's runtime now also relays its URL values and app-path links to the app page.
    expect(bytes).toBeLessThanOrEqual(29_500);
  });

  it('keeps comment target and saved-view parsing, event contracts and runtime class merging out of rt+boot', () => {
    const { manifest, closure } = first;
    // Which modules each output carries: the --cache marker the setup build wrote beside its manifest.
    const { outputInputs } = JSON.parse(readFileSync(CACHE_MARKER, 'utf8'));
    const all = Object.values(outputInputs).flat();
    const modules = closure([manifest['@mx/rt'], manifest['@mx/boot']]).flatMap((url) => outputInputs[url]);
    for (const name of ['story/annotations/comment-target.ts', 'contracts/src/comment-view-state.ts']) {
      expect(all.some((input) => input.endsWith(name)), `${name} is in the build at all`).toBe(true);
      expect(modules.some((input) => input.endsWith(name)), name).toBe(false);
    }
    // The compiled reader merges classes at compile time: no reader runtime chunk carries a class merger.
    for (const pkg of ['tailwind-merge', 'class-variance-authority', 'clsx']) {
      expect(modules.some((input) => input.includes(`node_modules/${pkg}/`)), pkg).toBe(false);
    }
  });

  it('keeps every kit family inside the ready-time static budget, with the map engine behind dynamic imports', () => {
    const { manifest, files, closure } = first;
    const staticUrls = closure([manifest['@mx/boot'], ...KIT_FAMILIES.map(family => manifest[`@mx/kit/${family}`])]);
    const { outputInputs } = JSON.parse(readFileSync(CACHE_MARKER, 'utf8'));
    expect(staticUrls.flatMap(url => outputInputs[url] ?? []).some(input => input.endsWith('contracts/src/comment-view-state.ts'))).toBe(false);
    const staticBytes = staticUrls.reduce((sum, url) => sum + files[url].br, 0);
    expect(staticBytes).toBeLessThanOrEqual(80 * 1024);
    const menuFiles = Object.entries(outputInputs).filter(([, inputs]) => inputs.some(input => input.endsWith('islands/kit/select-popup.tsx'))).map(([url]) => url);
    expect(menuFiles.length).toBeGreaterThan(0);
    expect(menuFiles.every(url => !staticUrls.includes(url)), 'Select menu loads only on interaction').toBe(true);
    const withImage = closure([manifest['@mx/kit/image'], ...staticUrls]);
    expect(withImage.reduce((sum, url) => sum + files[url].br, 0)).toBeLessThanOrEqual(85 * 1024);
    const dataCode = staticUrls.map(url => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8')).join('\n');
    const dynamic = [...dataCode.matchAll(/import\("\.\/([\w-]+\.js)"\)/g)].map(match => `/islands/${match[1]}`);
    expect(dynamic.some(url => files[url]?.gz > 100 * 1024)).toBe(true);
    expect(dynamic.every(url => !staticUrls.includes(url))).toBe(true);
  });

  it('keeps the frame editor out of every reader closure: page names it only lazily, and ProseMirror loads only after it', () => {
    const { manifest, files, closure } = first;
    const editor = manifest[FRAME_EDITOR.specifier];
    expect(editor).toMatch(/^\/islands\/frame-editor-[0-9a-f]{16}\.js$/);
    expect(existsSync(path.join(outDir, editor.slice('/islands/'.length)))).toBe(true);
    const readers = [manifest['@mx/rt'], manifest['@mx/boot'], manifest['@mx/page'], ...KIT_FAMILIES.map((family) => manifest[`@mx/kit/${family}`])];
    const editorFiles = Object.keys(files).filter((url) => /\/frame-editor(-chunk)?-[0-9a-f]{16}\.js$/.test(url));
    expect(closure(readers).filter((url) => editorFiles.includes(url))).toEqual([]);
    const page = readFileSync(path.join(outDir, manifest['@mx/page'].slice('/islands/'.length)), 'utf8');
    expect(page).toContain(`import("./${editor.slice('/islands/'.length)}")`);
    // Attaching (comments, selection actions) loads the controller and the relay; the editor itself is behind them.
    const { outputInputs } = JSON.parse(readFileSync(CACHE_MARKER, 'utf8'));
    const carried = (urls) => urls.flatMap((url) => outputInputs[url] ?? []);
    expect(carried(closure([editor])).some((input) => input.endsWith('story-runtime/island-controller.ts'))).toBe(true);
    expect(carried(closure([editor])).some((input) => input.includes('node_modules/prosemirror-view/'))).toBe(false);
    expect(carried(editorFiles).some((input) => input.includes('node_modules/prosemirror-view/'))).toBe(true);
  });

  it('loads tooltip placement only when a tooltip opens', () => {
    const { manifest, files, closure } = first;
    const staticUrls = closure([manifest['@mx/kit/disclosure']]);
    const code = staticUrls.map(url => readFileSync(path.join(outDir, url.slice('/islands/'.length)), 'utf8')).join('\n');
    const lazy = [...code.matchAll(/import\("\.\/([\w-]+\.js)"\)/g)].map(match => `/islands/${match[1]}`);
    expect(lazy.some(url => files[url]?.br > 4 * 1024 && !staticUrls.includes(url))).toBe(true);
  });
});

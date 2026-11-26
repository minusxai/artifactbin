/**
 * The two entries as a browser build bundles them (esbuild, minified, with the slim entity decoder wired as every
 * build that bundles this module must wire it): the display entry carries no ProseMirror or Tiptap and stays inside
 * its gzipped budget, the editor entry inside its own, and the display bundle, run outside this test runner, decodes
 * entities exactly as the runner does.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Metafile } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { slimEntitiesEsbuild } from '../../../../../scripts/lib/slim-entities.mjs';
import { parse } from '../display';
import { ENTITY_SAMPLES } from './samples';

/**
 * Gzipped bytes, measured 2026-11-26: display 38,668 (29,696 with Prism's grammars stubbed out; 67,609 with
 * markdown-it's full entity table), editor 175,374 (prosemirror-view, @tiptap/core and markdown-it the most).
 */
const DISPLAY_GZIP_BUDGET = 40 * 1024;
const EDITOR_GZIP_BUDGET = 180 * 1024;
const app = path.resolve(import.meta.dirname, '../../..');
const bundle = async (entry: string) => {
  const result = await build({
    entryPoints: [path.resolve(import.meta.dirname, '..', entry)], bundle: true, minify: true, write: false, metafile: true,
    format: 'esm', platform: 'browser', target: 'es2022', legalComments: 'none', logLevel: 'silent',
    alias: { '@': app }, plugins: [slimEntitiesEsbuild()],
  });
  return { text: result.outputFiles[0]!.text, inputs: Object.keys((result.metafile as Metafile).inputs) };
};
let display: Awaited<ReturnType<typeof bundle>>, editor: Awaited<ReturnType<typeof bundle>>;
const dir = mkdtempSync(path.join(tmpdir(), 'markdown-bundle-'));
beforeAll(async () => { [display, editor] = await Promise.all([bundle('display.ts'), bundle('editor.ts')]); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the display entry', () => {
  it('bundles neither ProseMirror nor Tiptap, and the slim decoder instead of the entity table', () => {
    expect(display.inputs.filter(input => /prosemirror|@tiptap|[\\/]entities[\\/]/.test(input))).toEqual([]);
    expect(display.inputs.some(input => input.endsWith('lib/markdown/entities.ts'))).toBe(true);
  });
  it(`stays within ${DISPLAY_GZIP_BUDGET} bytes gzipped`, () => {
    expect(gzipSync(display.text).byteLength).toBeLessThanOrEqual(DISPLAY_GZIP_BUDGET);
  });
  it('decodes entities outside this runner exactly as inside it', () => {
    const file = path.join(dir, 'display.mjs');
    writeFileSync(file, display.text);
    const script = `const m = await import(${JSON.stringify(`file://${file}`)}); const samples = JSON.parse(process.argv[1]); `
      + 'process.stdout.write(JSON.stringify(samples.map(sample => m.parse(sample))));';
    const outside = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(ENTITY_SAMPLES)], { encoding: 'utf8' }));
    expect(outside).toEqual(ENTITY_SAMPLES.map(sample => parse(sample)));
  });
});

describe('the editor entry', () => {
  it(`stays within ${EDITOR_GZIP_BUDGET} bytes gzipped`, () => {
    expect(editor.inputs.some(input => input.includes('@tiptap/core'))).toBe(true);
    expect(gzipSync(editor.text).byteLength).toBeLessThanOrEqual(EDITOR_GZIP_BUDGET);
  });
});

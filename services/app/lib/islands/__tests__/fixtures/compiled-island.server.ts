/**
 * The SERVER half of compiled-island.test.ts, run in a plain node process (`tsx`): Solid's server
 * entries resolve by node's own conditions, so the SSR module, the runtime's server build and
 * `renderToString` share ONE Solid — as they do in the server bundle. Prints `{ html, islands, flow }`.
 *
 *   tsx services/app/lib/islands/__tests__/fixtures/compiled-island.server.ts '<markup>'
 */
import esbuild from 'esbuild';
import path from 'node:path';
import { solidPlugin } from '../../../../../../scripts/build-islands.mjs';
import { generate, declaredValues } from '@/lib/compiled-page/compiler';
import { buildDocumentModules, evaluateModule, ssrImportTable } from '@/lib/compiled-page/bundle.server';
import type { ModuleRef, ModuleStore } from '@/lib/compiled-page/contract';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '@/lib/story/helmet';
import { compileDataflow, prepareCompile } from '@/lib/story/compile-dataflow';

const APP = path.resolve(import.meta.dirname, '../../../..');

const source = process.argv[2]!;
const parsed = parseJsx(source) as { nodes: JsxNode[] };
const { content, body } = splitHelmet(parsed.nodes);
const declared = dataflowOf(content);
const compiled = compileDataflow(declared, await prepareCompile(declared, async () => null), body);
if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join('; '));
const flow = compiled.compiled;

// The runtime compiled for the server, as the shared build's server half will be: Solid left bare, injected.
const rtBuild = await esbuild.build({
  entryPoints: [path.join(APP, 'lib/islands/rt.tsx')], bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022',
  external: ['solid-js', 'solid-js/web', 'solid-js/store'], alias: { '@': APP }, logLevel: 'error',
  plugins: [solidPlugin({ generate: 'ssr', hydratable: true })],
});
const rt = await evaluateModule(rtBuild.outputFiles[0]!.text, ssrImportTable(), 'test/rt.server.js');

const stored = new Map<string, Uint8Array>();
const store: ModuleStore = {
  async put(bytes, imports): Promise<ModuleRef> { const sha = String(stored.size).padStart(16, '0'); stored.set(sha, bytes); return { sha, url: `/islands/d/${sha}.js`, bytes: bytes.byteLength, imports }; },
  async get(sha) { return stored.get(sha) ?? null; },
};
const generated = generate({ nodes: parsed.nodes, colorMode: 'light', template: null, chrome: true, refData: {}, flow });
const built = await buildDocumentModules(generated, {
  build: { id: 'test', manifest: { '@mx/rt': '/islands/rt.js', '@mx/boot': '/islands/boot.js' } },
  flow, values: declaredValues(flow), imports: ssrImportTable({ '@mx/rt': rt }), store,
});
process.stdout.write(JSON.stringify({ html: built.html, islands: generated.islands, islandRefs: generated.islandRefs, flow }));

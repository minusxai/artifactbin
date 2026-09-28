/**
 * The SERVER half of compiled-island.test.ts, run in a plain node process (`tsx`, cwd services/app):
 * Solid's server entries resolve by node's own conditions, and the SSR module renders over the shared
 * build's REAL server half (public/islands/manifest.json `ssr`, loaded by `defaultSsrImports`), one Solid
 * injected into both — as in the server bundle. Prints `{ html, islands, islandRefs, flow }`.
 *
 *   (cd services/app && tsx --tsconfig ../../tsconfig.json lib/islands/__tests__/fixtures/compiled-island.server.ts '<markup>')
 */
import { generate, declaredValues } from '@/lib/compiled-page/compiler';
import { buildDocumentModules } from '@/lib/compiled-page/bundle.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { ModuleRef, ModuleStore } from '@/lib/compiled-page/contract';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '@/lib/story/helmet';
import { compileDataflow, prepareCompile } from '@/lib/story/compile-dataflow';

const source = process.argv[2]!;
const parsed = parseJsx(source) as { nodes: JsxNode[] };
const { content, body } = splitHelmet(parsed.nodes);
const declared = dataflowOf(content);
const compiled = compileDataflow(declared, await prepareCompile(declared, async () => null), body);
if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join('; '));
const flow = compiled.compiled;

const stored = new Map<string, Uint8Array>();
const store: ModuleStore = {
  async put(bytes, imports): Promise<ModuleRef> { const sha = String(stored.size).padStart(16, '0'); stored.set(sha, bytes); return { sha, url: `/islands/d/${sha}.js`, bytes: bytes.byteLength, imports }; },
  async get(sha) { return stored.get(sha) ?? null; },
};
const generated = generate({ nodes: parsed.nodes, colorMode: 'light', template: null, chrome: true, refData: {}, flow });
const built = await buildDocumentModules(generated, {
  // `--shipped`: the shared island build's real manifest, for islands that import kit families.
  build: process.argv[3] === '--shipped' ? loadCompilerBuild() : { id: 'test', manifest: { '@mx/rt': '/islands/rt.js', '@mx/boot': '/islands/boot.js', '@mx/kit/basic': '/islands/kit-basic.js' } },
  flow, values: declaredValues(flow), store, ssrStore: store,
});
process.stdout.write(JSON.stringify({ html: built.html, islands: generated.islands, islandRefs: generated.islandRefs, flow }));

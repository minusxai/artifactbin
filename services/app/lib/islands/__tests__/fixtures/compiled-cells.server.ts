/**
 * The SERVER half of compiled-cells.test.ts — compiled-island.server.ts with one dataset import resolved
 * (`ref:CELLS1`, one `rows` table, the columns given as JSON in argv[3]), so the document's queries and
 * mutations compile as a published document's do and run through the page's transport; and the story is
 * the SSR module's render over a snapshot (argv[4], `ServedResults`), as a reader with a guest snapshot is
 * served it (compiled-page/serve.server). Run in a plain node process (`tsx`, cwd services/app):
 * Solid's server entries resolve by node's own conditions, and the SSR module renders over the shared
 * build's REAL server half (public/islands/manifest.json `ssr`, loaded by `defaultSsrImports`), one Solid
 * injected into both — as in the server bundle. Prints `{ html, islands, islandRefs, flow }`.
 *
 *   (cd services/app && tsx --tsconfig ../../tsconfig.json lib/islands/__tests__/fixtures/compiled-cells.server.ts '<markup>' '<columns json>')
 */
import { generate, declaredValues } from '@/lib/compiled-page/compiler';
import { buildDocumentModules, loadSsrModule } from '@/lib/compiled-page/bundle.server';
import type { ModuleRef, ModuleStore } from '@/lib/compiled-page/contract';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '@/lib/story/helmet';
import { compileDataflow, prepareCompile, type ImportSource } from '@/lib/story/compile-dataflow';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';

const source = process.argv[2]!;
const parsed = parseJsx(source) as { nodes: JsxNode[] };
const { content, body } = splitHelmet(parsed.nodes);
const declared = dataflowOf(content);
const dataset: ImportSource = { kind: 'dataset', tables: [{ name: 'rows', columns: JSON.parse(process.argv[3]!) }] };
const compiled = compileDataflow(declared, await prepareCompile(declared, async (ref) => (ref === 'CELLS1' ? dataset : null)), body);
if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join('; '));
const flow = compiled.compiled;

const stored = new Map<string, Uint8Array>();
const store: ModuleStore = {
  async put(bytes, imports): Promise<ModuleRef> { const sha = String(stored.size).padStart(16, '0'); stored.set(sha, bytes); return { sha, url: `/islands/d/${sha}.js`, bytes: bytes.byteLength, imports }; },
  async get(sha) { return stored.get(sha) ?? null; },
};
const generated = generate({ nodes: parsed.nodes, colorMode: 'light', template: null, chrome: true, refData: {}, flow });
const built = await buildDocumentModules(generated, {
  // The shared island build's real manifest: the islands import kit families.
  build: loadCompilerBuild(),
  flow, values: declaredValues(flow), store, ssrStore: store,
});
const ssr = await loadSsrModule(built.ssr!, store);
const html = ssr.render({ values: declaredValues(flow), results: JSON.parse(process.argv[4]!), mermaidImages: {}, drawings: {} });
process.stdout.write(JSON.stringify({ html, islands: generated.islands, islandRefs: generated.islandRefs, flow }));

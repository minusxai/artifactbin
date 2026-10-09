/**
 * The SERVER half of compiled-island.test.ts, run in a plain node process (`tsx`, cwd services/app):
 * Solid's server entries resolve by node's own conditions, and the SSR module renders over the shared
 * build's REAL server half (public/islands/manifest.json `ssr`, loaded by `defaultSsrImports`), one Solid
 * injected into both — as in the server bundle. Prints `{ html, islands, islandRefs, flow }`.
 *
 *   (cd services/app && tsx --tsconfig ../../tsconfig.json lib/islands/__tests__/fixtures/compiled-island.server.ts '<markup>')
 */
import { generate, declaredValues } from '@/lib/compiled-page/compiler';
import { buildDocumentModules, ssrModuleOf } from '@/lib/compiled-page/bundle.server';
import { createTemplateResourceStore } from '@/lib/compiled-page/modules.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { bindModuleCode } from '@/lib/compiled-page/runtime-binding';
import type { ModuleRef, ModuleStore } from '@/lib/compiled-page/contract';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { dataflowOf, splitHelmet } from '@/lib/document/helmet';
import { compileDataflow, prepareCompile } from '@/lib/dataflow/compile-dataflow';

const source = process.argv[2]!;
const parsed = parseJsx(source) as { nodes: JsxNode[] };
const { content, body } = splitHelmet(parsed.nodes);
const declared = dataflowOf(content);
const compiled = compileDataflow(declared, await prepareCompile(declared, async ref => ref === 'Data01'
  ? { kind: 'dataset', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'date' }, { name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] }] }
  : null), body);
if (!compiled.ok) throw new Error(compiled.errors.map((e) => e.message).join('; '));
const flow = compiled.compiled;

const stored = new Map<string, Uint8Array>();
const store: ModuleStore = {
  async put(bytes, imports): Promise<ModuleRef> { const sha = String(stored.size).padStart(16, '0'); stored.set(sha, bytes); return { sha, url: `/islands/d/${sha}.js`, bytes: bytes.byteLength, imports }; },
  async get(sha) { return stored.get(sha) ?? null; },
};
const generated = generate({ nodes: parsed.nodes, colorMode: 'light', template: null, chrome: true, refData: {}, flow });
// `--shipped`: the shared island build's real manifest, for islands that import kit families.
const build = process.argv[3] === '--shipped' ? loadCompilerBuild() : { id: 'test', manifest: { '@mx/rt': '/islands/rt.js', '@mx/boot': '/islands/boot.js', '@mx/kit/basic': '/islands/kit-basic.js', '@mx/kit/dialog': '/islands/kit-dialog.js' } };
const built = await buildDocumentModules(generated, {
  build,
  flow, values: declaredValues(flow), store, ssrStore: store,
});
// The bytes as the browser receives them: bound to the build's chunk URLs when served (runtime-binding).
const browserCode = bindModuleCode(new TextDecoder().decode(stored.get(built.module!.sha)), build);
const templateSha = /\/islands\/t\/([0-9a-f]{16})\.json/.exec(browserCode)?.[1];
const templateResource = templateSha ? new TextDecoder().decode((await createTemplateResourceStore().get(templateSha))!) : null;
// `--results=<json>`: render again as the serve path does once the server has answered the queries.
const served = process.argv.find((arg) => arg.startsWith('--results='));
let html = built.html;
if (served) {
  const ssr = await ssrModuleOf(new TextDecoder().decode(stored.get(built.ssr!.sha)), 'served');
  const tail = built.html.indexOf('<script type="application/json" data-mx-island-literals');
  html = ssr.render({ values: declaredValues(flow), results: JSON.parse(served.slice('--results='.length)), mermaidImages: {}, drawings: {} }) + built.html.slice(tail);
}
process.stdout.write(JSON.stringify({ html, islands: generated.islands, browserCode, templateResource, islandRefs: generated.islandRefs, flow }));

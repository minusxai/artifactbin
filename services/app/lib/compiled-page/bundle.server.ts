/**
 * THE PER-DOCUMENT BUILD (docs/phase2-architecture.md §2.1, §3; contract `ModuleRef`, `IslandRenderData`).
 *
 * The compiler (compiler.ts) generates Solid JSX sources; this turns them into what a compiled page
 * stores and serves — with Babel and Solid's preset only, because the production image carries no
 * bundler:
 *
 *   browser module   the islands + a boot call, `generate: 'dom', hydratable`, every import rewritten
 *                    to the shared build's content-addressed chunk URL (`CompilerBuild.manifest`),
 *                    compacted, stored in the module store. Only a version with islands has one.
 *   SSR module       the same islands, `generate: 'ssr', hydratable`, plus `render(data)`: the story
 *                    HTML (the skeleton, rendered once at compile time and carried as a string
 *                    literal) with each island rendered from `data` in its slot. Stored like the
 *                    browser module; its imports stay SPECIFIERS (`solid-js/web`, `@mx/rt`), bound by
 *                    `loadSsrModule` in whichever process renders it.
 *
 * ONE SOLID ON THE SERVER. A generated module never resolves `solid-js` itself: `evaluateModule`
 * turns its imports into lookups on an injected table, and the table's Solid is the one this module
 * imports (bundled into the server in production, where node_modules carries no `solid-js`). The
 * server builds of `@mx/rt` and `@mx/kit/*` come from the shared build's SSR half (`ssr` in
 * public/islands/manifest.json), evaluated the same way; until that half exists a version with islands
 * cannot be rendered on the server and the compile fails with `IslandSsrUnavailable`.
 *
 * Author text is only ever in string literals of the sources handed in (codegen-safety.ts); nothing
 * here adds any.
 */
import { transformAsync, type PluginObj, type types as BabelTypes } from '@babel/core';
// @ts-expect-error babel-preset-solid ships no types; it is a Babel preset function.
import solidPreset from 'babel-preset-solid';
import * as solid from 'solid-js';
import * as solidWeb from 'solid-js/web';
import * as solidStore from 'solid-js/store';
import { readFileSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import path from 'node:path';
import vm from 'node:vm';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { Scalar } from '@/lib/story/dataflow';
import { ISLANDS_MANIFEST_PATH } from './build.server';
import { DOCUMENT_MODULE_RE, type CompilerBuild, type IslandRenderData, type ModuleRef, type ModuleStore } from './contract';
import type { GeneratedSources } from './codegen-safety';
import { syncRailPreview } from './rail-preview.server';
import { objectStore, ObjectUnavailable, type ObjectStore } from '@/lib/object-store';
import { createModuleStore, createTemplateResourceStore } from './modules.server';
import { contentSha } from './speculation';

/* ────────────────────────────────────────────────────────────────────────────
 * The Solid transform
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SolidTarget { generate: 'dom' | 'ssr'; hydratable: boolean }

/**
 * Solid's JSX transform over one generated module, then a finishing pass: the optional import
 * rewrite, and every string and template literal re-escaped so the module's bytes carry no raw
 * `<`, `>`, U+2028 or U+2029 — author text stays inert even where a module's text is inspected or
 * embedded, not only where it is parsed.
 */
export async function transformSolid(source: string, target: SolidTarget, options: { minify?: boolean; rewrite?: (specifier: string) => string; moduleName?: string } = {}): Promise<string> {
  const out = await transformAsync(source, {
    filename: 'document.jsx', babelrc: false, configFile: false, sourceType: 'module', compact: false, comments: false,
    presets: [[solidPreset, { generate: target.generate, hydratable: target.hydratable, ...(options.moduleName ? { moduleName: options.moduleName } : {}) }]],
  });
  if (!out?.code) throw new Error('compile: the Solid transform produced nothing');
  // The preset adds its own imports as it finishes; rewrite and escape on the finished module.
  const finished = await transformAsync(out.code, {
    filename: 'document.js', babelrc: false, configFile: false, sourceType: 'module',
    // `compact`, not `minified`: the generator prints a literal's `extra.raw` only when not minifying.
    compact: !!options.minify, comments: !options.minify,
    plugins: [...(options.rewrite ? [rewriteImports(options.rewrite)] : []), escapeLiterals],
  });
  if (!finished?.code) throw new Error('compile: the finishing pass produced nothing');
  return finished.code;
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const escapeRaw = (raw: string): string => raw.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');
/** A JS string literal with `<`, `>`, U+2028 and U+2029 escaped (the compiler's `lit`). */
const lit = (value: string): string => escapeRaw(JSON.stringify(value));

/** A Babel plugin: every string literal printed through `lit`, every template chunk's raw text escaped the same way. */
function escapeLiterals(): PluginObj {
  return {
    visitor: {
      StringLiteral(p) { p.node.extra = { ...p.node.extra, raw: lit(p.node.value), rawValue: p.node.value }; },
      TemplateElement(p) { p.node.value = { ...p.node.value, raw: escapeRaw(p.node.value.raw) }; },
    },
  };
}

/** Move Solid's DOM factories into inert HTML. The module keeps only their content addresses. */
async function externalizeDomTemplates(code: string): Promise<{ code: string; templates: Map<string, string> }> {
  const templates = new Map<string, string>();
  const out = await transformAsync(code, {
    filename: 'document.js', babelrc: false, configFile: false, sourceType: 'module', compact: true, comments: false,
    plugins: [({ types: t }: { types: typeof BabelTypes }): PluginObj => ({
      visitor: {
        Program(p) {
          const names = new Set<string>();
          for (const statement of p.node.body) {
            if (!t.isImportDeclaration(statement)) continue;
            for (const spec of statement.specifiers) {
              if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: 'template' })) {
                names.add(spec.local.name);
                spec.imported = t.identifier('templateFromPage');
              }
            }
          }
          if (!names.size) return;
          p.traverse({ CallExpression(call) {
            if (!t.isIdentifier(call.node.callee) || !names.has(call.node.callee.name)) return;
            const first = call.node.arguments[0];
            const markup = t.isStringLiteral(first) ? first.value
              : t.isTemplateLiteral(first) && first.expressions.length === 0 ? first.quasis[0]?.value.cooked : undefined;
            if (markup === undefined || markup === null) throw new Error('compile: Solid template must be a literal');
            const key = contentSha(markup);
            templates.set(key, markup);
            call.node.arguments[0] = t.stringLiteral(key);
          } });
        },
      },
    })],
  });
  if (!out?.code) throw new Error('compile: template extraction produced nothing');
  return { code: out.code, templates };
}

/** Author-derived text and attributes are page data too; only import specifiers stay as JS literals. */
async function externalizeLiterals(code: string): Promise<{ code: string; literals: string[]; key: string }> {
  const literals: string[] = [];
  const indexes = new Map<string, number>();
  const out = await transformAsync(code, {
    filename: 'document.js', babelrc: false, configFile: false, sourceType: 'module', compact: true, comments: false,
    plugins: [({ types: t }: { types: typeof BabelTypes }): PluginObj => ({ visitor: {
      StringLiteral(p) {
        if (p.parentPath.isImportDeclaration() && p.key === 'source') return;
        if (p.parentPath.isObjectProperty() && p.key === 'key' && !p.parentPath.node.computed) return;
        if (p.parentPath.isMemberExpression() && p.key === 'property' && !p.parentPath.node.computed) return;
        let index = indexes.get(p.node.value);
        if (index === undefined) { index = literals.push(p.node.value) - 1; indexes.set(p.node.value, index); }
        p.replaceWith(t.memberExpression(t.identifier('$mxL'), t.numericLiteral(index), true));
        p.skip();
      },
      TemplateLiteral(p) {
        if (p.node.expressions.length !== 0) return;
        const value = p.node.quasis[0]?.value.cooked;
        if (value === undefined || value === null) return;
        let index = indexes.get(value);
        if (index === undefined) { index = literals.push(value) - 1; indexes.set(value, index); }
        p.replaceWith(t.memberExpression(t.identifier('$mxL'), t.numericLiteral(index), true));
        p.skip();
      },
    } })],
  });
  if (!out?.code) throw new Error('compile: literal extraction produced nothing');
  const key = contentSha(JSON.stringify(literals));
  return { code: literals.length ? `const $mxL=JSON.parse(document.querySelector('script[data-mx-island-literals="${key}"]').textContent);\n${out.code}` : out.code, literals, key };
}

const literalsHtml = (key: string, literals: readonly string[]): string =>
  literals.length ? `<script type="application/json" data-mx-island-literals="${key}">${escapeRaw(JSON.stringify(literals)).replace(/&/g, '\\u0026')}</script>` : '';

/** A Babel plugin: every static import's specifier through `rewrite` (which throws on one it does not know). */
function rewriteImports(rewrite: (specifier: string) => string): () => PluginObj {
  return () => ({
    visitor: {
      ImportDeclaration(p) { p.node.source.value = rewrite(p.node.source.value); },
      ExportNamedDeclaration(p) { if (p.node.source) throw new Error('compile: a generated module re-exports another'); },
      ExportAllDeclaration() { throw new Error('compile: a generated module re-exports another'); },
      Import() { throw new Error('compile: a generated module imports dynamically'); },
    },
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Evaluating a generated module on the server
 * ──────────────────────────────────────────────────────────────────────────── */

/** What a server module's import specifiers resolve to: a namespace object per specifier. */
export type SsrImports = (specifier: string) => Record<string, unknown>;

/** The shared build has no server half for a specifier a stored module imports. */
export class IslandSsrUnavailable extends Error {
  constructor(readonly specifier: string, detail: string) {
    super(`island SSR: no server build of ${specifier} (${detail})`);
    this.name = 'IslandSsrUnavailable';
  }
}

/** A Babel plugin turning a module's imports and exports into an injected-import function body. */
function moduleToFunction(t: typeof BabelTypes): PluginObj {
  return {
    visitor: {
      Program: {
        exit(p) {
          const hoisted: BabelTypes.Statement[] = [];
          const exported: Array<[string, string]> = [];
          const body: BabelTypes.Statement[] = [];
          for (const statement of p.node.body) {
            if (t.isImportDeclaration(statement)) {
              const namespace = t.callExpression(t.identifier('__mx_import'), [t.stringLiteral(statement.source.value)]);
              for (const s of statement.specifiers) {
                const value = t.isImportNamespaceSpecifier(s) ? namespace
                  : t.isImportDefaultSpecifier(s) ? t.memberExpression(namespace, t.identifier('default'))
                  : t.memberExpression(namespace, t.stringLiteral(t.isIdentifier(s.imported) ? s.imported.name : s.imported.value), true);
                hoisted.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier(s.local.name), value)]));
              }
            } else if (t.isExportNamedDeclaration(statement)) {
              if (statement.source) throw new Error('evaluate: a re-export');
              const d = statement.declaration;
              if (d) {
                body.push(d);
                if (t.isFunctionDeclaration(d) && d.id) exported.push([d.id.name, d.id.name]);
                else if (t.isVariableDeclaration(d)) for (const v of d.declarations) if (t.isIdentifier(v.id)) exported.push([v.id.name, v.id.name]);
              }
              for (const s of statement.specifiers) if (t.isExportSpecifier(s)) exported.push([s.local.name, t.isIdentifier(s.exported) ? s.exported.name : s.exported.value]);
            } else if (t.isExportDefaultDeclaration(statement)) {
              const d = statement.declaration;
              if (t.isFunctionDeclaration(d) && d.id) { body.push(d); exported.push([d.id.name, 'default']); } else {
                body.push(t.variableDeclaration('const', [t.variableDeclarator(t.identifier('__mx_default'), d as BabelTypes.Expression)]));
                exported.push(['__mx_default', 'default']);
              }
            } else if (t.isExportAllDeclaration(statement)) {
              throw new Error('evaluate: a re-export');
            } else {
              body.push(statement);
            }
          }
          body.push(t.returnStatement(t.objectExpression(exported.map(([local, name]) => t.objectProperty(t.stringLiteral(name), t.identifier(local))))));
          p.node.body = [...hoisted, ...body];
          p.skip();
        },
      },
    },
  };
}

/**
 * Evaluate an ES module's text as a function of its imports: `import` statements become lookups on
 * `imports`, exports become the returned object. No file, no resolver, no second Solid.
 */
export async function evaluateModule(code: string, imports: SsrImports, filename: string): Promise<Record<string, unknown>> {
  const out = await transformAsync(code, {
    filename, babelrc: false, configFile: false, sourceType: 'module', compact: false, comments: false,
    parserOpts: { allowReturnOutsideFunction: true },
    plugins: [({ types }: { types: typeof BabelTypes }) => moduleToFunction(types)],
  });
  if (!out?.code) throw new Error(`evaluate: ${filename} produced nothing`);
  const fn = vm.compileFunction(`'use strict';\n${out.code}`, ['__mx_import'], { filename }) as (load: SsrImports) => Record<string, unknown>;
  return fn(imports);
}

/**
 * Solid's server spread (`ssrElement`) writes `class="<class> <className> "` — a trailing space, and
 * `class=""` for an absent value — where React writes the value as given and omits an absent one. The
 * kit spreads its authored props, so every server render (skeleton, islands, the kit's own server half)
 * goes through this: the class value React would write, handed to Solid as `attr:class`, which it
 * writes verbatim. Hydration leaves a served class alone, and a client render sets `className` exactly.
 */
type SsrElement = (tag: string, props: unknown, children: unknown, needsId: boolean) => unknown;
const solidSsrElement = solidWeb.ssrElement as unknown as SsrElement;
export const ssrElementReactClass: SsrElement = (tag, props, children, needsId) => {
  const given = (typeof props === 'function' ? (props as () => unknown)() : props ?? {}) as Record<string, unknown>;
  if ('classList' in given || !('class' in given || 'className' in given)) return solidSsrElement(tag, given, children, needsId);
  const values = [given.class, given.className].filter((v) => v !== undefined && v !== null && v !== false);
  const exact: Record<string, unknown> = {};
  for (const key of Object.keys(given)) {
    if (key === 'class' || key === 'className') {
      if (values.length && !('attr:class' in exact)) exact['attr:class'] = values.join(' ');
      continue;
    }
    // The descriptor, not the value: a `children` getter must run inside ssrElement, AFTER it takes the element's
    // hydration key, or the children's components shift every key the browser expects.
    Object.defineProperty(exact, key, Object.getOwnPropertyDescriptor(given, key)!);
  }
  return solidSsrElement(tag, exact, children, needsId);
};
const SOLID: Readonly<Record<string, Record<string, unknown>>> = { 'solid-js': solid, 'solid-js/web': { ...solidWeb, ssrElement: ssrElementReactClass }, 'solid-js/store': solidStore };

/** An import table of this process's Solid plus the given namespaces (a test's stand-in server half). */
export function ssrImportTable(extra: Readonly<Record<string, Record<string, unknown>>> = {}): SsrImports {
  const table: Record<string, Record<string, unknown>> = { ...SOLID, ...extra };
  return (spec) => {
    const namespace = table[spec];
    if (!namespace) throw new IslandSsrUnavailable(spec, 'not in the import table');
    return namespace;
  };
}

/**
 * The server half of the shared island build (a contract request to the toolchain; see the report):
 * `manifest.json`'s `ssr` names ONE file under public/islands, compiled `generate: 'ssr', hydratable`,
 * that exports a namespace per `@mx/*` specifier (`exports`: specifier → export name) and imports
 * nothing but `solid-js*` — so its one module graph shares one island context, and the Solid it runs
 * on is the one injected here.
 */
interface SsrHalf { url: string; exports: Record<string, string> }
const islandSsrHalves = new Map<string, Promise<Record<string, unknown>>>();

function readSsrHalf(root: string): SsrHalf | null {
  let manifest: { ssr?: unknown };
  try { manifest = JSON.parse(readFileSync(path.resolve(root, ISLANDS_MANIFEST_PATH), 'utf8')) as { ssr?: unknown }; } catch { return null; }
  const half = manifest.ssr as Partial<SsrHalf> | undefined;
  if (!half || typeof half.url !== 'string' || !/^\/islands\/[\w-]+\.js$/.test(half.url) || !half.exports || typeof half.exports !== 'object') return null;
  return { url: half.url, exports: half.exports };
}

async function islandSsrNamespace(specifier: string, root: string, retained?: SsrHalf): Promise<Record<string, unknown>> {
  const half = retained ?? readSsrHalf(root);
  if (!half) throw new IslandSsrUnavailable(specifier, 'the island build has no server half');
  const name = half.exports[specifier];
  if (!name) throw new IslandSsrUnavailable(specifier, 'the server half does not export it');
  const file = path.resolve(root, path.dirname(ISLANDS_MANIFEST_PATH), half.url.slice('/islands/'.length));
  let loaded = islandSsrHalves.get(file);
  if (!loaded) {
    const bytes = retained ? await (await import('./shared-builds.server')).retainedIslandFile(path.basename(file)) : null;
    loaded = evaluateModule(bytes ? bytes.toString('utf8') : readFileSync(file, 'utf8'), (spec) => {
      const namespace = SOLID[spec];
      if (!namespace) throw new IslandSsrUnavailable(spec, `imported by the server half ${half.url}`);
      return namespace;
    }, `mx-island-ssr${half.url}`);
    loaded.catch(() => islandSsrHalves.delete(file));
    islandSsrHalves.set(file, loaded);
  }
  const namespace = (await loaded)[name];
  if (!namespace || typeof namespace !== 'object') throw new IslandSsrUnavailable(specifier, `the server half has no export ${name}`);
  return namespace as Record<string, unknown>;
}

/** Every static import specifier of a module's text. */
async function importsOf(code: string): Promise<string[]> {
  const found = new Set<string>();
  await transformAsync(code, { filename: 'scan.js', babelrc: false, configFile: false, sourceType: 'module', code: false, plugins: [(): PluginObj => ({ visitor: { ImportDeclaration(p) { found.add(p.node.source.value); } } })] });
  return [...found].sort();
}

/**
 * The default import table for a server module: this process's Solid, and the shared build's
 * server half for `@mx/*` (read relative to `root`, the app's cwd by default).
 */
export async function defaultSsrImports(code: string, root = process.cwd(), half?: SsrHalf): Promise<SsrImports> {
  const islands: Record<string, Record<string, unknown>> = {};
  for (const spec of await importsOf(code)) {
    if (SOLID[spec]) continue;
    if (!spec.startsWith('@mx/')) throw new IslandSsrUnavailable(spec, 'not a shared-build specifier');
    islands[spec] = await islandSsrNamespace(spec, root, half);
  }
  return ssrImportTable(islands);
}

/**
 * Where SSR modules live: an object-store prefix NO route serves. An SSR module carries the whole
 * page's HTML (a private document's included), so it never sits beside the browser modules the
 * public `/islands/d/<sha>.js` route reads (`islands/<sha>`); its ref's `url` is this object key.
 */
export const SSR_MODULE_PREFIX = 'islands-ssr';

/** SSR modules over the object store, content-addressed like the browser modules, under `SSR_MODULE_PREFIX`. */
export function createSsrModuleStore(objects: ObjectStore = objectStore()): ModuleStore {
  return {
    async put(bytes, imports) {
      const sha = contentSha(bytes);
      const key = `${SSR_MODULE_PREFIX}/${sha}`;
      await objects.put(key, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), 'text/javascript');
      return { sha, url: key, bytes: bytes.byteLength, imports: [...imports] };
    },
    async get(sha) {
      if (!DOCUMENT_MODULE_RE.test(sha)) return null;
      try {
        return await objects.get(`${SSR_MODULE_PREFIX}/${sha}`);
      } catch (error) {
        if (error instanceof ObjectUnavailable) return null;
        throw error;
      }
    },
  };
}

/** A stored SSR module, loaded: `render(data)` → the whole story HTML with the islands rendered from `data`. */
export interface SsrModule { render(data: IslandRenderData): string }

const ssrModules = new Map<string, Promise<SsrModule>>();

/** Evaluate a server module's code with an import table (the default one when none is given). */
export async function ssrModuleOf(code: string, name: string, imports?: SsrImports): Promise<SsrModule> {
  const exports = await evaluateModule(code, imports ?? await defaultSsrImports(code), `mx-ssr/${name}.js`);
  if (typeof exports.render !== 'function') throw new Error(`island SSR: ${name} exports no render`);
  const module = exports as unknown as SsrModule;
  return { ...module, render: (data) => syncRailPreview(module.render(data)) };
}

/**
 * The serve path's door (w3-serve): the SSR module a compiled page names, from the module store,
 * evaluated once per sha in this process. Rejects with `IslandSsrUnavailable` when the shared build
 * has no server half for what it imports.
 */
export function loadSsrModule(ref: ModuleRef, store: ModuleStore = createSsrModuleStore(), imports?: SsrImports, half?: SsrHalf): Promise<SsrModule> {
  const key = `${ref.sha}:${half?.url ?? 'current'}`;
  let loaded = ssrModules.get(key);
  if (!loaded) {
    loaded = (async () => {
      const bytes = await store.get(ref.sha);
      if (!bytes) throw new Error(`island SSR: module ${ref.sha} is not in the store`);
      const code = Buffer.from(bytes).toString('utf8');
      return ssrModuleOf(code, ref.sha, imports ?? await defaultSsrImports(code, process.cwd(), half));
    })();
    loaded.catch(() => ssrModules.delete(key));
    ssrModules.set(key, loaded);
  }
  return loaded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * One version's modules
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The skeleton's static subtrees put in place (compiler `Generated.statics`): each `<mx-static data-i="n">` the
 * skeleton rendered becomes the n-th subtree's HTML — today's React render of it, which never went through JSX.
 * A placeholder the skeleton did not render exactly so (an author's own element carries its `data-mx-ast` first)
 * is left alone.
 */
export const spliceStatics = (html: string, statics: readonly string[]): string =>
  statics.length ? html.replace(/<mx-static data-i="(\d+)"><\/mx-static>/g, (whole, i: string) => statics[Number(i)] ?? whole) : html;

/** The compile-time render of the skeleton: static HTML with a `<mx-slot data-i="n">` per island. */
export async function renderSkeleton(skeleton: string, imports?: SsrImports): Promise<string> {
  const source = `${skeleton}import { renderToString as $renderToString } from 'solid-js/web';\nexport function render() { return $renderToString(() => <Skeleton />); }\n`;
  const code = await transformSolid(source, { generate: 'ssr', hydratable: false });
  const exports = await evaluateModule(code, imports ?? await defaultSsrImports(code), 'mx-ssr/skeleton.js');
  return (exports.render as () => string)();
}

/** The SSR module's source: the islands and `render(data)` over the pre-rendered skeleton. */
function ssrSource(islands: string, skeletonHtml: string, flow: CompiledDataflow | null): string {
  return `${islands}import { renderToString as $renderToString } from 'solid-js/web';
const $skeleton = ${lit(skeletonHtml)};
const $flow = JSON.parse(${lit(JSON.stringify(flow))});
export function render(data) {
  const runtime = rt.createIslandRuntime({ dataflow: $flow ? { flow: $flow, values: data.values, ...(data.state ? { state: data.state } : {}), ...(data.results ? { results: data.results } : {}) } : null, assetsUrl: data.assetsUrl, mermaidImages: data.mermaidImages, viewer: null }, rt.createDataflowStore);
  try {
    let html = $skeleton;
    ISLANDS.forEach(([renderId, Island], n) => {
      // Wrapped exactly as the browser's hydrateIsland wraps it (rt.withIsland): the wrapper's
      // component levels are part of Solid's hydration keys.
      // Classes come out as React writes them: the injected Solid's ssrElement (ssrElementReactClass).
      const island = $renderToString(() => rt.withIsland(Island, runtime.context), { renderId });
      html = html.replace('<mx-slot data-i="' + n + '"></mx-slot>', () => island);
    });
    return html;
  } finally {
    runtime.dispose?.();
  }
}
`;
}

/**
 * The browser module's source: the islands, handed to the shared runtime's boot — with the
 * version's compiled dataflow when it declares data (the page's data island carries no flow).
 */
const browserSource = (islands: string, flow: CompiledDataflow | null, flowIndex?: number): string => flow
  ? `${islands}import { boot as $boot } from '@mx/boot';\nconst FLOW = ${flowIndex === undefined ? `JSON.parse(${lit(JSON.stringify(flow))})` : `$moduleData[${flowIndex}]`};\n$boot({ ISLANDS, FLOW });\n`
  : `${islands}import { boot as $boot } from '@mx/boot';\n$boot(ISLANDS);\n`;

interface ManifestFiles { files?: Record<string, { imports?: string[] }> }
let filesCache: { build: string; files: Record<string, { imports?: string[] }> } | null = null;
/** The shared chunks' static import graph (manifest.json `files`), for a module's preload closure. */
function sharedFiles(build: CompilerBuild): Record<string, { imports?: string[] }> {
  if (filesCache?.build === build.id) return filesCache.files;
  let files: Record<string, { imports?: string[] }> = {};
  try { files = (JSON.parse(readFileSync(path.resolve(process.cwd(), ISLANDS_MANIFEST_PATH), 'utf8')) as ManifestFiles).files ?? {}; } catch { /* no closure beyond the direct imports */ }
  filesCache = { build: build.id, files };
  return files;
}
function closureOf(build: CompilerBuild, urls: string[]): string[] {
  const files = sharedFiles(build);
  const seen = new Set<string>();
  const visit = (url: string): void => {
    if (seen.has(url)) return;
    seen.add(url);
    for (const next of files[url]?.imports ?? []) visit(next);
  };
  urls.forEach(visit);
  return [...seen];
}

export interface DocumentModules {
  html: string;
  module: ModuleRef | null;
  ssr: ModuleRef | null;
  templateBrBytes: number | null;
}

export interface BuildOptions {
  build: CompilerBuild;
  flow: CompiledDataflow | null;
  /** The declared state `html` renders the islands in. */
  values: Record<string, Scalar>;
  /** The browser modules' store (served at `/islands/d/<sha>.js`). */
  store?: ModuleStore;
  /** Injectable content-addressed resource store for browser-only DOM factories. */
  templateStore?: ReturnType<typeof createTemplateResourceStore>;
  /** The SSR modules' store (never served; `createSsrModuleStore`). */
  ssrStore?: ModuleStore;
  /** The server import table (tests); the default is this process's Solid and the shared build's server half. */
  imports?: SsrImports;
  /**
   * Build the browser module even when the version has no island (`ISLANDS = []`): its page must still
   * boot — a version with an author script starts the store and the author host there. No SSR module
   * then: with no island, nothing in the story renders data, so the skeleton's HTML is the story.
   */
  boot?: boolean;
}

/**
 * Build one version's modules from its generated sources: the skeleton rendered to HTML; with
 * islands, the browser and SSR modules stored and `html` rendered through the SSR module in the
 * declared state. A version with no island has neither module — unless it must boot (`boot`), when it
 * has the browser module alone.
 */
export async function buildDocumentModules(sources: GeneratedSources & { islandRefs: readonly unknown[]; statics?: readonly string[]; browserIslands?: string; moduleData?: readonly string[] }, options: BuildOptions): Promise<DocumentModules> {
  const renderedSkeleton = spliceStatics(await renderSkeleton(sources.skeleton, options.imports), sources.statics ?? []);
  if (!sources.islandRefs.length && !options.boot) return { html: renderedSkeleton, module: null, ssr: null, templateBrBytes: null };
  const moduleData = [...(sources.moduleData ?? [])];
  const flowJson = options.flow ? JSON.stringify(options.flow) : null;
  const flowIndex = flowJson && flowJson.length > 1024 ? moduleData.push(flowJson) - 1 : undefined;
  const moduleDataTag = moduleData.length
    ? `<script type="application/json" data-mx-module-data>${escapeRaw(JSON.stringify({ moduleData: moduleData.map((value) => JSON.parse(value) as unknown) }))}</script>`
    : '';
  const browserIslands = sources.browserIslands ?? sources.islands;
  const browserWithData = flowIndex !== undefined && !sources.moduleData?.length
    ? `const $moduleData = JSON.parse(document.getElementById("mx-story-data").textContent).moduleData;\n${browserIslands}`
    : browserIslands;
  const store = options.store ?? createModuleStore();
  const templateStore = options.templateStore ?? createTemplateResourceStore();
  if (!sources.islandRefs.length) {
    const browser = await browserModuleCode(browserWithData, options.build, options.flow, flowIndex);
    const templateBrBytes = templateBytes(browser.templates);
    const url = browser.templates.size ? await templateStore.put(Object.fromEntries(browser.templates)) : null;
    return { html: renderedSkeleton + literalsHtml(browser.literalKey, browser.literals) + moduleDataTag, module: await store.put(new TextEncoder().encode(withTemplateResource(browser.code, url, options.build, templateBrBytes, !!options.flow)), browser.imports), ssr: null, templateBrBytes };
  }
  const ssrStore = options.ssrStore ?? createSsrModuleStore();
  const browser = await browserModuleCode(browserWithData, options.build, options.flow, flowIndex);
  const templateBrBytes = templateBytes(browser.templates);
  const templateUrl = browser.templates.size ? await templateStore.put(Object.fromEntries(browser.templates)) : null;
  const skeletonHtml = renderedSkeleton + literalsHtml(browser.literalKey, browser.literals) + moduleDataTag;
  const ssrCode = await ssrModuleCode(sources.islands, skeletonHtml, options.flow);
  const loaded = await ssrModuleOf(ssrCode, contentSha(ssrCode), options.imports);
  const html = loaded.render({ values: options.values, results: null, mermaidImages: {}, drawings: {} });
  const [module, ssr] = await Promise.all([
    store.put(new TextEncoder().encode(withTemplateResource(browser.code, templateUrl, options.build, templateBrBytes, !!options.flow)), browser.imports),
    ssrStore.put(new TextEncoder().encode(ssrCode), await importsOf(ssrCode)),
  ]);
  return { html, module, ssr, templateBrBytes };
}

const templateBytes = (templates: Map<string, string>): number | null => templates.size
  ? brotliCompressSync(JSON.stringify(Object.fromEntries(templates))).byteLength : null;

/** The URL is build-owned data, inserted after author literal extraction. */
function withTemplateResource(code: string, url: string | null, build: CompilerBuild, brBytes: number | null, hasFlow: boolean): string {
  if (!url) return code;
  const rt = build.manifest['@mx/rt'];
  if (!rt) throw new Error('compile: the island build has no @mx/rt');
  const small = hasFlow && brBytes !== null && brBytes < 16_384;
  const prefetch = small
    ? `\nconst $mxPreload=()=>{void $mxLoad(${JSON.stringify(url)}).catch(()=>{})};\nif(typeof requestIdleCallback==='function')requestIdleCallback($mxPreload,{timeout:1});else setTimeout($mxPreload,0);`
    : '';
  return `import {configureTemplateResource as $mxTemplates${small ? ',loadTemplateResource as $mxLoad' : ''}} from ${JSON.stringify(rt)};\n$mxTemplates(${JSON.stringify(url)});\n${code}${prefetch}`;
}

/** The per-document browser module: DOM-compiled, imports bound to the shared chunks, compacted. `imports` is its static closure. */
export async function browserModuleCode(islands: string, build: CompilerBuild, flow: CompiledDataflow | null = null, flowIndex?: number): Promise<{ code: string; imports: string[]; templates: Map<string, string>; literals: string[]; literalKey: string }> {
  const direct = new Set<string>();
  // `moduleName: '@mx/rt'`: Solid's DOM helpers come from the runtime's one import surface, never
  // from the whole `solid-js/web` chunk.
  const compiled = await transformSolid(browserSource(islands, flow, flowIndex), { generate: 'dom', hydratable: true }, {
    minify: true, moduleName: '@mx/rt',
    rewrite: (specifier) => {
      const url = build.manifest[specifier];
      if (!url) throw new Error(`compile: the island build has no ${specifier}`);
      direct.add(url);
      return url;
    },
  });
  const extracted = await externalizeDomTemplates(compiled);
  const { code, literals, key } = await externalizeLiterals(extracted.code);
  return { code, templates: extracted.templates, literals, literalKey: key, imports: closureOf(build, [...direct].sort()) };
}

/** The per-document SSR module: the islands compiled for the server and `render(data)` over the skeleton's HTML. */
export const ssrModuleCode = (islands: string, skeletonHtml: string, flow: CompiledDataflow | null): Promise<string> =>
  transformSolid(ssrSource(islands, skeletonHtml, flow), { generate: 'ssr', hydratable: true });

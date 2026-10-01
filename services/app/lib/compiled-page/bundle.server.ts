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
import { escapeText } from '@artifactbin/utils/escape';
import { transformAsync, type PluginObj, type types as BabelTypes } from '@babel/core';
// @ts-expect-error babel-preset-solid ships no types; it is a Babel preset function.
import solidPreset from 'babel-preset-solid';
import * as solid from 'solid-js';
import * as solidWeb from 'solid-js/web';
import * as solidStore from 'solid-js/store';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as acorn from 'acorn';
import { readerDataflow, type CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import type { Scalar } from '@/lib/story/data';
import { islandFile, loadCompilerBuild } from './build.server';
import { DOCUMENT_MODULE_RE, type CompilerBuild, type IslandRenderData, type ModuleRef, type ModuleStore } from './contract';
import type { GeneratedSources } from './codegen-safety';
import { syncRailPreview } from './rail-preview.server';
import { preloadClosure } from './runtime-binding';
import { objectStore, ObjectUnavailable, type ObjectStore } from '@/lib/object-store';
import { createModuleStore } from './modules.server';
import { contentSha } from './speculation';
import { emitCarriers, literalsReadCode, MODULE_DATA_READ_CODE } from './carriers';

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

/**
 * A Babel plugin turning a module's imports and exports into an injected-import function body.
 * `sideEffects` keeps a bare `import "x"` as a `__mx_import("x")` call (the offline file's boot import).
 */
export function moduleToFunction(t: typeof BabelTypes, options: { sideEffects?: boolean } = {}): PluginObj {
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
              if (options.sideEffects && statement.specifiers.length === 0) hoisted.push(t.expressionStatement(namespace));
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
 *
 * Only top-level statements change, so this parses once (acorn, no traversal) and splices the text:
 * the same function `moduleToFunction` builds — imports hoisted as `const` lookups, exports collected
 * into the returned object — without a Babel pass over a document module that can run to megabytes.
 */
export async function evaluateModule(code: string, imports: SsrImports, filename: string): Promise<Record<string, unknown>> {
  const fn = vm.compileFunction(`'use strict';\n${moduleFunctionBody(code)}`, ['__mx_import'], { filename }) as (load: SsrImports) => Record<string, unknown>;
  return fn(imports);
}

type AcornNode = acorn.Node & Record<string, any>;
const nameOf = (node: AcornNode): string => (node.type === 'Identifier' ? node.name : String(node.value));
const parseModule = (code: string): AcornNode[] => (acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true }) as unknown as { body: AcornNode[] }).body;

/**
 * An SSR module's static chunks are its first line (`ssrModuleCode`): one `JSON.parse` of a JSON string
 * literal, which never holds a raw line break. Split off, megabytes of markup are never walked by acorn.
 */
const STATIC_HTML_LINE = 'const $mxH = JSON.parse("';
function splitStaticHtml(code: string): { line: string; rest: string } {
  if (!code.startsWith(STATIC_HTML_LINE)) return { line: '', rest: code };
  const end = code.indexOf('\n');
  if (end < 0 || !code.slice(0, end).endsWith('");')) throw new Error('evaluate: a malformed static-chunk line');
  return { line: code.slice(0, end), rest: code.slice(end + 1) };
}

/** A module's text as the body of a function of `__mx_import` that returns its exports (see `moduleToFunction`). */
export function moduleFunctionBody(source: string): string {
  const { line, rest: code } = splitStaticHtml(source);
  const hoisted: string[] = [];
  const body: string[] = line ? [line] : [];
  const exported: Array<[string, string]> = [];
  const text = (node: AcornNode) => code.slice(node.start, node.end);
  for (const statement of parseModule(code)) {
    if (statement.type === 'ImportDeclaration') {
      const namespace = `__mx_import(${JSON.stringify(statement.source.value)})`;
      for (const s of statement.specifiers as AcornNode[]) {
        const value = s.type === 'ImportNamespaceSpecifier' ? namespace
          : s.type === 'ImportDefaultSpecifier' ? `${namespace}.default`
          : `${namespace}[${JSON.stringify(nameOf(s.imported))}]`;
        hoisted.push(`const ${s.local.name} = ${value};`);
      }
    } else if (statement.type === 'ExportNamedDeclaration') {
      if (statement.source) throw new Error('evaluate: a re-export');
      const d = statement.declaration as AcornNode | null;
      if (d) {
        body.push(text(d));
        if (d.type === 'FunctionDeclaration' && d.id) exported.push([d.id.name, d.id.name]);
        else if (d.type === 'VariableDeclaration') for (const v of d.declarations as AcornNode[]) if (v.id.type === 'Identifier') exported.push([v.id.name, v.id.name]);
      }
      for (const s of statement.specifiers as AcornNode[]) exported.push([nameOf(s.local), nameOf(s.exported)]);
    } else if (statement.type === 'ExportDefaultDeclaration') {
      const d = statement.declaration as AcornNode;
      if (d.type === 'FunctionDeclaration' && d.id) { body.push(text(d)); exported.push([d.id.name, 'default']); } else {
        body.push(`const __mx_default = ${d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration' ? text(d) : `(${text(d)})`};`);
        exported.push(['__mx_default', 'default']);
      }
    } else if (statement.type === 'ExportAllDeclaration') {
      throw new Error('evaluate: a re-export');
    } else {
      body.push(text(statement));
    }
  }
  body.push(`return {${exported.map(([local, name]) => `${JSON.stringify(name)}: ${local}`).join(', ')}};`);
  return [...hoisted, ...body].join('\n');
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
type SsrHalf = NonNullable<CompilerBuild['ssr']>;
const islandSsrHalves = new Map<string, Promise<Record<string, unknown>>>();

/** The live build's server half (validated by loadCompilerBuild); none when the build is missing or has no half. */
function liveSsrHalf(): SsrHalf | undefined {
  try { return loadCompilerBuild().ssr; } catch { return undefined; }
}

async function islandSsrNamespace(specifier: string, retained?: SsrHalf): Promise<Record<string, unknown>> {
  const half = retained ?? liveSsrHalf();
  if (!half) throw new IslandSsrUnavailable(specifier, 'the island build has no server half');
  const name = half.exports[specifier];
  if (!name) throw new IslandSsrUnavailable(specifier, 'the server half does not export it');
  const file = islandFile(half.url.slice('/islands/'.length));
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

/** The server half's static kit families, by module (`@mx/kit/<mod>`): the compiler renders static kit subtrees with them. */
export type KitServer = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
const KIT_SERVER_MODS = ['basic', 'static'] as const;

/**
 * The live build's server kit — the half `defaultSsrImports` hands the SSR module, so a component rendered at
 * compile time is the one the module would have run. Undefined when the build has no server half.
 */
export async function loadKitServer(): Promise<KitServer | undefined> {
  try {
    const entries = await Promise.all(KIT_SERVER_MODS.map(async (mod) => [mod, await islandSsrNamespace(`@mx/kit/${mod}`)] as const));
    return Object.fromEntries(entries);
  } catch (error) {
    if (error instanceof IslandSsrUnavailable) return undefined;
    throw error;
  }
}

/** Every static import specifier of a module's text. */
async function importsOf(code: string): Promise<string[]> {
  const found = new Set<string>();
  for (const statement of parseModule(splitStaticHtml(code).rest)) if (statement.type === 'ImportDeclaration') found.add(String(statement.source.value));
  return [...found].sort();
}

/**
 * The default import table for a server module: this process's Solid, and the shared build's
 * server half for `@mx/*` (the live build's, or the retained `half` of an older build).
 */
export async function defaultSsrImports(code: string, half?: SsrHalf): Promise<SsrImports> {
  const islands: Record<string, Record<string, unknown>> = {};
  for (const spec of await importsOf(code)) {
    if (SOLID[spec]) continue;
    if (!spec.startsWith('@mx/')) throw new IslandSsrUnavailable(spec, 'not a shared-build specifier');
    islands[spec] = await islandSsrNamespace(spec, half);
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
      return ssrModuleOf(code, ref.sha, imports ?? await defaultSsrImports(code, half));
    })();
    loaded.catch(() => ssrModules.delete(key));
    ssrModules.set(key, loaded);
  }
  return loaded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * One version's modules
 * ──────────────────────────────────────────────────────────────────────────── */

/** The SSR module renders the authored document once, with one hydration context. */
function ssrSource(document: string, flow: CompiledDataflow | null): string {
  return `${document}import { renderToString as $renderToString } from 'solid-js/web';
const $flow = JSON.parse(${lit(JSON.stringify(flow ? readerDataflow(flow) : null))});
export function render(data) {
  const runtime = rt.createIslandRuntime({ dataflow: $flow ? { flow: $flow, values: data.values, ...(data.state ? { state: data.state } : {}), ...(data.results ? { results: data.results } : {}) } : null, assetsUrl: data.assetsUrl, mermaidImages: data.mermaidImages, viewer: null }, rt.createDataflowStore);
  try {
    return $renderToString(() => rt.withIsland(Document, runtime.context), { renderId: 'd-' });
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
const browserSource = (document: string, flow: CompiledDataflow | null, flowIndex?: number): string => flow
  ? `${document}import { boot as $boot } from '@mx/boot';\nexport const TREE = Document;\nconst FLOW = ${flowIndex === undefined ? `JSON.parse(${lit(JSON.stringify(readerDataflow(flow)))})` : `$moduleData[${flowIndex}]`};\n$boot({ TREE, FLOW });\n`
  : `${document}import { boot as $boot } from '@mx/boot';\nexport const TREE = Document;\n$boot({ TREE });\n`;

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
export async function buildDocumentModules(sources: GeneratedSources & { islandRefs: readonly unknown[]; browserIslands?: string; moduleData?: readonly string[]; staticTexts?: Readonly<Record<string, string>>; staticHtml?: readonly string[] }, options: BuildOptions): Promise<DocumentModules> {
  const moduleData = [...(sources.moduleData ?? [])];
  const flowJson = options.flow ? JSON.stringify(readerDataflow(options.flow)) : null;
  const flowIndex = flowJson && flowJson.length > 1024 ? moduleData.push(flowJson) - 1 : undefined;
  const browserIslands = sources.browserIslands ?? sources.islands;
  const browserWithData = flowIndex !== undefined && !sources.moduleData?.length
    ? `${MODULE_DATA_READ_CODE}${browserIslands}`
    : browserIslands;
  const ssrCode = await ssrModuleCode(sources.skeleton, options.flow, sources.staticTexts, sources.staticHtml);
  const loaded = await ssrModuleOf(ssrCode, contentSha(ssrCode), options.imports);
  const rendered = loaded.render({ values: options.values, results: null, mermaidImages: {}, drawings: {} });
  if (!sources.islandRefs.length && !options.boot) return { html: rendered.replace(/\sdata-hk="[^"]*"/g, ''), module: null, ssr: null, templateBrBytes: null };
  const store = options.store ?? createModuleStore();
  const browser = await browserModuleCode(browserWithData, options.build, options.flow, flowIndex);
  const html = rendered + emitCarriers({ literals: browser.literals, key: browser.literalKey }, moduleData.map((value) => JSON.parse(value) as unknown));
  if (!sources.islandRefs.length) return { html, module: await store.put(new TextEncoder().encode(browser.code), browser.imports, browser.specifiers), ssr: null, templateBrBytes: null };
  const ssrStore = options.ssrStore ?? createSsrModuleStore();
  const [module, ssr] = await Promise.all([
    store.put(new TextEncoder().encode(browser.code), browser.imports, browser.specifiers),
    ssrStore.put(new TextEncoder().encode(ssrCode), await importsOf(ssrCode)),
  ]);
  // The module just evaluated IS the stored one: a render of this version in this process (a draft's,
  // at once) need not evaluate it again.
  if (!options.imports && !ssrModules.has(`${ssr.sha}:current`)) ssrModules.set(`${ssr.sha}:current`, Promise.resolve(loaded));
  return { html, module, ssr, templateBrBytes: null };
}

/** The per-document browser module: DOM-compiled, imports bound to the shared chunks, compacted. `imports` is its static closure. */
export async function browserModuleCode(islands: string, build: CompilerBuild, flow: CompiledDataflow | null = null, flowIndex?: number): Promise<{ code: string; imports: string[]; specifiers: string[]; literals: string[]; literalKey: string }> {
  const direct = new Set<string>();
  // `moduleName: '@mx/rt'`: Solid's DOM helpers come from the runtime's one import surface, never
  // from the whole `solid-js/web` chunk.
  const compiled = await transformSolid(browserSource(islands, flow, flowIndex), { generate: 'dom', hydratable: true }, {
    minify: true, moduleName: '@mx/rt',
    rewrite: (specifier) => {
      const url = build.manifest[specifier];
      if (!url) throw new Error(`compile: the island build has no ${specifier}`);
      // The bytes keep the specifier: the URL is bound at serve time (runtime-binding.ts).
      direct.add(specifier);
      return specifier;
    },
  });
  const extracted = await externalizeLiterals(compiled);
  const specifiers = [...direct].sort();
  return { code: extracted.code, literals: extracted.literals, literalKey: extracted.key, specifiers, imports: preloadClosure(build, specifiers.map((s) => build.manifest[s]!)) };
}

/** Keep author literals in the page's inert JSON carrier, outside executable browser bytes. */
async function externalizeLiterals(source: string): Promise<{ code: string; literals: string[]; key: string }> {
  const literals: string[] = [];
  const indexes = new Map<string, number>();
  const out = await transformAsync(source, {
    filename: 'document.js', babelrc: false, configFile: false, sourceType: 'module', compact: true, comments: false,
    plugins: [({ types: t }: { types: typeof BabelTypes }): PluginObj => ({ visitor: { Program(p) {
      const indexOf = (value: string): number => {
        let index = indexes.get(value);
        if (index === undefined) { index = literals.push(value) - 1; indexes.set(value, index); }
        return index;
      };
      p.traverse({
        StringLiteral(value) {
          if (value.parentPath.isImportDeclaration() && value.key === 'source') return;
          if (value.parentPath.isObjectProperty() && value.key === 'key' && !value.parentPath.node.computed) return;
          if (value.parentPath.isMemberExpression() && value.key === 'property' && !value.parentPath.node.computed) return;
          value.replaceWith(t.memberExpression(t.identifier('$mxL'), t.numericLiteral(indexOf(value.node.value)), true));
          value.skip();
        },
        TemplateLiteral(value) {
          if (value.node.expressions.length !== 0) return;
          const text = value.node.quasis[0]?.value.cooked;
          if (text === undefined || text === null) return;
          value.replaceWith(t.memberExpression(t.identifier('$mxL'), t.numericLiteral(indexOf(text)), true));
          value.skip();
        },
      });
    } } })],
  });
  if (!out?.code) throw new Error('compile: document extraction produced nothing');
  const key = contentSha(JSON.stringify(literals));
  return { code: literals.length ? `${literalsReadCode(key)}${out.code}` : out.code, literals, key };
}

/**
 * The SSR transforms this process ran most recently, by the content hash of their source. The generated
 * source carries static chunks by index (compiler `staticHtml`), so successive drafts of one document —
 * an editor session typing in its static text — hand in the same source and skip Babel entirely. A hit
 * returns exactly what a transform of that source returns: the key is the whole source.
 */
const SSR_TRANSFORMS = 16;
const ssrTransforms = new Map<string, Promise<string>>();
const ssrTransformCounts = { hits: 0, misses: 0 };
/** The transform cache's hit and miss counts (tests). */
export const ssrTransformStats = (): Readonly<typeof ssrTransformCounts> => ({ ...ssrTransformCounts });

function ssrTransform(source: string): Promise<string> {
  const key = contentSha(source);
  let code = ssrTransforms.get(key);
  if (code) {
    ssrTransformCounts.hits++;
    ssrTransforms.delete(key);
  } else {
    ssrTransformCounts.misses++;
    code = transformSolid(source, { generate: 'ssr', hydratable: true });
    code.catch(() => ssrTransforms.delete(key));
    if (ssrTransforms.size >= SSR_TRANSFORMS) ssrTransforms.delete(ssrTransforms.keys().next().value!);
  }
  ssrTransforms.set(key, code);
  return code;
}

/**
 * The per-document SSR module renders the same generated tree as the browser. Its static chunks
 * (`$mxH[i]`) are one `JSON.parse(<lit>)` constant, added after the transform and the static-text
 * restore, so neither Babel nor a marker ever reads them.
 */
export const ssrModuleCode = async (document: string, flow: CompiledDataflow | null, staticTexts: Readonly<Record<string, string>> = {}, staticHtml: readonly string[] = []): Promise<string> => {
  const code = restoreStaticText(await ssrTransform(ssrSource(document, flow)), staticTexts, true);
  return staticHtml.length ? `const $mxH = JSON.parse(${lit(JSON.stringify(staticHtml))});\n${code}` : code;
};

const jsStringText = (value: string): string => value
  .replace(/\\/g, '\\\\')
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/"/g, '\\"')
  .replace(/'/g, "\\'")
  .replace(/`/g, '\\`')
  .replace(/\$\{/g, '\\${')
  .replace(/[\u0000-\u001f\u007f]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
function restoreStaticText(value: string, texts: Readonly<Record<string, string>>, code = false): string {
  if (!Object.keys(texts).length) return value;
  return value.replace(/MXSTATIC(?:TEXT)?[0-9a-f]{16}\d+END/g, (marker) => {
    const raw = texts[marker];
    if (raw === undefined) return marker;
    const html = marker.startsWith('MXSTATICTEXT') ? raw : escapeText(raw);
    return code ? jsStringText(html) : html;
  });
}

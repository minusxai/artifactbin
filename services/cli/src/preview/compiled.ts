/**
 * THE PUBLISH-TIME COMPILER, LOCALLY: the same `compilePage` production stores per version, run fresh
 * on every read against a file instead of a database row. No object store beyond the process's own
 * local disk cache (`OBJECT_STORE__LOCAL_DIR`, lib/object-store falls back to it with no `S3_URL`), no
 * snapshot store, no DB write-back — every one of those is `prepared-page.server.ts compiledFor`'s DB
 * half, which a file has no row for.
 *
 * `assembleReaderPage` (lib/compiled-page/assembler) is the SAME pure function `/a/:id`, `/raw`, the
 * export capture and the offline file all render through: no I/O, no database, no clock. This module's
 * whole job is building its input from a local file instead of an artifact row.
 */
import {compilePage} from '../../../app/lib/compiled-page/compiler';
import {loadCompilerBuild} from '../../../app/lib/compiled-page/build.server';
import {assembleReaderPage} from '../../../app/lib/compiled-page/assembler';
import {createModuleStore, createSpeculationRulesStore} from '../../../app/lib/compiled-page/modules.server';
import {loadSsrModule} from '../../../app/lib/compiled-page/bundle.server';
import {bindModuleCode} from '../../../app/lib/compiled-page/runtime-binding';
import {ISLANDS_PATH,SPECULATION_RULES_HEADER, type CompileInput, type CompiledPage, type CompilerBuild} from '../../../app/lib/compiled-page/contract';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared/prepared-runtime';
import {DOCUMENT_UI_FONT_CSS} from '../../../app/lib/serving/app-fonts';
import {documentStyleSheets} from '../../../app/lib/compiled-page/styles';
import type {StoryIslandData, ServedResults} from '../../../app/lib/story-runtime/contract';
import type {Scalar} from '../../../contracts/src/index';

export {ISLANDS_PATH};

/** `/islands/d/<sha>.js` — the only per-document module path this process ever serves; everything else under `/islands/` is a static shared chunk. */
export const documentModuleSha = (pathname: string): string | null => {
 const match = /^\/islands\/d\/([0-9a-f]{16})\.js$/.exec(pathname);
 return match ? match[1]! : null;
};

/**
 * The per-document module's bytes, from the same local store `compilePage` wrote them to, bound to the
 * local island build's chunk URLs (the stored bytes name the runtime by specifier: runtime-binding).
 */
export async function readDocumentModule(sha: string): Promise<Uint8Array | null> {
 const bytes=await createModuleStore().get(sha);
 return bytes ? new TextEncoder().encode(bindModuleCode(new TextDecoder().decode(bytes),compilerBuild())) : null;
}

/** `/islands/s/<sha>.json` — the prerender rule file `assembleDocument`'s `Speculation-Rules` header names. */
export const speculationRulesSha = (pathname: string): string | null => {
 const match = /^\/islands\/s\/([0-9a-f]{16})\.json$/.exec(pathname);
 return match ? match[1]! : null;
};

/** The rule file's bytes, from the same local store `compileDocument` wrote them to. */
export async function readSpeculationRules(sha: string): Promise<Uint8Array | null> {
 return createSpeculationRulesStore().get(sha);
}

let buildCache: CompilerBuild | undefined;
/** Thrown once, with a message that names the fix, rather than a bare ENOENT from deep in build.server. */
export function compilerBuild(): CompilerBuild {
 if (buildCache) return buildCache;
 try {
  buildCache = loadCompilerBuild();
 } catch (error) {
  throw new Error(`Local preview needs the island build (npm run build:islands): ${error instanceof Error ? error.message : String(error)}`);
 }
 return buildCache;
}

export interface CompileDocumentInput {
 /** The same merged `data` `read()` already computes for `/document`: authoritative nodes, colorMode, refData. */
 data: Pick<StoryIslandData, 'nodes' | 'colorMode' | 'template' | 'chrome' | 'glyphs' | 'refData'>;
 flow: CompileInput['flow'];
 authorScript: string | null;
 capture: boolean;
}

/** One document's compile, pure given its prepared inputs — cache by revision beside `session.ts`'s other per-file caches. */
export async function compileDocument(input: CompileDocumentInput): Promise<CompiledPage> {
 const build = compilerBuild();
 const compiled = await compilePage({
  nodes: input.data.nodes,
  colorMode: input.data.colorMode,
  template: input.data.template ?? null,
  chrome: !input.capture,
  ...(input.data.glyphs ? {glyphs: input.data.glyphs} : {}),
  refData: input.data.refData,
  flow: input.flow,
  build: build.id,
  authorScript: input.authorScript,
 }, build);
 if (compiled.unported.length) throw new Error(`This document uses a component local preview cannot render yet: ${compiled.unported.join(', ')}.`);
 // The assembler names a prerender rule file by its sha in the `Speculation-Rules` header
 // (assembleDocument, below); a real browser fetches that URL, so the file must already be
 // on disk under the same local store `readSpeculationRules` reads back from.
 await createSpeculationRulesStore().put(compiled.links);
 return compiled;
}

/**
 * A capture pre-runs its own values through the SSR module, exactly as `/raw`'s export path does
 * (bake the rows in, so there is nothing for a headless page to wait on after paint). Anything else
 * (no SSR module — no islands at all — or nothing to bake) keeps the compiler's declared-state skeleton;
 * a browser reader then settles it itself over the query door.
 */
export async function renderStoryHtml(compiled: CompiledPage, input: {values: Record<string, Scalar>; results: ServedResults | null}): Promise<string> {
 if (!compiled.ssr || (!Object.keys(input.values).length && !input.results)) return compiled.html;
 const module = await loadSsrModule(compiled.ssr);
 return module.render({values: input.values, results: input.results, mermaidImages: {}, drawings: {}});
}

export interface AssembleDocumentInput {
 compiled: CompiledPage;
 prepared: PreparedStoryRuntime;
 colorMode: 'light' | 'dark';
 file: string;
 capture: boolean;
 /** Pre-rendered story HTML (`renderStoryHtml`'s), for a capture with baked rows. Defaults to the declared skeleton. */
 story?: string;
 values?: Record<string, Scalar>;
}

/**
 * Local previews do not inherit the HTTP reader's CDN, remote media or Helmet allowances.
 * The compiled reader and editor load from this session; author modules and engine workers
 * need blob URLs, SQLite needs WebAssembly, and document CSS is intentionally inline.
 * This controls browser resource requests, not a general sandbox for authored HTML/code.
 */
function localPreviewCsp():string {
 return [
  "default-src 'none'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "connect-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "frame-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
 ].join('; ');
}

/**
 * The compiled document, wrapped as a full page the way `/a/:id/raw` serves one: our own doors, no reader
 * chrome, no SPA — this IS the page. Its stylesheets are the standalone document's, byte for byte
 * (lib/compiled-page/styles/document-styles): they name the design on the document element, where a design
 * system's `:root:where([data-theme])` rules look, and carry its fonts, its faces and classes and the
 * author's own CSS. The reader app's single isolated sheet (`css`) would draw a local file in the
 * neutral contract instead, so an export of a tracked file looked nothing like the published page.
 */
export function assembleDocument(input: AssembleDocumentInput): {html: string; headers: Readonly<Record<string, string>>} {
 const build = compilerBuild();
 const file = encodeURIComponent(input.file);
 const assembled=assembleReaderPage({
  compiled: input.compiled,
  documentChrome: !input.capture,
  navigationTarget: null,
  story: input.story ?? input.compiled.html,
  outline: input.compiled.outline,
  capture: input.capture,
  css: '',
  sheets: [...documentStyleSheets({
   compiledCss: input.prepared.compiledCss, chrome: !input.capture, bare: false, theme: input.prepared.theme,
   docFonts: input.prepared.base.fonts, systemCss: input.prepared.base.systemCss ?? '', authorCss: input.prepared.authorCss,
  }), ...(input.capture ? [] : [{ attr: 'data-afbin-ui-fonts', css: DOCUMENT_UI_FONT_CSS }])],
  fontPreloads: input.prepared.fontPreloads ?? [],
  title: input.prepared.title,
  theme: input.prepared.theme,
  colorMode: input.colorMode,
  snapshot: null,
  overlay: {
   values: input.values ?? {},
   mermaidImages: {},
   signedIn: false,
   // Capture keeps its query door too: session.ts's POST /query stays open in capture mode
   // (read-only otherwise), for a document whose rows a baked SSR render did not settle.
   doors: {queryUrl: `/query?file=${file}`, assetsUrl: `/image?file=${file}`},
  },
  build,
  head: null,
 });
 // Local links may redirect to published pages. Do not let hover/intent prerender them
 // implicitly; clicking a link remains an explicit navigation by the reader.
 const headers:Record<string,string>={...assembled.headers,'Content-Security-Policy':localPreviewCsp(),'X-DNS-Prefetch-Control':'off'};
 delete headers[SPECULATION_RULES_HEADER];
 return {...assembled,headers};
}

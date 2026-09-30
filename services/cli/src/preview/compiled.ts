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
import {ISLANDS_PATH, type CompileInput, type CompiledPage, type CompilerBuild} from '../../../app/lib/compiled-page/contract';
import type {PreparedStoryRuntime} from '../../../app/lib/story/prepared-runtime';
import type {StoryIslandData, ServedResults} from '../../../app/lib/story-runtime/contract';
import type {Scalar} from '../../../contracts/src/index';

export {ISLANDS_PATH};

/** `/islands/d/<sha>.js` — the only per-document module path this process ever serves; everything else under `/islands/` is a static shared chunk. */
export const documentModuleSha = (pathname: string): string | null => {
 const match = /^\/islands\/d\/([0-9a-f]{16})\.js$/.exec(pathname);
 return match ? match[1]! : null;
};

/** The per-document module's bytes, from the same local store `compilePage` wrote them to. */
export async function readDocumentModule(sha: string): Promise<Uint8Array | null> {
 return createModuleStore().get(sha);
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

/** The compiled document, wrapped as a full page: our own doors, no reader chrome, no SPA — this IS the page. */
export function assembleDocument(input: AssembleDocumentInput): {html: string; headers: Readonly<Record<string, string>>} {
 const build = compilerBuild();
 const file = encodeURIComponent(input.file);
 return assembleReaderPage({
  compiled: input.compiled,
  documentChrome: !input.capture,
  story: input.story ?? input.compiled.html,
  outline: input.compiled.outline,
  capture: input.capture,
  css: input.prepared.compiledCss ?? '',
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
  chrome: null,
  spa: null,
  build,
  head: null,
 });
}

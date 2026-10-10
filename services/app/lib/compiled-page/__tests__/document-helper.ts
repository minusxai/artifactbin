/** Exercise the compiled reader's real preparation, compiler and assembler in focused tests. */
import { assembleReaderPage } from '../assembler';
import { loadCompilerBuild } from '../build.server';
import { compilePage } from '../compiler';
import { loadSsrModule } from '../bundle.server';
import type { AssembleHead, AssembleOverlay } from '../contract';
import { prepareStoryParts, type PrepareStoryInput } from '@/lib/publish/prepared/prepare-runtime.server';
import { documentStyleSheets } from '@/lib/compiled-page/styles/document-styles';

export interface DocumentCase extends PrepareStoryInput {
  head?: AssembleHead | null;
  overlay?: AssembleOverlay;
  footer?: { html: string; css: string } | null;
}

export async function compiledDocument(input: DocumentCase): Promise<string> {
  const parts = await prepareStoryParts(input);
  const build = loadCompilerBuild();
  const colorMode = parts.mode;
  const compiled = await compilePage({
    nodes: parts.runtime.data.nodes, colorMode, template: input.template ?? null,
    chrome: input.chrome ?? true, glyphs: parts.runtime.data.glyphs,
    refData: input.refData, flow: input.dataflow?.flow ?? null,
    authorScript: parts.runtime.authorScript, build: build.id,
  }, build);
  const overlay = input.overlay ?? { values: {}, mermaidImages: {}, signedIn: false, doors: null };
  const state = input.dataflow?.state;
  const results = state ? { tables: state.tables, errors: state.errors } : null;
  const story = compiled.ssr && (Object.keys(overlay.values).length || results)
    ? (await loadSsrModule(compiled.ssr)).render({ values: { ...state?.values, ...overlay.values }, results, mermaidImages: overlay.mermaidImages, drawings: {} })
    : compiled.html;
  return assembleReaderPage({
    compiled, story, capture: input.chrome === false, css: '', fontPreloads: parts.runtime.fontPreloads ?? [],
    title: parts.runtime.title, theme: input.theme, colorMode, snapshot: null,
    overlay,
    build, head: input.head ?? null, footer: input.footer ?? null,
    sheets: documentStyleSheets({
      compiledCss: input.compiledCss, chrome: input.chrome ?? true, bare: !!input.footer,
      theme: input.theme, docFonts: parts.docFonts, systemCss: parts.baseRecipe.systemCss ?? '',
      authorCss: parts.runtime.authorCss,
    }),
  }).html;
}

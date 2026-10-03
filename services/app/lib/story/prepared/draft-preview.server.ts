/** Compile an unsaved editor draft through the reader's Solid compiler. */
import { assembleReaderPage } from '@/lib/compiled-page/assembler';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { loadSsrModule } from '@/lib/compiled-page/bundle.server';
import { compilePage } from '@/lib/compiled-page/compiler';
import { inlineStoryCss } from '@/lib/story/styles/inline-css';
import { prepareStoryParts, type PrepareStoryInput } from '@/lib/story/prepared/prepare-runtime.server';

/** The caller admits the editor and supplies its current source and data. Nothing here is persisted. */
export async function renderDraftPreview(input: PrepareStoryInput): Promise<string> {
  const parts = await prepareStoryParts(input);
  if (!parts.split) throw new Error('draft source is incomplete');
  const build = loadCompilerBuild();
  const compiled = await compilePage({
    nodes: parts.runtime.data.nodes,
    colorMode: parts.mode,
    template: input.template ?? null,
    chrome: input.chrome ?? true,
    glyphs: parts.runtime.data.glyphs,
    refData: input.refData,
    flow: input.dataflow?.flow ?? null,
    authorScript: parts.runtime.authorScript,
    build: build.id,
  }, build);
  const state = input.dataflow?.state;
  const results = state ? { tables: state.tables, errors: state.errors } : null;
  const story = compiled.ssr && state
    ? (await loadSsrModule(compiled.ssr))
      .render({ values: state.values, state, results, mermaidImages: {}, drawings: {} })
    : compiled.html;
  return assembleReaderPage({
    compiled,
    story,
    css: inlineStoryCss(parts.runtime),
    fontPreloads: parts.runtime.fontPreloads ?? [],
    title: parts.runtime.title,
    theme: input.theme,
    colorMode: parts.mode,
    snapshot: null,
    overlay: { values: state?.values ?? {}, mermaidImages: {}, signedIn: false, doors: null },
    build,
    head: null,
  }).html;
}

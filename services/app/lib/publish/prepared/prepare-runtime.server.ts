import { readerDataflow } from '@/lib/dataflow/compiled-dataflow';
import type { PreparedStoryRuntime } from './prepared-runtime';
import { storyBodyFor } from '../../document/body';
import { assetLookupFrom } from '../../document/asset-url';
import { EMPTY_HELMET_CONTENT, type HelmetContent } from '../../document/helmet';
import { authorModuleNames, buildAuthorModule } from '@/lib/author-script/author-module.server';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import { glyphsForNodes } from '@/lib/story-ui/icon-glyphs.server';
import { documentFonts } from '@/lib/compiled-page/styles/document-fonts';
import { storyBaseCss, type StoryBaseCssRecipe } from '@/lib/compiled-page/styles/story-base-css';
import { storySystemSheetCss } from '@/lib/data/story/story-system-sheets';
import { firstScreenFonts } from '@/lib/compiled-page/styles/first-screen-fonts';
import type { StoryIslandData, StoryIslandDataflow, StoryViewer } from '@/lib/story-runtime/contract';
import { mermaidImagesFor, type MermaidImageLookup } from '@/lib/mermaid-images/store';
import type { WebAssetBox } from '../../document/asset-url';
import type { RefDataMap } from '@/lib/dataflow/ref-data';
import type { StoryDesignName } from '@/lib/validation/atlas-schemas';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';

/** Inputs still used by the app's editor preparation and the offline file. */
export interface PrepareStoryInput {
  source: string;
  compiledCss: string | null;
  theme: StoryDesignName | null;
  template?: string | null;
  colorMode: 'light' | 'dark' | null;
  title: string | null;
  refData: RefDataMap;
  assetUrls?: ReadonlySet<string> | ReadonlyMap<string, WebAssetBox>;
  dataflow?: StoryIslandDataflow | null;
  viewer?: StoryViewer | null;
  queryUrl?: string | null;
  mutateUrl?: string | null;
  mentionStatuses?: StoryIslandData['mentionStatuses'];
  assetsUrl?: string | null;
  readOnly?: string | null;
  mermaidImages?: StoryIslandData['mermaidImages'];
  mermaidImageLookup?: MermaidImageLookup | null;
  chrome?: boolean;
}

/** Shared preparation for inline app rendering and standalone raw/export rendering. */
export async function prepareStoryRuntime(input: PrepareStoryInput): Promise<PreparedStoryRuntime> {
  return (await prepareStoryParts(input)).runtime;
}

/** The island's reader half: what a request, not the document, decides. */
export type ReaderIslandInput = Pick<PrepareStoryInput, 'refData' | 'dataflow' | 'viewer' | 'queryUrl' | 'mutateUrl' | 'mentionStatuses' | 'assetsUrl' | 'readOnly' | 'mermaidImages'>;

/**
 * The island fields a REQUEST decides (who reads, their `$` values and what
 * they may hold, the other artifacts the document embeds) — never the
 * document's own parse. One writer, so the served page's per-viewer overlay
 * (lib/publish/prepared/prepared-page.server) is exactly what the whole preparation writes.
 */
export function readerIslandData(input: ReaderIslandInput): Omit<StoryIslandData, 'nodes' | 'colorMode' | 'template' | 'chrome' | 'glyphs'> {
  const sqliteWasm = input.dataflow?.hold ? loadCompilerBuild().sqliteWasm : undefined;
  return {
    refData: input.refData,
    ...(input.dataflow ? { dataflow: { ...input.dataflow, flow: readerDataflow(input.dataflow.flow) } } : {}),
    // The remaining inline app reader runs held queries with the same wasm the compiled islands use.
    ...(sqliteWasm ? { sqliteWasm } : {}),
    // WHO IS READING — carried even when the document declares nothing, because
    // `{$_me ? … : <SignIn/>}` is exactly such a document.
    ...(input.viewer ? { viewer: input.viewer } : {}),
    ...(input.queryUrl ? { queryUrl: input.queryUrl } : {}),
    ...(input.mutateUrl ? { mutateUrl: input.mutateUrl } : {}),
    ...(input.mentionStatuses?{mentionStatuses:input.mentionStatuses}:{}),
    ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}),
    // A SNAPSHOT render refuses every write by name (StoryIslandData.readOnly).
    ...(input.readOnly ? { readOnly: input.readOnly } : {}),
    // The version's prerendered diagrams (lib/mermaid-images). A REQUEST's, not the version's: a
    // harvest lands after the page was prepared, and `?mermaid=engine` asks for none.
    ...(input.mermaidImages && Object.keys(input.mermaidImages).length ? { mermaidImages: input.mermaidImages } : {}),
  };
}

/** One parse, glyph resolution and font lookup shared by raw/export and SPA. */
/** The Helmet script as the module the page runs (lib/author-script/author-module.server); a draft whose script does not build carries none. */
async function authorModuleCode(helmet: HelmetContent): Promise<string | null> {
  if (!helmet.script) return null;
  const built = await buildAuthorModule(helmet.script, authorModuleNames(helmet));
  if (!built.ok) { console.warn('[prepare] the author script does not build:', built.errors.join('; ')); return null; }
  return built.module.code;
}

export async function prepareStoryParts(input: PrepareStoryInput) {
  const chrome = input.chrome ?? true;
  const split = storyBodyFor(input.source, input.assetUrls ? assetLookupFrom(input.assetUrls) : undefined, { capture: !chrome });
  const helmet = split?.content ?? EMPTY_HELMET_CONTENT;
  const mode = resolveStoryMode(input.theme, input.colorMode);
  const title = helmet.title?.trim() || input.title || 'artifact';
  const glyphs = split ? glyphsForNodes(split.body) : {};
  // The version's prerendered diagrams, when the route asked for them (never an offline file or a draft).
  const mermaidImages = input.mermaidImages ?? (split && input.mermaidImageLookup ? await mermaidImagesFor(input.mermaidImageLookup, split.body) : undefined);
  const docFonts = documentFonts(helmet);
  const data: StoryIslandData = {
    nodes: split?.body ?? [], colorMode: mode, template: input.template ?? null, chrome,
    ...(Object.keys(glyphs).length ? { glyphs } : {}),
    ...readerIslandData({ ...input, mermaidImages }),
  };
  const systemCss = storySystemSheetCss(input.theme);
  const baseRecipe: StoryBaseCssRecipe = { chrome, theme: input.theme ?? null, fonts: docFonts, ...(systemCss ? { systemCss } : {}) };
  const baseCss = storyBaseCss(baseRecipe);
  const runtime: PreparedStoryRuntime = {
    data, baseCss, compiledCss: input.compiledCss, authorCss: helmet.style,
    authorScript: await authorModuleCode(helmet),
    theme: input.theme, base: baseRecipe, title,
    // The faces this document's first screen paints (lib/compiled-page/styles/first-screen-fonts), one per file.
    fontPreloads: firstScreenFonts({ theme: input.theme, nodes: split?.body ?? [], docFonts }).map(face => face.url),
  };
  return { runtime, split, helmet, mode, title, glyphs, docFonts, baseRecipe };
}

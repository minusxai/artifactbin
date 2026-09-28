import type { PreparedStoryRuntime } from './prepared-runtime';
import { storyBodyFor } from './body';
import { assetLookupFrom } from './asset-url';
import { EMPTY_HELMET_CONTENT } from './helmet';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import { loadStorySsr } from './ssr.server';
import { documentFonts } from './document-fonts';
import { storyBaseCss, type StoryBaseCssRecipe } from './story-base-css';
import { webFontAssets } from '@/lib/webfonts';
import { firstScreenFonts } from './first-screen-fonts';
import type { StoryIslandData, StoryIslandDataflow, StoryViewer } from '@/lib/story-runtime/contract';
import { mermaidImagesFor, type MermaidImageLookup } from '@/lib/mermaid-images/store';
import type { WebAssetBox } from './asset-url';
import type { RefDataMap } from './ref-data';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

/** Inputs still used by the app's editor preparation and the offline file. */
export interface PrepareStoryInput {
  source: string;
  compiledCss: string | null;
  theme: StoryThemeName | null;
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
  managedAssets?: StoryIslandData['managedAssets'];
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
export type ReaderIslandInput = Pick<PrepareStoryInput, 'refData' | 'dataflow' | 'viewer' | 'queryUrl' | 'mutateUrl' | 'mentionStatuses' | 'assetsUrl' | 'managedAssets' | 'readOnly' | 'mermaidImages'>;

/**
 * The island fields a REQUEST decides (who reads, their `$` values and what
 * they may hold, the other artifacts the document embeds) — never the
 * document's own parse. One writer, so the served page's per-viewer overlay
 * (lib/story/prepared-page.server) is exactly what the whole preparation writes.
 */
export function readerIslandData(input: ReaderIslandInput): Omit<StoryIslandData, 'nodes' | 'colorMode' | 'template' | 'chrome' | 'glyphs'> {
  return {
    refData: input.refData,
    ...(input.dataflow ? { dataflow: input.dataflow } : {}),
    // WHO IS READING — carried even when the document declares nothing, because
    // `{$_me ? … : <SignIn/>}` is exactly such a document.
    ...(input.viewer ? { viewer: input.viewer } : {}),
    ...(input.queryUrl ? { queryUrl: input.queryUrl } : {}),
    ...(input.mutateUrl ? { mutateUrl: input.mutateUrl } : {}),
    ...(input.mentionStatuses?{mentionStatuses:input.mentionStatuses}:{}),
    ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}),
    ...(input.managedAssets ? { managedAssets: input.managedAssets } : {}),
    // A SNAPSHOT render refuses every write by name (StoryIslandData.readOnly).
    ...(input.readOnly ? { readOnly: input.readOnly } : {}),
    // The version's prerendered diagrams (lib/mermaid-images). A REQUEST's, not the version's: a
    // harvest lands after the page was prepared, and `?mermaid=engine` asks for none.
    ...(input.mermaidImages && Object.keys(input.mermaidImages).length ? { mermaidImages: input.mermaidImages } : {}),
  };
}

/** One parse, glyph resolution and font lookup shared by raw/export and SPA. */
export async function prepareStoryParts(input: PrepareStoryInput) {
  const chrome = input.chrome ?? true;
  const split = storyBodyFor(input.source, input.assetUrls ? assetLookupFrom(input.assetUrls) : undefined, { capture: !chrome });
  const helmet = split?.content ?? EMPTY_HELMET_CONTENT;
  const mode = resolveStoryMode(input.theme, input.colorMode);
  const title = helmet.title?.trim() || input.title || 'artifact';
  const glyphs = split ? loadStorySsr().glyphsForNodes(split.body) : {};
  // The version's prerendered diagrams, when the route asked for them (never an offline file or a draft).
  const mermaidImages = input.mermaidImages ?? (split && input.mermaidImageLookup ? await mermaidImagesFor(input.mermaidImageLookup, split.body) : undefined);
  const docFonts = documentFonts(helmet);
  const importedFaces = docFonts.families.length ? await webFontAssets(docFonts.families) : [];
  const data: StoryIslandData = {
    nodes: split?.body ?? [], colorMode: mode, template: input.template ?? null, chrome,
    ...(Object.keys(glyphs).length ? { glyphs } : {}),
    ...readerIslandData({ ...input, mermaidImages }),
  };
  const baseRecipe: StoryBaseCssRecipe = { chrome, theme: input.theme ?? null, faces: importedFaces, fonts: docFonts };
  const baseCss = storyBaseCss(baseRecipe);
  const runtime: PreparedStoryRuntime = {
    data, baseCss, compiledCss: input.compiledCss, authorCss: helmet.style,
    authorScript: helmet.script && !/<\/script/i.test(helmet.script) ? helmet.script : null,
    theme: input.theme, title,
    // The faces this document's first screen paints (lib/story/first-screen-fonts), one per file.
    fontPreloads: firstScreenFonts({ theme: input.theme, nodes: split?.body ?? [], docFonts, importedFaces }).map(face => face.url),
  };
  return { runtime, split, helmet, mode, title, glyphs, docFonts, importedFaces, baseRecipe };
}

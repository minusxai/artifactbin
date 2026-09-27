import type { StoryDocumentInput } from './document';
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
import type { StoryIslandData } from '@/lib/story-runtime/contract';
import { storyRuntimeAssets } from './runtime-asset';
import { mermaidImagesFor } from '@/lib/mermaid-images/store';

/** Shared preparation for inline app rendering and standalone raw/export rendering. */
export async function prepareStoryRuntime(input: StoryDocumentInput): Promise<PreparedStoryRuntime> {
  return (await prepareStoryParts(input)).runtime;
}

/** The island's reader half: what a request, not the document, decides. */
export type ReaderIslandInput = Pick<StoryDocumentInput, 'refData' | 'dataflow' | 'viewer' | 'queryUrl' | 'mutateUrl' | 'mentionStatuses' | 'assetsUrl' | 'managedAssets' | 'readOnly'>;

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
    // A reader who may hold data runs queries in their page, on this wasm.
    ...(input.dataflow?.hold && storyRuntimeAssets().sqlite ? { sqliteWasm: storyRuntimeAssets().sqlite! } : {}),
    ...(input.mutateUrl ? { mutateUrl: input.mutateUrl } : {}),
    ...(input.mentionStatuses?{mentionStatuses:input.mentionStatuses}:{}),
    ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}),
    ...(input.managedAssets ? { managedAssets: input.managedAssets } : {}),
    // A SNAPSHOT render refuses every write by name (StoryIslandData.readOnly).
    ...(input.readOnly ? { readOnly: input.readOnly } : {}),
  };
}

/** One parse, glyph resolution and font lookup shared by raw/export and SPA. */
export async function prepareStoryParts(input: StoryDocumentInput) {
  const chrome = input.chrome ?? true;
  const split = storyBodyFor(input.source, input.assetUrls ? assetLookupFrom(input.assetUrls) : undefined, { capture: !chrome });
  const helmet = split?.content ?? EMPTY_HELMET_CONTENT;
  const mode = resolveStoryMode(input.theme, input.colorMode);
  const title = helmet.title?.trim() || input.title || 'artifact';
  const glyphs = split ? loadStorySsr().glyphsForNodes(split.body) : {};
  // The version's prerendered diagrams, when the route asked for them (never an offline file or a draft).
  const mermaidImages = split && input.mermaidImages ? await mermaidImagesFor(input.mermaidImages, split.body) : {};
  const docFonts = documentFonts(helmet);
  const importedFaces = docFonts.families.length ? await webFontAssets(docFonts.families) : [];
  const data: StoryIslandData = {
    nodes: split?.body ?? [], colorMode: mode, template: input.template ?? null, chrome,
    ...(Object.keys(glyphs).length ? { glyphs } : {}),
    ...(Object.keys(mermaidImages).length ? { mermaidImages } : {}),
    ...readerIslandData(input),
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

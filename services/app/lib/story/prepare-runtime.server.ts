import type { StoryDocumentInput } from './document';
import type { PreparedStoryRuntime } from './prepared-runtime';
import { storyBodyFor } from './body';
import { assetLookupFrom } from './asset-url';
import { EMPTY_HELMET_CONTENT } from './helmet';
import { resolveStoryMode } from '@/lib/data/story/story-themes';
import { loadStorySsr } from './ssr.server';
import { documentFonts, documentFontCss } from './document-fonts';
import { webFontAssets } from '@/lib/webfonts';
import { getStoryFontCss, storyFontFaceCss } from '@/lib/data/story/story-fonts';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_CHROME_CSS, STORY_COLUMN_CSS, STORY_EMBED_CSS, STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';
import type { StoryIslandData } from '@/lib/story-runtime/contract';

/** Shared preparation for inline app rendering and standalone raw/export rendering. */
export async function prepareStoryRuntime(input: StoryDocumentInput): Promise<PreparedStoryRuntime> {
  return (await prepareStoryParts(input)).runtime;
}

/** One parse, glyph resolution and font lookup shared by raw/export and SPA. */
export async function prepareStoryParts(input: StoryDocumentInput) {
  const chrome = input.chrome ?? true;
  const split = storyBodyFor(input.source, input.assetUrls ? assetLookupFrom(input.assetUrls) : undefined, { capture: !chrome });
  const helmet = split?.content ?? EMPTY_HELMET_CONTENT;
  const mode = resolveStoryMode(input.theme, input.colorMode);
  const title = helmet.title?.trim() || input.title || 'artifact';
  const glyphs = split ? loadStorySsr().glyphsForNodes(split.body) : {};
  const docFonts = documentFonts(helmet);
  const importedFaces = docFonts.families.length ? await webFontAssets(docFonts.families) : [];
  const data: StoryIslandData = {
    nodes: split?.body ?? [], refData: input.refData, colorMode: mode, template: input.template ?? null, chrome,
    ...(Object.keys(glyphs).length ? { glyphs } : {}),
    ...(input.dataflow ? { dataflow: input.dataflow } : {}),
    ...(input.queryUrl ? { queryUrl: input.queryUrl } : {}),
    ...(input.mutateUrl ? { mutateUrl: input.mutateUrl } : {}),
    ...(input.assetsUrl ? { assetsUrl: input.assetsUrl } : {}),
    ...(input.managedAssets ? { managedAssets: input.managedAssets } : {}),
  };
  const baseCss = [
    ':root { --mx-vh: 100vh; } body { margin: 0; }', STORY_BARE_TYPOGRAPHY_CSS,
    chrome ? STORY_CHROME_CSS : '', STORY_EMBED_CSS, STORY_TABLE_CSS, STORY_COLUMN_CSS,
    getStoryFontCss(input.theme ?? undefined), storyFontFaceCss(importedFaces), documentFontCss(docFonts),
  ].join('\n');
  const runtime: PreparedStoryRuntime = {
    data, baseCss, compiledCss: input.compiledCss, authorCss: helmet.style,
    authorScript: helmet.script && !/<\/script/i.test(helmet.script) ? helmet.script : null,
    theme: input.theme, title,
  };
  return { runtime, split, helmet, mode, title, glyphs, docFonts, importedFaces };
}

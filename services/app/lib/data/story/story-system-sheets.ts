/**
 * The design systems' SHEETS: per system, the `@font-face` rules for every family, weight and style
 * its type roles use (from pinned, packaged font assets) and the class css — type roles, components, the hand
 * and the page-type kit, scoped to the document root's `data-theme`. Generated with the registry
 * (./story-systems, `npm run generate:design-systems`) and kept apart from it on purpose: this is
 * half a megabyte the server reads per document (lib/story/prepared/prepare-runtime.server fills the
 * base-sheet recipe with the TEXT) and the CLI reads for a local render, and the browser never
 * carries. Nothing a browser bundle reaches may import this module.
 */
import sheets from './story-system-sheets.json';
import fontManifest from './story-font-manifest.json';
import { STORY_SYSTEM_NAMES, type StorySystemName } from '@/lib/validation/story-system-names';

interface StorySystemSheet {
  /** `@font-face` rules for every family, weight and style the type roles use, served from /fonts. */
  fontFaces: string;
  /** Type roles, components, the hand and the page-type kit, scoped to the document root's `data-theme`. */
  css: string;
}

interface SystemFontFace {
  family: string; style: string; weight: string; url: string; unicodeRange: string; stretch?: string;
}
const packagedFaces: Readonly<Record<string, readonly SystemFontFace[]>> = fontManifest.systems;

/** The generated design recipe names families; the asset manifest owns their delivery and descriptors. */
function systemFontFaces(recipe: string): string {
  const families = new Set([...recipe.matchAll(/font-family: "([^"]+)"/g)].map(match => match[1]!));
  return [...families].flatMap(family => {
    const faces = packagedFaces[family];
    if (!faces?.length) throw new Error(`Design-system font ${family} is not packaged; update scripts/system-font-packages.mjs.`);
    return faces.map(face => `@font-face { font-family: ${JSON.stringify(family)}; font-style: ${face.style}; font-weight: ${face.weight};${face.stretch ? ` font-stretch: ${face.stretch};` : ''} font-display: swap; src: url(${JSON.stringify(face.url)}) format("woff2"); unicode-range: ${face.unicodeRange}; }`);
  }).join('\n');
}

export const STORY_SYSTEM_SHEETS: Readonly<Record<StorySystemName, StorySystemSheet>> = Object.fromEntries(
  Object.entries(sheets).map(([name, sheet]) => [name, { ...sheet, fontFaces: systemFontFaces(sheet.fontFaces) }]),
) as Record<StorySystemName, StorySystemSheet>;

/** The per-document sheet a system adds to the base sheet: its faces, then its classes. Empty for a theme or no design. */
export function storySystemSheetCss(name: string | null | undefined): string {
  const sheet = name && (STORY_SYSTEM_NAMES as readonly string[]).includes(name) ? STORY_SYSTEM_SHEETS[name as StorySystemName] : undefined;
  return sheet ? `${sheet.fontFaces}\n${sheet.css}` : '';
}

/** Every system's base-sheet contribution, for the prepared pages' stylesheet version (lib/story/prepared/css-version.server): a changed face or class re-prepares the stored pages that carry it. */
export const STORY_SYSTEMS_SHEET: string = STORY_SYSTEM_NAMES.map((name) => storySystemSheetCss(name)).join('\n');

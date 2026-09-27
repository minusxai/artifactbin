/**
 * THE FONTS BLOCK A STORED DRAWING CARRIES (lib/mermaid-images/fonts writes
 * it, lib/mermaid-images/sanitize admits it) — its constants, with nothing
 * that loads the subsetter: the read path imports this, never the subsetter.
 */
import fontManifest from '@/lib/data/story/story-font-manifest.json';
import type { FontFile } from './svg-text';

interface ManifestFace extends FontFile { family: string; style?: string | null }
const FAMILIES = (fontManifest as { families: Record<string, ManifestFace[]> }).families;

/** The families a stored drawing may carry: the bundled ones. */
export const MERMAID_BUNDLED_FAMILIES: ReadonlySet<string> = new Set(Object.keys(FAMILIES));
/** A bundled family's upright files, as the manifest declares them (public/fonts). */
export const bundledFontFiles = (family: string): FontFile[] => (FAMILIES[family] ?? []).filter((face) => (face.style ?? 'normal') === 'normal');
/** Every stored drawing lays its text out unhinted, as the harvest measured it. */
export const MERMAID_TEXT_RENDERING = 'svg{text-rendering:geometricPrecision}';
/** The block, wherever it sits. */
export const MERMAID_FONT_BLOCK = /<style>(?:@font-face\{[^}]*\})+svg\{text-rendering:geometricPrecision\}<\/style>/;

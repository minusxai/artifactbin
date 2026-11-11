/**
 * THE PLATFORM STYLESHEET for HTML pages (D3): the one Markdown stylesheet docs use (lib/html-components
 * markdown-styles), base styles, type roles, highlight-token colours and every design system's variables, each keyed by `:root[data-af-design-system="NAME"]` (dark values under `[data-af-dark="true"]`),
 * plus every family's @font-face rules on the platform's /af/fonts/ files (a face downloads only when text uses it).
 * Hosted pages link the whole sheet at one stable address (PLATFORM_STYLES_PATH, revalidated by ETag); exports, offline copies and the
 * local preview carry only the active system. Data: lib/html-systems/html-systems (generated from design-systems/specs).
 */
import {HTML_SYSTEMS,HTML_SYSTEM_FACES} from './html-systems.ts';
import {MARKDOWN_CSS} from '../html-components/markdown-styles.ts';
import {HTML_SYSTEM_MODES} from '../validation/html-system-modes.ts';

/** The platform stylesheet's one address: no version or hash, so a deploy shows up on the next load (ETag + no-cache). */
export const PLATFORM_STYLES_PATH = '/af/styles.css';

/** D17: platform font files, by name with no version or hash (lib/html-systems/fonts.server serves them, immutable). */
export const PLATFORM_FONTS_PATH = '/af/fonts/';
/** `<name>.woff2` for a hosted content-hashed font path (`/af/fonts/<name>.<hash8>.woff2`); null for anything else. */
export const platformFontName = (hashed: string): string | null => /^\/af\/fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2$/.exec(hashed)?.[1]?.concat('.woff2') ?? null;

export const HTML_SYSTEM_NAMES = Object.keys(HTML_SYSTEM_MODES);
/** Each system's display name. */
export const HTML_SYSTEM_LABELS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(HTML_SYSTEMS).map(([name, system]) => [name, system.label]));

/**
 * THE THEME CONTRACT a page, a component and a host page share. Every design system defines THEME_TOKENS (light and
 * dark); the components read only these, the optional overrides below (each with a shipped fallback) and their own
 * `--af-*` variables. What selects a system is two attributes on <html>, which the core sets on a page and a host page
 * sets itself: `data-af-design-system="NAME"` and `data-af-dark="true|false"` (with `color-scheme` to match). The
 * generated stylesheet headers (design-systems/lib/html-skill) state the same list; theme-tokens.test.ts pins all three.
 */
export const THEME_TOKENS = [
  '--background', '--foreground', '--card', '--card-foreground', '--popover', '--popover-foreground', '--primary',
  '--primary-foreground', '--secondary', '--secondary-foreground', '--muted', '--muted-foreground', '--accent',
  '--accent-foreground', '--destructive', '--destructive-foreground', '--border', '--input', '--ring', '--chart-1',
  '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--radius', '--font-display', '--font-body', '--font-mono',
] as const;
/** Read by components when set, never required: the radius scale derives from `--radius`, shadows have defaults. */
export const OPTIONAL_THEME_TOKENS = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-full', '--shadow-xs', '--shadow-md', '--shadow-lg'] as const;
export const THEME_ATTRIBUTES = { designSystem: 'data-af-design-system', dark: 'data-af-dark' } as const;
export const isHtmlSystem = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(HTML_SYSTEM_MODES, name);

/** The stylesheet for the named systems (every system when omitted): their families' faces, the Markdown sheet (zero
 * specificity, so the systems and page CSS layer over it), then the systems' rules. */
export function htmlSystemsCss(names: readonly string[] = HTML_SYSTEM_NAMES): string {
  const chosen = names.filter(isHtmlSystem).map((name) => HTML_SYSTEMS[name as keyof typeof HTML_SYSTEMS]);
  const families = [...new Set(chosen.flatMap((system) => system.families as readonly string[]))];
  return `/* Artifactbin platform stylesheet: design systems keyed by <html data-af-design-system>. */\n${families.map((family) => HTML_SYSTEM_FACES[family] ?? '').filter(Boolean).join('\n')}\n${MARKDOWN_CSS}\n${chosen.map((system) => system.rules).join('')}`;
}

/** The platform font files the named systems' faces load (absolute /af/fonts/ paths). */
export function htmlSystemFontPaths(names: readonly string[]): string[] {
  return [...new Set([...htmlSystemsCss(names).matchAll(/url\("(\/af\/fonts\/[^"]+)"\)/g)].map((match) => match[1]!))];
}


/** The owner's saved choice in page metadata (`meta.theme`), when it names a system HTML pages serve. */
export function designSystemChoice(meta: unknown): string | null {
  const theme = meta && typeof meta === 'object' ? (meta as { theme?: unknown }).theme : undefined;
  return isHtmlSystem(theme) ? theme : null;
}

export {storyFontManifest,STORY_FAMILY_ASSETS,storyFontFaceCss} from './font-catalog';


export type { StorySystem } from './story-systems';
export { resolveStoredStoryDesign } from './story-themes';

/**
 * THE PLATFORM STYLESHEET for HTML pages (D3): base styles, type roles, highlight-token colours and every design
 * system's variables, each keyed by `:root[data-af-design-system="NAME"]` (dark values under `[data-af-dark="true"]`),
 * plus every family's @font-face rules on the platform's /af/fonts/ files (a face downloads only when text uses it).
 * Hosted pages link the whole sheet at one stable address (PLATFORM_STYLES_PATH, revalidated by ETag); exports, offline copies and the
 * local preview carry only the active system. Data: lib/html-systems/html-systems (generated from design-systems/specs).
 */
import {HTML_SYSTEMS,HTML_SYSTEM_FACES} from './html-systems.ts';
import {HTML_SYSTEM_MODES} from '../validation/html-system-modes.ts';

/** The platform stylesheet's one address: no version or hash, so a deploy shows up on the next load (ETag + no-cache). */
export const PLATFORM_STYLES_PATH = '/af/styles.css';

/** D17: platform font files, by name with no version or hash (lib/html-systems/fonts.server serves them, immutable). */
export const PLATFORM_FONTS_PATH = '/af/fonts/';
/** `<name>.woff2` for a hosted content-hashed font path (`/fonts/<name>.<hash8>.woff2`); null for anything else. */
export const platformFontName = (hashed: string): string | null => /^\/fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2$/.exec(hashed)?.[1]?.concat('.woff2') ?? null;

export const HTML_SYSTEM_NAMES = Object.keys(HTML_SYSTEM_MODES);
export const isHtmlSystem = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(HTML_SYSTEM_MODES, name);

/** The stylesheet for the named systems (every system when omitted): their families' faces, then their rules. */
export function htmlSystemsCss(names: readonly string[] = HTML_SYSTEM_NAMES): string {
  const chosen = names.filter(isHtmlSystem).map((name) => HTML_SYSTEMS[name as keyof typeof HTML_SYSTEMS]);
  const families = [...new Set(chosen.flatMap((system) => system.families as readonly string[]))];
  return `/* Artifactbin platform stylesheet: design systems keyed by <html data-af-design-system>. */\n${families.map((family) => HTML_SYSTEM_FACES[family] ?? '').filter(Boolean).join('\n')}\n${chosen.map((system) => system.rules).join('')}`;
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

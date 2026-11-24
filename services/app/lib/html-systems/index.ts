/**
 * THE PLATFORM STYLESHEET for HTML pages (D3): the one Markdown stylesheet docs use (lib/html-components
 * markdown-styles), base styles, type roles, highlight-token colours and every design system's variables, each keyed by `:root[data-af-design-system="NAME"]` (dark values under `[data-af-dark="true"]`) with the variable blocks inside `:where()`, so a page's own `:root` variables always win,
 * plus every family's @font-face rules on the platform's /af/fonts/ files (a face downloads only when text uses it).
 * Hosted pages link the whole sheet at one stable address (PLATFORM_STYLES_PATH, revalidated by ETag); exports, offline copies and the
 * local preview carry only the active system. Data: lib/html-systems/html-systems (generated from design-systems/specs).
 */
import {HTML_SYSTEMS,HTML_SYSTEM_FACES} from './html-systems.ts';
import {MARKDOWN_CSS} from '../html-components/markdown-styles.ts';
import {HTML_SYSTEM_MODES,defaultHtmlSystemName,htmlSystemMode,installationDesignSystem,isKnownHtmlSystem} from '../validation/index.ts';
export {installationDesignSystem,setDefaultHtmlSystem,setInstallationDesignSystem} from '../validation/index.ts';

/** The platform stylesheet's one address: no version or hash, so a deploy shows up on the next load (ETag + no-cache). */
export const PLATFORM_STYLES_PATH = '/af/styles.css';

/** D17: platform font files, by name with no version or hash (lib/html-systems/fonts.server serves them, immutable). */
export const PLATFORM_FONTS_PATH = '/af/fonts/';
/** `<name>.woff2` for a hosted content-hashed font path (`/af/fonts/<name>.<hash8>.woff2`); null for anything else. */
export const platformFontName = (hashed: string): string | null => /^\/af\/fonts\/([a-z0-9-]+)\.[a-f0-9]{8}\.woff2$/.exec(hashed)?.[1]?.concat('.woff2') ?? null;

/** The built-in systems. Every system this server serves, the installation system (./installation.server) first
 * when there is one: `htmlSystemNames()`. */
export const HTML_SYSTEM_NAMES = Object.keys(HTML_SYSTEM_MODES);
/** Each built-in system's display name; `htmlSystemLabel` covers the installation system too. */
export const HTML_SYSTEM_LABELS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(HTML_SYSTEMS).map(([name, system]) => [name, system.label]));
export const htmlSystemNames = (): readonly string[] => { const installed = installationDesignSystem(); return installed ? [installed.slug, ...HTML_SYSTEM_NAMES] : HTML_SYSTEM_NAMES; };
export const htmlSystemLabel = (name: string): string | undefined => installationDesignSystem()?.slug === name ? installationDesignSystem()!.label : HTML_SYSTEM_LABELS[name];
/** This server's default design system: APP__DEFAULT_DESIGN_SYSTEM's, else the installation system's slug, else null
 * (no server-wide default). */
export const defaultHtmlSystem = defaultHtmlSystemName;

/**
 * THE THEME CONTRACT a page, a component and a host page share. Every design system defines THEME_TOKENS (light and
 * dark); the components read only these, the optional overrides below (each with a shipped fallback) and their own
 * `--af-*` variables. What selects a system is two attributes on <html>, which the core sets on a page and a host page
 * sets itself: `data-af-design-system="NAME"` and `data-af-dark="true|false"` (with `color-scheme` to match). The
 * generated stylesheet headers (design-systems/lib/html-skill) state the same list; theme-tokens.test.ts pins all three.
 */
export {THEME_TOKENS} from './html-systems.ts';
/** Read by components when set, never required: the radius scale derives from `--radius`, shadows have defaults. */
export const OPTIONAL_THEME_TOKENS = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-full', '--shadow-xs', '--shadow-md', '--shadow-lg'] as const;
export const THEME_ATTRIBUTES = { designSystem: 'data-af-design-system', dark: 'data-af-dark' } as const;
export const isHtmlSystem = isKnownHtmlSystem;

/** The stylesheet for the named systems (every system when omitted): their families' faces, the Markdown sheet (zero
 * specificity, so the systems and page CSS layer over it), then the systems' rules. */
export function htmlSystemsCss(names: readonly string[] = htmlSystemNames()): string {
  const installed = installationDesignSystem();
  const chosen = names.filter(isHtmlSystem).map((name) => installed?.slug === name ? installed : HTML_SYSTEMS[name as keyof typeof HTML_SYSTEMS]);
  const families = [...new Set(chosen.flatMap((system) => system.families as readonly string[]))];
  const face = (family: string) => HTML_SYSTEM_FACES[family] ?? (installed && chosen.includes(installed) ? installed.faces[family] : undefined) ?? '';
  return `/* Artifactbin platform stylesheet: design systems keyed by <html data-af-design-system>. */\n${families.map(face).filter(Boolean).join('\n')}\n${MARKDOWN_CSS}\n${chosen.map((system) => system.rules).join('')}`;
}

/**
 * /af/manifest.json's design-system fields: every system with its label, opening mode and stylesheet address
 * (`styleUrl` names each sheet); `defaultDesignSystem`, only when this server has a default (defaultHtmlSystem); and
 * the installation system's entry, when there is one, carries `dark` (false: light-only, so a host locks to light).
 * Without either setting the fields are exactly the built-ins' as before; every built-in has light and dark.
 */
export function designSystemsManifest(styleUrl: (css: string) => string): { designSystems: Record<string, { label: string; defaultMode: 'light' | 'dark'; styles: string; dark?: boolean }>; defaultDesignSystem?: string } {
  const installed = installationDesignSystem();
  const designSystems = Object.fromEntries(htmlSystemNames().map((name) => [name, { label: htmlSystemLabel(name)!, defaultMode: htmlSystemMode(name), styles: styleUrl(htmlSystemsCss([name])), ...(installed?.slug === name ? { dark: installed.dark } : {}) }]));
  const chosen = defaultHtmlSystem();
  return { designSystems, ...(chosen ? { defaultDesignSystem: chosen } : {}) };
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

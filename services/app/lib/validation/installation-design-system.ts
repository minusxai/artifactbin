/**
 * THE INSTALLATION DESIGN SYSTEM's registry: at most one design system an operator supplies (APP__DESIGN_SYSTEM_DIR,
 * read and validated at boot by lib/html-systems installation.server), beside the built-ins of ./html-system-modes.
 * The boot registers it here once; every consumer asks through these functions, never the generated constants alone.
 * Unregistered (the setting unset, and every browser or skill bundle, which has no boot): the built-ins only, exactly
 * as before. A dependency-free leaf with explicit .ts specifiers: skill scripts load it under Node in a source checkout.
 */
import {HTML_SYSTEM_MODES} from './html-system-modes.ts';

export interface InstallationDesignSystem {
  slug: string;
  label: string;
  /** For the skill's table: one or two words, and what it fits. */
  mood: string;
  fits: string;
  defaultMode: 'light' | 'dark';
  /** False: light-only; `data-af-dark` never applies it dark. */
  dark: boolean;
  families: readonly string[];
  /** family → its @font-face rules, on this system's /af/fonts/ names. */
  faces: Readonly<Record<string, string>>;
  /** The platform rules, keyed by `:root[data-af-design-system="slug"]` (lib/html-systems system-css). */
  rules: string;
  /** The skill archive's commented copy, design-systems/<slug>.css. */
  css: string;
  /** `<name>.woff2` → bytes, served at /af/fonts/ (content-hashed names, immutable). */
  fonts: ReadonlyMap<string, Uint8Array>;
}

let installed: InstallationDesignSystem | null = null;
/** The system APP__DEFAULT_DESIGN_SYSTEM names, checked at boot; null: the installation system, if any, is the default. */
let named: string | null = null;
/** The registered installation system, or null. */
export const installationDesignSystem = (): InstallationDesignSystem | null => installed;
/** The boot's one registration (tests reset it with null). */
export function setInstallationDesignSystem(system: InstallationDesignSystem | null): void { installed = system; }
/** The boot's named default (tests reset it with null). */
export function setDefaultHtmlSystem(name: string | null): void { named = name; }
/** This server's default design system: the named one, else the installation system, else null (no default). */
export const defaultHtmlSystemName = (): string | null => named ?? installed?.slug ?? null;

/** A built-in system or the installation system. */
export const isKnownHtmlSystem = (name: unknown): name is string =>
  typeof name === 'string' && (Object.hasOwn(HTML_SYSTEM_MODES, name) || installed?.slug === name);
/** True for the installation system when it has no dark values: pages in it never apply dark. */
export const isLightOnlyHtmlSystem = (name: string): boolean => installed?.slug === name && !installed.dark;
/** The mode a known system opens in; light for anything else. */
export const htmlSystemMode = (name: string): 'light' | 'dark' =>
  installed?.slug === name ? installed.defaultMode : HTML_SYSTEM_MODES[name] ?? 'light';

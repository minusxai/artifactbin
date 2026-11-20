/**
 * A design system's custom properties as plain declarations, for code that draws with them outside
 * a browser (the query image, lib/viz chart-image): the system's `:where(:root[data-af-design-system])`
 * block, with its `[data-af-dark="true"]` block layered over it in dark. Values stay as written
 * (`var()`, `color-mix()` …); the caller resolves them. Server-only: kept out of the index that
 * browser and skill bundles import.
 */
import { HTML_SYSTEMS } from './html-systems.ts';
import { htmlSystemMode, installationDesignSystem, isKnownHtmlSystem, isLightOnlyHtmlSystem } from '../validation/index.ts';
import { htmlSystemNames } from './index';

type Mode = 'light' | 'dark';
const cache = new Map<string, Readonly<Record<string, string>>>();

/** The declarations of the block whose selector is exactly `selector`. */
function block(rules: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]!.trim() !== selector) continue;
    for (const decl of match[2]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[decl[1]!] = decl[2]!.trim();
  }
  return out;
}

/** The named system's variables in `mode`; null when no system has that name. */
function designSystemVariables(name: string, mode: Mode): Readonly<Record<string, string>> | null {
  if (!isKnownHtmlSystem(name)) return null;
  const installed = installationDesignSystem();
  const rules = installed?.slug === name ? installed.rules : HTML_SYSTEMS[name as keyof typeof HTML_SYSTEMS].rules;
  // Built-ins are cached; the installation system's (set at boot, replaceable in tests) is read from its rules.
  const key = installed?.slug === name ? null : `${name}:${mode}`;
  let found = key ? cache.get(key) : undefined;
  if (!found) {
    const root = `:root[data-af-design-system="${name}"]`;
    found = Object.freeze({ ...block(rules, `:where(${root})`), ...(mode === 'dark' ? block(rules, `:where(${root}[data-af-dark="true"])`) : {}) });
    if (key) cache.set(key, found);
  }
  return found;
}

/** What a chart drawn outside a page reads of the design systems: their names, opening modes and variables. */
export const DESIGN_SYSTEM_VARIABLES = {
  get names(): readonly string[] { return htmlSystemNames(); },
  defaultMode: (name: string): Mode => htmlSystemMode(name),
  variables: designSystemVariables,
  lightOnly: isLightOnlyHtmlSystem,
};

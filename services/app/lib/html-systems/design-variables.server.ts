/**
 * A design system's custom properties as plain declarations, for code that draws with them outside
 * a browser (the query image, lib/viz chart-image): the system's `:root[data-af-design-system]`
 * block, with its `[data-af-dark="true"]` block layered over it in dark. Values stay as written
 * (`var()`, `color-mix()` …); the caller resolves them. Server-only: kept out of the index that
 * browser and skill bundles import.
 */
import { HTML_SYSTEMS } from './html-systems.ts';
import { HTML_SYSTEM_MODES } from '../validation/html-system-modes.ts';

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
  if (!Object.hasOwn(HTML_SYSTEMS, name)) return null;
  const key = `${name}:${mode}`;
  let found = cache.get(key);
  if (!found) {
    const rules = HTML_SYSTEMS[name as keyof typeof HTML_SYSTEMS].rules;
    const root = `:root[data-af-design-system="${name}"]`;
    found = Object.freeze({ ...block(rules, root), ...(mode === 'dark' ? block(rules, `${root}[data-af-dark="true"]`) : {}) });
    cache.set(key, found);
  }
  return found;
}

/** What a chart drawn outside a page reads of the design systems: their names, opening modes and variables. */
export const DESIGN_SYSTEM_VARIABLES = {
  names: Object.keys(HTML_SYSTEM_MODES) as readonly string[],
  defaultMode: (name: string): Mode => HTML_SYSTEM_MODES[name] ?? 'light',
  variables: designSystemVariables,
};

/**
 * The one split every emitter agrees on: which lines of a system's css style the specimen PAGE (its sections,
 * swatches, hand panels, code blocks) and which style the SYSTEM (type roles, components, the hand, the page-type
 * kit). The runtime registry keeps the system half (./runtime.mjs); a runtime-bound specimen page keeps the chrome
 * half (./pages.mjs); the references list the system half (./skill.mjs). A dependency-free leaf, so pages.mjs can
 * import it without the skill emitter's import cycle.
 */

/** Selectors that style the specimen PAGE, not the system: dropped from the component css. */
export const PAGE_CHROME = ['.ds-section', '.ds-chip', '.ds-cover', '.ds-wrap', '.ds-toc', '.ds-two', '.ds-three', '.ds-note', '.ds-comp', '.ds-stats',
  '.ds-swatch', '.ds-type', '.ds-kv', '.ds-principle', '.ds-voice', '.ds-hand', '.ds-motif', '.ds-foot', '.ds-code', '.ds-map',
  '.ds-rules', '.ds-sample', '.ds-lede', '.ds-eyebrow', '.ds-series', '.ds-borrow', '.ds-devices', '.ds-hex', '.ds-group',
  '-sample', '.ds-tpls', '.ds-tpl-block', '.ds-tpl-head', '.ds-progress', '.ds-fields', '.ds-callouts', '.ds-swatch-chip'];

/** The skeleton lines that are the page-type KIT (served by the runtime), not the specimen page's own chrome. */
export const KIT_SELECTORS = ['.h-', '.ds-row', '.ds-tpl'];

export const selectorOf = (line) => line.split('{')[0];
export const isChrome = (line) => PAGE_CHROME.some((c) => selectorOf(line).includes(c));
export const isKit = (line) => KIT_SELECTORS.some((w) => selectorOf(line).includes(w));

/** Keep the lines whose selector `keep` accepts; an @container block survives only with kept lines inside it. */
export function filterBlock(css, keep) {
  const out = [];
  let block = [], inside = false;
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('@container') && line.endsWith('{')) { inside = true; block = [raw]; continue; }
    if (inside && line === '}') { if (block.length > 1) out.push(...block, raw); inside = false; continue; }
    if (line.startsWith('@container') && line.endsWith('}')) {
      // a one-line block: keep whole when any inner rule is wanted
      const inner = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
      if (inner.split(/\}\s*/).some((r) => r.trim() && keep(r + '{'))) out.push(raw);
      continue;
    }
    if (keep(line)) (inside ? block : out).push(raw);
  }
  return out.join('\n');
}

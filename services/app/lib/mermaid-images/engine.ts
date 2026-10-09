/**
 * WHAT DREW A STORED DRAWING — the half of its key the page cannot see.
 *
 * A stored Mermaid drawing stands in for the one the engine would draw, so it
 * is valid only for the engine that drew it: the installed Mermaid and the
 * kit's render configuration (lib/mermaid-images/mermaid-render — initialize
 * options and the document's own rules). Both are in this string, every
 * stored drawing carries it, and the server serves only drawings made by the
 * CURRENT one: upgrading Mermaid, or changing the kit's configuration, makes
 * every older drawing invisible at once and readers draw with the engine until
 * the harvest catches up. Pinned against the installed package and the render
 * module's bytes by lib/mermaid-images/__tests__/engine.test.ts.
 */
import { mermaidDiagramKind } from '@/lib/story-ui/mermaid-source';

/**
 * Bump when lib/mermaid-images/mermaid-render changes what it draws (its test pins
 * the file), or when what a stored drawing IS changes. 3: drawings are laid
 * out unhinted and carry the document's fonts (lib/mermaid-images/fonts);
 * kit1's were laid out in hinted Linux advances with no fonts of their own,
 * and kit2 was an unreleased step between.
 */
export const MERMAID_KIT_RENDER_VERSION = 3;
export const MERMAID_RENDER_ENGINE = `mermaid@12.0.0+kit${MERMAID_KIT_RENDER_VERSION}`;

/**
 * Kinds never prerendered, whatever a harvest would see. A gantt chart draws
 * a "today" line: stored, it would stand still while the engine's moves. A
 * cynefin chart draws its boundaries from a seed hashed from the render's id,
 * which counts diagrams in the order a page draws them: the harvest page's
 * count is not a reader's (a mode switch alone redraws with another). The
 * C4 lays its text out in its own font stack (`"Open Sans", sans-serif`),
 * never the document's web fonts, so its drawing is a system-font drawing on
 * every theme: measured 1.07px taller on macOS than on Linux, and a face a
 * stored drawing cannot carry (lib/mermaid-images/fonts). The
 * use-case and railroad kinds have no fixture in the fidelity gate
 * (scripts/fixtures/mermaid/kinds.mjs) yet, so nothing proves a stored drawing
 * of them equals the engine's: they keep the engine until one does.
 * Drawings that differ from one load to the next (gitGraph's generated commit
 * ids) are refused per drawing by the harvest itself, which draws twice, and
 * drawings with HTML labels by the sanitizer.
 */
const MERMAID_PRERENDER_EXCLUDED_KINDS: ReadonlySet<string> = new Set(['gantt', 'cynefin', 'c4', 'usecase', 'railroad', 'railroad-ebnf', 'railroad-abnf', 'railroad-peg']);

/** A code the harvest may store a drawing for: one the kit draws, of a kind that is not excluded. */
export function mermaidPrerenderable(code: string): boolean {
  const kind = mermaidDiagramKind(code);
  return kind !== null && !MERMAID_PRERENDER_EXCLUDED_KINDS.has(kind);
}

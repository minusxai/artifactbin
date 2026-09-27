/**
 * WHAT DREW A STORED DRAWING — the half of its key the page cannot see.
 *
 * A stored Mermaid drawing stands in for the one the engine would draw, so it
 * is valid only for the engine that drew it: the installed Mermaid and the
 * kit's render configuration (components/kit/mermaid-render — initialize
 * options and the document's own rules). Both are in this string, every
 * stored drawing carries it, and the server serves only drawings made by the
 * CURRENT one: upgrading Mermaid, or changing the kit's configuration, makes
 * every older drawing invisible at once and readers draw with the engine until
 * the harvest catches up. Pinned against the installed package and the render
 * module's bytes by lib/mermaid-images/__tests__/engine.test.ts.
 */
import { mermaidDiagramKind } from '@/lib/story-ui/mermaid-source';

/** Bump when components/kit/mermaid-render changes what it draws (its test pins the file). */
export const MERMAID_KIT_RENDER_VERSION = 1;
export const MERMAID_RENDER_ENGINE = `mermaid@12.0.0+kit${MERMAID_KIT_RENDER_VERSION}`;

/**
 * Kinds never prerendered, whatever a harvest would see. A gantt chart draws
 * a "today" line: stored, it would stand still while the engine's moves.
 * Drawings that differ from one load to the next (gitGraph's generated commit
 * ids) are refused per drawing by the harvest itself, which draws twice.
 */
export const MERMAID_PRERENDER_EXCLUDED_KINDS: ReadonlySet<string> = new Set(['gantt']);

/** A code the harvest may store a drawing for: one the kit draws, of a kind that is not excluded. */
export function mermaidPrerenderable(code: string): boolean {
  const kind = mermaidDiagramKind(code);
  return kind !== null && !MERMAID_PRERENDER_EXCLUDED_KINDS.has(kind);
}

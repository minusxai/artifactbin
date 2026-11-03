/**
 * KEPT FOR EXISTING PAGES ONLY (33 live pages on 3 Nov 2026). New pages use the direct libraries
 * (references/maps.md, diagrams.md). Delete together with ../html-components/mermaid.ts,
 * ../mermaid-images/{reader-draw,mermaid-render,mermaid-fonts,svg-text}.ts, their tests, the `mermaid` entry of
 * hosted.json `legacy` and the reader-draw path in scripts/lib/html-components-build.mjs once no live page uses
 * af-mermaid.
 *
 * The source af-mermaid and its renderer refuse before drawing; Mermaid configuration is owned by the page theme.
 */
const MERMAID_MAX_SOURCE = 20_000;

export function mermaidSourceError(code: unknown): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'Mermaid requires a nonempty static code string.';
  if (code.length > MERMAID_MAX_SOURCE) return `Mermaid code exceeds ${MERMAID_MAX_SOURCE} characters.`;
  if (/^\s*---(?:\s|$)/.test(code) || /%%\s*\{/.test(code)) return 'Mermaid configuration directives and frontmatter are not supported; the document theme controls presentation.';
  return null;
}

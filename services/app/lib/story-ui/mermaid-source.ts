/** Shared publish/read boundary; Mermaid configuration is owned by the app. */
export const MERMAID_MAX_SOURCE = 20_000;

export function mermaidSourceError(code: unknown): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'Mermaid requires a nonempty static code string.';
  if (code.length > MERMAID_MAX_SOURCE) return `Mermaid code exceeds ${MERMAID_MAX_SOURCE} characters.`;
  if (/^\s*---(?:\s|$)/.test(code) || /%%\s*\{/.test(code)) return 'Mermaid configuration directives and frontmatter are not supported; the document theme controls presentation.';
  return null;
}

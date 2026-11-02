

/** Shared publish/read boundary; Mermaid configuration is owned by the app. */
const MERMAID_MAX_SOURCE = 20_000;

export function mermaidSourceError(code: unknown): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'Mermaid requires a nonempty static code string.';
  if (code.length > MERMAID_MAX_SOURCE) return `Mermaid code exceeds ${MERMAID_MAX_SOURCE} characters.`;
  if (/^\s*---(?:\s|$)/.test(code) || /%%\s*\{/.test(code)) return 'Mermaid configuration directives and frontmatter are not supported; the document theme controls presentation.';
  return null;
}

/** Retained source-language names used by saved documents and manifests.
 * These are syntax identifiers, not external layout engines or runtime imports. */
interface MermaidDiagram {kind: string; test: RegExp}

export const MERMAID_DIAGRAMS: readonly MermaidDiagram[] = [
  { kind: 'flowchart-elk', test: /^\s*flowchart-elk/ },
  { kind: 'mindmap', test: /^\s*mindmap/ },
  { kind: 'architecture', test: /^\s*architecture/ },
  { kind: 'agentflow', test: /^\s*agentflow-beta\b/ },
  { kind: 'c4', test: /^\s*(?:C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/ },
  { kind: 'kanban', test: /^\s*kanban/ },
  { kind: 'class', test: /^\s*classDiagram/ },
  { kind: 'er', test: /^\s*erDiagram/ },
  { kind: 'gantt', test: /^\s*gantt/ },
  { kind: 'info', test: /^\s*info/ },
  { kind: 'pie', test: /^\s*pie/ },
  { kind: 'requirement', test: /^\s*requirement(Diagram)?/ },
  { kind: 'sequence', test: /^\s*sequenceDiagram/ },
  { kind: 'swimlane', test: /^\s*swimlane-beta\b/ },
  { kind: 'flowchart', test: /^\s*(graph|flowchart)/ },
  { kind: 'timeline', test: /^\s*timeline/ },
  { kind: 'gitGraph', test: /^\s*gitGraph/ },
  { kind: 'state', test: /^\s*stateDiagram/ },
  { kind: 'journey', test: /^\s*journey/ },
  { kind: 'quadrant', test: /^\s*quadrantChart/ },
  { kind: 'sankey', test: /^\s*sankey(-beta)?/ },
  { kind: 'packet', test: /^\s*packet(-beta)?/ },
  { kind: 'xychart', test: /^\s*xychart(-beta)?/ },
  { kind: 'block', test: /^\s*block(-beta)?/ },
  { kind: 'eventmodeling', test: /^\s*eventmodeling/ },
  { kind: 'treeView', test: /^\s*treeView-beta/ },
  { kind: 'radar', test: /^\s*radar-beta/ },
  { kind: 'ishikawa', test: /^\s*ishikawa(-beta)?\b/i },
  { kind: 'treemap', test: /^\s*treemap/ },
  { kind: 'railroad', test: /^\s*railroad-beta/i },
  { kind: 'railroad-ebnf', test: /^\s*railroad-ebnf-beta/i },
  { kind: 'railroad-abnf', test: /^\s*railroad-abnf-beta/i },
  { kind: 'railroad-peg', test: /^\s*railroad-peg-beta/i },
  { kind: 'venn', test: /^\s*venn-beta/ },
  { kind: 'wardley', test: /^\s*wardley-beta/i },
  { kind: 'cynefin', test: /^\s*cynefin-beta(?:[\s:]|$)/ },
  { kind: 'usecase', test: /^\s*usecase-beta(?:\s|$)/ },
];

/**
 * Mermaid's `stripAnyComments`: every `%%` that has a line end after it cuts
 * the rest of its line (and the whitespace before it) down to a bare newline.
 */
function stripAnyComments(text: string): string {
  let out = '';
  let consumed = 0;
  for (let from = 0; from < text.length;) {
    const marker = text.indexOf('%%', from);
    if (marker === -1) break;
    const lineEnd = text.indexOf('\n', marker);
    if (lineEnd === -1) break;
    let start = marker;
    while (start > consumed && /\s/.test(text[start - 1] ?? '')) start--;
    out += text.slice(consumed, start) + '\n';
    consumed = from = lineEnd + 1;
  }
  return out + text.slice(consumed);
}

/**
 * The kind of diagram a `<Mermaid code>` draws, as Mermaid itself would detect
 * it (its preprocess, then `detectType`), or null when the kit will not draw
 * it at all — a refused source (front matter, `%%{init}%%`) never reaches the
 * engine — or Mermaid knows no such kind.
 */
export function mermaidDiagramKind(code: unknown): string | null {
  if (typeof code !== 'string' || mermaidSourceError(code)) return null;
  const withoutCommentLines = code.replace(/\r\n?/g, '\n').replace(/^\s*%%(?!{)[^\n]+\n?/gm, '').trimStart();
  const text = stripAnyComments(withoutCommentLines);
  return MERMAID_DIAGRAMS.find((d) => d.test.test(text))?.kind ?? null;
}

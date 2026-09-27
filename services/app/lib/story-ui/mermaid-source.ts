/** Shared publish/read boundary; Mermaid configuration is owned by the app. */
const MERMAID_MAX_SOURCE = 20_000;

export function mermaidSourceError(code: unknown): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'Mermaid requires a nonempty static code string.';
  if (code.length > MERMAID_MAX_SOURCE) return `Mermaid code exceeds ${MERMAID_MAX_SOURCE} characters.`;
  if (/^\s*---(?:\s|$)/.test(code) || /%%\s*\{/.test(code)) return 'Mermaid configuration directives and frontmatter are not supported; the document theme controls presentation.';
  return null;
}

/** A layout engine Mermaid loads on demand (its `registerDefaultLayoutLoaders`). */
export type MermaidLayout = 'elk' | 'cose-bilkent' | 'swimlane' | 'dagre';

export interface MermaidDiagram {
  /** The kit's name for the kind: what a manifest keys a kind's code by. */
  kind: string;
  /** Mermaid's own detector id, whose loader names the diagram's module. */
  mermaid: string;
  /** Mermaid's detector, verbatim. */
  test: RegExp;
  /**
   * The layout engines this kind loads under components/kit/mermaid-render's
   * configuration. Mermaid 12 makes `elk` its DEFAULT layout, so every kind
   * that asks the layout registry for "the configured layout" (flowcharts,
   * class, state, ER, requirement, agentflow, usecase) draws with elk, not only
   * `flowchart-elk`; switching them to dagre would change every such drawing.
   */
  layouts: readonly MermaidLayout[];
}

/**
 * Every diagram kind Mermaid 12.0.0 draws, in ITS detection order: the first
 * match wins, so `flowchart-elk` precedes `flowchart`, and C4 (whose regex is
 * anchored only on its first alternative) precedes nearly everything.
 * Pinned against the installed Mermaid by lib/story-ui/__tests__/mermaid-source
 * (detection) and scripts/__tests__ via the runtime build (modules, layouts).
 */
export const MERMAID_DIAGRAMS: readonly MermaidDiagram[] = [
  { kind: 'flowchart-elk', mermaid: 'flowchart-elk', test: /^\s*flowchart-elk/, layouts: ['elk'] },
  { kind: 'mindmap', mermaid: 'mindmap', test: /^\s*mindmap/, layouts: ['cose-bilkent'] },
  { kind: 'architecture', mermaid: 'architecture', test: /^\s*architecture/, layouts: [] },
  { kind: 'agentflow', mermaid: 'agentflow', test: /^\s*agentflow-beta\b/, layouts: ['elk'] },
  { kind: 'c4', mermaid: 'c4', test: /^\s*C4Context|C4Container|C4Component|C4Dynamic|C4Deployment/, layouts: [] },
  { kind: 'kanban', mermaid: 'kanban', test: /^\s*kanban/, layouts: [] },
  { kind: 'class', mermaid: 'classDiagram', test: /^\s*classDiagram/, layouts: ['elk'] },
  { kind: 'er', mermaid: 'er', test: /^\s*erDiagram/, layouts: ['elk'] },
  { kind: 'gantt', mermaid: 'gantt', test: /^\s*gantt/, layouts: [] },
  { kind: 'info', mermaid: 'info', test: /^\s*info/, layouts: [] },
  { kind: 'pie', mermaid: 'pie', test: /^\s*pie/, layouts: [] },
  { kind: 'requirement', mermaid: 'requirement', test: /^\s*requirement(Diagram)?/, layouts: ['elk'] },
  { kind: 'sequence', mermaid: 'sequence', test: /^\s*sequenceDiagram/, layouts: [] },
  { kind: 'swimlane', mermaid: 'swimlane', test: /^\s*swimlane-beta\b/, layouts: ['swimlane'] },
  { kind: 'flowchart', mermaid: 'flowchart-v2', test: /^\s*(graph|flowchart)/, layouts: ['elk'] },
  { kind: 'timeline', mermaid: 'timeline', test: /^\s*timeline/, layouts: [] },
  { kind: 'gitGraph', mermaid: 'gitGraph', test: /^\s*gitGraph/, layouts: [] },
  { kind: 'state', mermaid: 'stateDiagram', test: /^\s*stateDiagram/, layouts: ['elk'] },
  { kind: 'journey', mermaid: 'journey', test: /^\s*journey/, layouts: [] },
  { kind: 'quadrant', mermaid: 'quadrantChart', test: /^\s*quadrantChart/, layouts: [] },
  { kind: 'sankey', mermaid: 'sankey', test: /^\s*sankey(-beta)?/, layouts: [] },
  { kind: 'packet', mermaid: 'packet', test: /^\s*packet(-beta)?/, layouts: [] },
  { kind: 'xychart', mermaid: 'xychart', test: /^\s*xychart(-beta)?/, layouts: [] },
  { kind: 'block', mermaid: 'block', test: /^\s*block(-beta)?/, layouts: [] },
  { kind: 'eventmodeling', mermaid: 'eventmodeling', test: /^\s*eventmodeling/, layouts: [] },
  { kind: 'treeView', mermaid: 'treeView', test: /^\s*treeView-beta/, layouts: [] },
  { kind: 'radar', mermaid: 'radar', test: /^\s*radar-beta/, layouts: [] },
  { kind: 'ishikawa', mermaid: 'ishikawa', test: /^\s*ishikawa(-beta)?\b/i, layouts: [] },
  { kind: 'treemap', mermaid: 'treemap', test: /^\s*treemap/, layouts: [] },
  { kind: 'railroad', mermaid: 'railroad', test: /^\s*railroad-beta/i, layouts: [] },
  { kind: 'railroad-ebnf', mermaid: 'railroadEbnf', test: /^\s*railroad-ebnf-beta/i, layouts: [] },
  { kind: 'railroad-abnf', mermaid: 'railroadAbnf', test: /^\s*railroad-abnf-beta/i, layouts: [] },
  { kind: 'railroad-peg', mermaid: 'railroadPeg', test: /^\s*railroad-peg-beta/i, layouts: [] },
  { kind: 'venn', mermaid: 'venn', test: /^\s*venn-beta/, layouts: [] },
  { kind: 'wardley', mermaid: 'wardley', test: /^\s*wardley-beta/i, layouts: [] },
  { kind: 'cynefin', mermaid: 'cynefin', test: /^\s*cynefin-beta(?:[\s:]|$)/, layouts: [] },
  { kind: 'usecase', mermaid: 'usecase', test: /^\s*usecase-beta(?:\s|$)/, layouts: ['elk'] },
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

/**
 * Key of a stored Mermaid drawing: the diagram's code and the colour mode it
 * was drawn in. SEED (Track G): contract only.
 */
export function mermaidImageKey(code: string, mode: 'light' | 'dark'): string {
  throw new Error(`mermaidImageKey not implemented (${code.length}, ${mode})`);
}

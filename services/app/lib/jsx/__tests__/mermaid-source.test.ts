/**
 * Which diagram a `<Mermaid code>` draws — decided from its source alone, the
 * way Mermaid 12 decides it, so the renderer loads exactly the code that
 * kind needs.
 *
 * The rule under test is Mermaid's own: strip comments, then the FIRST detector
 * in its registration order that matches the leading keyword wins. The order
 * matters — `flowchart-elk` also starts with `flowchart`, and C4's detector
 * matches `C4Container` anywhere — so it is pinned against the installed
 * Mermaid in scripts/__tests__/story-runtime-mermaid.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {detectType} from 'pele';
import { MERMAID_DIAGRAMS, mermaidDiagramKind } from '../mermaid-source';

const cases: Array<[string, string]> = [
    ['flowchart TD\n  a --> b', 'flowchart'],
    ['graph LR\n  a --> b', 'flowchart'],
    ['flowchart-elk TD\n  a --> b', 'flowchart-elk'],
    ['sequenceDiagram\n  A->>B: hi', 'sequence'],
    ['classDiagram\n  class A', 'class'],
    ['classDiagram-v2\n  class A', 'class'],
    ['stateDiagram-v2\n  [*] --> A', 'state'],
    ['stateDiagram\n  [*] --> A', 'state'],
    ['gantt\n  title T', 'gantt'],
    ['erDiagram\n  A ||--o{ B : has', 'er'],
    ['pie title Pets\n  "Dogs" : 1', 'pie'],
    ['mindmap\n  root', 'mindmap'],
    ['architecture-beta\n  service a(server)[A]', 'architecture'],
    ['journey\n  title T', 'journey'],
    ['gitGraph\n  commit', 'gitGraph'],
    ['timeline\n  title T', 'timeline'],
    ['quadrantChart\n  title T', 'quadrant'],
    ['xychart-beta\n  bar [1]', 'xychart'],
    ['xychart\n  bar [1]', 'xychart'],
    ['sankey-beta\n  a,b,1', 'sankey'],
    ['requirementDiagram\n  requirement r {}', 'requirement'],
    ['block-beta\n  a', 'block'],
    ['packet-beta\n  0-1: "x"', 'packet'],
    ['kanban\n  Todo', 'kanban'],
    ['C4Context\n  Person(p, "U")', 'c4'],
    ['radar-beta\n  axis a', 'radar'],
    ['treemap-beta\n  "A": 1', 'treemap'],
    ['info', 'info'],
    ['swimlane-beta LR\n  a --> b', 'swimlane'],
    ['agentflow-beta\n  a --> b', 'agentflow'],
    ['usecase-beta\n  actor U', 'usecase'],
    ['ishikawa-beta\n  P', 'ishikawa'],
    ['venn-beta\n  set A', 'venn'],
    ['treeView-beta\n  root', 'treeView'],
    ['eventmodeling\n  tf 01 cmd Do', 'eventmodeling'],
    ['wardley-beta\n  title T', 'wardley'],
    ['cynefin-beta\n  title T', 'cynefin'],
    ['railroad-beta\n  r = "a" ;', 'railroad'],
    ['railroad-ebnf-beta\n  r = "a" ;', 'railroad-ebnf'],
    ['railroad-abnf-beta\n  r = "a"', 'railroad-abnf'],
    ['railroad-peg-beta\n  r <- "a"', 'railroad-peg'],
];

describe('every kind is found by its first keyword', () => {
  for (const [code, kind] of cases) {
    it(`${JSON.stringify(code.split('\n')[0])} → ${kind}`, () => {
      expect(mermaidDiagramKind(code)).toBe(kind);
    });
  }

  it('names only kinds the table declares', () => {
    const declared = new Set(MERMAID_DIAGRAMS.map((d) => d.kind));
    for (const [, kind] of cases) expect(declared.has(kind), kind).toBe(true);
  });
});

describe('odd input', () => {
  it('ignores leading whitespace and blank lines', () => {
    expect(mermaidDiagramKind('\n\n   \t sequenceDiagram\n  A->>B: hi')).toBe('sequence');
  });

  it('skips %% comment lines before the keyword, as Mermaid does', () => {
    expect(mermaidDiagramKind('%% the pipeline\n%% second note\nflowchart LR\n  a --> b')).toBe('flowchart');
    expect(mermaidDiagramKind('  %% indented note\n  sequenceDiagram\n  A->>B: hi')).toBe('sequence');
  });

  it('a trailing comment on the keyword line does not change the kind', () => {
    expect(mermaidDiagramKind('graph TD %% top-down\n  a --> b')).toBe('flowchart');
  });

  it('normalises Windows line endings', () => {
    expect(mermaidDiagramKind('%% note\r\nerDiagram\r\n  A ||--o{ B : has')).toBe('er');
  });

  it('matches the keyword at the start, not anywhere', () => {
    expect(mermaidDiagramKind('%% sequenceDiagram is next\nflowchart LR\n  a --> b')).toBe('flowchart');
    expect(mermaidDiagramKind('not a diagram\nflowchart LR')).toBeNull();
  });

  it('recognizes C4 only as the source keyword, following Pele', () => {
    expect(mermaidDiagramKind('C4Container\n  title T')).toBe('c4');
    expect(mermaidDiagramKind('flowchart LR\n  a[C4Container] --> b')).toBe('flowchart');
  });

  it('is null for front matter and init directives — the kit refuses to draw them', () => {
    // A refused source never reaches the engine,
    // so preloading its code would be a download nothing uses.
    expect(mermaidDiagramKind('---\ntitle: T\n---\nflowchart LR\n  a --> b')).toBeNull();
    expect(mermaidDiagramKind('%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n  A->>B: hi')).toBeNull();
  });

  it('is null for what is not a Mermaid source at all', () => {
    for (const code of [undefined, null, 42, {}, '', '   \n  ', '%% only a comment\n', 'hello world', 'x'.repeat(20_001)]) {
      expect(mermaidDiagramKind(code), JSON.stringify(code)?.slice(0, 20)).toBeNull();
    }
  });
});

describe('maps retained syntax kinds to the installed Pele detector', () => {
  /*
   * The table is a copy of Mermaid's detectors, so it is checked against the
   * real thing: whatever Mermaid decides for a source is what it will load,
   * and the preload must name the same kind or it downloads the wrong code.
   */

  const byMermaidId = new Map([['git', 'gitGraph'], ['quadrantChart', 'quadrant'], ['treeview', 'treeView']]);
  const detected = (code: string): string | null => {
    try { const type=detectType(code); return type ? byMermaidId.get(type) ?? type : null; } catch { return null; }
  };
  const corpus = [
    ...cases.map(([code]) => code),
    '\n\n   \t sequenceDiagram\n  A->>B: hi',
    '%% the pipeline\n%% second note\nflowchart LR\n  a --> b',
    '  %% indented note\n  sequenceDiagram\n  A->>B: hi',
    'graph TD %% top-down\n  a --> b',
    '%% note\r\nerDiagram\r\n  A ||--o{ B : has',
    '%% sequenceDiagram is next\nflowchart LR\n  a --> b',
    'not a diagram\nflowchart LR',
    'C4Container\n  title T',
    'flowchart LR\n  a[C4Container] --> b',
    'hello world',
  ];
  for (const code of corpus) {
    it(JSON.stringify(code.slice(0, 40)), () => {
      const kind=mermaidDiagramKind(code); expect(kind==='flowchart-elk'?'flowchart':kind?.startsWith('railroad-')?'railroad':kind).toBe(detected(code));
    });
  }
});

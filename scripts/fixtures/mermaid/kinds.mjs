/**
 * One small diagram of every kind Mermaid 12 draws through the kit
 * (lib/story-ui/mermaid-source MERMAID_DIAGRAMS), for the prerender fidelity
 * gate (scripts/gate-mermaid-prerender.mjs). `stored` says whether the harvest
 * keeps a drawing of it, and when it does not, why — the gate fails when a
 * kind is stored that should not be, or goes unstored without a reason here.
 */
export const MERMAID_KIND_SAMPLES = [
  { kind: 'flowchart', code: 'flowchart LR\n  A[Request] --> B[SSR HTML]\n  B --> C[Runtime JS]\n  C --> D{Hydrate?}\n  D -->|yes| E[Interactive]', stored: true },
  { kind: 'flowchart (graph, subgraph, shapes)', code: 'graph TD\n  subgraph one [Group]\n    a[(Store)] --> b{{Hex}}\n  end\n  b --> c>Flag]\n  c --> d[/Para/]\n  d --> e((Circle))', stored: true },
  { kind: 'flowchart-elk', code: 'flowchart-elk TD\n  a --> b\n  b --> c\n  a --> c', stored: true },
  { kind: 'sequence', code: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello\n  B-->>A: Hi back\n  Note over A,B: a note', stored: true },
  { kind: 'class', code: 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  Animal <|-- Dog\n  Animal *-- Leg : has', stored: true },
  { kind: 'state', code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy: start\n  state Busy {\n    [*] --> Working\n  }\n  Busy --> [*]', stored: true },
  { kind: 'er', code: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains', stored: true },
  { kind: 'pie', code: 'pie title Pets\n  "Dogs" : 40\n  "Cats" : 35\n  "Birds" : 25', stored: true },
  { kind: 'mindmap', code: 'mindmap\n  root((Root))\n    One\n      Leaf\n    Two', stored: true },
  { kind: 'architecture', code: 'architecture-beta\n  group api(cloud)[API]\n  service db(database)[Database] in api\n  service server(server)[Server] in api\n  db:L -- R:server', stored: true },
  { kind: 'gitGraph (named commits)', code: 'gitGraph\n  commit id: "one"\n  branch dev\n  commit id: "two"\n  checkout main\n  merge dev id: "three"', stored: false, why: 'sets some text in Mermaid\'s own font stack ("trebuchet ms", via --mermaid-font-family), a system face a stored drawing cannot carry' },
  { kind: 'timeline', code: 'timeline\n  title History\n  2020 : One\n  2021 : Two', stored: true },
  { kind: 'quadrant', code: 'quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]\n  B: [0.7, 0.2]', stored: true },
  { kind: 'xychart', code: 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb, mar]\n  y-axis "Revenue" 0 --> 100\n  bar [20, 50, 80]', stored: true },
  { kind: 'sankey', code: 'sankey-beta\n  A,B,10\n  A,C,5\n  B,D,7', stored: true },
  { kind: 'requirement', code: 'requirementDiagram\n  requirement r1 {\n    id: 1\n    text: the text\n    risk: high\n    verifymethod: test\n  }\n  element e1 {\n    type: sim\n  }\n  e1 - satisfies -> r1', stored: true },
  { kind: 'block', code: 'block-beta\n  columns 2\n  a b\n  c d', stored: true },
  { kind: 'packet', code: 'packet-beta\n  0-15: "Source Port"\n  16-31: "Destination Port"', stored: true },
  { kind: 'kanban', code: 'kanban\n  Todo\n    [Write]\n  Done\n    [Ship]', stored: true },
  { kind: 'c4', code: 'C4Context\n  title System\n  Person(p, "User")\n  System(s, "App")\n  Rel(p, s, "Uses")', stored: false, why: 'excluded by kind: it draws in its own font stack ("Open Sans", sans-serif), a system face a stored drawing cannot carry' },
  { kind: 'radar', code: 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}', stored: true },
  { kind: 'treemap', code: 'treemap-beta\n  "Root"\n    "A": 10\n    "B": 20', stored: true },
  { kind: 'info', code: 'info', stored: true },
  { kind: 'agentflow', code: 'agentflow-beta\n  a --> b', stored: true },
  { kind: 'ishikawa', code: 'ishikawa-beta\n  Problem\n    Cause A\n    Cause B', stored: true },
  { kind: 'venn', code: 'venn-beta\n  set A\n  set B', stored: true },
  { kind: 'treeView', code: 'treeView-beta\n  root\n    child', stored: true },
  { kind: 'wardley', code: 'wardley-beta\n  title T\n  component A [0.5, 0.5]', stored: false, why: 'names no font for its text, which each machine then sets in its default face: a stored drawing could carry none' },
  { kind: 'cynefin', code: 'cynefin-beta\n  title T', stored: false, why: 'excluded by kind: its boundaries are seeded from the page-order render id, so a stored drawing is the harvest page\'s, not the reader\'s' },
  { kind: 'gantt', code: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Task one :a1, 2024-01-01, 3d\n  Task two :after a1, 2d', stored: false, why: 'excluded by kind: its "today" line moves, a stored drawing would not' },
  { kind: 'gitGraph (generated commit ids)', code: 'gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  merge dev', stored: false, why: 'every load draws new random commit ids, so no drawing reproduces' },
  { kind: 'journey', code: 'journey\n  title My day\n  section Work\n    Code: 5: Me\n    Meet: 2: Me, You', stored: false, why: 'draws HTML labels in foreignObject, which the sanitizer refuses' },
  { kind: 'swimlane', code: 'swimlane-beta LR\n  subgraph A\n    a[One]\n  end\n  subgraph B\n    b[Two]\n  end\n  a --> b', stored: false, why: 'draws HTML labels in foreignObject, which the sanitizer refuses' },
  { kind: 'eventmodeling', code: 'eventmodeling\n  tf 01 cmd Do', stored: false, why: 'draws HTML labels in foreignObject, which the sanitizer refuses' },
];

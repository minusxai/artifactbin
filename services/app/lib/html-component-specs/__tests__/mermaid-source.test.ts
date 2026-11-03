/** af-mermaid refuses these sources before loading the renderer, with the message the element shows. */
import { expect, it } from 'vitest';
import { mermaidSourceError } from '../mermaid-source';

it('accepts a plain diagram and refuses empty, oversized, front-matter and init-directive sources', () => {
  expect(mermaidSourceError('graph TD; A-->B')).toBeNull();
  for (const code of [undefined, null, 42, '', '   \n  ']) expect(mermaidSourceError(code)).toBe('Mermaid requires a nonempty static code string.');
  expect(mermaidSourceError('x'.repeat(20_001))).toBe('Mermaid code exceeds 20000 characters.');
  for (const code of ['---\ntitle: T\n---\nflowchart LR\n  a --> b', '%%{init: {"theme": "dark"}}%%\nsequenceDiagram\n  A->>B: hi'])
    expect(mermaidSourceError(code)).toBe('Mermaid configuration directives and frontmatter are not supported; the document theme controls presentation.');
});

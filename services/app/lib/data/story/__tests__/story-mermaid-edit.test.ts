/**
 * The `<Mermaid>` inspector's lens — read the diagram's source and title out of
 * the document, write an edit back. Mirrors story-number-edit.test.ts: a prop
 * edit through updateJsxElementAtPath, guarded so a stale path, a foreign tag
 * or source the publish door would refuse can never corrupt a body.
 */
import { describe, it, expect } from 'vitest';
import { readMermaidEmbed, updateMermaidEmbedInJsx } from '@/lib/data/story/story-mermaid';

const CODE = 'flowchart TD\n  A["Draft"] --> B{Saved?}';
const SRC = `<div><p>x</p><Mermaid title="Flow" code={${JSON.stringify(CODE)}} /><Question data="$t" /></div>`;
// Paths: div=0 → [p=0.0, Mermaid=0.1, Question=0.2]
const PATH = '0.1';

describe('readMermaidEmbed', () => {
  it('reads the source and title', () => {
    expect(readMermaidEmbed(SRC, PATH)).toEqual({ code: CODE, title: 'Flow' });
  });
  it('reads a missing title as null', () => {
    expect(readMermaidEmbed('<div><Mermaid code="flowchart TD; A-->B" /></div>', '0.0')).toEqual({ code: 'flowchart TD; A-->B', title: null });
  });
  it('returns null for a non-Mermaid node, a stale path and an unparseable source', () => {
    expect(readMermaidEmbed(SRC, '0.0')).toBeNull();
    expect(readMermaidEmbed(SRC, '0.2')).toBeNull();
    expect(readMermaidEmbed(SRC, '9.9')).toBeNull();
    expect(readMermaidEmbed('<p>unterminated', PATH)).toBeNull();
  });
});

describe('updateMermaidEmbedInJsx', () => {
  it('round-trips source with quotes, braces, angle brackets, backticks and template markers', () => {
    const next = 'sequenceDiagram\n  A->>B: "hi" & <bye> `x` ${y} {z}\n  B-->>A: ok';
    const out = updateMermaidEmbedInJsx(SRC, PATH, { code: next });
    expect(readMermaidEmbed(out, PATH)).toEqual({ code: next, title: 'Flow' });
    expect(out).toContain('<p>x</p>');
    expect(out).toContain('<Question data="$t" />');
  });
  it('sets and removes the title independently of the source', () => {
    const renamed = updateMermaidEmbedInJsx(SRC, PATH, { title: 'Order pipeline' });
    expect(readMermaidEmbed(renamed, PATH)).toEqual({ code: CODE, title: 'Order pipeline' });
    const untitled = updateMermaidEmbedInJsx(SRC, PATH, { title: null });
    expect(readMermaidEmbed(untitled, PATH)).toEqual({ code: CODE, title: null });
  });
  it.each(['', '   ', '%%{init: {"theme":"dark"}}%%\nflowchart TD\nA-->B', '---\nconfig: {}\n---\nflowchart TD\nA-->B', 'x'.repeat(20_001)])(
    'refuses source the publish door would refuse, leaving the document unchanged', (code) => {
      expect(updateMermaidEmbedInJsx(SRC, PATH, { code })).toBe(SRC);
    },
  );
  it('leaves the document unchanged for a foreign tag, a stale path and an unparseable source', () => {
    expect(updateMermaidEmbedInJsx(SRC, '0.2', { code: 'flowchart TD; A-->B' })).toBe(SRC);
    expect(updateMermaidEmbedInJsx(SRC, '9.9', { code: 'flowchart TD; A-->B' })).toBe(SRC);
    expect(updateMermaidEmbedInJsx('<p>unterminated', PATH, { code: 'flowchart TD; A-->B' })).toBe('<p>unterminated');
  });
});

/**
 * A diagram with a stored drawing for the served mode needs no engine code
 * (lib/mermaid-images): lazyCodeOf names its kind only when some diagram of
 * that kind has none, and lists the stored drawings instead.
 */
import { describe, expect, it } from 'vitest';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { lazyCodeOf } from '@/lib/document/lazy-code';
import { mermaidImageKey } from '@/lib/jsx/mermaid-source';

const FLOW = 'flowchart LR\n  a --> b';
const FLOW2 = 'flowchart TD\n  c --> d';
const SEQ = 'sequenceDiagram\n  A->>B: hi';
const nodes = parseJsxOrThrow([FLOW, SEQ, FLOW2].map((code) => `<Mermaid code={${JSON.stringify(code)}} />`).join('')).nodes;
const stored = (code: string, mode: 'light' | 'dark', src: string) => ({ [mermaidImageKey(code, mode)]: { src, type: 'x', palette: 'p' } });

describe('lazyCodeOf with stored drawings', () => {
  it('without any, names every kind, as before', () => {
    expect(lazyCodeOf(nodes)).toEqual({ chart: false, mermaid: ['flowchart', 'sequence'], mermaidImages: [] });
  });
  it('names a kind only while some diagram of it has no drawing for the served mode', () => {
    const images = { ...stored(FLOW, 'light', '/f1'), ...stored(SEQ, 'light', '/s'), ...stored(FLOW2, 'dark', '/f2-dark') };
    expect(lazyCodeOf(nodes, { images, mode: 'light' })).toEqual({ chart: false, mermaid: ['flowchart'], mermaidImages: ['/f1', '/s'] });
    expect(lazyCodeOf(nodes, { images: { ...images, ...stored(FLOW2, 'light', '/f2') }, mode: 'light' })).toEqual({ chart: false, mermaid: [], mermaidImages: ['/f1', '/s', '/f2'] });
  });
  it('a drawing stored for the other mode does not stand in', () => {
    expect(lazyCodeOf(nodes, { images: stored(SEQ, 'dark', '/s-dark'), mode: 'light' }).mermaid).toContain('sequence');
  });
});

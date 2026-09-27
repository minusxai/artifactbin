/**
 * What each Mermaid kind's recorded closure CARRIES, in the real build.
 *
 * A preload that names too little leaves a round trip in place; one that names
 * too much makes every reader of a small diagram download a layout engine it
 * never runs. The three heavy dependencies are the ones that matter:
 *
 *  - elkjs (~1.4 MB): Mermaid 12's DEFAULT layout. Every kind that asks the
 *    layout registry for the configured layout draws with it — flowcharts,
 *    class, state, ER, requirement — not only `flowchart-elk`. Those kinds
 *    fetch it today and the drawing depends on it, so their closure must name
 *    it; every other kind must not.
 *  - cytoscape (~440 KB): architecture's own layout and mindmap's cose-bilkent.
 *  - @mermaid-js/parser (Langium, ~650 KB): only the kinds parsed by Langium
 *    grammars (pie, gitGraph, architecture, packet, …), never a flowchart.
 *
 * Read from the build's own evidence (lib/story-runtime/dist/story-chunk-packages.json,
 * written by scripts/build-story-runtime.mjs from esbuild's metafile), against
 * the manifest the suite's global setup builds.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { storyRuntimeAssets } from '@/lib/story/runtime-asset';
import { MERMAID_DIAGRAMS } from '@/lib/story-ui/mermaid-source';

const packages: Record<string, string[]> = JSON.parse(readFileSync(path.join(process.cwd(), 'lib/story-runtime/dist/story-chunk-packages.json'), 'utf8'));
const { mermaid, entryDeps } = storyRuntimeAssets();
const carries = (kind: string, pkg: string) => (mermaid[kind] ?? []).some((url) => packages[url]?.includes(pkg));
const kindsCarrying = (pkg: string) => MERMAID_DIAGRAMS.map((d) => d.kind).filter((kind) => carries(kind, pkg)).sort();

describe('each Mermaid kind carries only what it loads', () => {
  it('records every kind the kit declares', () => {
    expect(Object.keys(mermaid).sort()).toEqual(MERMAID_DIAGRAMS.map((d) => d.kind).sort());
  });

  it('elk is in exactly the kinds that draw with the elk layout', () => {
    const elkKinds = MERMAID_DIAGRAMS.filter((d) => d.layouts.includes('elk')).map((d) => d.kind).sort();
    expect(kindsCarrying('elkjs')).toEqual(elkKinds);
    expect(elkKinds).toEqual(expect.arrayContaining(['flowchart', 'flowchart-elk']));
  });

  it('cytoscape only for architecture and the cose-bilkent mindmap', () => {
    expect(kindsCarrying('cytoscape')).toEqual(['architecture', 'mindmap']);
  });

  it('the Langium parser only for the kinds Mermaid parses with it', () => {
    const langium = kindsCarrying('@mermaid-js/parser');
    for (const kind of ['pie', 'gitGraph', 'architecture', 'packet', 'radar', 'treemap', 'info']) expect(langium, kind).toContain(kind);
    for (const kind of ['flowchart', 'flowchart-elk', 'sequence', 'class', 'state', 'gantt', 'er', 'mindmap']) expect(langium, kind).not.toContain(kind);
  });

  it('a flowchart carries elk and neither cytoscape nor the Langium parser', () => {
    expect(carries('flowchart', 'elkjs')).toBe(true);
    expect(carries('flowchart', 'cytoscape')).toBe(false);
    expect(carries('flowchart', '@mermaid-js/parser')).toBe(false);
  });

  it('a sequence diagram or a gantt carries none of the three', () => {
    for (const kind of ['sequence', 'gantt']) {
      for (const pkg of ['elkjs', 'cytoscape', '@mermaid-js/parser']) expect(carries(kind, pkg), `${kind} ${pkg}`).toBe(false);
    }
  });

  it('no heavy Mermaid dependency leaks into the entry every hydrating document loads', () => {
    for (const pkg of ['mermaid', 'elkjs', 'cytoscape', '@mermaid-js/parser', 'katex']) {
      expect(entryDeps.filter((url) => packages[url]?.includes(pkg)), pkg).toEqual([]);
    }
  });
});

/**
 * The editing half of lib/document's interface: the node graph's ancestry and references, independent source
 * changes, node-id normalization, the client update preparation and its browser preparer (which runs in place when
 * there is no Worker, as here), and the authoring capabilities the capabilities route serves.
 */
import { describe, expect, it, vi } from 'vitest';
import { authoringCapabilities, createDocumentGraph, normalizeNodeIds, sourceChanges } from '..';
import { graphAncestors, graphReferences, graphSource, GRAPH_ROOT } from '../document-graph';
import { attachAuthoringContext, prepareClientDocument, prepareClientDocumentReplacement } from '../document-update-client';
import {
  advanceBrowserDocument, prepareBrowserDocumentUpdate, preparesOffThread, warmBrowserPreparer,
} from '../document-authoring-client';
import { applySplice } from '../splice';

const source = '<main id="root"><p id="a">Alpha</p><p id="b">Beta</p></main>';
const snapshot = (src = source, version = 1) => ({ document: createDocumentGraph(src, version), version, meta: {} });

describe('graph ancestry and references', () => {
  const graph = createDocumentGraph('<main id="m"><section id="s"><p id="p">x</p></section></main>', 1);
  const main = graph.nodes[GRAPH_ROOT]!.children[0]!;
  const section = graph.nodes[main]!.children[0]!;
  const p = graph.nodes[section]!.children[0]!;

  it('lists ancestors nearest first, ending at the root', () => {
    expect(graphAncestors(graph, p)).toEqual([section, main, GRAPH_ROOT]);
    expect(graphAncestors(graph, main)).toEqual([GRAPH_ROOT]);
    expect(graphAncestors(graph, GRAPH_ROOT)).toEqual([]);
  });

  it('throws for a missing node and for a corrupt parent chain', () => {
    expect(() => graphAncestors(graph, 'missing')).toThrow('Node does not exist');
    const cyclic = { ...graph, nodes: { ...graph.nodes, [main]: { ...graph.nodes[main]!, parent: p } } };
    expect(() => graphAncestors(cyclic, p)).toThrow('Invalid parent chain');
    const dangling = { ...graph, nodes: { ...graph.nodes, [section]: { ...graph.nodes[section]!, parent: 'gone' } } };
    expect(() => graphAncestors(dangling, p)).toThrow('Invalid parent chain');
  });

  it('references follow document order, each id once', () => {
    const refs = graphReferences(createDocumentGraph('<div><img src="ref:Bbbbbb22" /><img src="ref:Aaaaaa11" /><img src="ref:Bbbbbb22" /></div>', 1));
    expect(refs.map((r) => r.id)).toEqual(['Bbbbbb22', 'Aaaaaa11']);
    expect(refs.every((r) => typeof r.kind === 'string')).toBe(true);
    expect(graphReferences(createDocumentGraph('<p>none</p>', 1))).toEqual([]);
    expect(graphReferences(createDocumentGraph('', 1))).toEqual([]);
  });
});

describe('sourceChanges', () => {
  const a = '<div><p id="a">one</p><p id="b">two</p><p id="c">three</p></div>';
  const b = a.replace('one', 'longer one').replace('three', '3');

  it('finds independent changed subtrees whose splices, applied right to left, give the new source', () => {
    const changes = sourceChanges(a, b);
    expect(changes).toHaveLength(2);
    expect([...changes].reverse().reduce((s, c) => applySplice(s, c.splice), a)).toBe(b);
    expect(changes[0]!.splice.start).toBeLessThan(changes[1]!.splice.start);
  });

  it('answers nothing for an unchanged source', () => {
    expect(sourceChanges(a, a)).toEqual([]);
    expect(sourceChanges('', '')).toEqual([]);
  });

  it('round-trips unicode, entities and a structural change', () => {
    const before = '<div><p id="a">héllo &amp; 👩‍💻</p></div>';
    for (const after of [before.replace('héllo', 'hällo wörld'), '<div><p id="a">x</p><p id="n">new</p></div>', '<section>replaced</section>']) {
      const changes = sourceChanges(before, after);
      expect(changes.length).toBeGreaterThan(0);
      expect([...changes].reverse().reduce((s, c) => applySplice(s, c.splice), before)).toBe(after);
    }
  });
});

describe('normalizeNodeIds', () => {
  it('reports each repair beside the canonical source', () => {
    let n = 0;
    const result = normalizeNodeIds('<p id="same">A</p><p id="same">B</p>', { mint: () => `z00${++n}` });
    expect(result.source).toBe('<p id="same">A</p><p id="z001">B</p>');
    expect(result.repairs).toEqual([{
      code: 'node_id', removed: 0, path: '1', from: 'same', to: 'z001', reason: 'duplicate',
      message: 'Repaired duplicate node id at 1: same → z001. Re-read the saved file before editing.',
    }]);
  });

  it('names a missing original id, and reports nothing for clean source', () => {
    const invalid = normalizeNodeIds('<p id="">A</p>', { mint: () => 'z001' });
    expect(invalid.repairs[0]).toMatchObject({ reason: 'invalid', to: 'z001' });
    const clean = normalizeNodeIds('<p id="a1">A</p>');
    expect(clean).toEqual({ source: '<p id="a1">A</p>', repairs: [] });
    expect(normalizeNodeIds(clean.source)).toEqual(clean);
  });
});

describe('client update preparation', () => {
  it('prepares an edit and asks for authoring context only when the change needs one', () => {
    const plain = prepareClientDocument(snapshot(), { source: source.replace('Alpha', 'Gamma') });
    expect(plain.update.schema).toBe(1);
    expect(plain.context).toBeUndefined();
    const chart = prepareClientDocument(snapshot(), { source: source.replace('<p id="b">Beta</p>', '<p id="b"><Icon name="star" /></p>') });
    expect(chart.context).toContain('Icon');
  });

  it('refuses NUL, unknown metadata and invalid annotation operations', () => {
    expect(() => prepareClientDocument(snapshot(), { source: '<p id="a">a\0b</p>' })).toThrow('valid Unicode without NUL');
    expect(() => prepareClientDocument(snapshot(), { source, metadata: { theme: 'no-such-theme' } as never })).toThrow('Unknown theme');
    expect(() => prepareClientDocument(snapshot(), { source, metadata: { colorMode: 'sepia' } as never })).toThrow('Unknown color mode');
    expect(() => prepareClientDocument(snapshot(), { source, annotationOps: [{ id: 'x', kind: 'undo' }] as never })).toThrow('Invalid annotation operations');
  });

  it('records a newly written person mention, not one already there', () => {
    const mention = '<main id="root"><p id="a">Hi <a id="m" href="/people/u_1">@ada</a></p></main>';
    expect(prepareClientDocument(snapshot(), { source: mention }).update.mentions).toEqual([{ nodeId: 'm', userId: 'u_1' }]);
    expect(prepareClientDocument(snapshot(mention), { source: mention.replace('Hi', 'Hello') }).update.mentions).toBeUndefined();
  });

  it('a replacement is a whole update with no metadata guard, whatever came before', () => {
    const update = prepareClientDocumentReplacement('<p id="x">Fresh</p>', 4, { title: 'T' } as never);
    expect(update.whole).toBe(true);
    expect(update.metadata).toEqual({ title: 'T' });
    expect(update).not.toHaveProperty('expectedMetadata');
    expect(graphSource(update.replacement!)).toBe('<p id="x">Fresh</p>');
  });

  it('attachAuthoringContext resolves context only when asked, and keeps empty bindings off', async () => {
    const update = prepareClientDocument(snapshot(), { source: source.replace('Alpha', 'A2') }).update;
    const prepare = vi.fn(async () => ({ datasetBindings: [{ ref: 'r' }] }) as never);
    expect(await attachAuthoringContext({ update }, prepare)).toBe(update);
    expect(prepare).not.toHaveBeenCalled();
    const bound = await attachAuthoringContext({ update: { ...update }, context: '<Icon />' }, prepare);
    expect(prepare).toHaveBeenCalledWith('<Icon />');
    expect(bound.datasetBindings).toEqual([{ ref: 'r' }]);
    const none = await attachAuthoringContext({ update: { ...update }, context: '<Icon />' }, async () => ({ datasetBindings: [] }) as never);
    expect(none).not.toHaveProperty('datasetBindings');
  });
});

describe('browser preparer without a Worker', () => {
  it('prepares in place: not off thread, warming is a no-op', async () => {
    expect(preparesOffThread()).toBe(false);
    await expect(warmBrowserPreparer(snapshot())).resolves.toBeUndefined();
  });

  it('prepareBrowserDocumentUpdate matches the in-place preparation and calls the port only for context', async () => {
    const backend = { prepare: vi.fn(async () => ({}) as never) };
    const change = { source: source.replace('Alpha', 'Ωmega') };
    const update = await prepareBrowserDocumentUpdate(backend, snapshot(), change);
    const inPlace = prepareClientDocument(snapshot(), change).update;
    expect(update).toMatchObject({ schema: 1, effects: inPlace.effects });
    expect(Object.keys(update).sort()).toEqual(Object.keys(inPlace).sort());
    expect(backend.prepare).not.toHaveBeenCalled();
    await expect(prepareBrowserDocumentUpdate(backend, snapshot(), { source: '<p onClick="x">bad</p>' })).rejects.toThrow();
  });

  it('advanceBrowserDocument applies an accepted patch, and refuses one that does not fit', async () => {
    const base = snapshot();
    const { patch } = prepareClientDocument(base, { source: source.replace('Beta', 'Beta two') }).update;
    const advanced = await advanceBrowserDocument(base.document, 1, patch);
    expect(advanced?.source).toBe(source.replace('Beta', 'Beta two'));
    expect(graphSource(advanced!.document)).toBe(advanced!.source);
    expect(await advanceBrowserDocument(createDocumentGraph(source, 1), 1, patch)).toBeNull();
  });
});

describe('authoring capabilities', () => {
  it('pins the published contract: version, page doors, GraphQL, datasets and the skill', () => {
    expect(authoringCapabilities.version).toBe(1);
    expect(authoringCapabilities.page.update).toEqual({ method: 'PUT', path: '/api/artifacts/{id}', required: ['html', 'expectedVersion', 'expectedState'] });
    expect(authoringCapabilities.page.create).toEqual({ method: 'POST', path: '/api/artifacts' });
    expect(authoringCapabilities.graphql.path).toBe('/api/artifacts/{id}/graphql');
    expect(authoringCapabilities.dataset.modes).toEqual(['live', 'pinned']);
    expect(authoringCapabilities.skill).toEqual({ name: 'artifactbin', archive: '/skills/artifactbin.zip', guide: '/llms.txt' });
    expect(JSON.parse(JSON.stringify(authoringCapabilities))).toEqual(authoringCapabilities);
  });
});

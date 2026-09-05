import { describe, expect, it } from 'vitest';
// Unimplemented acceptance sketch from before design review; not a runnable gate.
import { indexNodeIds, stampNodeIds } from './node-ids';

const mint = (...ids: string[]) => {
  let at = 0;
  return () => ids[at++] ?? `z${String(at).padStart(3, '0')}`;
};

describe('stampNodeIds', () => {
  it('stamps every body element but never Helmet or its descendants', () => {
    const source = '<Helmet><title>One</title><style>{`p{color:red}`}</style></Helmet><main><h1>Hello</h1><Question data="$q" /></main>';
    const result = stampNodeIds(source, { mint: mint('a001', 'a002', 'a003') });

    expect(result.source).toBe('<Helmet><title>One</title><style>{`p{color:red}`}</style></Helmet><main id="a001"><h1 id="a002">Hello</h1><Question id="a003" data="$q" /></main>');
    expect(result).toMatchObject({ eligibleCount: 3, mintedCount: 3, carriedCount: 0, convertedLegacyCount: 0 });
    expect(result.repairs).toEqual([]);
  });

  it('preserves authored ids, converts lone legacy anchors, and reports authored-id aliases', () => {
    const source = '<div id="hero"><p data-annotation-anchor="old1">A</p><p id="kept" data-annotation-anchor="old2">B</p></div>';
    const compatible = stampNodeIds(source, { mint: mint('a001') });

    expect(compatible.source).toBe('<div id="hero"><p id="old1">A</p><p id="kept" data-annotation-anchor="old2">B</p></div>');
    expect(compatible.convertedLegacyCount).toBe(1);
    expect(compatible.legacyAliases).toEqual([{ legacyKey: 'old2', nodeId: 'kept', path: '0.1' }]);

    const retired = stampNodeIds(source, { mint: mint('a001'), retireLegacyAliases: true });
    expect(retired.source).toBe('<div id="hero"><p id="old1">A</p><p id="kept">B</p></div>');
    expect(retired.legacyAliases).toEqual([{ legacyKey: 'old2', nodeId: 'kept', path: '0.1' }]);
  });

  it('repairs duplicate ids deterministically without changing the first occurrence', () => {
    const result = stampNodeIds('<div id="same"><p id="same">A</p><p>B</p></div>', {
      mint: mint('same', 'a002', 'a003'),
    });

    expect(result.source).toBe('<div id="same"><p id="a002">A</p><p id="a003">B</p></div>');
    expect(result.repairs).toEqual([{ path: '0.0', previousId: 'same', nextId: 'a002', reason: 'duplicate' }]);
  });

  it('is a fixpoint and never remints a complete document', () => {
    const once = stampNodeIds('<section><p>A</p></section>', { mint: mint('a001', 'a002') });
    const twice = stampNodeIds(once.source, { previousSource: once.source, mint: mint('b001', 'b002') });

    expect(twice.source).toBe(once.source);
    expect(twice.mintedCount).toBe(0);
    expect(twice.repairs).toEqual([]);
  });

  it('carries identity through insertion, deletion, movement, and a guarded text edit', () => {
    const previous = '<main id="root"><p id="aaaa">Alpha stable paragraph</p><p id="bbbb">Beta paragraph survives editing</p><aside id="cccc">Moved note</aside></main>';
    const next = '<main><p>New introduction</p><aside>Moved note</aside><p>Beta paragraph survives a small editing change</p></main>';
    const result = stampNodeIds(next, { previousSource: previous, mint: mint('n001') });

    expect(result.source).toBe('<main id="root"><p id="n001">New introduction</p><aside id="cccc">Moved note</aside><p id="bbbb">Beta paragraph survives a small editing change</p></main>');
    expect(result).toMatchObject({ eligibleCount: 4, carriedCount: 3, mintedCount: 1 });
  });

  it('prefers an honest orphan to carrying an id onto unrelated replacement text', () => {
    const result = stampNodeIds('<div><p>Completely different words</p></div>', {
      previousSource: '<div id="root"><p id="oldp">Quarterly revenue increased strongly</p></div>',
      mint: mint('fresh'),
    });

    expect(result.source).toBe('<div id="root"><p id="fresh">Completely different words</p></div>');
    expect(result.carriedCount).toBe(1);
    expect(result.mintedCount).toBe(1);
  });

  it('leaves invalid JSX untouched for the publish validator to reject', () => {
    const result = stampNodeIds('<div><p>', { mint: mint('a001') });
    expect(result.source).toBe('<div><p>');
    expect(result.eligibleCount).toBe(0);
  });
});

describe('indexNodeIds', () => {
  it('indexes body ids and compatibility aliases, excluding Helmet', () => {
    const index = indexNodeIds('<Helmet><title id="nope">T</title></Helmet><div id="root"><p id="kept" data-annotation-anchor="old">Text</p></div>');

    expect([...index.keys()]).toEqual(['root', 'kept', 'old']);
    expect(index.get('old')).toMatchObject({ id: 'kept', legacyKey: 'old', path: '1.0' });
    expect(index.has('nope')).toBe(false);
  });
});

/**
 * storyUpdateParts — what a live update of a document carries.
 *
 * The declarations signature is the load-bearing part: it decides whether the
 * stream has to run the document's SQL again. Too sensitive and every sentence
 * an agent types costs a DuckDB run; not sensitive enough and a reader keeps
 * querying a document that no longer exists.
 */
import { describe, expect, it } from 'vitest';
import { storyUpdateParts } from '../update-parts';

const doc = (helmet: string, body: string) => `<Helmet>${helmet}</Helmet>${body}`;
const VALUE = '<Value name="region" type="string" />';
const QUERY = '<Query name="sales">{`select 1`}</Query>';

describe('storyUpdateParts', () => {
  it('returns the BODY without the Helmet — what the runtime re-renders', () => {
    const parts = storyUpdateParts(doc(VALUE, '<div><p>hello</p></div>'))!;
    expect(parts.nodes).toHaveLength(1);
    expect(parts.nodes[0]).toMatchObject({ type: 'element', tag: 'div' });
  });

  it("carries the author's own stylesheet, or null when there is none", () => {
    expect(storyUpdateParts(doc('<style>{`.a{color:red}`}</style>', '<p>x</p>'))!.authorCss).toBe('.a{color:red}');
    expect(storyUpdateParts(doc(VALUE, '<p>x</p>'))!.authorCss).toBeNull();
  });

  it('keeps the same declarations signature when only PROSE changes', () => {
    const a = storyUpdateParts(doc(VALUE + QUERY, '<p>first</p>'))!;
    const b = storyUpdateParts(doc(VALUE + QUERY, '<p>second, and much longer</p>'))!;
    expect(b.declarations).toBe(a.declarations);
  });

  it('keeps it stable when the declarations merely MOVE in the source', () => {
    // The Helmet may be authored anywhere (it is hoisted at the door), so text
    // BEFORE it shifts every declaration's offsets without changing one of them.
    const a = storyUpdateParts(`<p>x</p><Helmet>${VALUE}${QUERY}</Helmet>`)!;
    const b = storyUpdateParts(`<p>a far longer paragraph, which moves everything after it</p><Helmet>${VALUE}${QUERY}</Helmet>`)!;
    expect(b.declarations).toBe(a.declarations);
  });

  it('changes when a Value is added, renamed, retyped or removed', () => {
    const base = storyUpdateParts(doc(VALUE, '<p>x</p>'))!.declarations;
    expect(storyUpdateParts(doc(VALUE + '<Value name="era" type="string" />', '<p>x</p>'))!.declarations).not.toBe(base);
    expect(storyUpdateParts(doc('<Value name="area" type="string" />', '<p>x</p>'))!.declarations).not.toBe(base);
    expect(storyUpdateParts(doc('<Value name="region" type="number" />', '<p>x</p>'))!.declarations).not.toBe(base);
    expect(storyUpdateParts(doc('', '<p>x</p>'))!.declarations).not.toBe(base);
  });

  it("changes when a Query's SQL changes", () => {
    const a = storyUpdateParts(doc(QUERY, '<p>x</p>'))!.declarations;
    const b = storyUpdateParts(doc('<Query name="sales">{`select 2`}</Query>', '<p>x</p>'))!.declarations;
    expect(b).not.toBe(a);
  });

  it('applies the same nesting repair the served document does', () => {
    // <p> cannot hold a <div>: the parser would close the paragraph and the
    // update would describe a different tree than a reload.
    const parts = storyUpdateParts('<p className="lede"><div>inner</div></p>')!;
    expect(parts.nodes[0]).toMatchObject({ type: 'element', tag: 'div' });
  });

  it('returns null for source that does not parse, rather than throwing', () => {
    expect(storyUpdateParts('<div><p>unclosed')).toBeNull();
  });

  it('carries the declarations themselves — the runtime has no parser to recover them', () => {
    const parts = storyUpdateParts(doc(VALUE + QUERY, '<p>x</p>'))!;
    expect(parts.flow.values.map((v) => v.name)).toEqual(['region']);
    expect(parts.flow.queries.map((q) => q.name)).toEqual(['sales']);
    expect(storyUpdateParts('<p>no helmet</p>')!.flow).toEqual({ values: [], queries: [] });
  });

  it('handles a document with no Helmet at all', () => {
    const parts = storyUpdateParts('<div><h1>Title</h1></div>')!;
    expect(parts.authorCss).toBeNull();
    expect(parts.nodes).toHaveLength(1);
    expect(parts.declarations).toBe(storyUpdateParts('<div><h2>Other</h2></div>')!.declarations);
  });
});

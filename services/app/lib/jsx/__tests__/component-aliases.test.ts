// THE ONE ALIAS POINT for the data components' earlier names: `<Question>` is `<Chart>` and `<Number>` is `<Cell>`.
// The parser canonicalises the tag, so every consumer of the tree sees one name, and keeps what the author wrote,
// so nothing that writes the source back (serialize, the in-place id stamp, the document graph) renames a stored
// document. A stored tree (the document graph, a prepared page) revived without a parse is canonicalised the same way.
import { describe, expect, it } from 'vitest';
import { canonicalComponent, canonicalNodes, COMPONENT_ALIASES } from '../component-names';
import { parseJsx } from '../parse';
import { serializeJsx } from '../serialize';
import { validateJsxSource } from '..';
import { JSX_STORY_COMPONENT_NAMES } from '../components';
import type { JsxElement, JsxNode } from '../types';

const nodesOf = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};
const first = (source: string): JsxElement => nodesOf(source).find((n): n is JsxElement => n.type === 'element')!;

describe('the data components\' earlier names', () => {
  it('names exactly Question → Chart and Number → Cell, and nothing else', () => {
    expect(COMPONENT_ALIASES).toEqual({ Question: 'Chart', Number: 'Cell' });
    expect(canonicalComponent('Question')).toBe('Chart');
    expect(canonicalComponent('Number')).toBe('Cell');
    expect(canonicalComponent('Chart')).toBe('Chart');
    expect(canonicalComponent('DataTable')).toBe('DataTable');
    expect(canonicalComponent('constructor')).toBe('constructor');
    expect(canonicalComponent('toString')).toBe('toString');
  });

  it('registers the new names, and the old ones only as aliases', () => {
    expect(JSX_STORY_COMPONENT_NAMES).toEqual(expect.arrayContaining(['Chart', 'Cell', 'DataTable']));
    expect(JSX_STORY_COMPONENT_NAMES).not.toContain('Question');
    expect(JSX_STORY_COMPONENT_NAMES).not.toContain('Number');
  });

  it('parses an old name to the canonical tag and remembers how the author spelled it', () => {
    const chart = first('<Question data="$q" viz={{"kind":"vega-lite","spec":{"mark":"bar"}}} />');
    expect(chart.tag).toBe('Chart');
    expect(chart.authoredTag).toBe('Question');
    const cell = first('<p>Total <Number data="$q" col="v" /></p>').children.find((n): n is JsxElement => n.type === 'element')!;
    expect(cell.tag).toBe('Cell');
    expect(cell.authoredTag).toBe('Number');
  });

  it('carries no spelling for the new names: the tag is what was written', () => {
    const chart = first('<Chart data="$q" />');
    expect(chart.tag).toBe('Chart');
    expect(chart).not.toHaveProperty('authoredTag');
    expect(first('<Cell data="$q" />')).not.toHaveProperty('authoredTag');
  });

  it('serializes what the author wrote, so an edit never renames a stored document', () => {
    const source = '<div><Question data="$q" title="Sales">{``}</Question><p>Up <Number data="$q" col="v" format=",.0f" /> today</p><Chart data="$q" /><Cell data="$q" /></div>';
    const out = serializeJsx(nodesOf(source));
    expect(out).toContain('<Question data="$q" title="Sales">');
    expect(out).toContain('</Question>');
    expect(out).toContain('<Number data="$q" col="v" format=",.0f" />');
    expect(out).toContain('<Chart data="$q" />');
    expect(out).toContain('<Cell data="$q" />');
    expect(out).not.toMatch(/<Chart data="\$q" title/);
  });

  it('validates both spellings against the registry', () => {
    for (const source of ['<Question data="$q" />', '<Chart data="$q" />', '<Number data="$q" />', '<Cell data="$q" />']) {
      expect(validateJsxSource(source, JSX_STORY_COMPONENT_NAMES)).toEqual([]);
    }
    // A caller that still lists an old name allows the component under either spelling.
    expect(validateJsxSource('<Chart data="$q" />', ['Question'])).toEqual([]);
  });

  it('returns the same array when a stored tree names nothing old', () => {
    const nodes = nodesOf('<div><Chart data="$q" /></div>');
    expect(canonicalNodes(nodes)).toBe(nodes);
    const old = JSON.parse(JSON.stringify(nodesOf('<div />'))) as JsxNode[];
    (old[0] as JsxElement).children.push({ type: 'element', tag: 'Number', isComponent: true, attributes: [], children: [], selfClosing: true, start: 0, end: 0 });
    const revived = canonicalNodes(old);
    expect(revived).not.toBe(old);
    expect(((revived[0] as JsxElement).children[0] as JsxElement)).toMatchObject({ tag: 'Cell', authoredTag: 'Number' });
  });
});

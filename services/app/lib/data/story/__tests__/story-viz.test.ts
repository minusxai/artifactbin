/**
 * The chart editor's write-back.
 *
 * Editing a chart is a PROP edit on a component — the same machinery that moves
 * a <GridItem> or rewrites a <Number>'s query. What is specific here is that
 * `viz` carries an object, that clearing it is meaningful (a Question with no
 * viz renders a table), and that `data` must keep its `$` prefix — a bare name
 * resolves to nothing and renders an empty chart, which is precisely the
 * mistake a UI exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { updateQuestionVizInJsx, updateQuestionDataInJsx, updateQuestionChartInJsx, updateQuestionTitleInJsx, readQuestionChart, questionTable, DYNAMIC_VIZ } from '../story-viz';

const BAR = { kind: 'vega-lite', spec: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } };
const LINE = { kind: 'vega-lite', spec: { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'sales', type: 'quantitative' } } } };

const doc = (inner: string) => `<div data-design="tw" className="p-4">${inner}</div>`;
/** The Question is the first child of the root div. */
const PATH = '0.0';

/** Read an attribute's parsed value back out of a serialized body. */
function attrOf(source: string, name: string): unknown {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('source did not parse');
  const stack = [...parsed.nodes];
  while (stack.length) {
    const n = stack.shift()!;
    if (n.type === 'element') {
      if (n.tag === 'Question') {
        const v = n.attributes.find((a) => a.name === name)?.value;
        return v && v.static ? v.json : undefined;
      }
      stack.push(...n.children);
    }
  }
  return undefined;
}

describe('updateQuestionVizInJsx', () => {
  it('sets a viz envelope on a Question that had none', () => {
    const out = updateQuestionVizInJsx(doc('<Question title="t" data="$sales" />'), PATH, BAR);
    expect(attrOf(out, 'viz')).toEqual(BAR);
  });

  it('replaces an existing envelope rather than appending a second prop', () => {
    const before = doc(`<Question title="t" data="$sales" viz={${JSON.stringify(BAR)}} />`);
    const out = updateQuestionVizInJsx(before, PATH, LINE);
    expect(attrOf(out, 'viz')).toEqual(LINE);
    expect(out.match(/viz=/g)).toHaveLength(1);
  });

  it('REMOVES the prop when given undefined — a Question with no viz is a table', () => {
    const before = doc(`<Question title="t" data="$sales" viz={${JSON.stringify(BAR)}} />`);
    const out = updateQuestionVizInJsx(before, PATH, undefined);
    expect(attrOf(out, 'viz')).toBeUndefined();
    expect(out).not.toContain('viz=');
  });

  it('leaves the rest of the document untouched', () => {
    const before = doc('<h1 className="text-3xl">Title</h1><Question title="t" data="$sales" />');
    const out = updateQuestionVizInJsx(before, '0.1', BAR);
    expect(out).toContain('<h1 className="text-3xl">Title</h1>');
    expect(out).toContain('title="t"');
    expect(out).toContain('data="$sales"');
  });

  it('round-trips through the parser — the written value is real JSX, not a string', () => {
    const out = updateQuestionVizInJsx(doc('<Question data="$sales" />'), PATH, BAR);
    expect(parseJsx(out).ok).toBe(true);
    expect((attrOf(out, 'viz') as typeof BAR).spec.encoding.y.type).toBe('quantitative');
  });
});

describe('staleness and hostile paths never corrupt the body', () => {
  const before = doc('<Question title="t" data="$sales" />');

  it('leaves the source unchanged for a path that does not resolve', () => {
    expect(updateQuestionVizInJsx(before, '9.9.9', BAR)).toBe(before);
  });

  it('refuses a path that resolves to something other than a Question', () => {
    const mixed = doc('<h1 className="x">T</h1><Question data="$sales" />');
    expect(updateQuestionVizInJsx(mixed, '0.0', BAR)).toBe(mixed); // 0.0 is the h1
  });

  it('leaves an unparseable source alone', () => {
    const broken = '<div className="p-4"><Question ';
    expect(updateQuestionVizInJsx(broken, PATH, BAR)).toBe(broken);
  });

  it('never throws on nonsense input', () => {
    expect(() => updateQuestionVizInJsx('', '', BAR)).not.toThrow();
    expect(() => updateQuestionDataInJsx('', '', 'sales')).not.toThrow();
  });
});

describe('updateQuestionDataInJsx', () => {
  it('points the Question at another declared table, adding the $ prefix', () => {
    const out = updateQuestionDataInJsx(doc('<Question data="$sales" />'), PATH, 'top');
    expect(attrOf(out, 'data')).toBe('$top');
  });

  it('does not double the prefix when the caller already supplied it', () => {
    const out = updateQuestionDataInJsx(doc('<Question data="$sales" />'), PATH, '$top');
    expect(attrOf(out, 'data')).toBe('$top');
  });

  it('sets data on a Question that had none', () => {
    const out = updateQuestionDataInJsx(doc('<Question title="t" />'), PATH, 'nine');
    expect(attrOf(out, 'data')).toBe('$nine');
  });

  it('ignores an empty id rather than writing a broken ref', () => {
    const before = doc('<Question data="$sales" />');
    expect(updateQuestionDataInJsx(before, PATH, '   ')).toBe(before);
  });

  it('UNBINDS on null — the picker offers "no table", and it has to mean it', () => {
    // Whitespace is a slip; null is a decision. Treating them the same left the
    // stale ref in the document while the UI showed the Question as unbound.
    const out = updateQuestionDataInJsx(doc('<Question data="$sales" />'), PATH, null);
    expect(attrOf(out, 'data')).toBeUndefined();
  });
});

describe('updateQuestionChartInJsx — the one call the editor makes', () => {
  it('writes the table and the chart together', () => {
    const out = updateQuestionChartInJsx(doc('<Question title="t" />'), PATH, { viz: BAR, table: 'nine' });
    expect(attrOf(out, 'data')).toBe('$nine');
    expect(attrOf(out, 'viz')).toEqual(BAR);
  });

  it('clears both — "table, no data" is a state a user can choose', () => {
    const out = updateQuestionChartInJsx(doc('<Question data="$sales" viz={' + JSON.stringify(BAR) + '} />'), PATH, { viz: undefined, table: null });
    expect(attrOf(out, 'viz')).toBeUndefined();
    expect(attrOf(out, 'data')).toBeUndefined();
  });

  it('changes only the chart, leaving the binding alone', () => {
    const before = doc('<Question data="$sales" viz={' + JSON.stringify(BAR) + '} />');
    const out = updateQuestionChartInJsx(before, PATH, { viz: LINE, table: 'sales' });
    expect(attrOf(out, 'data')).toBe('$sales');
    expect(attrOf(out, 'viz')).toEqual(LINE);
  });

  it('leaves a stale path alone — a remounted canvas must not corrupt a body', () => {
    const before = doc('<Question data="$sales" />');
    expect(updateQuestionChartInJsx(before, '9.9', { viz: BAR, table: 'top' })).toBe(before);
  });

  it('keeps the props it was not asked about', () => {
    const out = updateQuestionChartInJsx(doc('<Question title="Revenue" height={320} data="$sales" />'), PATH, { viz: BAR, table: 'sales' });
    expect(attrOf(out, 'title')).toBe('Revenue');
    expect(attrOf(out, 'height')).toBe(320);
  });
});

describe('readQuestionChart — what the panel renders from', () => {
  it('reads the chart, its table and its title off the selected Question', () => {
    const out = readQuestionChart(doc(`<Question title="Revenue" data="$sales" viz={${JSON.stringify(BAR)}} />`), PATH);
    expect(out).toEqual({ viz: BAR, table: 'sales', title: 'Revenue' });
  });

  it('reports a Question with none of them as an empty, editable state', () => {
    expect(readQuestionChart(doc('<Question />'), PATH)).toEqual({ viz: undefined, table: null, title: null });
  });

  it('reads a DYNAMIC title as null rather than a stringified expression', () => {
    expect(readQuestionChart(doc('<Question title={titleFor(x)} />'), PATH)?.title).toBeNull();
  });

  it('returns null when the path is not a Question — there is nothing to edit', () => {
    expect(readQuestionChart(doc('<h1 className="x">T</h1>'), PATH)).toBeNull();
    expect(readQuestionChart(doc('<Question />'), '9.9')).toBeNull();
    expect(readQuestionChart('<div className="p-4"><Question ', PATH)).toBeNull();
  });

  it('reports a DYNAMIC viz as unreadable rather than guessing at it', () => {
    // `viz={someExpression}` is not a value this editor can round-trip; the panel
    // must show "not editable" rather than replace an expression with a literal.
    const out = readQuestionChart(doc('<Question data="$sales" viz={vizFor(x)} />'), PATH);
    expect(out).toEqual({ viz: DYNAMIC_VIZ, table: 'sales', title: null });
  });

  it('round-trips with the writer', () => {
    const written = updateQuestionChartInJsx(doc('<Question title="t" />'), PATH, { viz: LINE, table: 'seven' });
    expect(readQuestionChart(written, PATH)).toEqual({ viz: LINE, table: 'seven', title: 't' });
  });
});

describe('updateQuestionTitleInJsx — the header strip is a prop like any other', () => {
  it('renames the Question', () => {
    const out = updateQuestionTitleInJsx(doc('<Question title="t" data="$sales" />'), PATH, 'Revenue');
    expect(attrOf(out, 'title')).toBe('Revenue');
    expect(attrOf(out, 'data')).toBe('$sales'); // everything else untouched
  });

  it('sets a title on a Question that had none', () => {
    expect(attrOf(updateQuestionTitleInJsx(doc('<Question />'), PATH, 'Revenue'), 'title')).toBe('Revenue');
  });

  it('REMOVES the prop on null — no title means no header strip, not an empty one', () => {
    const out = updateQuestionTitleInJsx(doc('<Question title="t" />'), PATH, null);
    expect(attrOf(out, 'title')).toBeUndefined();
    expect(out).not.toContain('title=');
  });

  it('treats a whitespace-only title as removal', () => {
    expect(attrOf(updateQuestionTitleInJsx(doc('<Question title="t" />'), PATH, '   '), 'title')).toBeUndefined();
  });

  it('leaves a stale path alone', () => {
    const before = doc('<Question title="t" />');
    expect(updateQuestionTitleInJsx(before, '9.9', 'Revenue')).toBe(before);
  });
});

describe('questionTable', () => {
  it('reads the table name out of a $reference', () => {
    expect(questionTable('$sales')).toBe('sales');
    expect(questionTable('  $sales  ')).toBe('sales');
  });

  it('returns null for anything that is not a reference (including the retired ref: form)', () => {
    expect(questionTable('sales')).toBeNull();
    expect(questionTable('ref:dsOne01')).toBeNull();
    expect(questionTable(undefined)).toBeNull();
    expect(questionTable({})).toBeNull();
    expect(questionTable('$')).toBeNull();
  });
});

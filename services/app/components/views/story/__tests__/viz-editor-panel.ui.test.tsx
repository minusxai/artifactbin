/**
 * The chart editor panel.
 *
 * It is a lens, not a form: every interaction must emit a complete new `viz`
 * prop, because the document is the source of truth and the panel keeps no copy
 * that could drift from it. The cases below are the ones where a chart goes
 * quietly wrong rather than visibly broken — a measure on a text column, a
 * chart type change that drops the fields, "table" not actually clearing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VizEditorPanel from '../VizEditorPanel';

const COLUMNS = [
  { name: 'region', type: 'string' as const },
  { name: 'revenue', type: 'number' as const },
  { name: 'month', type: 'date' as const },
];
const TABLES = [
  { name: 'sales', kind: 'query' as const, columns: COLUMNS },
  { name: 'costs', kind: 'query' as const, columns: [{ name: 'item', type: 'string' as const }] },
];
const BAR = {
  kind: 'vega-lite',
  spec: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } },
};

type ChartChange = { viz: unknown; table: string | null };
let onChange: ReturnType<typeof vi.fn<(next: ChartChange) => void>>;
let onTitleChange: ReturnType<typeof vi.fn<(title: string | null) => void>>;
beforeEach(() => {
  onChange = vi.fn<(next: ChartChange) => void>();
  onTitleChange = vi.fn<(title: string | null) => void>();
});

const panel = (props: Partial<React.ComponentProps<typeof VizEditorPanel>> = {}) =>
  render(<VizEditorPanel viz={BAR} table="sales" tables={TABLES} title="posts by month" onChange={onChange} onTitleChange={onTitleChange} {...props} />);

const last = () => onChange.mock.calls.at(-1)![0];
const enc = (viz: unknown) => (viz as { spec: { encoding: Record<string, { field: string; type: string }> } }).spec.encoding;

/** Drive the house SelectMenu: open the labelled trigger, click the named option. */
const pick = (label: string, option: string | RegExp) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const triggerText = (label: string) => screen.getByLabelText(label).textContent ?? '';

describe('reading the current state', () => {
  it('shows the bound table, chart type and field per axis', () => {
    panel();
    expect(triggerText('Table')).toContain('$sales');
    expect(triggerText('Chart type')).toContain('bar');
    expect(triggerText('X-Axis')).toContain('region');
    expect(triggerText('Y-Axis')).toContain('revenue');
  });

  it('offers each column with its type, so a measure is recognisable', () => {
    panel();
    fireEvent.click(screen.getByLabelText('Y-Axis'));
    const list = screen.getByRole('listbox').textContent ?? '';
    expect(list).toContain('revenue · number');
    expect(list).toContain('region · string');
  });

  it('puts numeric columns FIRST on a measure axis', () => {
    panel();
    fireEvent.click(screen.getByLabelText('Y-Axis'));
    const opts = screen.getAllByRole('option').map((o) => o.textContent ?? '').filter((t) => !t.includes('none'));
    expect(opts[0]).toContain('revenue'); // a quantitative encoding over text renders a flat scale
  });
});

describe('editing', () => {
  it('changes a field and keeps the other axis', () => {
    panel();
    pick('X-Axis', /month/);
    expect(enc(last().viz).x.field).toBe('month');
    expect(enc(last().viz).y.field).toBe('revenue');
  });

  it('assigns the right vega TYPE from the table column type', () => {
    panel();
    pick('X-Axis', /month/);
    expect(enc(last().viz).x.type).toBe('temporal'); // date → temporal, not nominal
  });

  it('clears an axis', () => {
    panel();
    pick('Y-Axis', '— none —');
    expect(enc(last().viz).y).toBeUndefined();
  });

  it('changes chart type without losing the fields', () => {
    panel();
    pick('Chart type', 'line');
    expect((last().viz as { spec: { mark: unknown } }).spec.mark).toBeTruthy();
    expect(enc(last().viz).x.field).toBe('region');
  });

  it('choosing "table" CLEARS the viz, rather than writing an empty chart', () => {
    // A Question with no viz renders the themed table; an empty spec would draw
    // an empty chart frame, which reads as broken.
    panel();
    pick('Chart type', 'table');
    expect(last().viz).toBeUndefined();
  });

  it('rebinds to a different table, keeping the chart', () => {
    panel();
    pick('Table', '$costs');
    expect(last().table).toBe('costs');
    expect(enc(last().viz).x.field).toBe('region');
  });

  it('can unbind the table', () => {
    panel();
    pick('Table', '— pick a table —');
    expect(last().table).toBeNull();
  });
});

describe('the empty states', () => {
  it('builds a chart from a Question that had none', () => {
    // The panel is CONTROLLED: it emits and the document owns the state, so a
    // real parent re-renders it with the new value. Driving it any other way
    // would be testing a component we do not ship.
    const { rerender } = panel({ viz: undefined });
    expect(triggerText('Chart type')).toContain('table');
    pick('Chart type', 'bar');
    rerender(<VizEditorPanel viz={last().viz} table="sales" tables={TABLES} title={null} onChange={onChange} onTitleChange={onTitleChange} />);
    pick('X-Axis', /region/);
    expect(enc(last().viz).x.field).toBe('region');
  });

  it('disables the field pickers and says why when no table is bound', () => {
    panel({ table: null });
    expect((screen.getByLabelText('X-Axis') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByLabelText('No table notice')).toBeTruthy();
  });

  it('says the bound table is not declared rather than showing the Question as unbound', () => {
    // The document still says data="$gone". Falling back to the "pick a
    // table" placeholder would claim the chart has no binding — and the next
    // edit would then write that lie into the source.
    panel({ table: 'gone' });
    expect(triggerText('Table')).toContain('$gone');
    expect(screen.getByLabelText('Missing table notice')).toBeTruthy();
  });

  it('a declared query whose columns are not known yet keeps its binding and offers no fields', () => {
    // A query typed a moment ago has not run: the shelf lists it (so the
    // binding is honest), the field pickers just have nothing to offer yet.
    panel({ table: 'fresh', tables: [...TABLES, { name: 'fresh', kind: 'query', columns: [] }] });
    expect(triggerText('Table')).toContain('$fresh');
    expect(screen.queryByLabelText('Missing table notice')).toBeNull();
  });

  it('offers NO spec surface over a DYNAMIC viz — an expression cannot round-trip', () => {
    // `viz={pick(mode)}` reads as the {kind:'dynamic'} sentinel. Showing that
    // sentinel in the spec box invites an apply that writes the sentinel itself
    // into the document, replacing the author's expression with a frozen lie.
    panel({ viz: { kind: 'dynamic' } });
    expect(screen.getByLabelText('Chart not editable')).toBeTruthy();
    expect(screen.queryByLabelText('Chart spec')).toBeNull();
    expect(screen.getByLabelText('Chart title')).toBeTruthy(); // the title is still just a prop
  });

  it('shows a hand-written chart as editable JSON instead of the zone selects', () => {
    // The zones cannot safely rewrite a recipe, but the raw surface can: the
    // whole prop is right there, and an edit replaces it wholesale.
    panel({ viz: { kind: 'recipe', recipe: 'ref:rcp9zz' } });
    expect(screen.queryByLabelText('Chart type')).toBeNull();
    const box = screen.getByLabelText('Chart spec') as HTMLTextAreaElement;
    expect(JSON.parse(box.value)).toEqual({ kind: 'recipe', recipe: 'ref:rcp9zz' });
    fireEvent.change(box, { target: { value: JSON.stringify({ kind: 'recipe', recipe: 'ref:other1' }) } });
    fireEvent.click(screen.getByLabelText('Apply chart spec'));
    expect(last().viz).toEqual({ kind: 'recipe', recipe: 'ref:other1' });
  });
});

describe('a complex spec the pickers cannot classify', () => {
  // The user's layered scatter+trend spec. getVizType cannot name it, and the
  // dropdown used to claim "table" — so the next interaction WROTE table over
  // the author's chart. The pickers stay out of the way; the spec box remains.
  const LAYERED = {
    kind: 'vega-lite',
    spec: {
      layer: [
        { mark: { type: 'circle' }, encoding: { x: { field: 'score', type: 'quantitative' }, y: { field: 'comments', type: 'quantitative' } } },
        { mark: { type: 'line' }, encoding: { x: { field: 'score', type: 'quantitative' }, y: { field: 'fitted', type: 'quantitative' } } },
      ],
    },
  };

  it('hides the chart type dropdown and the zone selects', () => {
    panel({ viz: LAYERED });
    expect(screen.queryByLabelText('Chart type')).toBeNull();
    expect(screen.queryByLabelText('X-Axis')).toBeNull();
    expect(screen.getByLabelText('Custom chart notice')).toBeTruthy();
  });

  it('keeps the table binding editable', () => {
    panel({ viz: LAYERED });
    pick('Table', '$costs');
    expect(last().table).toBe('costs');
    expect(last().viz).toEqual(LAYERED); // rebinding must not touch the spec
  });

  it('applies a spec edit as a CHART, never clearing it to a table', () => {
    panel({ viz: LAYERED });
    const next = { ...LAYERED.spec, title: 'edited' };
    fireEvent.change(screen.getByLabelText('Chart spec'), { target: { value: JSON.stringify(next) } });
    fireEvent.click(screen.getByLabelText('Apply chart spec'));
    expect((last().viz as { spec: unknown }).spec).toEqual(next);
  });

  it('an unrecognized unit mark is also left to the spec box', () => {
    panel({ viz: { kind: 'vega-lite', spec: { mark: 'circle', encoding: { x: { field: 'score', type: 'quantitative' } } } } });
    expect(screen.queryByLabelText('Chart type')).toBeNull();
    expect(screen.getByLabelText('Chart spec')).toBeTruthy();
  });
});

describe('the title', () => {
  it('shows the current title', () => {
    panel();
    expect((screen.getByLabelText('Chart title') as HTMLInputElement).value).toBe('posts by month');
  });

  it('commits a rename on blur, without touching the chart', () => {
    panel();
    const input = screen.getByLabelText('Chart title');
    fireEvent.change(input, { target: { value: 'Launches per month' } });
    expect(onTitleChange).not.toHaveBeenCalled(); // typing is not yet an edit
    fireEvent.blur(input);
    expect(onTitleChange).toHaveBeenCalledWith('Launches per month');
    expect(onChange).not.toHaveBeenCalled(); // a rename must never rewrite viz/data
  });

  it('commits on Enter', () => {
    panel();
    const input = screen.getByLabelText('Chart title');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onTitleChange).toHaveBeenCalledWith('Renamed');
  });

  it('clearing the field removes the title (null, not empty string)', () => {
    panel();
    const input = screen.getByLabelText('Chart title');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onTitleChange).toHaveBeenCalledWith(null);
  });

  it('does not emit when nothing changed', () => {
    panel();
    fireEvent.blur(screen.getByLabelText('Chart title'));
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it('re-seeds from the document when the title changes outside the field', () => {
    const { rerender } = panel();
    rerender(<VizEditorPanel viz={BAR} table="sales" tables={TABLES} title="Renamed elsewhere" onChange={onChange} onTitleChange={onTitleChange} />);
    expect((screen.getByLabelText('Chart title') as HTMLInputElement).value).toBe('Renamed elsewhere');
  });

  it('is present for a hand-written chart too — the title is not part of the viz', () => {
    panel({ viz: { kind: 'recipe', recipe: 'ref:rcp9zz' } });
    const input = screen.getByLabelText('Chart title');
    fireEvent.change(input, { target: { value: 'Still renameable' } });
    fireEvent.blur(input);
    expect(onTitleChange).toHaveBeenCalledWith('Still renameable');
  });
});

describe('the raw spec surface', () => {
  it('shows the whole spec as JSON, with apply parked until it changes', () => {
    panel();
    const box = screen.getByLabelText('Chart spec') as HTMLTextAreaElement;
    expect(JSON.parse(box.value)).toEqual(BAR.spec);
    expect((screen.getByLabelText('Apply chart spec') as HTMLButtonElement).disabled).toBe(true);
  });

  it('applies an edited spec wholesale, keeping the table binding', () => {
    panel();
    const next = { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' } } };
    fireEvent.change(screen.getByLabelText('Chart spec'), { target: { value: JSON.stringify(next) } });
    fireEvent.click(screen.getByLabelText('Apply chart spec'));
    expect((last().viz as { spec: typeof next }).spec).toEqual(next);
    expect(last().table).toBe('sales');
  });

  it('rejects invalid JSON with an error and emits nothing', () => {
    panel();
    fireEvent.change(screen.getByLabelText('Chart spec'), { target: { value: '{nope' } });
    fireEvent.click(screen.getByLabelText('Apply chart spec'));
    expect(screen.getByLabelText('Chart spec error')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects JSON that is not an object', () => {
    panel();
    fireEvent.change(screen.getByLabelText('Chart spec'), { target: { value: '42' } });
    fireEvent.click(screen.getByLabelText('Apply chart spec'));
    expect(screen.getByLabelText('Chart spec error')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('re-seeds from the document when an edit lands outside the box', () => {
    // A zone select rewrites the spec; a stale draft would then quietly revert
    // that change on the next apply.
    const { rerender } = panel();
    pick('X-Axis', /month/);
    rerender(<VizEditorPanel viz={last().viz} table="sales" tables={TABLES} title={null} onChange={onChange} onTitleChange={onTitleChange} />);
    const box = screen.getByLabelText('Chart spec') as HTMLTextAreaElement;
    expect(JSON.parse(box.value).encoding.x.field).toBe('month');
  });

  it('an emptied spec clears the chart back to a table', () => {
    panel();
    fireEvent.change(screen.getByLabelText('Chart spec'), { target: { value: '{}' } });
    fireEvent.click(screen.getByLabelText('Apply chart spec'));
    expect(last().viz).toBeUndefined();
  });
});

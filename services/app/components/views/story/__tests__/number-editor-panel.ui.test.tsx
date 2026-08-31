/**
 * The `<Number>` editor panel — the chart inspector's sibling for inline
 * figures. A lens like VizEditorPanel: every interaction emits a PARTIAL edit
 * (only the field that changed) — the document stays the source of truth.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NumberEditorPanel from '../NumberEditorPanel';
import type { NumberEmbedEdit } from '@/lib/data/story/story-number';

const COLUMNS = [
  { name: 'region', type: 'string' as const },
  { name: 'revenue', type: 'number' as const },
];
const TABLES = [
  { name: 'sales', kind: 'query' as const, columns: COLUMNS },
  { name: 'costs', kind: 'query' as const, columns: [{ name: 'spend', type: 'number' as const }] },
];
const BOUND = {
  table: 'sales', col: 'revenue', agg: 'sum',
  prefix: '$', suffix: null, format: null,
};
const UNBOUND = { ...BOUND, table: null, col: 'v', agg: null, prefix: null };

let onChange: ReturnType<typeof vi.fn<(edit: NumberEmbedEdit) => void>>;
beforeEach(() => { onChange = vi.fn<(edit: NumberEmbedEdit) => void>(); });

const panel = (props: Partial<React.ComponentProps<typeof NumberEditorPanel>> = {}) =>
  render(<NumberEditorPanel binding={BOUND} tables={TABLES} onChange={onChange} {...props} />);

const last = () => onChange.mock.calls.at(-1)![0];
/** Drive the house SelectMenu: open the labelled trigger, click the named option. */
const pick = (label: string, option: string | RegExp) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(screen.getByRole('option', { name: option }));
};
const triggerText = (label: string) => screen.getByLabelText(label).textContent ?? '';

describe('reading the current state', () => {
  it('shows the bound table, column and aggregation', () => {
    panel();
    expect(triggerText('Table')).toContain('$sales');
    expect(triggerText('Column')).toContain('revenue');
    expect(triggerText('Aggregation')).toContain('sum');
    expect((screen.getByLabelText('Number prefix') as HTMLInputElement).value).toBe('$');
  });

  it('offers columns with their type, numeric first', () => {
    panel();
    fireEvent.click(screen.getByLabelText('Column'));
    const opts = screen.getAllByRole('option').map((o) => o.textContent ?? '').filter((t) => !t.includes('first column'));
    expect(opts[0]).toContain('revenue'); // a figure wants a measure
    expect(opts[0]).toContain('number');
  });
});

describe('editing', () => {
  it('a column pick emits ONLY the column', () => {
    panel();
    pick('Column', /region/);
    expect(last()).toEqual({ col: 'region' });
  });

  it('a table pick emits ONLY the table', () => {
    panel();
    pick('Table', /costs/);
    expect(last()).toEqual({ table: 'costs' });
  });

  it('an aggregation pick emits it — and "first" (the default) emits null to drop the attr', () => {
    panel();
    pick('Aggregation', /avg/);
    expect(last()).toEqual({ agg: 'avg' });
    pick('Aggregation', /first/);
    expect(last()).toEqual({ agg: null });
  });

  it('prefix/suffix/format commit on blur, emptied fields as null', () => {
    panel();
    const prefix = screen.getByLabelText('Number prefix') as HTMLInputElement;
    fireEvent.change(prefix, { target: { value: '€' } });
    fireEvent.blur(prefix);
    expect(last()).toEqual({ prefix: '€' });
    fireEvent.change(prefix, { target: { value: '' } });
    fireEvent.blur(prefix);
    expect(last()).toEqual({ prefix: null });
    const format = screen.getByLabelText('Number format') as HTMLInputElement;
    fireEvent.change(format, { target: { value: ',.1f' } });
    fireEvent.keyDown(format, { key: 'Enter' });
    expect(last()).toEqual({ format: ',.1f' });
  });

  it('an unchanged field does not emit on blur — no echo, no dirty document', () => {
    panel();
    const prefix = screen.getByLabelText('Number prefix');
    fireEvent.blur(prefix);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('unbound', () => {
  it('offers the column as a free text field until a table is picked', () => {
    panel({ binding: UNBOUND });
    expect(triggerText('Table')).toContain('pick a table');
    const col = screen.getByLabelText('Number column') as HTMLInputElement;
    expect(col.value).toBe('v');
    fireEvent.change(col, { target: { value: 'total' } });
    fireEvent.blur(col);
    expect(last()).toEqual({ col: 'total' });
  });

  it('picking a table emits the table (an explicit bind)', () => {
    panel({ binding: UNBOUND });
    pick('Table', /sales/);
    expect(last()).toEqual({ table: 'sales' });
  });
});

describe('a table the document does not declare', () => {
  it('keeps showing the bound name rather than claiming the Number is unbound', () => {
    panel({ binding: { ...BOUND, table: 'gone' } });
    expect(triggerText('Table')).toContain('$gone');
    expect(screen.getByLabelText('Missing table notice')).toBeTruthy();
  });
});

/* @jsxImportSource solid-js */
/**
 * The `<Number>` editor panel — the chart
 * inspector's sibling for inline figures. A lens like VizEditorPanel: every interaction emits a
 * PARTIAL edit (only the field that changed) — the document stays the source of truth.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import NumberEditorPanel from '../NumberEditorPanel';
import type { NumberEmbedBinding, NumberEmbedEdit } from '@/lib/data/story/story-number';
import type { TableChoice } from '@/lib/story/data/table-catalog';

const COLUMNS = [
  { name: 'region', type: 'string' as const },
  { name: 'revenue', type: 'number' as const },
];
const TABLES: TableChoice[] = [
  { name: 'sales', kind: 'query', columns: COLUMNS, sql: 'select region, revenue from "public"."rows"' },
  { name: 'costs', kind: 'query', columns: [{ name: 'spend', type: 'number' }] },
];
const BOUND: NumberEmbedBinding = {
  table: 'sales', col: 'revenue', agg: 'sum',
  prefix: '$', suffix: null, format: null,
};
const UNBOUND: NumberEmbedBinding = { ...BOUND, table: null, col: 'v', agg: null, prefix: null };

let onChange: ReturnType<typeof vi.fn<(edit: NumberEmbedEdit) => void>>;
beforeEach(() => { onChange = vi.fn<(edit: NumberEmbedEdit) => void>(); });

const panel = (props: Partial<Parameters<typeof NumberEditorPanel>[0]> = {}) =>
  render(() => <NumberEditorPanel binding={BOUND} tables={TABLES} onChange={onChange} {...props} />);

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
    fireEvent.input(prefix, { target: { value: '€' } });
    fireEvent.blur(prefix);
    expect(last()).toEqual({ prefix: '€' });
    fireEvent.input(prefix, { target: { value: '' } });
    fireEvent.blur(prefix);
    expect(last()).toEqual({ prefix: null });
    const format = screen.getByLabelText('Number format') as HTMLInputElement;
    fireEvent.input(format, { target: { value: ',.1f' } });
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
    fireEvent.input(col, { target: { value: 'total' } });
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

describe('reacting to an outside edit', () => {
  it('re-seeds a text field when its prop changes from outside', () => {
    const [binding, setBinding] = createSignal(BOUND);
    render(() => <NumberEditorPanel binding={binding()} tables={TABLES} onChange={onChange} />);
    expect((screen.getByLabelText('Number prefix') as HTMLInputElement).value).toBe('$');
    setBinding({ ...BOUND, prefix: '€' });
    expect((screen.getByLabelText('Number prefix') as HTMLInputElement).value).toBe('€');
  });
});

/** The query behind the data — the chart inspector's block, shared. */
describe('the bound query', () => {
  it('shows the SQL of the query the number is bound to, and opens it in the notebook', () => {
    const onOpenQuery = vi.fn<(name: string) => void>();
    panel({ onOpenQuery });
    expect(screen.getByLabelText('Bound query SQL').textContent).toBe('select region, revenue from "public"."rows"');
    fireEvent.click(screen.getByLabelText('Open $sales in queries'));
    expect(onOpenQuery).toHaveBeenCalledWith('sales');
  });

  it('shows nothing for a table Value', () => {
    panel({ tables: [{ name: 'sales', kind: 'value', columns: COLUMNS }] });
    expect(screen.queryByLabelText('Bound query SQL')).toBeNull();
  });
});

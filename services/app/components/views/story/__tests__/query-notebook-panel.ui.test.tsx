/**
 * The query notebook panel — the document's `<Query>` declarations as cells:
 * SQL above, the last run's answer below. A lens like the other inspectors:
 * a cell commits its SQL on blur or ⌘⏎, and the document stays the source of
 * truth.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import QueryNotebookPanel from '../QueryNotebookPanel';
import type { QueryCell } from '@/lib/story/query-notebook';
import { httpBackendWrapper } from '@/test/helpers/artifact-backend';

const cell = (over: Partial<QueryCell> = {}): QueryCell => ({
  name: 'sales', sql: 'select region, revenue from sales_data.rows', source: null,
  result: null, error: null, pending: false, bound: [], ...over,
});
const ROWS = Array.from({ length: 12 }, (_, i) => ({ region: `r${i}`, revenue: i * 10 }));
const COLUMNS = [{ name: 'region', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];

let onSqlChange: ReturnType<typeof vi.fn<(name: string, sql: string) => void>>;
beforeEach(() => { onSqlChange = vi.fn<(name: string, sql: string) => void>(); });

const panel = (cells: QueryCell[]) => render(<QueryNotebookPanel cells={cells} onSqlChange={onSqlChange} />, { wrapper: httpBackendWrapper('doc1') });
const sqlField = (name: string) => screen.getByLabelText(`Query $${name} SQL`) as HTMLTextAreaElement;

describe('reading the cells', () => {
  it('shows each query by name with its SQL and source', () => {
    panel([cell(), cell({ name: 'costs', sql: 'select 1 as spend', source: null })]);
    expect(sqlField('sales').value).toBe('select region, revenue from "public"."rows"');
    expect(sqlField('costs').value).toBe('select 1 as spend');
    const sales = screen.getByLabelText('Query $sales');
    // The source is no longer repeated on every cell: the index groups each
    // query under the dataset it reads, so the header carries the name and
    // what it powers instead.
    expect(within(sales).queryByText('ref:ds1234')).toBeNull();
    expect(within(screen.getByLabelText('Query $costs')).queryByText(/^ref:/)).toBeNull();
  });

  it('renders the result as a table, capped with a count of what is not shown', () => {
    panel([cell({ result: { rows: ROWS, columns: COLUMNS } })]);
    const result = screen.getByLabelText('Query $sales result');
    expect(within(result).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['region', 'revenue']);
    expect(within(result).getAllByRole('row')).toHaveLength(1 + 10);
    expect(within(result).getByText('r0')).toBeTruthy();
    expect(within(result).getByText('90')).toBeTruthy();
    expect(within(result).getByText('10 of 12 rows')).toBeTruthy();
  });

  it('reports the real total when the run was cut at the cap', () => {
    panel([cell({ result: { rows: ROWS.slice(0, 3), columns: COLUMNS, truncated: true, totalRows: 5000 } })]);
    expect(within(screen.getByLabelText('Query $sales result')).getByText('3 of 5000 rows')).toBeTruthy();
  });

  it('shows the engine error in place of a table', () => {
    panel([cell({ error: 'relation "nothing" does not exist' })]);
    expect(screen.getByLabelText('Query $sales error').textContent).toContain('relation "nothing" does not exist');
    expect(screen.queryByLabelText('Query $sales result')).toBeNull();
  });

  it('says so while a run is in flight, and when nothing has run', () => {
    panel([cell({ pending: true }), cell({ name: 'costs' })]);
    expect(within(screen.getByLabelText('Query $sales')).getByText('running…')).toBeTruthy();
    expect(within(screen.getByLabelText('Query $costs')).getByText('not run yet')).toBeTruthy();
  });
});

describe('what a cell powers', () => {
  const BOUND = [
    { tag: 'Question', label: 'Revenue by region', path: '0.1' },
    { tag: 'Number', label: null, path: '0.3' },
  ];
  const spotlit = (cells: QueryCell[]) => {
    const onSpotlight = vi.fn<(paths: string[]) => void>();
    render(<QueryNotebookPanel cells={cells} onSqlChange={onSqlChange} onSpotlight={onSpotlight} />, { wrapper: httpBackendWrapper('doc1') });
    return onSpotlight;
  };

  it('names the embeds bound to the query, and says when there are none', () => {
    panel([cell({ bound: BOUND }), cell({ name: 'costs', bound: [] })]);
    const sales = screen.getByLabelText('Query $sales');
    expect(within(sales).getByText('Revenue by region')).toBeTruthy();
    expect(within(sales).getByText('number')).toBeTruthy();
    expect(within(screen.getByLabelText('Query $costs')).getByText('powers nothing yet')).toBeTruthy();
  });

  it('spotlights the bound embeds while the SQL has focus, and clears on blur', () => {
    const onSpotlight = spotlit([cell({ bound: BOUND })]);
    fireEvent.focus(sqlField('sales'));
    expect(onSpotlight).toHaveBeenLastCalledWith(['0.1', '0.3']);
    fireEvent.blur(sqlField('sales'));
    expect(onSpotlight).toHaveBeenLastCalledWith([]);
  });

  it('spotlights one embed while its chip is hovered', () => {
    const onSpotlight = spotlit([cell({ bound: BOUND })]);
    const chip = screen.getByLabelText('Spotlight Revenue by region');
    fireEvent.mouseEnter(chip);
    expect(onSpotlight).toHaveBeenLastCalledWith(['0.1']);
    fireEvent.mouseLeave(chip);
    expect(onSpotlight).toHaveBeenLastCalledWith([]);
  });
});

describe('arriving from an embed', () => {
  it('focuses the named cell so its SQL is ready to edit (and its embeds are spotlit)', () => {
    const onSpotlight = vi.fn<(paths: string[]) => void>();
    render(
      <QueryNotebookPanel
        cells={[cell(), cell({ name: 'costs', sql: 'select 1', bound: [{ tag: 'Question', label: null, path: '0.2' }] })]}
        onSqlChange={onSqlChange}
        onSpotlight={onSpotlight}
        focus="costs"
      />, { wrapper: httpBackendWrapper('doc1') }
    );
    expect(document.activeElement).toBe(sqlField('costs'));
    expect(onSpotlight).toHaveBeenLastCalledWith(['0.2']);
  });
});

describe('editing a cell', () => {
  it('commits the SQL on blur, naming the query', () => {
    panel([cell(), cell({ name: 'costs', sql: 'select 1 as spend', source: null })]);
    fireEvent.change(sqlField('costs'), { target: { value: 'select 2 as spend' } });
    fireEvent.blur(sqlField('costs'));
    expect(onSqlChange).toHaveBeenCalledTimes(1);
    expect(onSqlChange).toHaveBeenCalledWith('costs', 'select 2 as spend');
  });

  it('commits on ⌘⏎ too, and a plain Enter stays a newline', () => {
    panel([cell()]);
    fireEvent.change(sqlField('sales'), { target: { value: 'select 1' } });
    fireEvent.keyDown(sqlField('sales'), { key: 'Enter' });
    expect(onSqlChange).not.toHaveBeenCalled();
    fireEvent.keyDown(sqlField('sales'), { key: 'Enter', metaKey: true });
    expect(onSqlChange).toHaveBeenCalledWith('sales', 'select 1');
  });

  it('does not commit unchanged or blank SQL', () => {
    panel([cell()]);
    fireEvent.blur(sqlField('sales'));
    fireEvent.change(sqlField('sales'), { target: { value: '   ' } });
    fireEvent.blur(sqlField('sales'));
    expect(onSqlChange).not.toHaveBeenCalled();
  });
});

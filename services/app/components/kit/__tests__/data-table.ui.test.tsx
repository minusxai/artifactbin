/**
 * `<DataTable>` — the kit component over lib/story/data-table: renders the
 * resolved columns and rows, sorts on header click, formats cells, draws bars
 * and tints, says when it holds a sample of a bigger result and asks for
 * more, and (in jsdom, where nothing has a size) renders plain rows — the
 * virtual window is a browser concern the gate covers.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { DataTable } from '@/components/kit/data-table';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

const COLUMNS: DatasetColumn[] = [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }, { name: 'growth', type: 'number' }];
const ROWS = [
  { region: 'EU', revenue: 840, growth: -0.2 },
  { region: 'NA', revenue: 1200, growth: 0.5 },
  { region: 'APAC', revenue: 300, growth: 0.1 },
];

const rowsText = (container: HTMLElement) =>
  [...container.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()).join('|'));

describe('DataTable', () => {
  it('renders every column with a title and every row, numbers right-aligned', () => {
    const { container, getByLabelText } = render(<DataTable rows={ROWS} columns={COLUMNS} />);
    expect(getByLabelText('Data grid')).toBeTruthy();
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual(['region', 'revenue', 'growth']);
    expect(rowsText(container)).toEqual(['EU|840|-0.2', 'NA|1,200|0.5', 'APAC|300|0.1']); // Intl default; d3 fmt uses a true minus
    const revenueCell = container.querySelector('tbody tr td:nth-child(2)') as HTMLElement;
    expect(revenueCell.style.textAlign).toBe('right');
  });

  it('honours the column spec: pick/order, titles, d3 formats, bars and tints', () => {
    const { container } = render(
      <DataTable
        rows={ROWS}
        columns={COLUMNS}
        spec={[{ col: 'revenue', title: 'Revenue', fmt: '$,.0f', bar: true }, { col: 'growth', fmt: '.0%', colorScale: 'diverging' }, { col: 'region', title: 'Where' }]}
      />,
    );
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual(['Revenue', 'growth', 'Where']);
    expect(rowsText(container)[1]).toBe('$1,200|50%|NA');
    const bar = container.querySelector('tbody tr:nth-child(2) td:nth-child(1) [data-bar]') as HTMLElement;
    expect(bar.style.width).toBe('100%');
    const tinted = container.querySelector('tbody tr:nth-child(1) td:nth-child(2)') as HTMLElement;
    expect(tinted.style.backgroundColor || tinted.style.background).toContain('--chart-2');
  });

  it('sorts on header click: asc, then desc, then off — and shows the direction', () => {
    const { container, getByLabelText } = render(<DataTable rows={ROWS} columns={COLUMNS} />);
    const header = getByLabelText('Sort by revenue');
    fireEvent.click(header);
    expect(rowsText(container).map((r) => r.split('|')[0])).toEqual(['APAC', 'EU', 'NA']);
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(header);
    expect(rowsText(container).map((r) => r.split('|')[0])).toEqual(['NA', 'EU', 'APAC']);
    expect(header.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(header);
    expect(rowsText(container).map((r) => r.split('|')[0])).toEqual(['EU', 'NA', 'APAC']);
  });

  it('starts from the authored sort', () => {
    const { container } = render(<DataTable rows={ROWS} columns={COLUMNS} sort={{ col: 'revenue', dir: 'desc' }} />);
    expect(rowsText(container).map((r) => r.split('|')[0])).toEqual(['NA', 'EU', 'APAC']);
  });

  it('when the rows are a sample of a bigger result, says so and hands sorting/more to the caller', () => {
    const onSortChange = vi.fn();
    const onLoadMore = vi.fn();
    const { getByLabelText, container } = render(
      <DataTable rows={ROWS} columns={COLUMNS} totalRows={5000} truncated onSortChange={onSortChange} onLoadMore={onLoadMore} />,
    );
    expect(getByLabelText('Row count').textContent).toMatch(/3 of 5,000/);
    fireEvent.click(getByLabelText('Sort by revenue'));
    // The loaded rows are a WINDOW: sorting them locally would lie, so the
    // caller re-reads with the sort and the local order stays.
    expect(onSortChange).toHaveBeenCalledWith({ col: 'revenue', dir: 'asc' });
    expect(rowsText(container).map((r) => r.split('|')[0])).toEqual(['EU', 'NA', 'APAC']);
    fireEvent.click(getByLabelText('Load more rows'));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('renders an empty state for no rows, and names a spec column the table lacks', () => {
    const { getByLabelText } = render(<DataTable rows={[]} columns={COLUMNS} />);
    expect(getByLabelText('Data grid').textContent).toMatch(/no rows/i);
    const { container } = render(<DataTable rows={ROWS} columns={COLUMNS} spec={[{ col: 'ghost' }]} />);
    expect(container.querySelector('thead th')?.getAttribute('title')).toMatch(/not a column/i);
  });

  it('header cells are bold — the header row must read as a header, not another data row', () => {
    const { getByLabelText } = render(<DataTable rows={ROWS} columns={COLUMNS} />);
    expect(getByLabelText('Sort by region').className).toMatch(/\bfont-bold\b/);
  });

  it('SSRs the first rows as plain markup (the served document, the og card) and hydrates without a mismatch', () => {
    const html = renderToString(<DataTable rows={ROWS} columns={COLUMNS} height={200} />);
    expect(html).toContain('APAC');
    expect(html).toContain('1,200');
    // A bounded, scrollable box — the iframe never scrolls itself.
    expect(html).toMatch(/height:\s*200px/);
  });
});

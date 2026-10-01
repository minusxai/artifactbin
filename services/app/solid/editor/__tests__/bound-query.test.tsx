/* @jsxImportSource solid-js */
/**
 * The read-only SQL block under the chart/number
 * table pickers, shown only when the bound table is a Query with known SQL.
 */
import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import BoundQuery from '../BoundQuery';
import type { TableChoice } from '@/lib/story/table-catalog';

const QUERY: TableChoice = {
  name: 'sales',
  kind: 'query',
  columns: [{ name: 'region', type: 'string' }],
  sql: 'select region from "public"."rows"',
};
const VALUE: TableChoice = { name: 'sales', kind: 'value', columns: [{ name: 'region', type: 'string' }] };

it('shows the SQL of the query the embed is bound to, and opens it in the notebook', () => {
  const onOpenQuery = vi.fn<(name: string) => void>();
  render(() => <BoundQuery table={QUERY} onOpenQuery={onOpenQuery} />);
  expect(screen.getByLabelText('Bound query SQL').textContent).toBe('select region from "public"."rows"');
  fireEvent.click(screen.getByLabelText('Open $sales in queries'));
  expect(onOpenQuery).toHaveBeenCalledWith('sales');
});

it('shows nothing for a table Value', () => {
  render(() => <BoundQuery table={VALUE} onOpenQuery={vi.fn()} />);
  expect(screen.queryByLabelText('Bound query SQL')).toBeNull();
});

it('shows nothing when unbound', () => {
  render(() => <BoundQuery table={null} />);
  expect(screen.queryByLabelText('Bound query SQL')).toBeNull();
});

it('omits the opener when there is nowhere to open', () => {
  render(() => <BoundQuery table={QUERY} />);
  expect(screen.getByLabelText('Bound query SQL')).toBeTruthy();
  expect(screen.queryByLabelText('Open $sales in queries')).toBeNull();
});

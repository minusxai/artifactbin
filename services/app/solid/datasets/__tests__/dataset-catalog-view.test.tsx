/* @jsxImportSource solid-js */
/**
 * THE DATASET PAGE'S CATALOG (DatasetCatalogView) — what the data-journey gate's PostgreSQL leg read in a browser,
 * moved here (its server half is lib/datasets/__tests__/postgres-routes.test.ts): a reader's schema browser lists
 * exactly the exposed relations and columns, the schema selector moves the preview between them, and a manual refresh
 * asks the server to refresh and says when it last did.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { DatasetCatalogView } from '../DatasetCatalogView';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const catalog = {
  kind: 'postgres', defaultSchema: 'sales', refreshSeconds: 0,
  tables: [
    { schema: 'sales', name: 'orders', source: { schema: 'sales', table: 'orders' }, columns: [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }] },
    { schema: 'support', name: 'tickets', source: { schema: 'support', table: 'tickets' }, columns: [{ name: 'id', type: 'number' }, { name: 'subject', type: 'string' }] },
  ],
} as unknown as DatasetCatalog;

function serve() {
  const asked: Array<{ sql: string; refresh?: boolean }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { sql: string; refresh?: boolean };
    asked.push(body);
    const rows = body.sql.includes('"tickets"') ? [{ id: 10, subject: 'Refund requested' }] : [{ id: 1, region: 'west', amount: 120 }];
    return Response.json({ rows, columns: Object.keys(rows[0]!).map((name) => ({ name, type: typeof rows[0]![name as keyof typeof rows[0]] === 'number' ? 'number' : 'string' })), refreshedAt: '2026-10-08T00:00:00.000Z' });
  }));
  return asked;
}

it('shows a reader every exposed relation and column in the schema browser, and no way to edit', async () => {
  serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse dataset schema' }));
  const browser = screen.getByLabelText('Dataset schema browser');
  for (const name of ['sales', 'orders', 'region', 'amount', 'support', 'tickets', 'subject']) expect(browser).toHaveTextContent(name);
  expect(browser).not.toHaveTextContent('customer_secret');
  expect(screen.queryByLabelText('Edit dataset')).toBeNull();
});

it('opens on the default schema and moves the preview with the schema selector', async () => {
  serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} />);
  expect(screen.getByLabelText('Dataset schema')).toHaveValue('sales');
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('120'));
  fireEvent.change(screen.getByLabelText('Dataset schema'), { target: { value: 'support' } });
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('Refund requested'));
  expect(screen.getByLabelText('Dataset table')).toHaveValue('tickets');
  fireEvent.change(screen.getByLabelText('Dataset schema'), { target: { value: 'sales' } });
  await waitFor(() => expect(within(screen.getByLabelText('Table preview')).getByText('120')).toBeInTheDocument());
});

it('refreshes by hand and says when it last did', async () => {
  const asked = serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} />);
  await waitFor(() => expect(screen.getByLabelText('Refresh status')).toHaveTextContent(/Last refreshed .*Manual refresh/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh dataset' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh dataset' }));
  await waitFor(() => expect(asked.at(-1)?.refresh).toBe(true));
  await waitFor(() => expect(screen.getByLabelText('Refresh status')).toHaveTextContent(/Last refreshed .*Manual refresh/));
});

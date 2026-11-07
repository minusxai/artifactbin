/* @jsxImportSource solid-js */
/**
 * THE DATASET PAGE'S CATALOG (DatasetCatalogView): a reader's schema browser lists
 * exactly the exposed relations and columns, the schema selector moves the preview between them, and a manual refresh
 * asks the server to refresh and says when it last did.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { DatasetCatalog } from '@/lib/datasets';
import { DatasetCatalogView } from '../DatasetCatalogView';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const catalog = {
  kind: 'stored', defaultSchema: 'sales', refreshSeconds: 0,
  tables: [
    { schema: 'sales', name: 'orders', columns: [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }] },
    { schema: 'support', name: 'tickets', columns: [{ name: 'id', type: 'number' }, { name: 'subject', type: 'string' }] },
  ],
} as unknown as DatasetCatalog;

function serve() {
  const asked: Array<{ sql?: string; table?: { schema: string; name: string }; refresh?: boolean }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { sql?: string; table?: { schema: string; name: string }; refresh?: boolean };
    asked.push(body);
    const rows = body.table?.name === 'tickets' || body.sql?.includes('"tickets"') ? [{ id: 10, subject: 'Refund requested' }] : [{ id: 1, region: 'west', amount: 120 }];
    return Response.json({ rows, columns: Object.keys(rows[0]!).map((name) => ({ name, type: typeof rows[0]![name as keyof typeof rows[0]] === 'number' ? 'number' : 'string' })), refreshedAt: '2026-10-08T00:00:00.000Z' });
  }));
  return asked;
}

it('shows a reader every exposed relation and column in the schema browser, and no way to edit', async () => {
  serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} canRunSql={true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Browse dataset schema' }));
  const browser = screen.getByLabelText('Dataset schema browser');
  for (const name of ['sales', 'orders', 'region', 'amount', 'support', 'tickets', 'subject']) expect(browser).toHaveTextContent(name);
  expect(browser).not.toHaveTextContent('customer_secret');
  expect(screen.queryByLabelText('Edit dataset')).toBeNull();
});

it('opens on the default schema and moves the preview with the schema selector', async () => {
  serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} canRunSql={true} />);
  expect(screen.getByLabelText('Dataset schema')).toHaveTextContent('sales');
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('120'));
  fireEvent.click(screen.getByLabelText('Dataset schema'));
  fireEvent.click(screen.getByRole('option', { name: 'support' }));
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('Refund requested'));
  expect(screen.getByLabelText('Dataset table')).toHaveTextContent('tickets');
  fireEvent.click(screen.getByLabelText('Dataset schema'));
  fireEvent.click(screen.getByRole('option', { name: 'sales' }));
  await waitFor(() => expect(within(screen.getByLabelText('Table preview')).getByText('120')).toBeInTheDocument());
});

it('refreshes by hand and says when it last did', async () => {
  const asked = serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} canRunSql={true} />);
  await waitFor(() => expect(screen.getByLabelText('Refresh status')).toHaveTextContent(/Last refreshed .*Manual refresh/));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh dataset' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh dataset' }));
  await waitFor(() => expect(asked.at(-1)?.refresh).toBe(true));
  await waitFor(() => expect(screen.getByLabelText('Refresh status')).toHaveTextContent(/Last refreshed .*Manual refresh/));
});

it('browses tables by name, never as SQL, and offers Run SQL only to a reader whose rules allow it', async () => {
  const asked = serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} canRunSql={false} />);
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('120'));
  expect(asked[0]).toMatchObject({ table: { schema: 'sales', name: 'orders' } });
  expect(asked.every((body) => body.sql === undefined)).toBe(true);
  expect(screen.queryByRole('radio', { name: 'SQL view' }) ?? screen.queryByLabelText('SQL view')).toBeNull();
  fireEvent.click(screen.getByLabelText('Dataset schema'));
  fireEvent.click(screen.getByRole('option', { name: 'support' }));
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('Refund requested'));
  expect(asked.at(-1)).toMatchObject({ table: { schema: 'support', name: 'tickets' } });
});

it('a reader allowed SQL still browses by name, and runs typed SQL as SQL', async () => {
  const asked = serve();
  render(() => <DatasetCatalogView id="ds1" catalog={catalog} canEdit={false} canRunSql={true} />);
  await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('120'));
  expect(asked[0]).toMatchObject({ table: { schema: 'sales', name: 'orders' } });
  fireEvent.click(screen.getByLabelText('SQL view'));
  const editor = screen.getByLabelText('Dataset SQL') as HTMLTextAreaElement;
  editor.value = 'select count(*) as n from sales.orders';
  fireEvent.input(editor);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run dataset SQL' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Run dataset SQL' }));
  await waitFor(() => expect(asked.at(-1)).toMatchObject({ sql: 'select count(*) as n from sales.orders' }));
});

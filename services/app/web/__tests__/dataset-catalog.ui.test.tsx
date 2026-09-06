import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { DatasetEditorPage } from '../pages/DatasetEditor';
import { DatasetCatalogView } from '@/components/DatasetCatalogView';
import type { DatasetCatalog } from '@/lib/datasets/types';

const connection = { id: 'conn-1', name: 'Warehouse', host: 'db.example.com', port: 5432, database: 'analytics', username: 'reader', ssl: true };
const tables = [
  { schema: 'sales', name: 'orders', columns: [{ name: 'id', type: 'number' }, { name: 'secret', type: 'string' }] },
  { schema: 'crm', name: 'people', columns: [{ name: 'name', type: 'string' }] },
];
const catalog: DatasetCatalog = { kind: 'postgres', connectionId: connection.id, defaultSchema: 'sales', refreshSeconds: 60, tables: [{ ...tables[0], columns: [{ name: 'id', type: 'number' }], source: { schema: 'sales', table: 'orders' } }] };
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let calls: Array<{ url: string; body: any; method: string }>;
let failSave = false;
let failPreview = false;
beforeEach(() => {
  calls = []; failSave = false; failPreview = false;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? 'GET'; calls.push({ url, body, method });
    if (url.endsWith('/test')) return reply({ tables });
    if (url === '/api/my/connections') return reply(method === 'POST' ? { connection } : { connections: [connection] });
    if (url.endsWith('/preview') || url.endsWith('/tables')) return failPreview ? reply({ error: 'Query refused' }, 400) : reply({ rows: [{ id: 42 }], columns: [{ name: 'id', type: 'number' }], refreshedAt: '2026-09-06T10:00:00Z', truncated: true });
    if (method === 'GET') return reply({ id: 'data-1', title: 'Orders', version: 7, meta: { catalog } });
    return failSave ? reply({ error: 'Version conflict' }, 409) : reply({ id: 'data-1', version: 8 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function editor(edit = false) {
  render(<MemoryRouter initialEntries={[edit ? '/datasets/data-1/edit' : '/datasets/new']}><Routes><Route path="/datasets/new" element={<DatasetEditorPage />} /><Route path="/datasets/:id/edit" element={<DatasetEditorPage />} /></Routes></MemoryRouter>);
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function discover() {
  fireEvent.click(await screen.findByLabelText('PostgreSQL'));
  await screen.findByLabelText('Connection');
  change('Connection', 'conn-1');
  fireEvent.click(screen.getByLabelText('Test and discover'));
  await screen.findByLabelText('Expose table sales.orders');
}
async function selectOrders() {
  await discover();
  fireEvent.click(screen.getByLabelText('Expose table sales.orders'));
  fireEvent.click(screen.getByLabelText('Expose column sales.orders.id'));
  change('Default schema', 'sales');
}
describe('dataset editor', () => {
  it('creates a connection with TLS by default and clears its write-only password', async () => {
    editor();
    fireEvent.click(await screen.findByLabelText('PostgreSQL'));
    fireEvent.click(screen.getByLabelText('New connection'));
    for (const [label, value] of [['Connection name', 'Warehouse'], ['Host', connection.host], ['Database', 'analytics'], ['Username', 'reader'], ['Password', 'private-password']]) change(label, value);
    expect(screen.getByLabelText('Use SSL')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Save connection'));
    await waitFor(() => expect(calls.find(c => c.method === 'POST' && c.url === '/api/my/connections')?.body).toEqual({ name: 'Warehouse', host: connection.host, port: 5432, database: 'analytics', username: 'reader', password: 'private-password', ssl: true }));
    fireEvent.click(screen.getByLabelText('New connection'));
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
  it('exposes only selected columns and keeps the explicit default schema stable as tables are added', async () => {
    editor(); await selectOrders();
    expect(screen.getByLabelText('Expose column sales.orders.secret')).not.toBeChecked();
    fireEvent.click(screen.getByLabelText('Expose table crm.people'));
    fireEvent.click(screen.getByLabelText('Expose column crm.people.name'));
    expect(screen.getByLabelText('Default schema')).toHaveValue('sales');
    change('Dataset title', 'Orders');
    fireEvent.click(screen.getByLabelText('Save dataset'));
    await waitFor(() => expect(calls.find(c => c.url === '/api/my/artifacts')?.body.dataset.tables).toEqual([
      { schema: 'sales', name: 'orders', source: { schema: 'sales', table: 'orders' }, columns: ['id'] },
      { schema: 'crm', name: 'people', source: { schema: 'crm', table: 'people' }, columns: ['name'] },
    ]));
    const body = calls.find(c => c.url === '/api/my/artifacts')!.body;
    expect(body.visibility).toBe('private');
    expect(JSON.stringify(body)).not.toMatch(/password|username|db.example/);
  });
  it('authors SQL models through named fields, previews them, and preserves SQL after errors', async () => {
    editor(); await selectOrders();
    fireEvent.click(screen.getByLabelText('Add SQL model'));
    change('Model schema 1', 'reporting'); change('Model name 1', 'totals'); change('Model SQL 1', 'select count(*) as id from sales.orders');
    fireEvent.click(screen.getByLabelText('Preview model 1'));
    await screen.findByLabelText('Model preview 1');
    expect(calls.find(c => c.url.endsWith('/preview'))?.body.sql).toBe('select count(*) as id from sales.orders');
    failPreview = true;
    fireEvent.click(screen.getByLabelText('Preview model 1'));
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Query refused'));
    expect(screen.getByLabelText('Model SQL 1')).toHaveValue('select count(*) as id from sales.orders');
  });
  it('loads the catalog for editing and preserves changes on a version conflict', async () => {
    editor(true);
    await waitFor(() => expect(screen.getByLabelText('Dataset title')).toHaveValue('Orders'));
    expect(screen.getByLabelText('Expose column sales.orders.id')).toBeChecked();
    change('Dataset title', 'New title'); failSave = true;
    fireEvent.click(screen.getByLabelText('Save dataset'));
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Version conflict'));
    expect(screen.getByLabelText('Dataset title')).toHaveValue('New title');
    expect(calls.find(c => c.method === 'PUT')?.body.expectedVersion).toBe(7);
  });
  it('includes the existing dataset id when previewing an edited model', async () => {
    editor(true);
    await waitFor(() => expect(screen.getByLabelText('Dataset title')).toHaveValue('Orders'));
    fireEvent.click(screen.getByLabelText('Add SQL model'));
    change('Model name 1', 'summary'); change('Model SQL 1', 'select id from sales.orders');
    fireEvent.click(screen.getByLabelText('Preview model 1'));
    await waitFor(() => expect(calls.find(c => c.url.endsWith('/preview'))?.body.datasetId).toBe('data-1'));
  });
  it('adds stored JSON rows in a named table', async () => {
    editor(); fireEvent.click(await screen.findByLabelText('Add stored table'));
    change('Stored schema 1', 'main'); change('Stored table name 1', 'rows'); change('Stored rows 1', '[{"id":1}]'); change('Default schema', 'main');
    fireEvent.click(screen.getByLabelText('Save dataset'));
    await waitFor(() => expect(calls.find(c => c.url === '/api/my/artifacts')?.body.dataset).toMatchObject({ kind: 'stored', defaultSchema: 'main', tables: [{ schema: 'main', name: 'rows', rows: [{ id: 1 }] }] }));
  });
});
describe('dataset catalog viewer', () => {
  it('renders typed rows, refreshes and paginates through the public dataset endpoint', async () => {
    render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    expect(screen.getByLabelText('Table preview')).toHaveTextContent('number');
    expect(screen.getByLabelText('Edit dataset')).toHaveAttribute('href', '/datasets/data-1/edit');
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(calls.at(-1)?.body.offset).toBe(50));
    fireEvent.click(screen.getByLabelText('Refresh dataset'));
    await waitFor(() => expect(calls.at(-1)?.body.refresh).toBe(true));
    expect(calls[0]).toMatchObject({ url: '/a/data-1/tables', body: { sql: 'SELECT * FROM "sales"."orders"', limit: 50, offset: 0 } });
  });
  it('keeps a selected table when the catalog grows and recovers when that table is removed', async () => {
    const view = render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    const extra = { schema: 'crm', name: 'people', columns: [{ name: 'name', type: 'string' as const }], source: { schema: 'crm', table: 'people' } };
    view.rerender(<DatasetCatalogView id="data-1" catalog={{ ...catalog, defaultSchema: 'crm', tables: [...catalog.tables, extra] }} canEdit={false} />);
    expect(screen.getByLabelText('Dataset schema')).toHaveValue('sales');
    expect(screen.getByLabelText('Dataset table')).toHaveValue('orders');
    view.rerender(<DatasetCatalogView id="data-1" catalog={{ ...catalog, defaultSchema: 'crm', tables: [extra] }} canEdit={false} />);
    await waitFor(() => expect(calls.at(-1)?.body.sql).toBe('SELECT * FROM "crm"."people"'));
  });
  it('retains the last successful preview with a stale error on refresh failure', async () => {
    render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    failPreview = true; fireEvent.click(screen.getByLabelText('Refresh dataset'));
    await waitFor(() => expect(screen.getByLabelText('Dataset preview error')).toHaveTextContent('Query refused'));
    expect(screen.getByLabelText('Table preview')).toHaveTextContent('42');
    expect(screen.getByLabelText('Refresh status')).toHaveTextContent(/stale/i);
    expect(screen.queryByLabelText('Edit dataset')).not.toBeInTheDocument();
  });
});

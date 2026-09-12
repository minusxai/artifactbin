/**
 * `DatasetCatalogView` — the READER's side of a dataset: browse the exposed
 * schema, run SQL or pick a table, page, refresh, and say truthfully how much
 * of the data is shown. It shares the editor's catalog fixture and fetch stub
 * and nothing else: no routing, no session, no discovery.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatasetCatalogView } from '@/components/DatasetCatalogView';
import { catalog, change, click, connection, installDatasetFetch, reply, state, tables } from '@/test/helpers/dataset-catalog';

beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dataset catalog viewer', () => {
  it('lets a reader browse every exposed schema, table and column without editing or fetching raw discovery', async () => {
    render(<DatasetCatalogView id="data-1" catalog={{...catalog,tables:[catalog.tables[0],{...tables[1],source:{schema:'crm',table:'people'}}]}} canEdit={false} />);
    await screen.findByLabelText('Table preview');
    const before = state.calls.length;
    click('Browse dataset schema');
    const browser = within(screen.getByLabelText('Dataset schema browser'));
    expect(browser.getByText('sales')).toBeInTheDocument();
    expect(browser.getByText('orders')).toBeInTheDocument();
    expect(browser.getByText('id')).toBeInTheDocument();
    expect(browser.getByText('crm')).toBeInTheDocument();
    expect(browser.getByText('people')).toBeInTheDocument();
    expect(browser.getByText('name')).toBeInTheDocument();
    expect(browser.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit dataset')).not.toBeInTheDocument();
    expect(state.calls).toHaveLength(before);
  });

  it('keeps the reader schema browser available in SQL mode and updates only public metadata', async () => {
    const view=render(<DatasetCatalogView id="data-1" catalog={{...catalog,notebook:{cells:[{id:'hidden',name:'hidden_helper',sql:'select secret from private.raw'}]},notebookSources:tables}} canEdit={false} />);
    await screen.findByLabelText('Table preview'); click('SQL view'); click('Browse dataset schema');
    const browser=screen.getByLabelText('Dataset schema browser');
    expect(browser).toHaveTextContent('number'); expect(browser).not.toHaveTextContent('hidden_helper'); expect(browser).not.toHaveTextContent(connection.host); expect(browser).not.toHaveTextContent('secret');
    view.rerender(<DatasetCatalogView id="data-1" catalog={{...catalog,tables:[{schema:'reports',name:'summary',columns:[{name:'total',type:'number'}]}]}} canEdit={false} />);
    expect(browser).toHaveTextContent('reports'); expect(browser).toHaveTextContent('summary'); expect(browser).toHaveTextContent('total'); expect(browser).not.toHaveTextContent('orders');
    click('Browse dataset schema'); expect(screen.queryByLabelText('Dataset schema browser')).not.toBeInTheDocument();
  });

  it('runs SQL explicitly, pages the executed query, retains drafts on refresh and resets table mode', async () => {
    render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />); await screen.findByLabelText('Table preview');
    click('SQL view'); const count=state.calls.length; change('Dataset SQL','select id from orders where id > 10'); expect(state.calls).toHaveLength(count);
    click('Run dataset SQL'); await waitFor(() => expect(state.calls.at(-1)?.body).toMatchObject({sql:'select id from orders where id > 10',offset:0}));
    await waitFor(() => expect(screen.getByLabelText('Next page')).toBeEnabled()); click('Next page'); await waitFor(() => expect(state.calls.at(-1)?.body).toMatchObject({sql:'select id from orders where id > 10',offset:50}));
    change('Dataset SQL','select secret from orders'); click('Refresh dataset'); await waitFor(() => expect(state.calls.at(-1)?.body).toMatchObject({sql:'select id from orders where id > 10',offset:50,refresh:true}));
    await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); state.failPreview=true; click('Run dataset SQL'); await screen.findByLabelText('Dataset preview error');
    expect(screen.getByLabelText('Dataset SQL')).toHaveValue('select secret from orders'); expect(state.calls.at(-1)?.body.offset).toBe(0);
    state.failPreview=false; click('Table view'); await waitFor(() => expect(state.calls.at(-1)?.body).toMatchObject({sql:'SELECT * FROM "sales"."orders"',offset:0}));
  });

  it.each([
    ['stored', false, '3 rows · 4 columns'],
    ['stored', true, '3 rows shown · 4 columns'],
    ['postgres', false, '3 rows shown · 4 columns'],
  ] as const)('summarizes %s tables truthfully when truncated=%s', async (kind, truncated, summary) => {
    vi.stubGlobal('fetch', vi.fn(() => reply({ rows: [{ a: 1, b: null, c: 3, d: 4 }, { a: 2 }, { a: 3 }], columns: ['a', 'b', 'c', 'd'].map(name => ({ name, type: 'number' })), refreshedAt: '2026-09-06T10:00:00Z', truncated })));
    render(<DatasetCatalogView id="data-1" catalog={{ ...catalog, kind }} canEdit={false} />);
    expect(await screen.findByLabelText('Dataset summary')).toHaveTextContent(summary);
    expect(screen.getByLabelText('Table preview')).toHaveTextContent('—');
    expect(screen.getByLabelText('Table preview')).toHaveClass('overflow-auto');
    if (truncated) {
      fireEvent.click(screen.getByLabelText('Next page'));
      await waitFor(() => expect(screen.getByLabelText('Dataset summary')).toHaveTextContent('Rows 51–53 shown · 4 columns'));
    }
  });

  it('renders typed rows, refreshes and paginates through the public dataset endpoint', async () => {
    render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    expect(screen.getByLabelText('Table preview')).toHaveTextContent('number');
    expect(screen.getByLabelText('Edit dataset')).toHaveAttribute('href', '/a/data-1/edit');
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(state.calls.at(-1)?.body.offset).toBe(50));
    fireEvent.click(screen.getByLabelText('Refresh dataset'));
    await waitFor(() => expect(state.calls.at(-1)?.body.refresh).toBe(true));
    expect(state.calls[0]).toMatchObject({ url: '/a/data-1/tables', body: { sql: 'SELECT * FROM "sales"."orders"', limit: 50, offset: 0 } });
  });

  it('requeries when the selected table definition changes without changing its name', async () => {
    const view = render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />);
    await screen.findByLabelText('Table preview');
    const before = state.calls.length;
    view.rerender(<DatasetCatalogView id="data-1" catalog={{ ...catalog, tables: catalog.tables.map(table => ({ ...table, columns: [...table.columns, { name: 'updated', type: 'string' }] })) }} canEdit={false} />);
    await waitFor(() => expect(state.calls.length).toBe(before + 1));
    expect(screen.getByLabelText('Dataset schema')).toHaveValue('sales');
    expect(screen.getByLabelText('Dataset table')).toHaveValue('orders');
  });

  it('keeps a selected table when the catalog grows and recovers when that table is removed', async () => {
    const view = render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    const extra = { schema: 'crm', name: 'people', columns: [{ name: 'name', type: 'string' as const }], source: { schema: 'crm', table: 'people' } };
    view.rerender(<DatasetCatalogView id="data-1" catalog={{ ...catalog, defaultSchema: 'crm', tables: [...catalog.tables, extra] }} canEdit={false} />);
    expect(screen.getByLabelText('Dataset schema')).toHaveValue('sales');
    expect(screen.getByLabelText('Dataset table')).toHaveValue('orders');
    view.rerender(<DatasetCatalogView id="data-1" catalog={{ ...catalog, defaultSchema: 'crm', tables: [extra] }} canEdit={false} />);
    await waitFor(() => expect(state.calls.at(-1)?.body.sql).toBe('SELECT * FROM "crm"."people"'));
  });

  it('retains the last successful preview with a stale error on refresh failure', async () => {
    render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('42'));
    state.failPreview = true; fireEvent.click(screen.getByLabelText('Refresh dataset'));
    await waitFor(() => expect(screen.getByLabelText('Dataset preview error')).toHaveTextContent('Query refused'));
    expect(screen.getByLabelText('Table preview')).toHaveTextContent('42');
    expect(screen.getByLabelText('Refresh status')).toHaveTextContent(/stale/i);
    expect(screen.queryByLabelText('Edit dataset')).not.toBeInTheDocument();
  });
});

/**
 * The dataset editor's EXPOSURE seam: which schemas, tables and columns the
 * document publishes, what survives a rediscovery, and the save itself —
 * including the artifact controls the editor shares with every other format.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addCell, catalog, change, click, discover, editor, installDatasetFetch, savedDefinition, selectOrders, state, tables } from '@/test/helpers/dataset-catalog';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: state.viewerSession }) }));
beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dataset editor — exposure and saving', () => {
  it('keeps notebook before whitelist, synchronizes Expose with column selections and saves markup', async () => {
    editor(); await discover();
    expect(screen.getByLabelText('Data models notebook').compareDocumentPosition(screen.getByLabelText('Source exposure')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    state.previewColumns = [{ name: 'id', type: 'number' }, { name: 'total', type: 'number' }];
    await addCell('totals', 'select id, sum(amount) total from sales.orders group by id');
    expect(screen.getByLabelText('Expose cell 1')).not.toBeChecked(); click('Expose cell 1');
    expect(screen.getByLabelText('Expose table models.totals')).toBeChecked(); click('Toggle table models.totals'); click('Expose column models.totals.total');
    expect(screen.getByLabelText('Expose cell 1')).toBePartiallyChecked(); click('Expose table models.totals');
    expect(screen.getByLabelText('Expose cell 1')).toBeChecked(); change('Default schema', 'models'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{ schema: 'models', name: 'totals', modelCellId: expect.any(String), columns: ['id', 'total'] }]));
    expect(typeof state.calls.find(c => c.url === '/api/my/artifacts')?.body.dataset).toBe('string');
    expect(savedDefinition()?.connection?.passwordSecretId).toBe('secret-new');
  });

  it('allows every authorized editor to configure the connection, notebook and source whitelist', async () => {
    editor(true); await screen.findByLabelText('Password status');
    expect(screen.getByLabelText('Host')).toBeEnabled(); expect(screen.getByLabelText('Test and discover')).toBeEnabled(); expect(screen.getByLabelText('Expose table sales.orders')).toBeEnabled();
    expect(screen.queryByLabelText('Shared dataset connection')).not.toBeInTheDocument();
    await addCell('helper', 'select id from sales.orders');
    expect(state.calls.find(c => c.url.endsWith('/notebook/preview'))?.body.datasetId).toBe('data-1');
    click('Test and discover'); await screen.findByLabelText('Expose table crm.people');
    expect(state.calls.find(c => c.url.endsWith('/discover'))?.body.datasetId).toBe('data-1');
  });

  it('preserves branch selection, physical mappings and excludes newly discovered columns', async () => {
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover'); await screen.findByLabelText('Expose schema crm');
    expect(screen.getByLabelText('Expose schema sales')).toBePartiallyChecked(); click('Toggle table sales.orders');
    expect(screen.getByLabelText('Expose column sales.orders.secret')).not.toBeChecked();
    expect(screen.queryByLabelText(/Logical schema/)).not.toBeInTheDocument(); click('Toggle schema sales'); change('Refresh interval','30'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{ schema:'sales', name:'orders', source:{schema:'sales',table:'orders'}, columns:['id'] }]));
  });

  it('exposes only selected columns and keeps the explicit default schema stable as tables are added', async () => {
    editor(); await selectOrders(); click('Expose table crm.people'); expect(screen.getByLabelText('Default schema')).toHaveValue('sales');
    click('Save dataset'); await waitFor(() => expect(savedDefinition()?.tables).toHaveLength(2));
    expect(state.calls.find(c => c.url === '/api/my/artifacts')?.body.visibility).toBe('private');
  });

  it('keeps an existing dataset default schema immutable', async () => {
    editor(true); await screen.findByLabelText('Password status'); expect(screen.getByLabelText('Default schema')).toBeDisabled();
  });

  it('retains selected tables and columns that disappear on rediscovery', async () => {
    state.loadedCatalog={...catalog,notebookSources:tables,tables:[catalog.tables[0],{...tables[1],source:{schema:'crm',table:'people'}}]};
    state.discoveryTables=[{...tables[0],columns:[tables[0].columns[1]]}];
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover'); await waitFor(() => expect(screen.getByLabelText('Dataset notice')).toHaveTextContent('Connected'));
    expect(screen.getByLabelText('Expose table crm.people')).toBeChecked(); click('Toggle table sales.orders'); expect(screen.getByLabelText('Expose column sales.orders.id')).toBeChecked();
    change('Refresh interval','30'); click('Save dataset'); await waitFor(() => expect(savedDefinition()?.tables).toHaveLength(2));
    expect(savedDefinition()?.tables[0].columns).toEqual(['id']);
  });

  it.each(['physical', 'model'] as const)('refreshes the final preview when a %s column is removed from exposure', async tableKind => {
    const columns = [{name:'id',type:'number' as const},{name:'secret',type:'string' as const}];
    const schema = tableKind === 'physical' ? 'sales' : 'models';
    const name = tableKind === 'physical' ? 'orders' : 'totals';
    state.loadedCatalog={...catalog,defaultSchema:schema,
      notebook:{cells:tableKind === 'model' ? [{id:'model-1',name,sql:'select id, secret from sales.orders'}] : []},
      tables:[{schema,name,columns,...(tableKind === 'physical' ? {source:{schema:'sales',table:'orders'}} : {modelCellId:'model-1'})}],
    };
    state.previewColumns=columns;
    editor(true); await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('secret'));
    const before=state.calls.filter(c => c.url === '/api/my/datasets/preview').length;
    click(`Toggle table ${schema}.${name}`); state.previewColumns=[columns[0]]; click(`Expose column ${schema}.${name}.secret`);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).not.toHaveTextContent('secret'));
    expect(state.calls.filter(c => c.url === '/api/my/datasets/preview')).toHaveLength(before + 1);
    expect(state.calls.filter(c => c.url === '/api/my/datasets/preview').at(-1)?.body.dataset.tables[0].columns).toEqual(['id']);
  });

  it('preserves edited title after a version conflict', async () => {
    editor(true); await screen.findByLabelText('Password status'); change('Dataset title','New title'); state.failSave=true; click('Save dataset');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Version conflict')); expect(screen.getByLabelText('Dataset title')).toHaveValue('New title');
    expect(state.calls.find(c => c.method === 'PATCH')?.body.expectedState).toBe('state-7');
  });

  it('adds stored JSON rows in a named table', async () => {
    editor(); click('Add stored table'); change('Stored schema 1','main'); change('Stored table name 1','rows'); change('Stored rows 1','[{"id":1}]'); change('Default schema','main'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()).toMatchObject({kind:'stored',defaultSchema:'main',tables:[{schema:'main',name:'rows',rows:[{id:1}]}]}));
  });

  it('retains stored object data when changing refresh settings without new rows', async () => {
    state.loadedCatalog={kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'}],objectKey:'private/object'}]};
    editor(true); await waitFor(() => expect(screen.getByLabelText('Dataset title')).toHaveValue('Orders')); change('Refresh interval','30'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{schema:'public',name:'rows'}]));
  });

  it('uses artifact controls with sharing when editing a dataset', async () => {
    editor(true);
    await screen.findByDisplayValue('Orders');
    expect(screen.getByLabelText('Open artifact controls')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name:'Share'}));
    expect(await screen.findByRole('dialog', { name: 'Sharing' })).toBeInTheDocument();
    expect(screen.getByLabelText('Make private')).toBeInTheDocument();
    expect(screen.getByLabelText('Invite email')).toBeInTheDocument();
  });

  it('renames a dataset without attempting to replace its protected rows', async () => {
    editor(true);
    await screen.findByDisplayValue('Orders');
    change('Dataset title','Renamed');
    click('Save dataset');
    await waitFor(()=>expect(state.calls.some(c=>c.method==='PATCH')).toBe(true));
    const saved=state.calls.find(c=>c.method==='PATCH')!;
    expect(saved.body.title).toBe('Renamed');
    expect(saved.body).not.toHaveProperty('dataset');
  });
});

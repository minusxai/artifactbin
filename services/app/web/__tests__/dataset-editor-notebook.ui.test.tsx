/**
 * The dataset editor's NOTEBOOK seam: cells, their keyboard shortcuts, the
 * dependency graph between a cell and the ones after it, and the source/model
 * round trip through the shared definition codec.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogInput } from '@/lib/datasets/types';
import { parseDatasetDefinition, serializeDatasetDefinition } from '@/lib/datasets/definition';
import { addCell, catalog, change, click, connection, discover, editor, installDatasetFetch, savedDefinition, selectOrders, state, tables } from '@/test/helpers/dataset-catalog';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: state.viewerSession }) }));
beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dataset editor — the notebook', () => {
  it.each(['metaKey', 'ctrlKey'])('runs the focused notebook cell with %s+Enter while plain Enter stays editable', async modifier => {
    editor(); await discover(); click('Add notebook cell');
    change('Cell name 1', 'orders_preview'); change('Cell SQL 1', 'select id from sales.orders');
    const sql = screen.getByLabelText('Cell SQL 1');
    fireEvent.keyDown(sql, { key: 'Enter' });
    expect(state.calls.filter(c => c.url.endsWith('/notebook/preview'))).toHaveLength(0);
    fireEvent.keyDown(sql, { key: 'Enter', [modifier]: true });
    await screen.findByLabelText('Cell preview 1');
    const requests = state.calls.filter(c => c.url.endsWith('/notebook/preview'));
    expect(requests).toHaveLength(1);
    expect(requests[0].body.notebook.cells[0].sql).toBe('select id from sales.orders');
    expect(sql).toHaveValue('select id from sales.orders');
  });

  it.each([{repeat:true},{isComposing:true},{keyCode:229}])('does not run a notebook shortcut during repeated or composing key events: %j', async extra => {
    editor(); await discover(); click('Add notebook cell'); change('Cell SQL 1','select id from sales.orders');
    fireEvent.keyDown(screen.getByLabelText('Cell SQL 1'),{key:'Enter',metaKey:true,...extra});
    expect(state.calls.filter(c => c.url.endsWith('/notebook/preview'))).toHaveLength(0);
  });

  it('runs the focused cell once and ignores shortcuts while another run is pending or source is open', async () => {
    editor(); await discover(); await addCell('base','select id from sales.orders'); click('Add notebook cell'); change('Cell SQL 2','select * from base');
    let finish!: (response:Response)=>void; state.notebookReply=()=>new Promise(resolve=>{finish=resolve;});
    fireEvent.keyDown(screen.getByLabelText('Cell SQL 2'),{key:'Enter',ctrlKey:true});
    await waitFor(() => expect(state.calls.filter(c=>c.url.endsWith('/notebook/preview'))).toHaveLength(2));
    const executed=state.calls.filter(c=>c.url.endsWith('/notebook/preview')).at(-1)?.body;
    expect(executed.cellId).toBe(executed.notebook.cells[1].id);
    fireEvent.keyDown(screen.getByLabelText('Cell SQL 1'),{key:'Enter',metaKey:true});
    expect(state.calls.filter(c=>c.url.endsWith('/notebook/preview'))).toHaveLength(2);
    finish(new Response(JSON.stringify({rows:[{id:42}],columns:[{name:'id',type:'number'}],refreshedAt:'2026-09-06T10:00:00Z'})));
    await screen.findByLabelText('Cell preview 2'); click('Edit dataset source');
    fireEvent.keyDown(screen.getByLabelText('Cell SQL 1'),{key:'Enter',ctrlKey:true});
    expect(state.calls.filter(c=>c.url.endsWith('/notebook/preview'))).toHaveLength(2);
  });

  it('ignores notebook shortcuts on an incomplete cell and keeps non-connection errors above the form', async () => {
    editor(true); await screen.findByLabelText('Password status'); click('Add notebook cell');
    fireEvent.keyDown(screen.getByLabelText('Cell SQL 1'),{key:'Enter',metaKey:true});
    expect(state.calls.filter(c=>c.url.endsWith('/notebook/preview'))).toHaveLength(0);
    click('Remove cell 1'); state.failSave=true; click('Save dataset');
    await waitFor(()=>expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Version conflict'));
    expect(within(screen.getByLabelText('Dataset connection')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('runs chained cells independently of the whitelist and retains stable IDs through insertion', async () => {
    editor(); await discover(); await addCell('raw_orders', 'select id from sales.orders');
    await addCell('totals', 'select count(*) id from raw_orders', 2);
    const payload = state.calls.filter(c => c.url.endsWith('/notebook/preview')).at(-1)?.body;
    expect(payload.notebook.cells.map((cell: any) => cell.name)).toEqual(['raw_orders', 'totals']);
    expect(payload.cellId).toBe(payload.notebook.cells[1].id); expect(payload.dataset).toBeUndefined();
    click('Insert cell after 1'); change('Cell name 2', 'helper'); change('Cell SQL 2', 'select * from raw_orders'); click('Run cell 3');
    await waitFor(() => expect(state.calls.filter(c => c.url.endsWith('/notebook/preview')).at(-1)?.body.notebook.cells.map((c: any) => c.id)).toEqual([payload.notebook.cells[0].id, expect.any(String), payload.cellId]));
    click('Collapse cell 1'); expect(screen.queryByLabelText('Cell SQL 1')).not.toBeInTheDocument(); click('Collapse cell 1');
    expect(screen.getByLabelText('Cell SQL 1')).toHaveValue('select id from sales.orders');
  });

  it('invalidates edited and downstream outputs, restores selected columns by name on rerun', async () => {
    editor(); await discover(); state.previewColumns = [{name:'id',type:'number'},{name:'old',type:'string'}];
    await addCell('base', 'select id from sales.orders'); await addCell('totals', 'select * from base', 2); click('Expose cell 2');
    change('Cell SQL 1', 'select id, 1 as added from sales.orders');
    expect(screen.queryByLabelText('Cell preview 2')).not.toBeInTheDocument(); expect(screen.getByLabelText('Expose cell 2')).toBeDisabled();
    click('Save dataset'); await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent(/run.*totals/i));
    state.previewColumns = [{name:'id',type:'number'},{name:'added',type:'number'}]; click('Run cell 2'); await screen.findByLabelText('Cell preview 2');
    click('Toggle table models.totals'); expect(screen.getByLabelText('Expose column models.totals.id')).toBeChecked(); expect(screen.getByLabelText('Expose column models.totals.added')).not.toBeChecked();
  });

  it('applies source through the shared codec and saves the resulting visual definition', async () => {
    editor(true); await screen.findByLabelText('Password status'); click('Edit dataset source');
    const input: CatalogInput = { kind:'postgres', connection, notebook:{cells:[{id:'stable-cell',name:'source_model',sql:'select id from sales.orders'}]},defaultSchema:'sales',refreshSeconds:30,tables:[{schema:'sales',name:'source_model',modelCellId:'stable-cell',columns:['id']}] };
    change('Dataset source', serializeDatasetDefinition(input)); click('Apply dataset source');
    expect(screen.getByLabelText('Cell name 1')).toHaveValue('source_model'); expect(screen.getByLabelText('Refresh interval')).toHaveValue(30);
    click('Run cell 1'); await screen.findByLabelText('Cell preview 1');
    click('Edit dataset source'); expect(parseDatasetDefinition((screen.getByLabelText('Dataset source') as HTMLTextAreaElement).value)).toEqual(input);
    click('Apply dataset source'); click('Save dataset'); await waitFor(() => expect(savedDefinition()).toEqual(input));
  });

  it('auto-names inserted cells and runs the requested prefix despite an unfinished later cell', async () => {
    editor(); await discover(); await addCell('base', 'select id from sales.orders'); click('Add notebook cell');
    expect(screen.getByLabelText('Cell name 2')).toHaveValue('query_1'); click('Run cell 1');
    await waitFor(() => expect(state.calls.filter(c => c.url.endsWith('/notebook/preview'))).toHaveLength(2));
    expect(state.calls.filter(c => c.url.endsWith('/notebook/preview')).at(-1)?.body.notebook.cells).toHaveLength(1);
  });

  it('invalidates changed source notebook output and preserves real types for unchanged source', async () => {
    state.loadedCatalog={...catalog,notebook:{cells:[{id:'cell-1',name:'totals',sql:'select id from sales.orders'}]},tables:[{schema:'sales',name:'totals',modelCellId:'cell-1',columns:[{name:'id',type:'number'}]}]};
    editor(true); await screen.findByLabelText('Password status'); click('Edit dataset source'); click('Apply dataset source');
    click('Toggle table sales.totals'); expect(screen.getByLabelText('Source exposure')).toHaveTextContent('number'); expect(screen.getByLabelText('Expose cell 1')).toBeChecked();
    click('Edit dataset source'); const source=(screen.getByLabelText('Dataset source') as HTMLTextAreaElement).value;
    change('Dataset source',source.replace('select id from sales.orders','select id + 1 as id from sales.orders')); click('Apply dataset source');
    expect(screen.getByLabelText('Expose cell 1')).toBeDisabled(); expect(screen.getByLabelText('Source exposure')).not.toHaveTextContent('string'); click('Save dataset');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent(/run.*totals/i));
  });

  it('saves a fresh model-only notebook after an unchanged source roundtrip', async () => {
    editor(); await discover();
    await addCell('raw_orders','select id from sales.orders');
    await addCell('region_totals','select count(*) id from raw_orders',2);
    click('Expose cell 2'); change('Default schema','models');
    click('Edit dataset source'); click('Apply dataset source');
    expect(screen.getByLabelText('Expose cell 2')).toBeEnabled();
    expect(screen.getByLabelText('Expose cell 2')).toBeChecked();
    expect(screen.getByLabelText('Expose cell 1')).not.toBeChecked();
    expect(screen.getByLabelText('Expose table sales.orders')).not.toBeChecked();
    click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.notebook?.cells.map(cell => cell.name)).toEqual(['raw_orders','region_totals']));
    expect(savedDefinition()?.tables).toEqual([{schema:'models',name:'region_totals',modelCellId:expect.any(String),columns:['id']}]);
  });

  it('retains invalid source edits and visual draft until source is valid', async () => {
    editor(true); await screen.findByLabelText('Password status'); click('Edit dataset source'); change('Dataset source','broken'); click('Apply dataset source');
    await screen.findByLabelText('Dataset error'); expect(screen.getByLabelText('Dataset source')).toHaveValue('broken'); expect(screen.getByLabelText('Host')).toHaveValue(connection.host);
    expect(screen.getByLabelText('Save dataset')).toBeDisabled();
  });

  it('keeps final SQL explicit and retains the authored input after errors', async () => {
    editor(); await selectOrders(); click('SQL view'); const before = state.calls.filter(c => c.url === '/api/my/datasets/preview').length;
    change('Dataset SQL', 'select count(*) id from orders'); expect(state.calls.filter(c => c.url === '/api/my/datasets/preview')).toHaveLength(before);
    await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); click('Run dataset SQL'); await waitFor(() => expect(state.calls.filter(c => c.url === '/api/my/datasets/preview').at(-1)?.body.sql).toBe('select count(*) id from orders'));
    change('Dataset SQL','select forbidden from orders'); await waitFor(() => expect(screen.getByLabelText('Refresh dataset')).toBeEnabled()); click('Refresh dataset');
    await waitFor(() => expect(state.calls.filter(c => c.url === '/api/my/datasets/preview').at(-1)?.body.sql).toBe('select count(*) id from orders'));
    await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); state.failPreview = true; click('Run dataset SQL'); await screen.findByLabelText('Dataset preview error'); expect(screen.getByLabelText('Dataset SQL')).toHaveValue('select forbidden from orders');
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
  });

  it('does not rerun final SQL when notebook presentation or an unexposed draft changes', async () => {
    editor(); await selectOrders(); await addCell('helper', 'select id from sales.orders');
    click('SQL view'); change('Dataset SQL','select id from orders'); await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); click('Run dataset SQL');
    await waitFor(() => expect(screen.getByLabelText('Refresh dataset')).toBeEnabled());
    const before=state.calls.filter(c => c.url === '/api/my/datasets/preview').length;
    click('Collapse cell 1'); click('Collapse cell 1'); change('Cell SQL 1','select id + 1 from sales.orders');
    expect(state.calls.filter(c => c.url === '/api/my/datasets/preview')).toHaveLength(before);
  });

  it('preserves discovered raw columns when source is applied unchanged', async () => {
    state.loadedCatalog={...catalog,notebookSources:tables}; editor(true); await screen.findByLabelText('Password status');
    click('Edit dataset source'); click('Apply dataset source'); expect(screen.getByLabelText('Expose table crm.people')).not.toBeChecked();
    click('Toggle table sales.orders'); expect(screen.getByLabelText('Expose column sales.orders.secret')).not.toBeChecked();
    expect(screen.getByLabelText('Source exposure')).toHaveTextContent('number');
  });

  it('preserves and edits legacy SQL model definitions without changing their resolution semantics', async () => {
    state.loadedCatalog={...catalog,tables:[...catalog.tables,{schema:'sales',name:'summary',sql:'select id from orders',columns:[{name:'id',type:'number'}]}]};
    editor(true); await screen.findByLabelText('Password status');
    expect(screen.getByLabelText('Cell SQL 1')).toHaveValue('select id from orders');
    change('Cell SQL 1','select id from orders where id > 0'); click('Run cell 1'); await screen.findByLabelText('Cell preview 1'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toContainEqual({schema:'sales',name:'summary',sql:'select id from orders where id > 0'}));
    expect(state.calls.find(c => c.url === '/api/my/datasets/preview')?.body.datasetId).toBe('data-1');
    expect(savedDefinition()?.notebook?.cells).toEqual([]);
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { DatasetEditorPage } from '../pages/DatasetEditor';
import { DatasetCatalogView } from '@/components/DatasetCatalogView';
import { parseDatasetDefinition, serializeDatasetDefinition } from '@/lib/datasets/definition';
import type { CatalogInput, DatasetCatalog } from '@/lib/datasets/types';

let viewerSession: { user: { id: string } | null } | null = { user: { id: 'editor-1' } };
vi.mock('@/web/session', () => ({ useSession: () => ({ session: viewerSession }) }));
const connection = { host: 'db.example.com', port: 5432, database: 'analytics', username: 'reader', ssl: true, passwordSecretId: 'secret-1' };
const tables = [
  { schema: 'sales', name: 'orders', columns: [{ name: 'id', type: 'number' as const }, { name: 'secret', type: 'string' as const }] },
  { schema: 'crm', name: 'people', columns: [{ name: 'name', type: 'string' as const }] },
];
const catalog: DatasetCatalog = { kind: 'postgres', connection, defaultSchema: 'sales', refreshSeconds: 60, notebook: { cells: [] }, tables: [{ ...tables[0], columns: [tables[0].columns[0]], source: { schema: 'sales', table: 'orders' } }] };
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let calls: Array<{ url: string; body: any; method: string }>;
let failSave = false;
let failPreview = false;
let loadedCatalog = catalog;
let discoveryTables = tables;
let discoveryReply: (() => Promise<Response>) | undefined;
let previewColumns = [{ name: 'id', type: 'number' }];
beforeEach(() => {
  calls = []; discoveryTables = tables; discoveryReply = undefined; failSave = false; failPreview = false; loadedCatalog = catalog; previewColumns = [{ name: 'id', type: 'number' }]; viewerSession = { user: { id: 'editor-1' } };
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? 'GET'; calls.push({ url, body, method });
    if (url === '/api/my/secrets') return reply({ secret: { id: 'secret-new' } }, 201);
    if (url === '/api/my/datasets/discover') return discoveryReply ? discoveryReply() : reply({ tables: discoveryTables });
    if (url.endsWith('/preview') || url.endsWith('/tables')) return failPreview ? reply({ error: 'Query refused' }, 400) : reply({ rows: [{ id: 42 }], columns: previewColumns, refreshedAt: '2026-09-06T10:00:00Z', truncated: true });
    if (method === 'GET') return reply({ id: 'data-1', title: 'Orders', version: 7, meta: { catalog: loadedCatalog } });
    return failSave ? reply({ error: 'Version conflict' }, 409) : reply({ id: 'data-1', version: 8 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function editor(edit = false) {
  render(<MemoryRouter initialEntries={[edit ? '/datasets/data-1/edit' : '/datasets/new']}><Routes><Route path="/login" element={<p aria-label="Dataset login">Log in</p>} /><Route path="/datasets/new" element={<DatasetEditorPage />} /><Route path="/datasets/:id/edit" element={<DatasetEditorPage />} /><Route path="/a/:id" element={<p aria-label="Saved dataset">Saved</p>} /></Routes></MemoryRouter>);
}
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (label: string) => fireEvent.click(screen.getByLabelText(label));
async function discover() {
  click('PostgreSQL');
  for (const [label, value] of [['Host', connection.host], ['Database', 'analytics'], ['Username', 'reader'], ['Password', 'private-password']]) change(label, value);
  click('Test and discover');
  await screen.findByLabelText('Expose table sales.orders');
}
async function selectOrders() {
  await discover(); click('Toggle table sales.orders'); click('Expose column sales.orders.id'); change('Default schema', 'sales');
}
async function addCell(name: string, sql: string, index = 1) {
  click('Add notebook cell'); change(`Cell name ${index}`, name); change(`Cell SQL ${index}`, sql); click(`Run cell ${index}`);
  await screen.findByLabelText(`Cell preview ${index}`);
}
function savedDefinition() {
  const write = calls.find(c => c.url.startsWith('/api/my/artifacts') && c.method !== 'GET');
  return write ? parseDatasetDefinition(write.body.dataset) : undefined;
}
describe('dataset editor', () => {
  it.each(['metaKey', 'ctrlKey'])('runs the focused notebook cell with %s+Enter while plain Enter stays editable', async modifier => {
    editor(); await discover(); click('Add notebook cell');
    change('Cell name 1', 'orders_preview'); change('Cell SQL 1', 'select id from sales.orders');
    const sql = screen.getByLabelText('Cell SQL 1');
    fireEvent.keyDown(sql, { key: 'Enter' });
    expect(calls.filter(c => c.url.endsWith('/notebook/preview'))).toHaveLength(0);
    fireEvent.keyDown(sql, { key: 'Enter', [modifier]: true });
    await screen.findByLabelText('Cell preview 1');
    const requests = calls.filter(c => c.url.endsWith('/notebook/preview'));
    expect(requests).toHaveLength(1);
    expect(requests[0].body.notebook.cells[0].sql).toBe('select id from sales.orders');
    expect(sql).toHaveValue('select id from sales.orders');
  });
  it('shows discovery progress and success beside the connection action, clearing stale success when edited', async () => {
    let finish!: (response: Response) => void;
    discoveryReply = () => new Promise(resolve => { finish = resolve; });
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover');
    const panel = within(screen.getByLabelText('Dataset connection'));
    expect(panel.getByRole('status')).toHaveTextContent(/connecting/i);
    expect(panel.getByLabelText('Test and discover')).toBeDisabled();
    finish(new Response(JSON.stringify({ tables })));
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent(/connected.*2 tables/i));
    expect(panel.getByLabelText('Test and discover').compareDocumentPosition(panel.getByRole('status')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    change('Host', 'another.example.com');
    expect(panel.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows discovery failure beside the connection action and replaces it on retry', async () => {
    discoveryReply = () => reply({ error: 'Could not connect to PostgreSQL.' }, 400);
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover');
    const panel = within(screen.getByLabelText('Dataset connection'));
    await waitFor(() => expect(panel.getByRole('alert')).toHaveTextContent('Could not connect'));
    expect(panel.getByLabelText('Test and discover')).toBeEnabled();
    discoveryReply = undefined; click('Test and discover');
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Connected'));
    expect(panel.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('uses a neutral create label while the session is loading and never fetches connections', async () => {
    viewerSession = null; editor();
    expect(await screen.findByLabelText('Save dataset')).toHaveTextContent(/^Create dataset$/);
    expect(calls.some(c => c.url.includes('/connections'))).toBe(false);
  });
  it('sends signed-out creators to login', async () => {
    viewerSession = { user: null }; editor(); await screen.findByLabelText('Dataset login');
  });
  it('sends passwords only to the write-only secrets endpoint and discovers using the reference', async () => {
    editor(); await discover();
    const { passwordSecretId: _, ...destination } = connection;
    expect(calls.find(c => c.url === '/api/my/secrets')?.body).toEqual({ value: 'private-password', connection: destination });
    expect(calls.find(c => c.url.endsWith('/discover'))?.body).toEqual({ connection: { ...destination, passwordSecretId: 'secret-new' } });
    expect(calls.filter(c => c.url !== '/api/my/secrets').every(c => !JSON.stringify(c).includes('private-password'))).toBe(true);
    expect(screen.getByLabelText('Password status')).toHaveTextContent('Configured');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    click('Replace password'); expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByLabelText('Connection name')).not.toBeInTheDocument();
  });
  it('requires a replacement credential when the connection destination changes', async () => {
    editor(true); await screen.findByLabelText('Password status'); change('Host', 'other.example.com');
    expect(screen.getByLabelText('Password')).toHaveValue(''); click('Test and discover');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent(/password/i));
    expect(calls.some(c => c.url.endsWith('/discover'))).toBe(false);
  });
  it('keeps notebook before whitelist, synchronizes Expose with column selections and saves markup', async () => {
    editor(); await discover();
    expect(screen.getByLabelText('Data models notebook').compareDocumentPosition(screen.getByLabelText('Source exposure')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    previewColumns = [{ name: 'id', type: 'number' }, { name: 'total', type: 'number' }];
    await addCell('totals', 'select id, sum(amount) total from sales.orders group by id');
    expect(screen.getByLabelText('Expose cell 1')).not.toBeChecked(); click('Expose cell 1');
    expect(screen.getByLabelText('Expose table models.totals')).toBeChecked(); click('Toggle table models.totals'); click('Expose column models.totals.total');
    expect(screen.getByLabelText('Expose cell 1')).toBePartiallyChecked(); click('Expose table models.totals');
    expect(screen.getByLabelText('Expose cell 1')).toBeChecked(); change('Default schema', 'models'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{ schema: 'models', name: 'totals', modelCellId: expect.any(String), columns: ['id', 'total'] }]));
    expect(typeof calls.find(c => c.url === '/api/my/artifacts')?.body.dataset).toBe('string');
    expect(savedDefinition()?.connection?.passwordSecretId).toBe('secret-new');
  });
  it('runs chained cells independently of the whitelist and retains stable IDs through insertion', async () => {
    editor(); await discover(); await addCell('raw_orders', 'select id from sales.orders');
    await addCell('totals', 'select count(*) id from raw_orders', 2);
    const payload = calls.filter(c => c.url.endsWith('/notebook/preview')).at(-1)?.body;
    expect(payload.notebook.cells.map((cell: any) => cell.name)).toEqual(['raw_orders', 'totals']);
    expect(payload.cellId).toBe(payload.notebook.cells[1].id); expect(payload.dataset).toBeUndefined();
    click('Insert cell after 1'); change('Cell name 2', 'helper'); change('Cell SQL 2', 'select * from raw_orders'); click('Run cell 3');
    await waitFor(() => expect(calls.filter(c => c.url.endsWith('/notebook/preview')).at(-1)?.body.notebook.cells.map((c: any) => c.id)).toEqual([payload.notebook.cells[0].id, expect.any(String), payload.cellId]));
    click('Collapse cell 1'); expect(screen.queryByLabelText('Cell SQL 1')).not.toBeInTheDocument(); click('Collapse cell 1');
    expect(screen.getByLabelText('Cell SQL 1')).toHaveValue('select id from sales.orders');
  });
  it('invalidates edited and downstream outputs, restores selected columns by name on rerun', async () => {
    editor(); await discover(); previewColumns = [{name:'id',type:'number'},{name:'old',type:'string'}];
    await addCell('base', 'select id from sales.orders'); await addCell('totals', 'select * from base', 2); click('Expose cell 2');
    change('Cell SQL 1', 'select id, 1 as added from sales.orders');
    expect(screen.queryByLabelText('Cell preview 2')).not.toBeInTheDocument(); expect(screen.getByLabelText('Expose cell 2')).toBeDisabled();
    click('Save dataset'); await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent(/run.*totals/i));
    previewColumns = [{name:'id',type:'number'},{name:'added',type:'number'}]; click('Run cell 2'); await screen.findByLabelText('Cell preview 2');
    click('Toggle table models.totals'); expect(screen.getByLabelText('Expose column models.totals.id')).toBeChecked(); expect(screen.getByLabelText('Expose column models.totals.added')).not.toBeChecked();
  });
  it('allows every authorized editor to configure the connection, notebook and source whitelist', async () => {
    editor(true); await screen.findByLabelText('Password status');
    expect(screen.getByLabelText('Host')).toBeEnabled(); expect(screen.getByLabelText('Test and discover')).toBeEnabled(); expect(screen.getByLabelText('Expose table sales.orders')).toBeEnabled();
    expect(screen.queryByLabelText('Shared dataset connection')).not.toBeInTheDocument();
    await addCell('helper', 'select id from sales.orders');
    expect(calls.find(c => c.url.endsWith('/notebook/preview'))?.body.datasetId).toBe('data-1');
    click('Test and discover'); await screen.findByLabelText('Expose table crm.people');
    expect(calls.find(c => c.url.endsWith('/discover'))?.body.datasetId).toBe('data-1');
  });
  it('preserves branch selection, physical mappings and excludes newly discovered columns', async () => {
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover'); await screen.findByLabelText('Expose schema crm');
    expect(screen.getByLabelText('Expose schema sales')).toBePartiallyChecked(); click('Toggle table sales.orders');
    expect(screen.getByLabelText('Expose column sales.orders.secret')).not.toBeChecked();
    expect(screen.queryByLabelText(/Logical schema/)).not.toBeInTheDocument(); click('Toggle schema sales'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{ schema:'sales', name:'orders', source:{schema:'sales',table:'orders'}, columns:['id'] }]));
  });
  it('exposes only selected columns and keeps the explicit default schema stable as tables are added', async () => {
    editor(); await selectOrders(); click('Expose table crm.people'); expect(screen.getByLabelText('Default schema')).toHaveValue('sales');
    click('Save dataset'); await waitFor(() => expect(savedDefinition()?.tables).toHaveLength(2));
    expect(calls.find(c => c.url === '/api/my/artifacts')?.body.visibility).toBe('private');
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
  it('keeps an existing dataset default schema immutable', async () => {
    editor(true); await screen.findByLabelText('Password status'); expect(screen.getByLabelText('Default schema')).toBeDisabled();
  });
  it('retains selected tables and columns that disappear on rediscovery', async () => {
    loadedCatalog={...catalog,notebookSources:tables,tables:[catalog.tables[0],{...tables[1],source:{schema:'crm',table:'people'}}]};
    discoveryTables=[{...tables[0],columns:[tables[0].columns[1]]}];
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover'); await waitFor(() => expect(screen.getByLabelText('Dataset notice')).toHaveTextContent('Connected'));
    expect(screen.getByLabelText('Expose table crm.people')).toBeChecked(); click('Toggle table sales.orders'); expect(screen.getByLabelText('Expose column sales.orders.id')).toBeChecked();
    click('Save dataset'); await waitFor(() => expect(savedDefinition()?.tables).toHaveLength(2));
    expect(savedDefinition()?.tables[0].columns).toEqual(['id']);
  });
  it('auto-names inserted cells and runs the requested prefix despite an unfinished later cell', async () => {
    editor(); await discover(); await addCell('base', 'select id from sales.orders'); click('Add notebook cell');
    expect(screen.getByLabelText('Cell name 2')).toHaveValue('query_1'); click('Run cell 1');
    await waitFor(() => expect(calls.filter(c => c.url.endsWith('/notebook/preview'))).toHaveLength(2));
    expect(calls.filter(c => c.url.endsWith('/notebook/preview')).at(-1)?.body.notebook.cells).toHaveLength(1);
  });
  it('invalidates changed source notebook output and preserves real types for unchanged source', async () => {
    loadedCatalog={...catalog,notebook:{cells:[{id:'cell-1',name:'totals',sql:'select id from sales.orders'}]},tables:[{schema:'sales',name:'totals',modelCellId:'cell-1',columns:[{name:'id',type:'number'}]}]};
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
    editor(); await selectOrders(); click('SQL view'); const before = calls.filter(c => c.url === '/api/my/datasets/preview').length;
    change('Dataset SQL', 'select count(*) id from orders'); expect(calls.filter(c => c.url === '/api/my/datasets/preview')).toHaveLength(before);
    await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); click('Run dataset SQL'); await waitFor(() => expect(calls.filter(c => c.url === '/api/my/datasets/preview').at(-1)?.body.sql).toBe('select count(*) id from orders'));
    change('Dataset SQL','select forbidden from orders'); await waitFor(() => expect(screen.getByLabelText('Refresh dataset')).toBeEnabled()); click('Refresh dataset');
    await waitFor(() => expect(calls.filter(c => c.url === '/api/my/datasets/preview').at(-1)?.body.sql).toBe('select count(*) id from orders'));
    await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); failPreview = true; click('Run dataset SQL'); await screen.findByLabelText('Dataset preview error'); expect(screen.getByLabelText('Dataset SQL')).toHaveValue('select forbidden from orders');
    expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument();
  });
  it.each(['physical', 'model'] as const)('refreshes the final preview when a %s column is removed from exposure', async tableKind => {
    const columns = [{name:'id',type:'number' as const},{name:'secret',type:'string' as const}];
    const schema = tableKind === 'physical' ? 'sales' : 'models';
    const name = tableKind === 'physical' ? 'orders' : 'totals';
    loadedCatalog={...catalog,defaultSchema:schema,
      notebook:{cells:tableKind === 'model' ? [{id:'model-1',name,sql:'select id, secret from sales.orders'}] : []},
      tables:[{schema,name,columns,...(tableKind === 'physical' ? {source:{schema:'sales',table:'orders'}} : {modelCellId:'model-1'})}],
    };
    previewColumns=columns;
    editor(true); await waitFor(() => expect(screen.getByLabelText('Table preview')).toHaveTextContent('secret'));
    const before=calls.filter(c => c.url === '/api/my/datasets/preview').length;
    click(`Toggle table ${schema}.${name}`); previewColumns=[columns[0]]; click(`Expose column ${schema}.${name}.secret`);
    await waitFor(() => expect(screen.getByLabelText('Table preview')).not.toHaveTextContent('secret'));
    expect(calls.filter(c => c.url === '/api/my/datasets/preview')).toHaveLength(before + 1);
    expect(calls.filter(c => c.url === '/api/my/datasets/preview').at(-1)?.body.dataset.tables[0].columns).toEqual(['id']);
  });
  it('does not rerun final SQL when notebook presentation or an unexposed draft changes', async () => {
    editor(); await selectOrders(); await addCell('helper', 'select id from sales.orders');
    click('SQL view'); change('Dataset SQL','select id from orders'); await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); click('Run dataset SQL');
    await waitFor(() => expect(screen.getByLabelText('Refresh dataset')).toBeEnabled());
    const before=calls.filter(c => c.url === '/api/my/datasets/preview').length;
    click('Collapse cell 1'); click('Collapse cell 1'); change('Cell SQL 1','select id + 1 from sales.orders');
    expect(calls.filter(c => c.url === '/api/my/datasets/preview')).toHaveLength(before);
  });
  it('preserves discovered raw columns when source is applied unchanged', async () => {
    loadedCatalog={...catalog,notebookSources:tables}; editor(true); await screen.findByLabelText('Password status');
    click('Edit dataset source'); click('Apply dataset source'); expect(screen.getByLabelText('Expose table crm.people')).not.toBeChecked();
    click('Toggle table sales.orders'); expect(screen.getByLabelText('Expose column sales.orders.secret')).not.toBeChecked();
    expect(screen.getByLabelText('Source exposure')).toHaveTextContent('number');
  });
  it('preserves edited title after a version conflict', async () => {
    editor(true); await screen.findByLabelText('Password status'); change('Dataset title','New title'); failSave=true; click('Save dataset');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Version conflict')); expect(screen.getByLabelText('Dataset title')).toHaveValue('New title');
    expect(calls.find(c => c.method === 'PUT')?.body.expectedVersion).toBe(7);
  });
  it('preserves and edits legacy SQL model definitions without changing their resolution semantics', async () => {
    loadedCatalog={...catalog,tables:[...catalog.tables,{schema:'sales',name:'summary',sql:'select id from orders',columns:[{name:'id',type:'number'}]}]};
    editor(true); await screen.findByLabelText('Password status');
    expect(screen.getByLabelText('Cell SQL 1')).toHaveValue('select id from orders');
    change('Cell SQL 1','select id from orders where id > 0'); click('Run cell 1'); await screen.findByLabelText('Cell preview 1'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toContainEqual({schema:'sales',name:'summary',sql:'select id from orders where id > 0'}));
    expect(calls.find(c => c.url === '/api/my/datasets/preview')?.body.datasetId).toBe('data-1');
    expect(savedDefinition()?.notebook?.cells).toEqual([]);
  });
  it('adds stored JSON rows in a named table', async () => {
    editor(); click('Add stored table'); change('Stored schema 1','main'); change('Stored table name 1','rows'); change('Stored rows 1','[{"id":1}]'); change('Default schema','main'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()).toMatchObject({kind:'stored',defaultSchema:'main',tables:[{schema:'main',name:'rows',rows:[{id:1}]}]}));
  });
  it('retains stored object data when editing metadata without new rows', async () => {
    loadedCatalog={kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'public',name:'rows',columns:[{name:'id',type:'number'}],objectKey:'private/object'}]};
    editor(true); await waitFor(() => expect(screen.getByLabelText('Dataset title')).toHaveValue('Orders')); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toEqual([{schema:'public',name:'rows'}]));
  });
});
describe('dataset catalog viewer', () => {
  it('runs SQL explicitly, pages the executed query, retains drafts on refresh and resets table mode', async () => {
    render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />); await screen.findByLabelText('Table preview');
    click('SQL view'); const count=calls.length; change('Dataset SQL','select id from orders where id > 10'); expect(calls).toHaveLength(count);
    click('Run dataset SQL'); await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({sql:'select id from orders where id > 10',offset:0}));
    await waitFor(() => expect(screen.getByLabelText('Next page')).toBeEnabled()); click('Next page'); await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({sql:'select id from orders where id > 10',offset:50}));
    change('Dataset SQL','select secret from orders'); click('Refresh dataset'); await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({sql:'select id from orders where id > 10',offset:50,refresh:true}));
    await waitFor(() => expect(screen.getByLabelText('Run dataset SQL')).toBeEnabled()); failPreview=true; click('Run dataset SQL'); await screen.findByLabelText('Dataset preview error');
    expect(screen.getByLabelText('Dataset SQL')).toHaveValue('select secret from orders'); expect(calls.at(-1)?.body.offset).toBe(0);
    failPreview=false; click('Table view'); await waitFor(() => expect(calls.at(-1)?.body).toMatchObject({sql:'SELECT * FROM "sales"."orders"',offset:0}));
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
    expect(screen.getByLabelText('Edit dataset')).toHaveAttribute('href', '/datasets/data-1/edit');
    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(calls.at(-1)?.body.offset).toBe(50));
    fireEvent.click(screen.getByLabelText('Refresh dataset'));
    await waitFor(() => expect(calls.at(-1)?.body.refresh).toBe(true));
    expect(calls[0]).toMatchObject({ url: '/a/data-1/tables', body: { sql: 'SELECT * FROM "sales"."orders"', limit: 50, offset: 0 } });
  });
  it('requeries when the selected table definition changes without changing its name', async () => {
    const view = render(<DatasetCatalogView id="data-1" catalog={catalog} canEdit={false} />);
    await screen.findByLabelText('Table preview');
    const before = calls.length;
    view.rerender(<DatasetCatalogView id="data-1" catalog={{ ...catalog, tables: catalog.tables.map(table => ({ ...table, columns: [...table.columns, { name: 'updated', type: 'string' }] })) }} canEdit={false} />);
    await waitFor(() => expect(calls.length).toBe(before + 1));
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

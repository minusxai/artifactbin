/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
/**
 * The dataset editor's SQL MODELS: cells over the stored tables, their keyboard shortcuts, and their round
 * trip through the shared definition codec as `sql` tables.
 */
import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalog, change, click, editor, installDatasetFetch, savedDefinition, state } from '@/solid/test/dataset-catalog';

vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => state.viewerSession }) }));
beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const cellRuns = (sql: string) => state.calls.filter(c => c.url === '/api/my/datasets/preview' && c.body.sql === sql);

describe('dataset editor — SQL models', () => {
  it.each(['metaKey', 'ctrlKey'])('runs the focused model cell with %s+Enter while plain Enter stays editable', async modifier => {
    editor(true); await screen.findByDisplayValue('Orders'); click('Add notebook cell');
    change('Cell name 1', 'orders_preview'); change('Cell SQL 1', 'select id from orders');
    const sql = screen.getByLabelText('Cell SQL 1');
    fireEvent.keyDown(sql, { key: 'Enter' });
    expect(cellRuns('select id from orders')).toHaveLength(0);
    fireEvent.keyDown(sql, { key: 'Enter', [modifier]: true });
    await screen.findByLabelText('Cell preview 1');
    expect(cellRuns('select id from orders')).toHaveLength(1);
    expect(cellRuns('select id from orders')[0]?.body.datasetId).toBe('data-1');
    expect(sql).toHaveValue('select id from orders');
  });

  it.each([{repeat:true},{isComposing:true},{keyCode:229}])('does not run a model shortcut during repeated or composing key events: %j', async extra => {
    editor(true); await screen.findByDisplayValue('Orders'); click('Add notebook cell'); change('Cell SQL 1','select id from orders');
    fireEvent.keyDown(screen.getByLabelText('Cell SQL 1'),{key:'Enter',metaKey:true,...extra});
    expect(cellRuns('select id from orders')).toHaveLength(0);
  });

  it('preserves and edits SQL model definitions without changing their resolution semantics', async () => {
    state.loadedCatalog={...catalog,tables:[...catalog.tables,{schema:'sales',name:'summary',sql:'select id from orders',columns:[{name:'id',type:'number'}]}]};
    editor(true); await screen.findByDisplayValue('Orders');
    expect(screen.getByLabelText('Cell SQL 1')).toHaveValue('select id from orders');
    change('Cell SQL 1','select id from orders where id > 0'); click('Run cell 1'); await screen.findByLabelText('Cell preview 1'); click('Save dataset');
    await waitFor(() => expect(savedDefinition()?.tables).toContainEqual({schema:'sales',name:'summary',sql:'select id from orders where id > 0'}));
    expect(cellRuns('select id from orders where id > 0')[0]?.body.datasetId).toBe('data-1');
  });

  it('requires an edited model to run again before saving', async () => {
    state.loadedCatalog={...catalog,tables:[...catalog.tables,{schema:'sales',name:'summary',sql:'select id from orders',columns:[{name:'id',type:'number'}]}]};
    editor(true); await screen.findByDisplayValue('Orders');
    change('Cell SQL 1','select id from orders where id > 1'); click('Save dataset');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent('Run summary again'));
    expect(state.calls.some(c => c.url.startsWith('/api/my/artifacts') && c.method !== 'GET')).toBe(false);
  });
});

/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { change, click, editor, installDatasetFetch, reply, savedDefinition, state } from '@/solid/test/dataset-catalog';

vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => state.viewerSession }) }));
beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function importReply(response: () => Promise<Response>) {
  const fallback = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/my/datasets/import') {
      state.calls.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body)) });
      return response();
    }
    return fallback(url, init);
  }));
}
const rows = [{ name: 'Ada', score: 42 }];
const result = { rows, rowCount: 1, totalRows: 1, truncated: false, headers: ['name', 'score'] };

it('offers explicit source choices and keeps added tables when switching inputs', () => {
  editor();
  for (const name of ['CSV', 'Google Sheets', 'JSON', 'PostgreSQL']) expect(screen.getByRole('tab', { name })).toBeInTheDocument();
  expect(screen.getByLabelText('CSV file')).toBeVisible();
  expect(screen.queryByLabelText('Google Sheet URL')).not.toBeInTheDocument();
  click('Google Sheets');
  expect(screen.getByLabelText('Google Sheet URL')).toBeVisible();
  expect(screen.queryByLabelText('CSV file')).not.toBeInTheDocument();
  click('JSON'); click('Add JSON table');
  change('Stored table name 1', 'orders'); change('Stored rows 1', '[{"id":1}]');
  click('CSV');
  expect(screen.getByLabelText('Stored rows 1')).toHaveValue('[{"id":1}]');
});

it('imports a CSV into the draft, preserving existing tables, and saves the imported rows only on create', async () => {
  importReply(() => reply(result)); editor();
  click('JSON'); click('Add JSON table'); change('Stored table name 1', 'existing'); change('Stored rows 1', '[{"id":1}]');
  click('CSV');
  const file = new File(['name,score\nAda,42'], 'scores.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('CSV file'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('Stored rows 2')).toHaveValue(JSON.stringify(rows, null, 2)));
  expect(screen.getByLabelText('Stored table name 2')).toHaveValue('scores');
  expect(screen.getByLabelText('Stored rows 1')).toHaveValue('[{"id":1}]');
  expect(state.calls.find(c => c.url.endsWith('/import'))?.body).toEqual({ kind: 'csv', text: 'name,score\nAda,42' });
  expect(savedDefinition()).toBeUndefined();
  change('Dataset title', 'Scores'); click('Save dataset');
  await waitFor(() => expect(savedDefinition()?.tables).toEqual(expect.arrayContaining([expect.objectContaining({ schema: 'public', name: 'scores', rows })])));
});

it('imports a public Google Sheet snapshot and reports row truncation', async () => {
  importReply(() => reply({ ...result, totalRows: 200, truncated: true })); editor();
  click('Google Sheets');
  change('Google Sheet URL', 'https://docs.google.com/spreadsheets/d/example/edit#gid=7');
  click('Import sheet');
  await waitFor(() => expect(screen.getByLabelText('Stored rows 1')).toHaveValue(JSON.stringify(rows, null, 2)));
  expect(state.calls.find(c => c.url.endsWith('/import'))?.body).toEqual({ kind: 'sheetUrl', url: 'https://docs.google.com/spreadsheets/d/example/edit#gid=7' });
  expect(screen.getByRole('status')).toHaveTextContent('Imported 1 of 200 rows');
  expect(savedDefinition()).toBeUndefined();
  change('Dataset title', 'Sheet'); click('Save dataset');
  await waitFor(() => expect(savedDefinition()?.tables[0]?.rows).toEqual(rows));
});

it('prevents saving during import and preserves the draft after a failed sheet import, allowing retry', async () => {
  let finish!: (value: Response) => void;
  importReply(() => new Promise(resolve => { finish = resolve; })); editor();
  click('JSON'); click('Add JSON table'); change('Stored table name 1', 'sheet'); change('Stored rows 1', '[{"id":1}]');
  click('Google Sheets');
  change('Google Sheet URL', 'https://docs.google.com/spreadsheets/d/example/edit'); click('Import sheet');
  expect(screen.getByLabelText('Save dataset')).toBeDisabled();
  await waitFor(() => expect(state.calls.filter(c => c.url.endsWith('/import'))).toHaveLength(1));
  finish(await reply({ error: 'invalid_dataset', details: ['That sheet is not publicly readable.'] }, 400));
  expect(await screen.findByRole('alert')).toHaveTextContent('That sheet is not publicly readable.');
  expect(screen.getByLabelText('Stored rows 1')).toHaveValue('[{"id":1}]');
  expect(screen.queryByLabelText('Stored rows 2')).not.toBeInTheDocument();
  click('Import sheet');
  await waitFor(() => expect(state.calls.filter(c => c.url.endsWith('/import'))).toHaveLength(2));
  finish(await reply(result));
  await screen.findByLabelText('Stored rows 2');
  expect(screen.getByLabelText('Stored table name 2')).toHaveValue('sheet_2');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('preserves declared stored column types when source markup is applied and saved', async () => {
  editor(); change('Dataset title', 'Typed quantities'); click('Edit dataset source');
  change('Dataset source', '<Dataset kind="stored"><Table schema="public" name="quantities" columns={[{"name":"quantity","type":"number"}]} rows={[{"quantity":3}]} /></Dataset>');
  click('Apply dataset source'); click('Save dataset');
  await waitFor(() => expect(savedDefinition()?.tables[0]).toEqual(expect.objectContaining({columns:[{name:'quantity',type:'number'}], rows:[{quantity:3}]})));
});


it('retains typed loaded table shape and user constraints when another table is added', async () => {
  const columns = [{ name: 'quantity', type: 'number' as const, choices: [1, 3] }, { name: 'owner', type: 'user' as const, constraints: { self: true, memberOf: ['current'] } }];
  state.loadedCatalog = { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [{ schema: 'public', name: 'quantities', columns, objectKey: 'obj-1' }] };
  editor(true);
  await screen.findByLabelText('Stored rows 1');
  click('Add JSON table'); change('Stored table name 2', 'inferred'); change('Stored rows 2', '[{"name":"Ada"}]');
  click('Save dataset');
  await waitFor(() => expect(savedDefinition()?.tables).toEqual([
    { schema: 'public', name: 'quantities', columns },
    { schema: 'public', name: 'inferred', rows: [{ name: 'Ada' }] },
  ]));
});

it('keeps explicit empty table columns and a rejected typed draft for correction and retry', async () => {
  const fallback = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/my/artifacts' && init?.method === 'POST' && state.calls.filter(c => c.url === url).length === 0) {
      state.calls.push({ url, method: 'POST', body: JSON.parse(String(init.body)) });
      return reply({ error: 'invalid_dataset', details: ['Column quantity expects a number.'] }, 400);
    }
    return fallback(url, init);
  }));
  editor(); change('Dataset title', 'Typed quantities'); click('Edit dataset source');
  change('Dataset source', '<Dataset kind="stored"><Table schema="public" name="quantities" columns={[{"name":"quantity","type":"number"}]} rows={[{"quantity":"invalid"}]} /><Table schema="public" name="empty" columns={["name"]} rows={[]} /></Dataset>');
  click('Apply dataset source'); click('Save dataset');
  await waitFor(() => expect(savedDefinition()?.tables[0]?.columns).toEqual([{ name: 'quantity', type: 'number' }]));
  expect(await screen.findByRole('alert')).toHaveTextContent('Column quantity expects a number.');
  expect(screen.getByLabelText('Stored rows 1')).toHaveValue(JSON.stringify([{ quantity: 'invalid' }], null, 2));
  expect(savedDefinition()?.tables[1]).toEqual({ schema: 'public', name: 'empty', columns: ['name'], rows: [] });
  change('Stored rows 1', '[{"quantity":3}]'); click('Save dataset');
  await waitFor(() => expect(state.calls.filter(c => c.url === '/api/my/artifacts')).toHaveLength(2));
  const retry = state.calls.filter(c => c.url === '/api/my/artifacts')[1];
  expect(retry.body.dataset).toContain('"type":"number"');
  expect(retry.body.dataset).toContain('"quantity":3');
});

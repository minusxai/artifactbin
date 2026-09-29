/**
 * One dataset fixture for `web/__tests__/dataset-catalog-viewer.ui.test.tsx` (the still-React-owned
 * reader view, `components/DatasetCatalogView` — a dataset's non-edit address stays React; only its
 * `/edit` address is Solid, see lib/solid-routes isSolidPage): the same PostgreSQL catalog and one
 * fetch stub standing in for discovery, secrets, notebook previews, sharing, policy and save.
 * The editor itself is ported to Solid (solid/pages/DatasetEditor, fixture at solid/test/dataset-catalog).
 *
 * Every knob a case needs to turn lives on `state` rather than in a module
 * `let`, because an imported binding cannot be assigned to. `state` is reset
 * by `installDatasetFetch()`, which each file calls from its own `beforeEach`.
 */
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { DatasetCatalog } from '@/lib/datasets/types';

export const connection = { host: 'db.example.com', port: 5432, database: 'analytics', username: 'reader', ssl: true, passwordSecretId: 'secret-1' };

export const tables = [
  { schema: 'sales', name: 'orders', columns: [{ name: 'id', type: 'number' as const }, { name: 'secret', type: 'string' as const }] },
  { schema: 'crm', name: 'people', columns: [{ name: 'name', type: 'string' as const }] },
];

export const catalog: DatasetCatalog = { kind: 'postgres', connection, defaultSchema: 'sales', refreshSeconds: 60, notebook: { cells: [] }, tables: [{ ...tables[0], columns: [tables[0].columns[0]], source: { schema: 'sales', table: 'orders' } }] };

export const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

export interface DatasetCall { url: string; body: any; method: string }

/** Everything a case may turn, in one object so it survives an import. */
export const state = {
  calls: [] as DatasetCall[],
  viewerSession: null as { user: { id: string } | null } | null,
  failSave: false,
  failPreview: false,
  loadedCatalog: catalog as DatasetCatalog,
  discoveryTables: tables as Array<Record<string, unknown>>,
  discoveryReply: undefined as (() => Promise<Response>) | undefined,
  secretReply: undefined as (() => Promise<Response>) | undefined,
  notebookReply: undefined as (() => Promise<Response>) | undefined,
  previewColumns: [{ name: 'id', type: 'number' }] as Array<{ name: string; type: string }>,
};

/** Reset every knob and install the stub. Call from `beforeEach`. */
export function installDatasetFetch() {
  state.calls = []; state.discoveryTables = tables; state.discoveryReply = undefined; state.secretReply = undefined;
  state.notebookReply = undefined; state.failSave = false; state.failPreview = false; state.loadedCatalog = catalog;
  state.previewColumns = [{ name: 'id', type: 'number' }]; state.viewerSession = { user: { id: 'editor-1' } };
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const method = init?.method ?? 'GET'; state.calls.push({ url, body, method });
    if (url.endsWith('/sharing')) return reply({ visibility: 'private', linkRole: 'viewer', shares: [], datasetKind: state.loadedCatalog.kind, access: 'read' });
    if (url.endsWith('/policy')) return reply({ canManage: true, policy: null, revision: 0, tables: state.loadedCatalog.tables, writtenBy: [] });
    if (url === '/api/my/secrets') return state.secretReply ? state.secretReply() : reply({ secret: { id: 'secret-new' } }, 201);
    if (url === '/api/my/datasets/discover') return state.discoveryReply ? state.discoveryReply() : reply({ tables: state.discoveryTables });
    if (url.endsWith('/notebook/preview') && state.notebookReply) return state.notebookReply();
    if (url.endsWith('/preview') || url.endsWith('/tables')) return state.failPreview ? reply({ error: 'Query refused' }, 400) : reply({ rows: [{ id: 42 }], columns: state.previewColumns, refreshedAt: '2026-09-06T10:00:00Z', truncated: true });
    if (method === 'GET') return reply({ id: 'data-1', title: 'Orders', version: 7, state: 'state-7', meta: { catalog: state.loadedCatalog } });
    return state.failSave ? reply({ error: 'Version conflict' }, 409) : reply({ id: 'data-1', version: 8 });
  }));
}

export const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
export const click = (label: string) => fireEvent.click(screen.getByLabelText(label));

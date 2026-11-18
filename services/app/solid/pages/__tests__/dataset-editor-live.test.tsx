/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
/**
 * The dataset editor on a live dataset (pages/DatasetEditor): its editor is the connection's form, unless the install
 * reads live data only through its default connection (`GET /api/connections` `ownConnections: false`), when it offers
 * no form and says why.
 */
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { createMemoryHistory, MemoryRouter, Route } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';
import { CONNECTORS, OWN_CONNECTIONS_OFF } from '@artifactbin/contracts';
import { DatasetEditorPage } from '@/solid/pages/DatasetEditor';
import { stubFetch } from '@/test/helpers/fetch-stub';

vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => ({ kind: 'account', user: { id: 'u1' } }) }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open(ownConnections?: boolean) {
  stubFetch({
    '/api/my/artifacts/ds1': { title: 'Shop', version: 1, state: 's1', meta: { connection: { connector: 'postgres' } } },
    '/api/connections': { connectors: CONNECTORS.map((spec) => ({ ...spec, available: true })), ...(ownConnections === undefined ? {} : { ownConnections }) },
    'GET /api/artifacts/ds1/connection': { role: 'owner', connection: { connector: 'postgres', label: 'PostgreSQL', fields: {} }, config: { connector: 'postgres', host: 'db.example.com' }, secrets: ['password'] },
  });
  const history = createMemoryHistory();
  history.set({ value: '/a/ds1/edit', replace: true });
  render(() => <MemoryRouter history={history}><Route path="/a/:id/edit" component={DatasetEditorPage} /></MemoryRouter>);
}

it.each([undefined, true])('opens the connection\'s form (ownConnections %s)', async (ownConnections) => {
  open(ownConnections);
  expect(await screen.findByRole('button', { name: 'Save connection' })).toBeInTheDocument();
});

it('offers no connection form when datasets may not have their own connection, saying why', async () => {
  open(false);
  await waitFor(() => expect(document.body).toHaveTextContent(OWN_CONNECTIONS_OFF.message));
  expect(screen.queryByRole('button', { name: 'Save connection' })).toBeNull();
});

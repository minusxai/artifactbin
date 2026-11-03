/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import ResolversPanel from '../ResolversPanel';
import DocumentSettings from '../DocumentSettings';

type Call = { url: string; method: string; body: unknown };
const VALUE = 'private-panel-value';
function serve(answers: { set?: string[]; test?: boolean; graphql?: () => { status: number; body: unknown } } = {}) {
  const calls: Call[] = [];
  let set = answers.set ?? [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'sheets', backendId: 'b1', version: 'v1', test: answers.test ?? true, secrets: { GOOGLE_SA: 'sheets.googleapis.com' }, set }] });
    if (url === '/api/my/resolvers/b1/v1/secrets') {
      set = method === 'PUT' ? ['GOOGLE_SA'] : [];
      return reply({ names: set });
    }
    if (url === '/api/artifacts/Abc123/graphql') { const answer = answers.graphql?.() ?? { status: 200, body: { data: { sheets: { test: 'Read 12 rows' } } } }; return reply(answer.body, answer.status); }
    return reply({ error: 'not_found' }, 404);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const resolver = async () => within(await screen.findByRole('region', { name: 'Resolver sheets' }));

it('lists each secret with its bound host and status, and saves a value through a write-only input', async () => {
  const calls = serve();
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  expect(panel.getByText('GOOGLE_SA')).toBeTruthy();
  expect(panel.getByText('sheets.googleapis.com')).toBeTruthy();
  expect(panel.getByText('Not set')).toBeTruthy();
  expect(panel.queryByRole('button', { name: 'Remove secret' })).toBeNull();
  const input = panel.getByLabelText('Value for GOOGLE_SA') as HTMLInputElement;
  expect(input.type).toBe('password');
  fireEvent.input(input, { target: { value: VALUE } });
  fireEvent.click(panel.getByRole('button', { name: 'Save secret' }));
  await waitFor(() => expect(panel.getByText('Set')).toBeTruthy());
  expect(calls.find(call => call.method === 'PUT')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'PUT', body: { name: 'GOOGLE_SA', value: VALUE } });
  expect(input.value).toBe('');
  expect(document.body.innerHTML).not.toContain(VALUE);
});

it('removes a set value', async () => {
  const calls = serve({ set: ['GOOGLE_SA'] });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  expect(panel.getByText('Set')).toBeTruthy();
  fireEvent.click(panel.getByRole('button', { name: 'Test connection' }));
  expect(await panel.findByText('Read 12 rows')).toBeTruthy();
  fireEvent.click(panel.getByRole('button', { name: 'Remove secret' }));
  await waitFor(() => expect(panel.getByText('Not set')).toBeTruthy());
  // A result from before the change no longer describes the connection.
  expect(panel.queryByText('Read 12 rows')).toBeNull();
  expect(calls.find(call => call.method === 'DELETE')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'DELETE', body: { name: 'GOOGLE_SA' } });
});

it('runs the test field on the page revision as the owner and shows the returned string', async () => {
  const calls = serve({ set: ['GOOGLE_SA'] });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  fireEvent.click(panel.getByRole('button', { name: 'Test connection' }));
  expect(await panel.findByText('Read 12 rows')).toBeTruthy();
  expect(calls.find(call => call.method === 'POST')).toEqual({ url: '/api/artifacts/Abc123/graphql', method: 'POST', body: { query: 'query ResolverTest { sheets { test } }', revision: 'r7' } });
});

it('shows the refusal code and the owner detail when the test fails', async () => {
  serve({ graphql: () => ({ status: 200, body: { data: { sheets: null }, errors: [{ message: 'Backend execution failed', extensions: { code: 'secret_unavailable', detail: 'GOOGLE_SA is not set' } }] } }) });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  fireEvent.click(panel.getByRole('button', { name: 'Test connection' }));
  expect(await panel.findByRole('alert')).toHaveTextContent('secret_unavailable: GOOGLE_SA is not set');
});

it('offers no Test connection when the resolver declares no test field', async () => {
  serve({ test: false });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  expect(panel.queryByRole('button', { name: 'Test connection' })).toBeNull();
});

it('puts the Resolvers tab in the settings for the page owner only', async () => {
  serve();
  const backend = { load: async () => ({ id: 'Abc123', title: 'Budget', markup: null, html: '<p>App</p>', theme: null, version: 1, edit_id: 'e1', refs: [] }) } as never;
  const editor = render(() => <DocumentSettings id="Abc123" title="Budget" owner={false} backend={backend} onPwaEnabledChange={() => {}} onClose={() => {}} />);
  await screen.findByRole('tab', { name: 'App' });
  expect(screen.queryByRole('tab', { name: 'Resolvers' })).toBeNull();
  editor.unmount();
  render(() => <DocumentSettings id="Abc123" title="Budget" owner backend={backend} onPwaEnabledChange={() => {}} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Resolvers' }));
  expect(await screen.findByRole('region', { name: 'Resolver sheets' })).toBeTruthy();
});

it('saves a Postgres connection as one write-only form and says to use a read-only user', async () => {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'shop', backendId: 'b1', version: 'v1', test: false, secrets: { WAREHOUSE: 'postgres' }, set: [] }] });
    return reply({ names: method === 'PUT' ? ['WAREHOUSE'] : [] });
  }));
  render(() => <ResolversPanel id="Abc123" />);
  const panel = within(await screen.findByRole('region', { name: 'Resolver shop' }));
  expect(panel.getByText('Postgres connection')).toBeTruthy();
  expect(panel.getByText(/Use a read-only database user/)).toBeTruthy();
  const save = panel.getByRole('button', { name: 'Save connection' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  const fill = { Host: 'db.example.com', Port: '6543', Database: 'shop', User: 'reader', Password: VALUE };
  for (const [label, value] of Object.entries(fill)) fireEvent.input(panel.getByLabelText(`${label} for WAREHOUSE`), { target: { value } });
  expect((panel.getByLabelText('Password for WAREHOUSE') as HTMLInputElement).type).toBe('password');
  fireEvent.click(save);
  await waitFor(() => expect(panel.getByText('Set')).toBeTruthy());
  expect(calls.find(call => call.method === 'PUT')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'PUT', body: { name: 'WAREHOUSE', connection: { host: 'db.example.com', port: 6543, database: 'shop', user: 'reader', password: VALUE } } });
  expect((panel.getByLabelText('Password for WAREHOUSE') as HTMLInputElement).value).toBe('');
  expect(document.body.innerHTML).not.toContain(VALUE);
});

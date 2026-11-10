/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import ResolversPanel from '../ResolversPanel';
import DocumentSettings from '../DocumentSettings';

type Call = { url: string; method: string; body: unknown };
const VALUE = 'private-panel-value';
function serve(answers: { set?: string[]; test?: boolean; schedules?: unknown[]; graphql?: () => { status: number; body: unknown } } = {}) {
  const calls: Call[] = [];
  let set = answers.set ?? [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'sheets', backendId: 'b1', version: 'v1', test: answers.test ?? true, secrets: { GOOGLE_SA: 'sheets.googleapis.com' }, set, ...(answers.schedules ? { schedules: answers.schedules } : {}) }] });
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

it('runs a function file\'s test function as GET /fn/test on the page revision, and shows a refusal\'s code, message and detail', async () => {
  const calls: Array<{ url: string; headers: unknown }> = [];
  let answer: { status: number; body: unknown } = { status: 200, body: 'Read 3 items' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: init?.headers });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'sheets', backendId: 'b1', version: 'v1', test: true, functions: true, secrets: { GOOGLE_SA: 'sheets.googleapis.com' }, set: ['GOOGLE_SA'] }] });
    if (url === '/api/artifacts/Abc123/fn/test') return reply(answer.body, answer.status);
    return reply({ error: 'not_found' }, 404);
  }));
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  fireEvent.click(panel.getByRole('button', { name: 'Test connection' }));
  expect(await panel.findByText('Read 3 items')).toBeTruthy();
  expect(calls.find(call => call.url.includes('/fn/'))).toEqual({ url: '/api/artifacts/Abc123/fn/test', headers: { 'x-page-revision': 'r7' } });
  expect(calls.some(call => call.url.endsWith('/graphql'))).toBe(false);
  answer = { status: 500, body: { error: 'backend_failed', message: 'The function failed', detail: 'secret_unavailable: GOOGLE_SA' } };
  fireEvent.click(panel.getByRole('button', { name: 'Test connection' }));
  expect(await panel.findByRole('alert')).toHaveTextContent('backend_failed: The function failed: secret_unavailable: GOOGLE_SA');
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

it('shows each connection with its declared type and that type\'s default port, and says the password stays in the worker', async () => {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'shop', backendId: 'b1', version: 'v1', test: false, secrets: { SHOP: 'mysql', WAREHOUSE: 'postgres' }, set: [] }] });
    return reply({ names: method === 'PUT' ? ['SHOP'] : [] });
  }));
  render(() => <ResolversPanel id="Abc123" />);
  const panel = within(await screen.findByRole('region', { name: 'Resolver shop' }));
  expect(panel.getByText('MySQL connection')).toBeTruthy();
  expect(panel.getByText('Postgres connection')).toBeTruthy();
  expect((panel.getByLabelText('Port for SHOP') as HTMLInputElement).value).toBe('3306');
  expect((panel.getByLabelText('Port for WAREHOUSE') as HTMLInputElement).value).toBe('5432');
  for (const hint of panel.getAllByText(/Use a read-only database user/)) expect(hint.textContent).toContain('The password stays in the runner\'s worker process and never reaches resolver code.');
  expect(document.body.textContent).not.toMatch(/sandboxed run|editors can read/);
  const fill = { Host: 'db.example.com', Database: 'shop', User: 'reader', Password: VALUE };
  for (const [label, value] of Object.entries(fill)) fireEvent.input(panel.getByLabelText(`${label} for SHOP`), { target: { value } });
  fireEvent.click(panel.getAllByRole('button', { name: 'Save connection' })[0]!);
  await waitFor(() => expect(panel.getByText('Set')).toBeTruthy());
  expect(calls.find(call => call.method === 'PUT')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'PUT', body: { name: 'SHOP', connection: { host: 'db.example.com', port: 3306, database: 'shop', user: 'reader', password: VALUE } } });
});

it.each([[['184.169.146.94'], true], [[], false]] as const)('lists the deployment outbound IPs %j on each database connection only when there are any', async (ips, shown) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/outbound-ips') return reply({ ips });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'shop', backendId: 'b1', version: 'v1', test: false, secrets: { API_KEY: 'api.example.com', SHOP: 'mysql', WAREHOUSE: 'postgres' }, set: [] }] });
    return reply({ error: 'not_found' });
  }));
  render(() => <ResolversPanel id="Abc123" />);
  const panel = within(await screen.findByRole('region', { name: 'Resolver shop' }));
  if (!shown) {
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/outbound-ips')).toBe(true));
    expect(panel.queryByText(/Allow these IPs/)).toBeNull();
    expect(panel.queryByRole('button', { name: /Copy the IPs/ })).toBeNull();
    return;
  }
  // One line per connection (MySQL and Postgres), none on the plain secret.
  expect(await panel.findAllByText('Allow these IPs in your database firewall:')).toHaveLength(2);
  expect(panel.getAllByText('184.169.146.94')).toHaveLength(2);
  expect(panel.getByRole('button', { name: 'Copy the IPs to allow for SHOP' })).toBeTruthy();
  expect(panel.getByRole('button', { name: 'Copy the IPs to allow for WAREHOUSE' })).toBeTruthy();
  expect(panel.queryByRole('button', { name: 'Copy the IPs to allow for API_KEY' })).toBeNull();
});

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBroot\n-----END CERTIFICATE-----\n';
function serveConnection(graphql?: () => unknown) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'shop', backendId: 'b1', version: 'v1', test: true, secrets: { WAREHOUSE: 'postgres' }, set: [] }] });
    if (url === '/api/artifacts/Abc123/graphql') return reply(graphql?.() ?? { data: { shop: { test: 'ok' } } });
    return reply({ names: method === 'PUT' ? ['WAREHOUSE'] : [] });
  }));
  return calls;
}
const advanced = (panel: ReturnType<typeof within>) => panel.getByText('Advanced').closest('details') as HTMLDetailsElement;

it('offers an optional CA certificate under Advanced, with where to get one, and sends it when filled', async () => {
  const calls = serveConnection();
  render(() => <ResolversPanel id="Abc123" />);
  const panel = within(await screen.findByRole('region', { name: 'Resolver shop' }));
  expect(advanced(panel).open).toBe(false);
  const field = panel.getByLabelText('CA certificate (PEM) for WAREHOUSE') as HTMLTextAreaElement;
  expect(field.tagName).toBe('TEXTAREA');
  expect(advanced(panel).contains(field)).toBe(true);
  const help = document.getElementById(field.getAttribute('aria-describedby')!)!;
  expect(help.textContent).toContain('AWS RDS: download your region\'s bundle from truststore.pki.rds.amazonaws.com');
  expect(help.textContent).toMatch(/Cloud SQL: .*server CA certificate/);
  expect(help.textContent).toMatch(/Supabase: .*SSL Configuration/);
  for (const [label, value] of Object.entries({ Host: 'db.example.com', Database: 'shop', User: 'reader', Password: VALUE })) fireEvent.input(panel.getByLabelText(`${label} for WAREHOUSE`), { target: { value } });
  const save = panel.getByRole('button', { name: 'Save connection' }) as HTMLButtonElement;
  // Checked as the contracts check it: a PEM certificate.
  fireEvent.input(field, { target: { value: 'not a certificate' } });
  expect(save.disabled).toBe(true);
  expect(panel.getByText(/Paste a PEM certificate/)).toBeTruthy();
  fireEvent.input(field, { target: { value: 'x'.repeat(12 * 1024) + PEM } });
  expect(save.disabled).toBe(true);
  expect(panel.getByText('The CA certificate must be 12 KiB or less.')).toBeTruthy();
  fireEvent.input(field, { target: { value: PEM } });
  expect(save.disabled).toBe(false);
  expect(advanced(panel).open).toBe(true);
  fireEvent.click(save);
  await waitFor(() => expect(panel.getByText('Set')).toBeTruthy());
  expect(calls.find(call => call.method === 'PUT')?.body).toEqual({ name: 'WAREHOUSE', connection: { host: 'db.example.com', port: 5432, database: 'shop', user: 'reader', password: VALUE, ca: PEM } });
});

it('opens Advanced by itself for an RDS or Supabase host and after an untrusted-certificate test', async () => {
  serveConnection(() => ({ data: { shop: null }, errors: [{ message: 'Backend execution failed', extensions: { code: 'backend_failed', detail: 'tls_untrusted_certificate: add your provider\'s CA certificate to the connection (RDS, Cloud SQL and Supabase need one)' } }] }));
  render(() => <ResolversPanel id="Abc123" />);
  const panel = within(await screen.findByRole('region', { name: 'Resolver shop' }));
  const host = panel.getByLabelText('Host for WAREHOUSE');
  for (const [value, open] of [['shop.abc123.us-east-1.rds.amazonaws.com', true], ['db.abcdefgh.supabase.co', true], ['db.example.com', false]] as const) {
    fireEvent.input(host, { target: { value } });
    expect(advanced(panel).open).toBe(open);
  }
  fireEvent.click(panel.getByRole('button', { name: 'Test connection' }));
  expect(await panel.findByRole('alert')).toHaveTextContent('tls_untrusted_certificate');
  expect(advanced(panel).open).toBe(true);
});

it('lists each scheduled function with its interval and last outcome; a failure shows its code, message and the owner detail', async () => {
  serve({ schedules: [
    { name: 'refresh', every: 'every 1 hour', everyMs: 3600000, nextRunAt: '2026-11-10T02:00:00.000Z', running: false, failures: 3, lastRunAt: '2026-11-10T01:00:00.000Z', lastFinishedAt: '2026-11-10T01:00:01.000Z', lastStatus: 'failed', lastError: 'backend_failed', lastMessage: 'upstream said no', lastDetail: 'Error: upstream said no at refresh' },
    { name: 'tidy', every: 'every 1 day', everyMs: 86400000, nextRunAt: '2026-11-11T00:00:00.000Z', running: false, failures: 0, lastRunAt: '2026-11-10T00:00:00.000Z', lastFinishedAt: '2026-11-10T00:00:01.000Z', lastStatus: 'ok', lastError: null, lastMessage: null, lastDetail: null },
    { name: 'fresh', every: 'every 15 minutes', everyMs: 900000, nextRunAt: '2026-11-10T00:00:00.000Z', running: false, failures: 0, lastRunAt: null, lastFinishedAt: null, lastStatus: null, lastError: null, lastMessage: null, lastDetail: null },
  ] });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  const list = within(panel.getByRole('list', { name: 'Scheduled functions' }));
  const rows = list.getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  const [refresh, tidy, fresh] = rows.map((row) => within(row));
  expect(refresh!.getByText('refresh')).toBeTruthy();
  expect(refresh!.getByText('every 1 hour')).toBeTruthy();
  expect(refresh!.getByText('Failed 3 times')).toBeTruthy();
  expect(refresh!.getByRole('alert').textContent).toContain('backend_failed: upstream said no');
  expect(refresh!.getByRole('alert').textContent).toContain('Error: upstream said no at refresh');
  expect(tidy!.getByText('Last run succeeded')).toBeTruthy();
  expect(tidy!.queryByRole('alert')).toBeNull();
  expect(fresh!.getByText('Not run yet')).toBeTruthy();
});

it('a resolver with no schedule shows no scheduled functions', async () => {
  serve();
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  expect(panel.queryByRole('list', { name: 'Scheduled functions' })).toBeNull();
});

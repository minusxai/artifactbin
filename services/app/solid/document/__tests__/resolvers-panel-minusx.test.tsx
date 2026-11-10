/* @jsxImportSource solid-js */
/**
 * A function file's `'minusx'` connection in the Resolvers panel: a governed connection binding, not a text secret.
 * The author picks one of their own groups and a connection MinusX lists for them in it, saves the binding, sees the
 * current one, and reads each refusal in plain words. `fetch` answers with the bodies the real handlers return
 * (`GET /api/my/artifacts/{id}/resolvers` with `bindings`, `GET /api/groups`, `GET /api/my/minusx/connections`, the
 * secrets route's `PUT {name, binding}`); those handlers are exercised for real in
 * services/app/__tests__/minusx-page-data.test.ts.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import ResolversPanel from '../ResolversPanel';

type Call = { url: string; method: string; body: unknown };
const GROUPS = [
  { id: 'grp_finance', handle: 'finance', name: 'Finance', description: '', role: 'viewer', parent_id: null },
  { id: 'grp_retail', handle: 'retail', name: 'Retail', description: '', role: 'editor', parent_id: 'grp_finance' },
];
const CONNECTIONS: Record<string, { id: string; name: string; protocol: string }[]> = {
  grp_finance: [{ id: 'conn_finance', name: 'Finance warehouse', protocol: 'postgres' }, { id: 'conn_ledger', name: 'Ledger', protocol: 'mysql' }],
  grp_retail: [{ id: 'conn_retail', name: 'Retail store', protocol: 'postgres' }],
};
interface Answers { set?: string[]; bindings?: Record<string, unknown>; secrets?: Record<string, string>; connections?: (group: string) => { status: number; body: unknown }; save?: () => { status: number; body: unknown } }
function serve(answers: Answers = {}) {
  const calls: Call[] = [];
  let set = answers.set ?? [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', resolvers: [{ name: 'data', backendId: 'b1', version: 'v1', functions: true, test: false, secrets: answers.secrets ?? { FIN: 'minusx' }, set, bindings: answers.bindings ?? {}, schedules: [] }] });
    if (url === '/api/groups') return reply({ groups: GROUPS });
    const listed = /^\/api\/my\/minusx\/connections\?group_id=(.+)$/.exec(url);
    if (listed) { const answer = answers.connections?.(decodeURIComponent(listed[1]!)) ?? { status: 200, body: { connections: CONNECTIONS[decodeURIComponent(listed[1]!)] ?? [] } }; return reply(answer.body, answer.status); }
    if (url === '/api/my/resolvers/b1/v1/secrets') {
      const answer = method === 'PUT' ? answers.save?.() : undefined;
      if (answer && answer.status >= 400) return reply(answer.body, answer.status);
      set = method === 'PUT' ? ['FIN'] : [];
      return reply({ names: set });
    }
    return reply({ error: 'not_found' }, 404);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const resolver = async () => within(await screen.findByRole('region', { name: 'Resolver data' }));
const pick = async (panel: ReturnType<typeof within>, control: string, option: string) => {
  const trigger = panel.getByRole('button', { name: control });
  await waitFor(() => expect((trigger as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name: option }));
};

it('shows a minusx name as a governed connection binding, and binds it to one of the author\'s groups and its connection', async () => {
  const calls = serve();
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  const row = within(panel.getByRole('group', { name: 'MinusX connection FIN' }));
  expect(row.getByText('Governed MinusX connection')).toBeTruthy();
  expect(row.getByText('Not bound')).toBeTruthy();
  // Not a text secret: no value input, no password field.
  expect(panel.queryByLabelText('Value for FIN')).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await pick(row, 'Group for FIN', 'Finance');
  await pick(row, 'Connection for FIN', 'Finance warehouse');
  fireEvent.click(row.getByRole('button', { name: 'Save binding' }));
  await waitFor(() => expect(row.getByText('Bound')).toBeTruthy());
  expect(row.getByText('Pinned to Finance warehouse in Finance.')).toBeTruthy();
  expect(calls.find(call => call.method === 'PUT')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'PUT', body: { name: 'FIN', binding: { connection_id: 'conn_finance', group_id: 'grp_finance' } } });
  // The connections were asked for the chosen group only.
  expect(calls.filter(call => call.url.startsWith('/api/my/minusx/connections')).map(call => call.url)).toEqual(['/api/my/minusx/connections?group_id=grp_finance']);
  // The group list offered is the author's direct memberships.
  expect(calls.some(call => call.url === '/api/groups')).toBe(true);
});

it('shows the current binding and removes it', async () => {
  const calls = serve({ set: ['FIN'], bindings: { FIN: { connection_id: 'conn_ledger', group_id: 'grp_finance', group_name: 'Finance' } } });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'MinusX connection FIN' }));
  expect(row.getByText('Bound')).toBeTruthy();
  expect(await row.findByText('Pinned to Ledger in Finance.')).toBeTruthy();
  expect(row.getByRole('button', { name: 'Group for FIN' }).textContent).toContain('Finance');
  expect(row.getByRole('button', { name: 'Connection for FIN' }).textContent).toContain('Ledger');
  fireEvent.click(row.getByRole('button', { name: 'Remove binding' }));
  await waitFor(() => expect(row.getByText('Not bound')).toBeTruthy());
  expect(calls.find(call => call.method === 'DELETE')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'DELETE', body: { name: 'FIN' } });
});

it('a binding to a group the reader is not in (another editor set it) still shows what it pins', async () => {
  serve({ set: ['FIN'], bindings: { FIN: { connection_id: 'conn_hr', group_id: 'grp_hr', group_name: 'People team' } }, connections: () => ({ status: 403, body: { error: 'not_group_member' } }) });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'MinusX connection FIN' }));
  expect(await row.findByText('Pinned to conn_hr in People team.')).toBeTruthy();
  expect(await row.findByText('You are not a direct member of that group. Only its own members can pin a page to its data; membership of a parent group or a subgroup does not count.')).toBeTruthy();
});

it.each([
  ['not_group_member', 403, 'You are not a direct member of that group. Only its own members can pin a page to its data; membership of a parent group or a subgroup does not count.'],
  ['connection_not_visible', 403, 'MinusX does not show that connection to this group. Choose one of the connections listed for it.'],
  ['minusx_not_configured', 400, 'This server is not connected to MinusX, so governed connections cannot be bound.'],
  ['minusx_unavailable', 503, 'MinusX did not answer. Try again in a moment.'],
  ['binding_forbidden', 403, 'MinusX refused to show you that group’s connections.'],
])('a refused save (%s) is shown in plain words and nothing is bound', async (code, status, words) => {
  serve({ save: () => ({ status, body: { error: code } }) });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'MinusX connection FIN' }));
  await pick(row, 'Group for FIN', 'Retail');
  await pick(row, 'Connection for FIN', 'Retail store');
  fireEvent.click(row.getByRole('button', { name: 'Save binding' }));
  expect((await row.findByRole('alert')).textContent).toBe(words);
  expect(row.getByText('Not bound')).toBeTruthy();
});

it('a connection list MinusX cannot give is explained in plain words, and nothing can be saved', async () => {
  serve({ connections: () => ({ status: 503, body: { error: 'minusx_unavailable' } }) });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'MinusX connection FIN' }));
  await pick(row, 'Group for FIN', 'Finance');
  expect((await row.findByRole('alert')).textContent).toBe('MinusX did not answer. Try again in a moment.');
  expect((row.getByRole('button', { name: 'Save binding' }) as HTMLButtonElement).disabled).toBe(true);
});

it('a group MinusX lists no connections for says so', async () => {
  serve({ connections: () => ({ status: 200, body: { connections: [] } }) });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'MinusX connection FIN' }));
  await pick(row, 'Group for FIN', 'Finance');
  expect(await row.findByText('MinusX shows Finance no connections.')).toBeTruthy();
});

it('a page without a minusx name asks for no groups and no connections (standalone stays as it was)', async () => {
  const calls = serve({ secrets: { GOOGLE_SA: 'sheets.googleapis.com' } });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  expect(panel.getByLabelText('Value for GOOGLE_SA')).toBeTruthy();
  expect(panel.queryByRole('group', { name: /MinusX/ })).toBeNull();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(calls.some(call => call.url === '/api/groups' || call.url.startsWith('/api/my/minusx'))).toBe(false);
});

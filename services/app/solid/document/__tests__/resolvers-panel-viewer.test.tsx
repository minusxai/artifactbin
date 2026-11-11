/* @jsxImportSource solid-js */
/**
 * A function file's `'viewer'` connection in the Resolvers panel: a viewer connection binding, not a text secret. The
 * author picks one of the data services the server trusts and writes the parameters it takes, saves the binding, sees
 * the current one, and reads each refusal in plain words. `fetch` answers with the bodies the real handlers return
 * (`GET /api/my/artifacts/{id}/resolvers` with `bindings` and `data_services`, the secrets route's
 * `PUT {name, binding}`); those handlers are exercised for real in services/app/__tests__/viewer-connections.test.ts.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import ResolversPanel from '../ResolversPanel';

type Call = { url: string; method: string; body: unknown };
interface Answers { set?: string[]; bindings?: Record<string, unknown>; secrets?: Record<string, string>; services?: string[]; save?: () => { status: number; body: unknown } }
function serve(answers: Answers = {}) {
  const calls: Call[] = [];
  let set = answers.set ?? [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/my/artifacts/Abc123/resolvers') return reply({ revision: 'r7', data_services: answers.services ?? ['warehouse', 'ledger'], resolvers: [{ name: 'data', backendId: 'b1', version: 'v1', functions: true, test: false, secrets: answers.secrets ?? { FIN: 'viewer' }, set, bindings: answers.bindings ?? {}, schedules: [] }] });
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
const params = (row: ReturnType<typeof within>, text: string) => fireEvent.input(row.getByLabelText('Parameters for FIN'), { target: { value: text } });

it('shows a viewer name as a viewer connection binding, and binds it to a configured service with its parameters', async () => {
  const calls = serve();
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  const row = within(panel.getByRole('group', { name: 'Viewer connection FIN' }));
  expect(row.getByText('Connects as each viewer')).toBeTruthy();
  expect(row.getByText('Not bound')).toBeTruthy();
  // Not a text secret: no value input, no password field.
  expect(panel.queryByLabelText('Value for FIN')).toBeNull();
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await pick(row, 'Data service for FIN', 'warehouse');
  params(row, '{"connection_id":"sales","group_id":"grp_finance"}');
  fireEvent.click(row.getByRole('button', { name: 'Save binding' }));
  await waitFor(() => expect(row.getByText('Bound')).toBeTruthy());
  expect(row.getByText('{"connection_id":"sales","group_id":"grp_finance"}')).toBeTruthy();
  expect(calls.find(call => call.method === 'PUT')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'PUT', body: { name: 'FIN', binding: { service: 'warehouse', params: { connection_id: 'sales', group_id: 'grp_finance' } } } });
});

it('shows the current binding and removes it', async () => {
  const calls = serve({ set: ['FIN'], bindings: { FIN: { service: 'ledger', params: { book: 'main' } } } });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'Viewer connection FIN' }));
  expect(row.getByText('Bound')).toBeTruthy();
  expect(row.getByRole('button', { name: 'Data service for FIN' }).textContent).toContain('ledger');
  fireEvent.click(row.getByRole('button', { name: 'Remove binding' }));
  await waitFor(() => expect(row.getByText('Not bound')).toBeTruthy());
  expect(calls.find(call => call.method === 'DELETE')).toEqual({ url: '/api/my/resolvers/b1/v1/secrets', method: 'DELETE', body: { name: 'FIN' } });
});

it('parameters that are not a JSON object cannot be saved', async () => {
  serve();
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'Viewer connection FIN' }));
  await pick(row, 'Data service for FIN', 'warehouse');
  params(row, '[1, 2]');
  expect((await row.findByRole('alert')).textContent).toBe('The parameters must be a JSON object.');
  expect((row.getByRole('button', { name: 'Save binding' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each([
  ['data_service_not_configured', 400, 'This server trusts no data service by that name, so this connection cannot be bound.'],
  ['binding_forbidden', 403, 'The data service refused you a session with these parameters. You can only bind what you may read yourself.'],
  ['binding_rejected', 422, 'The data service does not accept these parameters.'],
  ['data_service_unavailable', 503, 'The data service did not answer. Try again in a moment.'],
])('a refused save (%s) is shown in plain words and nothing is bound', async (code, status, words) => {
  serve({ save: () => ({ status, body: { error: code } }) });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'Viewer connection FIN' }));
  await pick(row, 'Data service for FIN', 'ledger');
  params(row, '{"book":"main"}');
  fireEvent.click(row.getByRole('button', { name: 'Save binding' }));
  expect((await row.findByRole('alert')).textContent).toBe(words);
  expect(row.getByText('Not bound')).toBeTruthy();
});

it('without a configured data service the row says so and nothing can be saved', async () => {
  serve({ services: [] });
  render(() => <ResolversPanel id="Abc123" />);
  const row = within((await resolver()).getByRole('group', { name: 'Viewer connection FIN' }));
  expect(row.getByRole('button', { name: 'Data service for FIN' }).textContent).toContain('No data service is configured');
  expect((row.getByRole('button', { name: 'Save binding' }) as HTMLButtonElement).disabled).toBe(true);
});

it('a page without a viewer name shows no binding row', async () => {
  serve({ secrets: { GOOGLE_SA: 'sheets.googleapis.com' } });
  render(() => <ResolversPanel id="Abc123" />);
  const panel = await resolver();
  expect(panel.getByLabelText('Value for GOOGLE_SA')).toBeTruthy();
  expect(panel.queryByRole('group', { name: /Viewer connection/ })).toBeNull();
});

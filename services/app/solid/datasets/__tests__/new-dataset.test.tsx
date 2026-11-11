/* @jsxImportSource solid-js */
/**
 * THE NEW-DATASET SCREEN (datasets/NewDataset) and a live dataset's form (datasets/LiveDatasetForm): the source comes
 * first (live connectors from the registry, one not yet available shown but not offered; stored CSV and JSON), then
 * that connector's own fields; Test connection and Create send the configuration; the edit form never shows a secret
 * and sends one only when typed.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { CONNECTORS as SPECS } from '@artifactbin/contracts';
import { NewDatasetPage } from '../NewDataset';
import { LiveDatasetForm } from '../LiveDatasetForm';

vi.mock('@/solid/lib/session', () => ({ useSession: () => ({ session: () => ({ kind: 'account', user: { id: 'u1' } }) }) }));
vi.mock('@/solid/pages/DatasetEditor', () => ({ DatasetEditorPage: (props: { initialSource?: string }) => <p>Stored editor: {props.initialSource}</p> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const CONNECTORS = SPECS.map((spec) => ({ ...spec, available: spec.id !== 'bigquery' }));
const postgres = CONNECTORS.find((c) => c.id === 'postgres')!;
type Call = { url: string; method: string; body: any };
function serve(answers: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const key = `${method} ${url}`;
    if (key in answers) return Response.json(answers[key]);
    if (url === '/api/connections') return Response.json({ connectors: CONNECTORS });
    if (url === '/api/groups') return Response.json({ groups: [{ id: 'g1', name: 'Finance', role: 'editor' }, { id: 'g2', name: 'Readers', role: 'viewer' }] });
    return Response.json({ error: 'unexpected' }, { status: 500 });
  }));
  return calls;
}
const type = (label: RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });

it('offers the live connectors and the stored sources, a connector this install cannot run shown but disabled', async () => {
  serve();
  render(() => <NewDatasetPage />);
  expect(await screen.findByRole('button', { name: 'PostgreSQL' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'MySQL' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'BigQuery, not yet available' })).toBeDisabled();
  expect(screen.getByRole('region', { name: 'Live sources' })).toHaveTextContent(':viewer_id, :viewer_email and :viewer_groups');
  fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
  expect(await screen.findByText('Stored editor: csv')).toBeInTheDocument();
});

it('draws the chosen connector\'s own form, tests the typed configuration and creates the dataset with its owner', async () => {
  const calls = serve({ 'POST /api/connections/test': { ok: true, latencyMs: 4 }, 'POST /api/my/artifacts': { id: 'new1' } });
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign, search: '' });
  render(() => <NewDatasetPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'PostgreSQL' }));
  const form = await screen.findByRole('region', { name: 'PostgreSQL connection' });
  for (const field of postgres.fields) expect(form).toHaveTextContent(field.label);
  expect(screen.getByLabelText(/^Password/)).toHaveAttribute('type', 'password');
  type(/^Name/, 'Orders'); type(/^Host/, 'db.example.com'); type(/^Database/, 'shop'); type(/^User/, 'reader'); type(/^Password/, 's3cret'); type(/^Port/, '6543');
  fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(await screen.findByText('Connected in 4 ms.')).toBeInTheDocument();
  expect(calls.find((c) => c.url === '/api/connections/test')!.body).toEqual({ connection: { connector: 'postgres', host: 'db.example.com', port: 6543, database: 'shop', user: 'reader', password: 's3cret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Owner' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Finance' }));
  expect(screen.queryByRole('option', { name: 'Readers' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create dataset' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('/a/new1'));
  expect(calls.find((c) => c.url === '/api/my/artifacts')!.body).toEqual({ title: 'Orders', destination: { type: 'group', id: 'g1' }, connection: { connector: 'postgres', host: 'db.example.com', port: 6543, database: 'shop', user: 'reader', password: 's3cret' } });
});

it('edits a live dataset without ever showing its secret, sending only what changed and a secret only when typed', async () => {
  const calls = serve({
    'GET /api/artifacts/ds1/connection': { role: 'owner', connection: { connector: 'postgres', label: 'PostgreSQL', fields: {} }, config: { connector: 'postgres', host: 'db.example.com', port: 5432, database: 'shop', user: 'reader', tls: 'verify-full' }, secrets: ['password'] },
    'PATCH /api/artifacts/ds1/connection': { id: 'ds1' },
  });
  render(() => <LiveDatasetForm connector={postgres} datasetId="ds1" />);
  await waitFor(() => expect(screen.getByLabelText(/^Host/)).toHaveValue('db.example.com'));
  expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  expect(screen.getByText(/Stored; leave blank to keep it/)).toBeInTheDocument();
  type(/^Database/, 'shop2');
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await screen.findByText(/^Saved/);
  expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ database: 'shop2' });
  type(/^Password/, 'n3w');
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
  expect(calls.filter((c) => c.method === 'PATCH')[1]!.body).toEqual({ database: 'shop2', password: 'n3w' });
});

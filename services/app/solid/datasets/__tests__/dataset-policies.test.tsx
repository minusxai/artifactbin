/* @jsxImportSource solid-js */
/**
 * The app's v3 dataset permissions editor, driven through the agent policy API (`/api/artifacts/:id/policy`):
 * a role × operation grid, templates, the server's dry-run read-back and errors, revision-checked saves and the
 * migration banner for a stored v1/v2 policy.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DatasetPolicies } from '../DatasetPolicies';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ROWS = { schema: 'public', name: 'rows' };
const READ_ALL = { columns: '*', filter: {}, allow_aggregations: true };
const READ_ONLY = { version: 3, tables: [{ table: ROWS, select_permissions: ['viewer', 'signed_in', 'anonymous'].map(role => ({ role, permission: READ_ALL })) }] };
const tables = [{ table: ROWS, root: 'rows', columns: [{ name: 'branch', field: 'branch', type: 'string' }, { name: 'created_by', field: 'created_by', type: 'string' }] }];
const loaded = (over: Record<string, unknown> = {}) => ({ revision: 3, source: 'v3', report: [], policy: READ_ONLY, tables, readBackTables: [{ title: 'Table rows (public.rows)', lines: ['Everyone can read.'] }], warnings: [], ...over });

type Call = { url: string; method: string; body: Record<string, any> | undefined };
function serve(handlers: { get?: () => unknown; put?: (body: Record<string, any>) => [number, unknown]; templates?: (url: string) => unknown } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url.includes('/policy/templates')) return Response.json(handlers.templates?.(url));
    if (method === 'PUT') {
      const [status, answer] = handlers.put?.(body) ?? [200, body.dryRun
        ? { dryRun: true, saved: false, revision: 3, policy: body.policy, readBackTables: [{ title: 'Table rows (public.rows)', lines: [`checked ${JSON.stringify(body.policy).length}`] }], warnings: [] }
        : { saved: true, revision: 4, policy: body.policy, readBackTables: [{ title: 'Table rows (public.rows)', lines: ['saved'] }], warnings: [] }];
      return Response.json(answer, { status });
    }
    return Response.json(handlers.get?.() ?? loaded());
  }));
  return { calls, dryRuns: () => calls.filter(c => c.body?.dryRun), saves: () => calls.filter(c => c.method === 'PUT' && !c.body?.dryRun) };
}
const pick = (label: string, option: string) => { fireEvent.click(screen.getByLabelText(label)); fireEvent.click(screen.getByRole('option', { name: option })); };

it('shows owner and editors as always full access, edits a role × operation cell with columns, presets and switches, reads back the dry run and saves at the loaded revision', async () => {
  const api = serve();
  render(() => <DatasetPolicies artifactId="ds123" expanded />);
  const grid = await screen.findByRole('table', { name: 'Permissions for public.rows' });
  expect(api.calls[0]!.url).toBe('/api/artifacts/ds123/policy');
  expect(within(grid).getByRole('row', { name: /Owner/ })).toHaveTextContent('Always full access');
  expect(within(grid).getByRole('row', { name: /Editors/ })).toHaveTextContent('Always full access');
  expect(screen.getByLabelText('Signed-out link holders: see')).toHaveTextContent('All rows');
  expect(screen.getByRole('region', { name: 'Read-back' })).toHaveTextContent('Everyone can read.');

  pick('Signed-in link holders: add', 'All rows');
  fireEvent.click(screen.getByRole('button', { name: 'Edit Signed-in link holders add rule' }));
  const rule = screen.getByRole('region', { name: 'Signed-in link holders add rule' });
  fireEvent.click(within(rule).getByLabelText('All columns'));
  fireEvent.click(within(rule).getByLabelText('branch'));
  fireEvent.click(within(rule).getByRole('button', { name: 'Add preset' }));
  pick('Preset 1 column', 'created_by');
  pick('Preset 1 value', 'Current user ID');
  fireEvent.click(within(rule).getByRole('switch', { name: "Only through the owner's apps" }));
  const want = { role: 'signed_in', permission: { columns: ['branch'], check: {}, set: { created_by: 'X-Hasura-User-Id' }, backend_only: true } };

  await waitFor(() => expect(api.dryRuns().at(-1)?.body!.policy.tables[0].insert_permissions).toEqual([want]));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Read-back' })).toHaveTextContent(/checked \d+/));
  pick('Shared viewers: see', 'Off');
  await waitFor(() => expect(api.dryRuns().at(-1)?.body!.policy.tables[0].select_permissions.map((e: { role: string }) => e.role)).toEqual(['signed_in', 'anonymous']));

  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  await waitFor(() => expect(api.saves()).toHaveLength(1));
  expect(api.saves()[0]!).toMatchObject({ url: '/api/artifacts/ds123/policy', body: { expectedPolicyRevision: 3, policy: { version: 3, tables: [{ insert_permissions: [want] }] } } });
  expect(await screen.findByText('Access policies saved.')).toBeInTheDocument();
});

it('builds row conditions with the structured builder, including session values, and offers the Hasura JSON escape hatch', async () => {
  const api = serve();
  render(() => <DatasetPolicies artifactId="ds123" expanded />);
  await screen.findByRole('table', { name: 'Permissions for public.rows' });
  pick('Shared viewers: change', 'Some rows');
  const rule = screen.getByRole('region', { name: 'Shared viewers change rule' });
  pick('update filter.1 column', 'created_by');
  pick('update filter.1 value source', 'Current user ID');
  expect(within(rule).queryByLabelText('update filter.1 value')).toBeNull();
  fireEvent.click(within(rule).getByLabelText('Add update check condition'));
  pick('update check.1.1 operator', 'matches, any case (ilike)');
  fireEvent.input(screen.getByLabelText('update check.1.1 value'), { target: { value: '"%north%"' } });
  await waitFor(() => expect(api.dryRuns().at(-1)?.body!.policy.tables[0].update_permissions).toEqual([
    { role: 'viewer', permission: { columns: '*', filter: { created_by: { _eq: 'X-Hasura-User-Id' } }, check: { _and: [{ branch: { _ilike: '%north%' } }] } } },
  ]));

  fireEvent.click(screen.getByRole('tab', { name: 'Hasura JSON' }));
  const source = screen.getByLabelText('Hasura permissions JSON') as HTMLTextAreaElement;
  expect(JSON.parse(source.value).tables[0].update_permissions[0].role).toBe('viewer');
  fireEvent.input(source, { target: { value: '{"version":3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON');
  fireEvent.input(source, { target: { value: JSON.stringify({ version: 3, tables: [{ table: ROWS }] }) } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply JSON' }));
  await waitFor(() => expect(api.dryRuns().at(-1)?.body!.policy).toEqual({ version: 3, tables: [{ table: ROWS }] }));
  fireEvent.click(screen.getByRole('tab', { name: 'Rules' }));
  expect(screen.getByLabelText('Shared viewers: see')).toHaveTextContent('Off');
});

it('applies a template from the server, the own-rows template with the chosen owner column', async () => {
  const OWN = { version: 3, tables: [{ table: ROWS, insert_permissions: [{ role: 'viewer', permission: { columns: ['branch'], check: {}, set: { created_by: 'X-Hasura-User-Id' } } }] }] };
  const api = serve({ templates: url => ({ revision: 3, templates: [
    { name: 'read-only', ok: true, policy: READ_ONLY },
    url.includes('ownerColumn=created_by') ? { name: 'own-rows', ok: true, policy: OWN } : { name: 'own-rows', ok: false, errors: [{ path: 'ownerColumn', message: 'own-rows needs an owner column' }] },
    { name: 'editors-only', ok: true, policy: { version: 3, tables: [{ table: ROWS }] } },
  ] }) });
  render(() => <DatasetPolicies artifactId="ds123" expanded />);
  await screen.findByRole('table', { name: 'Permissions for public.rows' });
  expect(screen.getByRole('button', { name: 'Apply own-rows template' })).toBeDisabled();
  pick('Owner column', 'created_by');
  fireEvent.click(screen.getByRole('button', { name: 'Apply own-rows template' }));
  await waitFor(() => expect(screen.getByLabelText('Shared viewers: add')).toHaveTextContent('All rows'));
  expect(api.calls.some(c => c.url === '/api/artifacts/ds123/policy/templates?ownerColumn=created_by')).toBe(true);
  expect(screen.getByLabelText('Shared viewers: see')).toHaveTextContent('Off');
  await waitFor(() => expect(api.dryRuns().at(-1)?.body!.policy).toEqual(OWN));
  fireEvent.click(screen.getByRole('button', { name: 'Apply editors-only template' }));
  await waitFor(() => expect(screen.getByLabelText('Shared viewers: add')).toHaveTextContent('Off'));
});

it('shows dry-run errors by path and blocks saving; a stale revision explains the conflict and reloads the latest rules', async () => {
  let gets = 0;
  const api = serve({
    get: () => (++gets === 1 ? loaded() : loaded({ revision: 9 })),
    put: body => body.dryRun
      ? body.policy.tables[0].delete_permissions ? [400, { error: 'invalid_policy', errors: [{ path: 'tables[0].delete_permissions[0].permission.filter', message: 'unknown column "nope"' }] }] : [200, { dryRun: true, revision: 3, policy: body.policy, readBackTables: [], warnings: [{ code: 'anonymous_write', message: 'Signed-out link holders can change data.' }] }]
      : [409, { error: 'policy_changed', revision: 9 }],
  });
  render(() => <DatasetPolicies artifactId="ds123" expanded />);
  await screen.findByRole('table', { name: 'Permissions for public.rows' });
  pick('Signed-out link holders: delete', 'All rows');
  await waitFor(() => expect(screen.getByRole('region', { name: 'Read-back' })).toHaveTextContent('tables[0].delete_permissions[0].permission.filter: unknown column "nope"'));
  expect(screen.getByRole('button', { name: 'Save access policies' })).toBeDisabled();
  pick('Signed-out link holders: delete', 'Off');
  pick('Signed-out link holders: add', 'All rows');
  expect(await screen.findByText('Signed-out link holders can change data.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save access policies' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  expect(await screen.findByText(/changed since you opened them/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest rules' }));
  await waitFor(() => expect(gets).toBe(2));
  await waitFor(() => expect(screen.getByLabelText('Signed-out link holders: add')).toHaveTextContent('Off'));
  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  expect(api.saves()).toHaveLength(1);
});

it('explains a stored v1 policy in a migration banner, offers to stop signed-out writes, and saves it as version 3', async () => {
  const write = { columns: '*', check: {} };
  const migrated = { version: 3, tables: [{ table: ROWS, select_permissions: READ_ONLY.tables[0]!.select_permissions, insert_permissions: ['viewer', 'signed_in', 'anonymous'].map(role => ({ role, permission: write })) }] };
  const api = serve({ get: () => loaded({ source: 'v1', revision: 2, policy: migrated, report: [{ code: 'anonymous_write', message: 'Signed-out readers can write, as before (rate-limited to 30 writes a minute).' }] }) });
  render(() => <DatasetPolicies artifactId="ds123" expanded />);
  const banner = await screen.findByRole('region', { name: 'Policy migration' });
  expect(banner).toHaveTextContent('version 1');
  expect(banner).toHaveTextContent('Signed-out readers can write, as before');
  expect(screen.getByRole('button', { name: 'Save access policies' })).toBeEnabled();
  fireEvent.click(within(banner).getByRole('button', { name: 'Stop signed-out writes' }));
  expect(screen.getByLabelText('Signed-out link holders: add')).toHaveTextContent('Off');
  expect(screen.getByLabelText('Shared viewers: add')).toHaveTextContent('All rows');
  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  await waitFor(() => expect(api.saves()).toHaveLength(1));
  expect(api.saves()[0]!.body).toMatchObject({ expectedPolicyRevision: 2, policy: { version: 3 } });
  expect(api.saves()[0]!.body!.policy.tables[0].insert_permissions.map((e: { role: string }) => e.role)).toEqual(['viewer', 'signed_in']);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Policy migration' })).toBeNull());
});

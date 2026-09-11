import { afterEach, it, expect, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { DatasetPolicies } from '../DatasetPolicies';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('offers only data actions, using sharing for audience', async () => {
  const fetch = vi.fn(
    async (_url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.method === 'PUT'
            ? { revision: 1, policy: JSON.parse(String(options.body)).policy }
            : {
                policy: null,
                revision: 0,
                tables: [
                  {
                    schema: 'public',
                    name: 'rows',
                    columns: [{ name: 'subject', type: 'string' }],
                  },
                ],
                writtenBy: [
                  {
                    id: 'app123',
                    title: 'Support form',
                    mutations: ['submit'],
                  },
                ],
              },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<DatasetPolicies artifactId="ds123" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage access policies' }),
  );
  await screen.findByLabelText('Allow insert');
  expect(
    screen.queryByLabelText('Allow public mutations'),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Policy audience')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Enable write policies'),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Allow insert'));
  expect(screen.getByText('Support form')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(true),
  );
  const call = fetch.mock.calls.find(([, o]) => o?.method === 'PUT')!;
  const body = JSON.parse(String(call[1]!.body));
  expect(body).toMatchObject({
    expectedPolicyRevision: 0,
    policy: {
      tables: [
        {
          insert_permissions: [
            { role: 'viewer', permission: { columns: '*', check: {} } },
          ],
        },
      ],
    },
  });
});
it('reports unsupported DSL fields before saving', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            policy: null,
            revision: 0,
            tables: [],
            writtenBy: [],
          }),
        ),
    ),
  );
  render(<DatasetPolicies artifactId="ds123" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage access policies' }),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Edit JSON / YAML' }),
  );
  fireEvent.change(screen.getByLabelText('Policy JSON or YAML'), {
    target: {
      value:
        'version: 1\nenforcement: enabled\ntables: []\nselect_permissions: []',
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply policy source' }));
  expect(screen.getByRole('alert')).toHaveTextContent('select_permissions');
});
it('edits Hasura insert defaults without losing permission comments', async () => {
  const policy = {
    version: 1,
    enforcement: 'enabled',
    tables: [
      {
        table: { schema: 'public', name: 'rows' },
        insert_permissions: [
          {
            role: 'viewer',
            comment: 'Public append',
            permission: { check: {} },
          },
        ],
      },
    ],
  };
  const fetch = vi.fn(
    async (_url: string, options?: RequestInit) =>
      new Response(
        JSON.stringify(
          options?.method === 'PUT'
            ? { revision: 1, policy: JSON.parse(String(options.body)).policy }
            : {
                policy,
                revision: 0,
                tables: [
                  {
                    schema: 'public',
                    name: 'rows',
                    columns: [{ name: 'body' }],
                  },
                ],
                writtenBy: [],
              },
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<DatasetPolicies artifactId="ds123" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage access policies' }),
  );
  const all = await screen.findByLabelText('insert all columns');
  expect(all).toBeChecked();
  fireEvent.click(all);
  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([, o]) => o?.method === 'PUT')).toBe(true),
  );
  const saved = JSON.parse(
    String(fetch.mock.calls.find(([, o]) => o?.method === 'PUT')![1]!.body),
  ).policy;
  expect(saved.tables[0].insert_permissions[0]).toMatchObject({
    comment: 'Public append',
    permission: { columns: [] },
  });
});

it('shows the visual policy controls to editors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            canManage: true,
            policy: null,
            revision: 0,
            tables: [{schema:'public',name:'rows',columns:[{name:'n'}]}],
            writtenBy: [],
          }),
        ),
    ),
  );
  render(<DatasetPolicies artifactId="ds123" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Manage access policies' }),
  );
  expect(await screen.findByLabelText('Allow insert')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Allow insert'));
  expect(screen.getByLabelText('insert check column')).toBeInTheDocument();
  expect(screen.getByLabelText('insert check operator')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Save access policies' }),
  ).toBeInTheDocument();
});

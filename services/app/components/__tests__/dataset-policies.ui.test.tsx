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
it('keeps public authority separate from allowed operations and saves canonical metadata', async () => {
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
  fireEvent.click(await screen.findByLabelText('Enable write policies'));
  expect(screen.getByLabelText('Allow public mutations')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('Allow public mutations'));
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
      delegated_mutations: { audience: 'anyone', via: 'declared_mutation' },
      tables: [
        {
          insert_permissions: [
            { role: 'visitor', permission: { columns: '*', check: {} } },
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
  fireEvent.click(await screen.findByLabelText('Enable write policies'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit JSON / YAML' }));
  fireEvent.change(screen.getByLabelText('Policy JSON or YAML'), {
    target: {
      value:
        'version: 1\nenforcement: enabled\ntables: []\nselect_permissions: []',
    },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply policy source' }));
  expect(screen.getByRole('alert')).toHaveTextContent('select_permissions');
});

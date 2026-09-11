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
  fireEvent.click(screen.getByLabelText('Add insert check condition'));
  expect(screen.getByLabelText('insert check.1.1 column')).toBeInTheDocument();
  expect(screen.getByLabelText('insert check.1.1 operator')).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Save access policies' }),
  ).toBeInTheDocument();
});


it('edits and removes individual nested conditions without dropping presets or siblings', async () => {
  const policy = {"version": 1, "enforcement": "enabled", "tables": [{"table": {"schema": "public", "name": "rows"}, "insert_permissions": [{"role": "viewer", "comment": "Keep this", "permission": {"columns": "*", "set": {"status": "submitted"}, "check": {"_and": [{"quantity": {"_gte": 1, "_lte": 10}}, {"_or": [{"status": {"_eq": "draft"}}, {"status": {"_eq": "ready"}}]}]}}}]}]};
  const fetch = vi.fn(async (_url:string, options?:RequestInit) => new Response(JSON.stringify(options?.method==='PUT' ? {revision:2,policy:JSON.parse(String(options.body)).policy} : {canManage:true,policy,revision:1,tables:[{schema:'public',name:'rows',columns:[{name:'quantity'},{name:'status'}]}],writtenBy:[]})));
  vi.stubGlobal('fetch',fetch);
  render(<DatasetPolicies artifactId="ds123" />);
  fireEvent.click(screen.getByRole('button',{name:'Manage access policies'}));
  fireEvent.click(await screen.findByRole('button',{name:'Remove insert check.1.1 condition'}));
  fireEvent.change(screen.getByLabelText('insert check.1.1 value'),{target:{value:'8'}});
  fireEvent.click(screen.getByRole('button',{name:'Remove insert check.2 group'}));
  fireEvent.click(screen.getByRole('button',{name:'Save access policies'}));
  await waitFor(()=>expect(fetch.mock.calls.some(([,o])=>o?.method==='PUT')).toBe(true));
  const saved=JSON.parse(String(fetch.mock.calls.find(([,o])=>o?.method==='PUT')![1]!.body)).policy;
  expect(saved.tables[0].insert_permissions[0]).toEqual({role:'viewer',comment:'Keep this',permission:{columns:'*',set:{status:'submitted'},check:{_and:[{quantity:{_lte:8}}]}}});
});

it('keeps separators while typing function and model lists', async () => {
  const fetch=vi.fn(async (_url:string, options?:RequestInit)=>new Response(JSON.stringify(options?.method==='PUT' ? {revision:1,policy:JSON.parse(String(options.body)).policy} : {canManage:true,policy:null,revision:0,tables:[],writtenBy:[]})));
  vi.stubGlobal('fetch',fetch);
  render(<DatasetPolicies artifactId="ds123" expanded/>);
  const functions=await screen.findByLabelText('Denied functions');
  fireEvent.change(functions,{target:{value:'lower,'}});
  expect(functions).toHaveValue('lower,');
  fireEvent.change(functions,{target:{value:'lower, llm'}});
  fireEvent.click(screen.getByLabelText('Allow model generation'));
  const models=screen.getByLabelText('Approved models');
  fireEvent.change(models,{target:{value:'default,'}});
  expect(models).toHaveValue('default,');
  fireEvent.change(models,{target:{value:'default, other'}});
  fireEvent.click(screen.getByRole('button',{name:'Save access policies'}));
  await waitFor(()=>expect(fetch.mock.calls.some(([,o])=>o?.method==='PUT')).toBe(true));
  expect(JSON.parse(String(fetch.mock.calls.find(([,o])=>o?.method==='PUT')![1]!.body)).policy.execution).toMatchObject({functions:{deny:['lower','llm']},generation:{models:['default','other']}});
});

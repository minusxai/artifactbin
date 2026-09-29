/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DatasetPolicies } from '../DatasetPolicies';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('edits insert check conditions as a structured predicate and saves the result', async () => {
  const requests: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { const body = JSON.parse(String(init.body)); requests.push(body); return Response.json({ revision: 1, policy: body.policy }); }
    return Response.json({ policy: null, revision: 0, tables: [{ schema: 'public', name: 'rows', columns: [{ name: 'branch', type: 'string' }] }], writtenBy: [] });
  }));
  render(() => <DatasetPolicies artifactId="ds123" expanded />);
  fireEvent.click(await screen.findByLabelText('Allow insert'));
  fireEvent.click(screen.getByLabelText('Add insert check condition'));
  fireEvent.input(screen.getByLabelText('insert check.1.1 value'), { target: { value: '"blocked"' } });
  fireEvent.click(screen.getByLabelText('Add insert check condition'));
  fireEvent.change(screen.getByLabelText('insert check.2.1 operator'), { target: { value: '_neq' } });
  expect(document.querySelector('pre')?.textContent).toContain('"_neq"');
  expect(screen.getByLabelText('insert check.2.1 operator')).toHaveValue('_neq');
  fireEvent.input(screen.getByLabelText('insert check.2.1 value'), { target: { value: '"blocked"' } });
  fireEvent.click(screen.getByLabelText('Remove insert check.1.1 condition'));
  expect(screen.getByLabelText('insert check.1.1 operator')).toHaveValue('_neq');
  fireEvent.click(screen.getByRole('button', { name: 'Save access policies' }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ policy: { tables: [{ insert_permissions: [{ permission: { check: { _and: [{ branch: { _neq: 'blocked' } }] } } }] }] } });
});

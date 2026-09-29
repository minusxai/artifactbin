/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { ForkArtifact } from '../ForkArtifact';

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

it('previews copied datasets and opens the copy on this origin', async () => {
  const navigate = vi.fn();
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => init?.body
    ? Response.json({ datasets: [{ id: 'ds1', title: 'tab' }] })
    : Response.json({ url: 'http://internal:3000/@owner/copy?x=1' }, { status: 201 }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <ForkArtifact id="abc" title="Report" navigate={navigate} />);
  fireEvent.click(view.getByRole('button', { name: 'Fork artifact' }));
  await waitFor(() => expect(view.getByLabelText('Datasets this fork copies')).toHaveTextContent('Its dataset “tab” will be copied too'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm fork' }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/@owner/copy?x=1'));
});

it('deduplicates refusal details and preserves location for sign in', async () => {
  window.history.replaceState(null, '', '/a/abc?$region=west#selection');
  const navigate = vi.fn();
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => init?.body
    ? Response.json({ datasets: [] })
    : Response.json({ error: 'invalid_refs', details: ['bad ref', 'bad ref'] }, { status: 400 }));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <ForkArtifact id="abc" navigate={navigate} />);
  fireEvent.click(view.getByRole('button', { name: 'Fork artifact' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm fork' }));
  await waitFor(() => expect(view.getByLabelText('Fork refused').textContent).toContain('bad ref'));
  expect(view.getByLabelText('Fork refused').textContent!.split('bad ref')).toHaveLength(2);
  expect(navigate).not.toHaveBeenCalled();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => init?.body
    ? Response.json({ datasets: [] })
    : Response.json({ error: 'sign_in_required' }, { status: 409 })));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm fork' }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  const callback = new URL(navigate.mock.calls[0]![0] as string, location.origin).searchParams.get('callbackUrl');
  expect(callback).toBe('/a/abc?$region=west&intent=fork#selection');
});

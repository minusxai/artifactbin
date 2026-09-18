/**
 * THE FORK DIALOG WHEN THE FORK COPIES DATASETS.
 *
 * Forking a page that WRITES data takes that data along, under the forker's
 * account. That is a bigger act than "fork" promises on its own, so the dialog
 * asks the dry run on open and says what it found — before the one Fork button,
 * because there is no version of this act that leaves the datasets behind.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import ForkArtifact from '../ForkArtifact';
vi.unmock('@/lib/navigation');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The dry run answers `datasets`; every later POST is the fork itself. */
const server = (datasets: Array<{ id: string; title: string | null }>, fork: () => Response) =>
  vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as { dry_run?: boolean }) : {};
    return body.dry_run === true ? Response.json({ datasets }, { status: 200 }) : fork();
  });

const open = (fetchMock: ReturnType<typeof server>) => {
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter([{ path: '*', element: <ForkArtifact id="abcdef" title="Splitwise tracker" /> }]);
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByLabelText('Fork artifact'));
  return router;
};

it('names the one dataset a fork would copy, and still offers exactly one Fork button', async () => {
  const fetchMock = server([{ id: 'ds0001', title: 'tab' }], () => Response.json({ url: '/@bob/copy01-tracker' }, { status: 201 }));
  const router = open(fetchMock);
  await waitFor(() => expect(screen.getByLabelText('Datasets this fork copies')).toHaveTextContent('Its dataset “tab” will be copied too'));
  expect(screen.getAllByLabelText('Confirm fork')).toHaveLength(1);
  // The dry run is a preview: it creates nothing, and the fork is still the
  // click. Both go to the same door.
  expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['/api/my/artifacts/abcdef/fork']);
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  await waitFor(() => expect(router.state.location.pathname).toBe('/@bob/copy01-tracker'));
});

it('counts them once there is more than one', async () => {
  open(server([{ id: 'ds0001', title: 'tab' }, { id: 'ds0002', title: 'people' }], () => Response.json({}, { status: 201 })));
  await waitFor(() => expect(screen.getByLabelText('Datasets this fork copies')).toHaveTextContent('Its 2 datasets will be copied too'));
});

it('says nothing when a fork would copy no datasets', async () => {
  open(server([], () => Response.json({}, { status: 201 })));
  await waitFor(() => expect(screen.getByLabelText('Confirm fork')).toBeTruthy());
  expect(screen.queryByLabelText('Datasets this fork copies')).toBeNull();
});

it('shows each refusal line once, however many positions named the same ref', async () => {
  const line = 'ref:ds0001 does not resolve — use one of your own artifact ids, or any public/unlisted one';
  open(server([], () => Response.json({ error: 'invalid_refs', details: [line, line, 'ref:ds0002 is read-only'] }, { status: 400 })));
  fireEvent.click(screen.getByLabelText('Confirm fork'));
  const refusal = await screen.findByLabelText('Fork refused');
  await waitFor(() => expect(refusal.textContent).toContain('ref:ds0002 is read-only'));
  expect(refusal.textContent!.split('does not resolve').length - 1).toBe(1);
});

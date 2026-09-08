import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';

vi.mock('@/components/ArtifactSurface', () => ({
  default: (props: { id: string }) => <p aria-label="Mounted artifact">{props.id}</p>,
}));

import { ArtifactPage } from '../pages/Artifact';

const page = (id: string, canonical = `/a/${id}`) => ({
  canonical, role: 'viewer', kind: 'none',
  surface: { id, editId: `edit_${id}`, format: 'markup', title: id, source: '<p>x</p>', content: '', template: null, refs: [], version: 1, columns: [], compiledCss: null, theme: null, colorMode: 'light' },
});

function Harness() {
  const navigate = useNavigate();
  const location = useLocation();
  return <><button onClick={() => navigate('/a/second')}>next</button><output>{location.pathname}</output><Routes><Route path="/a/:id" element={<ArtifactPage />} /></Routes></>;
}

afterEach(() => vi.unstubAllGlobals());

it('tears down the old artifact while a route switch is loading and ignores its late response', async () => {
  let first!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('/first')
    ? new Promise<Response>(resolve => { first = resolve; })
    : Promise.resolve(Response.json(page('second')))));
  render(<MemoryRouter initialEntries={['/a/first']}><Harness /></MemoryRouter>);
  fireEvent.click(screen.getByText('next'));
  await waitFor(() => expect(screen.getByLabelText('Mounted artifact')).toHaveTextContent('second'));
  first(Response.json(page('first')));
  await Promise.resolve();
  expect(screen.getByLabelText('Mounted artifact')).toHaveTextContent('second');
});

it('synchronizes a canonical path through the router', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(page('first', '/@alice/first-title'))));
  render(<MemoryRouter initialEntries={['/a/first']}><Harness /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('/@alice/first-title')).toBeVisible());
});

it('distinguishes a missing artifact from a retryable page failure', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response('busy', {status: 503}))
    .mockResolvedValueOnce(Response.json(page('first')));
  vi.stubGlobal('fetch', fetch);
  const view = render(<MemoryRouter initialEntries={['/a/first']}><Harness /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not load this page'));
  fireEvent.click(screen.getByLabelText('Retry loading artifact'));
  await waitFor(() => expect(screen.getByLabelText('Mounted artifact')).toHaveTextContent('first'));
  view.unmount();

  vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', {status: 404})));
  render(<MemoryRouter initialEntries={['/a/gone']}><Harness /></MemoryRouter>);
  await waitFor(() => expect(screen.getByLabelText('Not found')).toBeVisible());
  expect(screen.queryByLabelText('Retry loading artifact')).toBeNull();
});

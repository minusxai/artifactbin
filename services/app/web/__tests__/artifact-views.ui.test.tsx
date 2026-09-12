import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ArtifactPage } from '../pages/Artifact';
import { takeBootstrap } from '../bootstrap';
import { SessionProvider } from '../session';

vi.mock('@/components/ArtifactShell', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/ArtifactSurface', () => ({ default: ({ id }: { id: string }) => <div aria-label="Document">{id}</div> }));
vi.mock('../bootstrap', () => ({ takeBootstrap: vi.fn(() => null) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(takeBootstrap).mockReset(); });
const page = (id: string, captureKey: string | null = null, format = 'markup') => ({ canonical: `/a/${id}`, role: 'owner', kind: 'account', surface: { id, format, captureKey } });

it('reports bootstrapped document opens once, not StrictMode, selection or edit rerenders', async () => {
  vi.mocked(takeBootstrap).mockReturnValueOnce(page('viewpu'));
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/api/page/') ? page(url.includes('viewun') ? 'viewun' : 'viewpu') : {})));
  vi.stubGlobal('fetch', fetcher);
  const router = createMemoryRouter([{ path: '/a/:id/*', element: <ArtifactPage /> }], { initialEntries: ['/a/viewpu'] });
  render(<StrictMode><RouterProvider router={router} /></StrictMode>);
  const reports = () => fetcher.mock.calls.filter(([url]) => url.endsWith('/view')).map(([url]) => url);
  await screen.findByLabelText('Document');
  await waitFor(() => expect(reports()).toEqual(['/api/page/artifact/viewpu/view']));
  await act(async () => { await router.navigate('/a/viewpu?$region=west#edit'); });
  expect(reports()).toHaveLength(1);
  await act(async () => { await router.navigate('/a/viewun'); });
  await waitFor(() => expect(reports()).toHaveLength(2));
  await act(async () => { await router.navigate('/a/viewpu'); });
  await waitFor(() => expect(reports()).toEqual(['/api/page/artifact/viewpu/view', '/api/page/artifact/viewun/view', '/api/page/artifact/viewpu/view']));
});

it('reports a cached return before its held page-data refresh completes', async () => {
  let reads = 0;
  const fetcher = vi.fn((url: string) => {
    if (url === '/api/page/session') return Promise.resolve(new Response(JSON.stringify({ kind: 'none', user: null })));
    if (url.endsWith('/view')) return Promise.resolve(new Response(null, { status: 204 }));
    if (++reads > 1) return new Promise<Response>(() => {});
    return Promise.resolve(new Response(JSON.stringify(page('viewpu'))));
  });
  vi.stubGlobal('fetch', fetcher);
  const router = createMemoryRouter([
    { path: '/a/:id', element: <ArtifactPage /> },
    { path: '/', element: <div>Library</div> },
  ], { initialEntries: ['/a/viewpu'] });
  render(<SessionProvider><RouterProvider router={router} /></SessionProvider>);
  await screen.findByLabelText('Document');
  await act(async () => { await router.navigate('/'); });
  await act(async () => { await router.navigate('/a/viewpu'); });
  expect(screen.getByLabelText('Document')).toHaveTextContent('viewpu');
  expect(reads).toBe(2);
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/view'))).toHaveLength(2);
});

it.each([{ capture: 'capture', format: 'markup' }, { capture: null, format: 'image' }])('does not report captures or non-markup surfaces: %j', async ({ capture, format }) => {
  vi.mocked(takeBootstrap).mockReturnValueOnce(page('viewpu', capture, format));
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const router = createMemoryRouter([{ path: '/a/:id', element: <ArtifactPage /> }], { initialEntries: ['/a/viewpu'] });
  render(<RouterProvider router={router} />);
  await screen.findByLabelText('Document');
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps the reader usable when telemetry fails', async () => {
  vi.mocked(takeBootstrap).mockReturnValueOnce(page('viewpu'));
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const router = createMemoryRouter([{ path: '/a/:id', element: <ArtifactPage /> }], { initialEntries: ['/a/viewpu'] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/page/artifact/viewpu/view', expect.objectContaining({ method: 'POST', credentials: 'same-origin' })));
  expect(screen.getByLabelText('Document')).toHaveTextContent('viewpu');
});

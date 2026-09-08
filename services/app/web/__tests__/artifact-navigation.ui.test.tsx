import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ArtifactPage } from '../pages/Artifact';
import { ProfilePage } from '../pages/Profile';

vi.mock('@/components/ArtifactShell', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/ArtifactSurface', () => ({ default: ({ id, search }: { id: string; search: string }) => <div aria-label="surface">{id}{search}</div> }));
vi.mock('../bootstrap', () => ({ takeBootstrap: () => null }));
vi.mock('../Shell', () => ({ ShellFrame: ({children}: {children: React.ReactNode}) => <><header aria-label="Page bar">artifactbin</header>{children}</> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (id: string, canonical = `/a/${id}`) => ({ ok: true, json: async () => ({ canonical, role: 'viewer', kind: 'none', surface: { id } }) });

it.each(['/a/abc123', '/@owner'])('keeps a page bar and loading state while %s resolves', async path => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  const router = createMemoryRouter([{path:'/a/:id',element:<ProfilePage/>},{path:'/:user/*',element:<ProfilePage/>}], {initialEntries:[path]});
  render(<RouterProvider router={router}/>);
  expect(await screen.findByRole('banner', {name:'Page bar'})).toBeVisible();
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
});

it('loads the next artifact, aborts obsolete requests, and ignores late responses', async () => {
  let old!: (value: unknown) => void;
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValue(response('two'));
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter([{ path: '/a/:id', element: <ArtifactPage /> }], { initialEntries: ['/a/one'] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  await act(async () => { await router.navigate('/a/two'); });
  await waitFor(() => expect(screen.getByLabelText('surface')).toHaveTextContent('two'));
  expect(signal.aborted).toBe(true);
  await act(async () => { old(response('one')); });
  expect(screen.getByLabelText('surface')).toHaveTextContent('two');
});

it('changing an already-loaded artifact fetches its own data; signals do not refetch or remount', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(response('one')).mockResolvedValue(response('two'));
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter([{ path: '/a/:id', element: <ArtifactPage /> }], { initialEntries: ['/a/one'] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText('surface')).toHaveTextContent('one'));
  await act(async () => { await router.navigate('/a/two'); });
  await waitFor(() => expect(screen.getByLabelText('surface')).toHaveTextContent('two'));
  const surface = screen.getByLabelText('surface');
  await act(async () => { await router.navigate('/a/two?$count=3#selection'); });
  expect(screen.getByLabelText('surface')).toBe(surface);
  expect(surface).toHaveTextContent('two?$count=3');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('canonicalization commits through the router and retains state, query and hash', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('one', '/@owner/one-title')));
  const router = createMemoryRouter([{ path: '*', element: <ArtifactPage id="one" /> }], { initialEntries: [{ pathname: '/a/one', search: '?$count=2', hash: '#edit', state: { marker: 1 } }] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.location.pathname).toBe('/@owner/one-title'));
  expect(router.state.location.search).toBe('?$count=2');
  expect(router.state.location.hash).toBe('#edit');
  expect(router.state.location.state).toEqual({ marker: 1 });
});

it('direct and pretty artifact routes share the mounted surface during canonical healing', async () => {
  const fetchMock = vi.fn().mockResolvedValue(response('abc123', '/@owner/abc123-title'));
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter([
    { path: '/a/:id', element: <ProfilePage /> },
    { path: '/:user/*', element: <ProfilePage /> },
  ], { initialEntries: ['/a/abc123'] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.location.pathname).toBe('/@owner/abc123-title'));
  const surface = screen.getByLabelText('surface');
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => { await router.navigate('/@different/abc123-new?$count=4'); });
  expect(screen.getByLabelText('surface')).toBe(surface);
  expect(fetchMock).toHaveBeenCalledOnce();
});

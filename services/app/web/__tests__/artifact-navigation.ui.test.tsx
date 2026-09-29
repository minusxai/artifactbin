import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ArtifactPage } from '../pages/Artifact';
import { ProfilePage } from '../pages/Profile';
import { takeBootstrap } from '../bootstrap';
import { captureInitialStory, clearInitialStoryOnRoute } from '../initial-story';
import { readerNavigation } from '../reader-navigation';

vi.mock('@/components/ArtifactShell', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/ArtifactSurface', () => ({ default: ({ id, search, title }: { id: string; search: string; title?: string }) => <div aria-label="surface" data-title={title}>{id}{search}</div> }));
vi.mock('../bootstrap', () => ({ takeBootstrap: vi.fn(() => null) }));
vi.mock('../Shell', () => ({ ShellFrame: ({children}: {children: React.ReactNode}) => <><header aria-label="Page bar">artifactbin</header>{children}</> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (id: string, canonical = `/a/${id}`) => ({ ok: true, json: async () => ({ canonical, role: 'viewer', kind: 'none', surface: { id } }) });

it('uses bootstrapped document data after the route chunk loads without a duplicate loading shell or fetch', async () => {
  vi.mocked(takeBootstrap).mockReturnValueOnce({canonical: '/a/abc123', role: 'viewer', kind: 'none', surface: {id: 'abc123'}});
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const router = createMemoryRouter([{path:'/a/:id',element:<ProfilePage/>}], {initialEntries:['/a/abc123']});
  render(<RouterProvider router={router}/>);
  expect(await screen.findByLabelText('surface')).toHaveTextContent('abc123');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('banner', {name: 'Page bar'})).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

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

it('loads a client-navigated markup reader as a full compiled document', async () => {
  window.history.replaceState(null, '', '/a/one');
  captureInitialStory();
  const open = vi.spyOn(readerNavigation, 'open').mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValueOnce(response('one')).mockResolvedValue({ ok: true, json: async () => ({ canonical: '/a/two', role: 'viewer', kind: 'none', surface: { id: 'two', format: 'markup' } }) });
  vi.stubGlobal('fetch', fetcher);
  const router = createMemoryRouter([{ path: '/a/:id', element: <ArtifactPage /> }], { initialEntries: ['/a/one'] });
  const unsubscribe = router.subscribe(state => clearInitialStoryOnRoute(state.location.pathname));
  render(<RouterProvider router={router} />);
  await screen.findByLabelText('surface');
  await act(async () => { await router.navigate('/a/two?$region=west#chart'); });
  await waitFor(() => expect(open).toHaveBeenCalledWith('/a/two?$region=west#chart'));
  expect(screen.queryByLabelText('surface')).toBeNull();
  unsubscribe();
  window.history.replaceState(null, '', '/');
});

it('keeps a profile artifact address for full document navigation', async () => {
  window.history.replaceState(null, '', '/');
  captureInitialStory();
  const open = vi.spyOn(readerNavigation, 'open').mockImplementation(() => {});
  const address = '/@owner/abc123-title?$region=west#chart';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ canonical: '/a/abc123', role: 'viewer', kind: 'none', surface: { id: 'abc123', format: 'markup' } }) }));
  const router = createMemoryRouter([
    { path: '/', element: <p>Home</p> },
    { path: '/:user/*', element: <ProfilePage /> },
  ], { initialEntries: ['/'] });
  const unsubscribe = router.subscribe(state => clearInitialStoryOnRoute(state.location.pathname));
  render(<RouterProvider router={router} />);
  await act(async () => { await router.navigate(address); });
  await waitFor(() => expect(open).toHaveBeenCalledWith(address));
  expect(router.state.location.pathname).toBe('/@owner/abc123-title');
  unsubscribe();
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


/**
 * Solid owns every folder and every dataset edit address (lib/solid-routes isSolidPage) — a fresh
 * load never lands here with `folder` set or `surface.format === 'dataset'` while editing. The only
 * way it could is an in-app link that soft-navigated across that boundary; a reload lands it on the
 * entry that does own it, rather than this page trying to render a page it no longer carries.
 */
it.each([
  ['a folder', '/a/fold01', { canonical: '/a/fold01', role: 'viewer', kind: 'none', folder: { id: 'fold01' } }],
  ["a dataset's edit route", '/a/data01/edit', { canonical: '/a/data01/edit', role: 'editor', kind: 'account', surface: { id: 'data01', format: 'dataset' } }],
])('crosses %s to the entry that owns it instead of rendering it here', async (_label, path, body) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })));
  const reload = vi.fn();
  vi.stubGlobal('location', { ...window.location, reload });
  const router = createMemoryRouter([{ path: '*', element: <ArtifactPage id={path.split('/')[2]} /> }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(screen.queryByLabelText('surface')).not.toBeInTheDocument();
});

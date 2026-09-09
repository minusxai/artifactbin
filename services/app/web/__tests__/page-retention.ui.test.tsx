import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { SessionProvider } from '../session';
import { ProfilePage } from '../pages/Profile';
import { AccountPage } from '../pages/Account';
import { ArtifactPage } from '../pages/Artifact';
import { pageDataChanged } from '../page-data-events';
const disposed = vi.hoisted(() => vi.fn());
vi.mock('@/components/ArtifactSurface', () => ({ default: ({ title }: { title: string }) => { useEffect(() => () => disposed(), []); return <div aria-label="Mounted author runtime">{title}</div>; } }));
vi.mock('@/components/ArtifactShell', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/TokensPanel', () => ({ default: () => null }));
const response = (body: unknown) => new Response(JSON.stringify(body));
const session = { kind: 'account', user: { id: 'one', email: 'one@example.com' } };
function EditButton() { const navigate = useNavigate(); return <button aria-label="Enter edit" onClick={() => void navigate('/a/ABC123#edit')}>Edit</button>; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); disposed.mockClear(); });

it.each(['profile', 'account', 'artifact', 'folder'])('retains %s data across unmount while its Back refresh is held', async (kind) => {
  const path = kind === 'profile' ? '/@alice' : kind === 'account' ? '/account' : '/a/ABC123';
  const endpoint = kind === 'profile' ? '/api/page/profile/' : kind === 'account' ? '/api/page/account' : '/api/page/artifact/';
  const payload = kind === 'profile' ? { kind: 'public-profile', handle: 'alice', files: [], authed: true, anon: false }
    : kind === 'account' ? { username: 'alice' }
      : kind === 'folder' ? { canonical: path, role: 'viewer', kind: 'account', folder: { id: 'ABC123', title: 'Cached folder', trail: [], count: { documents: 0, folders: 0 }, rows: [] } }
        : { canonical: path, role: 'viewer', kind: 'account', surface: { title: 'Cached artifact' } };
  let reads = 0;
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') ? Promise.resolve(response(session))
    : url.includes(endpoint) ? ++reads === 1 ? Promise.resolve(response(payload)) : new Promise<Response>(() => {}) : Promise.resolve(response({}))));
  const node = kind === 'profile' ? <ProfilePage /> : kind === 'account' ? <AccountPage /> : <ArtifactPage id="ABC123" />;
  const tree = (shown: boolean) => <MemoryRouter initialEntries={[path]}><SessionProvider>{shown && <Routes><Route path={kind === 'profile' ? '/:user/*' : '*'} element={node} /></Routes>}</SessionProvider></MemoryRouter>;
  const view = render(tree(true));
  const content = () => kind === 'account' ? screen.getByLabelText('Username') : kind === 'artifact' ? screen.getByLabelText('Mounted author runtime') : screen.getByRole('heading', { level: 1 });
  await act(async () => {});
  expect(content()).toBeInTheDocument();
  view.rerender(tree(false));
  if (kind === 'artifact') expect(disposed).toHaveBeenCalledTimes(1);
  view.rerender(tree(true));
  expect(content()).toBeInTheDocument();
  expect(reads).toBe(2);
  if (kind === 'account') expect(content()).toHaveValue('alice');
});

it('an acknowledged mutation expires an inactive artifact payload before Back', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : { canonical: '/a/ABC123', role: 'viewer', kind: 'account', surface: { title: ++reads === 1 ? 'Before mutation' : 'After mutation' } }))));
  const tree = (shown: boolean) => <MemoryRouter initialEntries={['/a/ABC123']}><SessionProvider>{shown && <ArtifactPage id="ABC123" />}</SessionProvider></MemoryRouter>;
  const view = render(tree(true)); await screen.findByLabelText('Mounted author runtime');
  view.rerender(tree(false)); act(() => { pageDataChanged(); }); view.rerender(tree(true));
  expect(screen.queryByText('Before mutation')).toBeNull();
  expect(await screen.findByText('After mutation')).toBeInTheDocument();
});

it('entering edit cancels a held background artifact refresh without replacing the mounted source', async () => {
  let reads = 0; let done!: (r: Response) => void; let signal!: AbortSignal;
  const payload = (title: string) => ({ canonical: '/a/ABC123', role: 'owner', kind: 'account', surface: { title } });
  vi.stubGlobal('fetch', vi.fn((url: string, options: RequestInit) => url.includes('/session') ? Promise.resolve(response(session))
    : ++reads === 1 ? Promise.resolve(response(payload('Editing baseline')))
      : new Promise<Response>((resolve) => { done = resolve; signal = options.signal!; })));
  const tree = (shown: boolean) => <MemoryRouter initialEntries={['/a/ABC123']}><SessionProvider><EditButton />{shown && <ArtifactPage id="ABC123" />}</SessionProvider></MemoryRouter>;
  const view = render(tree(true)); await screen.findByText('Editing baseline');
  view.rerender(tree(false)); view.rerender(tree(true));
  fireEvent.click(screen.getByLabelText('Enter edit')); expect(signal.aborted).toBe(true);
  await act(async () => { done(response(payload('Late remote source'))); });
  expect(screen.getByText('Editing baseline')).toBeInTheDocument(); expect(screen.queryByText('Late remote source')).toBeNull();
});

it('shows retry beside retained artifact data after a transient refresh error', async () => {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('/session') ? response(session)
    : ++reads === 2 ? new Response('{}', { status: 503 }) : response({ canonical: '/a/ABC123', role: 'owner', kind: 'account', surface: { title: 'Retained artifact' } }))));
  const tree = (shown: boolean) => <MemoryRouter initialEntries={['/a/ABC123']}><SessionProvider><EditButton />{shown && <ArtifactPage id="ABC123" />}</SessionProvider></MemoryRouter>;
  const view = render(tree(true)); await screen.findByText('Retained artifact');
  view.rerender(tree(false)); view.rerender(tree(true));
  await screen.findByLabelText('Retry artifact'); expect(screen.getByText('Retained artifact')).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Enter edit')); expect(screen.getByLabelText('Retry artifact')).toBeDisabled();
});

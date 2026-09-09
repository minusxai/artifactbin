import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { HomePage } from '@/web/pages/Home';
import { SessionProvider, useSession } from '@/web/session';

vi.mock('@/components/viz/VegaChart', () => ({ VegaChart: () => <div /> }));
const session = { kind: 'account', user: { id: 'one', email: 'one@example.com' } };
const core = { signedIn: true, accountId: 'one', artifacts: [{ id: 'ABC123', url: '/a/ABC123', title: 'Private document', format: 'markup', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-09', views: 0 }], shared: [] };
const deferred = () => { let resolve!: (r: Response) => void; const promise = new Promise<Response>((r) => { resolve = r; }); return { promise, resolve }; };
const response = (value: unknown) => new Response(JSON.stringify(value));
function Controls() { const { reload } = useSession(); return <button aria-label="Reload identity" onClick={reload}>Reload</button>; }
const tree = (home: boolean) => <MemoryRouter><SessionProvider><Controls />{home && <HomePage />}</SessionProvider></MemoryRouter>;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('starts the core request without waiting for session and offers retry if session fails', async () => {
  const pending = deferred(); const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    calls.push(url);
    if (url.includes('/session')) return pending.promise;
    return Promise.resolve(response(core));
  }));
  render(tree(true));
  expect(calls).toContain('/api/page/home?part=core');
  expect(screen.queryByLabelText('Open Private document')).toBeNull();
  await act(async () => { pending.resolve(new Response('{}', { status: 500 })); });
  await screen.findByLabelText('Retry workspace');
});

it('paints core before deferred insights and restores it immediately on remount', async () => {
  const pending = deferred(); let visits = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/session')) return Promise.resolve(response(session));
    if (url.includes('part=insights')) return pending.promise;
    if (url.includes('/home')) return ++visits === 1 ? Promise.resolve(response(core)) : pending.promise;
    return Promise.resolve(response({}));
  }));
  const view = render(tree(true));
  expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument();
  await screen.findByLabelText('Open Private document');
  expect(screen.getByLabelText('Loading workspace insights')).toBeInTheDocument();
  expect(screen.queryByLabelText('Dashboard metrics')).toBeNull();
  view.rerender(tree(false)); view.rerender(tree(true));
  expect(screen.getByLabelText('Open Private document')).toBeInTheDocument();
  await waitFor(() => expect(visits).toBe(2));
});

it('shows a retryable failure instead of an endless empty page', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/session')) return Promise.resolve(response(session));
    if (url.includes('/home') && fail) return Promise.resolve(new Response('{}', { status: 500 }));
    return Promise.resolve(response(url.includes('part=core') ? core : {}));
  }));
  render(tree(true));
  await screen.findByLabelText('Retry workspace');
  fail = false; fireEvent.click(screen.getByLabelText('Retry workspace'));
  await screen.findByLabelText('Open Private document');
});

it('revokes private content immediately on identity reload and ignores old responses', async () => {
  const old = deferred(); let visits = 0; let current: unknown = session;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.includes('/session')) return Promise.resolve(response(current));
    if (url.includes('part=insights')) return old.promise;
    if (url.includes('/home')) return ++visits === 1 ? Promise.resolve(response(core)) : old.promise;
    return Promise.resolve(response({}));
  }));
  const view = render(tree(true)); await screen.findByLabelText('Open Private document');
  view.rerender(tree(false)); view.rerender(tree(true));
  current = { kind: 'none', user: null };
  fireEvent.click(screen.getByLabelText('Reload identity'));
  expect(screen.queryByLabelText('Open Private document')).toBeNull();
  await act(async () => { old.resolve(response(core)); });
  expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('drops retained private rows when the core endpoint reports an expired session', async () => {
  let signedIn = true;
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session
    : url.includes('part=core') ? signedIn ? core : { signedIn: false }
      : { signedIn: true, accountId: 'one', sparklines: {}, feed: { mine: [], following: [] } }))));
  const view = render(tree(true)); await screen.findByLabelText('Open Private document');
  view.rerender(tree(false)); signedIn = false; view.rerender(tree(true));
  await screen.findByLabelText('Get started');
  expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('retains shelf and offers retry when only insights fail', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('part=insights') ? new Response('{}', { status: 503 }) : response(url.includes('/session') ? session : core))));
  render(tree(true));
  await screen.findByLabelText('Retry workspace insights');
  expect(screen.getByLabelText('Open Private document')).toBeInTheDocument();
  expect(screen.queryByLabelText('Dashboard metrics')).toBeNull();
});

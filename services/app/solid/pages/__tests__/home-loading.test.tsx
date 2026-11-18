/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { createSignal, Show } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, useLocation } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '@/solid/pages/Home';
import { SessionProvider, useSession } from '@/solid/lib/session';
import { REFRESH_EVENT } from '@/solid/lib/page-data-events';
import { withPersonalBootstrap } from './home-bootstrap-fetch';
import { fetchRoutes } from '@/test/helpers/fetch-stub';

const session = { kind: 'account', user: { id: 'one', email: 'one@example.com' }, onboarded: true };
const core = { signedIn: true, accountId: 'one', artifacts: [{ id: 'ABC123', url: '/a/ABC123', title: 'Private document', format: 'html', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-09', views: 0 }], shared: [] };
const response = (value: unknown, status = 200) => Response.json(value, { status });
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; };
function Controls() { const { reload } = useSession(); const location = useLocation(); return <><button aria-label="Reload identity" onClick={reload}>Reload</button><output aria-label="Current path">{location.pathname}</output></>; }
function open() {
  const [visible, setVisible] = createSignal(true);
  const view = render(() => <MemoryRouter><Route path="*" component={() => <SessionProvider><Controls /><Show when={visible()}><HomePage /></Show></SessionProvider>} /><Route path="/login" component={() => <h1>Log in</h1>} /></MemoryRouter>);
  const remount = () => { setVisible(false); setVisible(true); };
  return { ...view, remount };
}
/** Stubs `fetch` with `handler` behind the personal bootstrap (home-bootstrap-fetch.ts) and returns the mock. */
const homeFetch = (handler: (...args: any[]) => any) => { const fetcher = vi.fn(withPersonalBootstrap(handler)); vi.stubGlobal('fetch', fetcher); return fetcher; };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('starts the bootstrap before session and offers retry if identity fails', async () => {
  const pending = deferred(); let signal: AbortSignal | null = null;
  const fetcher = homeFetch(fetchRoutes({ '/api/page/session': () => pending.promise, '/api/page/home?part=core': (_url, init) => { signal = init?.signal ?? null; return response(core); } }, { fallback: () => response(core) }));
  open(); expect(fetcher.mock.calls.map(([url]) => url)).toContain('/api/page/home?part=bootstrap'); expect(screen.queryByLabelText('Open Private document')).toBeNull();
  pending.resolve(response({}, 500)); await screen.findByLabelText('Retry workspace');
  await waitFor(() => expect(signal?.aborted).toBe(true));
  homeFetch(fetchRoutes({ '/api/page/home?part=core': core }, { session, fallback: () => response({ signedIn: true, accountId: 'one' }) }));
  fireEvent.click(screen.getByLabelText('Retry workspace')); await screen.findByLabelText('Open Private document');
});

it.each(['core', 'insights'])('refuses a mismatched %s account stamp', async part => {
  homeFetch(fetchRoutes({ '/api/page/home?part=core': { ...core, accountId: part === 'core' ? 'other' : 'one' } }, { session, fallback: () => response({ signedIn: true, accountId: 'other' }) }));
  open(); await screen.findByLabelText('Retry workspace'); expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('paints core before deferred insights and restores it on remount', async () => {
  const pending = deferred(); let visits = 0;
  homeFetch(fetchRoutes({ '/api/page/home?part=insights': () => pending.promise, '/api/page/home*': () => ++visits === 1 ? response(core) : pending.promise }, { session, fallback: () => response({}) }));
  const view = open(); expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument(); await screen.findByLabelText('Open Private document');
  expect(screen.getByLabelText('Loading workspace insights')).toBeInTheDocument(); expect(screen.queryByLabelText('Dashboard metrics')).toBeNull();
  view.remount(); expect(screen.getByLabelText('Open Private document')).toBeInTheDocument(); await waitFor(() => expect(visits).toBe(2));
});

it('keeps a folder menu open when deferred insights arrive', async () => {
  const pending = deferred();
  const folder = { ...core.artifacts[0], id: 'fold01', url: '/a/fold01', title: 'Reports', format: 'folder' };
  const child = { ...core.artifacts[0], ancestor_ids: ['fold01'] };
  homeFetch(fetchRoutes({ '/api/page/home?part=insights': () => pending.promise, '/api/page/home?part=core': { ...core, artifacts: [folder, child] } }, { session, fallback: () => response({}) }));
  open();
  const trigger = await screen.findByRole('button', { name: 'More actions for Reports' });
  fireEvent.click(trigger);
  expect(screen.getByRole('menuitem', { name: 'Delete Reports' })).toHaveTextContent('1 inside');
  pending.resolve(response({ signedIn: true, accountId: 'one', stats: { artifacts: 1, assets: 0, views: 7 }, viewsOverTime: [], views: { ABC123: 7 }, likes: 0, likesOverTime: [], followers: 0, forks: 0 }));
  expect(await screen.findByLabelText('Dashboard metrics')).toHaveTextContent('7');
  expect(screen.getByRole('button', { name: 'More actions for Reports' })).toBe(trigger);
  expect(screen.getByRole('menuitem', { name: 'Delete Reports' })).toHaveTextContent('1 inside');
  expect(screen.getByRole('menuitem', { name: 'Rename Reports' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit Reports' })).toBeNull();
});

it('shows a retryable core failure', async () => {
  let fail = true; homeFetch(fetchRoutes({ '/api/page/home?part=core': () => fail ? response({}, 500) : response(core), '/api/page/home*': () => fail ? response({}, 500) : response({ signedIn: true, accountId: 'one' }) }, { session, fallback: () => response({ signedIn: true, accountId: 'one' }) }));
  open(); await screen.findByLabelText('Retry workspace'); fail = false; fireEvent.click(screen.getByLabelText('Retry workspace')); await screen.findByLabelText('Open Private document');
});

it('revokes private rows immediately on identity reload despite late responses', async () => {
  const old = deferred(); let visits = 0; let identity: unknown = session;
  homeFetch(fetchRoutes({ '/api/page/session': () => response(identity), '/api/page/home?part=insights': () => old.promise, '/api/page/home*': () => ++visits === 1 ? response(core) : old.promise }, { fallback: () => response({}) }));
  const view = open(); await screen.findByLabelText('Open Private document'); view.remount(); identity = { kind: 'none', user: null };
  fireEvent.click(screen.getByLabelText('Reload identity')); expect(screen.queryByLabelText('Open Private document')).toBeNull();
  old.resolve(response(core)); await waitFor(() => expect(screen.queryByLabelText('Open Private document')).toBeNull());
});

it('drops retained private rows when the core reports an expired session', async () => {
  let signedIn = true; homeFetch(fetchRoutes({ '/api/page/home?part=core': () => response(signedIn ? core : { signedIn: false }) }, { session, fallback: () => response({ signedIn: true, accountId: 'one' }) }));
  const view = open(); await screen.findByLabelText('Open Private document'); view.remount(); signedIn = false;
  window.dispatchEvent(new Event(REFRESH_EVENT)); await screen.findByRole('heading', { name: 'Log in' }); expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('retains the shelf and offers retry when only insights fail', async () => {
  homeFetch(fetchRoutes({ '/api/page/home?part=insights': () => response({}, 500) }, { session, fallback: () => response(core) }));
  open(); await screen.findByLabelText('Retry workspace insights'); expect(screen.getByLabelText('Open Private document')).toBeInTheDocument(); expect(screen.queryByLabelText('Dashboard metrics')).toBeNull();
});

it('rejects late responses from a prior account', async () => {
  const oldCore = deferred(); const oldInsights = deferred(); let owner = 'one'; let visits = 0;
  const next = { ...core, accountId: 'two', artifacts: [{ ...core.artifacts[0], title: 'Next account document' }] };
  homeFetch(fetchRoutes({
    '/api/page/session': () => response({ ...session, user: { id: owner, email: `${owner}@example.com` } }),
    '/api/page/home?part=insights': () => owner === 'one' ? oldInsights.promise : response({ signedIn: true, accountId: 'two' }),
    '/api/page/home*': () => owner === 'two' ? response(next) : ++visits === 1 ? response(core) : oldCore.promise,
  }, { fallback: () => response({}) }));
  const view = open(); await screen.findByLabelText('Open Private document'); view.remount(); owner = 'two'; fireEvent.click(screen.getByLabelText('Reload identity'));
  await screen.findByLabelText('Open Next account document'); oldCore.resolve(response(core)); oldInsights.resolve(response({ signedIn: true, accountId: 'one' }));
  expect(screen.getByLabelText('Open Next account document')).toBeInTheDocument(); expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('an older same-account refresh cannot overwrite the newer shelf', async () => {
  const old = deferred(); let visits = 0;
  homeFetch(fetchRoutes({
    '/api/page/home?part=insights': { signedIn: true, accountId: 'one' },
    '/api/page/home*': () => ++visits === 2 ? old.promise : response(visits === 1 ? core : { ...core, artifacts: [{ ...core.artifacts[0], title: 'Newest document' }] }),
  }, { session, fallback: () => response({}) }));
  open(); await screen.findByLabelText('Open Private document'); window.dispatchEvent(new Event(REFRESH_EVENT)); window.dispatchEvent(new Event(REFRESH_EVENT));
  await screen.findByLabelText('Open Newest document'); old.resolve(response(core)); expect(screen.getByLabelText('Open Newest document')).toBeInTheDocument();
});

describe('the refresh event', () => {
  let calls: string[];
  beforeEach(() => { calls = []; homeFetch(fetchRoutes({ '/api/page/home*': { ...core, artifacts: [] } }, { session, fallback: () => response({}), onCall: url => { calls.push(url); } })); });
  it('re-reads identity and page data without navigating', async () => {
    const before = location.href; open(); await screen.findByRole('heading', { name: /create your first artifact/i }); const count = calls.length;
    window.dispatchEvent(new Event(REFRESH_EVENT)); await waitFor(() => expect(calls.length).toBeGreaterThan(count));
    expect(calls.filter(url => url.includes('/session')).length).toBeGreaterThan(1); expect(calls.filter(url => url.includes('/home')).length).toBeGreaterThan(1); expect(location.href).toBe(before);
  });
});

it.each([true, false])('renders an activity-free workspace (empty=%s)', async empty => {
  homeFetch(fetchRoutes({ '/api/page/home?part=core': { ...core, artifacts: empty ? [] : core.artifacts } }, { session, fallback: () => response({ signedIn: true, accountId: 'one', viewsOverTime: [], views: {}, stats: { assets: 0 }, likes: 0, likesOverTime: [], followers: 0, forks: 0 }) }));
  open(); if (empty) await screen.findByRole('heading', { name: /create your first artifact/i }); else await screen.findByLabelText('Dashboard metrics');
  expect(screen.queryByRole('heading', { name: /activity/i })).toBeNull(); if (empty) expect(screen.getByLabelText('Create dataset')).toBeInTheDocument(); else expect(screen.getByLabelText('Open Private document')).toBeInTheDocument();
});

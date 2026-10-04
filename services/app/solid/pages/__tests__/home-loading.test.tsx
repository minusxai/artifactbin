/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { createSignal, Show } from 'solid-js';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { MemoryRouter, Route, useLocation } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '@/solid/pages/Home';
import { SessionProvider, useSession } from '@/solid/lib/session';
import { REFRESH_EVENT } from '@/web/page-data-events';

const session = { kind: 'account', user: { id: 'one', email: 'one@example.com' }, onboarded: true };
const core = { signedIn: true, accountId: 'one', artifacts: [{ id: 'ABC123', url: '/a/ABC123', title: 'Private document', format: 'markup', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-09', views: 0 }], shared: [] };
const response = (value: unknown, status = 200) => Response.json(value, { status });
const deferred = () => { let resolve!: (value: Response) => void; const promise = new Promise<Response>(done => { resolve = done; }); return { promise, resolve }; };
function Controls() { const { reload } = useSession(); const location = useLocation(); return <><button aria-label="Reload identity" onClick={reload}>Reload</button><output aria-label="Current path">{location.pathname}</output></>; }
function open() {
  const [visible, setVisible] = createSignal(true);
  const view = render(() => <MemoryRouter><Route path="*" component={() => <SessionProvider><Controls /><Show when={visible()}><HomePage /></Show></SessionProvider>} /><Route path="/login" component={() => <h1>Log in</h1>} /></MemoryRouter>);
  const remount = () => { setVisible(false); setVisible(true); };
  return { ...view, remount };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('starts core before session and offers retry if identity fails', async () => {
  const pending = deferred(); const calls: string[] = []; let signal: AbortSignal | null = null;
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => { calls.push(url); if (url.includes('/session')) return pending.promise; if (url.includes('part=core')) signal = init?.signal ?? null; return Promise.resolve(response(core)); }));
  open(); expect(calls).toContain('/api/page/home?part=core'); expect(screen.queryByLabelText('Open Private document')).toBeNull();
  pending.resolve(response({}, 500)); await screen.findByLabelText('Retry workspace');
  await waitFor(() => expect(signal?.aborted).toBe(true));
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? core : { signedIn: true, accountId: 'one', sparklines: {} }))));
  fireEvent.click(screen.getByLabelText('Retry workspace')); await screen.findByLabelText('Open Private document');
});

it.each(['core', 'insights'])('refuses a mismatched %s account stamp', async part => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? { ...core, accountId: part === 'core' ? 'other' : 'one' } : { signedIn: true, accountId: 'other', sparklines: {} }))));
  open(); await screen.findByLabelText('Retry workspace'); expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('paints core before deferred insights and restores it on remount', async () => {
  const pending = deferred(); let visits = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') ? Promise.resolve(response(session)) : url.includes('part=insights') ? pending.promise : url.includes('/home') ? ++visits === 1 ? Promise.resolve(response(core)) : pending.promise : Promise.resolve(response({}))));
  const view = open(); expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument(); await screen.findByLabelText('Open Private document');
  expect(screen.getByLabelText('Loading workspace insights')).toBeInTheDocument(); expect(screen.queryByLabelText('Dashboard metrics')).toBeNull();
  view.remount(); expect(screen.getByLabelText('Open Private document')).toBeInTheDocument(); await waitFor(() => expect(visits).toBe(2));
});

it('keeps a folder menu open when deferred insights arrive', async () => {
  const pending = deferred();
  const folder = { ...core.artifacts[0], id: 'fold01', url: '/a/fold01', title: 'Reports', format: 'folder' };
  const child = { ...core.artifacts[0], ancestor_ids: ['fold01'] };
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('part=insights') ? pending.promise : Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? { ...core, artifacts: [folder, child] } : {}))));
  open();
  const trigger = await screen.findByRole('button', { name: 'More actions for Reports' });
  fireEvent.click(trigger);
  expect(screen.getByRole('button', { name: 'Delete Reports' })).toHaveTextContent('1 inside');
  pending.resolve(response({ signedIn: true, accountId: 'one', stats: { artifacts: 1, assets: 0, views: 7 }, viewsOverTime: [], views: { ABC123: 7 }, likes: 0, likesOverTime: [], followers: 0, forks: 0, sparklines: {} }));
  expect(await screen.findByLabelText('Dashboard metrics')).toHaveTextContent('7');
  expect(screen.getByRole('button', { name: 'More actions for Reports' })).toBe(trigger);
  expect(screen.getByRole('button', { name: 'Delete Reports' })).toHaveTextContent('1 inside');
  expect(screen.getByRole('button', { name: 'Rename Reports' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Edit Reports' })).toBeNull();
});

it('shows a retryable core failure', async () => {
  let fail = true; vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('/home') && fail ? response({}, 500) : response(url.includes('/session') ? session : url.includes('part=core') ? core : { signedIn: true, accountId: 'one', sparklines: {} }))));
  open(); await screen.findByLabelText('Retry workspace'); fail = false; fireEvent.click(screen.getByLabelText('Retry workspace')); await screen.findByLabelText('Open Private document');
});

it('revokes private rows immediately on identity reload despite late responses', async () => {
  const old = deferred(); let visits = 0; let identity: unknown = session;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') ? Promise.resolve(response(identity)) : url.includes('part=insights') ? old.promise : url.includes('/home') ? ++visits === 1 ? Promise.resolve(response(core)) : old.promise : Promise.resolve(response({}))));
  const view = open(); await screen.findByLabelText('Open Private document'); view.remount(); identity = { kind: 'none', user: null };
  fireEvent.click(screen.getByLabelText('Reload identity')); expect(screen.queryByLabelText('Open Private document')).toBeNull();
  old.resolve(response(core)); await waitFor(() => expect(screen.queryByLabelText('Open Private document')).toBeNull());
});

it('drops retained private rows when the core reports an expired session', async () => {
  let signedIn = true; vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? signedIn ? core : { signedIn: false } : { signedIn: true, accountId: 'one', sparklines: {} }))));
  const view = open(); await screen.findByLabelText('Open Private document'); view.remount(); signedIn = false;
  window.dispatchEvent(new Event(REFRESH_EVENT)); await screen.findByRole('heading', { name: 'Log in' }); expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('retains the shelf and offers retry when only insights fail', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('part=insights') ? response({}, 503) : response(url.includes('/session') ? session : core))));
  open(); await screen.findByLabelText('Retry workspace insights'); expect(screen.getByLabelText('Open Private document')).toBeInTheDocument(); expect(screen.queryByLabelText('Dashboard metrics')).toBeNull();
});

it('rejects late responses from a prior account', async () => {
  const oldCore = deferred(); const oldInsights = deferred(); let owner = 'one'; let visits = 0;
  const next = { ...core, accountId: 'two', artifacts: [{ ...core.artifacts[0], title: 'Next account document' }] };
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') ? Promise.resolve(response({ ...session, user: { id: owner, email: `${owner}@example.com` } })) : url.includes('part=insights') ? owner === 'one' ? oldInsights.promise : Promise.resolve(response({ signedIn: true, accountId: 'two', sparklines: {} })) : url.includes('/home') ? owner === 'two' ? Promise.resolve(response(next)) : ++visits === 1 ? Promise.resolve(response(core)) : oldCore.promise : Promise.resolve(response({}))));
  const view = open(); await screen.findByLabelText('Open Private document'); view.remount(); owner = 'two'; fireEvent.click(screen.getByLabelText('Reload identity'));
  await screen.findByLabelText('Open Next account document'); oldCore.resolve(response(core)); oldInsights.resolve(response({ signedIn: true, accountId: 'one', sparklines: {} }));
  expect(screen.getByLabelText('Open Next account document')).toBeInTheDocument(); expect(screen.queryByLabelText('Open Private document')).toBeNull();
});

it('an older same-account refresh cannot overwrite the newer shelf', async () => {
  const old = deferred(); let visits = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.includes('/session') ? Promise.resolve(response(session)) : url.includes('part=insights') ? Promise.resolve(response({ signedIn: true, accountId: 'one', sparklines: {} })) : url.includes('/home') ? ++visits === 2 ? old.promise : Promise.resolve(response(visits === 1 ? core : { ...core, artifacts: [{ ...core.artifacts[0], title: 'Newest document' }] })) : Promise.resolve(response({}))));
  open(); await screen.findByLabelText('Open Private document'); window.dispatchEvent(new Event(REFRESH_EVENT)); window.dispatchEvent(new Event(REFRESH_EVENT));
  await screen.findByLabelText('Open Newest document'); old.resolve(response(core)); expect(screen.getByLabelText('Open Newest document')).toBeInTheDocument();
});

describe('the refresh event', () => {
  let calls: string[];
  beforeEach(() => { calls = []; vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return response(url.includes('/session') ? session : url.includes('/home') ? { ...core, artifacts: [] } : {}); })); });
  it('re-reads identity and page data without navigating', async () => {
    const before = location.href; open(); await screen.findByRole('heading', { name: /create your first artifact/i }); const count = calls.length;
    window.dispatchEvent(new Event(REFRESH_EVENT)); await waitFor(() => expect(calls.length).toBeGreaterThan(count));
    expect(calls.filter(url => url.includes('/session')).length).toBeGreaterThan(1); expect(calls.filter(url => url.includes('/home')).length).toBeGreaterThan(1); expect(location.href).toBe(before);
  });
});

it.each([true, false])('renders an activity-free workspace (empty=%s)', async empty => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? { ...core, artifacts: empty ? [] : core.artifacts } : { signedIn: true, accountId: 'one', sparklines: {}, viewsOverTime: [], views: {}, stats: { assets: 0 }, likes: 0, likesOverTime: [], followers: 0, forks: 0 }))));
  open(); if (empty) await screen.findByRole('heading', { name: /create your first artifact/i }); else await screen.findByLabelText('Dashboard metrics');
  expect(screen.queryByRole('heading', { name: /activity/i })).toBeNull(); if (empty) expect(screen.getByLabelText('Create dataset')).toBeInTheDocument(); else expect(screen.getByLabelText('Open Private document')).toBeInTheDocument();
});

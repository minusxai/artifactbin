/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route } from '@solidjs/router';
import { SessionProvider } from '@/solid/web/session';
import { HomePage } from '@/solid/pages/Home';

const session = { kind: 'account', user: { id: 'one', email: 'one@example.com', username: 'one', image: null }, onboarded: true };
const core = { signedIn: true, accountId: 'one', artifacts: [{ id: 'ABC123', url: '/a/ABC123', title: 'Private document', format: 'markup', version: 1, visibility: 'private', ancestor_ids: [], updated_at: '2026-09-09', views: 0 }], shared: [] };
const response = (value: unknown) => Response.json(value);
const open = () => render(() => <MemoryRouter><Route path="*" component={() => <SessionProvider><HomePage /></SessionProvider>} /></MemoryRouter>);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('starts the core request while identity is pending, then paints only after identity resolves', async () => {
  let resolveSession!: (value: Response) => void;
  const pending = new Promise<Response>(resolve => { resolveSession = resolve; });
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => { calls.push(url); return url.includes('/session') ? pending : Promise.resolve(response(url.includes('part=core') ? core : { signedIn: true, accountId: 'one', sparklines: {}, stats: { assets: 0 } })); }));
  open();
  expect(calls).toContain('/api/page/home?part=core');
  expect(screen.queryByLabelText('Open Private document')).toBeNull();
  resolveSession(response(session));
  expect(await screen.findByLabelText('Open Private document')).toBeInTheDocument();
});

it('paints the core shelf while insights load', async () => {
  let finish!: (value: Response) => void;
  const insights = new Promise<Response>(resolve => { finish = resolve; });
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('/session') ? response(session) : url.includes('part=core') ? response(core) : url.includes('claimable') ? response({ claimable: [] }) : insights)));
  open();
  expect(await screen.findByLabelText('Open Private document')).toBeInTheDocument();
  expect(screen.getByLabelText('Loading workspace insights')).toBeInTheDocument();
  finish(response({ signedIn: true, accountId: 'one', stats: { artifacts: 1, assets: 0, views: 0 }, viewsOverTime: [], views: {}, likes: 0, likesOverTime: [], followers: 0, forks: 0, sparklines: {} }));
  expect(await screen.findByLabelText('Dashboard metrics')).toBeInTheDocument();
});

it('offers retry on core failure and never paints another account', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.includes('/session') ? response(session) : url.includes('part=core') ? fail ? response({ signedIn: true, accountId: 'other', artifacts: core.artifacts, shared: [] }) : response(core) : response({ signedIn: true, accountId: 'one', sparklines: {} }))));
  open();
  await screen.findByLabelText('Retry workspace');
  expect(screen.queryByLabelText('Open Private document')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByLabelText('Retry workspace'));
  await screen.findByLabelText('Open Private document');
});

it('explains first creation on an empty account', async () => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? { ...core, artifacts: [] } : { signedIn: true, accountId: 'one', stats: { assets: 0 } }))));
  open();
  expect(await screen.findByRole('heading', { name: /create your first artifact/i })).toBeInTheDocument();
  expect(screen.getByLabelText('Create dataset')).toHaveAttribute('href', '/datasets/new');
  await waitFor(() => expect(screen.queryByRole('heading', { name: /activity/i })).toBeNull());
});

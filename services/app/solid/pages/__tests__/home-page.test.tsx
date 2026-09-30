/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route } from '@solidjs/router';
import { SessionProvider } from '@/solid/lib/session';
import { HomePage } from '@/solid/pages/Home';
import { REFRESH_EVENT } from '@/web/page-data-events';

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

it('renders a populated folder workspace without recursive updates', async () => {
  const folderRow = { ...core.artifacts[0], id: 'fold01', url: '/a/fold01', title: 'Reports', format: 'folder', ancestor_ids: [] };
  const childRow = { ...core.artifacts[0], id: 'child', title: 'Child', ancestor_ids: ['fold01'] };
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? { ...core, artifacts: [folderRow, childRow] } : { signedIn: true, accountId: 'one', stats: { artifacts: 1, assets: 0, views: 0 }, views: {}, viewsOverTime: [], likes: 0, likesOverTime: [], followers: 0, forks: 0, sparklines: {} }))));
  open();
  expect(await screen.findByLabelText('Open folder Reports')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open Child')).toBeNull();
});

it('keeps the working shelf before the account dashboard and links to assets, trash, and dataset creation', async () => {
  const insights = { signedIn: true, accountId: 'one', stats: { artifacts: 1004, assets: 204, views: 1234 }, views: {}, viewsOverTime: [0, 2, 5], likes: 3, likesOverTime: [0, 1, 2], followers: 4, forks: 2, sparklines: {} };
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? core : url.includes('claimable') ? { claimable: [] } : insights))));
  const view = open();
  const shelf = await screen.findByLabelText('Shelf');
  const dashboard = await screen.findByLabelText('Dashboard');
  expect(view.container.querySelector('main')?.className).toContain('max-w-[80rem]');
  expect(shelf.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByLabelText('Artifact grid')).toBeInTheDocument();
  expect(screen.getByLabelText('Assets')).toHaveAttribute('href', '/assets');
  expect(screen.getByLabelText('Trash')).toHaveAttribute('href', '/trash');
  fireEvent.click(screen.getByLabelText('Create'));
  expect(screen.getByRole('menuitem', { name: 'Dataset' })).toHaveAttribute('href', '/datasets/new');
});

it('waits for identity without showing a public marketing page', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  open();
  expect(screen.getByLabelText('Loading workspace')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'About Artifactbin' })).toBeNull();
});

it.each(['none', 'anon'])('redirects %s sessions with held drafts to login', async kind => {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? { kind, user: null } : { signedIn: false, drafts: [{ id: 'AbC123', title: 'Private draft' }] }))));
  render(() => <MemoryRouter><Route path="/" component={() => <SessionProvider><HomePage /></SessionProvider>} /><Route path="/login" component={() => <h1>Log in</h1>} /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Log in' });
  expect(screen.queryByText('Private draft')).toBeNull();
});

const doc = (id: string) => ({ id, url: `/a/${id}`, title: `Doc ${id}`, description: null, format: 'markup', version: 1, visibility: 'public', parent_id: null, ancestor_ids: [], updated_at: '2026-08-20T00:00:00.000Z', views: 0, sparkline: null });
const richInsights = { signedIn: true, accountId: 'one', stats: { artifacts: 1004, assets: 204, views: 1234 }, views: {}, viewsOverTime: [0, 2, 5], likes: 3, likesOverTime: [0, 1, 2], followers: 4, forks: 2, sparklines: {} };
function homeFetch(home: unknown, insights: unknown = richInsights) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? home : url.includes('claimable') ? { claimable: [] } : insights))));
}

it('leads a populated workspace with its shelf and shows all account metrics in the rail', async () => {
  homeFetch({ signedIn: true, accountId: 'one', artifacts: [doc('a'), { ...doc('data'), title: 'Dataset', format: 'dataset' }], shared: [] });
  open(); const shelf = await screen.findByLabelText('Shelf'); const dashboard = await screen.findByLabelText('Dashboard');
  expect(screen.getByLabelText('Dashboard rail')).toContainElement(dashboard);
  const metrics = screen.getByLabelText('Dashboard metrics');
  expect(metrics).toHaveTextContent('1k'); expect(metrics).toHaveTextContent('204'); expect(metrics).toHaveTextContent('1.2k');
  expect(metrics).toHaveTextContent('likes'); expect(metrics).toHaveTextContent('followers'); expect(metrics).toHaveTextContent('forks');
  expect(screen.getByRole('group', { name: 'Interactive engagement chart: 7 views and 3 likes in the last 30 days' })).toBeInTheDocument();
  expect(shelf.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Assets' })).toBeNull();
  expect(screen.queryByLabelText('Get started')).toBeNull();
});

it('shows only root rows while retaining whole-account dashboard totals', async () => {
  homeFetch({ signedIn: true, accountId: 'one', artifacts: [doc('root'), { ...doc('folder'), title: 'Research', format: 'folder' }, { ...doc('filed'), parent_id: 'folder', ancestor_ids: ['folder'] }], shared: [] }, { ...richInsights, stats: { ...richInsights.stats, artifacts: 2 } });
  open(); await screen.findByLabelText('Open Doc root');
  expect(screen.getByLabelText('Open folder Research')).toBeInTheDocument(); expect(screen.queryByLabelText('Open Doc filed')).toBeNull();
  expect(await screen.findByLabelText('Dashboard metrics')).toHaveTextContent('2');
});

it('offers one trash link only to an account', async () => {
  homeFetch({ signedIn: true, accountId: 'one', artifacts: [doc('a')], shared: [] }); open();
  await screen.findByLabelText('Open Doc a'); expect(screen.getAllByLabelText('Trash')).toHaveLength(1);
});

it('names first creation and shows the setup panel on an empty account', async () => {
  homeFetch({ signedIn: true, accountId: 'one', artifacts: [], shared: [] }, { ...richInsights, stats: { ...richInsights.stats, assets: 0 } }); open();
  const heading = await screen.findByRole('heading', { name: /create your first artifact/i });
  expect(heading).toHaveTextContent('hi one, let’s create your first artifact!');
  const panel = screen.getByLabelText('Get started');
  expect(screen.getByLabelText('Copy the CLI install command')).toBeInTheDocument();
  expect(heading.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByLabelText('What you can use it for')).toBeNull();
});

it('keeps shared work primary when the account owns no artifacts', async () => {
  homeFetch({ signedIn: true, accountId: 'one', artifacts: [], shared: [{ ...doc('shared'), role: 'viewer', owner_username: 'alice' }] }, { ...richInsights, stats: { ...richInsights.stats, artifacts: 0 } });
  open(); const shared = await screen.findByLabelText('Open shared artifact shared'); const dashboard = await screen.findByLabelText('Dashboard');
  expect(shared.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByLabelText('Create your first artifact')).toBeNull();
});

it('filters "Shared with you" too, from "My artifacts"\' own search box', async () => {
  homeFetch({ signedIn: true, accountId: 'one', artifacts: [{ ...doc('own'), title: 'QA shell own doc' }], shared: [{ ...doc('shared'), title: 'QA shell shared doc', role: 'viewer', owner_username: 'alice' }] });
  open();
  await screen.findByLabelText('Open QA shell own doc');
  expect(await screen.findByLabelText('Open shared artifact shared')).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Search artifacts'), { target: { value: 'own' } });
  expect(screen.getByLabelText('Open QA shell own doc')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open shared artifact shared')).toBeNull();
  fireEvent.input(screen.getByLabelText('Search artifacts'), { target: { value: 'shared' } });
  expect(screen.queryByLabelText('Open QA shell own doc')).toBeNull();
  expect(screen.getByLabelText('Open shared artifact shared')).toBeInTheDocument();
});

it('keeps the claim result while an empty library fills on refresh', async () => {
  let current = { signedIn: true, accountId: 'one', artifacts: [] as ReturnType<typeof doc>[], shared: [] };
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(response(url.includes('/session') ? session : url.includes('part=core') ? current : url.includes('claimable') ? { claimable: [{ tokenId: 'tok_1', titles: ['Quarterly Review'], artifacts: 1 }] } : url.includes('/claim') ? { ok: true } : { ...richInsights, stats: { ...richInsights.stats, assets: 0 } }))));
  open(); await screen.findByLabelText('Unclaimed drafts'); fireEvent.click(screen.getByLabelText('Add to my account'));
  expect(await screen.findByLabelText('Claim result')).toHaveTextContent(/Added/);
  current = { ...current, artifacts: [doc('a')] };
  window.dispatchEvent(new Event(REFRESH_EVENT)); await screen.findByLabelText('Open Doc a');
  expect(screen.getByLabelText('Claim result')).toHaveTextContent(/Added/);
});

/* @jsxImportSource solid-js */
/**
 * A CLIENT NAVIGATION TO AN ARTIFACT ADDRESS (solid/pages/ArtifactAddress). A document is the server's page, so reaching one
 * must cost ONE full navigation and never the page payload: a link that knows the format (solid/lib/artifact-link) either
 * is not the router's at all (a document) or hands the address the format in `location.state`; an address that is
 * told nothing asks the header-only kind door (`?part=kind`) before it decides. Folders, data tiers and programs
 * keep drawing from their page answer in the app, with no reload.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactAddressRoute } from '@/solid/pages/ArtifactAddress';
import { replaceDocument } from '@/solid/lib/document-navigation';
import { claimServedPath } from '@/solid/lib/served-frame';

vi.mock('@/solid/lib/document-navigation', () => ({ replaceDocument: vi.fn(), openDocument: vi.fn() }));
vi.mock('@/solid/lib/served-frame', async (original) => ({ ...(await original<typeof import('@/solid/lib/served-frame')>()), claimServedPath: vi.fn(() => false) }));

const FOLDER = { folder: { id: 'fold01', title: 'Reports', trail: [], count: { documents: 0, folders: 0 }, rows: [] }, role: 'viewer' };
const IMAGE = { role: 'viewer', kind: 'none', surface: { id: 'img001', editId: 'e1', format: 'image', title: 'Sunset', version: 1, dataPreview: '', columns: [] } };
const DOCUMENT = { role: 'viewer', surface: { id: 'doc001', format: 'html' } };

/** Every request the page makes, answered by URL: the kind door says `kinds[id]`, the page door `pages[id]`. */
let requests: string[];
const serve = (kinds: Record<string, string | number>, pages: Record<string, unknown>) => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    requests.push(url);
    const id = /\/api\/page\/artifact\/([^/?]+)/.exec(url)?.[1] ?? '';
    if (url.includes('part=kind')) {
      const kind = kinds[id];
      return typeof kind === 'number' ? Response.json({ error: 'not_found' }, { status: kind }) : Response.json({ format: kind });
    }
    const page = pages[id];
    return page === undefined ? Response.json({ error: 'not_found' }, { status: 404 }) : Response.json(page);
  }));
};
const kindRequests = () => requests.filter((url) => url.includes('part=kind'));
const pageRequests = () => requests.filter((url) => url.startsWith('/api/page/artifact/') && !url.includes('part='));

/** A client navigation to `path`: the address is mounted by the router, carrying `state` as a link's would. */
const navigate = async (path: string, state: unknown = null) => {
  window.history.replaceState(state, '', path);
  const view = render(() => <Router><Route path="/a/:id" component={ArtifactAddressRoute} /></Router>);
  await vi.dynamicImportSettled();
  return view;
};

beforeEach(() => { vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} }); vi.mocked(claimServedPath).mockReturnValue(false); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(replaceDocument).mockClear(); window.history.replaceState(null, '', '/'); });

it('crosses to the server with ONE kind request and no page payload when it was told nothing about a document', async () => {
  serve({ doc001: 'html' }, { doc001: DOCUMENT });
  await navigate('/a/doc001');
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledTimes(1));
  expect(replaceDocument).toHaveBeenCalledWith('/a/doc001');
  expect(kindRequests()).toEqual(['/api/page/artifact/doc001?part=kind']);
  expect(pageRequests()).toEqual([]);
});

it('draws a folder from its page answer after the kind question, with no reload', async () => {
  serve({ fold01: 'folder' }, { fold01: FOLDER });
  await navigate('/a/fold01');
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports'));
  expect(kindRequests()).toHaveLength(1);
  expect(pageRequests()).toEqual(['/api/page/artifact/fold01']);
  expect(replaceDocument).not.toHaveBeenCalled();
});

it.each([['folder', 'fold01', FOLDER], ['image', 'img001', IMAGE]] as const)('asks no kind question when the link said it is a %s', async (format, id, page) => {
  serve({}, { [id]: page });
  await navigate(`/a/${id}`, { format });
  await waitFor(() => expect(pageRequests()).toEqual([`/api/page/artifact/${id}`]));
  await waitFor(() => expect(screen.getByRole(format === 'folder' ? 'heading' : 'img')).toBeInTheDocument());
  expect(kindRequests()).toEqual([]);
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('draws a data tier and a program from their page answers, never as a crossing', async () => {
  serve({ img001: 'image', prog01: 'program' }, { img001: IMAGE, prog01: { role: 'owner', kind: 'account', surface: { id: 'prog01', format: 'program' } } });
  await navigate('/a/img001');
  await waitFor(() => expect(screen.getByRole('img', { name: 'Sunset' })).toBeInTheDocument());
  cleanup();
  await navigate('/a/prog01', { format: 'program' });
  await waitFor(() => expect(pageRequests()).toContain('/api/page/artifact/prog01'));
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('shows the not-found page, with no retry and no crossing, when the kind door answers 404', async () => {
  serve({ gone01: 404 }, {});
  await navigate('/a/gone01');
  await waitFor(() => expect(screen.getByLabelText('Not found')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Retry artifact' })).toBeNull();
  expect(replaceDocument).not.toHaveBeenCalled();
  expect(pageRequests()).toEqual([]);
});

it('keeps the unservable state: a page answer of 410 is a load failure with a retry, not a crossing or a not-found', async () => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    requests.push(String(input));
    return String(input).includes('part=kind') ? Response.json({ format: 'folder' }) : Response.json({ error: 'unservable_document', message: 'retired' }, { status: 410 });
  }));
  await navigate('/a/old001');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry artifact' })).toBeInTheDocument());
  expect(screen.queryByLabelText('Not found')).toBeNull();
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('never crosses an address the server itself just served: a document there is a dead end, not a reload loop', async () => {
  vi.mocked(claimServedPath).mockReturnValue(true);
  serve({ doc001: 'html' }, { doc001: DOCUMENT });
  await navigate('/a/doc001');
  await waitFor(() => expect(screen.getByLabelText('Not found')).toBeInTheDocument());
  expect(kindRequests()).toEqual([]);
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('treats the address after the one the server served as a client navigation, in the same route instance', async () => {
  vi.mocked(claimServedPath).mockReturnValueOnce(true);
  serve({ doc001: 'html' }, { fold01: FOLDER, doc001: DOCUMENT });
  await navigate('/a/fold01');
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports'));
  expect(kindRequests()).toEqual([]);
  window.history.pushState(null, '', '/a/doc001');
  window.dispatchEvent(new PopStateEvent('popstate'));
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/a/doc001'));
  expect(kindRequests()).toEqual(['/api/page/artifact/doc001?part=kind']);
  expect(pageRequests()).toEqual(['/api/page/artifact/fold01']);
});

it('claims the address the ROUTER is at, not the address bar, which still holds the page the client came from', async () => {
  // The server served the app at `/` (Home); a click on a link to a document creates the address before the bar moves.
  vi.mocked(claimServedPath).mockImplementation((path) => path === '/');
  serve({ doc001: 'html' }, { doc001: DOCUMENT });
  window.history.replaceState(null, '', '/');
  render(() => <Router><Route path="/" component={() => <a href="/a/doc001">go</a>} /><Route path="/a/:id" component={ArtifactAddressRoute} /></Router>);
  screen.getByRole('link', { name: 'go' }).click();
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/a/doc001'));
  expect(kindRequests()).toEqual(['/api/page/artifact/doc001?part=kind']);
  expect(pageRequests()).toEqual([]);
});

it('asks one kind question per address, however often it re-renders', async () => {
  serve({ doc001: 'html' }, { doc001: DOCUMENT });
  await navigate('/a/doc001');
  await waitFor(() => expect(replaceDocument).toHaveBeenCalled());
  await vi.dynamicImportSettled();
  expect(kindRequests()).toHaveLength(1);
});

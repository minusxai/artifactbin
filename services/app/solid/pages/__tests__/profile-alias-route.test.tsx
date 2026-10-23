/* @jsxImportSource solid-js */
/**
 * `/:user/*` — a pretty artifact alias (solid/pages/ProfileAlias.tsx ProfileAliasRoute). Same id-anchored
 * grammar as the React twin (web/pages/Profile.tsx): the rest path resolves to an id or it is a
 * uniform 404 (there is no profile sub-page below the handle — see the profile API's own doc
 * comment). A resolved folder or data tier renders here; a document a client navigation found crosses to
 * the server, whose page for it is the compiled reader.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileAliasRoute } from '@/solid/pages/ProfileAlias';
import { replaceDocument } from '@/solid/lib/document-navigation';
import { InboxProvider } from '@/solid/lib/notifications';

vi.mock('@/solid/lib/document-navigation', () => ({ replaceDocument: vi.fn() }));

/** The kind door answers the format of the artifact the page door answers `page` for; every other URL is the page door. */
const answering = (page: { surface?: { format?: string } & Record<string, unknown>; folder?: unknown } & Record<string, unknown>, status = 200) => vi.fn(async (input: unknown) => {
  const url = String(input);
  if (status !== 200) return Response.json({ error: 'not_found' }, { status });
  return url.includes('part=kind') ? Response.json({ format: page.folder ? 'folder' : page.surface?.format }) : Response.json(page);
});

const at = async (path: string) => {
  window.history.replaceState(null, '', path);
  const view = render(() => <InboxProvider><Router><Route path="/:user/*rest" component={ProfileAliasRoute} /></Router></InboxProvider>);
  await vi.dynamicImportSettled();
  return view;
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(replaceDocument).mockClear(); });

it('renders the folder for an id-shaped rest path', async () => {
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', answering({ folder: { id: 'fold01', title: 'Reports', trail: [], count: { documents: 0, folders: 0 }, rows: [] }, role: 'viewer' }));
  await at('/@bob/fold01-reports');
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports'));
});

it('is the uniform 404 when the rest path names no id — nesting is not in the address', async () => {
  await at('/@bob/not-an-artifact');
  expect(screen.getByLabelText('Not found')).toBeInTheDocument();
});

it('renders a data tier here: an image alias is the data page, not a crossing', async () => {
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', answering({ role: 'viewer', kind: 'none', surface: { id: 'img001', editId: 'e1', format: 'image', title: 'Sunset', version: 1, dataPreview: '', columns: [] } }));
  await at('/@bob/img001-sunset');
  await waitFor(() => expect(screen.getByRole('img', { name: 'Sunset' })).toHaveAttribute('src', '/a/img001/raw'));
  expect(replaceDocument).not.toHaveBeenCalled();
});

it('crosses a document to the server, whose page for it is the compiled one, without fetching its page', async () => {
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  const fetched = answering({ role: 'viewer', surface: { format: 'html' } });
  vi.stubGlobal('fetch', fetched);
  await at('/@bob/doc001-hello');
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/@bob/doc001-hello'));
  expect(fetched.mock.calls.map(([url]) => String(url))).toEqual(['/api/page/artifact/doc001?part=kind']);
  expect(screen.queryByLabelText('Not found')).toBeNull();
});

it('sends the /edit alias to the dataset editor, not the folder view', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })));
  await at('/@bob/data01-set/edit');
  await waitFor(() => expect(screen.queryByLabelText('Not found')).toBeNull());
  expect(screen.queryByLabelText('Loading folder')).toBeNull();
});

// The page door answers a uniform 404 for a missing artifact and a private one alike: that is the not-found
// page, not a load failure to retry (there is nothing a retry could change).
it('shows the not-found page, not a retry, when the alias answers 404', async () => {
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })));
  await at('/@bob/doc002-private');
  await waitFor(() => expect(screen.getByLabelText('Not found')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Retry artifact' })).toBeNull();
});

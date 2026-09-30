/* @jsxImportSource solid-js */
/**
 * `/:user/*` — a pretty artifact alias (solid/pages/Profile.tsx ProfileAliasRoute). Same id-anchored
 * grammar as the React twin (web/pages/Profile.tsx): the rest path resolves to an id or it is a
 * uniform 404 (there is no profile sub-page below the handle — see the profile API's own doc
 * comment). A resolved folder renders here; a non-folder crosses to the React reader.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';
import { ProfileAliasRoute } from '@/solid/pages/Profile';
import { replaceDocument } from '@/solid/shared/document-navigation';

vi.mock('@/solid/shared/document-navigation', () => ({ replaceDocument: vi.fn() }));

const at = (path: string) => {
  window.history.replaceState(null, '', path);
  return render(() => <Router><Route path="/:user/*rest" component={ProfileAliasRoute} /></Router>);
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('renders the folder for an id-shaped rest path', async () => {
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ folder: { id: 'fold01', title: 'Reports', trail: [], count: { documents: 0, folders: 0 }, rows: [] }, role: 'viewer' })));
  at('/@bob/fold01-reports');
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reports'));
});

it('is the uniform 404 when the rest path names no id — nesting is not in the address', () => {
  at('/@bob/not-an-artifact');
  expect(screen.getByLabelText('Not found')).toBeInTheDocument();
});

it('crosses a non-folder answer to the React reader instead of rendering it here', async () => {
  vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ role: 'viewer', surface: { format: 'markup' } })));
  at('/@bob/doc001-hello');
  await waitFor(() => expect(replaceDocument).toHaveBeenCalledWith('/@bob/doc001-hello'));
  expect(screen.queryByLabelText('Not found')).toBeNull();
});

it('sends the /edit alias to the dataset editor, not the folder view', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })));
  at('/@bob/data01-set/edit');
  await waitFor(() => expect(screen.queryByLabelText('Not found')).toBeNull());
  expect(screen.queryByLabelText('Loading folder')).toBeNull();
});

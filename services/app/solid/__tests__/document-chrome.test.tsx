/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { within } from '@testing-library/dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let mockRole = 'commenter';
let mockTitle: string | null = 'A copy';
vi.mock('@/web/bootstrap', () => ({ takeBootstrap: () => ({ kind: 'account', role: mockRole, surface: { id: 'doc12345', title: mockTitle, format: 'markup', version: 3, author: { forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/web/initial-story', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/web/initial-story')>()), adoptInitialStory: () => null }));

import { DocumentPage, markChromeEditing, readerProvenancePath } from '../pages/Document';

beforeEach(() => {
  mockRole = 'commenter';
  mockTitle = 'A copy';
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/annotations')) return Response.json({ annotations: [], next_cursor: null });
    if (url.includes('/members')) return Response.json({ members: [], pending: [], self: null, canManage: false, canInvite: false });
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); document.body.replaceChildren(); for (const style of document.head.querySelectorAll('style')) style.remove(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(path = '/a/doc', extraChrome = '') {
  window.history.replaceState(null, '', path);
  const story = document.createElement('main'); story.setAttribute('data-mx-inline-story', '');
  const chrome = document.createElement('div'); chrome.setAttribute('data-mx-reader-chrome', '');
  chrome.innerHTML = '<button data-mx-reader-trigger="controls" aria-label="Open artifact controls"></button><button data-mx-reader-trigger="menu" aria-label="Open menu"></button><button data-mx-reader-action="comment" aria-label="Comment"></button>' + extraChrome;
  document.body.append(story, chrome);
  const view = render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  return { story, chrome, unmount: view.unmount };
}

/** The page's own UI renders inside trusted shadow roots: 0 the navigation layer (panels, dialogs), 1 discussion (comments, editor). */
const trusted = (index = 0) => within(document.querySelectorAll('[data-trusted-ui]')[index]!.shadowRoot as unknown as HTMLElement);

it('keeps provenance navigation on an internal artifact path', () => {
  expect(readerProvenancePath('/a/source')).toBe('/a/source');
  expect(readerProvenancePath('javascript:alert(1)')).toBeNull();
  expect(readerProvenancePath('//outside.example/a/source')).toBeNull();
});

it('opens the reader settings and phone menu and applies document mode to the adopted story', () => {
  const { story } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(trusted().getByRole('dialog', { name: 'Artifact controls' })).toHaveClass('mx-reader-panel--controls');
  expect(trusted().getByText(/forked from/)).toHaveAttribute('data-mx-forked-from');
  fireEvent.click(trusted().getByRole('button', { name: 'Dark mode' }));
  expect(story).toHaveClass('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(trusted().getByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
  expect(trusted().getByRole('link', { name: 'Artifacts' })).toBeInTheDocument();
});

it('a commenter sees comments in the controls panel but no duplicate fork, edit or delete', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(trusted().getByRole('button', { name: 'Toggle comments' })).toBeInTheDocument();
  // Fork is already a direct rail action (data-mx-reader-action="fork"); the panel must not duplicate it.
  expect(trusted().queryByRole('button', { name: 'Fork artifact' })).toBeNull();
  expect(trusted().queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(trusted().queryByRole('button', { name: /^Delete/ })).toBeNull();
});

it('an owner sees edit and delete in the controls panel', () => {
  mockRole = 'owner';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(trusted().getByRole('button', { name: 'Edit artifact' })).toBeInTheDocument();
  expect(trusted().getByRole('button', { name: 'Delete A copy' })).toBeInTheDocument();
});

it('opens the current comments in the document rail', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/annotations')) return Response.json({ annotations: [{ id: 'thread-1', snippet: 'A useful point', status: 'open', thread: [{ id: 'first', body: 'Please add the source.', author: { name: 'Reader' } }] }], next_cursor: null });
    return Response.json({});
  }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(await trusted(1).findByText('Please add the source.')).toBeInTheDocument();
  // The desktop rail is the React <aside>; a closed thread shows its root comment, and its snippet only when folded.
  expect(trusted(1).getByRole('complementary', { name: 'Annotation sidebar' })).toHaveTextContent('Please add the source.');
});

it('opens a carried fork intent after login and consumes the query parameter', () => {
  mount('/a/doc?intent=fork');
  expect(trusted().getByRole('dialog', { name: 'Fork this artifact?' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

it('an owner opens edit mode on #edit: the editor toolbar, the pinned rail and the title in the breadcrumb', async () => {
  mockRole = 'owner';
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('?part=editor')) return Response.json({ editId: 'e1', version: 3, source: '<p>hi</p>', compiledCss: null, authorCss: null });
    if (url.includes('/annotations')) return Response.json({ annotations: [], next_cursor: null });
    if (url.includes('/api/my/artifacts/doc12345')) return Response.json({ id: 'doc12345', title: 'A copy', markup: '<p>hi</p>', theme: null, version: 3, edit_id: 'e1' });
    return Response.json({});
  }));
  const { chrome } = mount('/a/doc#edit', '<button data-mx-reader-action="edit" aria-label="Edit"></button><button data-mx-reader-action="like" aria-label="Like"></button><span class="mx-reader-title">A copy</span>');
  expect(await trusted(1).findByRole('button', { name: 'Exit edit mode' }, { timeout: 4000 })).toBeInTheDocument();
  expect(chrome).toHaveAttribute('data-mx-editing');
  expect(chrome.querySelector<HTMLElement>('[data-mx-reader-action="like"]')!.hidden).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('A copy');
  expect(screen.getByLabelText('Artifact viewport').style.paddingTop).toBe('88px');
});

it('edit mode names a document with no typed title as the reader did: its first heading, not "untitled"', async () => {
  mockRole = 'owner';
  mockTitle = null;
  const source = '<div><h1 id="title">Quarterly field report</h1><p>hi</p></div>';
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('?part=editor')) return Response.json({ editId: 'e1', version: 3, source, compiledCss: null, authorCss: null });
    if (url.includes('/annotations')) return Response.json({ annotations: [], next_cursor: null });
    if (url.includes('/api/my/artifacts/doc12345')) return Response.json({ id: 'doc12345', title: null, markup: source, theme: null, version: 3, edit_id: 'e1' });
    return Response.json({});
  }));
  const { chrome } = mount('/a/doc#edit', '<button data-mx-reader-action="edit" aria-label="Edit"></button><span class="mx-reader-title">Quarterly field report</span>');
  expect(await trusted(1).findByRole('button', { name: 'Exit edit mode' }, { timeout: 4000 })).toBeInTheDocument();
  const field = screen.getByRole('textbox', { name: 'Title' });
  expect(field).toHaveValue('Quarterly field report');
  expect(chrome.querySelector('.mx-reader-title')).toHaveAttribute('data-mx-title-editor');
});

it('leaving edit mode puts the name the editor last showed back in the breadcrumb', () => {
  const chrome = document.createElement('div');
  chrome.innerHTML = '<button data-mx-reader-action="edit" aria-label="Edit"></button><span class="mx-reader-title">Old name</span>';
  const slot = markChromeEditing(chrome, true, true, null);
  expect(slot).not.toBeNull();
  expect(slot!.textContent).toBe('');
  markChromeEditing(chrome, false, false, 'Renamed report');
  expect(chrome.querySelector('.mx-reader-title')).toHaveTextContent('Renamed report');
  expect(chrome.querySelector('.mx-reader-title')).not.toHaveAttribute('data-mx-title-editor');
  // No title from the editor (it never opened): the served text stays.
  markChromeEditing(chrome, true, true, null);
  markChromeEditing(chrome, false, false, null);
  expect(chrome.querySelector('.mx-reader-title')).toHaveTextContent('Renamed report');
});

it('a viewer asking for #edit reads the document', () => {
  mockRole = 'viewer';
  const { chrome } = mount('/a/doc#edit');
  expect(chrome).not.toHaveAttribute('data-mx-editing');
  expect(document.querySelectorAll('[data-trusted-ui]')[1]!.shadowRoot!.querySelector('[aria-label="Exit edit mode"]')).toBeNull();
});

it('leaving an already-adopted document (an SPA route change) removes its own head sheets', () => {
  // The served document's head sheets (lib/compiled-page/assembler.ts), present whether or not
  // `initial-story` ever adopts this page: `data-mx-story-css` in particular collides with the app
  // shell's own Tailwind utility class names on every route rendered after it, duplicating the app
  // bar's GitHub Star button (one visible desktop/mobile variant instead of the CSS picking one).
  for (const attr of ['data-mx-chrome', 'data-mx-app-reserve', 'data-mx-story-css', 'data-mx-footer-css']) {
    document.head.insertAdjacentHTML('beforeend', `<style ${attr}>.hidden{display:none}</style>`);
  }
  const { unmount } = mount();
  for (const attr of ['data-mx-chrome', 'data-mx-app-reserve', 'data-mx-story-css', 'data-mx-footer-css']) {
    expect(document.head.querySelector(`style[${attr}]`), attr).not.toBeNull();
  }
  unmount();
  for (const attr of ['data-mx-chrome', 'data-mx-app-reserve', 'data-mx-story-css', 'data-mx-footer-css']) {
    expect(document.head.querySelector(`style[${attr}]`), attr).toBeNull();
  }
});

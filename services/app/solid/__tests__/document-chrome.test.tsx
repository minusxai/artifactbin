/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { within } from '@testing-library/dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let mockRole = 'commenter';
vi.mock('@/web/bootstrap', () => ({ takeBootstrap: () => ({ kind: 'account', role: mockRole, surface: { id: 'doc12345', title: 'A copy', format: 'markup', version: 3, author: { forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/web/initial-story', () => ({ adoptInitialStory: () => null }));

import { DocumentPage, readerProvenancePath } from '../pages/Document';

beforeEach(() => {
  mockRole = 'commenter';
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/annotations')) return Response.json({ annotations: [], next_cursor: null });
    if (url.includes('/members')) return Response.json({ members: [], pending: [], self: null, canManage: false, canInvite: false });
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); document.body.replaceChildren(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(path = '/a/doc', extraChrome = '') {
  window.history.replaceState(null, '', path);
  const story = document.createElement('main'); story.setAttribute('data-mx-inline-story', '');
  const chrome = document.createElement('div'); chrome.setAttribute('data-mx-reader-chrome', '');
  chrome.innerHTML = '<button data-mx-reader-trigger="controls" aria-label="Open artifact controls"></button><button data-mx-reader-trigger="menu" aria-label="Open menu"></button><button data-mx-reader-action="comment" aria-label="Comment"></button>' + extraChrome;
  document.body.append(story, chrome);
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  return { story, chrome };
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
  expect(trusted(1).getByRole('region', { name: 'Annotation sidebar' })).toHaveTextContent('A useful point');
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

it('a viewer asking for #edit reads the document', () => {
  mockRole = 'viewer';
  const { chrome } = mount('/a/doc#edit');
  expect(chrome).not.toHaveAttribute('data-mx-editing');
  expect(document.querySelectorAll('[data-trusted-ui]')[1]!.shadowRoot!.querySelector('[aria-label="Exit edit mode"]')).toBeNull();
});

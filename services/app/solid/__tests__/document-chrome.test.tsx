/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
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

function mount(path = '/a/doc') {
  window.history.replaceState(null, '', path);
  const story = document.createElement('main'); story.setAttribute('data-mx-inline-story', '');
  const chrome = document.createElement('div'); chrome.setAttribute('data-mx-reader-chrome', '');
  chrome.innerHTML = '<button data-mx-reader-trigger="controls" aria-label="Open artifact controls"></button><button data-mx-reader-trigger="menu" aria-label="Open menu"></button><button data-mx-reader-action="comment" aria-label="Comment"></button>';
  document.body.append(story, chrome);
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  return { story, chrome };
}

it('keeps provenance navigation on an internal artifact path', () => {
  expect(readerProvenancePath('/a/source')).toBe('/a/source');
  expect(readerProvenancePath('javascript:alert(1)')).toBeNull();
  expect(readerProvenancePath('//outside.example/a/source')).toBeNull();
});

it('opens the reader settings and phone menu and applies document mode to the adopted story', () => {
  const { story } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(screen.getByRole('region', { name: 'Artifact controls' })).toHaveClass('mx-reader-panel--controls');
  expect(screen.getByText(/forked from/)).toHaveAttribute('data-mx-forked-from');
  fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
  expect(story).toHaveClass('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('navigation', { name: 'Menu' })).toHaveClass('mx-reader-panel--menu');
});

it('a commenter sees comments and fork in the controls panel but no edit or delete', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(screen.getByRole('button', { name: 'Toggle comments' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Fork artifact' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull();
});

it('an owner sees edit and delete in the controls panel', () => {
  mockRole = 'owner';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(screen.getByRole('button', { name: 'Edit artifact' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete A copy' })).toBeInTheDocument();
});

it('opens the current comments in the document rail', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/annotations')) return Response.json({ annotations: [{ id: 'thread-1', snippet: 'A useful point', status: 'open', thread: [{ id: 'first', body: 'Please add the source.', author: { name: 'Reader' } }] }], next_cursor: null });
    return Response.json({});
  }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(await screen.findByText('Please add the source.')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Annotation sidebar' })).toHaveTextContent('A useful point');
});

it('opens a carried fork intent after login and consumes the query parameter', () => {
  mount('/a/doc?intent=fork');
  expect(screen.getByRole('dialog', { name: 'Fork this artifact?' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

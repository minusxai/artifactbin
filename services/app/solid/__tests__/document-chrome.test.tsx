/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@/web/bootstrap', () => ({ takeBootstrap: () => ({ kind: 'account', role: 'commenter', surface: { id: 'doc', title: 'A copy', format: 'markup', author: { forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/web/initial-story', () => ({ adoptInitialStory: () => null }));

import { DocumentPage, readerProvenancePath } from '../pages/Document';

afterEach(() => { cleanup(); document.body.replaceChildren(); window.history.replaceState(null, '', '/'); });

it('keeps provenance navigation on an internal artifact path', () => {
  expect(readerProvenancePath('/a/source')).toBe('/a/source');
  expect(readerProvenancePath('javascript:alert(1)')).toBeNull();
  expect(readerProvenancePath('//outside.example/a/source')).toBeNull();
});

it('opens the reader settings and phone menu and applies document mode to the adopted story', () => {
  window.history.replaceState(null, '', '/a/doc');
  const story = document.createElement('main'); story.setAttribute('data-mx-inline-story', '');
  const chrome = document.createElement('div'); chrome.setAttribute('data-mx-reader-chrome', '');
  chrome.innerHTML = '<button data-mx-reader-trigger="controls" aria-label="Open artifact controls"></button><button data-mx-reader-trigger="menu" aria-label="Open menu"></button><button data-mx-reader-action="comment" aria-label="Comment"></button>';
  document.body.append(story, chrome);
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(screen.getByRole('region', { name: 'Artifact controls' })).toHaveClass('mx-reader-panel--controls');
  expect(screen.getByText(/forked from/)).toHaveAttribute('data-mx-forked-from');
  fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
  expect(story).toHaveClass('dark');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('navigation', { name: 'Menu' })).toHaveClass('mx-reader-panel--menu');
});

it('opens the current comments in the document rail', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ annotations: [{ id: 'thread-1', snippet: 'A useful point', thread: [{ id: 'first', body: 'Please add the source.', author: { name: 'Reader' } }] }], next_cursor: null })));
  window.history.replaceState(null, '', '/a/doc');
  const story = document.createElement('main'); story.setAttribute('data-mx-inline-story', '');
  const chrome = document.createElement('div'); chrome.setAttribute('data-mx-reader-chrome', '');
  chrome.innerHTML = '<button data-mx-reader-action="comment" aria-label="Comment"></button>';
  document.body.append(story, chrome);
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(await screen.findByText('Please add the source.')).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Comments' })).toHaveTextContent('A useful point');
});

it('opens a carried fork intent after login and consumes the query parameter', () => {
  window.history.replaceState(null, '', '/a/doc?intent=fork');
  const story = document.createElement('main'); story.setAttribute('data-mx-inline-story', '');
  const chrome = document.createElement('div'); chrome.setAttribute('data-mx-reader-chrome', '');
  document.body.append(story, chrome);
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  expect(screen.getByRole('dialog', { name: 'Fork this artifact?' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

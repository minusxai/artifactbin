/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT PAGE AROUND ITS FRAME (solid/pages/Document): the app's own bar (solid/document/DocumentChrome) with
 * the controls panel, the rail's actions and the comments rail, and the frame the server drew adopted in place —
 * the document itself is never rendered on the app page.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { within } from '@testing-library/dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let mockRole = 'commenter';
let mockTitle: string | null = 'A copy';
let mockArchived: { version: number; head: number } | null = null;
let served: HTMLElement | null = null;
vi.mock('@/web/bootstrap', () => ({ takeBootstrap: () => ({ kind: 'account', role: mockRole, archived: mockArchived, surface: { id: 'doc12345', title: mockTitle, format: 'markup', version: 3, framedOrigin: 'http://646f633132333435.lvh.me', author: { username: 'ada', id: 'u1', forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/web/served-frame', () => ({ adoptServedFrame: () => { const frame = served; served = null; return frame; } }));

import { DocumentPage } from '../pages/Document';

beforeEach(() => {
  mockRole = 'commenter';
  mockTitle = 'A copy';
  mockArchived = null;
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
  const host = document.createElement('div');
  host.setAttribute('data-mx-framed', '');
  const frame = document.createElement('iframe');
  frame.setAttribute('data-mx-document-frame', '');
  host.append(frame);
  document.body.append(host);
  served = host;
  const view = render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  return { host, frame, unmount: view.unmount };
}

/** The page's trusted overlays: 0 the navigation layer (install, fork), 1 discussion (comments, editor, sharing). */
const trusted = (index = 0) => within(document.querySelectorAll('[data-trusted-ui]')[index]!.shadowRoot as unknown as HTMLElement);

it('adopts the served frame into the page instead of rendering the document', () => {
  const { host, frame } = mount();
  const viewport = screen.getByLabelText('Artifact viewport');
  expect(viewport).toContainElement(host);
  expect(host).toContainElement(frame);
  expect(viewport.querySelector('[data-mx-frame-slot]')).not.toBeNull();
  expect(viewport.style.position).toBe('fixed');
  expect(viewport.style.top).toBe('44px');
});

it('opens the artifact controls and the menu from the app bar', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = screen.getByRole('region', { name: 'Artifact controls' });
  fireEvent.click(within(panel).getByRole('button', { name: 'Dark mode' }));
  expect(within(panel).getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(screen.getByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Artifacts' })).toBeInTheDocument();
});

it('names the author and the document in the bar', () => {
  mount();
  expect(screen.getByRole('link', { name: "View @ada's profile" })).toHaveAttribute('href', '/@ada');
  expect(screen.getByText('A copy')).toHaveAttribute('data-mx-document-title');
});

it('says where a fork came from in the controls panel, linked to the source', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(screen.getByRole('region', { name: 'Artifact controls' }));
  expect(panel.getByRole('link', { name: 'Open the artifact this was forked from' })).toHaveAttribute('href', '/a/source');
  expect(panel.getByText(/forked from/)).toHaveAttribute('data-mx-forked-from');
});

it('an archived version names itself in the bar, read-only', () => {
  mockRole = 'owner';
  mockArchived = { version: 1, head: 2 };
  mount('/a/doc?version=1');
  const line = screen.getByText('Version 1 of 2 · read-only');
  expect(line).toHaveAttribute('data-mx-archived-version', '1');
  expect(line).toHaveAttribute('data-mx-archived-head', '2');
  // Nothing on the bar acts on an older version.
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Like' })).toBeNull();
});

it('the head names no version', () => {
  mockRole = 'owner';
  mount();
  expect(screen.queryByText(/read-only/)).toBeNull();
});

it('a commenter sees comments in the controls panel but no duplicate fork, edit or delete', () => {
  mount();
  // Fork is a direct rail action; the panel does not duplicate it.
  expect(screen.getByRole('button', { name: 'Fork artifact' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(screen.getByRole('region', { name: 'Artifact controls' }));
  expect(panel.getByRole('button', { name: 'Toggle comments' })).toBeInTheDocument();
  expect(panel.queryByRole('button', { name: 'Fork artifact' })).toBeNull();
  expect(panel.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(panel.queryByRole('button', { name: /^Delete/ })).toBeNull();
});

it('an owner sees edit and delete in the controls panel, and Edit and Share on the rail', () => {
  mockRole = 'owner';
  mount();
  expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(screen.getByRole('region', { name: 'Artifact controls' }));
  expect(panel.getByRole('button', { name: 'Edit artifact' })).toBeInTheDocument();
  expect(panel.getByRole('button', { name: 'Delete A copy' })).toBeInTheDocument();
});

it('an owner reaches the social preview from the sharing dialog the rail opens', async () => {
  mockRole = 'owner';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(await trusted().findByRole('button', { name: 'Edit social preview' })).toBeInTheDocument();
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
  expect(trusted(1).getByRole('complementary', { name: 'Annotation sidebar' })).toHaveTextContent('Please add the source.');
});

it('opens a carried fork intent after login and consumes the query parameter', () => {
  mount('/a/doc?intent=fork');
  expect(trusted().getByRole('dialog', { name: 'Fork this artifact?' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

it('a viewer asking for #edit reads the document', () => {
  mockRole = 'viewer';
  mount('/a/doc#edit');
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(document.querySelectorAll('[data-trusted-ui]')[1]!.shadowRoot!.querySelector('[aria-label="Exit edit mode"]')).toBeNull();
});

it('leaving the document takes its frame off the page', () => {
  const { host, unmount } = mount();
  expect(host.isConnected).toBe(true);
  unmount();
  expect(host.isConnected).toBe(false);
});

it('a page served without a frame is the 404 page, never a reload', () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  window.history.replaceState(null, '', '/a/doc');
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /></Router>);
  expect(screen.queryByLabelText('Artifact viewport')?.querySelector('iframe') ?? null).toBeNull();
  expect(replace).not.toHaveBeenCalled();
});

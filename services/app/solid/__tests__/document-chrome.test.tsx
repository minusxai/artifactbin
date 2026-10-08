/* @jsxImportSource solid-js */
/**
 * THE DOCUMENT PAGE AROUND ITS FRAME (solid/pages/Document): the app's own bar (solid/document/DocumentChrome) with
 * the controls panel, the rail's actions and the comments rail, and the frame the server drew adopted in place —
 * the document itself is never rendered on the app page.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { waitFor, within } from '@testing-library/dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import type { ArtifactLiveEvent } from '@/lib/story/realtime/live';

let mockRole = 'commenter';
let mockKind = 'account';
let mockTitle: string | null = 'A copy';
let mockArchived: { version: number; head: number } | null = null;
let served: HTMLElement | null = null;
let mockCsp: Record<string, unknown> | undefined;
let mockTemplate: string | null = null;
let mockLive = () => null as ArtifactLiveEvent | null;
vi.mock('../editor/create-live-artifact', () => ({ createLiveArtifact: () => () => mockLive() }));
vi.mock('@/web/bootstrap', () => ({ takeBootstrap: () => ({ kind: mockKind, role: mockRole, archived: mockArchived, cspRequest: mockCsp, surface: { id: 'doc12345', template: mockTemplate, title: mockTitle, format: 'markup', version: 3, framedOrigin: 'http://646f633132333435.lvh.me', author: { username: 'ada', id: 'u1', forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/lib/http/login-href', () => ({ loginHref: vi.fn(() => '/login') }));
import { loginHref } from '@/lib/http/login-href';
vi.mock('../lib/copy-text', () => ({ copyText: vi.fn(async () => true) }));
import { copyText } from '../lib/copy-text';
vi.mock('@/web/served-frame', () => ({ adoptServedFrame: () => { const frame = served; served = null; return frame; } }));
// The test exercises the real editor tabs; CodeMirror geometry is outside this page-level contract.
vi.mock('../editor/SourceEditor', () => ({ default: () => <textarea aria-label="Markup source" /> }));

import { DocumentPage } from '../pages/Document';

beforeEach(() => {
  mockRole = 'commenter';
  mockKind = 'account';
  vi.mocked(loginHref).mockClear();
  mockTitle = 'A copy';
  mockArchived = null;
  mockCsp = undefined;
  mockTemplate = null;
  mockLive = () => null;
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
const trusted = (index = 0) => within(document.querySelectorAll('[data-trusted-ui]')[index]!.shadowRoot!.querySelector<HTMLElement>('[data-trusted-ui-root]')!);
/**
 * The app bar's open panel, wherever it is mounted: it rides the page's trusted overlay (lib/islands/trusted-portal) so it
 * paints in the top layer above the comments rail, which is itself a top-layer overlay.
 */
const panelRoot = (): HTMLElement => {
  const hosts = [...document.querySelectorAll('[data-trusted-ui]')].map((host) => host.shadowRoot as unknown as HTMLElement);
  return hosts.find((root) => root.querySelector('[aria-label="Close panel"]')) ?? document.body;
};
const controls = () => within(panelRoot()).getByRole('region', { name: 'Artifact controls' });

it('places the doc agent handoff in trusted document navigation, outside the page bar', async () => {
  mockRole = 'owner'; mockTemplate = 'doc';
  mount();
  expect(screen.queryByRole('button', { name: 'Copy for agent' })).toBeNull();
  fireEvent.click(trusted().getByRole('button', { name: 'Copy for agent' }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('template: doc')));
});

it('hides the agent handoff in Code and restores it in Artifact', async () => {
  mockRole = 'owner'; mockTemplate = 'doc';
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<p id="body">Hello</p>', compiledCss: null, authorCss: null });
    return existing(input, init);
  });
  mount('/a/doc#edit');
  // Wait for the real lazy editor module before querying its tabs, including a cold CI import.
  await vi.dynamicImportSettled();
  const code = trusted(1).getByRole('tab', { name: 'Edit the source' });
  expect(trusted().getByRole('button', { name: 'Copy for agent' })).toBeInTheDocument();
  fireEvent.click(code);
  await waitFor(() => expect(trusted().queryByRole('button', { name: 'Copy for agent' })).toBeNull());
  fireEvent.click(trusted(1).getByRole('tab', { name: 'Edit on the page' }));
  expect(trusted().getByRole('button', { name: 'Copy for agent' })).toBeInTheDocument();
});

it.each([['owner', 'app'], ['commenter', 'doc']])('omits the small agent button for %s viewing %s', (role, template) => {
  mockRole = role; mockTemplate = template;
  mount();
  expect(screen.queryByRole('button', { name: 'Copy for agent' })).toBeNull();
  expect(trusted().queryByRole('button', { name: 'Copy for agent' })).toBeNull();
});

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
  const panel = controls();
  fireEvent.click(within(panel).getByRole('button', { name: 'Dark mode' }));
  expect(within(panel).getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = within(panelRoot()).getByRole('navigation', { name: 'Menu' });
  expect(menu).toHaveClass('right-3', 'top-14');
  expect(menu).not.toHaveClass('left-0', 'inset-y-0');
  expect(within(panelRoot()).getByRole('link', { name: 'Artifacts' })).toBeInTheDocument();
});

it('places the artifact menu in a bottom sheet on phones and a dropdown after resizing', () => {
  vi.stubGlobal('innerWidth', 390);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = within(panelRoot()).getByRole('navigation', { name: 'Menu' });
  expect(menu).toHaveClass('inset-x-0', 'bottom-0');
  expect(menu).not.toHaveClass('left-0', 'inset-y-0');
  vi.stubGlobal('innerWidth', 1280);
  fireEvent(window, new Event('resize'));
  expect(menu).toHaveClass('right-3', 'top-14');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
});

it('names the author and the document in the bar', () => {
  mount();
  expect(screen.getByRole('link', { name: "View @ada's profile" })).toHaveAttribute('href', '/@ada');
  expect(screen.getByText('A copy', { selector: '[data-mx-document-title]' })).toHaveAttribute('data-mx-document-title');
});

it('says where a fork came from in the controls panel, linked to the source', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(controls());
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
  const panel = within(controls());
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
  const panel = within(controls());
  expect(panel.getByRole('button', { name: 'Edit artifact' })).toBeInTheDocument();
  expect(panel.getByRole('button', { name: 'Delete A copy' })).toBeInTheDocument();
});

/*
 * The comments rail is a top-layer overlay (the trusted "discussion" layer), and the top layer ignores z-index: a panel
 * on the ordinary page paints UNDER it whatever its z-index, so "Edit artifact" beside an open rail could not be
 * pressed. The app bar's panels open in the trusted "navigation" layer, which is ordered above "discussion".
 */
it('the controls panel opened beside the open rail paints above it', async () => {
  // jsdom has no top layer: model its paint order. The last root shown paints over every earlier one; z-index is not consulted.
  const topLayer: HTMLElement[] = [];
  const leave = (el: HTMLElement) => { const at = topLayer.indexOf(el); if (at >= 0) topLayer.splice(at, 1); };
  Object.defineProperties(HTMLElement.prototype, {
    showPopover: { configurable: true, writable: true, value(this: HTMLElement) { if (!this.isConnected || !this.hasAttribute('popover')) throw new DOMException('Invalid popover state', 'InvalidStateError'); leave(this); topLayer.push(this); } },
    hidePopover: { configurable: true, writable: true, value(this: HTMLElement) { leave(this); } },
  });
  // Found by selector, not by role: jsdom cannot match `:popover-open`, so it computes every popover root as hidden.
  const find = (selector: string) => [document, ...[...document.querySelectorAll('[data-trusted-ui]')].map((host) => host.shadowRoot!)]
    .map((root) => root.querySelector<HTMLElement>(selector)).find(Boolean) ?? null;
  try {
    mockRole = 'owner';
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    const rail = await waitFor(() => find('[aria-label="Annotation sidebar"]') ?? Promise.reject(new Error('no rail')));
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    const edit = find('[aria-label="Edit artifact"]');
    expect(edit, 'the controls panel offers Edit artifact').not.toBeNull();
    const paintOrder = (el: Element) => {
      const root = el.getRootNode();
      const trustedRoot = root instanceof ShadowRoot ? root.querySelector<HTMLElement>('[data-trusted-ui-root]') : null;
      return trustedRoot ? topLayer.indexOf(trustedRoot) : -1;
    };
    expect(paintOrder(rail), 'the rail is a top-layer overlay').toBeGreaterThanOrEqual(0);
    expect(paintOrder(edit!), 'the controls panel paints after the rail, so Edit artifact can be pressed').toBeGreaterThan(paintOrder(rail));
  } finally {
    cleanup();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).hidePopover;
  }
});

/*
 * The consent bar is first-party UI with its own trusted root, in the slot above the frame — EARLIER in the page than the
 * navigation layer. The bar's panels (and every popover and dialog, lib/islands/trusted-portal) must still open in the
 * navigation layer, the top-layer overlay ordered above the rail, never in the bar's ordinary root.
 */
it('opens the bar\'s panels in the navigation layer while the consent bar holds a trusted root earlier in the page', () => {
  const hosts = { connect: ['https://api.open-meteo.com'], script: [], style: [], img: [], frame: [], media: [] };
  mockCsp = { status: 'blocked', denied: false, extensions: hosts, asking: hosts };
  mount();
  const roots = [...document.querySelectorAll('[data-trusted-ui]')];
  const bar = roots.findIndex((root) => root.shadowRoot!.querySelector('[aria-label="Document network access"]'));
  const navigation = roots.findIndex((root) => root.getAttribute('data-trusted-layer') === 'navigation');
  expect(bar, 'the consent bar is drawn in a trusted root').toBeGreaterThanOrEqual(0);
  expect(bar, 'and that root comes before the navigation layer').toBeLessThan(navigation);
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect((controls().getRootNode() as ShadowRoot).host).toBe(roots[navigation]);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect((within(panelRoot()).getByRole('navigation', { name: 'Menu' }).getRootNode() as ShadowRoot).host).toBe(roots[navigation]);
});

it('an owner reaches the social preview from the sharing dialog the rail opens', async () => {
  mockRole = 'owner';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(await trusted().findByRole('button', { name: 'Edit social preview' })).toBeInTheDocument();
});

it('shares the current editor title without requiring a page reload', async () => {
  mockRole = 'owner'; mockTitle = 'Untitled';
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<p id="body">Hello</p>', compiledCss: null, authorCss: null });
    return existing(input, init);
  });
  mount('/a/doc#edit');
  await vi.dynamicImportSettled();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  fireEvent.input(title, { target: { value: 'Renamed without reload' } });
  fireEvent.blur(title);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(trusted().getByRole('heading', { name: 'Share “Renamed without reload”' })).toBeInTheDocument());
  fireEvent.input(title, { target: { value: 'Second current title' } });
  expect(trusted().getByRole('heading', { name: 'Share “Second current title”' })).toBeInTheDocument();
  fireEvent.input(title, { target: { value: '' } });
  expect(trusted().getByRole('heading', { name: 'Share “Untitled”' })).toBeInTheDocument();
});

it('uses the heading fallback in embedded sharing and adopts later reader metadata', async () => {
  mockRole = 'owner'; mockTitle = 'Old explicit name';
  const [frame, setFrame] = createSignal<ArtifactLiveEvent | null>(null);
  mockLive = frame;
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<h2 id="heading">Heading fallback</h2><p id="body">Hello</p>', compiledCss: null, authorCss: null });
    return existing(input, init);
  });
  mount('/a/doc#edit');
  await vi.dynamicImportSettled();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  fireEvent.input(title, { target: { value: '' } });
  fireEvent.click(trusted(1).getByRole('tab', { name: 'Show sharing' }));
  expect(trusted(1).getByRole('heading', { name: 'Share “Heading fallback”' })).toBeInTheDocument();
  fireEvent.input(title, { target: { value: 'Session name' } });
  expect(trusted(1).getByRole('heading', { name: 'Share “Session name”' })).toBeInTheDocument();
  setFrame({ version: 5, title: 'Remote name', source: '<h2 id="heading">Remote heading</h2>' } as ArtifactLiveEvent);
  expect(trusted(1).getByRole('heading', { name: 'Share “Session name”' })).toBeInTheDocument();
  fireEvent.click(trusted(1).getByRole('button', { name: 'Exit edit mode' }));
  await waitFor(() => expect(screen.getByText('Remote name', { selector: '[data-mx-document-title]' })).toBeInTheDocument(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(trusted().getByRole('heading', { name: 'Share “Remote name”' })).toBeInTheDocument();
  setFrame({ version: 6, title: null, source: '<h2 id="heading">Later remote heading</h2>' } as ArtifactLiveEvent);
  expect(trusted().getByRole('heading', { name: 'Share “Later remote heading”' })).toBeInTheDocument();
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

it('consumes a signed-in viewer comment intent without restarting login', () => {
  mockRole = 'viewer';
  mount('/a/doc?intent=comment');
  expect(window.location.search).toBe('');
  expect(loginHref).not.toHaveBeenCalled();
  const notice = [...document.querySelectorAll('[data-trusted-ui]')].map(host => host.shadowRoot?.querySelector('[role="status"]')).find(Boolean);
  expect(notice).toHaveTextContent('You have view-only access. Ask the owner for comment access.');
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(loginHref).not.toHaveBeenCalled();
  const noticeHost = notice!.getRootNode() as ShadowRoot;
  fireEvent.click(within(noticeHost.querySelector<HTMLElement>('[data-trusted-ui-root]')!).getByRole('button', { name: 'Dismiss comment access notice' }));
  expect(notice).not.toBeInTheDocument();
});

it('does not send a signed-in owner of an archived version back to login', () => {
  mockRole = 'owner'; mockArchived = { version: 2, head: 3 };
  mount('/a/doc?intent=comment');
  expect(loginHref).not.toHaveBeenCalled();
  const notice = [...document.querySelectorAll('[data-trusted-ui]')].map(host => host.shadowRoot?.querySelector('[role="status"]')).find(Boolean);
  expect(notice).toHaveTextContent('Comments are unavailable on archived versions.');
});

it('opens a carried comment intent for an authorized commenter without login', () => {
  mount('/a/doc?intent=comment');
  expect(window.location.search).toBe('');
  expect(loginHref).not.toHaveBeenCalled();
  expect(trusted(1).getByRole('complementary', { name: 'Annotation sidebar' })).toBeInTheDocument();
});

it('still offers login to a guest asking to comment', () => {
  mockKind = 'anon'; mockRole = 'viewer';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(loginHref).toHaveBeenCalledWith(window.location, 'comment');
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

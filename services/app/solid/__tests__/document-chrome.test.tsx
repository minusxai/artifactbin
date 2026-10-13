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
import { STORY_FRAME_HASH_MESSAGE, type ArtifactLiveEvent } from '@/lib/story-runtime/contract';
import type { FramedStory } from '../document/create-framed-story';
import * as liveEdits from '../editor/create-live-edits';

let mockRole = 'commenter';
let mockKind = 'account';
let mockTitle: string | null = 'A copy';
let mockArchived: { version: number; head: number } | null = null;
let served: HTMLElement | null = null;
let mockCsp: Record<string, unknown> | undefined;
let mockTemplate: string | null = null;
let mockSourceLength: number | undefined;
let mockLive = () => null as ArtifactLiveEvent | null;
let mockSelectionBridge = false;
const selectionSend = vi.fn();
let selectionReceive: ((data: unknown) => void) | undefined;
vi.mock('../document/create-framed-story', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../document/create-framed-story')>();
  return { ...actual, createFramedStory: (...args: Parameters<typeof actual.createFramedStory>) => {
    if (!mockSelectionBridge) return actual.createFramedStory(...args);
    return {
      frame: args[0].framed.frame, nonce: () => 'guest-selection-nonce', setTopInset: () => {},
      controller: () => ({ send: selectionSend, getViewportRect: () => undefined, subscribe: (receive: (data: unknown) => void) => {
        selectionReceive = receive; return () => {};
      } }),
    } as unknown as FramedStory;
  } };
});
vi.mock('../editor/create-live-artifact', () => ({ createLiveArtifact: () => () => mockLive() }));
vi.mock('@/solid/lib/bootstrap', () => ({ takeBootstrap: () => ({ kind: mockKind, role: mockRole, archived: mockArchived, cspRequest: mockCsp, surface: { id: 'doc12345', template: mockTemplate, title: mockTitle, format: 'markup', version: 3, sourceLength: mockSourceLength, framedOrigin: 'http://646f633132333435.lvh.me', author: { username: 'ada', id: 'u1', forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/lib/http/login-href', () => ({ loginHref: vi.fn(() => '/login') }));
import { loginHref } from '@/lib/http/login-href';
vi.mock('../lib/copy-text', () => ({ copyText: vi.fn(async () => true) }));
import { copyText } from '../lib/copy-text';
vi.mock('@/solid/lib/served-frame', () => ({ adoptServedFrame: () => { const frame = served; served = null; return frame; } }));
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
  mockSourceLength = undefined;
  mockLive = () => null;
  mockSelectionBridge = false;
  selectionSend.mockClear();
  selectionReceive = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/annotations')) return Response.json({ annotations: [], next_cursor: null });
    if (url.includes('/members')) return Response.json({ members: [], pending: [], self: null, canManage: false, canInvite: false });
    return Response.json({});
  }));
});

afterEach(() => { cleanup(); localStorage.clear(); document.cookie = 'mx_theme=; path=/; max-age=0'; document.body.replaceChildren(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
  // What the page posts to its frame (the bridge's envelopes, the hash): the window the frame has once the page
  // adopted it (a move without moveBefore gives the frame a new one).
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
  return { host, frame, posted, unmount: view.unmount };
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
// The bar's panels load on first open (components/PageChromePanels), so they are awaited.
const controls = () => waitFor(() => within(panelRoot()).getByRole('region', { name: 'Artifact controls' }));
const menuPanel = () => waitFor(() => within(panelRoot()).getByRole('navigation', { name: 'Menu' }));

it('places the doc agent handoff in trusted document navigation, outside the page bar', async () => {
  mockRole = 'owner'; mockTemplate = 'doc';
  mount();
  expect(screen.queryByRole('button', { name: 'Copy for agent' })).toBeNull();
  fireEvent.click(trusted().getByRole('button', { name: 'Copy for agent' }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('/a/doc12345 in place.')));
});

it('hides the agent handoff in Code and restores it in Artifact', async () => {
  mockRole = 'owner'; mockTemplate = 'doc';
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<p id="body">Hello</p>' });
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

it('opens the artifact controls and the menu from the app bar', async () => {
  delete document.documentElement.dataset.theme;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = await controls();
  fireEvent.click(within(panel).getByRole('button', { name: 'Dark mode' }));
  // The toggle shows the app's appearance, which follows <html data-theme> (observed, so a microtask later).
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true'));
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = await menuPanel();
  expect(menu).toHaveClass('right-3'); expect(menu.style.top).toBe('44px');
  expect(menu).not.toHaveClass('left-0', 'inset-y-0');
  expect(within(panelRoot()).getByRole('link', { name: 'Artifacts' })).toBeInTheDocument();
});

it('shows and sets the APP appearance in the controls panel, while the light document keeps its own ground', async () => {
  document.documentElement.dataset.theme = 'dark';
  mockRole = 'viewer'; mockSelectionBridge = true;
  try {
    mount();
    const viewport = screen.getByLabelText('Artifact viewport');
    const ground = viewport.style.background;
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    const panel = await controls();
    expect(within(panel).getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'false');
    expect(viewport.style.background).toBe(ground);
    fireEvent.click(within(panel).getByRole('button', { name: 'Light mode' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true'));
    // The reader's pick is still sent into the frame (one choice, both surfaces).
    expect(selectionSend).toHaveBeenCalledWith(expect.objectContaining({ mode: 'light' }));
  } finally { delete document.documentElement.dataset.theme; }
});

it('places the artifact menu in a bottom sheet on phones and a dropdown after resizing', async () => {
  vi.stubGlobal('innerWidth', 390);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  const menu = await menuPanel();
  expect(menu).toHaveClass('inset-x-0', 'bottom-0');
  expect(menu).not.toHaveClass('left-0', 'inset-y-0');
  vi.stubGlobal('innerWidth', 1280);
  fireEvent(window, new Event('resize'));
  expect(menu).toHaveClass('right-3'); expect(menu.style.top).toBe('44px');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus();
});

it('names the author and the document in the bar', () => {
  mount();
  expect(screen.getByRole('link', { name: "View @ada's profile" })).toHaveAttribute('href', '/@ada');
  expect(screen.getByText('A copy', { selector: '[data-mx-document-title]' })).toHaveAttribute('data-mx-document-title');
});

it('says where a fork came from in the controls panel, linked to the source', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(await controls());
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

it('a commenter sees comments in the controls panel but no duplicate fork, edit or delete', async () => {
  mount();
  // Fork is a direct rail action; the panel does not duplicate it.
  expect(screen.getByRole('button', { name: 'Fork artifact' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(await controls());
  expect(panel.getByRole('button', { name: 'Toggle comments' })).toBeInTheDocument();
  expect(panel.queryByRole('button', { name: 'Fork artifact' })).toBeNull();
  expect(panel.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(panel.queryByRole('button', { name: /^Delete/ })).toBeNull();
});

it('an owner sees edit and delete in the controls panel, and Edit and Share on the rail', async () => {
  mockRole = 'owner';
  mount();
  expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(await controls());
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
    const edit = await waitFor(() => find('[aria-label="Edit artifact"]') ?? Promise.reject(new Error('no controls panel')));
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
it('opens the bar\'s panels in the navigation layer while the consent bar holds a trusted root earlier in the page', async () => {
  const hosts = { connect: ['https://api.open-meteo.com'], script: [], style: [], img: [], frame: [], media: [] };
  mockCsp = { status: 'blocked', denied: false, extensions: hosts, asking: hosts };
  mount();
  const roots = [...document.querySelectorAll('[data-trusted-ui]')];
  const bar = roots.findIndex((root) => root.shadowRoot!.querySelector('[aria-label="Document network access"]'));
  const navigation = roots.findIndex((root) => root.getAttribute('data-trusted-layer') === 'navigation');
  expect(bar, 'the consent bar is drawn in a trusted root').toBeGreaterThanOrEqual(0);
  expect(bar, 'and that root comes before the navigation layer').toBeLessThan(navigation);
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  expect(((await controls()).getRootNode() as ShadowRoot).host).toBe(roots[navigation]);
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  expect(((await menuPanel()).getRootNode() as ShadowRoot).host).toBe(roots[navigation]);
});

// A named EDITOR (the collab-roles gate's step 7, moved here): edit in the controls panel and the whole sharing dialog —
// access controls and social preview — but none of the owner's own actions.
it('an editor sees edit in the controls panel and a sharing dialog with access controls and social preview', async () => {
  mockRole = 'editor';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(await controls());
  expect(panel.getByRole('button', { name: 'Edit artifact' })).toBeInTheDocument();
  expect(panel.queryByLabelText('Owner actions')).toBeNull();
  fireEvent.click(within(panel.getAllByLabelText('Document actions')[0]!).getByRole('button', { name: 'Share' }));
  expect(await trusted().findByRole('button', { name: 'Edit social preview' })).toBeInTheDocument();
  expect(await trusted().findByRole('button', { name: 'Make public' })).toBeInTheDocument();
  expect(trusted().getByRole('textbox', { name: 'Invite email' })).toBeInTheDocument();
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
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<p id="body">Hello</p>' });
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

it.each(['', '   '])('uses the heading fallback for a blank explicit title (%j) in embedded sharing and adopts later reader metadata', async (blankTitle) => {
  const queued: liveEdits.PendingChange[] = [];
  const createLiveEdits = liveEdits.createLiveEdits;
  vi.spyOn(liveEdits, 'createLiveEdits').mockImplementation((options) => {
    const live = createLiveEdits(options);
    const queue = live.queue;
    live.queue = (change) => { queued.push(change); queue(change); };
    return live;
  });
  mockRole = 'owner'; mockTitle = 'Old explicit name';
  const [frame, setFrame] = createSignal<ArtifactLiveEvent | null>(null);
  mockLive = frame;
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<h2 id="heading">Heading fallback</h2><p id="body">Hello</p>' });
    return existing(input, init);
  });
  mount('/a/doc#edit');
  await vi.dynamicImportSettled();
  const title = await screen.findByRole('textbox', { name: 'Title' });
  fireEvent.input(title, { target: { value: blankTitle } });
  expect(queued.at(-1)?.title).toBe(blankTitle);
  fireEvent.click(trusted(1).getByRole('tab', { name: 'Show sharing' }));
  expect(trusted(1).getByRole('heading', { name: 'Share “Heading fallback”' })).toBeInTheDocument();
  fireEvent.input(title, { target: { value: 'Session name' } });
  expect(trusted(1).getByRole('heading', { name: 'Share “Session name”' })).toBeInTheDocument();
  setFrame({ version: 5, title: 'Remote name', heading: 'Remote heading', source: '<h2 id="heading">Remote heading</h2>' } as ArtifactLiveEvent);
  expect(trusted(1).getByRole('heading', { name: 'Share “Session name”' })).toBeInTheDocument();
  fireEvent.click(trusted(1).getByRole('button', { name: 'Exit edit mode' }));
  await waitFor(() => expect(screen.getByText('Remote name', { selector: '[data-mx-document-title]' })).toBeInTheDocument(), { timeout: 5000 });
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  expect(trusted().getByRole('heading', { name: 'Share “Remote name”' })).toBeInTheDocument();
  setFrame({ version: 6, title: null, heading: 'Later remote heading', source: '<h2 id="heading">Later remote heading</h2>' } as ArtifactLiveEvent);
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

it('offers the framed comment action to a guest and sends it through sign-in', () => {
  mockKind = 'anon'; mockRole = 'viewer'; mockSelectionBridge = true;
  mount();
  expect(selectionSend).toHaveBeenCalledWith({ type: 'mx:selection-actions', edit: false, annotate: true });
  selectionReceive?.({ type: 'mx:selection-action', nonce: 'guest-selection-nonce', action: 'annotate',
    selection: { kind: 'text', path: '0', nodeId: 'n1', tag: 'p', rect: { x: 0, y: 0, width: 1, height: 1 }, className: '', style: '', ancestors: [] } });
  expect(loginHref).toHaveBeenCalledWith(window.location, 'comment');
  expect(document.querySelector('[aria-label="Annotation composer"]')).toBeNull();
});

it.each(['viewer', 'archived guest'])('does not grant a framed comment action to a %s', (kind) => {
  mockRole = 'viewer'; mockSelectionBridge = true;
  if (kind === 'archived guest') { mockKind = 'anon'; mockArchived = { version: 1, head: 2 }; }
  mount();
  expect(selectionSend).toHaveBeenCalledWith({ type: 'mx:selection-actions', edit: false, annotate: false });
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

/** What the editor's door costs is the document's size: a writer who only reads a large one never pays it. */
const editorDoorFetches = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('?part=editor')).length;
const answerEditorDoor = () => {
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => (String(input).includes('?part=editor')
    ? Response.json({ editId: 'edit-3', version: 3, source: '<p id="body">Hello</p>' }) : existing(input, init)));
};
const idleNow = () => vi.stubGlobal('requestIdleCallback', (task: () => void) => { queueMicrotask(task); return 1; });

it('does not fetch the editor part on idle for a writer reading a large document, only when edit mode opens', async () => {
  mockRole = 'owner'; mockSourceLength = 450_000;
  answerEditorDoor(); idleNow();
  mount();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(editorDoorFetches()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  fireEvent.click(within(await controls()).getByRole('button', { name: 'Edit artifact' }));
  await waitFor(() => expect(editorDoorFetches()).toBe(1));
});

it('prefetches the editor part on idle for a writer reading a small document, so edit mode opens at once', async () => {
  mockRole = 'owner'; mockSourceLength = 2_000;
  answerEditorDoor(); idleNow();
  mount();
  await waitFor(() => expect(editorDoorFetches()).toBe(1));
});

it('prefetches nothing for a page that does not say how large the document is', async () => {
  mockRole = 'owner';
  answerEditorDoor(); idleNow();
  mount();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(editorDoorFetches()).toBe(0);
});

it.each([['hover', (el: Element) => fireEvent.pointerEnter(el)], ['focus', (el: Element) => fireEvent.focus(el)], ['press', (el: Element) => fireEvent.pointerDown(el)]])(
  'starts the editor part when the Edit control is approached (%s), and the click that follows shares that one request', async (_name, approach) => {
    mockRole = 'owner'; mockSourceLength = 450_000;
    answerEditorDoor(); idleNow();
    mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(editorDoorFetches()).toBe(0);
    const edit = screen.getByRole('button', { name: 'Edit' });
    approach(edit);
    await waitFor(() => expect(editorDoorFetches()).toBe(1));
    fireEvent.click(edit);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(editorDoorFetches()).toBe(1);
  });

it('keeps the intent request running when the pointer moves on, and the later click still issues no second one', async () => {
  mockRole = 'owner'; mockSourceLength = 450_000;
  answerEditorDoor(); idleNow();
  mount();
  const edit = screen.getByRole('button', { name: 'Edit' });
  fireEvent.pointerEnter(edit); fireEvent.pointerLeave(edit);
  await waitFor(() => expect(editorDoorFetches()).toBe(1));
  const signal = vi.mocked(fetch).mock.calls.find(([input]) => String(input).includes('?part=editor'))![1]!.signal!;
  expect(signal.aborted).toBe(false);
  fireEvent.click(edit);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(editorDoorFetches()).toBe(1);
});

/**
 * THE READER'S PICK ON THE DOCUMENT PAGE. A stored pick (lib/story-runtime/reader-mode chooseTheme) is the document's
 * mode from the first paint: the ground around the frame and what the frame is told, on this document and every other.
 * Without one the author's mode stands. While editing, the preview shows the document's own Mode setting.
 */
const groundOf = (mode: 'light' | 'dark') => { const probe = document.createElement('div'); probe.style.background = mode === 'dark' ? '#0b0b0c' : '#ffffff'; return probe.style.background; };
const toldModes = () => selectionSend.mock.calls.map(([command]) => command as { type?: string; mode?: string }).filter((command) => command?.type === 'mx:reader-mode').map((command) => command.mode);

it('opens a light document dark for a reader who picked dark: the ground, the toggle and the frame', async () => {
  localStorage.setItem('mx_theme', 'dark'); document.documentElement.dataset.theme = 'dark';
  mockRole = 'viewer'; mockSelectionBridge = true;
  try {
    mount();
    expect(screen.getByLabelText('Artifact viewport').style.background).toBe(groundOf('dark'));
    await waitFor(() => expect(toldModes()).toContain('dark'));
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    expect(within(await controls()).getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
  } finally { delete document.documentElement.dataset.theme; }
});

it('keeps the author\'s mode for a reader who never picked, even on a dark device', async () => {
  document.documentElement.dataset.theme = 'dark';
  mockRole = 'viewer'; mockSelectionBridge = true;
  try {
    mount();
    expect(screen.getByLabelText('Artifact viewport').style.background).toBe(groundOf('light'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(toldModes()).toEqual([]);
  } finally { delete document.documentElement.dataset.theme; }
});

it('a pick made on one document applies to the next document opened', async () => {
  mockRole = 'viewer'; mockSelectionBridge = true;
  const first = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  fireEvent.click(within(await controls()).getByRole('button', { name: 'Dark mode' }));
  first.unmount(); cleanup(); document.body.replaceChildren(); selectionSend.mockClear();
  delete document.documentElement.dataset.theme;
  mount('/a/another');
  expect(screen.getByLabelText('Artifact viewport').style.background).toBe(groundOf('dark'));
  await waitFor(() => expect(toldModes()).toEqual(['dark']));
});

it('while editing, the preview shows the document\'s own Mode setting, and the pick returns with reading', async () => {
  localStorage.setItem('mx_theme', 'dark'); document.documentElement.dataset.theme = 'dark';
  mockRole = 'owner'; mockSelectionBridge = true;
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).includes('?part=editor')) return Response.json({ editId: 'edit-3', version: 3, source: '<p id="body">Hello</p>' });
    return existing(input, init);
  });
  try {
    mount('/a/doc#edit');
    await vi.dynamicImportSettled();
    await waitFor(() => expect(toldModes().at(-1)).toBe('light'));
    expect(screen.getByLabelText('Artifact viewport').style.background).toBe(groundOf('light'));
    // Leaving edit mode (the address drops `#edit`): reading shows the pick again.
    window.history.replaceState(null, '', '/a/doc');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    // (Done flushes the editor first, bounded: create-edit-lifecycle FLUSH_BOUND_MS.)
    await waitFor(() => expect(toldModes().at(-1)).toBe('dark'), { timeout: 5000 });
    expect(screen.getByLabelText('Artifact viewport').style.background).toBe(groundOf('dark'));
  } finally { delete document.documentElement.dataset.theme; }
});

/**
 * THE NODE TREE ONLY WHERE A READER CAN USE IT (solid/document/create-framed-story): the tree is what the frame's
 * controller classifies comments, selections and edits against, and on a large document most of the page's bytes. A
 * commenter or editor gets it on load; a guest when they first press into the document (the selection bubble's
 * Comment → sign-in is the only use they have for it); a signed-in viewer or an archived version never. Every reader's
 * bridge still attaches at once, so reading, the address's `$` values, the hash, the mode pick and live versions are
 * the same for all.
 */
const FRAME_ORIGIN = 'http://646f633132333435.lvh.me';
const TREE = [{ type: 'element', tag: 'p', start: 0, end: 10, attributes: [], children: [] }];
type Posted = ReturnType<typeof mount>['posted'];
type Envelope = { type?: string; key?: string; hash?: string; payload?: { kind?: string; nodes?: unknown; command?: { type?: string; mode?: string } } };
const nodeFetches = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input).includes('part=nodes')).length;
const servingTree = () => {
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => (String(input).includes('part=nodes') ? Response.json({ nodes: TREE }) : existing(input, init)));
};
const envelopes = (posted: Posted) => posted.mock.calls.map(([message]) => message as Envelope);
const attaches = (posted: Posted) => envelopes(posted).filter((message) => message.payload?.kind === 'attach');
const frameReady = (frame: HTMLIFrameElement, key: string, nonce: string, urlValues?: string) => window.dispatchEvent(new MessageEvent('message', {
  data: { type: 'mx:frame-bridge', key, payload: { kind: 'ready', nonce, ...(urlValues === undefined ? {} : { urlValues }) } }, origin: FRAME_ORIGIN, source: frame.contentWindow,
}));
/** The frame's door opens (lib/islands/frame-door says `hello`): the page attaches, or attaches again, through it. */
const doorOpens = (frame: HTMLIFrameElement) => window.dispatchEvent(new MessageEvent('message', {
  data: { type: 'mx:frame-bridge', payload: { kind: 'hello' } }, origin: FRAME_ORIGIN, source: frame.contentWindow,
}));
/** A press inside the frame: focus moves into it and the page's window loses it (all a page sees of a frame on another origin). */
const pressIntoDocument = (frame: HTMLIFrameElement) => { frame.focus(); window.dispatchEvent(new FocusEvent('blur')); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

it.each([['a guest', 'anon'], ['a signed-in viewer', 'account']])('%s reads, navigates and follows live versions without the node tree', async (_who, kind) => {
  mockKind = kind; mockRole = 'viewer'; servingTree();
  const [liveFrame, setLiveFrame] = createSignal<ArtifactLiveEvent | null>(null);
  mockLive = liveFrame;
  try {
    const { frame, posted } = mount('/a/doc');
    doorOpens(frame);
    await settle();
    expect(nodeFetches()).toBe(0);
    // Reads: the server's frame is the page's viewport, and the bridge attaches at once, with no tree.
    expect(screen.getByLabelText('Artifact viewport')).toContainElement(frame);
    expect(attaches(posted)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ kind: 'attach', nodes: [] }) })]);
    // The document's controller runs: its `$` values reach the address.
    frameReady(frame, attaches(posted)[0]!.key!, 'reader-nonce', '?$region=east');
    expect(window.location.search).toBe('?$region=east');
    // Navigates: a link to a heading reaches the frame.
    window.history.replaceState(null, '', '/a/doc?$region=east#later');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(envelopes(posted)).toContainEqual({ type: STORY_FRAME_HASH_MESSAGE, hash: '#later' });
    // The reader's mode pick reaches the document's controller.
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    fireEvent.click(within(await controls()).getByRole('button', { name: 'Dark mode' }));
    await waitFor(() => expect(envelopes(posted).map((message) => message.payload?.command)).toContainEqual({ type: 'mx:reader-mode', mode: 'dark' }));
    // Live: a newer version's title reaches the bar.
    setLiveFrame({ version: 4, editId: 'e4', title: 'A newer title', format: 'markup', by: null } as ArtifactLiveEvent);
    await waitFor(() => expect(screen.getByText('A newer title', { selector: '[data-mx-document-title]' })).toBeInTheDocument());
    expect(nodeFetches()).toBe(0);
  } finally { delete document.documentElement.dataset.theme; }
});

/** The frame half reports the reader's first press, touch, key or selection in a document attached without its tree. */
const framePressed = (frame: HTMLIFrameElement, key: string) => window.dispatchEvent(new MessageEvent('message', {
  data: { type: 'mx:frame-bridge', key, payload: { kind: 'pressed' } }, origin: FRAME_ORIGIN, source: frame.contentWindow,
}));
const treesSent = (posted: Posted) => envelopes(posted).filter((message) => message.payload?.kind === 'nodes');

it.each([
  ['presses into the document (the page\'s window loses focus to the frame)', (frame: HTMLIFrameElement) => pressIntoDocument(frame)],
  ['touches or selects in the document (the frame says so; no focus moves)', (frame: HTMLIFrameElement, key: string) => framePressed(frame, key)],
])('asks for the tree once when a guest first %s, and hands it to the running frame controller', async (_how, press) => {
  mockKind = 'anon'; mockRole = 'viewer'; servingTree();
  const { frame, posted } = mount();
  doorOpens(frame);
  await settle();
  expect(nodeFetches()).toBe(0);
  const key = attaches(posted)[0]!.key!;
  frameReady(frame, key, 'guest-nonce');
  press(frame, key);
  await waitFor(() => expect(nodeFetches()).toBe(1));
  await waitFor(() => expect(treesSent(posted)).toHaveLength(1));
  // The same session: the controller that holds the reader's selection takes the tree; nothing detaches or re-attaches.
  expect(treesSent(posted)[0]).toEqual(expect.objectContaining({ key, payload: { kind: 'nodes', nodes: TREE } }));
  expect(envelopes(posted).map((message) => message.payload?.kind)).not.toContain('detach');
  expect(new Set(attaches(posted).map((message) => message.key))).toEqual(new Set([key]));
  frame.blur();
  pressIntoDocument(frame);
  framePressed(frame, key);
  await settle();
  expect(nodeFetches()).toBe(1);
  expect(treesSent(posted)).toHaveLength(1);
});

it.each([['a signed-in viewer', 'account', null], ['a guest reading an archived version', 'anon', { version: 1, head: 2 }]] as const)('never asks for the tree for %s, pressing into the document included', async (_who, kind, archived) => {
  mockKind = kind; mockRole = 'viewer'; mockArchived = archived ? { ...archived } : null; servingTree();
  const { frame, posted } = mount();
  doorOpens(frame);
  pressIntoDocument(frame);
  framePressed(frame, attaches(posted)[0]!.key!);
  await settle();
  expect(nodeFetches()).toBe(0);
  expect(attaches(posted)).toEqual([expect.objectContaining({ payload: expect.objectContaining({ nodes: [] }) })]);
  expect(treesSent(posted)).toEqual([]);
});

it.each(['commenter', 'owner'])('a %s gets the tree on load, and the bridge attaches only with it', async (role) => {
  mockRole = role; servingTree();
  const { posted } = mount();
  await waitFor(() => expect(attaches(posted)).toHaveLength(1));
  expect(nodeFetches()).toBe(1);
  expect(attaches(posted)[0]!.payload?.nodes).toEqual(TREE);
});

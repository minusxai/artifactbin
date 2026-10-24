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
import * as documentNavigation from '../lib/document-navigation';
import type { AnnotationWire } from '@/lib/annotations/store';
import type { FramedStory } from '../document/create-framed-story';

let mockRole = 'commenter';
let mockKind = 'account';
let mockTitle: string | null = 'A copy';
let mockArchived: { version: number; head: number } | null = null;
let served: HTMLElement | null = null;
let mockCsp: Record<string, unknown> | undefined;
let mockScriptFailure: {errors:string[]} | undefined;
let mockTemplate: string | null = null;
let mockPwa = false;
let mockOpenAnnotations = 0;
let mockSourceLength: number | undefined;
let mockLive = () => null as ArtifactLiveEvent | null;
let mockLiveOptions: Parameters<typeof import('../editor/create-live-artifact').createLiveArtifact>[0] | undefined;
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
vi.mock('../editor/create-live-artifact', () => ({ createLiveArtifact: (options: Parameters<typeof import('../editor/create-live-artifact').createLiveArtifact>[0]) => { mockLiveOptions = options; return () => mockLive(); } }));
vi.mock('@/solid/lib/bootstrap', () => ({ takeBootstrap: () => ({ kind: mockKind, role: mockRole, archived: mockArchived, cspRequest: mockCsp, scriptFailure: mockScriptFailure, surface: { id: 'doc12345', template: mockTemplate, pwaEnabled: mockPwa, openAnnotations: mockOpenAnnotations, title: mockTitle, format: 'html', version: 3, sourceLength: mockSourceLength, framedOrigin: 'http://646f633132333435.lvh.me', author: { username: 'ada', id: 'u1', forkedFrom: { label: 'Source document', href: '/a/source' } } } }) }));
vi.mock('@/lib/http/login-href', () => ({ loginHref: vi.fn(() => '/login') }));
import { loginHref } from '@/lib/http/login-href';
vi.mock('../lib/copy-text', () => ({ copyText: vi.fn(async () => true) }));
import { copyText } from '../lib/copy-text';
import {captureInstallPrompt} from '@/lib/serving/pwa-install';
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
  mockScriptFailure = undefined;
  mockTemplate = null;
  mockPwa = false;
  mockOpenAnnotations = 0;
  mockSourceLength = undefined;
  mockLive = () => null;
  mockLiveOptions = undefined;
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

afterEach(async () => { cleanup(); await vi.dynamicImportSettled(); localStorage.clear(); document.cookie = 'mx_theme=; path=/; max-age=0'; document.body.replaceChildren(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount(path = '/a/doc') {
  window.history.replaceState(null, '', path);
  const host = document.createElement('div');
  host.setAttribute('data-mx-framed', '');
  const frame = document.createElement('iframe');
  frame.setAttribute('data-mx-document-frame', '');
  host.append(frame);
  document.body.append(host);
  served = host;
  const view = render(() => <Router><Route path="/a/:id" component={DocumentPage} /><Route path="/a/:id/app" component={DocumentPage} /></Router>);
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
const controls = async () => {
  const panel = await waitFor(() => within(panelRoot()).getByRole('region', { name: 'Artifact controls' }));
  // The drawer is available before the separately loaded document actions.
  await within(panel).findByRole('heading', {name:'Artifact'});
  return panel;
};
const menuPanel = () => waitFor(() => within(panelRoot()).getByRole('navigation', { name: 'Menu' }));

it('places the doc agent handoff in trusted document navigation, outside the page bar', async () => {
  mockRole = 'owner'; mockTemplate = 'doc';
  mount();
  expect(screen.queryByRole('button', { name: 'Copy for agent' })).toBeNull();
  fireEvent.click(await trusted().findByRole('button', { name: 'Copy for agent' }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(expect.stringContaining('/a/doc12345 in place.')));
});

it.each([['owner', 'app'], ['commenter', 'doc']])('omits the small agent button for %s viewing %s', (role, template) => {
  mockRole = role; mockTemplate = template;
  mount();
  expect(screen.queryByRole('button', { name: 'Copy for agent' })).toBeNull();
  expect(trusted().queryByRole('button', { name: 'Copy for agent' })).toBeNull();
});

it('adopts the served frame where the server drew it instead of rendering the document: its host is the viewport', () => {
  const { host, frame } = mount();
  const viewport = screen.getByLabelText('Artifact viewport');
  expect(viewport).toBe(host);
  expect(host.parentElement).toBe(document.body);
  expect(frame.parentElement).toBe(host);
  // The notices' row is drawn above the frame, inside its host.
  expect(host.firstElementChild).toBe(viewport.querySelector('[data-mx-frame-slot]'));
  expect(host.lastElementChild).toBe(frame);
  expect(viewport.style.position).toBe('fixed');
  expect(viewport.style.top).toBe('44px');
});

it('never takes the served frame out of the document: a moved iframe loads its spent first URL again (WebKit, Firefox)', async () => {
  // No `moveBefore` here, as in Safari and Firefox: any removal and re-insertion of the frame (or its host) is a reload.
  expect('moveBefore' in Element.prototype).toBe(false);
  const moved: Node[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.removedNodes) moved.push(node);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  try {
    mockRole = 'viewer';
    const { host, frame } = mount();
    const originalWindow = frame.contentWindow;
    const originalSrc = frame.getAttribute('src');
    // The retained read-only rail opens and closes around the frame; it never adopts the frame into UI.
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    const rail = await trusted(1).findByRole('complementary', { name: 'Annotation sidebar' });
    expect(rail).toHaveTextContent('You have read-only comment access.');
    expect(host.querySelector('[data-mx-frame-slot]')!.childElementCount).toBe(0);
    fireEvent.click(within(rail).getByRole('button', { name: 'Close comments' }));
    await waitFor(() => expect(rail).not.toBeInTheDocument());
    expect(frame.contentWindow).toBe(originalWindow);
    expect(frame.getAttribute('src')).toBe(originalSrc);
    observer.takeRecords().forEach((record) => record.removedNodes.forEach((node) => moved.push(node)));
    expect(moved.filter((node) => node === frame || node === host || node.contains(frame))).toEqual([]);
    expect(frame.parentElement).toBe(host);
    expect(host.parentElement).toBe(document.body);
  } finally { observer.disconnect(); }
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

it('an owner can rename, share and delete without a document editor', async () => {
  mockRole = 'owner';
  mount();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(await controls());
  expect(panel.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(panel.getByRole('button', { name: 'Rename artifact' })).toBeInTheDocument();
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
    const edit = await waitFor(() => find('[aria-label="Rename artifact"]') ?? Promise.reject(new Error('no controls panel')));
    expect(edit, 'the controls panel offers Rename artifact').not.toBeNull();
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
  await trusted().findByRole('button', {name: 'Allow once'});
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
it('an editor keeps metadata and sharing controls without document editing', async () => {
  mockRole = 'editor';
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  const panel = within(await controls());
  expect(panel.queryByRole('button', { name: 'Edit artifact' })).toBeNull();
  expect(panel.getByRole('button', { name: 'Rename artifact' })).toBeInTheDocument();
  expect(panel.queryByLabelText('Owner actions')).toBeNull();
  fireEvent.click(within(panel.getAllByLabelText('Document actions')[0]!).getByRole('button', { name: 'Share' }));
  expect(await trusted().findByRole('button', { name: 'Edit social preview' })).toBeInTheDocument();
  expect(await trusted().findByRole('button', { name: 'Make public' })).toBeInTheDocument();
  expect(trusted().getByRole('textbox', { name: 'Invite email' })).toBeInTheDocument();
});

it('an owner opens sharing without document source editing', async () => {
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
  expect(await trusted(1).findByRole('complementary', { name: 'Annotation sidebar' })).toHaveTextContent('Please add the source.');
});

it('opens a carried fork intent after login and consumes the query parameter', async () => {
  mount('/a/doc?intent=fork');
  expect(await trusted().findByRole('dialog', { name: 'Fork this artifact?' })).toBeInTheDocument();
  expect(window.location.search).toBe('');
});

it('consumes a signed-in viewer comment intent into the read-only rail without restarting login', async () => {
  mockRole = 'viewer';
  mount('/a/doc?intent=comment');
  expect(window.location.search).toBe('');
  expect(loginHref).not.toHaveBeenCalled();
  const rail = await trusted(1).findByRole('complementary', {name:'Annotation sidebar'});
  expect(rail).toHaveTextContent('You have read-only comment access.');
  expect(within(rail).queryByRole('button', {name:'Sign in to comment'})).toBeNull();
  expect(within(rail).queryByRole('button', {name:'Select'})).toBeNull();
  fireEvent.click(within(rail).getByRole('button', {name:'Close comments'}));
  await waitFor(() => expect(rail).not.toBeInTheDocument());
  expect(loginHref).not.toHaveBeenCalled();
});

it('opens archived comments read-only and consumes the owner intent without login', async () => {
  mockRole = 'owner'; mockArchived = { version: 2, head: 3 };
  mount('/a/doc?intent=comment');
  expect(window.location.search).toBe('');
  expect(loginHref).not.toHaveBeenCalled();
  const rail = await trusted(1).findByRole('complementary', {name:'Annotation sidebar'});
  expect(rail).toHaveTextContent('You have read-only comment access.');
  expect(within(rail).queryByRole('button', {name:'Sign in to comment'})).toBeNull();
  expect(within(rail).queryByRole('button', {name:'Select'})).toBeNull();
  expect(trusted(1).queryByRole('dialog', {name:'Annotation composer'})).toBeNull();
});

it('opens a carried comment intent for an authorized commenter without login', async () => {
  mount('/a/doc?intent=comment');
  expect(window.location.search).toBe('');
  expect(loginHref).not.toHaveBeenCalled();
  expect(await trusted(1).findByRole('complementary', { name: 'Annotation sidebar' })).toBeInTheDocument();
});

it.each(['/a/doc', '/a/doc?intent=comment'])('lets a guest read comments before asking to sign in to post (%s)', async (path) => {
  mockKind = 'anon'; mockRole = 'viewer';
  mount(path);
  if (!path.includes('intent=')) fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  const rail = await trusted(1).findByRole('complementary', {name:'Annotation sidebar'});
  expect(window.location.search).toBe('');
  expect(loginHref).not.toHaveBeenCalled();
  expect(within(rail).queryByRole('button', {name:'Select'})).toBeNull();
  expect(trusted(1).queryByRole('dialog', {name:'Annotation composer'})).toBeNull();
  fireEvent.click(within(rail).getByRole('button', {name:'Sign in to comment'}));
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

it('a page served without a frame is the 404 page, never a reload', async () => {
  const replace = vi.fn();
  vi.stubGlobal('location', { ...window.location, replace });
  window.history.replaceState(null, '', '/a/doc');
  render(() => <Router><Route path="/a/:id" component={DocumentPage} /><Route path="/a/:id/app" component={DocumentPage} /></Router>);
  await vi.dynamicImportSettled();
  expect(screen.queryByLabelText('Artifact viewport')?.querySelector('iframe') ?? null).toBeNull();
  expect(replace).not.toHaveBeenCalled();
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

it.each(['owner', 'editor'])('a %s visiting a legacy edit hash reads and comments without downloading editor source', async (role) => {
  mockRole = role; mockSelectionBridge = true; mockSourceLength = 100;
  mount('/a/doc#edit');
  await vi.dynamicImportSettled();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(trusted(1).queryByRole('textbox', { name: 'Markup source' })).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('part=editor'))).toBe(false);
  expect(selectionSend).toHaveBeenCalledWith({ type: 'mx:selection-actions', edit: false, annotate: true });
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(await trusted(1).findByRole('complementary', { name: 'Annotation sidebar' })).toBeInTheDocument();
});

it('opens independent PWA, context and file settings without entering a document editor', async () => {
  mockRole = 'owner';
  const existing = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input) === '/api/my/artifacts/doc12345') return Response.json({ id: 'doc12345', edit_id: 'e3', version: 3, title: 'A copy', markup: '<p id="body">Hello</p>', refs: [{ id: 'file1234', kind: 'image', title: 'Reference image' }] });
    return existing(input, init);
  });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
  fireEvent.click(within(await controls()).getByRole('button', { name: 'Artifact settings' }));
  const settings = await trusted().findByRole('dialog', { name: 'Artifact settings' });
  await within(settings).findByLabelText('Allow installation as a PWA');
  fireEvent.click(within(settings).getByRole('tab', { name: 'Context' }));
  expect(await within(settings).findByRole('button', { name: 'Add context' })).toBeInTheDocument();
  fireEvent.click(within(settings).getByRole('tab', { name: 'Files' }));
  expect(within(settings).getByRole('link', { name: 'Reference image' })).toHaveAttribute('href', '/a/file1234');
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it('loads stored script diagnostics in the trusted frame slot without changing the document',async()=>{
 mockScriptFailure={errors:['Stored script diagnostic']};mount();
 expect(await trusted().findByText('Stored script diagnostic')).toBeTruthy();
 expect(document.querySelector('[data-mx-document-frame]')).not.toBeNull();
 expect(window.location.pathname).toBe('/a/doc');
});

it('loads the requested PWA install dialog and prompts synchronously only on its real button gesture',async()=>{
 mockPwa=true;mount('/a/doc12345/app/?install=1');
 const dispose=captureInstallPrompt(window);
 try {
  await trusted().findByRole('dialog',{name:'Install A copy'});
  let gesture=false;const prompt=vi.fn(()=>{expect(gesture).toBe(true);return Promise.resolve({outcome:'dismissed'});});
  window.dispatchEvent(Object.assign(new Event('beforeinstallprompt',{cancelable:true}),{prompt}));
  const button=await trusted().findByRole('button',{name:'Install app'});expect(prompt).not.toHaveBeenCalled();
  gesture=true;fireEvent.click(button);gesture=false;expect(prompt).toHaveBeenCalledOnce();
 } finally {dispose();}
});

it('does not fetch or mount discussion for an empty guest reader until its rail is requested', async () => {
  mockKind = 'anon'; mockRole = 'viewer';
  mount();
  await vi.dynamicImportSettled();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/annotations'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/annotations'))).toBe(true));
  expect(await trusted(1).findByRole('complementary', { name: 'Annotation sidebar' })).toBeInTheDocument();
  expect(loginHref).not.toHaveBeenCalled();
});
it('loads existing guest-visible comment pins even while the discussion rail is closed', async () => {
  mockKind = 'anon'; mockRole = 'viewer'; mockOpenAnnotations = 1;
  mount();
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/annotations'))).toBe(true));
  expect(trusted(1).queryByRole('complementary', { name: 'Annotation sidebar' })).toBeNull();
  expect(loginHref).not.toHaveBeenCalled();
});

it.each(['comment','thread'])('admits a linked %s even without an open-comment bootstrap count',async key=>{
 mockKind='anon';mockRole='viewer';mount('/a/doc?'+key+'=thread-1');
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/annotations'))).toBe(true));
 expect(loginHref).not.toHaveBeenCalled();
});

it('activates an empty guest reader when its annotation subscription delivers a new thread',async()=>{
 mockKind='anon';mockRole='viewer';mount();await vi.dynamicImportSettled();
 expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/annotations'))).toBe(false);
 const annotation:AnnotationWire={id:'stream-thread',status:'open',anchor:null,orphaned:true,anchor_version:3,snippet:'Arrived via stream',quote:null,range:null,quote_found:null,thread:[],created_at:'2026-01-01T00:00:00Z',resolved_at:null};
 mockLiveOptions!.onAnnotations!([annotation]);
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/annotations'))).toBe(true));
 expect(loginHref).not.toHaveBeenCalled();
});
it('reloads admission and the frame ticket when the live membership authority changes',()=>{
 const replace=vi.spyOn(documentNavigation,'replaceDocument').mockImplementation(()=>{});mount();
 mockLiveOptions!.onData!({datasets:['_members'],version:4});
 expect(replace).toHaveBeenCalledWith(window.location.href);
});
it('reacts to a linked thread added on the same document route without login',async()=>{
 mockKind='anon';mockRole='viewer';mount();await vi.dynamicImportSettled();
 expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/annotations'))).toBe(false);
 window.history.pushState(null,'','/a/doc?thread=new-thread');window.dispatchEvent(new PopStateEvent('popstate'));
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/annotations'))).toBe(true));
 expect(loginHref).not.toHaveBeenCalled();
});

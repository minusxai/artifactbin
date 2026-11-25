/* @jsxImportSource solid-js */
/**
 * The host comments module (../browser-host-comments): what a shell on the app's origin gets with `comments: true`
 * (lib/html-reader/host-shell). The frame's selection actions follow the reader's role as the app's own document page
 * grants them (../ReaderDiscussion); the served open count reaches the shell's events; the rail opens inside the shell's
 * panel, in a trusted root wearing the shell's theme tokens and its light or dark. The frame is a fake bridge, every
 * request the real backends over a stubbed `fetch` (./annotation-rig).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import type { ArtifactRole } from '@artifactbin/contracts/sharing';
import { OPTIONAL_THEME_TOKENS, THEME_TOKENS } from '@/lib/html-systems';
import type { FrameBridgeParent } from '@/lib/html-reader/frame-bridge/parent';
import type { HostComments } from '@/lib/html-reader/host-comments-contract';
import { cleanup } from '@/solid/__tests__/helpers';
import { ANN, NONCE, fetchCalls, flush, installAnnotationFetch, knobs } from './annotation-rig';
import { mountHostComments } from '../browser-host-comments';
import { HOST_THEME_ATTR, HOST_THEME_CSS } from '../host-theme';
import { replaceComment } from './comment-input';
import { stubFetch } from '@/test/helpers/fetch-stub';

const mounted: HostComments[] = [];
beforeEach(() => installAnnotationFetch());
afterEach(() => {
  for (const comments of mounted.splice(0)) comments.destroy();
  cleanup(); sessionStorage.clear(); document.documentElement.removeAttribute('style'); document.body.replaceChildren(); vi.unstubAllGlobals();
});

/** The admission door's answer for this reader, and the session's, in front of the rig's annotation doors. */
function serve(page: { role: ArtifactRole; kind: 'account' | 'none'; openAnnotations?: number }) {
  const annotations = globalThis.fetch;
  stubFetch({
    '/api/page/artifact/*': { role: page.role, kind: page.kind, archived: null, surface: { openAnnotations: page.openAnnotations ?? 0 } },
    '/api/page/session': { kind: page.kind, user: page.kind === 'account' ? { id: 'usr_me' } : null },
  }, { fallback: (url, init) => annotations(url, init) });
}

function mount(page: Parameters<typeof serve>[0], { signIn = true } = {}) {
  serve(page);
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Set<(event: unknown) => void>();
  const bridge = {
    nonce: NONCE, send: (command: Record<string, unknown>) => sent.push(command), invalidate: vi.fn(),
    subscribe: (listener: (event: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getViewportRect: () => new DOMRect(0, 56, 800, 600), dispose: () => {},
  } as unknown as FrameBridgeParent;
  const events: Array<{ name: string; detail: unknown }> = [];
  const signInEvents: CustomEvent[] = [];
  const container = document.createElement('div');
  if (!signIn) container.addEventListener('af-document-sign-in', (event) => event.preventDefault());
  const comments = mountHostComments({
    win: window, id: 'doc1', stylesheet: '', bridge, frame: document.createElement('iframe'), version: 3, editId: 'e3', mode: null, presence: false,
    emit: (name, detail, cancelable) => {
      const event = new CustomEvent(name, { detail, cancelable });
      const allowed = container.dispatchEvent(event);
      events.push({ name, detail });
      if (name === 'af-document-sign-in') signInEvents.push(event);
      return allowed;
    },
    nonce: () => NONCE, onNonce: () => () => {}, followVersion: vi.fn(), notifyData: vi.fn(),
  });
  mounted.push(comments);
  const fromFrame = (event: unknown) => { for (const listener of [...listeners]) listener(event); };
  const grants = () => sent.filter((command) => command.type === 'mx:selection-actions');
  return { comments, sent, events, fromFrame, grants, signInEvents };
}

const selection = { kind: 'text', path: '1', nodeId: 'p1', tag: 'p', rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [], quote: 'Revenue' };

it('grants the frame its comment action exactly as the app page does: a commenter and a signed-out reader, never a signed-in viewer', async () => {
  const commenter = mount({ role: 'commenter', kind: 'account' });
  await waitFor(() => expect(commenter.grants().at(-1)).toEqual({ type: 'mx:selection-actions', edit: false, annotate: true }));
  commenter.comments.destroy();

  const viewer = mount({ role: 'viewer', kind: 'account' });
  await waitFor(() => expect(viewer.grants().at(-1)).toEqual({ type: 'mx:selection-actions', edit: false, annotate: false }));
  // A forged action from the frame is refused by the same recheck.
  viewer.fromFrame({ type: 'mx:selection-action', nonce: NONCE, action: 'annotate', selection });
  await flush();
  expect(viewer.events.some((event) => event.name === 'af-document-sign-in')).toBe(false);
  viewer.comments.destroy();

  // Signed out, the action is offered and asks the shell to sign the reader in (the shell took it: preventDefault).
  const guest = mount({ role: 'viewer', kind: 'none' }, { signIn: false });
  await waitFor(() => expect(guest.grants().at(-1)).toEqual({ type: 'mx:selection-actions', edit: false, annotate: true }));
  guest.fromFrame({ type: 'mx:selection-action', nonce: NONCE, action: 'annotate', selection });
  expect(guest.events.filter((event) => event.name === 'af-document-sign-in')).toHaveLength(1);
});

it('reports the open threads, draws the rail inside the shell\'s panel in the shell\'s tokens, and follows its light or dark', async () => {
  // The shell sets the documented tokens on its page.
  document.documentElement.style.setProperty('--background', 'rgb(247, 243, 234)');
  const { comments, events, sent, fromFrame } = mount({ role: 'commenter', kind: 'account', openAnnotations: 1 });
  await waitFor(() => expect(events).toContainEqual({ name: 'af-document-comments', detail: { open: 1, unread: 0, panel: false } }));
  // The open thread is pinned in the frame.
  await waitFor(() => expect(sent.some((command) => command.type === 'mx:annotations' && (command.pins as Array<{ id: string }>)?.some((pin) => pin.id === ANN.id))).toBe(true));

  const panel = document.body.appendChild(document.createElement('aside'));
  comments.open(panel);
  const host = panel.querySelector('[data-trusted-ui]')!;
  expect(host).not.toBeNull();
  const rail = await within(host.shadowRoot as unknown as HTMLElement).findByRole('region', { name: 'Annotation sidebar' });
  expect(rail).toBeTruthy();
  await waitFor(() => expect(events.at(-1)).toEqual({ name: 'af-document-comments', detail: { open: 1, unread: 0, panel: true } }));
  const root = host.shadowRoot!.querySelector('[data-trusted-ui-root]')!;
  expect(root.hasAttribute(HOST_THEME_ATTR)).toBe(true);
  comments.setMode('dark');
  expect(root.getAttribute('data-theme')).toBe('dark');
  comments.close();
  expect(panel.querySelector('[data-trusted-ui]')).toBeNull();
  expect(events.at(-1)).toEqual({ name: 'af-document-comments', detail: { open: 1, unread: 0, panel: false } });
  // A mark pressed in the frame opens the thread in the shell's panel again, never in a column of its own.
  fromFrame({ type: 'mx:annotation-pin', nonce: NONCE, id: ANN.id, rect: { x: 0, y: 0, width: 1, height: 1 } });
  const again = await waitFor(() => { const root = panel.querySelector('[data-trusted-ui]'); expect(root).not.toBeNull(); return root!; });
  await within(again.shadowRoot as unknown as HTMLElement).findByRole('region', { name: 'Annotation sidebar' });
  await waitFor(() => expect(events.at(-1)).toEqual({ name: 'af-document-comments', detail: { open: 1, unread: 0, panel: true } }));
  knobs.open = [];
});

it('keeps the app\'s own look for a shell that sets no tokens, and maps only the documented ones', () => {
  const { comments } = mount({ role: 'viewer', kind: 'account' });
  const panel = document.body.appendChild(document.createElement('aside'));
  comments.open(panel);
  const root = panel.querySelector('[data-trusted-ui]')!.shadowRoot!.querySelector('[data-trusted-ui-root]')!;
  expect(root.hasAttribute(HOST_THEME_ATTR)).toBe(false);
  const read = [.../^:host\{([^}]*)\}/.exec(HOST_THEME_CSS)![1]!.matchAll(/:var\(--([a-z0-9-]+)\)/g)].map((match) => match[1]!);
  expect(read.length).toBeGreaterThan(10);
  for (const token of read) expect([...THEME_TOKENS, ...OPTIONAL_THEME_TOKENS], token).toContain(`--${token}`);
});

it('knows a signed-in reader in the rail: reacting is offered, never a sign-in', async () => {
  knobs.open = [ANN];
  const { comments } = mount({ role: 'commenter', kind: 'account', openAnnotations: 1 });
  const panel = document.body.appendChild(document.createElement('aside'));
  comments.open(panel);
  const shadow = panel.querySelector('[data-trusted-ui]')!.shadowRoot as unknown as HTMLElement;
  await within(shadow).findByRole('button', { name: 'React with thumbs up' });
  expect(within(shadow).queryByRole('button', { name: 'Sign in to react' })).toBeNull();
  knobs.open = [];
});

it('lets the host cancel both the rail sign-in and a guest reaction', async () => {
  const { comments, signInEvents } = mount({ role: 'viewer', kind: 'none', openAnnotations: 1 }, { signIn: false });
  const panel = document.body.appendChild(document.createElement('aside'));
  comments.open(panel);
  const shadow = panel.querySelector('[data-trusted-ui]')!.shadowRoot as unknown as HTMLElement;
  fireEvent.click(await within(shadow).findByRole('button', { name: 'Sign in to comment' }));
  fireEvent.click(await within(shadow).findByRole('button', { name: 'Sign in to react' }));
  expect(signInEvents.map((event) => [event.cancelable, event.defaultPrevented])).toEqual([[true, true], [true, true]]);
  expect(fetchCalls.some(({ init }) => init?.method === 'PUT')).toBe(false);
});

it('lets the host cancel sign-in after an expired composer save and preserves the draft', async () => {
  knobs.createRefusal = { error: 'unauthorized' };
  knobs.createRefusalStatus = 401;
  const { fromFrame, grants, signInEvents } = mount({ role: 'commenter', kind: 'account' }, { signIn: false });
  await waitFor(() => expect(grants().at(-1)?.annotate).toBe(true));
  fromFrame({ type: 'mx:selection-action', nonce: NONCE, action: 'annotate', selection });
  const shadow = document.querySelector('[data-trusted-ui]')!.shadowRoot as unknown as HTMLElement;
  const field = await within(shadow).findByRole('textbox', { name: 'Annotation comment' });
  replaceComment(field, 'Keep this after sign-in');
  fireEvent.click(within(shadow).getByRole('button', { name: 'Save annotation' }));
  await waitFor(() => expect(signInEvents.map((event) => [event.cancelable, event.defaultPrevented])).toEqual([[true, true]]));
  expect(field).toHaveTextContent('Keep this after sign-in');
  expect(sessionStorage.getItem('artifactbin:draft:doc1:comment')).toBe('Keep this after sign-in');
});

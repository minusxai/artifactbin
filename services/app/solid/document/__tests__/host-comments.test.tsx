/* @jsxImportSource solid-js */
/**
 * The host comments module (../browser-host-comments): what a shell on the app's origin gets with `comments: true`
 * (lib/html-reader/host-shell). The frame's selection actions follow the reader's role as the app's own document page
 * grants them (../ReaderDiscussion); the served open count reaches the shell's events; the rail opens inside the shell's
 * panel, in a trusted root wearing the shell's theme tokens and its light or dark. The frame is a fake bridge, every
 * request the real backends over a stubbed `fetch` (./annotation-rig).
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor, within } from '@testing-library/dom';
import type { ArtifactRole } from '@artifactbin/contracts';
import { OPTIONAL_THEME_TOKENS, THEME_TOKENS } from '@/lib/html-systems';
import type { FrameBridgeParent } from '@/lib/html-reader/frame-bridge/parent';
import type { HostComments } from '@/lib/html-reader/host-comments-contract';
import { cleanup } from '@/solid/__tests__/helpers';
import { ANN, NONCE, flush, installAnnotationFetch, knobs } from './annotation-rig';
import { mountHostComments } from '../browser-host-comments';
import { HOST_THEME_ATTR, HOST_THEME_CSS } from '../host-theme';

const mounted: HostComments[] = [];
beforeEach(() => installAnnotationFetch());
afterEach(() => {
  for (const comments of mounted.splice(0)) comments.destroy();
  cleanup(); document.documentElement.removeAttribute('style'); document.body.replaceChildren(); vi.unstubAllGlobals();
});

/** The admission door's answer for this reader, and the session's, in front of the rig's annotation doors. */
function serve(page: { role: ArtifactRole; kind: 'account' | 'none'; openAnnotations?: number }) {
  const annotations = globalThis.fetch;
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/page/artifact/')) return Response.json({ role: page.role, kind: page.kind, archived: null, surface: { openAnnotations: page.openAnnotations ?? 0 } });
    if (String(url) === '/api/page/session') return Response.json({ kind: page.kind, user: page.kind === 'account' ? { id: 'usr_me' } : null });
    return annotations(url, init);
  }) as typeof fetch);
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
  const comments = mountHostComments({
    win: window, id: 'doc1', stylesheet: '', bridge, version: 3, editId: 'e3', mode: null, presence: false,
    emit: (name, detail) => { events.push({ name, detail }); return name === 'af-document-sign-in' ? signIn : true; },
    nonce: () => NONCE, onNonce: () => () => {}, followVersion: vi.fn(), notifyData: vi.fn(),
  });
  mounted.push(comments);
  const fromFrame = (event: unknown) => { for (const listener of [...listeners]) listener(event); };
  const grants = () => sent.filter((command) => command.type === 'mx:selection-actions');
  return { comments, sent, events, fromFrame, grants };
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
  const { comments, events, sent } = mount({ role: 'commenter', kind: 'account', openAnnotations: 1 });
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
